import express from 'express';
import { state } from '../lib/state.js';
import { broadcast, broadcastMode, broadcastAgentResult, parseAndStripStatus } from '../lib/broadcast.js';
import { sendToNodeAndWait } from '../lib/node-communication.js';
import { injectReviewerButtons } from '../lib/button-injection.js';
import { ASSEMBLY_PHASES } from '../config/constants.js';
import { syncTADone, checkJoin, checkResearchRedoJoin, fireTAAndAnalyst, dispatchAssemblyPhase, sendToSN } from '../lib/dispatch.js';
import { handlePipelineStatus } from '../lib/pipeline-state.js';

const router = express.Router();
export default router;

function _reshowSNContinue() {
  broadcast({ type: 'action_required', context: 'sn_summary', actions: [
    { id: 'sn_continue', label: 'Continue → Build CV', variant: 'primary' },
  ]});
  broadcastMode('action_required');
}

router.post('/', async (req, res) => {
  const { id } = req.body;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'id required' });
  }
  if (!state.recipe) {
    return res.status(503).json({ error: 'Recipe not ready' });
  }

  try {
    switch (id) {
      case 'research_confirm':
        broadcast({ type: 'agent_message', agent: 'System', text: 'Research confirmed — running gap analysis…' });
        broadcastMode('auto_running', 'Analyst');
        await state.recipe.globalVariables.setValue('research_confirmed', 1);
        await state.recipe.globalVariables.setValue('pipeline_status', 'PARALLEL_ANALYSIS');
        state.pipelineStatus = 'PARALLEL_ANALYSIS';
        state.analystDone = false;
        sendToNodeAndWait('analyst_background_input', null, '__analyze__')
          .then(async r => {
            const { cleanText } = parseAndStripStatus(typeof r === 'string' ? r : JSON.stringify(r));
            broadcastAgentResult(cleanText, 'Analyst', false);
            state.analystDone = true; syncTADone(); await checkJoin();
          })
          .catch(err => console.error('[Analyst confirm] error:', err));
        break;

      case 'research_redo':
        broadcast({ type: 'agent_message', agent: 'System', text: 'Re-running research…' });
        broadcastMode('auto_running', 'Researcher');
        await state.recipe.globalVariables.setValue('pipeline_status', 'PARALLEL_ANALYSIS');
        state.pipelineStatus = 'PARALLEL_ANALYSIS';
        sendToNodeAndWait('researcher_input', 'Researcher', '__redo__')
          .then(async r => {
            const { cleanText, status } = parseAndStripStatus(typeof r === 'string' ? r : JSON.stringify(r));
            broadcastAgentResult(cleanText, 'Researcher', true);
            if (status) { await state.recipe.globalVariables.setValue('pipeline_status', status); state.pipelineStatus = status; }
            else console.warn('[Researcher redo] missing pipeline_status tag');
            checkResearchRedoJoin();
          })
          .catch(err => console.error('[Researcher redo action] error:', err));
        break;

      case 'redo_analyst': {
        broadcast({ type: 'agent_message', agent: 'System', text: 'Re-running gap analysis…' });
        broadcastMode('auto_running', 'Analyst');
        state.pipelineStatus = 'JD_ENHANCED';
        state.analystDone = false;
        syncTADone();
        sendToNodeAndWait('analyst_background_input', null, '__analyze__')
          .then(async r => {
            const { cleanText } = parseAndStripStatus(typeof r === 'string' ? r : JSON.stringify(r));
            broadcastAgentResult(cleanText, 'Analyst', false);
            state.analystDone = true; syncTADone(); await checkJoin();
          })
          .catch(err => console.error('[Analyst redo action] error:', err));
        break;
      }

      case 'redo_researcher':
        broadcast({ type: 'agent_message', agent: 'System', text: 'Re-running research…' });
        broadcastMode('auto_running', 'Researcher');
        state.pipelineStatus = 'INITIALIZED';
        sendToNodeAndWait('researcher_input', 'Researcher', '__redo__')
          .then(async r => {
            const { cleanText, status } = parseAndStripStatus(typeof r === 'string' ? r : JSON.stringify(r));
            broadcastAgentResult(cleanText, 'Researcher', true);
            if (status) { await state.recipe.globalVariables.setValue('pipeline_status', status); state.pipelineStatus = status; }
            else console.warn('[Researcher redo_researcher] missing pipeline_status tag');
          })
          .catch(err => console.error('[Researcher redo action] error:', err));
        break;

      case 'redo_jd_enhancer':
        broadcast({ type: 'agent_message', agent: 'System', text: 'Re-running JD enhancement…' });
        broadcastMode('auto_running', 'JD Enhancer');
        state.pipelineStatus = 'RESEARCH_COMPLETE';
        sendToNodeAndWait('jd_enhancer_input', 'JD Enhancer')
          .then(async r => {
            const { cleanText, status } = parseAndStripStatus(typeof r === 'string' ? r : JSON.stringify(r));
            broadcastAgentResult(cleanText, 'JD Enhancer', false);
            if (status) { await state.recipe.globalVariables.setValue('pipeline_status', status); state.pipelineStatus = status; }
            else console.warn('[JD Enhancer] missing pipeline_status tag');
          })
          .catch(err => console.error('[JD Enhancer redo action] error:', err));
        break;

      case 'research_pre_confirm':
        broadcast({ type: 'agent_message', agent: 'System', text: 'Research confirmed — running JD enhancement…' });
        broadcastMode('auto_running', 'JD Enhancer');
        state.pipelineStatus = 'RESEARCH_COMPLETE';
        sendToNodeAndWait('jd_enhancer_input', 'JD Enhancer')
          .then(async r => {
            const { cleanText, status } = parseAndStripStatus(typeof r === 'string' ? r : JSON.stringify(r));
            broadcastAgentResult(cleanText, 'JD Enhancer', false);
            if (status) { await state.recipe.globalVariables.setValue('pipeline_status', status); state.pipelineStatus = status; }
            else console.warn('[JD Enhancer] missing pipeline_status tag');
          })
          .catch(err => console.error('[JD Enhancer pre-confirm] error:', err));
        break;

      case 'research_pre_redo':
        broadcast({ type: 'agent_message', agent: 'System', text: 'Re-running research…' });
        broadcastMode('auto_running', 'Researcher');
        state.pipelineStatus = 'INITIALIZED';
        sendToNodeAndWait('researcher_input', 'Researcher', '__redo__')
          .then(async r => {
            const { cleanText, status } = parseAndStripStatus(typeof r === 'string' ? r : JSON.stringify(r));
            broadcastAgentResult(cleanText, 'Researcher', true);
            if (status) { await state.recipe.globalVariables.setValue('pipeline_status', status); state.pipelineStatus = status; }
            else console.warn('[Researcher pre-redo] missing pipeline_status tag');
          })
          .catch(err => console.error('[Researcher pre-redo] error:', err));
        break;

      case 'research_partial_proceed':
        broadcast({ type: 'agent_message', agent: 'System', text: 'Proceeding with partial research…' });
        await handlePipelineStatus('RESEARCH_COMPLETE');
        break;

      case 'accept_anyway':
        broadcast({ type: 'agent_message', agent: 'System', text: 'Proceeding with current analysis…' });
        await handlePipelineStatus('REVIEW_COMPLETE');
        break;

      case 'details':
        broadcastMode('auto_running', 'Main Orchestrator');
        sendToNodeAndWait(' Message', 'Main Orchestrator', 'details')
          .then(async r => {
            const { cleanText, status } = parseAndStripStatus(typeof r === 'string' ? r : JSON.stringify(r));
            broadcastAgentResult(cleanText, 'Main Orchestrator', true);
            if (status) { await state.recipe.globalVariables.setValue('pipeline_status', status); state.pipelineStatus = status; }
          })
          .catch(err => console.error('[MO details action] error:', err));
        break;

      case 'research_retry':
        broadcast({ type: 'agent_message', agent: 'System', text: 'Retrying research…' });
        broadcastMode('auto_running', 'Researcher');
        state.pipelineStatus = 'INITIALIZED';
        sendToNodeAndWait('researcher_input', 'Researcher', '__redo__')
          .then(async r => {
            const { cleanText, status } = parseAndStripStatus(typeof r === 'string' ? r : JSON.stringify(r));
            broadcastAgentResult(cleanText, 'Researcher', true);
            if (status) { await state.recipe.globalVariables.setValue('pipeline_status', status); state.pipelineStatus = status; }
            else console.warn('[Researcher retry] missing pipeline_status tag');
          })
          .catch(err => console.error('[Researcher retry action] error:', err));
        break;

      case 'research_skip':
        broadcast({ type: 'agent_message', agent: 'System', text: 'Skipping research — continuing with available data…' });
        await handlePipelineStatus('RESEARCH_COMPLETE');
        break;

      case 'analysis_retry': {
        broadcast({ type: 'agent_message', agent: 'System', text: 'Retrying gap analysis…' });
        broadcastMode('auto_running', 'Analyst');
        state.pipelineStatus = 'JD_ENHANCED';
        state.analystDone = false;
        syncTADone();
        sendToNodeAndWait('analyst_background_input', null, '__analyze__')
          .then(async r => {
            const { cleanText } = parseAndStripStatus(typeof r === 'string' ? r : JSON.stringify(r));
            broadcastAgentResult(cleanText, 'Analyst', false);
            state.analystDone = true; syncTADone(); await checkJoin();
          })
          .catch(err => console.error('[Analyst retry action] error:', err));
        break;
      }

      case 'analysis_redo_researcher':
        broadcast({ type: 'agent_message', agent: 'System', text: 'Re-running research before retrying analysis…' });
        broadcastMode('auto_running', 'Researcher');
        state.pipelineStatus = 'INITIALIZED';
        sendToNodeAndWait('researcher_input', 'Researcher', '__redo__')
          .then(async r => {
            const { cleanText, status } = parseAndStripStatus(typeof r === 'string' ? r : JSON.stringify(r));
            broadcastAgentResult(cleanText, 'Researcher', true);
            if (status) { await state.recipe.globalVariables.setValue('pipeline_status', status); state.pipelineStatus = status; }
            else console.warn('[Researcher analysis_redo] missing pipeline_status tag');
          })
          .catch(err => console.error('[Researcher for analysis action] error:', err));
        break;

      case 'ac_proceed':
        broadcastMode('auto_running', 'Assembly Coordinator');
        sendToNodeAndWait('assembly_coordinator_input', 'Assembly Coordinator', 'proceed')
          .then(async r => {
            const { cleanText, status } = parseAndStripStatus(typeof r === 'string' ? r : JSON.stringify(r));
            broadcastAgentResult(cleanText, 'Assembly Coordinator', true);
            if (status) { await state.recipe.globalVariables.setValue('pipeline_status', status); state.pipelineStatus = status; }
          })
          .catch(err => console.error('[AC proceed action] error:', err));
        break;

      case 'ac_redo':
        broadcastMode('auto_running', 'Main Orchestrator');
        sendToNodeAndWait(' Message', 'Main Orchestrator', 'redo')
          .then(async r => {
            const { cleanText, status } = parseAndStripStatus(typeof r === 'string' ? r : JSON.stringify(r));
            broadcastAgentResult(cleanText, 'Main Orchestrator', true);
            if (status) { await state.recipe.globalVariables.setValue('pipeline_status', status); state.pipelineStatus = status; }
          })
          .catch(err => console.error('[AC redo action] error:', err));
        break;

      // ── SN interview actions ──────────────────────────────────────────────
      case 'sn_recommended':
        if (state.snState === 'summary') { _reshowSNContinue(); break; }
        state.snState = 'interviewing';
        await sendToSN('__choice__: recommended');
        break;

      case 'sn_keep':
        if (state.snState === 'summary') { _reshowSNContinue(); break; }
        state.snState = 'interviewing';
        await sendToSN('__choice__: keep_current');
        break;

      case 'sn_customise':
        if (state.snState === 'summary') { _reshowSNContinue(); break; }
        state.snState = 'customise_text';
        broadcastMode('user_turn');
        broadcast({ type: 'agent_message', agent: 'System', text: 'Describe your preference for this style dimension:' });
        break;

      case 'sn_confirm':
        if (state.snState === 'summary') { _reshowSNContinue(); break; }
        state.snState = 'interviewing';
        await sendToSN('__confirm__');
        break;

      case 'sn_rephrase':
        state.snState = 'customise_text';
        broadcastMode('user_turn');
        broadcast({ type: 'agent_message', agent: 'System', text: 'Please rephrase your preference:' });
        break;

      case 'sn_continue':
        state.snState = null;
        await dispatchAssemblyPhase(2);
        break;

      // ── Assembly section review actions ───────────────────────────────────
      case 'assembly_approve':
        await dispatchAssemblyPhase(state.currentAssemblyPhase + 1);
        break;

      case 'assembly_revise': {
        const phase = ASSEMBLY_PHASES[state.currentAssemblyPhase];
        if (!phase) break;
        state.awaitingRevision = {
          agent:       phase.agent,
          inputNode:   phase.inputNode,
          outputFile:  phase.outputFile,
          phaseNumber: state.currentAssemblyPhase,
        };
        broadcastMode('user_turn');
        broadcast({ type: 'agent_message', agent: 'System',
          text: `What would you like changed in the **${phase.agent}** section?` });
        break;
      }

      case 'gate_continue':
        state.pipelineStatus = 'CV_BUILDING';
        try { await state.recipe.globalVariables.setValue('pipeline_status', 'CV_BUILDING'); } catch {}
        broadcast({ type: 'status_changed', status: 'CV_BUILDING' });
        await dispatchAssemblyPhase(state.currentAssemblyPhase + 1);
        break;

      case 'assembly_restart':
        state.awaitingRevision = null;
        state.snState = null;
        await dispatchAssemblyPhase(2); // restart content phases; SN already complete
        break;

      case 'reviewer_skip':
        broadcastMode('auto_running', 'Reviewer');
        sendToNodeAndWait('reviewer_input', 'Reviewer', 'skip')
          .then(async r => {
            const { cleanText, status } = parseAndStripStatus(typeof r === 'string' ? r : JSON.stringify(r));
            broadcastAgentResult(cleanText, 'Reviewer', true);
            injectReviewerButtons();
            if (status) { await state.recipe.globalVariables.setValue('pipeline_status', status); state.pipelineStatus = status; }
          })
          .catch(err => console.error('[Reviewer skip action] error:', err));
        break;

      case 'cl_skip':
      case 'ta_upload_cover':
        if (state.pendingTADispatch) {
          state.pendingTADispatch = false;
          broadcastMode('auto_running', 'Analysis');
          fireTAAndAnalyst();
        }
        break;


      default:
        return res.status(400).json({ error: `unknown action: ${id}` });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[action] error:', err);
    res.status(500).json({ error: err.message });
  }
});
