import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  WORKSPACE_DIR, INPUT_NODE_MAP, HAPPY_PATH,
  EXCEPTION_STATUSES, AUTO_FIRE_STATUSES, AGENT_FOREGROUND, EXCEPTION_ACTION_BUTTONS,
} from '../config/constants.js';
import { state } from './state.js';
import { broadcast, broadcastMode, broadcastAgentResult, parseAndStripStatus } from './broadcast.js';
import { sendToNodeAndWait } from './node-communication.js';
import { syncTADone, checkJoin, checkResearchRedoJoin, dispatchAssemblyPhase, resumeAssembly, fireTAAndAnalyst, stampTimestamp, resolveExtractorStatus, resolveAgentStatus, surfaceStall, clearExtractorFailure, writeMODispatch } from './dispatch.js';

export async function handlePipelineStatus(status, { resume = false } = {}) {
  if (!status) return;
  // The (not-yet-deprecated) KEMU Style Reviewer / Integrity Checker still emit
  // set_status('STYLE_FAILED'|'INTEGRITY_FAILED'), which leaks into the global pipeline_status
  // var and trips the top-level EXCEPTION_STATUSES → Main Orchestrator → ProjectSetup restart
  // (TC05 OBS-TC05-10). But assembly is server-owned: dispatchAssemblyPhase's advisory SR /
  // IC gates already own these decisions inline. Ignore the leaked status while an assembly
  // phase is active — mirrors the AgentSelector onChange ProjectSetup guard (recipe-init.js).
  if (!resume && state.currentAssemblyPhase > 0 &&
      (status === 'STYLE_FAILED' || status === 'INTEGRITY_FAILED')) {
    console.log(`[Status] ${status} ignored — assembly phase ${state.currentAssemblyPhase} owns the gate`);
    return;
  }
  if (!resume) {
    const last = state.recentlyDispatched.get(status);
    if (last && Date.now() - last < 30_000) {
      console.log(`[Status] ${status} already dispatched ${Date.now() - last}ms ago — skip`);
      return;
    }
    state.recentlyDispatched.set(status, Date.now());
  }
  console.log(`◆ STATUS   ${status}${resume ? ' (resume)' : ''}`);
  broadcast({ type: 'status_changed', status });
  if (!resume) state.pipelineStatus = status;

  if (resume) {
    if (status === 'JD_ENHANCED' || status === 'PARALLEL_ANALYSIS') {
      const gapExists     = (() => { try { readFileSync(join(WORKSPACE_DIR, 'gap_analysis.json'));   return true; } catch { return false; } })();
      const findingsExists = (() => { try { readFileSync(join(WORKSPACE_DIR, 'style_findings.json')); return true; } catch { return false; } })();
      state.analystDone = gapExists;
      state.taDone      = findingsExists;
      state.analystOutputText = null;
      console.log(`[Resume] ${status} — analystDone=${state.analystDone} taDone=${state.taDone}`);
      if (state.analystDone && state.taDone) {
        await checkJoin();
      } else {
        if (!state.taDone) {
          console.log('[Resume] style_findings missing — re-firing Tone Analyst (background)');
          broadcastMode('auto_running', 'Tone Analyst');
          sendToNodeAndWait('tone_analyst_input', 'Tone Analyst', '__begin_interview__')
            .then(async r => {
              const { cleanText } = parseAndStripStatus(typeof r === 'string' ? r : JSON.stringify(r));
              broadcastAgentResult(cleanText, 'Tone Analyst', false);
              state.taDone = true; await checkJoin();
            })
            .catch(err => console.error('[Tone Analyst · resume] error:', err));
        }
        if (!state.analystDone) {
          console.log('[Resume] gap_analysis missing — re-firing Analyst');
          sendToNodeAndWait('analyst_background_input', null, '__analyze__')
            .then(async r => {
              const { cleanText } = parseAndStripStatus(typeof r === 'string' ? r : JSON.stringify(r));
              broadcastAgentResult(cleanText, 'Analyst', false);
              state.analystDone = true; syncTADone(); await checkJoin();
            })
            .catch(err => console.error('[Analyst · resume] error:', err));
        }
      }
    } else if (status === 'SN_START' || status === 'STYLE_NEGOTIATING' || status === 'CV_BUILDING'
               || status === 'REVIEW_COMPLETE' || status === 'TONE_ANALYZED') {
      console.log('[Resume] phase-aware assembly resume');
      await resumeAssembly();
    } else if (status === 'RESEARCH_CONFIRM') {
      console.log('[Resume] RESEARCH_CONFIRM — re-displaying research summary');
      await handlePipelineStatus('RESEARCH_COMPLETE');
    }
    return;
  }

  if (status === 'RESEARCH_COMPLETE') {
    // BUG-126: Researcher just finished — stamp the real completion time before the gate displays it.
    stampTimestamp('research_output.json', 'completed_at');
    broadcast({ type: 'action_required', context: 'research_pre_confirm', prompt: '', actions: [
      { id: 'research_pre_confirm', label: 'Yes — continue',  variant: 'primary' },
      { id: 'research_pre_redo',   label: 'Research again',  variant: 'ghost'   },
    ]});
    await state.recipe.globalVariables.setValue('pipeline_status', 'RESEARCH_CONFIRM');
    state.pipelineStatus = 'RESEARCH_CONFIRM';
    broadcastMode('user_turn', 'Researcher');
    return;
  }

  if (status === 'RESEARCH_PARTIAL') {
    // set_status fires during Researcher execution — flag so .then() injects buttons after output broadcasts
    state.researchPartial = true;
    return;
  }

  if (EXCEPTION_STATUSES.has(status)) {
    broadcastMode('user_turn', 'Main Orchestrator');
    writeMODispatch(status);  // authoritative status → MO reads mo_dispatch.json, not the global
    sendToNodeAndWait(' Message', 'Main Orchestrator')
      .then(async r => {
        const { cleanText, status: newStatus } = parseAndStripStatus(typeof r === 'string' ? r : JSON.stringify(r));
        broadcastAgentResult(cleanText, 'Main Orchestrator', true);
        const buttons = EXCEPTION_ACTION_BUTTONS[status];
        if (buttons) broadcast({ type: 'action_required', context: status.toLowerCase(), prompt: '', actions: buttons });
        if (newStatus) { await state.recipe.globalVariables.setValue('pipeline_status', newStatus); state.pipelineStatus = newStatus; }
      })
      .catch(err => console.error('[Orchestrator · exception] error:', err));
    return;
  }

  if (status === 'JD_ENHANCED') {
    const clPath = join(WORKSPACE_DIR, 'cover_letter_sample.txt');
    if (!existsSync(clPath)) {
      broadcast({
        type: 'action_required',
        context: 'cl_upload_prompt',
        prompt: '**Add a cover letter? (optional)**\n\nIf you share a cover letter you\'ve written, we can match your writing style across both documents. No problem if not — we\'ll work from your CV alone.',
        actions: [
          { id: 'ta_upload_cover', label: 'Add a cover letter', type: 'upload', variant: 'primary' },
          { id: 'cl_skip',         label: 'Skip — use my CV only', variant: 'ghost' },
        ],
      });
      broadcastMode('action_required');
      state.pendingTADispatch = true;
      return;
    }
    fireTAAndAnalyst();
    return;
  }

  // TONE_ANALYZED no longer fired by agent — kept as safety net only
  if (status === 'TONE_ANALYZED') {
    if (!state.taDone) {
      state.taDone = true;
      await checkJoin();
    }
    return;
  }

  // ANALYSIS_COMPLETE no longer fired by agent — kept as safety net only
  if (status === 'ANALYSIS_COMPLETE') {
    if (!state.analystDone) {
      state.analystDone = true;
      syncTADone();
      await checkJoin();
    }
    return;
  }

  if (status === 'RESEARCH_REDO') {
    broadcastMode('auto_running', 'Researcher');
    await state.recipe.globalVariables.setValue('research_confirmed', 0);
    sendToNodeAndWait('researcher_input', 'Researcher', '__redo__')
      .then(async r => {
        const { cleanText, status: newStatus } = parseAndStripStatus(typeof r === 'string' ? r : JSON.stringify(r));
        broadcastAgentResult(cleanText, 'Researcher', true);
        if (newStatus) { await state.recipe.globalVariables.setValue('pipeline_status', newStatus); state.pipelineStatus = newStatus; }
        else console.warn('[Researcher · redo] missing pipeline_status tag');
        checkResearchRedoJoin();
      })
      .catch(err => console.error('[Researcher · redo] error:', err));
    await state.recipe.globalVariables.setValue('pipeline_status', 'PARALLEL_ANALYSIS');
    state.pipelineStatus = 'PARALLEL_ANALYSIS';
    return;
  }

  if (status === 'SN_START' || status === 'REVIEW_COMPLETE') {
    // Server owns assembly dispatch — bypass AC, start SN interview directly
    if (state.snState) {
      console.log(`[Status] SN already active (snState=${state.snState}), skip re-dispatch`);
      return;
    }
    await state.recipe.globalVariables.setValue('pipeline_status', 'CV_BUILDING');
    state.pipelineStatus = 'CV_BUILDING';
    broadcast({ type: 'status_changed', status: 'CV_BUILDING' });
    state.snState = null;
    await dispatchAssemblyPhase(1);
    return;
  }

  if (AUTO_FIRE_STATUSES.has(status)) {
    const node  = INPUT_NODE_MAP[status];
    const agent = HAPPY_PATH[status];
    if (!node) return;
    broadcastMode('auto_running', agent);
    console.log(`[Status · auto-fire] ${status} → ${node}`);
    if (agent === 'Extractor') clearExtractorFailure();  // fresh failure signal each attempt
    state.retryThunk = () => { state.recentlyDispatched.delete(status); return handlePipelineStatus(status); };
    sendToNodeAndWait(node, agent)
      .then(async r => {
        let { cleanText, status: newStatus } = parseAndStripStatus(typeof r === 'string' ? r : JSON.stringify(r));
        // Deterministic failure gate: if the Extractor wrote a failure_reason but dropped
        // the EXTRACTION_FAILED tag, force it — don't retain a stale prior status.
        if (agent === 'Extractor') newStatus = resolveExtractorStatus(newStatus);
        newStatus = resolveAgentStatus(agent, newStatus);  // #1: infer expected status on dropped tag
        broadcastAgentResult(cleanText, agent, AGENT_FOREGROUND.has(agent));
        if (status === 'INITIALIZED' && state.researchPartial) {
          state.researchPartial = false;
          broadcastMode('user_turn');
          broadcast({
            type: 'action_required',
            context: 'research_partial',
            prompt: '',
            actions: [
              { id: 'research_partial_proceed', label: 'Continue with what we found', variant: 'primary' },
              { id: 'research_retry',           label: 'Try the research again',      variant: 'ghost'   },
            ],
          });
        }
        if (newStatus) {
          await state.recipe.globalVariables.setValue('pipeline_status', newStatus);
          state.pipelineStatus = newStatus;
        } else {
          surfaceStall(agent, new Error('no status tag and no inference rule'));
        }
      })
      .catch(err => surfaceStall(agent, err));
  }
}
