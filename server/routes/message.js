import express from 'express';
import { state } from '../lib/state.js';
import { broadcast, broadcastMode, broadcastAgentResult, parseAndStripStatus } from '../lib/broadcast.js';
import { sendToNodeAndWait } from '../lib/node-communication.js';
import { HAPPY_PATH, EXCEPTION_STATUSES, INPUT_NODE_MAP, AGENT_FOREGROUND } from '../config/constants.js';
import { reShowSectionReview, resolveExtractorStatus, resolveAgentStatus, surfaceStall, clearExtractorFailure, writeMODispatch, clearStaleAnalysis, stampTimestamp, runProjectSetup, finishFilesSaved, broadcastSlotGate } from '../lib/dispatch.js';
import { validateDocs } from '../lib/doc-slot-validator.js';

const router = express.Router();
export default router;

const RERUN_RE = /\b(rerun|re-run|redo|re-do|retry|re-try)\b/i;
const RERUN_MAP = [
  { pattern: /extractor/i,           resetStatus: 'FILES_SAVED',       agent: 'Extractor'   },
  { pattern: /researcher|research/i, resetStatus: 'INITIALIZED',       agent: 'Researcher'  },
  { pattern: /jd.?enhancer|jd/i,     resetStatus: 'RESEARCH_COMPLETE', agent: 'JD Enhancer' },
  { pattern: /analyst/i,             resetStatus: 'JD_ENHANCED',       agent: 'Analyst'     },
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
    broadcast({ type: 'agent_message', agent: 'System', text: 'Assembly in progress - please use the action buttons.' });
    return;
  }

  // SN style interview is modal-driven now (single-fire stylist + StyleInterviewModal). Stray chat text
  // while the modal ('modal') is active has nowhere to go — drop it with a hint.
  // Per-dimension preferences and any extra note (with severity) are collected inside the modal.
  if (state.snState) {
    res.json({ ok: true });
    broadcast({ type: 'agent_message', agent: 'System', text: 'Use the style interview cards and buttons to continue.' });
    return;
  }

  // Assembly section revision
  if (state.awaitingRevision) {
    const section = state.awaitingRevision;
    state.awaitingRevision = null;
    res.json({ ok: true });
    broadcastMode('auto_running', section.agent);
    state.retryThunk = () => sendToNodeAndWait(section.inputNode, section.agent, `__revise__: ${message}`)
      .then(async r => {
        const { cleanText } = parseAndStripStatus(typeof r === 'string' ? r : (r != null ? JSON.stringify(r) : ''));
        broadcastAgentResult(cleanText, section.agent, true);
        await new Promise(resolve => setTimeout(resolve, 1000));
        await reShowSectionReview(section.phaseNumber);
      })
      .catch(err => surfaceStall(section.agent, err));
    state.retryThunk();
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
      // Analyst rerun: clear the old gap_analysis.json so its re-invocation guard doesn't bail.
      if (match.agent === 'Analyst') clearStaleAnalysis();
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

  // Happy-path ProjectSetup is server-owned — no KEMU node round-trip. Uploads arrive with explicit
  // cv_raw/jd_raw targets, so there's no ambiguity to resolve. Only fall through to the PS node when files
  // are genuinely missing on disk (legacy MODE B conversation-upload path).
  if (nextAgent === 'ProjectSetup') {
    const psResult = runProjectSetup();
    if (psResult.outcome !== 'files_missing') {
      res.json({ ok: true });
      await finishProjectSetup(psResult);
      return;
    }
    console.warn('[ProjectSetup] no files on disk — falling back to the PS node (MODE B)');
  }

  res.json({ ok: true });
  const foreground = AGENT_FOREGROUND.has(nextAgent);
  if (nextAgent === 'Extractor') clearExtractorFailure();  // fresh failure signal each attempt
  if (nextAgent === 'Main Orchestrator') writeMODispatch(status);  // authoritative status → mo_dispatch.json
  state.retryThunk = () => fireUserMessage(node, nextAgent, message, sessionId, foreground);
  fireUserMessage(node, nextAgent, message, sessionId, foreground);
});

// Fire a user-message dispatch and run the generic completion (parse → advance / stall).
// Extracted so the stall Retry button (state.retryThunk) can re-fire the exact same call.
function fireUserMessage(node, nextAgent, message, sessionId, foreground) {
  sendToNodeAndWait(node, nextAgent, message, sessionId)
    .then(async r => {
      const raw = typeof r === 'string' ? r : (r != null ? JSON.stringify(r) : '');
      let { status, cleanText } = parseAndStripStatus(raw);
      // Deterministic failure gate: Extractor wrote failure_reason but may have dropped
      // the EXTRACTION_FAILED tag — force it rather than retaining a stale prior status.
      if (nextAgent === 'Extractor') status = resolveExtractorStatus(status);

      if (nextAgent === 'ProjectSetup') {
        // Only reached in the MODE B fallback (no files on disk when the message arrived, so the PS node
        // was fired to handle a conversation upload). The happy path is server-owned upstream
        // (runProjectSetup / finishProjectSetup) and never gets here. Stamp created_at at the moment the
        // project is created — not on the FILES_SAVED status, which an Extractor re-run also sets and would
        // rewrite created_at into "last re-ran at".
        stampTimestamp('project_meta.json', 'created_at');
        broadcastAgentResult(cleanText, 'ProjectSetup', foreground);
      } else {
        broadcastAgentResult(cleanText, nextAgent, foreground);
      }

      status = resolveAgentStatus(nextAgent, status);  // #1: infer expected status on dropped tag
      if (status) {
        await state.recipe.globalVariables.setValue('pipeline_status', status);
        state.pipelineStatus = status;
      } else {
        // Non-linear agent (e.g. Main Orchestrator conversational reply) — no status change expected. Benign.
        console.warn(`[${nextAgent}] missing pipeline_status tag`);
      }
    })
    .catch(err => surfaceStall(nextAgent, err));
}

// Emit the result of the server-owned happy-path ProjectSetup (runProjectSetup). The ProjectSetup agent
// (validateDocs, an LLM call) vets both uploads on every new project: is each a usable CV/JD, in the right
// slot? A problem surfaces a NON-blocking notice (broadcastSlotGate) that still offers "Continue anyway";
// a clean verdict (or a fail-open LLM error) proceeds to completion.
async function finishProjectSetup(result) {
  if (result.outcome === 'files_present') {
    broadcastMode('auto_running', 'ProjectSetup'); // the agent vet can take a few seconds — show it working
    const verdict = await validateDocs(); // { ok, problem } — fail-open to { ok: true }
    if (!verdict.ok) {
      console.log(`[ProjectSetup] agent flagged documents: ${verdict.problem}`);
      broadcastSlotGate(verdict.problem);
      return;
    }
  }
  await finishFilesSaved();
}
