import express from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import { state } from '../lib/state.js';
import { broadcast, broadcastMode, broadcastAgentResult, parseAndStripStatus } from '../lib/broadcast.js';
import { sendToNodeAndWait } from '../lib/node-communication.js';
import { injectReviewerButtons } from '../lib/button-injection.js';
import { ASSEMBLY_PHASES, WORKSPACE_DIR } from '../config/constants.js';
import { syncTADone, checkJoin, checkResearchRedoJoin, fireTAAndAnalyst, dispatchAssemblyPhase, mergePhaseOutput, submitSNAnswers, applyFitScore, runReviewAudit, buildReviewSummary } from '../lib/dispatch.js';
import { classifyGapAnswers } from '../lib/evidence-classifier.js';
import { handlePipelineStatus } from '../lib/pipeline-state.js';

const router = express.Router();
export default router;

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

      // ── SN style interview (single-fire modal) ────────────────────────────
      case 'style_answers_submit': {
        if (state.snState !== 'modal') break; // stale submit — interview already finalized
        const answers = req.body.answers ?? {};
        await submitSNAnswers(answers);
        break;
      }

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

      case 'ic_fix_corrections': {
        // Auto-correct DATES_UNVERIFIED items by re-running History Formatter with corrections
        let dateClaims = [];
        try {
          const cvState = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'cv_assembly_state.json'), 'utf8'));
          dateClaims = (cvState.phases[7]?.data?.unsupported_claims_detail || [])
            .filter(c => c.evidence_status === 'DATES_UNVERIFIED');
        } catch (e) {
          console.error('[ic_fix_corrections] failed to read IC output:', e.message);
        }

        if (dateClaims.length === 0) {
          // Nothing to correct — fall through to gate_continue
          state.pipelineStatus = 'CV_BUILDING';
          try { await state.recipe.globalVariables.setValue('pipeline_status', 'CV_BUILDING'); } catch {}
          broadcast({ type: 'status_changed', status: 'CV_BUILDING' });
          await dispatchAssemblyPhase(state.currentAssemblyPhase + 1);
          break;
        }

        // Build correction message for History Formatter
        const corrections = dateClaims.map(c => `• ${c.claim} → ${c.remediation || 'verify dates'}`).join('\n');
        const reviseMsg = `__revise__: Correct date errors identified by Integrity Checker:\n${corrections}`;

        // Re-dispatch History Formatter (phase 4) with correction
        broadcastMode('auto_running', 'History Formatter');
        broadcast({ type: 'agent_message', agent: 'System', text: `Re-running History Formatter to correct ${dateClaims.length} date issue(s)…` });
        const hfResult = await sendToNodeAndWait(' Message', 'History Formatter', reviseMsg);
        const { cleanText: hfText } = parseAndStripStatus(typeof hfResult === 'string' ? hfResult : JSON.stringify(hfResult ?? ''));
        broadcastAgentResult(hfText, 'History Formatter', true);
        await new Promise(r => setTimeout(r, 1000));
        await mergePhaseOutput(4);

        // Re-run Integrity Checker (phase 8)
        state.currentAssemblyPhase = 8;
        await dispatchAssemblyPhase(8);
        break;
      }

      case 'assembly_restart':
        state.awaitingRevision = null;
        state.snState = null;
        await dispatchAssemblyPhase(2); // restart content phases; SN already complete
        break;

      case 'gap_answers_submit': {
        const rawAnswers = req.body.answers ?? {};
        let gapData;
        try {
          gapData = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'gap_analysis.json'), 'utf8'));
        } catch (e) {
          return res.status(500).json({ error: 'gap_analysis.json not readable' });
        }
        const highGaps = (gapData.gaps ?? []).filter(g => g.severity === 'High');
        const gapAnswers = highGaps.map(g => ({
          gap_id: g.id,
          gap_text: g.gap_text,
          tier: g.tier,
          user_answer: rawAnswers[g.id] || null,
          skipped: !rawAnswers[g.id],
        }));
        broadcastMode('auto_running', 'Reviewer');
        await state.recipe.globalVariables.setValue('pipeline_status', 'GAP_INTERVIEW');
        state.pipelineStatus = 'GAP_INTERVIEW';

        // EVIDENCE/INTENT classification is the one semantic step — delegate non-skipped answers to the
        // LLM classifier (Haiku via OpenRouter). SKIPPED answers never hit the LLM. On any failure the
        // classifier returns INTENT for all, so the audit still runs (conservative, never inflates).
        const toClassify = gapAnswers
          .filter(a => !a.skipped && a.user_answer?.trim())
          .map(a => ({ gap_id: a.gap_id, requirement: a.gap_text, answer: a.user_answer.trim() }));
        if (toClassify.length > 0) {
          try {
            const labels = await classifyGapAnswers(toClassify);
            const byId = new Map(labels.map(l => [l.gap_id, l]));
            for (const a of gapAnswers) {
              const l = byId.get(a.gap_id);
              if (l) { a.evidence_type = l.label; a.evidence_reason = l.reason; }
            }
            console.log(`[gap_answers_submit] classified ${toClassify.length} answer(s):`);
            for (const l of labels) console.log(`  ${l.gap_id}=${l.label} — ${l.reason}`);
          } catch (err) {
            console.error('[gap_answers_submit] classifier error (defaulting INTENT):', err.message);
          }
        }

        // Server-owned forensic audit (mechanical: ingest classified answers + Phases 2-5 + verdict).
        // The LLM Reviewer node is only needed when backable issues remain (Phase 7.5).
        let auditResult;
        try {
          auditResult = runReviewAudit(gapAnswers);
        } catch (err) {
          // Missing/corrupt workspace inputs (gap_analysis/enhanced_jd/candidate_profile). Don't dead-end
          // on a bare 500 — surface it and route to the Main Orchestrator recovery gate (redo analyst, etc.).
          console.error('[gap_answers_submit] runReviewAudit error:', err.message);
          broadcast({ type: 'agent_message', agent: 'System', text: `Could not run the quality review: ${err.message}. Opening recovery options.` });
          await state.recipe.globalVariables.setValue('pipeline_status', 'REVIEW_FAILED');
          state.pipelineStatus = 'REVIEW_FAILED';
          handlePipelineStatus('REVIEW_FAILED').catch(e => console.error('[gap_answers_submit recovery] route error:', e.message));
          return res.json({ ok: false, error: err.message });
        }

        let banner = '';
        try {
          const newScore = applyFitScore(join(WORKSPACE_DIR, 'gap_analysis.json'));
          banner = `**Fit Score: ${newScore}/10**\n\n`;
        } catch (err) {
          console.error('[gap_answers_submit] applyFitScore error:', err.message);
        }

        if (auditResult.backableIssues.length === 0) {
          // No user-resolvable issues — finalize entirely server-side, no LLM call.
          const status = auditResult.audit.overall_verdict === 'APPROVED' ? 'REVIEW_COMPLETE' : 'REVIEW_FAILED';
          broadcastAgentResult(banner + buildReviewSummary(auditResult.audit), 'Reviewer', true);
          await state.recipe.globalVariables.setValue('pipeline_status', status);
          state.pipelineStatus = status;
          // Fire-and-forget: REVIEW_COMPLETE kicks off assembly (SN dispatch) — must not hold the HTTP
          // response open. The 30s recentlyDispatched guard dedups this against the setValue→onChange call.
          handlePipelineStatus(status).catch(err => console.error('[gap_answers_submit finalize] route error:', err.message));
        } else {
          // Backable issues exist — hand off to the Reviewer node for interactive Phase 7.5. Its Phase 0
          // re-invocation guard sees the server-written review_audit.json and resumes at issue resolution.
          console.log(`[gap_answers_submit] ${auditResult.backableIssues.length} backable issue(s) → Reviewer node for Phase 7.5`);
          sendToNodeAndWait('reviewer_input', 'Reviewer', '__resolve__')
            .then(async r => {
              const { cleanText, status } = parseAndStripStatus(typeof r === 'string' ? r : JSON.stringify(r));
              let banner2 = '';
              try { banner2 = `**Fit Score: ${applyFitScore(join(WORKSPACE_DIR, 'gap_analysis.json'))}/10**\n\n`; } catch {}
              broadcastAgentResult(banner2 + cleanText, 'Reviewer', true);
              if (status !== 'REVIEW_COMPLETE' && status !== 'REVIEW_FAILED') injectReviewerButtons();
              if (status) { await state.recipe.globalVariables.setValue('pipeline_status', status); state.pipelineStatus = status; }
            })
            .catch(err => console.error('[Reviewer Phase 7.5] error:', err));
        }
        break;
      }

      case 'reviewer_skip':
        // Phase 7.5 issue resolution skip — "Skip — leave flagged"
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
