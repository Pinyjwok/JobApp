import { readFileSync, writeFileSync, existsSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { WORKSPACE_DIR, ASSEMBLY_PHASES, EXPECTED_STATUS, AGENT_FOREGROUND, COMPLETION_CONTRACTS } from '../config/constants.js';
import { state } from './state.js';
import { broadcast, broadcastMode, broadcastAgentResult, parseAndStripStatus } from './broadcast.js';
import { sendToNodeAndWait } from './node-communication.js';
import { adjudicateGapAnswers } from './adjudicator.js';

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

// ── File-driven completion (replaces the fragile `pipeline_status:` prose tag) ─────────────────

// Faithful port of Researcher Phase 4 quality assessment (researcher_agent_instructions.md:302-346).
// The pseudocode collapses: both COMPLETE branches are identical and totalWithData never changes the
// outcome — the real signal is validCount over the 5 required fields at their min floors. Max ceilings
// are intentionally dropped (over-length data is still real; downgrading it would be perverse). Server
// owns this math rather than trusting Flash to hand-count validCount + emit the right enum.
export function researchQuality(data) {
  const rd = data?.research_data;
  if (rd == null) return 'RESEARCH_FAILED';
  const strOK = (s, min) => typeof s === 'string' && s.trim().length >= min;
  const arrOK = (a, min) => Array.isArray(a) && a.length >= min;
  let valid = 0;
  if (strOK(rd.mission_values,   50))  valid++;
  if (strOK(rd.culture_overview, 100)) valid++;
  if (arrOK(rd.key_strengths,     2))  valid++;
  if (strOK(rd.strategic_plan,   100)) valid++;
  if (strOK(rd.interview_focus,  100)) valid++;
  return valid >= 5 ? 'RESEARCH_COMPLETE'
       : valid >= 3 ? 'RESEARCH_PARTIAL'
       : 'RESEARCH_FAILED';
}

// Core predicate for both the linear resolver and the analysis join. The node round-trip already told
// us the agent FINISHED; this tells us it actually produced its artifact THIS turn. Bounded poll (mirror
// checkJoin's 20×100ms) for the contract file, requiring:
//   1. mtime >= dispatchStart — a stale file from a prior run (redo/resume reuse the same filenames)
//      cannot satisfy the guard; the fresh write must land first.
//   2. the contract's ready(data) shape check — rejects the {} scaffold / a clarifying-question turn.
// Returns { ready, data }. No contract → { ready: true, data: null } (caller falls back to inference).
//
// This is also where the artifact's completion timestamp is stamped (contract.stamp): the moment
// freshness is proven is the truest "the agent finished" time available, and stamping at this single
// choke point means no agent-written date can reach disk as a raw `__DATE_TODAY__` token. `data` is
// returned pre-stamp — no caller reads a timestamp off it, they re-read the file.
export async function awaitOutputReady(agentName, dispatchStart = 0) {
  const contract = COMPLETION_CONTRACTS[agentName];
  if (!contract) return { ready: true, data: null };
  const path = join(WORKSPACE_DIR, contract.file);
  for (let i = 0; i < 20; i++) {
    try {
      if (existsSync(path) && statSync(path).mtimeMs >= dispatchStart) {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        if (contract.ready(parsed)) {
          if (contract.stamp) stampTimestamp(contract.file, contract.stamp);
          return { ready: true, data: parsed };
        }
      }
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  console.warn(`[${agentName}] output file ${contract.file} never became ready (fresh + shape-valid)`);
  return { ready: false, data: null };
}

// Linear-agent status resolution from the output file (not the tag). Waits for the artifact, then
// derives the next pipeline_status from its content. Returns { status, ready }; ready:false means no
// usable output landed (caller should surfaceStall). Agents with no contract fall back to the existing
// EXPECTED_STATUS inference.
export async function resolveStatusFromOutput(agentName, dispatchStart = 0) {
  if (!COMPLETION_CONTRACTS[agentName]) return { status: resolveAgentStatus(agentName, null), ready: true };
  const { ready, data } = await awaitOutputReady(agentName, dispatchStart);
  if (!ready) return { status: null, ready: false };
  let status;
  if (agentName === 'Extractor')       status = resolveExtractorStatus('INITIALIZED'); // failure_reason override wins
  else if (agentName === 'Researcher') status = researchQuality(data);
  else if (agentName === 'JD Enhancer')status = 'JD_ENHANCED';
  else                                 status = resolveAgentStatus(agentName, null);
  return { status, ready: true };
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
    actions: [{ id: 'retry_last_dispatch', label: 'Try that step again', variant: 'primary' }],
  });
  broadcastMode('action_required');
}

// Consolidated fire → advance for the linear happy-path agents. Registers a retry thunk, then takes
// the next status from the agent's OUTPUT FILE (resolveStatusFromOutput) — not the fragile prose tag —
// and either advances (setValue → onChange drives the next step) or surfaces a stall. parseAndStripStatus
// is kept only to clean the display text.
export async function runLinearDispatch({ node, agent, query = '__auto__', foreground }) {
  state.retryThunk = () => runLinearDispatch({ node, agent, query, foreground });
  const fg = foreground ?? AGENT_FOREGROUND.has(agent);
  broadcastMode('auto_running', agent);
  const dispatchStart = Date.now();
  try {
    const r = await sendToNodeAndWait(node, agent, query);
    const { cleanText } = parseAndStripStatus(typeof r === 'string' ? r : (r != null ? JSON.stringify(r) : ''));
    broadcastAgentResult(cleanText, agent, fg);
    const { status, ready } = await resolveStatusFromOutput(agent, dispatchStart);
    if (ready && status) {
      await state.recipe.globalVariables.setValue('pipeline_status', status);
      state.pipelineStatus = status;
    } else {
      surfaceStall(agent, new Error(`no usable ${agent} output on disk`));
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
    console.error('[Analysis · clear-stale] could not remove gap_analysis.json:', err);
  }
}

// ── Seniority year arithmetic — server-owned (deterministic-offload) ──────────
// The Tone Analyst used to compute per-role durations + total/relevant years itself. That math is
// deterministic but the LLM is bad at it: it estimated "today" to resolve `Present`, re-summed on
// every reasoning pass, and never converged (8.25/8.3/8.4/12.3…) — a cyclic-reasoning loop. Per the
// project's deterministic-offload principle, the math moves here; the TA keeps ONLY the judgment:
// per-role relevance + recent-graduate flag (in style_findings.seniority.role_classification[]).
// Mirrors the fit-score offload (LLM tags, server computes the number). Fault-tolerant: any missing
// input leaves the TA's own values untouched (back-compat with pre-offload output).
const MONTH_ABBR = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
// Parse a work-history date to { y, mo } (or 'NOW' for ongoing, null if unparseable). The Extractor now
// stores dates VERBATIM (it no longer computes durations — that's server-owned), so this tolerates the
// common shapes a CV actually uses: 2025-03, 2025/03, 03/2025, "March 2025", "Mar 2025", bare 2025, and
// "Present"/"Current"/"ongoing". Kept lenient on purpose — it only ever runs on date fields.
const validMonth = mo => mo >= 1 && mo <= 12;
function parseYearMonth(s) {
  if (!s) return null;
  const str = String(s).trim();
  // An ongoing marker wins outright, even alongside a year ("2020 - Present" as an end_date means
  // ongoing, not 2020). A year-guard here would fall through to the bare-year rule below and date the
  // role's end to mid-2020, silently truncating every current role by its whole tenure.
  if (/\b(present|current|now|ongoing|to\s*date)\b/i.test(str)) return 'NOW';
  // Each shape falls through to the next when the month is out of range, so a malformed "2025-13"
  // degrades to the bare-year rule rather than yielding month 13.
  let m = str.match(/\b(\d{4})[-/](\d{1,2})\b/);          // 2025-03 / 2025/03
  if (m && validMonth(+m[2])) return { y: +m[1], mo: +m[2] };
  m = str.match(/\b(\d{1,2})[-/](\d{4})\b/);              // 03/2025
  if (m && validMonth(+m[1])) return { y: +m[2], mo: +m[1] };
  m = str.match(/([A-Za-z]{3,})\.?\s+(\d{4})/);           // March 2025 / Mar 2025
  if (m) { const mo = MONTH_ABBR[m[1].slice(0, 3).toLowerCase()]; if (mo) return { y: +m[2], mo }; }
  m = str.match(/\b(\d{4})\b/);                            // bare 2025
  if (m) return { y: +m[1], mo: 6 };                      // mid-year midpoint when only a year is given
  return null;
}

// Years between a role's start and end, or null when the start date can't be read at all. A missing or
// unparseable END date still means "ongoing" (the common "Present" case), but without a start there is
// nothing to measure from — null, never 0. Callers must treat null as unknown, not as zero tenure.
function roleDurationYears(role) {
  const start = parseYearMonth(role.start_date);
  if (!start || start === 'NOW') return null;
  const endRaw = parseYearMonth(role.end_date);
  const now = new Date();
  const end = (!endRaw || endRaw === 'NOW') ? { y: now.getFullYear(), mo: now.getMonth() + 1 } : endRaw;
  const months = (end.y - start.y) * 12 + (end.mo - start.mo);
  return months > 0 ? Math.round((months / 12) * 10) / 10 : 0;
}

// Server owns per-role duration math (deterministic — was Extractor Phase 4.3, a Flash-hand-computed
// float and a hallucination source, same class as the Tone Analyst seniority loop). After a successful
// extraction, read candidate_profile.json, compute duration_years for each work_history role from its
// verbatim start/end dates, and write them back. Consumers are unchanged (Analyst min-years gap +
// History Formatter read work_history[].duration_years). Idempotent; safe to call on every Extractor return.
export function computeRoleDurations() {
  const p = join(WORKSPACE_DIR, 'candidate_profile.json');
  let profile;
  try { profile = JSON.parse(readFileSync(p, 'utf8')); } catch { return; }
  const work = profile.work_history;
  if (!Array.isArray(work) || !work.length) return;
  let changed = false;
  for (const role of work) {
    if (!role || typeof role !== 'object') continue;
    const dur = roleDurationYears(role);
    // Unreadable start date → leave duration_years off the role entirely. Writing 0 would assert
    // "spent no time here", and the Analyst sums this field for its minimum-years requirement check —
    // a 0 there turns a qualified candidate into a false Gap. Absent reads as unknown; 0 reads as a lie.
    if (dur == null) {
      console.warn(`[durations] ${role.employer ?? '?'} — ${role.position ?? '?'}: cannot read start_date ` +
                   `(start="${role.start_date ?? ''}" end="${role.end_date ?? ''}"), leaving duration_years unset`);
      if ('duration_years' in role) { delete role.duration_years; changed = true; }
      continue;
    }
    if (role.duration_years !== dur) { role.duration_years = dur; changed = true; }
  }
  if (changed) { try { writeFileSync(p, JSON.stringify(profile, null, 2)); } catch (e) { console.warn(`[durations] write failed: ${e.message}`); } }
}

const normEmployer = e => String(e || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ── Verbatim matching ────────────────────────────────────────────────────────
// Fold the cosmetic differences that make an exact substring match false-negative on real CV text:
// smart quotes/apostrophes, em/en dashes, collapsed whitespace, case. A "verbatim" quote that differs
// only by a curly apostrophe is still verbatim — this is the one thing that made an LLM tempting here.
function normalizeForMatch(s) {
  return String(s || '')
    .replace(/[‘’‚‛]/g, "'")   // ' ' ‚ ‛ → '
    .replace(/[“”„‟]/g, '"')   // " " „ ‟ → "
    .replace(/[‒-―−]/g, '-')        // ‒ – — ― − → -
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ── Tone validation — server-owned (deterministic-offload) ───────────────────
// The Tone Analyst used to call a tone_validator LLM sub-agent to confirm every quote it emitted is
// verbatim in the source. That check is pure string matching → it moved here. The register-enum check
// and the regex coherence heuristics were dropped (synthesizeStyleGuide already defaults a bad register
// gracefully; the heuristics were advisory noise). Remediation is deterministic: an ungrounded quote is
// the TA's own captured data, so we simply DROP it (IC server-strip pattern) — no LLM REJECT/retry.
// Writes tone_validator_verdict.json so the Style Negotiator's findings_for_sn read is unchanged.
export function runToneValidation() {
  let findings;
  try { findings = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'style_findings.json'), 'utf8')); } catch { return null; }
  let cvRaw = '', cover = '';
  try { cvRaw = readFileSync(join(WORKSPACE_DIR, 'cv_raw.txt'), 'utf8'); } catch {}
  try { cover = readFileSync(join(WORKSPACE_DIR, 'cover_letter_sample.txt'), 'utf8'); } catch {}
  const source = normalizeForMatch(cvRaw + '\n' + cover);
  const inSource = q => typeof q === 'string' && q.trim().length > 0 && source.includes(normalizeForMatch(q));

  const dropped = [];
  const sp = findings.style_patterns || {};

  // flagged_issues[].original — drop any whose quoted text isn't in the source
  if (Array.isArray(findings.flagged_issues)) {
    findings.flagged_issues = findings.flagged_issues.filter(iss => {
      const q = iss && (iss.original || iss.example || iss.quoted_text);
      if (q && q.trim() && !inSource(q)) { dropped.push({ field: 'flagged_issues.original', quote: String(q).slice(0, 60) }); return false; }
      return true;
    });
  }
  // style_patterns proofs — blank an ungrounded proof, keep the classification
  for (const key of ['ownership_framing', 'content_focus', 'persuasion_strategy']) {
    const node = sp[key];
    if (node && typeof node === 'object' && node.proof && !inSource(node.proof)) {
      dropped.push({ field: `style_patterns.${key}.proof`, quote: String(node.proof).slice(0, 60) });
      node.proof = '';
    }
  }
  // signature_phrases.phrases[] — would seed the CV voice from invented phrasing; drop the ungrounded
  if (sp.signature_phrases && Array.isArray(sp.signature_phrases.phrases)) {
    sp.signature_phrases.phrases = sp.signature_phrases.phrases.filter(p => {
      if (p && p.trim() && !inSource(p)) { dropped.push({ field: 'signature_phrases.phrases', quote: String(p).slice(0, 60) }); return false; }
      return true;
    });
  }
  // examples[] — drop ungrounded
  if (Array.isArray(sp.examples)) {
    sp.examples = sp.examples.filter(ex => {
      if (ex && ex.trim() && !inSource(ex)) { dropped.push({ field: 'style_patterns.examples', quote: String(ex).slice(0, 60) }); return false; }
      return true;
    });
  }

  if (dropped.length) writeFileSync(join(WORKSPACE_DIR, 'style_findings.json'), JSON.stringify(findings, null, 2));

  const verdict = {
    verdict: dropped.length ? 'FLAG' : 'APPROVE',
    agent: 'tone_analyst',
    issues: dropped.map(d => ({ field: d.field, problem: `Quote "${d.quote}…" not found verbatim in source - dropped`, severity: 'resolved' })),
    findings_for_sn: [],
    summary: `${dropped.length} ungrounded quote(s) stripped server-side.`,
  };
  writeFileSync(join(WORKSPACE_DIR, 'tone_validator_verdict.json'), JSON.stringify(verdict, null, 2));
  return verdict;
}

// Compute total + relevant years from candidate_profile dates and the TA's per-role relevance tags,
// then write them into style_findings.seniority. Returns the computed { years, relevant } or null.
export function computeSeniorityYears() {
  let findings, profile;
  try { findings = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'style_findings.json'), 'utf8')); } catch { return null; }
  try { profile  = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'candidate_profile.json'), 'utf8')); } catch { return null; }
  const sen = findings.seniority;
  const work = profile.work_history;
  if (!sen || typeof sen !== 'object' || !Array.isArray(work) || !work.length) return null;

  // TA's judgment: per-role { employer, relevant, is_employment }. Match by normalized employer.
  const tags = Array.isArray(sen.role_classification) ? sen.role_classification : [];
  const tagFor = (employer) => {
    const ne = normEmployer(employer);
    return tags.find(t => {
      const nt = normEmployer(t.employer);
      return nt && ne && (nt === ne || nt.includes(ne) || ne.includes(nt));
    });
  };

  let total = 0, relevant = 0;
  for (const role of work) {
    const dur = roleDurationYears(role);
    if (!dur) continue;
    const tag = tagFor(role.employer);
    // A career break / non-employment role is excluded from total unless the TA didn't tag it.
    if (tag && tag.is_employment === false) continue;
    total += dur;
    if (tag && tag.relevant === true) relevant += dur;
  }
  total = Math.round(total * 10) / 10;
  relevant = Math.round(relevant * 10) / 10;

  // career_stage band from relevant years; recent-graduate is the TA's judgment override (it stays
  // Junior regardless of relevant years). Only set the band when the TA didn't flag recent-grad.
  const band = relevant < 3 ? 'early-career' : relevant < 8 ? 'established' : relevant < 15 ? 'senior' : 'senior-leader';
  sen.years_experience = total;
  sen.relevant_years_experience = relevant;
  if (sen.is_recent_graduate === true) sen.career_stage = 'recent-graduate';
  else if (!sen.career_stage) sen.career_stage = band;
  else if (sen.career_stage !== 'recent-graduate') sen.career_stage = band;

  writeFileSync(join(WORKSPACE_DIR, 'style_findings.json'), JSON.stringify(findings, null, 2));
  return { years: total, relevant };
}

export function fireTAAndAnalyst() {
  state.analystDone = false;
  state.taDone      = false;
  state.analystOutputText = null;
  broadcastMode('auto_running', 'Analysis');
  state.recipe.globalVariables.setValue('pipeline_status', 'PARALLEL_ANALYSIS');
  state.pipelineStatus = 'PARALLEL_ANALYSIS';
  const dispatchStart = Date.now();  // mtime freshness floor — a stale prior-run file can't satisfy the guard
  // One combined header for the parallel pair (both run in the background, completions land separately
  // below). quietBanner suppresses each node's own start banner so the group reads cleanly; logLabel
  // names the Analyst in the console without switching AgentSelector (it stays a zero-output bg agent).
  const RULE = '─'.repeat(72);
  console.log(`\n┌${RULE}`);
  console.log('│ ▶ PARALLEL ANALYSIS (background) — starting both:');
  console.log('│    · Tone Analyst  → node:tone_analyst_input       (timeout 180s)');
  console.log('│    · Analyst       → node:analyst_background_input (timeout 600s)');
  console.log(`└${RULE}`);
  sendToNodeAndWait('tone_analyst_input', 'Tone Analyst', '__tone_analysis__', 'default', { quietBanner: true })
    .then(async r => {
      const raw = typeof r === 'string' ? r : (r != null ? JSON.stringify(r) : '');
      const { cleanText } = parseAndStripStatus(raw);
      broadcastAgentResult(cleanText, 'Tone Analyst', false);
      // taDone now flips on the FILE, not the prose tag. The common failure was TA writing
      // style_findings.json but dropping the `pipeline_status:` tag → taDone stayed false → the
      // analysis join hung silently. Gate on a fresh, shape-valid file instead.
      const { ready } = await awaitOutputReady('Tone Analyst', dispatchStart);
      if (ready) {
        // Server-owned post-processing (only meaningful once real findings exist): strip ungrounded
        // quotes (runToneValidation, was the tone_validator LLM node) and compute seniority years (kills
        // the cyclic-reasoning loop; TA only tags relevance). analyzed_at is already stamped by
        // awaitOutputReady above, via the contract.
        runToneValidation();
        computeSeniorityYears();
        state.taDone = true;
        await checkJoin();
      } else {
        console.warn('[Tone Analyst] style_findings.json not fresh/valid — analysis join cannot advance');
      }
    })
    .catch(err => console.error('[Tone Analyst] error:', err));
  sendToNodeAndWait('analyst_background_input', null, '__analyze__', 'default', { quietBanner: true, logLabel: 'Analyst' })
    .then(async r => {
      const raw = typeof r === 'string' ? r : (r != null ? JSON.stringify(r) : '');
      const { cleanText } = parseAndStripStatus(raw);
      state.analystOutputText = cleanText; // validator is now called as a tool by the Analyst itself
      // The inline analyst_validator writes analyst_validator_verdict.json as the source of truth.
      // Read it here so checkJoin can surface a compact verdict bubble to the user (the validator
      // is otherwise invisible — it runs inside the LLM node, the server never fires it).
      state.analystValidatorSummary = buildAnalystValidatorSummary();
      state.analystDone = true;
      syncTADone();
      await checkJoin();
    })
    .catch(err => console.error('[Analyst] error:', err));
}

// Read the analyst validator's verdict file and render a compact one-liner for the UI.
// Returns null if the file is missing/unreadable/empty (e.g. validator never ran).
function buildAnalystValidatorSummary() {
  try {
    const verdict = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'analyst_validator_verdict.json'), 'utf8'));
    if (!verdict || !verdict.verdict) return null;
    const issues = verdict.issues ?? verdict.notes ?? [];
    const count = issues.length;
    let text = `🔍 **Validator: ${verdict.verdict}** - ${count} issue${count === 1 ? '' : 's'}`;
    if ((verdict.verdict === 'FLAG' || verdict.verdict === 'REJECT') && count) {
      text += '\n' + issues.map(i => `• ${i.field}: ${i.problem ?? i.note}`).join('\n');
    }
    return text;
  } catch (err) {
    console.error('[Analyst · validator] verdict read error:', err.message);
    return null;
  }
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
  // "Pending" = procedural statutory item the candidate can acquire at hire (WWCC, police check, visa).
  // It is neither a met capability nor a true gap, so it must leave the scored set entirely — excluded
  // from the baseline/differentiator denominator AND from the mandatory-cert gate below. The semantic
  // decision of *what* is Pending lives in the Analyst; the server only does the deterministic math.
  const isPending = r => r.candidate_status === 'Pending';
  // Scored set = genuine requirements only (tier filter + source guard against responsibility mislabeling).
  const baseline = reqs.filter(r => r.tier === 'Baseline' && !isResponsibility(r) && !isPending(r));
  const differentiator = reqs.filter(r => r.tier === 'Differentiator' && !isResponsibility(r) && !isPending(r));
  const baselineMet = baseline.filter(isMet).length;
  const differentiatorMet = differentiator.filter(isMet).length;

  const tag = gapAnalysis.role_strictness;
  const weights = STRICTNESS_WEIGHTS[tag] ?? STRICTNESS_WEIGHTS.STANDARD;
  if (!STRICTNESS_WEIGHTS[tag]) {
    console.warn(`[Analysis · fit-score] unknown role_strictness="${tag}" — defaulting to STANDARD`);
  }

  const baselineScore = baseline.length > 0 ? (baselineMet / baseline.length) * weights.baseline : 0;
  const differentiatorScore = differentiator.length > 0 ? (differentiatorMet / differentiator.length) * weights.differentiator : 0;
  let total = Math.round((baselineScore + differentiatorScore) * 10) / 10;

  // Mandatory-cert gate: an unmet statutory "condition of employment" caps the score. Flag-driven,
  // with a keyword fallback so it fires even if the Analyst omits mandatory_gate.
  // Gate only on Baseline (required) items — a statutory mention under preferred qualifications is a
  // nice-to-have and must not cap the score. _computeTier guards against an Analyst tier mislabel here,
  // since this runs before the _repairGapAnalysis retier pass.
  const gateApplied = reqs.some(r =>
    !isResponsibility(r) && !isPending(r) && !isMet(r) && (_computeTier(r) ?? r.tier) === 'Baseline' &&
    (r.mandatory_gate === true || STATUTORY_CERT.test(String(r.requirement_text ?? ''))));
  if (gateApplied && total > GATE_CEILING) total = GATE_CEILING;

  console.log(`[Analysis · fit-score] strictness=${tag ?? 'STANDARD(default)'} baseline=${baselineScore.toFixed(2)} diff=${differentiatorScore.toFixed(2)} gated=${gateApplied} total=${total}`);
  return { score: total, gateApplied };
}

export function applyFitScore(gapAnalysisPath) {
  const gapAnalysis = JSON.parse(readFileSync(gapAnalysisPath, 'utf8'));
  const { score, gateApplied } = calculateFitScore(gapAnalysis);
  // Idempotent: strip any prior "Fit Score: X/10 — " prefix and trailing gate marker before reapplying.
  const qualitative = String(gapAnalysis.fit_rationale ?? '')
    .replace(/^Fit Score: \d+(\.\d+)?\/10\s*[—-]\s*/, '')
    .replace(/\s*\(capped [—-] unmet mandatory credential\)\s*$/, '')
    .trim();
  const marker = gateApplied ? ' (capped - unmet mandatory credential)' : '';
  gapAnalysis.overall_fit_score = score;
  gapAnalysis.fit_rationale = (qualitative ? `Fit Score: ${score}/10 - ${qualitative}` : `Fit Score: ${score}/10`) + marker;
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
// EXCEPTION — the one genuinely semantic step, the Adjudicator judging each gap answer (ACCEPTED /
// REQUIRES_ANCHOR / REJECTED / NOT_EVIDENCE), is NOT done here: it's an LLM call (adjudicator.js) made
// upstream across the gap_answers_submit loop; the verdict arrives on each answer and _ingestGapAnswers
// trusts it (no regex proxy). Only ACCEPTED grants credit.

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
  const repairs = { paths_normalized: [], strengths_dropped: [], requirements_retiered: [], gaps_dropped: [], gates_demoted: [] };

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
    // A mandatory_gate only makes sense on a Baseline (required) item — a preferred/Differentiator
    // statutory mention is a nice-to-have, not a hard condition of employment. Capping the fit score on
    // an unmet *preferred* item over-penalises the candidate, so demote the flag deterministically.
    if (r.mandatory_gate === true && r.tier !== 'Baseline') {
      repairs.gates_demoted.push({ id: r.id, tier: r.tier });
      r.mandatory_gate = false;
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
    // Keep a candidate-backed gap even if its source is orphaned — its (fully or partially) accepted
    // evidence stands on its own.
    if ((g.adjudication === 'ACCEPTED' || g.adjudication === 'ACCEPTED_MITIGATED') && g.candidate_provided_evidence) { keptGaps.push(g); continue; }
    repairs.gaps_dropped.push({ id: g.id, requirement_source: g.requirement_source, gap_text: g.gap_text });
  }
  gapAnalysis.gaps = keptGaps;

  return repairs;
}

// Ingest the gap answers collected by the client modal. Mutates gapAnalysis in place.
// Each answer carries an Adjudicator `verdict` (see adjudicator.js) decided upstream over the whole
// 2-round interview loop. This function does ONLY the mechanical effects — it trusts the verdict and
// never re-judges. Only ACCEPTED grants credit; every other verdict leaves the gap open.
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
      delete gap.adjudication; delete gap.adjudication_reason; delete gap.anchor_prompt;
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
      gap.adjudication = 'SKIPPED';
      continue;
    }
    const response = answer.user_answer.trim();
    const verdict = answer.verdict || 'NOT_EVIDENCE'; // adjudicated upstream; fail-closed default
    gap.candidate_provided_evidence = response;
    gap.evidence_source = 'user_provided';
    gap.adjudication = verdict;
    if (answer.adjudication_reason) gap.adjudication_reason = answer.adjudication_reason;
    if (verdict === 'REQUIRES_ANCHOR' && answer.anchor_prompt) gap.anchor_prompt = answer.anchor_prompt;
    if (verdict === 'ACCEPTED') {
      const linkedReq = (gapAnalysis.requirements || []).find(r => r.id === gap.requirement_id);
      if (linkedReq) { linkedReq.candidate_status = 'Met (Candidate Evidence)'; linkedReq.candidate_evidence_text = response; }
      gapAnalysis.candidate_backed_strengths.push({ gap_id: answer.gap_id, gap_text: answer.gap_text, evidence: response, tier: answer.tier });
    } else if (verdict === 'ACCEPTED_MITIGATED') {
      // Structural gap (e.g. minimum-years experience): the answer strengthens the candidate's framing
      // but cannot retroactively close the requirement — so DO capture the mitigating evidence as a
      // backed strength, but DO NOT flip the requirement to Met (fit score stays honest).
      gapAnalysis.candidate_backed_strengths.push({ gap_id: answer.gap_id, gap_text: answer.gap_text, evidence: response, tier: answer.tier, mitigated: true });
    }
    // REQUIRES_ANCHOR / REJECTED / NOT_EVIDENCE: gap stays open; verdict + reason retained for the summary.
  }

  // Canonical contract: a top-level candidate_provided_evidence[] array (Analyst inits it as [], the
  // Integrity Checker reads it as an array, specs require it). The per-gap string above is internal
  // working state for the keep-rule + requirement linking; this array is the public shape. Rebuilt from
  // current gap state every ingest, so it stays consistent across resubmits.
  gapAnalysis.candidate_provided_evidence = (gapAnalysis.gaps || [])
    .filter(g => g.evidence_source === 'user_provided'
              && g.candidate_provided_evidence
              && g.candidate_provided_evidence !== '__skipped__')
    .map(g => ({
      gap_id: g.id,
      gap_text: g.gap_text,
      tier: g.tier,
      candidate_provided_evidence: g.candidate_provided_evidence,
      adjudication: g.adjudication,
    }));
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
                    + repairs.requirements_retiered.length + repairs.gaps_dropped.length + repairs.gates_demoted.length;
  if (repairCount > 0) console.log(`[Review · audit] pre-audit repair: ${repairs.paths_normalized.length} path(s) normalized, ${repairs.strengths_dropped.length} strength(s) dropped, ${repairs.requirements_retiered.length} re-tiered, ${repairs.gaps_dropped.length} orphan gap(s) dropped, ${repairs.gates_demoted.length} gate(s) demoted`);
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
  console.log(`[Review · audit] verdict=${overall_verdict} issues=${issuesFound.length} backable=${backableIssues.length} approved=${approvedItems.length}`);
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
    ? 'Analysis validated and approved.\n\n**Next:** the assembly phase will begin - starting with style negotiation.'
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
        console.warn(`[Extractor · gate] project_meta.failure_reason="${meta.failure_reason}" but tag was "${parsedStatus ?? 'missing'}" — forcing EXTRACTION_FAILED`);
      }
      return 'EXTRACTION_FAILED';
    }
  } catch (e) {
    console.warn(`[Extractor · gate] could not read project_meta.json: ${e.message}`);
  }
  // Success path — the Extractor no longer computes durations; the server owns that math now.
  computeRoleDurations();
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
    console.log('[Extractor · gate] cleared stale failure markers before Extractor dispatch');
  } catch (e) {
    console.warn(`[Extractor · gate] could not clear failure markers: ${e.message}`);
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
    console.warn(`[Orchestrator · dispatch] could not write mo_dispatch.json: ${e.message}`);
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
  console.log(`[Analysis · join] analystDone=${state.analystDone} taDone=${state.taDone}`);
  if (!state.analystDone || !state.taDone) {
    if (state.taDone && !state.analystDone) {
      broadcast({ type: 'agent_message', agent: 'System', text: 'Analysis still running in background - will begin gap review shortly…', background: true });
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
  if (!gapAnalysisReady) console.error('[Analysis · join] gap_analysis.json never became ready — proceeding anyway');

  let computedScore = null;
  try {
    computedScore = applyFitScore(gapAnalysisPath);
    console.log(`[Analysis · join] gap_analysis ready, server fit score ${computedScore}`);
  } catch (err) {
    console.error('[Analysis · join] applyFitScore error:', err.message);
  }

  // Authoritative strength/gap lists for the UI come from gap_analysis.json (server owns the source
  // of truth) — NOT from parsing the Analyst's free text, which only ever named one "top strength"
  // + one "key gap", so the bubble could show only one of each. Attach the full structured lists so
  // AnalystBubble renders every strength and gap, gaps sorted critical→low.
  let analystData = null;
  try {
    const ga = JSON.parse(readFileSync(gapAnalysisPath, 'utf8'));
    const sevRank = { critical: 0, high: 1, medium: 2, low: 3 };
    const gaps = (ga.gaps ?? [])
      .map(g => ({ text: g.gap_text, severity: g.severity ?? null }))
      .filter(g => g.text)
      .sort((a, b) => (sevRank[String(a.severity).toLowerCase()] ?? 9) - (sevRank[String(b.severity).toLowerCase()] ?? 9));
    analystData = {
      score: ga.overall_fit_score ?? computedScore,
      strengths: (ga.strengths ?? []).map(s => ({ text: s.strength_text })).filter(s => s.text),
      gaps,
    };
  } catch (err) {
    console.error('[Analysis · join] could not build analystData for bubble:', err.message);
  }

  if (state.analystOutputText) {
    const banner = computedScore !== null ? `**Fit Score: ${computedScore}/10**\n\n` : '';
    broadcast({ type: 'agent_message', agent: 'Analyst', text: banner + stripAnalystNarration(state.analystOutputText), background: false, analystData });
    broadcast({ type: 'stream_done' });
    state.analystOutputText = null;
    await new Promise(r => setTimeout(r, 300));
  }

  // The Analyst validator runs inline (the Analyst calls it as a tool) and writes
  // analyst_validator_verdict.json for server-side logic, but its verdict is deliberately NOT shown
  // to the user: a visible "Validator: REJECT" bubble breaks trust when validation doesn't pass, and
  // the validator is an internal QA step. Discard the summary unread.
  state.analystValidatorSummary = null;

  await state.recipe.globalVariables.setValue('pipeline_status', 'GAP_INTERVIEW');
  state.pipelineStatus = 'GAP_INTERVIEW';

  let highGaps = [];
  try {
    const gapData = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'gap_analysis.json'), 'utf8'));
    // High + Medium (Administrative excluded) — strong CVs were getting only one High item.
    highGaps = (gapData.gaps ?? []).filter(g => g.severity === 'High' || g.severity === 'Medium');
  } catch (e) {
    console.error('[Analysis · join] failed to read high gaps for modal:', e.message);
  }
  // Fresh interview: reset the 2-round adjudication loop state.
  state.gapRound = 1;
  state.gapAnswersAccum = {};
  state.gapAccepted = [];
  state.gapPending = [];
  console.log(`[Analysis · join] broadcasting gap_interview_start (round 1) with ${highGaps.length} high gaps`);
  broadcast({ type: 'gap_interview_start', round: 1, accepted: [], gaps: highGaps });
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
        prompt: researchSummary + '\n\nHappy with this? We\'ll use it to see how well you fit the role.',
        actions: [
          { id: 'research_confirm', label: 'Looks good - keep going', variant: 'primary' },
          { id: 'research_redo',    label: 'Research again',          variant: 'ghost'   },
        ],
      });
      broadcastMode('action_required');
      await state.recipe.globalVariables.setValue('pipeline_status', 'RESEARCH_CONFIRM');
      state.pipelineStatus = 'RESEARCH_CONFIRM';
    } else {
      broadcast({ type: 'agent_message', agent: 'System', text: researchSummary + '\n\n*(Research updated - gap analysis will use this once your style interview completes.)*' });
    }
  } catch (err) {
    console.error('[Research · redo-join] error:', err.message);
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

// Advisory assembly validator — server-owned (deterministic-offload). Fires after a section is
// produced/merged, BEFORE the human Approve/Revise. Every check it ran was mechanical (regex / string
// match / count), so the LLM `assembly_validator_input` node was retired and the modules ported to JS
// here. APPROVE/FLAG only: it never re-runs an agent (the human owns the gate). Returns the FLAG notes
// to thread into the review bubble, or '' otherwise. The DANGER_TERMS scan (TC05) lives here now too.
const ASM_DANGER_TERMS = ['crm', 'commercialisation', 'commercialization', 'market expansion', 'industry partnership'];

function readWorkspaceJSON(file) {
  try { return JSON.parse(readFileSync(join(WORKSPACE_DIR, file), 'utf8')); } catch { return null; }
}
function readWorkspaceText(file) {
  try { return readFileSync(join(WORKSPACE_DIR, file), 'utf8'); } catch { return ''; }
}

export function _assemblyChecks(agentKey) {
  const issues = [];
  const push = (field, problem) => issues.push({ field, problem });

  if (agentKey === 'style_negotiator') {
    const data = readWorkspaceJSON('sn_output.json')?.data || {};
    const ta = readWorkspaceJSON('style_findings.json') || {};
    const taFlagged = ta.flagged_issues || [], taPatterns = ta.style_patterns || {};
    const agreed = data.agreed_overrides || {};
    const STANDARD = ['implicit_first_person', 'telegraphic', 'bold_metrics', 'passive_voice', 'em_dash', 'ai_register', 'full_sentences', 'action_verbs', 'bold_achievements', 'improve_conciseness', 'user_note'];
    for (const key of Object.keys(agreed)) {
      const norm = k => k.toLowerCase().replace(/[^a-z_]/g, '_');
      const inTA = taFlagged.some(f => norm(f.category || '') === key) || Object.keys(taPatterns).some(k => norm(k) === key);
      if (!STANDARD.includes(key) && !key.endsWith('_custom') && !inTA) push(`data.agreed_overrides.${key}`, `Override "${key}" not in TA findings and not a standard option`);
    }
    if (agreed.telegraphic && agreed.full_sentences) push('data.agreed_overrides', 'Contradictory overrides: telegraphic and full_sentences both active');
    if (!data.negotiation_summary || !String(data.negotiation_summary).trim()) push('data.negotiation_summary', 'Missing or empty - must summarise what was agreed');

  } else if (agentKey === 'profile_builder') {
    const data = readWorkspaceJSON('pb_output.json')?.data || {};
    const profile = readWorkspaceJSON('candidate_profile.json') || {};
    const findings = readWorkspaceJSON('style_findings.json') || {};
    const paragraph = data.profile_paragraph?.formatted_text || data.profile_statement || '';
    // 1. Credential guard
    const credSrc = ((profile.skills?.certifications || []).join(' ') + ' ' +
      (profile.education || []).map(e => `${e.qualification || ''} ${e.institution || ''}`).join(' ')).toLowerCase();
    for (const term of ['credentialled', 'certified', 'registered', 'accredited', 'diplomate', 'fellowship', 'fellow of', 'member of']) {
      const re = new RegExp(term, 'i');
      if (re.test(paragraph) && !re.test(credSrc)) push('data.profile_paragraph', `Claims "${term}" credential but no matching entry in education[]/certifications[]`);
    }
    // 2. Numeric claim traceability
    const profileText = normalizeForMatch(JSON.stringify(profile));
    for (const m of (paragraph.match(/\b(\d+\.?\d*\s*%|\d+\+?\s*(?:year|yr)s?|\$[\d,]+|\d{4})\b/gi) || [])) {
      if (!profileText.includes(normalizeForMatch(m))) push('data.profile_paragraph', `Numeric claim "${m.trim()}" not found in candidate_profile.json - may be invented`);
    }
    // 3. Contact accuracy
    const contact = profile.personal_info?.contact || {};
    const contactStr = data.contact_details?.formatted_text || '';
    if (contact.email && !contactStr.includes(contact.email)) push('data.contact_details', `Email "${contact.email}" not in contact_details`);
    if (contact.phone && !contactStr.includes(contact.phone)) push('data.contact_details', `Phone "${contact.phone}" not in contact_details`);
    // 4. Danger-term / fabrication (TC05)
    const cvRaw = readWorkspaceText('cv_raw.txt').toLowerCase();
    for (const t of ASM_DANGER_TERMS) if (paragraph.toLowerCase().includes(t) && cvRaw && !cvRaw.includes(t)) push('data.profile_paragraph', `Term "${t}" in profile but not in cv_raw.txt - likely inferred from a title or sector-misused`);
    // 5. Numeric cross-section: profile's stated years vs server-computed total (no LLM)
    const total = findings.seniority?.years_experience;
    if (typeof total === 'number' && total > 0) {
      const ym = paragraph.match(/(\d+)\+?\s*years?/i);
      if (ym && Number(ym[1]) > total + 1.5) push('data.profile_paragraph', `Profile claims ${ym[1]} years but the work history totals ~${total} - overstated`);
    }

  } else if (agentKey === 'history_formatter') {
    const history = readWorkspaceJSON('hf_output.json')?.data?.work_history || [];
    const profile = readWorkspaceJSON('candidate_profile.json') || {};
    const profEmp = (profile.work_history || []).map(j => normEmployer(j.employer));
    history.forEach((entry, i) => {
      const ne = normEmployer(entry.employer);
      if (!profEmp.some(e => e && ne && (e.includes(ne) || ne.includes(e)))) push(`data.work_history[${i}].employer`, `Employer "${entry.employer}" not in candidate_profile.work_history`);
      const src = (profile.work_history || []).find(j => {
        const je = normEmployer(j.employer); return je && ne && (je.includes(ne) || ne.includes(je));
      });
      const srcText = src ? normalizeForMatch(JSON.stringify([...(src.responsibilities || []), ...(src.achievements || [])])) : '';
      (entry.bullets || []).forEach((b, j) => {
        for (const num of (b.match(/\b\d+\.?\d*\s*%|\b\d+\+?\s*(?:patients?|staff|team|year|yr)|\$[\d,]+/gi) || [])) {
          if (srcText && !srcText.includes(normalizeForMatch(num))) push(`data.work_history[${i}].bullets[${j}]`, `Metric "${num.trim()}" not in source job data - may be invented`);
        }
      });
    });

  } else if (agentKey === 'coverletter_writer') {
    const cl = readWorkspaceJSON('clw_output.json')?.data?.cover_letter || {};
    const meta = readWorkspaceJSON('project_meta.json') || {};
    const research = normalizeForMatch(JSON.stringify(readWorkspaceJSON('research_output.json')?.research_data || ''));
    const body = [cl.salutation || '', ...(cl.body_paragraphs || [cl.body || '']), cl.closing_paragraph || '', cl.full_letter || ''].join(' ');
    const bodyLc = body.toLowerCase();
    if (meta.company_name && !body.includes(meta.company_name)) push('data.cover_letter', `Company name "${meta.company_name}" not in letter - may use a hallucinated name`);
    if (meta.position_title) {
      const words = meta.position_title.split(' ').filter(w => w.length > 3);
      if (!words.every(w => bodyLc.includes(w.toLowerCase()))) push('data.cover_letter', `Role title "${meta.position_title}" not reflected in letter`);
    }
    for (const s of body.split(/[.!?]/).map(x => x.trim()).filter(x => /\d{1,3}(,\d{3})*|\d+%|[A-Z][a-z]+ (Program|Initiative|Framework|Centre|Center|Institute)/.test(x))) {
      if (research && !research.includes(normalizeForMatch(s).slice(0, 30))) push('data.cover_letter.body', `Specific company claim not in research_output: "${s.slice(0, 80)}…"`);
    }
    const wc = body.split(/\s+/).filter(Boolean).length;
    if (wc < 200) push('data.cover_letter', `Letter is ${wc} words - likely incomplete (target 250–350)`);
    if (wc > 420) push('data.cover_letter', `Letter is ${wc} words - exceeds 420 word cap`);
    const cvRaw = readWorkspaceText('cv_raw.txt').toLowerCase();
    for (const t of ASM_DANGER_TERMS) if (bodyLc.includes(t) && cvRaw && !cvRaw.includes(t)) push('data.cover_letter', `Term "${t}" in letter but not in cv_raw.txt - likely fabricated or sector-misused`);
  }
  return issues;
}

function _runAssemblyValidator(phaseAgent) {
  const agentKey = ASSEMBLY_VALIDATOR_AGENT[phaseAgent];
  if (!agentKey) return '';
  let issues = [];
  try { issues = _assemblyChecks(agentKey); }
  catch (err) { console.error('[Assembly · validator] error:', err.message); return ''; }
  const verdict = { verdict: issues.length ? 'FLAG' : 'APPROVE', agent: agentKey, issues };
  try { writeFileSync(join(WORKSPACE_DIR, 'assembly_validator_verdict.json'), JSON.stringify(verdict, null, 2)); } catch {}
  console.log(`[Assembly · validator] verdict=${verdict.verdict} for ${agentKey} (${issues.length} issue(s))`);
  return issues.length ? issues.map(i => `• ${i.field}: ${i.problem}`).join('\n') : '';
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
    broadcastCompletion();
    broadcastMode('idle');
    return;
  }

  state.currentAssemblyPhase = phaseNumber;
  state.awaitingSectionReview = null;  // a fresh dispatch supersedes any pending section review
  // Stall recovery: a STALL/throw from the node send would otherwise bubble to the route's
  // generic 500 handler with the UI left in auto_running and no Retry affordance (silent hang).
  // Register a retry thunk and surface the stall here, mirroring runLinearDispatch.
  state.retryThunk = () => dispatchAssemblyPhase(phaseNumber);

  let ctx = '';
  try {
    const meta = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'project_meta.json'), 'utf8'));
    // No today= injection: agents write the literal __DATE_TODAY__ token and the
    // server substitutes the real AU date at display time (see broadcast.js).
    ctx = ` role="${meta.position_title}" company="${meta.company_name}"`;
  } catch {}

  broadcastMode('auto_running', phase.agent);
  const dispatchStart = Date.now();

  let result;
  try {
    result = await sendToNodeAndWait(phase.inputNode, phase.agent, `__build_section__${ctx}`);
  } catch (err) {
    // The Integrity Checker is a forensic full-document check — designed to run long. The watchdog
    // can fire while the node is still healthily working; because Promise.race doesn't cancel the
    // underlying call, IC keeps going and *does* write its verdict to disk shortly after. Don't burn a
    // 20-min re-run discarding that result: poll for a fresh verdict before declaring a dead stall.
    if (phaseNumber === 8 && await _salvageIntegrityVerdict(dispatchStart)) {
      console.log('[Assembly] IC watchdog fired but a fresh verdict landed — salvaging, running gate');
      await _handleGate(8);
      return;
    }
    surfaceStall(phase.agent, err);
    return;
  }
  const { cleanText } = parseAndStripStatus(typeof result === 'string' ? result : JSON.stringify(result ?? ''));
  // SR (7) and IC (8) are gates, not content sections. Their agent text is a long forensic working-log
  // (dual-track notes, per-claim checks) — the handlers below emit a clean server-built summary instead,
  // so don't dump the raw reasoning to the user.
  if (phaseNumber !== 7 && phaseNumber !== 8) {
    broadcastAssemblySectionResult(cleanText, phase.agent);
  }

  await new Promise(r => setTimeout(r, 1000));

  if (phaseNumber <= 6 || phaseNumber === 9) {
    const merged = await mergePhaseOutput(phaseNumber, dispatchStart);
    if (!merged.ok) {
      // The agent didn't produce a real section (e.g. it asked a clarifying question instead of
      // building). Don't advance or show Approve/Revise on a phantom section: auto-retry once, then stall.
      const retries = (state.assemblyRetries ??= {});
      if ((retries[phaseNumber] ?? 0) < 1) {
        retries[phaseNumber] = (retries[phaseNumber] ?? 0) + 1;
        broadcast({ type: 'agent_message', agent: 'System', text: `Re-running ${phase.agent} - the last attempt didn't produce a finished section.` });
        await new Promise(r => setTimeout(r, 500));
        return dispatchAssemblyPhase(phaseNumber);
      }
      delete retries[phaseNumber];
      surfaceStall(phase.agent, new Error(`${phase.agent} produced no usable output after a retry (${merged.reason}).`));
      return;
    }
    if (state.assemblyRetries) delete state.assemblyRetries[phaseNumber];
    const notes = await _runAssemblyValidator(phase.agent);
    _showApproveRevise(phase.agent, notes);
    return;
  }

  // IC (8) is a real gate (integrity is the hard blocker). SR (7) is advisory only — its findings
  // are informational, so we surface them and auto-advance rather than stopping the run.
  if (phaseNumber === 7) {
    await _advisoryStyleReview();
  } else {
    await _handleGate(phaseNumber);
  }
}

// Style Reviewer is advisory: the agent's own output bubble already lists any findings, so we just add
// a short "advisory — continuing" notice and move straight on to the Integrity Checker. No STYLE_FAILED
// status, no Continue-anyway gate.
async function _advisoryStyleReview() {
  let issueCount = 0;
  try {
    const cvState = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'cv_assembly_state.json'), 'utf8'));
    issueCount = (cvState.phases[6]?.data?.issues_found ?? []).length;
  } catch (e) {
    console.error('[Assembly] advisory style review read failed:', e.message);
  }
  broadcast({
    type: 'agent_message', agent: 'System',
    text: issueCount > 0
      ? `Style review is advisory - ${issueCount} note(s) above for reference. Continuing to the integrity check.`
      : 'Style review passed - continuing to the integrity check.',
  });
  await dispatchAssemblyPhase(8);
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
    console.error('[Style Negotiator] node error:', e.message);
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
      recommendation: `Confirm as ${level} - this controls tone, assertiveness, and how responsibilities are framed throughout the CV.`,
      insight: 'Seniority framing is the single biggest lever on how a recruiter reads every bullet.',
      recommended_overrides: { seniority_level: `${level} (confirmed by user)` },
    });
  }

  // Profile voice is a universal style choice — always offer it. Default (recommended) = first person;
  // a user who prefers third person picks "Customise" and types "third person". PB/SR read the resulting
  // directive from agreed_overrides and write accordingly (default first person if absent).
  if (!has('profile_voice')) {
    out.push({
      id: 'profile_voice',
      title: 'Professional Summary - Voice',
      finding: 'Your professional summary can be written in first person (you speaking as yourself) or third person (written about you).',
      examples: [
        'First person: "Biomedical Science graduate with hands-on laboratory training…"',
        'Third person: "Sarah is a Biomedical Science graduate with hands-on laboratory training…"',
      ],
      recommendation: 'Use first person - it reads as direct and modern and is the most common choice today. Prefer third person? Pick "Customise" and type "third person".',
      insight: 'First person (or implied first person, with no "I") is standard for most professional summaries; third person can suit very senior or academic profiles.',
      recommended_overrides: { profile_voice: 'first person - the summary speaks as the candidate (implied first person, no name and no third-person pronouns)' },
    });
  }

  const roleName = meta.position_title || '';
  const isSeniorRole = /grade\s*[456789]|band\s*[456789]|cns|clinical nurse specialist|senior\s+nurse|specialist|manager|director|lead|principal|head\s+of/i.test(roleName);
  if (isSeniorRole && !has('key_achievements')) {
    out.push({
      id: 'key_achievements',
      title: 'Key Achievements Section',
      finding: `Senior role detected (${roleName || 'this role'}) - a Key Achievements section is standard at this level.`,
      examples: [],
      recommendation: 'Add a Key Achievements section (2–3 bolded, quantified bullets) immediately after the profile paragraph.',
      insight: 'Senior-role screens run under 30 seconds - this section is the primary attention anchor.',
      recommended_overrides: { key_achievements_section: 'Include Key Achievements section - 2–3 bullet points with bold metrics immediately after profile paragraph' },
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
  g.recommended_overrides.seniority_level = `${level} (${yearsStr} yrs - confirmed by user)`;
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
        improve_conciseness: 'Keep bullets concise - under 18 words where possible',
      },
      negotiation_outcome: 'NO_ISSUES_FOUND',
      negotiation_summary: 'No style findings available - default professional overrides applied.',
      original_style: { tense: p.tense, voice: p.voice, bullet_format: p.bullet_format },
      user_confirmed: true,
    },
  };
  writeFileSync(join(WORKSPACE_DIR, 'sn_output.json'), JSON.stringify(output, null, 2));
  await mergePhaseOutput(1);
  const notes = await _runAssemblyValidator('Style Negotiator');
  broadcast({ type: 'agent_message', agent: 'Style Negotiator', text: 'No significant style issues found - default professional enhancements applied.' });
  await _advanceFromSN(notes);
}

// ── Structured assembly section bubbles ──────────────────────────────────────
// Every assembly section agent used to emit a jargon build-log ("Candidate: …", "word count: 52/90",
// "Entries formatted: N"). The user wants the actual *content* instead — their profile paragraph,
// their skills, their work history, etc. The structured data already lives in each agent's output
// file, so the server builds a typed `sectionData` payload from it and the client renders a real
// section preview. Each builder reads the agent's fresh output file and returns a payload tagged with
// a `kind` discriminator, or null on any failure (caller falls back to the agent's own text).
const arr = v => (Array.isArray(v) ? v.filter(Boolean) : []);

function readSectionOutput(file) {
  return JSON.parse(readFileSync(join(WORKSPACE_DIR, file), 'utf8'))?.data ?? {};
}

// Profile Builder / Cover Letter Writer reference strengths by id ("strength_1"…). The readable text
// lives in gap_analysis.json strengths[] {id, strength_text}. Resolve ids → text for the UI bubble so
// the user never sees "strength_1"; fall back to the raw id if the map is missing or unmatched.
function _resolveStrengthIds(ids) {
  let map = {};
  try {
    const ga = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'gap_analysis.json'), 'utf8'));
    for (const s of (ga.strengths ?? [])) if (s?.id) map[s.id] = s.strength_text ?? s.id;
  } catch (e) {
    console.error('[Assembly] _resolveStrengthIds: gap_analysis read failed:', e.message);
  }
  return arr(ids).map(id => map[id] ?? id);
}

const SECTION_BUILDERS = {
  'Profile Builder': () => {
    const d = readSectionOutput('pb_output.json');
    const paragraph = d.profile_paragraph?.formatted_text ?? d.profile_statement ?? '';
    if (!paragraph) return null;
    return {
      kind: 'profile',
      paragraph,
      contact: d.contact_details?.formatted_text ?? '',
      highlights: _resolveStrengthIds(d.profile_paragraph?.strengths_highlighted),
      suggestions: arr(d.advisory_warnings)
        .filter(w => w.suggestion || w.issue)
        .map(w => ({ field: w.field ?? '', issue: w.issue ?? '', suggestion: w.suggestion ?? '' })),
    };
  },
  'Skills Curator': () => {
    const d = readSectionOutput('sc_output.json');
    const technical = arr(d.technical_skills), soft = arr(d.soft_skills), certifications = arr(d.certifications);
    if (!technical.length && !soft.length && !certifications.length) return null;
    return { kind: 'skills', technical, soft, certifications, note: d.tailoring_notes ?? '' };
  },
  'History Formatter': () => {
    const d = readSectionOutput('hf_output.json');
    const roles = arr(d.work_history).map(r => ({
      employer: r.employer ?? '',
      position: r.position ?? '',
      duration: r.duration ?? '',
      bullets: arr(r.bullets),
    }));
    if (!roles.length) return null;
    return { kind: 'history', roles };
  },
  'Credentials Formatter': () => {
    const d = readSectionOutput('cf_output.json');
    const education = arr(d.education).map(e =>
      e.formatted_text || [e.qualification, e.institution, e.year].filter(Boolean).join(', '));
    const certifications = arr(d.certifications);
    if (!education.length && !certifications.length) return null;
    return { kind: 'credentials', education, certifications };
  },
  'Cover Letter Writer': () => {
    const d = readSectionOutput('clw_output.json');
    let letter = d.cover_letter?.full_letter ?? '';
    if (!letter) return null;
    // House style bans em-dashes; a stale CLW upload can still leak one (notably the "Re:" subject line).
    // Normalize spaced em/en dashes to a hyphen, leaving unspaced ranges like "$50M–$500M" intact.
    letter = letter.replace(/ [—–] /g, ' - ');
    return { kind: 'coverletter', letter, register: d.register_used ?? '', highlights: _resolveStrengthIds(d.strengths_used) };
  },
};

function buildSectionData(agent) {
  const builder = SECTION_BUILDERS[agent];
  if (!builder) return null;
  try {
    return builder();
  } catch (e) {
    console.error(`[Assembly] buildSectionData(${agent}) failed:`, e.message);
    return null;
  }
}

// Emit an assembly section result. Sections with a structured builder get a server-built bubble
// (sectionData) instead of their jargon summary; anything else keeps the plain agent-authored bubble.
// Used by both the initial dispatch and the revise path so they stay in sync.
export function broadcastAssemblySectionResult(cleanText, agent) {
  const sectionData = buildSectionData(agent);
  if (sectionData) {
    broadcast({ type: 'agent_message', agent, text: `${agent} Complete`, background: false, sectionData });
    return;
  }
  // No structured data — fall through to the plain text so the user still sees something.
  broadcastAgentResult(cleanText, agent, true);
}

// DocumentPreview reads the same structured per-section output files the assembly bubbles use (no
// markdown re-parsing). Bodies render as plain text, so strip the agents' light **bold** markers.
const _stripBold = s => String(s ?? '').replace(/\*\*/g, '');

// Build the DocumentPreview `doc` payload ({ cv, coverLetter }) from the finished section files.
// Returns null if the core pieces are missing (caller skips the document message).
export function buildDocumentData() {
  try {
    const pb = readSectionOutput('pb_output.json');
    const sc = readSectionOutput('sc_output.json');
    const hf = readSectionOutput('hf_output.json');
    const cf = readSectionOutput('cf_output.json');
    const clw = readSectionOutput('clw_output.json');

    const c = pb.contact_details?.components ?? {};
    const name = c.name ?? '';
    // Contact line: everything except the name, joined like the CV header.
    const contact = [c.email, c.phone, c.location, c.linkedin, c.portfolio, c.github]
      .filter(Boolean).join(' · ');

    const experience = arr(hf.work_history).map(r => ({
      title: r.position ?? '',
      dates: r.duration ?? '',
      employer: r.employer ?? '',
      bullets: arr(r.bullets).map(_stripBold),
    }));

    // DocumentPreview's "Education & Certifications" block takes plain strings.
    const education = [
      ...arr(cf.education).map(e => e.formatted_text || [e.qualification, e.institution, e.year].filter(Boolean).join(', ')),
      ...arr(cf.certifications),
    ];

    const skills = {
      technical: arr(sc.technical_skills),
      core: arr(sc.soft_skills),
      certifications: arr(sc.certifications),
    };

    let coverLetter = clw.cover_letter?.full_letter ?? '';
    // House style bans spaced em/en dashes (mirror buildSectionData's normalize).
    coverLetter = coverLetter.replace(/ [—–] /g, ' - ');

    const cv = {
      name,
      contact,
      profile: _stripBold(pb.profile_paragraph?.formatted_text ?? ''),
      skills,
      experience,
      education,
    };

    // Need at least a CV body or a cover letter to be worth previewing.
    if (!cv.profile && !experience.length && !coverLetter) return null;
    return { cv, coverLetter };
  } catch (e) {
    console.error('[Assembly · completion] buildDocumentData failed:', e.message);
    return null;
  }
}

// Broadcast the document preview as an agent_message the client routes to <DocumentPreview>.
export function broadcastDocument(initialTab = 'cv') {
  const documentData = buildDocumentData();
  if (!documentData) {
    broadcast({ type: 'agent_message', agent: 'System', text: 'The document isn’t ready to preview yet.', background: false });
    return;
  }
  broadcast({ type: 'agent_message', agent: 'Main Orchestrator', text: '', background: false, documentData, initialTab });
  broadcast({ type: 'stream_done' });
  broadcastMode('user_turn', 'Main Orchestrator');
}

// The "arrival" state. Replaces the old MO command-list echo at CV_TAILORED — the client routes a
// message tagged kind:'completion' to <CompletionBubble>, whose buttons fire existing action ids.
export function broadcastCompletion() {
  let meta = {};
  try {
    const m = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'project_meta.json'), 'utf8'));
    meta = { role: m.position_title ?? '', company: m.company_name ?? '' };
  } catch {}
  // Attach the document so CompletionBubble can offer a real one-click download (no PDF lib yet → .txt).
  const documentData = buildDocumentData();
  broadcast({ type: 'agent_message', agent: 'Main Orchestrator', text: 'Your application is ready.', background: false, kind: 'completion', meta, documentData });
  broadcast({ type: 'stream_done' });
}

// Did the phase actually produce usable output? An agent that asked a clarifying question (or errored)
// leaves its data empty. For phases with a structured builder, reuse it as the contract (null = no real
// section); otherwise require a non-empty data object.
function _phaseHasRealOutput(phase, outputData) {
  const data = outputData?.data;
  if (SECTION_BUILDERS[phase.agent]) return buildSectionData(phase.agent) != null;
  return !!(data && typeof data === 'object' && Object.keys(data).length > 0);
}

// Merge a phase's output into cv_assembly_state.json and advance current_phase. Returns
// { ok, reason } — callers MUST NOT advance/show Approve-Revise when ok is false (empty output would
// otherwise lock the phase ahead and break Revise).
//
// `dispatchStart` (ms epoch) is the freshness floor for the stale-output check; 0/omitted skips it, for
// callers (resume, revise re-merge) that aren't driving a fresh agent turn.
export async function mergePhaseOutput(phaseNumber, dispatchStart = 0) {
  const phase = ASSEMBLY_PHASES[phaseNumber];
  if (!phase?.outputFile) return { ok: true }; // SR/IC write cv_assembly_state.json themselves
  try {
    const outputData = JSON.parse(readFileSync(join(WORKSPACE_DIR, phase.outputFile), 'utf8'));
    // GUARD: don't mark COMPLETE / advance unless the agent actually produced output.
    if (!_phaseHasRealOutput(phase, outputData)) {
      console.warn(`[Assembly] phase ${phaseNumber} (${phase.agent}) produced no usable output — NOT advancing (stays PENDING)`);
      return { ok: false, reason: 'empty_output' };
    }
    const cvStatePath = join(WORKSPACE_DIR, 'cv_assembly_state.json');
    const cvState = JSON.parse(readFileSync(cvStatePath, 'utf8'));
    const idx = phaseNumber - 1;
    cvState.phases[idx].status       = 'COMPLETE';
    // Server owns the time. The agent's own completed_at is the literal `__DATE_TODAY__` token, and
    // copying it through (the old `outputData.completed_at ?? …` — the ?? only caught it being absent,
    // never it being a token) leaked that token straight into cv_assembly_state.json.
    cvState.phases[idx].completed_at = new Date().toISOString();
    cvState.phases[idx].data         = outputData.data;
    cvState.current_phase            = phaseNumber + 1;
    cvState.metadata.completed_phases = phaseNumber;
    cvState.metadata.last_updated    = new Date().toISOString();
    writeFileSync(cvStatePath, JSON.stringify(cvState, null, 2));
    console.log(`[Assembly] merged phase ${phaseNumber} (${phase.agent}) → cv_assembly_state.json`);
  } catch (e) {
    console.error(`[Assembly] merge phase ${phaseNumber} failed:`, e.message);
    return { ok: false, reason: 'merge_error' };
  }

  // Stale output detection: did the agent actually write this artifact THIS turn? File mtime is the only
  // honest signal. This used to read the agent's own `completed_at`, which cannot work in either
  // direction — the agent writes the literal `__DATE_TODAY__` token, so `new Date(token)` is Invalid
  // Date, the age is NaN, and `NaN > 300_000` is false, so the check silently never fired. Had the token
  // been substituted it would resolve to midnight today and fire on every afternoon run instead. Same
  // mtime >= dispatchStart guard awaitOutputReady uses for the linear agents.
  try {
    if (dispatchStart) {
      const mtime = statSync(join(WORKSPACE_DIR, phase.outputFile)).mtimeMs;
      if (mtime < dispatchStart) {
        const age = Math.round((dispatchStart - mtime) / 1000);
        console.warn(`[Assembly] phase ${phaseNumber} output stale (${phase.outputFile} predates dispatch by ${age}s)`);
        broadcast({
          type: 'agent_message', agent: 'System',
          text: `⚠ Phase ${phaseNumber} (${phase.agent}) output looks stale - ${phase.outputFile} was last written ` +
                `${age}s before this step started, so the agent may not have run this turn.`,
        });
      }
    }
  } catch {}
  return { ok: true };
}

export async function reShowSectionReview(phaseNumber) {
  await mergePhaseOutput(phaseNumber);
  _showApproveRevise(ASSEMBLY_PHASES[phaseNumber].agent);
}

// Which agent a phase-aware resume will land on (for the restore route's "next agent" notice). Mirrors
// the branch logic in resumeAssembly without dispatching.
export function assemblyResumeAgent() {
  let phases = [];
  try {
    phases = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'cv_assembly_state.json'), 'utf8'))?.phases ?? [];
  } catch { /* no state → SN */ }
  let resumePhase = 1;
  while (resumePhase <= 9 && phases[resumePhase - 1]?.status === 'COMPLETE') resumePhase++;
  if (resumePhase <= 2) return ASSEMBLY_PHASES[resumePhase].agent;  // SN interview or Profile Builder
  if (resumePhase > 9) return ASSEMBLY_PHASES[9].agent;            // all done
  return ASSEMBLY_PHASES[Math.min(resumePhase - 1, 6)].agent;     // last content section under review
}

// Phase-aware resume. pipeline_status is coarse (every assembly phase shares CV_BUILDING), so the
// actual progress lives in cv_assembly_state.json. Land the user at the phase they reached instead of
// restarting the Style Negotiator: re-show the last completed *content* section's content + Approve/
// Revise so a single approve advances to the next agent. Used by restore, cold-start resume, and the
// F5 section-review safety net.
export async function resumeAssembly() {
  let phases = [];
  try {
    phases = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'cv_assembly_state.json'), 'utf8'))?.phases ?? [];
  } catch (e) {
    console.error('[Resume] cv_assembly_state unreadable — restarting SN:', e.message);
  }
  const isComplete = n => phases[n - 1]?.status === 'COMPLETE';

  // Lowest phase 1..9 not yet COMPLETE = the next phase to run.
  let resumePhase = 1;
  while (resumePhase <= 9 && isComplete(resumePhase)) resumePhase++;

  if (resumePhase > 9) {                       // everything done → finished state
    console.log('[Resume] all assembly phases complete → CV_TAILORED');
    await dispatchAssemblyPhase(10);           // no-phase branch sets CV_TAILORED + idle
    return;
  }
  if (resumePhase === 1) {                      // SN not done → run the interview
    console.log('[Resume] SN not complete → style negotiation');
    state.snState = null;
    await dispatchAssemblyPhase(1);
    return;
  }
  if (resumePhase === 2) {                      // only SN done; SN has no review bubble → run PB
    console.log('[Resume] SN complete, Profile Builder next');
    state.currentAssemblyPhase = 1;
    await dispatchAssemblyPhase(2);
    return;
  }

  // resumePhase 3..9 → re-show the last completed content section (phases 2–6; gates 7/8 + DF 9 auto).
  const lastContent = Math.min(resumePhase - 1, 6);
  const agent = ASSEMBLY_PHASES[lastContent].agent;
  console.log(`[Resume] landing on phase ${lastContent} (${agent}) review`);
  state.currentAssemblyPhase = lastContent;
  state.fallbackAgent = agent;
  broadcast({ type: 'agent_switch', agent });
  await mergePhaseOutput(lastContent);
  broadcastAssemblySectionResult('', agent);   // re-emit the section content from its output file
  await new Promise(r => setTimeout(r, 300));
  _showApproveRevise(agent);
}

// ── Integrity-check reject remediation ────────────────────────────────────────
// On an IC FAIL, every flagged claim must have a real path other than "ship it": remove it (mechanical,
// server-side for list sections; via the Style Reviewer re-flow for prose) or back it with evidence
// (adjudicated, then ingested into gap_analysis so IC sees it). See plan: the-integrity-cxhcker-was-zippy-tiger.

const IC_REMEDIATION_CAP = 2; // attempts before the gate falls back to "Use it as-is"

// List sections hold an array of claim strings → a removal is a clean splice (no LLM). Prose sections
// embed the claim mid-sentence → removal needs the Style Reviewer to re-flow.
const IC_LIST_SECTIONS  = new Set(['skills', 'additional_information']);
const IC_PROSE_SECTIONS = new Set(['profile', 'cover_letter']);
const IC_SECTION_LABEL  = {
  profile: 'your summary', skills: 'your skills', career_history: 'your work history',
  cover_letter: 'your cover letter', additional_information: 'your extra details',
};

// Tokenise for fuzzy claim↔gap linking — lowercase, strip punctuation, drop short noise words.
function _icTokens(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2);
}

// Link a flagged claim back to the gap it came from (so we can read that gap's adjudication for the
// skip-framing and target it for the evidence path). Conservative: only returns a match when a strong
// majority of the gap's tokens appear in the claim. No match → claim is treated as un-linked (Remove-only).
function _matchClaimToGap(claimText, gaps) {
  const ct = new Set(_icTokens(claimText));
  if (!ct.size) return null;
  let best = null, bestScore = 0;
  for (const g of gaps || []) {
    const gt = _icTokens(g.gap_text);
    if (!gt.length) continue;
    const score = gt.filter(w => ct.has(w)).length / gt.length;
    if (score > bestScore) { bestScore = score; best = g; }
  }
  return bestScore >= 0.5 ? best : null;
}

// Enrich IC's bare unsupported_claims_detail[] into the per-claim records the modal + submit handler use.
function buildIntegrityReviewClaims(phaseData) {
  const detail = phaseData?.unsupported_claims_detail ?? [];
  let gaps = [];
  try { gaps = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'gap_analysis.json'), 'utf8')).gaps ?? []; } catch {}

  return detail.map((c, i) => {
    const section = c.section ?? 'profile';
    const status  = c.evidence_status ?? 'NOT_FOUND';
    // GAP_SKILL_FABRICATED provably maps to a gap; for the rest, try a fuzzy link so skip-framing +
    // the evidence path can still apply when the claim text overlaps a known gap.
    const gap = _matchClaimToGap(c.claim, gaps);
    const fromSkippedGap = !!gap && gap.adjudication === 'SKIPPED';
    const defaultAction =
      status === 'DATES_UNVERIFIED'  ? 'fix_dates' :
      status === 'UNVERIFIED_DETAIL' ? 'none'      : // ambiguous — no pre-selection
      'remove';
    return {
      id: `ic_${i}`,
      claim: c.claim,
      section,
      sectionType: IC_LIST_SECTIONS.has(section) ? 'list' : IC_PROSE_SECTIONS.has(section) ? 'prose' : 'other',
      sectionLabel: IC_SECTION_LABEL[section] ?? section,
      evidence_status: status,
      remediation: c.remediation ?? null,
      gap_id: gap?.id ?? null,
      gap_text: gap?.gap_text ?? null,
      from_skipped_gap: fromSkippedGap,
      canProvideEvidence: !!gap?.id,
      defaultAction,
      group: fromSkippedGap ? 'skipped' : 'other',
    };
  });
}

// Strip the display-only / server-trust fields the client doesn't need (it re-reads everything from
// state.icReview on submit — same trust model as gap_answers_submit re-reading gap_analysis.json).
export function toIcClientClaim(c) {
  return {
    id: c.id, claim: c.claim, section: c.section, sectionLabel: c.sectionLabel,
    evidence_status: c.evidence_status, from_skipped_gap: c.from_skipped_gap,
    canProvideEvidence: c.canProvideEvidence, defaultAction: c.defaultAction, group: c.group,
  };
}

// Clean, server-built integrity PASS summary — replaces the IC agent's long dual-track working log in
// the UI. Trusts the deterministic fields on the merged phase data.
function buildIntegritySummary(phaseData) {
  const flagged = (phaseData?.unsupported_claims_detail ?? []).length;
  const checked = phaseData?.claims_checked ?? phaseData?.total_claims_checked ?? null;
  const bits = [];
  if (checked != null) bits.push(`${checked} claim${checked === 1 ? '' : 's'} checked`);
  bits.push(flagged ? `${flagged} flagged` : 'nothing flagged');
  return `✓ Accuracy check passed - ${bits.join(', ')}. Everything in your CV traces back to what you provided.`;
}

// Poll cv_assembly_state.json for an IC verdict that landed AFTER the watchdog fired (a slow-but-healthy
// run). Returns true if a fresh verdict appears within the grace window.
async function _salvageIntegrityVerdict(dispatchStart) {
  const path = join(WORKSPACE_DIR, 'cv_assembly_state.json');
  for (let i = 0; i < 30; i++) { // ~90s grace, polled every 3s
    try {
      const cv = JSON.parse(readFileSync(path, 'utf8'));
      const ph = cv.phases?.[7];
      const completedAt = ph?.completed_at ? new Date(ph.completed_at).getTime() : 0;
      if (ph?.data?.integrity_status && completedAt >= dispatchStart) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 3000));
  }
  return false;
}

// Remove exact claim strings from the list-section arrays in cv_assembly_state.json (skills) and, best
// effort, from the publications/awards source (additional_information). Returns the count removed.
function _stripListClaims(listClaims) {
  if (!listClaims.length) return 0;
  let removed = 0;
  const norm = s => _icTokens(s).join(' ');
  const wanted = new Map(listClaims.map(c => [norm(c.claim), c]));

  const cvPath = join(WORKSPACE_DIR, 'cv_assembly_state.json');
  try {
    const cv = JSON.parse(readFileSync(cvPath, 'utf8'));
    const skills = cv.phases?.[2]?.data;
    if (skills) {
      for (const field of ['technical_skills', 'soft_skills', 'certifications']) {
        if (!Array.isArray(skills[field])) continue;
        const before = skills[field].length;
        skills[field] = skills[field].filter(s => !wanted.has(norm(typeof s === 'string' ? s : s?.name ?? '')));
        removed += before - skills[field].length;
      }
      if (typeof skills.total_skills === 'number') {
        skills.total_skills = (skills.technical_skills?.length ?? 0) + (skills.soft_skills?.length ?? 0);
      }
      cv.metadata && (cv.metadata.last_updated = new Date().toISOString());
      writeFileSync(cvPath, JSON.stringify(cv, null, 2));
    }
  } catch (e) { console.error('[Assembly · IC-remediation] skills strip failed:', e.message); }

  // additional_information lives in candidate_profile.json (publications/awards) — best effort.
  const addl = listClaims.filter(c => c.section === 'additional_information');
  if (addl.length) {
    const cpPath = join(WORKSPACE_DIR, 'candidate_profile.json');
    try {
      const cp = JSON.parse(readFileSync(cpPath, 'utf8'));
      for (const field of ['publications', 'awards', 'grants']) {
        if (!Array.isArray(cp[field])) continue;
        cp[field] = cp[field].filter(item => {
          const text = typeof item === 'string' ? item : (item?.title ?? item?.name ?? JSON.stringify(item));
          return !addl.some(c => norm(c.claim) === norm(text) || norm(text).includes(norm(c.claim)));
        });
      }
      writeFileSync(cpPath, JSON.stringify(cp, null, 2));
    } catch (e) { console.error('[Assembly · IC-remediation] additional_information strip failed:', e.message); }
  }
  return removed;
}

// Apply the user's per-claim integrity decisions, then re-run IC. Decisions: { [claimId]: { action, evidence } }.
// action ∈ 'remove' | 'evidence' | 'keep' | 'fix_dates'. Called by the ic_remediation_submit route.
export async function runIcRemediation(decisions = {}) {
  const claims = state.icReview?.claims ?? [];
  if (!claims.length) { await dispatchAssemblyPhase(8); return; }
  state.icRemediationRound += 1;

  const byId = new Map(claims.map(c => [c.id, c]));
  const evidenceItems = [];   // adjudicate → ingest if ACCEPTED
  let   removeList    = [];   // claims to drop (incl. failed-evidence fallthrough)
  const dateClaims    = [];   // DATES_UNVERIFIED → existing HF revise path

  for (const [id, d] of Object.entries(decisions)) {
    const c = byId.get(id);
    if (!c) continue;
    const action = d?.action ?? c.defaultAction;
    if (action === 'keep') continue;
    if (action === 'fix_dates' || (c.evidence_status === 'DATES_UNVERIFIED' && action !== 'remove')) {
      dateClaims.push(c); continue;
    }
    if (action === 'evidence' && c.gap_id && d?.evidence?.trim()) {
      evidenceItems.push({ claim: c, gap_id: c.gap_id, gap_text: c.gap_text, answer: d.evidence.trim() });
      continue;
    }
    removeList.push(c); // 'remove', or evidence with no gap/text
  }

  // 1) Evidence → adjudicate; ACCEPTED ingests into gap_analysis.json (IC then sees it). Rejected
  //    evidence is not real backing → the claim falls through to removal.
  if (evidenceItems.length) {
    let verdicts = [];
    try {
      verdicts = await adjudicateGapAnswers(evidenceItems.map(e => ({
        gap_id: e.gap_id, requirement: e.gap_text, answer: e.answer,
      })));
    } catch (e) { console.error('[Assembly · IC-remediation] adjudicator error:', e.message); }
    const vById = new Map(verdicts.map(v => [v.gap_id, v]));
    const accepted = [];
    for (const e of evidenceItems) {
      const v = vById.get(e.gap_id);
      if (v?.verdict === 'ACCEPTED') {
        accepted.push({ gap_id: e.gap_id, gap_text: e.gap_text, user_answer: e.answer, verdict: 'ACCEPTED', adjudication_reason: v.reason });
      } else {
        removeList.push(e.claim); // weak evidence → remove the claim
      }
    }
    if (accepted.length) {
      try {
        const gaPath = join(WORKSPACE_DIR, 'gap_analysis.json');
        const ga = JSON.parse(readFileSync(gaPath, 'utf8'));
        _ingestGapAnswers(ga, accepted);
        writeFileSync(gaPath, JSON.stringify(ga, null, 2));
        broadcast({ type: 'agent_message', agent: 'System', text: `Backed up ${accepted.length} claim${accepted.length === 1 ? '' : 's'} with your evidence.` });
      } catch (e) { console.error('[Assembly · IC-remediation] gap ingest failed:', e.message); }
      // A gap that's now ACCEPTED backs *every* claim tracing to it — so don't also strip/re-flow a
      // sibling claim the user happened to mark "remove". The accepted evidence wins; IC will pass it.
      const acceptedGapIds = new Set(accepted.map(a => a.gap_id));
      removeList = removeList.filter(c => !c.gap_id || !acceptedGapIds.has(c.gap_id));
    }
  }

  // 2) Removals — split by section type.
  const listRemovals  = removeList.filter(c => c.sectionType === 'list');
  const proseRemovals = removeList.filter(c => c.sectionType === 'prose');
  const otherRemovals = removeList.filter(c => c.sectionType === 'other'); // fold into list-strip best-effort
  const strippedCount = _stripListClaims([...listRemovals, ...otherRemovals]);
  if (strippedCount) console.log(`[Assembly · IC-remediation] stripped ${strippedCount} list-section claim(s) server-side`);

  // 3) Date corrections — re-run History Formatter (existing pattern).
  if (dateClaims.length) {
    const corrections = dateClaims.map(c => `• ${c.claim} → ${c.remediation || 'verify dates'}`).join('\n');
    broadcastMode('auto_running', 'History Formatter');
    broadcast({ type: 'agent_message', agent: 'System', text: `Fixing ${dateClaims.length} date issue(s)…` });
    try {
      const r = await sendToNodeAndWait(ASSEMBLY_PHASES[4].inputNode, 'History Formatter',
        `__revise__: Correct date errors identified by the accuracy check:\n${corrections}`);
      const { cleanText } = parseAndStripStatus(typeof r === 'string' ? r : JSON.stringify(r ?? ''));
      broadcastAgentResult(cleanText, 'History Formatter', true);
      await new Promise(res => setTimeout(res, 800));
      await mergePhaseOutput(4);
    } catch (e) { surfaceStall('History Formatter', e); return; }
  }

  // 4) Prose removals — the Style Reviewer applies the removal list and re-flows in one pass (it owns
  //    the merged doc + the final voice). Removed claims must not be re-introduced; everything else stays.
  //    SR runs SILENT here (like the Style Negotiator): the "Tidying up…" notice is the only user-facing
  //    line, and we discard SR's own text so a stray narration ("You are now talking to…") can't leak —
  //    model-proof regardless of whether SR v3.1's output-discipline block is uploaded yet.
  if (proseRemovals.length) {
    broadcastMode('auto_running', 'Style Reviewer');
    broadcast({ type: 'agent_message', agent: 'System', text: `Tidying up your summary and cover letter…` });
    const payload = JSON.stringify({
      remove: proseRemovals.map(c => ({ section: c.section, claim: c.claim })),
    });
    try {
      await sendToNodeAndWait(ASSEMBLY_PHASES[7].inputNode, 'Style Reviewer', `__remediate__ ${payload}`);
      await new Promise(res => setTimeout(res, 800));
    } catch (e) { surfaceStall('Style Reviewer', e); return; }
  }

  // 5) Re-validate.
  state.icReview = null;
  state.currentAssemblyPhase = 8;
  state.retryThunk = () => dispatchAssemblyPhase(8);
  await dispatchAssemblyPhase(8);
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
      // A clean pass clears any remediation history for the next genuine run.
      state.icReview = null;
      state.icRemediationRound = 0;
      if (phaseNumber === 8) broadcast({ type: 'agent_message', agent: 'System', text: buildIntegritySummary(phaseData) });
      await dispatchAssemblyPhase(phaseNumber + 1);
    } else {
      const failStatus = phaseNumber === 7 ? 'STYLE_FAILED' : 'INTEGRITY_FAILED';
      state.pipelineStatus = failStatus;
      try { await state.recipe.globalVariables.setValue('pipeline_status', failStatus); } catch {}
      broadcast({ type: 'status_changed', status: failStatus });

      // IC (phase 8): drive the integrity-review modal so every flagged claim has a real fix
      // (remove / back-with-evidence) — not just "ship it". Falls back to a plain gate at the round cap.
      if (phaseNumber === 8) {
        const claims = buildIntegrityReviewClaims(phaseData);
        if (claims.length && state.icRemediationRound < IC_REMEDIATION_CAP) {
          state.icReview = { claims };
          const fixable = claims.filter(c => c.defaultAction !== 'keep').length;
          broadcast({
            type: 'agent_message', agent: 'System',
            text: `The accuracy check found ${claims.length} thing${claims.length === 1 ? '' : 's'} we couldn't back up. Let's sort ${fixable === 1 ? 'it' : 'them'} out.`,
          });
          broadcast({ type: 'integrity_review_start', claims: claims.map(toIcClientClaim) });
          broadcastMode('action_required');
          return;
        }
        // No actionable claims, or the cap is hit — offer the plain escape hatch.
        state.icReview = null;
        const capped = state.icRemediationRound >= IC_REMEDIATION_CAP;
        broadcast({
          type: 'action_required', context: 'gate_failed', agent: phase.agent,
          prompt: capped
            ? `We've had a couple of goes and a few things still couldn't be backed up. You can use the CV as it is, or stop here.`
            : `The accuracy check flagged some content but there was nothing we could automatically fix.`,
          actions: [{ id: 'gate_continue', label: 'Use it as-is', variant: 'ghost' }],
        });
        broadcastMode('action_required');
        return;
      }

      // SR (phase 7) keeps the legacy advisory gate (it should never reach here — it's advisory — but
      // the branch is retained for safety).
      let prompt = '';
      const issues = phaseData?.issues_found ?? [];
      if (issues.length) {
        prompt = `**${issues.length} style issue(s) found:**\n\n` +
          issues.map(i => `• ${i.description ?? i.issue ?? JSON.stringify(i)}`).join('\n');
      }
      broadcast({
        type: 'action_required', context: 'gate_failed', agent: phase.agent, prompt,
        actions: [{ id: 'gate_continue', label: 'Use it as-is', variant: 'ghost' }],
      });
      broadcastMode('action_required');
    }
  } catch (e) {
    console.error(`[Assembly] gate check phase ${phaseNumber} failed:`, e.message);
    // Never strand the pipeline on a gate-read error. Previously this swallowed the error and left
    // the run stuck in auto_running (the user only saw the 45s "pipeline is active" stall banner,
    // never a button). Always surface a continuation so the user can proceed or re-run.
    const failStatus = phaseNumber === 7 ? 'STYLE_FAILED' : 'INTEGRITY_FAILED';
    state.pipelineStatus = failStatus;
    try { await state.recipe.globalVariables.setValue('pipeline_status', failStatus); } catch {}
    broadcast({ type: 'status_changed', status: failStatus });
    broadcast({
      type: 'action_required',
      context: 'gate_failed',
      agent: phase.agent,
      prompt: `Something went wrong reading the last check (${e.message}). You can use this section as-is, or re-run it.`,
      actions: [{ id: 'gate_continue', label: 'Use it as-is', variant: 'ghost' }],
    });
    broadcastMode('action_required');
  }
}

function _showApproveRevise(agentName, notes = '') {
  // Mark the section review pending so a reload/restart can re-derive it (see /api/pending-interview).
  state.awaitingSectionReview = { phaseNumber: state.currentAssemblyPhase, agent: agentName };
  if (notes) {
    broadcast({ type: 'agent_message', agent: 'System', background: true,
      text: `⚠ Validator notes on this ${agentName} section (review before approving):\n${notes}` });
  }
  broadcast({
    type: 'action_required',
    context: 'assembly_section_review',
    agent: agentName,
    actions: [
      { id: 'assembly_approve', label: 'Looks good',     variant: 'primary' },
      { id: 'assembly_revise',  label: 'Make a change…', variant: 'ghost'   },
    ],
  });
  broadcastMode('action_required');
}

// SN done → straight into Profile Builder. No "Continue → Build CV" button.
// PB is dispatched DETACHED on a fresh tick: the SN-submit request already spent
// one KEMU round-trip on the assembly validator, and KEMU hangs if a second
// sendToInputWidgetAndWaitForOutput is chained in the same request. Firing PB
// after the request settles restores the old two-request (button) shape.
// Synthesize the (historically orphaned) style_guide.json — the voice contract read by CLW / Style
// Reviewer / HF / CF. No agent ever wrote it, so the cover letter fell back to a generic AI register.
// The voice data already exists: style_findings.json (Tone Analyst forensic read) + sn_output.json
// (server-merged agreed overrides). This is a deterministic merge — same offload pattern as the SN
// merge and the review audit. Called at SN-interview completion, before Profile Builder runs.
// root-level `register` is load-bearing: SR/CLW read it directly.
export function synthesizeStyleGuide() {
  let findings = {};
  try { findings = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'style_findings.json'), 'utf8')); } catch {}
  let sn = {};
  try { sn = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'sn_output.json'), 'utf8')); } catch {}

  const p = findings.style_patterns || {};
  const sig = p.signature_phrases || {};
  const agreed = sn.data?.agreed_overrides || {};

  const guide = {
    synthesized_at: new Date().toISOString(),
    source: 'server-merge(style_findings.json + sn_output.json)',
    // Load-bearing root-level register — SR/CLW read this directly for the target voice.
    register: findings.register || 'confident-professional',
    voice_descriptor: p.voice_descriptor || '',
    tense: p.tense || 'past',
    voice: p.voice || 'active',
    sentence_structure: p.sentence_structure || '',
    formality_level: p.formality_level || 'semi-formal',
    quantification_level: p.quantification_level || 'some',
    ownership_framing: p.ownership_framing || null,
    // Only preserve signature phrasing the TA judged worth keeping (intent: preserve); a weak CV
    // tags intent "none — voice too weak to seed" with an empty list, so we don't echo bad phrasing.
    signature_phrases: /^preserve/i.test(sig.intent || '') ? (sig.phrases || []) : [],
    voice_examples: Array.isArray(p.examples) ? p.examples : [],
    // The user's agreed style decisions (from the SN interview) — directive strings the assembly
    // agents weight. Carried verbatim so consumers reinforce style_guide with agreed_overrides.
    agreed_overrides: agreed,
  };
  writeFileSync(join(WORKSPACE_DIR, 'style_guide.json'), JSON.stringify(guide, null, 2));
  return guide;
}

function _advanceFromSN(notes = '') {
  synthesizeStyleGuide(); // write the voice contract before Profile Builder / Cover Letter run
  // SN validator notes are internal QA (the verdict file is already written by _runAssemblyValidator).
  // Unlike the section agents, SN has no Approve/Revise bubble to thread them into, so surfacing them
  // rendered as a contentless background tick. Keep them in the log only — don't show the user.
  if (notes) console.log(`[Style Negotiator · validator] notes (not shown to user):\n${notes}`);
  state.snState = null;
  setTimeout(() => {
    dispatchAssemblyPhase(2).catch(err =>
      console.error('[Assembly · advance-SN] Profile Builder dispatch failed:', err.message));
  }, 500);
}
