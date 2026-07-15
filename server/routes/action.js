import express from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import { state } from '../lib/state.js';
import { broadcast, broadcastMode, broadcastAgentResult, parseAndStripStatus } from '../lib/broadcast.js';
import { sendToNodeAndWait } from '../lib/node-communication.js';
import { ASSEMBLY_PHASES, WORKSPACE_DIR } from '../config/constants.js';
import { syncTADone, checkJoin, fireTAAndAnalyst, clearStaleAnalysis, dispatchAssemblyPhase, mergePhaseOutput, submitSNAnswers, applyFitScore, runReviewAudit, buildReviewSummary, runLinearDispatch, surfaceStall, reShowSectionReview, broadcastAssemblySectionResult, resumeAssembly, runIcRemediation, broadcastDocument } from '../lib/dispatch.js';
import { adjudicateGapAnswers } from '../lib/adjudicator.js';
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
        state.retryThunk = fireTAAndAnalyst;  // stall recovery re-runs the analysis
        sendToNodeAndWait('analyst_background_input', null, '__analyze__', 'default', { logLabel: 'Analyst' })
          .then(async r => {
            const { cleanText } = parseAndStripStatus(typeof r === 'string' ? r : JSON.stringify(r));
            broadcastAgentResult(cleanText, 'Analyst', false);
            state.analystDone = true; syncTADone(); await checkJoin();
          })
          .catch(err => surfaceStall('Analyst', err));
        break;

      case 'research_redo':
        broadcast({ type: 'agent_message', agent: 'System', text: 'Re-running research…' });
        state.recentlyDispatched.delete('RESEARCH_REDO');  // a user click must never hit the 30s dedupe
        await handlePipelineStatus('RESEARCH_REDO');
        break;

      case 'redo_analyst': {
        broadcast({ type: 'agent_message', agent: 'System', text: 'Re-running gap analysis…' });
        broadcastMode('auto_running', 'Analyst');
        clearStaleAnalysis();  // else the Analyst's re-invocation guard sees the old file and bails
        state.pipelineStatus = 'JD_ENHANCED';
        state.analystDone = false;
        syncTADone();
        state.retryThunk = fireTAAndAnalyst;  // stall recovery re-runs the analysis
        sendToNodeAndWait('analyst_background_input', null, '__analyze__', 'default', { logLabel: 'Analyst' })
          .then(async r => {
            const { cleanText } = parseAndStripStatus(typeof r === 'string' ? r : JSON.stringify(r));
            broadcastAgentResult(cleanText, 'Analyst', false);
            state.analystDone = true; syncTADone(); await checkJoin();
          })
          .catch(err => surfaceStall('Analyst', err));
        break;
      }

      case 'redo_researcher':
        broadcast({ type: 'agent_message', agent: 'System', text: 'Re-running research…' });
        state.pipelineStatus = 'INITIALIZED';
        runLinearDispatch({ node: 'researcher_input', agent: 'Researcher', query: '__redo__' });
        break;

      case 'redo_jd_enhancer':
        broadcast({ type: 'agent_message', agent: 'System', text: 'Re-running JD enhancement…' });
        state.pipelineStatus = 'RESEARCH_COMPLETE';
        runLinearDispatch({ node: 'jd_enhancer_input', agent: 'JD Enhancer' });
        break;

      case 'research_pre_confirm':
        broadcast({ type: 'agent_message', agent: 'System', text: 'Research confirmed — running JD enhancement…' });
        state.pipelineStatus = 'RESEARCH_COMPLETE';
        runLinearDispatch({ node: 'jd_enhancer_input', agent: 'JD Enhancer' });
        break;

      case 'research_pre_redo':
        broadcast({ type: 'agent_message', agent: 'System', text: 'Re-running research…' });
        state.pipelineStatus = 'INITIALIZED';
        runLinearDispatch({ node: 'researcher_input', agent: 'Researcher', query: '__redo__' });
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
          .catch(err => surfaceStall('Main Orchestrator', err));
        break;

      case 'research_retry':
        broadcast({ type: 'agent_message', agent: 'System', text: 'Retrying research…' });
        state.pipelineStatus = 'INITIALIZED';
        runLinearDispatch({ node: 'researcher_input', agent: 'Researcher', query: '__redo__' });
        break;

      case 'research_skip':
        broadcast({ type: 'agent_message', agent: 'System', text: 'Skipping research — continuing with available data…' });
        await handlePipelineStatus('RESEARCH_COMPLETE');
        break;

      case 'analysis_retry': {
        broadcast({ type: 'agent_message', agent: 'System', text: 'Retrying gap analysis…' });
        broadcastMode('auto_running', 'Analyst');
        clearStaleAnalysis();  // else the Analyst's re-invocation guard sees the old file and bails
        state.pipelineStatus = 'JD_ENHANCED';
        state.analystDone = false;
        syncTADone();
        state.retryThunk = fireTAAndAnalyst;  // stall recovery re-runs the analysis
        sendToNodeAndWait('analyst_background_input', null, '__analyze__', 'default', { logLabel: 'Analyst' })
          .then(async r => {
            const { cleanText } = parseAndStripStatus(typeof r === 'string' ? r : JSON.stringify(r));
            broadcastAgentResult(cleanText, 'Analyst', false);
            state.analystDone = true; syncTADone(); await checkJoin();
          })
          .catch(err => surfaceStall('Analyst', err));
        break;
      }

      case 'analysis_redo_researcher':
        broadcast({ type: 'agent_message', agent: 'System', text: 'Re-running research before retrying analysis…' });
        state.pipelineStatus = 'INITIALIZED';
        runLinearDispatch({ node: 'researcher_input', agent: 'Researcher', query: '__redo__' });
        break;

      case 'ac_proceed':
        broadcastMode('auto_running', 'Assembly Coordinator');
        sendToNodeAndWait('assembly_coordinator_input', 'Assembly Coordinator', 'proceed')
          .then(async r => {
            const { cleanText, status } = parseAndStripStatus(typeof r === 'string' ? r : JSON.stringify(r));
            broadcastAgentResult(cleanText, 'Assembly Coordinator', true);
            if (status) { await state.recipe.globalVariables.setValue('pipeline_status', status); state.pipelineStatus = status; }
          })
          .catch(err => surfaceStall('Assembly Coordinator', err));
        break;

      case 'ac_redo':
        broadcastMode('auto_running', 'Main Orchestrator');
        sendToNodeAndWait(' Message', 'Main Orchestrator', 'redo')
          .then(async r => {
            const { cleanText, status } = parseAndStripStatus(typeof r === 'string' ? r : JSON.stringify(r));
            broadcastAgentResult(cleanText, 'Main Orchestrator', true);
            if (status) { await state.recipe.globalVariables.setValue('pipeline_status', status); state.pipelineStatus = status; }
          })
          .catch(err => surfaceStall('Main Orchestrator', err));
        break;

      // ── SN style interview (single-fire modal) ────────────────────────────
      case 'style_answers_submit': {
        if (state.snState !== 'modal') break; // stale submit — interview already finalized
        const answers = req.body.answers ?? {};
        await submitSNAnswers(answers);
        break;
      }

      // ── Stall recovery (#2) ───────────────────────────────────────────────
      case 'retry_last_dispatch':
        if (typeof state.retryThunk === 'function') {
          broadcast({ type: 'agent_message', agent: 'System', text: 'Retrying…' });
          Promise.resolve(state.retryThunk()).catch(err => surfaceStall('Retry', err));
        } else {
          broadcast({ type: 'agent_message', agent: 'System', text: 'Nothing to retry.' });
        }
        break;

      // ── Assembly section review actions ───────────────────────────────────
      case 'assembly_approve':
        await dispatchAssemblyPhase(state.currentAssemblyPhase + 1);
        break;

      case 'resume_section_review':
        // F5/reconnect safety net: re-emit the current section content + Approve/Revise from state.
        await resumeAssembly();
        break;

      case 'assembly_revise': {
        const phase = ASSEMBLY_PHASES[state.currentAssemblyPhase];
        if (!phase) break;
        state.awaitingSectionReview = null;
        state.awaitingRevision = {
          agent:       phase.agent,
          inputNode:   phase.inputNode,
          outputFile:  phase.outputFile,
          phaseNumber: state.currentAssemblyPhase,
        };
        // Modal-driven: signal the client to open the revision popup. We stay in action_required
        // (chat stays disabled) so the revise instruction comes through the modal, consistent with
        // the gap/style interviews rather than free text in the chat box.
        broadcast({ type: 'assembly_revise_start', agent: phase.agent });
        break;
      }

      case 'assembly_revise_submit': {
        const section = state.awaitingRevision;
        if (!section) break;
        const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
        if (!text) break;
        state.awaitingRevision = null;
        res.json({ ok: true });
        broadcastMode('auto_running', section.agent);
        state.retryThunk = () => sendToNodeAndWait(section.inputNode, section.agent, `__revise__: ${text}`)
          .then(async r => {
            const { cleanText } = parseAndStripStatus(typeof r === 'string' ? r : (r != null ? JSON.stringify(r) : ''));
            broadcastAssemblySectionResult(cleanText, section.agent);
            await new Promise(resolve => setTimeout(resolve, 1000));
            await reShowSectionReview(section.phaseNumber);
          })
          .catch(err => surfaceStall(section.agent, err));
        state.retryThunk();
        return;
      }

      case 'assembly_revise_cancel':
        // The client keeps the original Approve/Revise bubble live (it was never greyed on the
        // Revise click), so cancelling just drops the parked revision context — no re-broadcast,
        // which previously produced a duplicate review bubble.
        state.awaitingRevision = null;
        break;

      case 'gate_continue':
        state.icReview = null;
        state.icRemediationRound = 0;
        state.pipelineStatus = 'CV_BUILDING';
        try { await state.recipe.globalVariables.setValue('pipeline_status', 'CV_BUILDING'); } catch {}
        broadcast({ type: 'status_changed', status: 'CV_BUILDING' });
        await dispatchAssemblyPhase(state.currentAssemblyPhase + 1);
        break;

      case 'ic_remediation_submit': {
        // The integrity-review modal returns per-claim decisions. Trust server state for the claims
        // themselves (state.icReview), the client only sends the chosen action + any evidence text.
        if (!state.icReview?.claims?.length) {
          return res.json({ ok: false, error: 'no pending integrity review' });
        }
        res.json({ ok: true }); // ack before the (possibly long) re-validation runs
        runIcRemediation(req.body.decisions ?? {}).catch(err =>
          console.error('[ic_remediation_submit] route error:', err.message));
        return;
      }

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
        const hfResult = await sendToNodeAndWait(ASSEMBLY_PHASES[4].inputNode, 'History Formatter', reviseMsg);
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
        const GAP_ROUND_CAP = 2;
        const rawAnswers = req.body.answers ?? {};
        let gapData;
        try {
          gapData = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'gap_analysis.json'), 'utf8'));
        } catch (e) {
          return res.status(500).json({ error: 'gap_analysis.json not readable' });
        }

        const round = state.gapRound ?? 1;
        if (round === 1) { state.gapAnswersAccum = {}; } // first pass — start clean
        const accum = state.gapAnswersAccum ?? (state.gapAnswersAccum = {});

        // Which gaps were asked THIS round? Round 1 = all High gaps; round ≥2 = only the pending cards.
        const askedGaps = round === 1
          ? (gapData.gaps ?? []).filter(g => g.severity === 'High' || g.severity === 'Medium').map(g => ({ id: g.id, gap_text: g.gap_text, tier: g.tier, is_structural: !!g.is_structural }))
          : (state.gapPending ?? []).map(g => ({ id: g.id, gap_text: g.gap_text, tier: g.tier, is_structural: !!g.is_structural }));

        broadcastMode('auto_running', 'Analysis'); // "Adjudicating…" banner while the LLM runs
        await state.recipe.globalVariables.setValue('pipeline_status', 'GAP_INTERVIEW');
        state.pipelineStatus = 'GAP_INTERVIEW';

        // Adjudicate this round's non-skipped answers in one batched LLM call. SKIPPED answers never hit
        // the LLM and are terminal (the gap stays open — keep skip semantics, no re-ask). On any failure
        // the adjudicator returns NOT_EVIDENCE for all (fail-closed — never inflates a gap to Met).
        const toJudge = askedGaps
          .filter(g => rawAnswers[g.id]?.trim())
          .map(g => ({ gap_id: g.id, requirement: g.gap_text, answer: rawAnswers[g.id].trim(), tier: g.tier, is_structural: g.is_structural }));
        let verdictsById = new Map();
        if (toJudge.length > 0) {
          try {
            const verdicts = await adjudicateGapAnswers(toJudge);
            verdictsById = new Map(verdicts.map(v => [v.gap_id, v]));
            console.log(`[gap_answers_submit round ${round}] adjudicated ${toJudge.length} answer(s):`);
            for (const v of verdicts) console.log(`  ${v.gap_id}=${v.verdict} — ${v.reason}`);
          } catch (err) {
            console.error('[gap_answers_submit] adjudicator error (defaulting NOT_EVIDENCE):', err.message);
          }
        }

        // Merge this round's outcomes into the accumulator (keyed by gap_id, survives across rounds).
        for (const g of askedGaps) {
          const answer = rawAnswers[g.id]?.trim();
          if (!answer) {
            accum[g.id] = { gap_id: g.id, gap_text: g.gap_text, tier: g.tier, skipped: true, verdict: 'SKIPPED' };
            continue;
          }
          const v = verdictsById.get(g.id) ?? { verdict: 'NOT_EVIDENCE', reason: 'adjudicator_missing', anchor_prompt: '' };
          accum[g.id] = {
            gap_id: g.id, gap_text: g.gap_text, tier: g.tier, skipped: false,
            user_answer: answer, verdict: v.verdict, reason: v.reason, anchor_prompt: v.anchor_prompt,
          };
        }

        // Addressed = full credit (ACCEPTED) or structural partial-mitigation (ACCEPTED_MITIGATED); both
        // are terminal and never re-asked. Pending = answered but not addressed (skipped is also terminal).
        const isAddressed = v => v === 'ACCEPTED' || v === 'ACCEPTED_MITIGATED';
        const pending = Object.values(accum).filter(a => !a.skipped && !isAddressed(a.verdict));
        const accepted = Object.values(accum).filter(a => isAddressed(a.verdict));

        // More to try AND under the round cap → re-ask only the non-addressed, with an ack strip for the rest.
        if (round < GAP_ROUND_CAP && pending.length > 0) {
          state.gapRound = round + 1;
          state.gapAccepted = accepted.map(a => ({ gap_text: a.gap_text, evidence: a.user_answer, mitigated: a.verdict === 'ACCEPTED_MITIGATED' }));
          state.gapPending = pending.map(a => ({
            id: a.gap_id, gap_text: a.gap_text, tier: a.tier,
            adjudication: a.verdict,
            // What the user sees as the ask: the anchor question if any, else the rejection reason.
            mitigation_strategy: a.anchor_prompt || a.reason || 'Please provide more specific evidence for this requirement.',
          }));
          console.log(`[gap_answers_submit] round ${round} done — re-asking ${pending.length}, accepted ${accepted.length}`);
          broadcast({ type: 'gap_interview_start', round: state.gapRound, accepted: state.gapAccepted, gaps: state.gapPending });
          broadcastMode('action_required');
          return res.json({ ok: true, round: state.gapRound, pending: pending.length, accepted: accepted.length });
        }

        // Finalize: ingest the full accumulated set (accepted grant credit, the rest stay gaps), then
        // run the server-owned forensic audit + fit score. The LLM Reviewer node is only needed when
        // backable issues remain (Phase 7.5).
        const finalAnswers = Object.values(accum).map(a => ({
          gap_id: a.gap_id, gap_text: a.gap_text, tier: a.tier,
          user_answer: a.user_answer ?? null, skipped: !!a.skipped,
          verdict: a.verdict, adjudication_reason: a.reason, anchor_prompt: a.anchor_prompt,
        }));

        let auditResult;
        try {
          auditResult = runReviewAudit(finalAnswers);
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

        // Acknowledge what the user's answers achieved before the quality check, so the jump to the fit
        // summary doesn't feel abrupt (a round-1 ACCEPTED used to finalize instantly with no feedback).
        const answered = Object.values(accum).filter(a => !a.skipped);
        if (answered.length) {
          const full = answered.filter(a => a.verdict === 'ACCEPTED').length;
          const mit  = answered.filter(a => a.verdict === 'ACCEPTED_MITIGATED').length;
          const open = answered.filter(a => a.verdict !== 'ACCEPTED' && a.verdict !== 'ACCEPTED_MITIGATED').length;
          const bits = [];
          if (full) bits.push(`added ${full} backed point${full === 1 ? '' : 's'} to your CV`);
          if (mit)  bits.push(`strengthened your position on ${mit} requirement${mit === 1 ? '' : 's'} we can't fully close`);
          if (open) bits.push(`couldn't fully evidence ${open} — we'll frame ${open === 1 ? 'it' : 'them'} honestly`);
          if (bits.length) {
            broadcast({ type: 'agent_message', agent: 'System', text: `Thanks — ${bits.join(', ')}.` });
            await new Promise(r => setTimeout(r, 600));
          }
        }

        const status = auditResult.audit.overall_verdict === 'APPROVED' ? 'REVIEW_COMPLETE' : 'REVIEW_FAILED';
        broadcastAgentResult(banner + buildReviewSummary(auditResult.audit), 'Analysis', true);
        await state.recipe.globalVariables.setValue('pipeline_status', status);
        state.pipelineStatus = status;
        // Fire-and-forget: REVIEW_COMPLETE kicks off assembly (SN dispatch) — must not hold the HTTP
        // response open. The 30s recentlyDispatched guard dedups this against the setValue→onChange call.
        handlePipelineStatus(status).catch(err => console.error('[gap_answers_submit finalize] route error:', err.message));
        break;
      }

      // ── Completion screen (CV_TAILORED) ──────────────────────────────────
      case 'view_cv':
        broadcastDocument('cv');
        break;

      case 'view_cover_letter':
        broadcastDocument('cover');
        break;

      case 'review_audit': {
        // Re-surface the quality-review summary from the finalized audit on disk.
        try {
          const audit = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'review_audit.json'), 'utf8'));
          if (audit && Object.keys(audit).length) {
            broadcastAgentResult(buildReviewSummary(audit), 'Analysis', true);
          } else {
            broadcast({ type: 'agent_message', agent: 'System', text: 'No quality review is available for this application.', background: false });
          }
        } catch {
          broadcast({ type: 'agent_message', agent: 'System', text: 'No quality review is available for this application.', background: false });
        }
        break;
      }

      // The analysis + change history already live in the conversation above; point the user there
      // rather than re-running anything. (Full re-surface is a follow-up.)
      case 'review_analysis':
      case 'review_changes':
        broadcast({ type: 'agent_message', agent: 'System', text: 'Scroll up to the analysis and section steps to review the details.', background: false });
        break;

      // CompletionBubble "Download both" — PDF export isn't wired yet; the per-document Copy/Download
      // in the preview works today. Point there instead of failing silently.
      case 'download':
        broadcast({ type: 'agent_message', agent: 'System', text: 'Open “View CV” or “View cover letter”, then use Copy or .pdf on the preview.', background: false });
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
