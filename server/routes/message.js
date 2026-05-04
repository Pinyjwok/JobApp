import express from 'express';
import { state } from '../lib/state.js';
import { broadcast, broadcastMode, broadcastAgentResult, parseAndStripStatus } from '../lib/broadcast.js';
import { sendToNodeAndWait } from '../lib/node-communication.js';
import { injectReviewerButtons } from '../lib/button-injection.js';
import { HAPPY_PATH, EXCEPTION_STATUSES, INPUT_NODE_MAP, AGENT_FOREGROUND } from '../config/constants.js';
import { sendToSN, reShowSectionReview } from '../lib/dispatch.js';

const router = express.Router();
export default router;

const RERUN_RE = /\b(rerun|re-run|redo|re-do|retry|re-try)\b/i;
const RERUN_MAP = [
  { pattern: /extractor/i,           resetStatus: 'FILES_SAVED',       agent: 'Extractor'   },
  { pattern: /researcher|research/i, resetStatus: 'INITIALIZED',       agent: 'Researcher'  },
  { pattern: /jd.?enhancer|jd/i,     resetStatus: 'RESEARCH_COMPLETE', agent: 'JD Enhancer' },
  { pattern: /analyst/i,             resetStatus: 'JD_ENHANCED',       agent: 'Analyst'     },
  { pattern: /reviewer|review/i,     resetStatus: 'ANALYSIS_COMPLETE', agent: 'Reviewer'    },
];

router.post('/', async (req, res) => {
  const { message, sessionId = 'default' } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }
  if (!state.recipe) {
    return res.status(503).json({ error: 'Recipe not ready' });
  }

  // Assembly phase running — drop stray text (user clicked button + typed simultaneously)
  if (state.currentAssemblyPhase > 1 && !state.snState && !state.awaitingRevision) {
    res.json({ ok: true });
    broadcast({ type: 'agent_message', agent: 'System', text: 'Assembly in progress — please use the action buttons.' });
    return;
  }

  // SN interview active — all text input goes to SN, not AC
  if (state.snState === 'interviewing') {
    res.json({ ok: true });
    await sendToSN(message);
    return;
  }

  // SN customise text input
  if (state.snState === 'customise_text') {
    state.snState = 'customise_confirm';
    res.json({ ok: true });
    await sendToSN(`__customise__: ${message}`);
    return;
  }

  // SN summary correction
  if (state.snState === 'summary') {
    res.json({ ok: true });
    await sendToSN(`__correction__: ${message}`);
    return;
  }

  // Assembly section revision
  if (state.awaitingRevision) {
    const section = state.awaitingRevision;
    state.awaitingRevision = null;
    res.json({ ok: true });
    broadcastMode('auto_running', section.agent);
    sendToNodeAndWait(section.inputNode, section.agent, `__revise__: ${message}`)
      .then(async r => {
        const { cleanText } = parseAndStripStatus(typeof r === 'string' ? r : (r != null ? JSON.stringify(r) : ''));
        broadcastAgentResult(cleanText, section.agent, true);
        await new Promise(resolve => setTimeout(resolve, 1000));
        await reShowSectionReview(section.phaseNumber);
      })
      .catch(err => console.error(`[${section.agent} revise] error:`, err));
    return;
  }

  const userWantsRerun = RERUN_RE.test(message);
  let nextAgent = null;
  let node = ' Message';
  const status = state.pipelineStatus;

  if (userWantsRerun) {
    const match = RERUN_MAP.find(r => r.pattern.test(message));
    if (match) {
      try {
        await state.recipe.globalVariables.setValue('pipeline_status', match.resetStatus);
        state.pipelineStatus = match.resetStatus;
      } catch {}
      nextAgent = match.agent;
      node = INPUT_NODE_MAP[match.resetStatus] ?? ' Message';
      console.log(`[route] rerun "${match.agent}" — status reset to ${match.resetStatus}`);
      broadcast({ type: 'agent_message', agent: 'System', text: `Re-running **${match.agent}**…` });
      broadcastMode('auto_running', match.agent);
    } else {
      nextAgent = 'Main Orchestrator';
    }
  } else if (status && HAPPY_PATH[status]) {
    nextAgent = HAPPY_PATH[status];
    node = INPUT_NODE_MAP[status] ?? ' Message';
    console.log(`[route] ${status} → ${nextAgent} via ${node}`);
  } else if (status && EXCEPTION_STATUSES.has(status)) {
    nextAgent = 'Main Orchestrator';
  }

  if (!nextAgent) {
    nextAgent = state.fallbackAgent ?? 'Main Orchestrator';
    console.log(`[user] fallback → ${nextAgent}: ${message.slice(0, 80)}`);
  }

  res.json({ ok: true });
  const foreground = AGENT_FOREGROUND.has(nextAgent);
  sendToNodeAndWait(node, nextAgent, message, sessionId)
    .then(async r => {
      const raw = typeof r === 'string' ? r : (r != null ? JSON.stringify(r) : '');
      const { status, cleanText } = parseAndStripStatus(raw);

      if (nextAgent === 'Reviewer') {
        broadcastAgentResult(cleanText, 'Reviewer', true);
        if (status !== 'REVIEW_COMPLETE' && status !== 'REVIEW_FAILED') injectReviewerButtons();
      } else if (nextAgent === 'ProjectSetup') {
        const validationMatch = raw.match(/VALIDATION_FAILED:(\S+)/);
        if (validationMatch) {
          const errType = validationMatch[1];
          const errorTexts = {
            'cv_slot_has_jd': 'The file uploaded as your CV looks like a job description. Please re-upload the correct CV.',
            'jd_slot_has_cv': 'The file uploaded as your job description looks like a CV. Please re-upload the correct JD.',
          };
          const errText = errorTexts[errType] ?? 'File validation failed. Please re-upload the correct files.';
          broadcast({ type: 'agent_message', agent: 'ProjectSetup', text: errText });
          broadcast({ type: 'action_required', context: 'validation_failed', prompt: '', actions: [
            { id: 'cv_revalidate_upload', label: 'Re-upload CV', type: 'upload', target: 'cv_raw', variant: 'primary' },
            { id: 'jd_revalidate_upload', label: 'Re-upload JD', type: 'upload', target: 'jd_raw', variant: 'ghost'   },
          ]});
          broadcast({ type: 'stream_done' });
          broadcastMode('user_turn', 'ProjectSetup');
          return; // no status to set
        } else {
          broadcastAgentResult(cleanText, 'ProjectSetup', foreground);
        }
      } else {
        broadcastAgentResult(cleanText, nextAgent, foreground);
      }

      if (status) {
        await state.recipe.globalVariables.setValue('pipeline_status', status);
        state.pipelineStatus = status;
      } else {
        console.warn(`[${nextAgent}] missing pipeline_status tag`);
      }
    })
    .catch(err => console.error(`[${nextAgent}] message error:`, err));
});
