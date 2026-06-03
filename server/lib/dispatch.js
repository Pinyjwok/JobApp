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
  // BUG-126: JD Enhancer just finished — stamp the real enhancement time before consumers read it.
  stampTimestamp('enhanced_jd.json', 'metadata.enhanced_at');
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
      state.analystOutputText = await _runValidator(cleanText, 'analyst', 'gap_analysis.json');
      state.analystDone = true;
      syncTADone();
      await checkJoin();
    })
    .catch(err => console.error('[Analyst] error:', err));
}

// ── Server-owned fit score calculation ───────────────────────────────────────

const STRICTNESS_WEIGHTS = {
  RIGID:    { baseline: 8.5, differentiator: 1.5 },
  STANDARD: { baseline: 7.0, differentiator: 3.0 },
  FLEXIBLE: { baseline: 5.0, differentiator: 5.0 },
};

// Plan-B (v2.19): key_responsibilities are duties/context, never scored — excluded by SOURCE here even
// if an agent mislabels their tier. Mandatory statutory credentials, when unmet, cap the score.
const GATE_CEILING = 5.0;
const STATUTORY_CERT = /first aid|\bcpr\b|asthma|anaphylaxis|HLTAID\d+|working with children|wwcc|police check|immunisation|vaccination|right to work/i;
const isResponsibility = r => String(r.source ?? '').includes('key_responsibilities');

function calculateFitScore(gapAnalysis) {
  const reqs = gapAnalysis.requirements ?? [];
  const isMet = r => r.candidate_status === 'Met' || r.candidate_status === 'Met (Candidate Evidence)';
  // Scored set = genuine requirements only (tier filter + source guard against responsibility mislabeling).
  const baseline = reqs.filter(r => r.tier === 'Baseline' && !isResponsibility(r));
  const differentiator = reqs.filter(r => r.tier === 'Differentiator' && !isResponsibility(r));
  const baselineMet = baseline.filter(isMet).length;
  const differentiatorMet = differentiator.filter(isMet).length;

  const tag = gapAnalysis.role_strictness;
  const weights = STRICTNESS_WEIGHTS[tag] ?? STRICTNESS_WEIGHTS.STANDARD;
  if (!STRICTNESS_WEIGHTS[tag]) {
    console.warn(`[fit_score] unknown role_strictness="${tag}" — defaulting to STANDARD`);
  }

  const baselineScore = baseline.length > 0 ? (baselineMet / baseline.length) * weights.baseline : 0;
  const differentiatorScore = differentiator.length > 0 ? (differentiatorMet / differentiator.length) * weights.differentiator : 0;
  let total = Math.round((baselineScore + differentiatorScore) * 10) / 10;

  // Mandatory-cert gate: an unmet statutory "condition of employment" caps the score. Flag-driven,
  // with a keyword fallback so it fires even if the Analyst omits mandatory_gate.
  const gateApplied = reqs.some(r =>
    !isResponsibility(r) && !isMet(r) &&
    (r.mandatory_gate === true || STATUTORY_CERT.test(String(r.requirement_text ?? ''))));
  if (gateApplied && total > GATE_CEILING) total = GATE_CEILING;

  console.log(`[fit_score] strictness=${tag ?? 'STANDARD(default)'} baseline=${baselineScore.toFixed(2)} diff=${differentiatorScore.toFixed(2)} gated=${gateApplied} total=${total}`);
  return { score: total, gateApplied };
}

export function applyFitScore(gapAnalysisPath) {
  const gapAnalysis = JSON.parse(readFileSync(gapAnalysisPath, 'utf8'));
  const { score, gateApplied } = calculateFitScore(gapAnalysis);
  // Idempotent: strip any prior "Fit Score: X/10 — " prefix and trailing gate marker before reapplying.
  const qualitative = String(gapAnalysis.fit_rationale ?? '')
    .replace(/^Fit Score: \d+(\.\d+)?\/10\s*—\s*/, '')
    .replace(/\s*\(capped — unmet mandatory credential\)\s*$/, '')
    .trim();
  const marker = gateApplied ? ' (capped — unmet mandatory credential)' : '';
  gapAnalysis.overall_fit_score = score;
  gapAnalysis.fit_rationale = (qualitative ? `Fit Score: ${score}/10 — ${qualitative}` : `Fit Score: ${score}/10`) + marker;
  gapAnalysis.fit_score_source = 'server';
  // BUG-126: server owns the timestamp — LLMs cannot reliably read "today".
  gapAnalysis.metadata = gapAnalysis.metadata || {};
  gapAnalysis.metadata.analyzed_at = new Date().toISOString();
  writeFileSync(gapAnalysisPath, JSON.stringify(gapAnalysis, null, 2), 'utf8');
  return score;
}

// BUG-126: deterministically stamp a server-owned timestamp onto a workspace file, overwriting
// whatever (possibly stale/hardcoded) value the agent wrote. dotPath supports nested keys.
export function stampTimestamp(filename, dotPath) {
  try {
    const p = join(WORKSPACE_DIR, filename);
    const obj = JSON.parse(readFileSync(p, 'utf8'));
    const parts = dotPath.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = new Date().toISOString();
    writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) {
    console.warn(`[stamp] ${filename} ${dotPath}: ${e.message}`);
  }
}

// Strip any reasoning/preamble the Analyst leaks before its completion message.
// The completion block always starts with a "✓ Analyst Complete" header; keep from
// there onward and ensure the header begins on its own line so markdown renders it.
function stripAnalystNarration(text) {
  if (!text) return text;
  const idx = text.search(/#*\s*✓\s*Analyst Complete/);
  if (idx === -1) return text.trim();
  return text.slice(idx).replace(/^#*\s*/, '# ').trim();
}

// ─────────────────────────────────────────────────────────────────────────────

async function _runValidator(callerText, agent, outputFile) {
  try {
    await sendToNodeAndWait('validator_input', 'Validator', agent);
    const verdict = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'validator_verdict.json'), 'utf8'));
    console.log(`[Validator] verdict=${verdict.verdict} for ${agent} (${verdict.issues?.length ?? 0} issue(s))`);

    if (verdict.verdict === 'APPROVE') return callerText;

    if (verdict.verdict === 'FLAG') {
      const warnings = (verdict.issues || []).map(i => `• ${i.field}: ${i.problem}`).join('\n');
      return callerText + '\n\n⚠ Quality notes:\n' + warnings;
    }

    if (verdict.verdict === 'REJECT') {
      console.log(`[Validator] REJECT for ${agent} — retrying once`);
      const retryResult = await sendToNodeAndWait('analyst_background_input', null, '__analyze__');
      const { cleanText: retryText } = parseAndStripStatus(
        typeof retryResult === 'string' ? retryResult : JSON.stringify(retryResult ?? '')
      );
      await sendToNodeAndWait('validator_input', 'Validator', agent);
      try {
        const retryVerdict = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'validator_verdict.json'), 'utf8'));
        console.log(`[Validator] retry verdict=${retryVerdict.verdict} for ${agent}`);
        if (retryVerdict.verdict === 'FLAG') {
          const warnings = (retryVerdict.issues || []).map(i => `• ${i.field}: ${i.problem}`).join('\n');
          return retryText + '\n\n⚠ Quality notes:\n' + warnings;
        }
      } catch {}
      return retryText;
    }
  } catch (err) {
    console.error('[Validator] error:', err.message);
  }
  return callerText; // fallback: show original on any Validator failure
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
        if (Array.isArray(parsed.requirements)) gapAnalysisReady = true;
      }
    } catch {}
    if (!gapAnalysisReady) { retries++; await new Promise(r => setTimeout(r, 100)); }
  }
  if (!gapAnalysisReady) console.error('[checkJoin] gap_analysis.json never became ready — proceeding anyway');

  let computedScore = null;
  try {
    computedScore = applyFitScore(gapAnalysisPath);
    console.log(`[join] gap_analysis ready, server fit score ${computedScore}`);
  } catch (err) {
    console.error('[join] applyFitScore error:', err.message);
  }

  if (state.analystOutputText) {
    const banner = computedScore !== null ? `**Fit Score: ${computedScore}/10**\n\n` : '';
    broadcast({ type: 'agent_message', agent: 'Analyst', text: banner + stripAnalystNarration(state.analystOutputText), background: false });
    broadcast({ type: 'stream_done' });
    state.analystOutputText = null;
    await new Promise(r => setTimeout(r, 300));
  }

  await state.recipe.globalVariables.setValue('pipeline_status', 'GAP_INTERVIEW');
  state.pipelineStatus = 'GAP_INTERVIEW';

  let highGaps = [];
  try {
    const gapData = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'gap_analysis.json'), 'utf8'));
    highGaps = (gapData.gaps ?? []).filter(g => g.severity === 'High');
  } catch (e) {
    console.error('[checkJoin] failed to read high gaps for modal:', e.message);
  }
  console.log(`[checkJoin] broadcasting gap_interview_start with ${highGaps.length} high gaps`);
  broadcast({ type: 'gap_interview_start', gaps: highGaps });
  broadcastMode('action_required');
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
    const today = new Date().toISOString().substring(0, 10);
    ctx = ` role="${meta.position_title}" company="${meta.company_name}" today="${today}"`;
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
    return;
  }

  // Stale output detection — warn if output file was written more than 5 minutes ago
  try {
    const outputData = JSON.parse(readFileSync(join(WORKSPACE_DIR, phase.outputFile), 'utf8'));
    if (outputData.completed_at) {
      const outputAge = Date.now() - new Date(outputData.completed_at).getTime();
      if (outputAge > 300_000) {
        console.warn(`[assembly] phase ${phaseNumber} output stale (${Math.round(outputAge / 1000)}s old)`);
        broadcast({
          type: 'agent_message', agent: 'System',
          text: `⚠ Phase ${phaseNumber} (${phase.agent}) output appears stale — completed_at is ${outputData.completed_at}. ` +
                `The agent may not have run this turn. Check if ${phase.outputFile} was freshly written.`,
        });
      }
    }
  } catch {}
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

      // Build action buttons based on which phase failed and what kinds of issues exist
      const gateActions = [];
      if (phaseNumber === 8) {
        // IC failure — check if there are DATES_UNVERIFIED items that can be auto-corrected
        try {
          const cvStateForGate = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'cv_assembly_state.json'), 'utf8'));
          const dateClaims = (cvStateForGate.phases[7]?.data?.unsupported_claims_detail || [])
            .filter(c => c.evidence_status === 'DATES_UNVERIFIED');
          if (dateClaims.length > 0) {
            gateActions.push({ id: 'ic_fix_corrections', label: `Apply date corrections (${dateClaims.length})`, variant: 'primary' });
          }
        } catch {}
      }
      gateActions.push({ id: 'gate_continue', label: 'Continue anyway', variant: 'ghost' });

      broadcast({
        type: 'action_required',
        context: 'gate_failed',
        agent: phase.agent,
        prompt,
        actions: gateActions,
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
