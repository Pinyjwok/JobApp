import { readFileSync, writeFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { WORKSPACE_DIR, ASSEMBLY_PHASES, EXPECTED_STATUS, AGENT_FOREGROUND } from '../config/constants.js';
import { state } from './state.js';
import { broadcast, broadcastMode, broadcastAgentResult, parseAndStripStatus } from './broadcast.js';
import { sendToNodeAndWait } from './node-communication.js';

// ── Status-tag fallback + stall recovery (#1 / #2) ────────────────────────────

// #1: when an agent finishes but drops its `pipeline_status:` tag, infer the expected
// next status for the deterministic linear agents (EXPECTED_STATUS) and advance anyway.
// Returns the resolved status, or null if there's no inference rule (caller should stall).
export function resolveAgentStatus(agentName, parsedStatus) {
  if (parsedStatus) return parsedStatus;
  const inferred = EXPECTED_STATUS[agentName];
  if (inferred) {
    console.warn(`[${agentName}] missing pipeline_status tag — inferring ${inferred}`);
    return inferred;
  }
  return null;
}

// Single recovery affordance for #1 (no inference rule) and #2 (timeout/throw): surface a
// visible error bubble + a Retry gate that re-fires state.retryThunk.
export function surfaceStall(agentName, err) {
  console.error(`[stall] ${agentName}: ${err?.message ?? 'no status tag and no inference rule'}`);
  const timedOut = err?.message?.startsWith('STALL:');
  broadcast({
    type: 'agent_message', agent: 'System',
    text: `⚠ **${agentName}** didn't return a result${timedOut ? ' (timed out)' : ''}. You can retry this step.`,
  });
  broadcast({
    type: 'action_required', context: 'dispatch_stall',
    actions: [{ id: 'retry_last_dispatch', label: `Retry ${agentName}`, variant: 'primary' }],
  });
  broadcastMode('action_required');
}

// Consolidated fire → parse → advance for the linear happy-path agents. Registers a retry
// thunk, applies the Extractor failure gate then the status-tag fallback, and either advances
// (setValue → onChange drives the next step) or surfaces a stall.
export async function runLinearDispatch({ node, agent, query = '__auto__', foreground }) {
  state.retryThunk = () => runLinearDispatch({ node, agent, query, foreground });
  const fg = foreground ?? AGENT_FOREGROUND.has(agent);
  broadcastMode('auto_running', agent);
  try {
    const r = await sendToNodeAndWait(node, agent, query);
    let { cleanText, status } = parseAndStripStatus(typeof r === 'string' ? r : (r != null ? JSON.stringify(r) : ''));
    if (agent === 'Extractor') status = resolveExtractorStatus(status);
    status = resolveAgentStatus(agent, status);
    broadcastAgentResult(cleanText, agent, fg);
    if (status) {
      await state.recipe.globalVariables.setValue('pipeline_status', status);
      state.pipelineStatus = status;
    } else {
      surfaceStall(agent, new Error('no status tag and no inference rule'));
    }
  } catch (err) {
    surfaceStall(agent, err);
  }
}

// ── TA / Analyst / Reviewer join ──────────────────────────────────────────────

export function syncTADone() {
  try { readFileSync(join(WORKSPACE_DIR, 'style_findings.json')); state.taDone = true; } catch {}
}

// On a re-run of the Analyst, delete the stale gap_analysis.json before re-firing the node.
// The Analyst's Phase 1 re-invocation guard bails (SwitchAgent → MO) whenever gap_analysis.json
// already has a `requirements` array, so a redo that leaves the old file on disk would no-op.
// Clearing it makes "file present" mean "genuinely complete" — the guard then only trips on a
// true KEMU double-fire, not on an intentional redo.
export function clearStaleAnalysis() {
  try {
    rmSync(join(WORKSPACE_DIR, 'gap_analysis.json'), { force: true });
  } catch (err) {
    console.error('[clearStaleAnalysis] could not remove gap_analysis.json:', err);
  }
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
      // Tone validator is now called as a tool by the Tone Analyst itself (mirrors the Analyst path) —
      // the server no longer fires tone_validator_input. The inline tone_validator sub-agent still writes
      // tone_validator_verdict.json (the Style Negotiator reads findings_for_sn from it) and TA owns its own
      // REJECT/retry loop. We just broadcast TA's completion bubble and join.
      stampTimestamp('style_findings.json', 'analyzed_at'); // BUG-126 class — TA hallucinates this; server owns it
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
      state.analystOutputText = cleanText; // validator is now called as a tool by the Analyst itself
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

// ── Server-owned Reviewer audit ──────────────────────────────────────────────
// The forensic audit (gap-answer ingest + strength/gap/requirement/ATS checks + verdict) is pure
// deterministic logic over gap_analysis.json + enhanced_jd.json + candidate_profile.json + jd_raw.txt.
// It was previously run by the LLM Reviewer node "executing" JS pseudocode, which produced a class of
// bugs (version-literal leak, brittle text matching, [object Object] stringify, silent item drops).
// Moving it here makes it exact and removes those failure modes. The LLM Reviewer node is retained
// ONLY for the user-facing Phase 7.5 issue resolution, dispatched when backable issues remain.
// EXCEPTION — the one genuinely semantic step, classifying a gap answer EVIDENCE vs INTENT, is NOT
// done here: it's an LLM call (evidence-classifier.js) made upstream in gap_answers_submit; the result
// arrives as `evidence_type` on each answer and _ingestGapAnswers trusts it (no regex proxy).

export const REVIEW_AUDIT_VERSION = 'server-1.0';
const BACKABLE_ISSUE_TYPES = ['A - Evidence Mismatch', 'B - Seniority Inflation', 'D - Missing Context'];

// Resolve a dotted/bracketed path (e.g. "candidate_profile.education[0]" or
// "enhanced_jd.requirements.required_qualifications[2]") against a root object. Strips the leading
// root prefix. Returns undefined if any segment is missing.
function resolvePath(root, path, rootPrefix) {
  if (!path || typeof path !== 'string') return undefined;
  const stripped = rootPrefix ? path.replace(new RegExp('^' + rootPrefix + '\\.'), '') : path;
  const parts = stripped.split(/[.\[\]]/).filter(Boolean);
  let cur = root;
  for (const part of parts) {
    const key = Array.isArray(cur) ? Number(part) : part;
    if (cur != null && cur[key] !== undefined) cur = cur[key];
    else return undefined;
  }
  return cur;
}

const _stringify = v => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));

// Strip the two ways the Analyst commonly mangles an otherwise-valid dot-bracket path and return every
// clean candidate, in order, to try resolving:
//   "a.b.c (descriptive note)"  → ["a.b.c"]              (trailing parenthetical)
//   "a.b and x.y"               → ["a.b", "x.y"]         ("and"-joined multi-path — any may be the live one)
function _normalizeEvidencePath(path) {
  if (!path || typeof path !== 'string') return [];
  return path
    .split(/\s+and\s+/i)
    .map(seg => seg.replace(/\s*\(.*$/s, '').replace(/[\s,;]+$/, '').trim())
    .filter(Boolean);
}

// First normalized candidate of a malformed path that actually resolves against root, or null. Returns
// null when the path was already clean (nothing to repair) so callers only act on a genuine fix.
function _repairPath(root, rawPath, prefix) {
  for (const cand of _normalizeEvidencePath(rawPath)) {
    if (cand !== rawPath && resolvePath(root, cand, prefix) != null) return cand;
  }
  return null;
}

// Canonical tier for a requirement from its text + source, or null if genuinely ambiguous. Mirrors the
// Phase 4 audit signals so a repaired tier reads back as 'correct'. Order: Responsibility > Differentiator
// > Baseline (a "preferred" item is a Differentiator even if it also reads as required).
function _computeTier(r) {
  const reqText = String(r.requirement_text || '').toLowerCase();
  const src = String(r.source || '');
  const isResp = src.includes('key_responsibilities');
  const isDiff = reqText.includes('preferred') || reqText.includes('nice to have') || reqText.includes('bonus') || src.includes('preferred_qualifications');
  const isBaseline = reqText.includes('required') || reqText.includes('must') || reqText.includes('essential') || src.includes('required_qualifications');
  if (isResp) return 'Responsibility';
  if (isDiff) return 'Differentiator';
  if (isBaseline) return 'Baseline';
  return null;
}

// Layers 1+2 — deterministic pre-audit repair, run before the verdict phases. The Analyst can ship
// gap_analysis.json with malformed evidence_source paths (descriptive text appended, "and"-joined) even
// after a validator REJECT, because its retry loop is capped ("proceed regardless of the second verdict").
// Those non-resolving paths would otherwise surface as Critical 'A - Evidence Mismatch' → REVIEW_FAILED →
// a blunt redo-everything menu that re-runs the same nondeterministic node and reproduces the defect.
// Fix them here where the server owns the truth: normalize+re-resolve (repair), drop the strength if it's
// still unverifiable (never ship an unbackable claim into the CV), overwrite a provably-wrong requirement
// tier with the computed-correct one, and drop unbacked orphan gaps whose requirement_source isn't in the
// JD. Mutates gapAnalysis in place; returns a repair record for the audit + summary.
function _repairGapAnalysis(gapAnalysis, candidateProfile, enhancedJD) {
  const repairs = { paths_normalized: [], strengths_dropped: [], requirements_retiered: [], gaps_dropped: [] };

  const keptStrengths = [];
  for (const s of (gapAnalysis.strengths || [])) {
    if (resolvePath(candidateProfile, s.evidence_source, 'candidate_profile') != null) { keptStrengths.push(s); continue; }
    const fixed = _repairPath(candidateProfile, s.evidence_source, 'candidate_profile');
    if (fixed) {
      repairs.paths_normalized.push({ id: s.id, from: s.evidence_source, to: fixed });
      s.evidence_source = fixed; keptStrengths.push(s); continue;
    }
    repairs.strengths_dropped.push({ id: s.id, evidence_source: s.evidence_source, strength_text: s.strength_text });
  }
  gapAnalysis.strengths = keptStrengths;

  for (const r of (gapAnalysis.requirements || [])) {
    const correct = _computeTier(r);
    if (correct && r.tier !== correct) {
      repairs.requirements_retiered.push({ id: r.id, from: r.tier, to: correct });
      r.tier = correct;
    }
  }

  const keptGaps = [];
  for (const g of (gapAnalysis.gaps || [])) {
    if (resolvePath(enhancedJD, g.requirement_source, 'enhanced_jd') != null) { keptGaps.push(g); continue; }
    const fixed = _repairPath(enhancedJD, g.requirement_source, 'enhanced_jd');
    if (fixed) {
      repairs.paths_normalized.push({ id: g.id, from: g.requirement_source, to: fixed });
      g.requirement_source = fixed; keptGaps.push(g); continue;
    }
    // Keep a candidate-backed gap even if its source is orphaned — its evidence stands on its own.
    if (g.evidence_type === 'EVIDENCE' && g.candidate_provided_evidence) { keptGaps.push(g); continue; }
    repairs.gaps_dropped.push({ id: g.id, requirement_source: g.requirement_source, gap_text: g.gap_text });
  }
  gapAnalysis.gaps = keptGaps;

  return repairs;
}

// Ingest the gap answers collected by the client modal (Phase 1). Mutates gapAnalysis in place.
// EVIDENCE/INTENT classification is a semantic judgment done by the LLM classifier upstream
// (see evidence-classifier.js) and arrives on each answer as `evidence_type`. This function does ONLY
// the mechanical effects — it trusts the provided label and never re-classifies (no regex proxy).
function _ingestGapAnswers(gapAnalysis, gapAnswers) {
  if (!Array.isArray(gapAnalysis.candidate_backed_strengths)) gapAnalysis.candidate_backed_strengths = [];

  // Idempotency: a resubmit must not stack duplicate backed-strengths or leave a stale
  // "Met (Candidate Evidence)" when an answer changed. Reset every submitted gap's prior state first.
  const submittedIds = new Set((gapAnswers || []).map(a => a.gap_id));
  if (submittedIds.size > 0) {
    gapAnalysis.candidate_backed_strengths = gapAnalysis.candidate_backed_strengths.filter(s => !submittedIds.has(s.gap_id));
    for (const gap of (gapAnalysis.gaps || [])) {
      if (!submittedIds.has(gap.id)) continue;
      delete gap.candidate_provided_evidence; delete gap.evidence_source;
      delete gap.evidence_type; delete gap.evidence_classification_reason;
      const linkedReq = (gapAnalysis.requirements || []).find(r => r.id === gap.requirement_id);
      if (linkedReq && linkedReq.candidate_status === 'Met (Candidate Evidence)') {
        linkedReq.candidate_status = 'Gap';
        delete linkedReq.candidate_evidence_text;
      }
    }
  }

  for (const answer of gapAnswers || []) {
    const gap = (gapAnalysis.gaps || []).find(g => g.id === answer.gap_id);
    if (!gap) continue;
    if (answer.skipped || !answer.user_answer?.trim()) {
      gap.candidate_provided_evidence = '__skipped__';
      gap.evidence_source = 'skipped';
      gap.evidence_type = 'SKIPPED';
      continue;
    }
    const response = answer.user_answer.trim();
    const evidenceType = answer.evidence_type === 'EVIDENCE' ? 'EVIDENCE' : 'INTENT'; // LLM-classified upstream; INTENT is the safe default
    gap.candidate_provided_evidence = response;
    gap.evidence_source = 'user_provided';
    gap.evidence_type = evidenceType;
    if (answer.evidence_reason) gap.evidence_classification_reason = answer.evidence_reason; // kept for debugging
    if (evidenceType === 'EVIDENCE') {
      const linkedReq = (gapAnalysis.requirements || []).find(r => r.id === gap.requirement_id);
      if (linkedReq) { linkedReq.candidate_status = 'Met (Candidate Evidence)'; linkedReq.candidate_evidence_text = response; }
      gapAnalysis.candidate_backed_strengths.push({ gap_id: answer.gap_id, gap_text: answer.gap_text, evidence: response, tier: answer.tier });
    }
  }
}

// Run the full forensic audit and write review_audit.json. Returns { audit, backableIssues }.
export function runReviewAudit(gapAnswers = []) {
  const gapAnalysis      = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'gap_analysis.json'), 'utf8'));
  const enhancedJD       = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'enhanced_jd.json'), 'utf8'));
  const candidateProfile = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'candidate_profile.json'), 'utf8'));
  let jdContent = '';
  try { jdContent = readFileSync(join(WORKSPACE_DIR, 'jd_raw.txt'), 'utf8'); } catch {}

  // Phase 1 — ingest gap answers, then deterministically repair Analyst output defects (Layers 1+2)
  // BEFORE the verdict phases see the data, then persist (downstream agents read the cleaned file).
  _ingestGapAnswers(gapAnalysis, gapAnswers);
  const repairs = _repairGapAnalysis(gapAnalysis, candidateProfile, enhancedJD);
  const repairCount = repairs.paths_normalized.length + repairs.strengths_dropped.length
                    + repairs.requirements_retiered.length + repairs.gaps_dropped.length;
  if (repairCount > 0) console.log(`[runReviewAudit] pre-audit repair: ${repairs.paths_normalized.length} path(s) normalized, ${repairs.strengths_dropped.length} strength(s) dropped, ${repairs.requirements_retiered.length} re-tiered, ${repairs.gaps_dropped.length} orphan gap(s) dropped`);
  writeFileSync(join(WORKSPACE_DIR, 'gap_analysis.json'), JSON.stringify(gapAnalysis, null, 2), 'utf8');

  const audit = { strengths: [], gaps: [], requirements: [], ats_keywords: [] };

  // Phase 2 — strengths: evidence_source must resolve in candidate_profile.
  const validStrengthIds = (gapAnalysis.strengths || []).map(s => s.id);
  for (const s of (gapAnalysis.strengths || [])) {
    const actual = resolvePath(candidateProfile, s.evidence_source, 'candidate_profile');
    const exists = actual !== undefined && actual !== null;
    let confidence_level, issue_type = null, severity = null;
    if (!exists) {
      confidence_level = 1; issue_type = 'A - Evidence Mismatch'; severity = 'Critical';
    } else {
      const ev = _stringify(actual).toLowerCase();
      const claim = String(s.strength_text || '').toLowerCase();
      if (ev.includes(claim.substring(0, 20)) || claim.includes(ev.substring(0, 20))) confidence_level = 5;
      else if (ev.split(/\s+/).some(w => w.length > 4 && claim.includes(w))) confidence_level = 4;
      else confidence_level = 3;
    }
    audit.strengths.push({
      strength_id: s.id, confidence_level, evidence_status: exists ? 'Found' : 'Not Found',
      issue_type, severity,
      notes: exists ? `Evidence verified: ${_stringify(actual).substring(0, 100)}` : `Evidence path not found: ${s.evidence_source}`,
    });
  }

  // Phase 3 — gaps: a gap asserts the candidate LACKS a requirement (no evidence claim to mismatch).
  // Verify only that the cited requirement_source resolves in enhanced_jd.
  for (const g of (gapAnalysis.gaps || [])) {
    const actual = resolvePath(enhancedJD, g.requirement_source, 'enhanced_jd');
    const exists = actual !== undefined && actual !== null;
    let confidence_level, issue_type = null, severity = null;
    if (!exists) { confidence_level = 1; issue_type = 'D - Missing Context'; severity = 'High'; }
    else confidence_level = 5;
    audit.gaps.push({
      gap_id: g.id, confidence_level, requirement_status: exists ? 'Found' : 'Not Found',
      issue_type, severity,
      notes: exists ? `Requirement verified: ${_stringify(actual).substring(0, 100)}` : `Gap cites a requirement not present in enhanced_jd: ${g.requirement_source}`,
    });
  }

  // Phase 4 — requirement tier classification.
  for (const r of (gapAnalysis.requirements || [])) {
    const reqText = String(r.requirement_text || '').toLowerCase();
    const src = String(r.source || '');
    const isResp = src.includes('key_responsibilities');
    const isBaseline = !isResp && (reqText.includes('required') || reqText.includes('must') || reqText.includes('essential') || src.includes('required_qualifications'));
    const isDiff = reqText.includes('preferred') || reqText.includes('nice to have') || reqText.includes('bonus') || src.includes('preferred_qualifications');
    let tier_correct, confidence_level, issue_type = null, severity = null;
    if (r.tier === 'Responsibility' && isResp) { tier_correct = 'correct'; confidence_level = 5; }
    else if (r.tier === 'Baseline' && isBaseline) { tier_correct = 'correct'; confidence_level = 5; }
    else if (r.tier === 'Differentiator' && isDiff) { tier_correct = 'correct'; confidence_level = 5; }
    else if (r.tier === 'Baseline' && !isDiff && !isResp) { tier_correct = 'questionable'; confidence_level = 3; }
    else { tier_correct = 'incorrect'; confidence_level = 1; issue_type = 'C - Requirement Misclassification'; severity = 'High'; }
    audit.requirements.push({ requirement_id: r.id, confidence_level, tier_correct, issue_type, severity });
  }

  // Phase 5 — ATS keywords must appear in raw OR enhanced JD.
  const enhancedStr = JSON.stringify(enhancedJD).toLowerCase();
  const rawLower = jdContent.toLowerCase();
  for (const keyword of (gapAnalysis.ats_keywords || [])) {
    const k = String(keyword).toLowerCase();
    const inJD = rawLower.includes(k) || enhancedStr.includes(k);
    audit.ats_keywords.push({ keyword, confidence_level: inJD ? 5 : 1, found_in_jd: inJD, issue_type: inJD ? null : 'A - Evidence Mismatch', severity: inJD ? null : 'Medium' });
  }

  // Phase 7 — bucket every item into exactly one of {issues_found, approved_items}. A flagged issue
  // (confidence < 4 AND an issue_type) → issues_found; everything else → approved_items.
  const issuesFound = [], approvedItems = [];
  const bucket = (item, category, id, extra = {}) => {
    if (item.confidence_level < 4 && item.issue_type) {
      issuesFound.push({ category, item_id: id, issue_type: item.issue_type, severity: item.severity, confidence_level: item.confidence_level, ...extra });
    } else {
      approvedItems.push({ category, item_id: id, confidence_level: item.confidence_level });
    }
  };
  for (const s of audit.strengths) { if (validStrengthIds.includes(s.strength_id)) bucket(s, 'Strength', s.strength_id, { notes: s.notes }); }
  for (const g of audit.gaps) bucket(g, 'Gap', g.gap_id, { notes: g.notes });
  for (const r of audit.requirements) bucket(r, 'Requirement', r.requirement_id);
  // ATS keywords are only ever flagged, never "approved".
  for (const k of audit.ats_keywords) { if (k.confidence_level < 4 && k.issue_type) issuesFound.push({ category: 'ATS Keyword', item_id: k.keyword, issue_type: k.issue_type, severity: k.severity, confidence_level: k.confidence_level }); }

  const sevCount = sv => issuesFound.filter(i => i.severity === sv).length;
  const critical = sevCount('Critical'), high = sevCount('High'), medium = sevCount('Medium'), low = sevCount('Low');
  let overall_verdict, rejection_reason = null;
  if (critical > 0) { overall_verdict = 'REJECTED'; rejection_reason = `${critical} critical issue(s) found (seniority inflation, fabricated evidence, or major calculation errors)`; }
  else if (high > 2) { overall_verdict = 'REJECTED'; rejection_reason = `${high} high-severity issues found (significant misrepresentations)`; }
  else if (high > 0 || medium > 5) { overall_verdict = 'REJECTED'; rejection_reason = `Quality concerns: ${high} high + ${medium} medium severity issues`; }
  else overall_verdict = 'APPROVED';

  const reviewAudit = {
    metadata: {
      reviewed_at: new Date().toISOString(),
      reviewer_version: REVIEW_AUDIT_VERSION,
      analyst_version: gapAnalysis.metadata?.analyst_version || 'unknown',
      candidate_backed_gaps: gapAnalysis.candidate_backed_strengths?.length ?? 0,
    },
    repairs,
    overall_verdict, rejection_reason,
    issues_found: issuesFound,
    approved_items: approvedItems,
    summary: {
      total_items_audited: audit.strengths.length + audit.gaps.length + audit.requirements.length + audit.ats_keywords.length,
      total_issues: issuesFound.length,
      critical_issues: critical, high_issues: high, medium_issues: medium, low_issues: low,
      approved_items: approvedItems.length,
      unresolved_issues: issuesFound.length,
      user_backed_items: 0,
    },
  };
  writeFileSync(join(WORKSPACE_DIR, 'review_audit.json'), JSON.stringify(reviewAudit, null, 2), 'utf8');

  const backableIssues = issuesFound.filter(i => BACKABLE_ISSUE_TYPES.includes(i.issue_type));
  console.log(`[runReviewAudit] verdict=${overall_verdict} issues=${issuesFound.length} backable=${backableIssues.length} approved=${approvedItems.length}`);
  return { audit: reviewAudit, backableIssues };
}

// Build the user-facing review summary (Phase 10) from a finalized review_audit object.
export function buildReviewSummary(audit) {
  const s = audit.summary || {};
  const top = (audit.issues_found || []).filter(i => (i.severity === 'Critical' || i.severity === 'High') && !i.user_backed);
  const lines = [
    '# ✓ Quality Review Complete',
    '',
    `**Overall Verdict:** ${audit.overall_verdict}`,
  ];
  if (audit.overall_verdict === 'REJECTED' && audit.rejection_reason) lines.push(`**Reason:** ${audit.rejection_reason}`);
  lines.push('', '---', '', '## Audit Summary', '',
    `**Items Audited:** ${s.total_items_audited ?? 0}`,
    `**Approved Items:** ${s.approved_items ?? 0}`,
    `**Issues Found:** ${s.total_issues ?? 0}`);
  if ((audit.metadata?.candidate_backed_gaps ?? 0) > 0) lines.push('', `**Gap Evidence Provided:** ${audit.metadata.candidate_backed_gaps} gap(s) resolved via candidate evidence`);
  const rp = audit.repairs || {};
  const rpCount = (rp.paths_normalized?.length ?? 0) + (rp.strengths_dropped?.length ?? 0) + (rp.requirements_retiered?.length ?? 0) + (rp.gaps_dropped?.length ?? 0);
  if (rpCount > 0) {
    lines.push('', '**Auto-Repairs Applied:**');
    if (rp.paths_normalized?.length)     lines.push(`- Normalized ${rp.paths_normalized.length} malformed evidence path(s)`);
    if (rp.strengths_dropped?.length)    lines.push(`- Dropped ${rp.strengths_dropped.length} unverifiable strength(s)`);
    if (rp.requirements_retiered?.length) lines.push(`- Re-tiered ${rp.requirements_retiered.length} misclassified requirement(s)`);
    if (rp.gaps_dropped?.length)         lines.push(`- Dropped ${rp.gaps_dropped.length} ungrounded gap(s)`);
  }
  lines.push('', '**Issues by Severity:**',
    `- Critical: ${s.critical_issues ?? 0}`,
    `- High: ${s.high_issues ?? 0}`,
    `- Medium: ${s.medium_issues ?? 0}`,
    `- Low: ${s.low_issues ?? 0}`);
  if (top.length > 0) {
    lines.push('', '**Critical & High Issues:**');
    for (const i of top) lines.push(`- [${i.severity}] ${i.category} ${i.item_id}: ${i.notes || i.issue_type}`);
  }
  lines.push('', '---', '');
  lines.push(audit.overall_verdict === 'APPROVED'
    ? 'Analysis validated and approved.\n\n**Next:** the assembly phase will begin — starting with style negotiation.'
    : 'Quality issues detected. Main Orchestrator will present correction options.');
  return lines.join('\n');
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

// Deterministic Extractor-failure gate. The Extractor signals a hard failure by
// writing `failure_reason` to project_meta.json (a reliable WriteFile) AND by
// emitting a trailing `pipeline_status: EXTRACTION_FAILED` text tag (unreliable —
// the LLM drops it on the failure branch). When the tag is dropped, the server
// would otherwise retain the prior status (e.g. a stale CV_TAILORED from an earlier
// run) and mis-route into the completion menu. So: trust the file, not the prose —
// if project_meta.failure_reason is set, force EXTRACTION_FAILED regardless of the tag.
// Returns the corrected status to apply to the global.
export function resolveExtractorStatus(parsedStatus) {
  try {
    const meta = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'project_meta.json'), 'utf8'));
    if (meta && meta.failure_reason) {
      if (parsedStatus !== 'EXTRACTION_FAILED') {
        console.warn(`[extractor-gate] project_meta.failure_reason="${meta.failure_reason}" but tag was "${parsedStatus ?? 'missing'}" — forcing EXTRACTION_FAILED`);
      }
      return 'EXTRACTION_FAILED';
    }
  } catch (e) {
    console.warn(`[extractor-gate] could not read project_meta.json: ${e.message}`);
  }
  return parsedStatus;
}

// Clear the Extractor's failure markers BEFORE each Extractor (re)dispatch, deterministically.
// `failure_reason`/`alternate_name_detected` are normally deleted by the Extractor on success
// (extractor instructions:462) — but that delete is LLM-executed and may be skipped, which would
// leave the post-return gate forcing EXTRACTION_FAILED on a successful re-run (deadlock). Clearing
// server-side at dispatch makes each attempt start clean. `pending_name_resolution` is intentionally
// preserved — MO writes it for the Extractor to consume during name-mismatch recovery.
export function clearExtractorFailure() {
  try {
    const p = join(WORKSPACE_DIR, 'project_meta.json');
    const meta = JSON.parse(readFileSync(p, 'utf8'));
    if (meta.failure_reason == null && meta.alternate_name_detected == null) return;
    delete meta.failure_reason;
    delete meta.alternate_name_detected;
    writeFileSync(p, JSON.stringify(meta, null, 2), 'utf8');
    console.log('[extractor-gate] cleared stale failure markers before Extractor dispatch');
  } catch (e) {
    console.warn(`[extractor-gate] could not clear failure markers: ${e.message}`);
  }
}

// Hand the authoritative pipeline status to the Main Orchestrator. The MO node is a KEMU
// agent — it can only read globals or files, not the server's in-memory `state.pipelineStatus`.
// Routing now lives in the backend, so MO must NOT source its phase from the (stale-prone)
// `context.pipeline_status` global. Instead the server writes the current status to
// mo_dispatch.json immediately before every MO invocation; MO reads it as its single source
// of truth. Always fresh at read time (synchronous write before the node call), so a prior
// run's status can never leak into a new session.
export function writeMODispatch(status) {
  try {
    writeFileSync(
      join(WORKSPACE_DIR, 'mo_dispatch.json'),
      JSON.stringify({ pipeline_status: status ?? null, dispatched_at: new Date().toISOString() }, null, 2),
      'utf8',
    );
  } catch (e) {
    console.warn(`[mo-dispatch] could not write mo_dispatch.json: ${e.message}`);
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

// NOTE: the old server-orchestrated `_runValidator` gate was removed (2026-06-16). Both the Analyst and the
// Tone Analyst now call their validators (analyst_validator / tone_validator) inline as tools and own their
// own one-shot REJECT/retry loops. Assembly validation still runs server-side via `_runAssemblyValidator`.

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

// Assembly section agent → assembly-validator module key. Agents with no module (Skills Curator,
// Credentials Formatter, Style Reviewer, Integrity Checker) are intentionally absent → skipped.
const ASSEMBLY_VALIDATOR_AGENT = {
  'Style Negotiator':    'style_negotiator',
  'Profile Builder':     'profile_builder',
  'History Formatter':   'history_formatter',
  'Cover Letter Writer': 'coverletter_writer',
};

// Advisory assembly validator — fires after a section is produced/merged, BEFORE the human Approve/Revise.
// APPROVE/FLAG only: it never re-runs an agent (the human owns the gate), so there is no REJECT/retry path.
// Returns FLAG notes to thread into the review bubble, or '' otherwise.
async function _runAssemblyValidator(phaseAgent) {
  const agentKey = ASSEMBLY_VALIDATOR_AGENT[phaseAgent];
  if (!agentKey) return '';
  try {
    await sendToNodeAndWait('assembly_validator_input', 'Validator', agentKey);
    const verdict = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'assembly_validator_verdict.json'), 'utf8'));
    console.log(`[Validator] verdict=${verdict.verdict} for ${agentKey} (${verdict.issues?.length ?? 0} issue(s))`);
    if (verdict.verdict === 'FLAG' && (verdict.issues || []).length) {
      return (verdict.issues || []).map(i => `• ${i.field}: ${i.problem}`).join('\n');
    }
  } catch (err) {
    console.error('[Validator] assembly error:', err.message);
  }
  return '';
}

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
  const result = await sendToNodeAndWait(phase.inputNode, phase.agent, `__build__${ctx}`);
  const { cleanText } = parseAndStripStatus(typeof result === 'string' ? result : JSON.stringify(result ?? ''));
  broadcastAgentResult(cleanText, phase.agent, true);

  await new Promise(r => setTimeout(r, 1000));

  if (phaseNumber <= 6 || phaseNumber === 9) {
    await mergePhaseOutput(phaseNumber);
    const notes = await _runAssemblyValidator(phase.agent);
    _showApproveRevise(phase.agent, notes);
    return;
  }

  // SR (7) and IC (8) — gate check (they write cv_assembly_state.json themselves)
  await _handleGate(phaseNumber);
}

// SN is now a single-fire stylist (same offload pattern as fit-score / reviewer-audit / tone-validation).
// It fires ONCE, authoring sn_groups.json (tailored finding/recommendation/insight + override directives
// per style dimension). The server enforces the mandatory-dimension floor, stamps the seniority factual
// anchor (LLM can't mint the number), drives a client modal, and merges the user's choices — no multi-turn
// loop, no LLM-executed pseudocode.
async function _startSNInterview() {
  state.currentAssemblyPhase = 1;
  state.snState = null;
  broadcastMode('auto_running', 'Style Negotiator');

  // Fire SN once — it writes sn_groups.json. SN is silent (like TA / the gap interview): the modal
  // carries all the content, so we discard its text output.
  try {
    await sendToNodeAndWait('style_negotiator_input', 'Style Negotiator', '__style_analyze__');
  } catch (e) {
    console.error('[SN] node error:', e.message);
  }
  await new Promise(r => setTimeout(r, 1000));

  let groups = [];
  try {
    groups = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'sn_groups.json'), 'utf8'));
    if (!Array.isArray(groups)) groups = [];
  } catch { groups = []; }

  let meta = {}, findings = {};
  try { meta     = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'project_meta.json'),   'utf8')); } catch {}
  try { findings = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'style_findings.json'), 'utf8')); } catch {}

  // Server owns the mandatory floor + the seniority factual anchor.
  groups = enforceSNFloor(groups, meta, findings);
  stampSeniorityOverride(groups, findings);

  if (groups.length === 0) {
    // Degenerate fallback — no LLM output and no findings to floor from. Auto-approve, skip the modal.
    await _autoApproveSN(findings);
    return;
  }

  // Persist the full groups (override directives stay server-side); the client gets display fields only,
  // re-read on submit — same trust model as gap_answers_submit re-reading gap_analysis.json.
  writeFileSync(join(WORKSPACE_DIR, 'sn_working.json'), JSON.stringify({ groups, decisions: {} }, null, 2));
  state.snState = 'modal';
  broadcast({
    type: 'style_interview_start',
    groups: groups.map(g => ({
      id: g.id, title: g.title, finding: g.finding,
      examples: g.examples ?? [], recommendation: g.recommendation, insight: g.insight ?? '',
    })),
  });
  broadcastMode('action_required');
}

// Mandatory-dimension floor: Seniority is always raised (controls tone everywhere); Key Achievements is
// required for senior roles. These are safety-net injections — the LLM normally supplies them with richer
// prose. Returns the patched array (does not mutate the input).
export function enforceSNFloor(groups, meta = {}, findings = {}) {
  const out = Array.isArray(groups) ? [...groups] : [];
  const has = id => out.some(g => g && g.id === id);

  if (!has('seniority') && findings.seniority) {
    const s = findings.seniority;
    const level = s.level || 'Mid-Level';
    out.unshift({
      id: 'seniority',
      title: 'Seniority & Career Level',
      finding: `Inferred level: ${level}. ${s.evidence || 'Based on work-history dates.'}`,
      examples: [],
      recommendation: `Confirm as ${level} — this controls tone, assertiveness, and how responsibilities are framed throughout the CV.`,
      insight: 'Seniority framing is the single biggest lever on how a recruiter reads every bullet.',
      recommended_overrides: { seniority_level: `${level} (confirmed by user)` },
    });
  }

  const roleName = meta.position_title || '';
  const isSeniorRole = /grade\s*[456789]|band\s*[456789]|cns|clinical nurse specialist|senior\s+nurse|specialist|manager|director|lead|principal|head\s+of/i.test(roleName);
  if (isSeniorRole && !has('key_achievements')) {
    out.push({
      id: 'key_achievements',
      title: 'Key Achievements Section',
      finding: `Senior role detected (${roleName || 'this role'}) — a Key Achievements section is standard at this level.`,
      examples: [],
      recommendation: 'Add a Key Achievements section (2–3 bolded, quantified bullets) immediately after the profile paragraph.',
      insight: 'Senior-role screens run under 30 seconds — this section is the primary attention anchor.',
      recommended_overrides: { key_achievements_section: 'Include Key Achievements section — 2–3 bullet points with bold metrics immediately after profile paragraph' },
    });
  }
  return out;
}

// The seniority card's user-facing number is server-owned, not LLM-minted (anti-hallucination). Overwrite
// recommended_overrides.seniority_level with the string built verbatim from style_findings.seniority.
export function stampSeniorityOverride(groups, findings = {}) {
  const g = (groups || []).find(x => x && x.id === 'seniority');
  if (!g) return groups;
  const s = findings.seniority || {};
  const level  = s.level || 'Mid-Level';
  const relStr = s.relevant_years_experience != null ? `${s.relevant_years_experience} relevant` : null;
  const totStr = s.years_experience          != null ? `${s.years_experience} total` : null;
  const yearsStr = [relStr, totStr].filter(Boolean).join(' / ') || 'experience unspecified';
  g.recommended_overrides = g.recommended_overrides || {};
  g.recommended_overrides.seniority_level = `${level} (${yearsStr} yrs — confirmed by user)`;
  return groups;
}

// Deterministic port of the old SN Phase 7 merge. Reads sn_working.json, applies the user's per-group
// choice, folds in the optional severity-tagged note, writes the phase-1 sn_output.json. Idempotent.
const SN_SEVERITY_PREFIX = { high: 'MUST', medium: 'PREFER', low: 'OPTIONAL' };

export function buildSNOutput(answers = {}) {
  const working = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'sn_working.json'), 'utf8'));
  const groups = working.groups || [];

  const agreed = {};
  let recCount = 0, keepCount = 0, customCount = 0;
  for (const g of groups) {
    const a = answers[g.id] || { choice: 'recommended' };
    if (a.choice === 'recommended') {
      Object.assign(agreed, g.recommended_overrides || {});
      recCount++;
    } else if (a.choice === 'customise' && a.custom_text?.trim()) {
      agreed[`${g.id}_custom`] = a.custom_text.trim();
      customCount++;
    } else {
      keepCount++; // keep_current, or customise with empty text → treated as keep
    }
  }

  // Optional free-text note with a user-chosen severity → a priority-prefixed directive the downstream
  // assembly agents naturally weight (no schema change — agreed_overrides is already directive strings).
  const note = answers.__note__;
  if (note && note.text?.trim()) {
    const prefix = SN_SEVERITY_PREFIX[note.severity] || 'PREFER';
    agreed.user_note = `[${prefix}] ${note.text.trim()}`;
  }

  let findings = {};
  try { findings = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'style_findings.json'), 'utf8')); } catch {}
  const p = findings.style_patterns || {};
  const originalStyle = {
    tense: p.tense, voice: p.voice, bullet_format: p.bullet_format,
    uses_pronouns_i: p.uses_pronouns_i, uses_full_sentences: p.uses_full_sentences,
    formality_level: p.formality_level,
    seniority_inferred: findings.seniority?.level,
    years_experience: findings.seniority?.years_experience,
  };

  const overrideCount = Object.keys(agreed).length;
  const outcome = overrideCount > 0 ? 'OVERRIDES_APPLIED' : 'NO_CHANGES';
  const summary = `${overrideCount} override(s) applied across ${groups.length} style dimension(s). ` +
    `${recCount} recommended, ${keepCount} kept as-is, ${customCount} customised.` +
    (note?.text?.trim() ? ` User note added (${note.severity || 'medium'}).` : '') +
    ` Outcome: ${outcome}.`;

  const output = {
    phase_number: 1,
    phase_name:   'Style Negotiation',
    agent:        'Style Negotiator',
    status:       'COMPLETE',
    completed_at: new Date().toISOString(),
    data: {
      agreed_overrides:    agreed,
      negotiation_outcome: outcome,
      negotiation_summary: summary,
      original_style:      originalStyle,
      user_confirmed:      true,
    },
  };
  writeFileSync(join(WORKSPACE_DIR, 'sn_output.json'), JSON.stringify(output, null, 2));
  return output;
}

// Called by the style_answers_submit action — finalize the phase entirely server-side (no LLM call).
export async function submitSNAnswers(answers) {
  buildSNOutput(answers);
  await mergePhaseOutput(1);
  const notes = await _runAssemblyValidator('Style Negotiator');
  await _advanceFromSN(notes);
}

async function _autoApproveSN(findings = {}) {
  const p = findings.style_patterns || {};
  const output = {
    phase_number: 1, phase_name: 'Style Negotiation', agent: 'Style Negotiator',
    status: 'COMPLETE', completed_at: new Date().toISOString(),
    data: {
      agreed_overrides: {
        bold_achievements:   'Bold numeric metrics and key results in work history bullets',
        improve_conciseness: 'Keep bullets concise — under 18 words where possible',
      },
      negotiation_outcome: 'NO_ISSUES_FOUND',
      negotiation_summary: 'No style findings available — default professional overrides applied.',
      original_style: { tense: p.tense, voice: p.voice, bullet_format: p.bullet_format },
      user_confirmed: true,
    },
  };
  writeFileSync(join(WORKSPACE_DIR, 'sn_output.json'), JSON.stringify(output, null, 2));
  await mergePhaseOutput(1);
  const notes = await _runAssemblyValidator('Style Negotiator');
  broadcast({ type: 'agent_message', agent: 'Style Negotiator', text: 'No significant style issues found — default professional enhancements applied.' });
  await _advanceFromSN(notes);
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

function _showApproveRevise(agentName, notes = '') {
  if (notes) {
    broadcast({ type: 'agent_message', agent: 'System', background: true,
      text: `⚠ Validator notes on this ${agentName} section (review before approving):\n${notes}` });
  }
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

// SN done → straight into Profile Builder. No "Continue → Build CV" button.
// PB is dispatched DETACHED on a fresh tick: the SN-submit request already spent
// one KEMU round-trip on the assembly validator, and KEMU hangs if a second
// sendToInputWidgetAndWaitForOutput is chained in the same request. Firing PB
// after the request settles restores the old two-request (button) shape.
function _advanceFromSN(notes = '') {
  if (notes) {
    broadcast({ type: 'agent_message', agent: 'System', background: true,
      text: `⚠ Validator notes on the style negotiation:\n${notes}` });
  }
  state.snState = null;
  setTimeout(() => {
    dispatchAssemblyPhase(2).catch(err =>
      console.error('[advanceFromSN] Profile Builder dispatch failed:', err.message));
  }, 500);
}
