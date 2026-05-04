import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { WORKSPACE_DIR, ASSEMBLY_PHASES } from '../config/constants.js';
import { state } from './state.js';
import { broadcast, broadcastMode, broadcastAgentResult, parseAndStripStatus } from './broadcast.js';
import { sendToNodeAndWait } from './node-communication.js';
import { injectReviewerButtons } from './button-injection.js';

// ── TA / Analyst / Reviewer join ──────────────────────────────────────────────

export function syncTADone() {
  try { readFileSync(join(WORKSPACE_DIR, 'style_findings.json')); state.taDone = true; } catch {}
}

export function fireTAAndAnalyst() {
  state.analystDone = false;
  state.taDone      = false;
  state.analystOutputText = null;
  broadcastMode('auto_running', 'Analysis');
  state.recipe.globalVariables.setValue('pipeline_status', 'PARALLEL_ANALYSIS');
  state.pipelineStatus = 'PARALLEL_ANALYSIS';
  sendToNodeAndWait('tone_analyst_input', 'Tone Analyst', '__tone_analysis__')
    .then(async r => {
      const raw = typeof r === 'string' ? r : (r != null ? JSON.stringify(r) : '');
      const { status, cleanText } = parseAndStripStatus(raw);
      broadcastAgentResult(cleanText, 'Tone Analyst', false);
      if (status) {
        state.taDone = true;
        await checkJoin();
      } else {
        console.warn('[Tone Analyst] missing pipeline_status tag');
      }
    })
    .catch(err => console.error('[TA] error:', err));
  sendToNodeAndWait('analyst_background_input', null, '__analyze__')
    .then(async r => {
      const raw = typeof r === 'string' ? r : (r != null ? JSON.stringify(r) : '');
      const { cleanText } = parseAndStripStatus(raw);
      if (cleanText) broadcast({ type: 'agent_message', agent: 'Analyst', text: cleanText, background: false });
      broadcast({ type: 'stream_done' });
      state.analystDone = true;
      syncTADone();
      await checkJoin();
    })
    .catch(err => console.error('[Analyst] error:', err));
}

export async function checkJoin() {
  if (!state.recipe) return;
  console.log(`[checkJoin] analystDone=${state.analystDone} taDone=${state.taDone}`);
  if (!state.analystDone || !state.taDone) {
    if (state.taDone && !state.analystDone) {
      broadcast({ type: 'agent_message', agent: 'System', text: 'Analysis still running in background — will begin gap review shortly…', background: true });
    }
    return;
  }
  state.analystDone = false;
  state.taDone = false;

  try { writeFileSync(join(WORKSPACE_DIR, 'review_audit.json'), '{}', 'utf8'); } catch {}

  const gapAnalysisPath = join(WORKSPACE_DIR, 'gap_analysis.json');
  let gapAnalysisReady = false;
  let retries = 0;
  while (!gapAnalysisReady && retries < 20) {
    try {
      if (existsSync(gapAnalysisPath)) {
        const parsed = JSON.parse(readFileSync(gapAnalysisPath, 'utf8'));
        if (parsed.overall_fit_score !== undefined) gapAnalysisReady = true;
      }
    } catch {}
    if (!gapAnalysisReady) { retries++; await new Promise(r => setTimeout(r, 100)); }
  }
  if (!gapAnalysisReady) console.error('[checkJoin] gap_analysis.json never became ready — proceeding anyway');

  try {
    const gapAnalysis = JSON.parse(readFileSync(gapAnalysisPath, 'utf8'));
    console.log(`[join] gap_analysis ready, fit score ${gapAnalysis.overall_fit_score ?? '?'}`);
  } catch (err) {
    console.error('[join] gap_analysis read error:', err.message);
  }

  if (state.analystOutputText) {
    broadcast({ type: 'agent_message', agent: 'Analyst', text: state.analystOutputText, background: false });
    broadcast({ type: 'stream_done' });
    state.analystOutputText = null;
    await new Promise(r => setTimeout(r, 300));
  }

  state.reviewerGapState = 'question';
  broadcastMode('auto_running', 'Reviewer');
  await state.recipe.globalVariables.setValue('pipeline_status', 'GAP_INTERVIEW');
  state.pipelineStatus = 'GAP_INTERVIEW';
  sendToNodeAndWait('reviewer_input', 'Reviewer', '__begin_gap_interview__')
    .then(async r => {
      const { cleanText, status } = parseAndStripStatus(typeof r === 'string' ? r : JSON.stringify(r));
      broadcastAgentResult(cleanText, 'Reviewer', true);
      if (status !== 'REVIEW_COMPLETE' && status !== 'REVIEW_FAILED') injectReviewerButtons();
      if (status) { await state.recipe.globalVariables.setValue('pipeline_status', status); state.pipelineStatus = status; }
    })
    .catch(err => console.error('[Reviewer] error:', err));
}

export async function checkResearchRedoJoin() {
  if (!state.recipe) return;
  try {
    const researchConfirmed = await state.recipe.globalVariables.getValue('research_confirmed');
    if (researchConfirmed !== 0) return;

    let researchSummary = 'Research updated.';
    try {
      const researchOutput = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'research_output.json'), 'utf8'));
      const meta = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'project_meta.json'), 'utf8'));
      const r = researchOutput.research_data || {};
      const company = meta.company_name || 'the company';
      const priorities = (r.company_priorities || []).slice(0, 3).join(', ') || 'not captured';
      researchSummary = `Updated research for **${company}**:\n- Key priorities: ${priorities}`;
    } catch {}

    if (state.taDone) {
      broadcast({
        type: 'action_required',
        context: 'research_confirm',
        prompt: researchSummary + '\n\nConfirm to proceed with gap analysis, or run research again.',
        actions: [
          { id: 'research_confirm', label: 'Confirm — proceed with analysis', variant: 'primary' },
          { id: 'research_redo',    label: 'Run research again',               variant: 'ghost'   },
        ],
      });
      broadcastMode('action_required');
      await state.recipe.globalVariables.setValue('pipeline_status', 'RESEARCH_CONFIRM');
      state.pipelineStatus = 'RESEARCH_CONFIRM';
    } else {
      broadcast({ type: 'agent_message', agent: 'System', text: researchSummary + '\n\n*(Research updated — gap analysis will use this once your style interview completes.)*' });
    }
  } catch (err) {
    console.error('[research redo join] error:', err.message);
  }
}

// ── Sequential assembly dispatch ──────────────────────────────────────────────

export async function dispatchAssemblyPhase(phaseNumber) {
  if (phaseNumber === 1) {
    await _startSNInterview();
    return;
  }

  const phase = ASSEMBLY_PHASES[phaseNumber];
  if (!phase) {
    state.pipelineStatus = 'CV_TAILORED';
    try { await state.recipe.globalVariables.setValue('pipeline_status', 'CV_TAILORED'); } catch {}
    broadcast({ type: 'status_changed', status: 'CV_TAILORED' });
    broadcastMode('idle');
    return;
  }

  state.currentAssemblyPhase = phaseNumber;

  let ctx = '';
  try {
    const meta = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'project_meta.json'), 'utf8'));
    ctx = ` role="${meta.position_title}" company="${meta.company_name}"`;
  } catch {}

  broadcastMode('auto_running', phase.agent);
  const result = await sendToNodeAndWait(' Message', phase.agent, `__build__${ctx}`);
  const { cleanText } = parseAndStripStatus(typeof result === 'string' ? result : JSON.stringify(result ?? ''));
  broadcastAgentResult(cleanText, phase.agent, true);

  await new Promise(r => setTimeout(r, 1000));

  if (phaseNumber <= 6 || phaseNumber === 9) {
    await mergePhaseOutput(phaseNumber);
    _showApproveRevise(phase.agent);
    return;
  }

  // SR (7) and IC (8) — gate check (they write cv_assembly_state.json themselves)
  await _handleGate(phaseNumber);
}

async function _startSNInterview() {
  state.currentAssemblyPhase = 1;
  state.snState = 'interviewing';
  await sendToSN('__interview_start__');
}

export async function sendToSN(message) {
  if (state.snPending) {
    console.log('[sendToSN] already awaiting KEMU — drop duplicate call');
    return;
  }
  state.snPending = true;
  broadcastMode('auto_running', 'Style Negotiator');
  let result;
  try {
    result = await sendToNodeAndWait(' Message', 'Style Negotiator', message);
  } finally {
    state.snPending = false;
  }
  const { cleanText } = parseAndStripStatus(typeof result === 'string' ? result : JSON.stringify(result ?? ''));
  broadcastAgentResult(cleanText, 'Style Negotiator', true);

  await new Promise(r => setTimeout(r, 1000));

  let snDone = false;
  try {
    const snOut = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'sn_output.json'), 'utf8'));
    snDone = snOut?.status === 'COMPLETE';
  } catch {}

  if (snDone) {
    await mergePhaseOutput(1);
    state.snState = 'summary';
    _showSNContinue();
  } else if (state.snState === 'customise_confirm') {
    _showSNConfirmButtons();
  } else {
    _showSNInterviewButtons();
  }
}

export async function mergePhaseOutput(phaseNumber) {
  const phase = ASSEMBLY_PHASES[phaseNumber];
  if (!phase?.outputFile) return; // SR/IC write cv_assembly_state.json themselves
  try {
    const outputData = JSON.parse(readFileSync(join(WORKSPACE_DIR, phase.outputFile), 'utf8'));
    const cvStatePath = join(WORKSPACE_DIR, 'cv_assembly_state.json');
    const cvState = JSON.parse(readFileSync(cvStatePath, 'utf8'));
    const idx = phaseNumber - 1;
    cvState.phases[idx].status       = 'COMPLETE';
    cvState.phases[idx].completed_at = outputData.completed_at ?? new Date().toISOString();
    cvState.phases[idx].data         = outputData.data;
    cvState.current_phase            = phaseNumber + 1;
    cvState.metadata.completed_phases = phaseNumber;
    cvState.metadata.last_updated    = new Date().toISOString();
    writeFileSync(cvStatePath, JSON.stringify(cvState, null, 2));
    console.log(`[assembly] merged phase ${phaseNumber} (${phase.agent}) → cv_assembly_state.json`);
  } catch (e) {
    console.error(`[assembly] merge phase ${phaseNumber} failed:`, e.message);
  }
}

export async function reShowSectionReview(phaseNumber) {
  await mergePhaseOutput(phaseNumber);
  _showApproveRevise(ASSEMBLY_PHASES[phaseNumber].agent);
}

async function _handleGate(phaseNumber) {
  const phase = ASSEMBLY_PHASES[phaseNumber];
  try {
    const cvState = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'cv_assembly_state.json'), 'utf8'));
    const phaseData = cvState.phases[phaseNumber - 1]?.data;

    let passed = false;
    if (phaseNumber === 7) {
      const compliance = phaseData?.style_compliance ?? phaseData?.verdict ?? '';
      passed = compliance === 'PASS' || compliance === 'PASS_WITH_FIXES';
    } else if (phaseNumber === 8) {
      passed = phaseData?.integrity_status === 'PASSED';
    }

    if (passed) {
      await dispatchAssemblyPhase(phaseNumber + 1);
    } else {
      const failStatus = phaseNumber === 7 ? 'STYLE_FAILED' : 'INTEGRITY_FAILED';
      state.pipelineStatus = failStatus;
      try { await state.recipe.globalVariables.setValue('pipeline_status', failStatus); } catch {}
      broadcast({ type: 'status_changed', status: failStatus });

      let prompt = '';
      if (phaseNumber === 8) {
        const claims = phaseData?.unsupported_claims_detail ?? [];
        if (claims.length) {
          prompt = `**${claims.length} unsupported claim(s) found:**\n\n` +
            claims.map(c => `• [${c.section}] ${c.claim} — ${c.verdict}`).join('\n');
        }
      } else if (phaseNumber === 7) {
        const issues = phaseData?.issues_found ?? [];
        if (issues.length) {
          prompt = `**${issues.length} style issue(s) found:**\n\n` +
            issues.map(i => `• ${i.description ?? i.issue ?? JSON.stringify(i)}`).join('\n');
        }
      }

      broadcast({
        type: 'action_required',
        context: 'gate_failed',
        agent: phase.agent,
        prompt,
        actions: [{ id: 'gate_continue', label: 'Continue anyway', variant: 'ghost' }],
      });
      broadcastMode('action_required');
    }
  } catch (e) {
    console.error(`[assembly] gate check phase ${phaseNumber} failed:`, e.message);
  }
}

function _showApproveRevise(agentName) {
  broadcast({
    type: 'action_required',
    context: 'assembly_section_review',
    agent: agentName,
    actions: [
      { id: 'assembly_approve', label: 'Approve',  variant: 'primary' },
      { id: 'assembly_revise',  label: 'Revise…',  variant: 'ghost'   },
    ],
  });
  broadcastMode('action_required');
}

function _showSNInterviewButtons() {
  broadcast({
    type: 'action_required',
    context: 'sn_interview',
    actions: [
      { id: 'sn_recommended', label: 'Use recommended',    variant: 'primary'   },
      { id: 'sn_keep',        label: 'Keep current style', variant: 'secondary' },
      { id: 'sn_customise',   label: 'Customise',          variant: 'ghost'     },
    ],
  });
  broadcastMode('action_required');
}

function _showSNConfirmButtons() {
  broadcast({
    type: 'action_required',
    context: 'sn_customise_confirm',
    actions: [
      { id: 'sn_confirm',  label: 'Confirm',  variant: 'primary' },
      { id: 'sn_rephrase', label: 'Rephrase', variant: 'ghost'   },
    ],
  });
  broadcastMode('action_required');
}

function _showSNContinue() {
  broadcast({
    type: 'action_required',
    context: 'sn_summary',
    actions: [
      { id: 'sn_continue', label: 'Continue → Build CV', variant: 'primary' },
    ],
  });
  broadcastMode('action_required');
}
