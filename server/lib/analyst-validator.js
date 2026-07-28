// Analyst Validator — semantic audit of gap_analysis.json, as a direct OpenRouter call.
//
// WHY THIS IS NOT AN OFFLOAD TO PLAIN JS: the audit is irreducibly semantic ("does this evidence
// actually prove this requirement?"). It cannot be regexed. So, unlike runToneValidation /
// computeSeniorityYears / _assemblyChecks, the judgment stays with an LLM — what moved is WHO drives
// it. It used to be an inline KEMU tool call the Analyst made to itself mid-turn (Phase 9 of
// analyst_agent_instructions.md v2.31): a blocking sub-agent call plus an in-memory fix pass, entirely
// opaque to the server, with no consistent rerun behaviour and KEMU's general flakiness baked in. The
// server only ever saw the leftover verdict file.
//
// Now the server owns the whole loop, mirroring adjudicator.js (the other genuinely-semantic call):
// direct fetch, server-owned retry/timeout, one shot. The model returns the audit AND a structural
// patch together, and the server applies the patch itself — so there is no second round-trip into
// KEMU, and the old "one fix pass, don't re-validate" rule is now structural rather than an
// instruction the Analyst had to remember.
//
// FAIL-OPEN, deliberately — the inverse of adjudicator.js. The adjudicator gates credit, so a blip
// must not grant it (fail closed → NOT_EVIDENCE). This validator gates nothing: its verdict is
// discarded unread at checkJoin (a visible "Validator: REJECT" bubble breaks user trust), and no
// downstream consumer reads the verdict file. So a failed audit should skip silently, never stall the
// pipeline.

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { WORKSPACE_DIR } from '../config/constants.js';
import { callOpenRouter } from './llm.js';

const OPENROUTER_MODEL = 'deepseek/deepseek-v4-pro'; // slug confirmed against KEMU node config 2026-07-16

// ⚠️ Both numbers are load-bearing and were measured, not guessed. DeepSeek V4 Pro is a REASONING model:
// max_tokens caps reasoning + content TOGETHER, and it reasons first. Observed on the real workspace
// fixtures: 6.7k–15.3k reasoning tokens for ~1.8k of actual answer. At max_tokens 4096 the reasoning
// swallows the whole budget and the API returns HTTP 200 with `content: null` — an empty string, not an
// error — which lands as a silent fail-open "parse_failed" and the analysis simply goes unaudited. It is
// a coin flip at 4096, which is worse than a hard failure. 16k leaves room for both.
// The 90s timeout was equally marginal (a real run measured 89.2s against it). This runs in the
// background with nothing waiting on it — the Analyst node itself gets 600s — so buy the headroom.
const TIMEOUT_MS = 180_000;
const MAX_TOKENS = 16_000;

const VERDICTS = new Set(['APPROVE', 'FLAG', 'REJECT']);

// Ported verbatim in substance from analyst_validator_instructions.md v2.11 Step 2. What was dropped in
// the port was only KEMU scaffolding, not rubric: the ReadFile-first execution theatre, banned-narration
// table, "never write gap_analysis.json" warnings and tool-return semantics all existed because it was a
// node reading files off disk. Here the files arrive in the prompt and the server owns every write, so
// none of that can happen by construction.
const SYSTEM_RUBRIC = `You are a hostile auditor and the candidate's ultimate defense attorney, reviewing an Analyst's gap analysis of a candidate against a job description. Aggressively hunt false positives (hallucinated strengths) and false negatives (lazy gaps).

SCOPE — SEMANTIC JUDGMENT ONLY. Do NOT re-check paths, counts, duplicates, verbatim text, tiers or mandatory_gate flags. All structural integrity is repaired deterministically by the server. Spend your entire budget on the one thing code cannot do: does the cited evidence actually prove the claim, and did the Analyst miss anything?

SERVER-OWNED FIELDS — ignore \`overall_fit_score\`, \`role_strictness\` and \`fit_rationale\`. They hold placeholders like "__FIT_SCORE__". This is expected; never flag them.

## 1. Attack the Strengths (hunting false positives)

The cited evidence must OBJECTIVELY prove the candidate meets the requirement. Read each strength's evidence_source/evidence_context against its requirement.

- Insufficient evidence is blocking. JD requires "Enterprise Architecture", Analyst cited "Junior Developer - assisted with design" → blocking; demote to a gap.
- A self-proclaimed "core competency" tag is not proof of a hard technical skill without demonstrated work history → blocking.
- Administrative items must not be strengths: an employer-side check or post-hire condition ("Verification of tertiary qualifications", "National Police Check", probationary period) is not a candidate asset. Severity: warning.
- Direct strengths must carry real domain evidence: a strength tagged evidence_type "direct" with confidence_level >= 4 must rest on a credential, demonstrated domain experience, or a named tool. If it actually rests on a soft-attribute/out-of-domain path it should be retagged transferable and de-weighted. Severity: warning.

### Exceptions — do NOT flag these
- SOFT-ATTRIBUTE EXCEPTION: soft_skills[] and core_competencies[] ARE valid evidence for requirements that are themselves soft-attribute or interest-based — warmth, patience, communication, teamwork, cultural respect, collaboration, interpersonal skills, "An interest in…". The hard-evidence rule applies only to substantive knowledge claims and technical skills.
- TRANSFERABLE-TAG EXCEPTION: a strength carrying evidence_type "transferable" (confidence <= 3, impact "Low") is the Analyst HONESTLY marking a soft-attribute / out-of-domain match (e.g. retail cash handling for "attention to detail"). This is desired behaviour. Do not flag it, and do not demand promotion to "direct". Only flag a transferable strength if the requirement is a substantive technical/knowledge claim that should have been a gap outright.

### Four hard overreach checks (all blocking when they fire)
These target OVERREACH. Never use them against a strength the Analyst already correctly tagged transferable / confidence <= 3 / impact Low, nor against a legitimate soft-attribute mapping.
1. DEMONSTRATED CONTRADICTIONS — reject a soft-skill strength when the candidate's actual prose (cv_raw / cover_letter_sample) demonstrates the opposite: a "written communication" strength when the prose has glaring spelling errors, impenetrable jargon for a non-specialist role, or dense passive bureaucratic language where clarity is required. This is why you get the raw prose; the structured profile is cleaned and hides it.
2. MODIFIER OVERREACH — audit hierarchy and funding modifiers strictly. JD requires "Lead"/"External" (lead investigator, external grants) and the candidate is only "Assistant"/"Internal" → the modifier mismatch makes it not a clean win. Demand downgrade or partial-match notation.
3. CONTEXTUAL DISPARITY — do not allow physical/retail/gig-economy resilience mapped onto highly specific corporate/executive soft skills. If the CONTEXT of the evidence is entirely divorced from the CONTEXT of the requirement, demand a gap. (Distinct from the legitimate transferable case above: this fires only when such a leap is carried as a real match.)
4. ACADEMIC CONFLATION — if a requirement specifically demands professional, commercial or industry experience, reject any strength whose SOLE evidence is university coursework, academic labs, or capstone/student projects. Note "Academic experience only".

## 2. Defend the Gaps (hunting false negatives)

The Analyst must not claim a gap if the CV contains a clear semantic equivalent. Scan candidate_profile yourself. Example (blocking): Analyst flagged "Agile Methodology" as a gap, but work history lists "Scrum Master" → overturn, promote to a strength.

Do NOT promote a gap whose requirement has candidate_status "Pending". Those are procedural statutory items (WWCC, police check, visa) deliberately parked as unscored — they are neither met nor a real gap.

## Verdict scale
- REJECT  — 1+ blocking issues.
- FLAG    — 0 blocking, 1+ warning issues.
- APPROVE — 0 issues.

## Patch
Alongside the audit, return a PATCH the server applies mechanically to gap_analysis.json. Only blocking issues get patch entries; warnings are advisory and get none. Use the exact \`id\` values from the input.
- demote_strengths: strengths that must become gaps. [{"id":"strength_3","reason":"<short>"}]
- promote_gaps: gaps that must become strengths. [{"id":"gap_2","reason":"<short>","proposed_evidence_source":"candidate_profile.work_history[0].responsibilities[2]"}] — proposed_evidence_source MUST be a real dot/bracket path into candidate_profile that you have verified exists in the input. The server drops the promotion if the path does not resolve.
- correct_evidence_source: strengths citing the wrong path but salvageable. [{"id":"strength_5","new_path":"candidate_profile.…"}]
Every blocking issue should correspond to exactly one patch entry. If a blocking issue has no safe mechanical fix, still report the issue and omit it from the patch.

## Audience tagging (per issue)
- "user"     — something about the candidate's actual fit they'd want to know (thin evidence, a missed gap, half-covered requirement). Phrase plainly, candidate-facing: "Communication: only verbal experience is evidenced; written communication isn't demonstrated in the CV."
- "internal" — classification/tagging mechanics that don't change the candidate's story ("retag direct→transferable", "move admin item out of strengths"). Dev-facing.
Rule of thumb: evidence-sufficiency → user; tagging mechanics → internal.

## Output
Output ONLY a JSON object, no prose, no code fences:
{"verdict":"REJECT","agent":"analyst","summary":"2 blocking + 0 warning issue(s).","issues":[{"field":"strengths[2]","problem":"<actionable finding>","severity":"blocking","audience":"user"}],"patch":{"demote_strengths":[],"promote_gaps":[],"correct_evidence_source":[]}}
On APPROVE, issues is [] and every patch array is [].`;

// Tolerant single-object extractor — the object sibling of adjudicator.js's extractJsonArray, handling
// accidental prose/fences around the JSON.
function extractJsonObject(text) {
  if (!text) return null;
  const fenced = text.replace(/```(?:json)?/gi, '').trim();
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try { return JSON.parse(fenced.slice(start, end + 1)); } catch { return null; }
}

// Local twin of dispatch.js's resolvePath. Duplicated rather than imported on purpose: dispatch.js
// imports this module, and importing back would make the cycle load-bearing for a 10-line helper.
// Used ONLY to verify a promotion's proposed path exists before granting credit.
function resolvePath(root, path, rootPrefix) {
  if (!path || typeof path !== 'string') return undefined;
  const stripped = rootPrefix ? path.replace(new RegExp('^' + rootPrefix + '\\.'), '') : path;
  const parts = stripped.split(/[.\[\]]/).filter(Boolean);
  let cur = root;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

const readJSON = name => JSON.parse(readFileSync(join(WORKSPACE_DIR, name), 'utf8'));
const readText = name => readFileSync(join(WORKSPACE_DIR, name), 'utf8');

/**
 * Apply the validator's patch to a gap_analysis object, in place.
 *
 * Mechanical only — mirrors _repairGapAnalysis's shape (mutate + return a summary for logging).
 *
 * CRITICAL: the fit score is computed from `requirements[].candidate_status` (calculateFitScore), and
 * strengths[] is now DERIVED from requirements[] by deriveStrengths (dispatch.js) right after this runs.
 * So this patch touches ONLY requirements[] (candidate_status / evidence_source / evidence_type) and the
 * gaps[] list — the strengths array is rebuilt from the patched requirements, never edited here. A patch
 * that only moved items between strengths[]/gaps[] would be doubly dead now: it wouldn't budge the score
 * AND the derivation would overwrite it. Every entry below flips the linked requirement via requirement_id;
 * an entry with no resolvable requirement is skipped, because there is nothing real to change.
 *
 * @param {object} gapAnalysis  parsed gap_analysis.json (mutated)
 * @param {object} patch        {demote_strengths, promote_gaps, correct_evidence_source}
 * @param {object} candidateProfile  used to verify promotion paths resolve before granting credit
 * @returns {{applied: string[], skipped: string[]}}
 */
export function applyAnalystValidatorPatch(gapAnalysis, patch, candidateProfile = null) {
  const applied = [];
  const skipped = [];
  if (!patch || typeof patch !== 'object') return { applied, skipped };

  const reqs = gapAnalysis.requirements ?? [];
  const reqById = new Map(reqs.map(r => [r.id, r]));
  const nextGapId = arr => {
    const max = arr.reduce((m, x) => {
      const n = parseInt(String(x?.id ?? '').replace('gap_', ''), 10);
      return Number.isFinite(n) && n > m ? n : m;
    }, 0);
    return `gap_${max + 1}`;
  };

  // ── Demote: flip the strength's requirement → Gap, and add a gap entry. The derivation will drop the
  // strength on the next pass because the requirement is no longer Met. Always safe (removes credit).
  for (const d of (patch.demote_strengths ?? [])) {
    const s = (gapAnalysis.strengths ?? []).find(x => x.id === d?.id);
    if (!s) { skipped.push(`demote ${d?.id}: no such strength`); continue; }
    const req = reqById.get(s.requirement_id);
    if (!req) { skipped.push(`demote ${d.id}: strength has no linked requirement`); continue; }
    gapAnalysis.gaps = gapAnalysis.gaps ?? [];
    gapAnalysis.gaps.push({
      id: nextGapId(gapAnalysis.gaps),
      gap_text: req.requirement_text ?? s.strength_text,
      requirement_source: req.source ?? null,
      requirement_id: req.id,
      tier: req.tier ?? s.tier ?? null,
      // Deterministic from tier — a missing required item hurts more than a missing preferred one.
      severity: (req.tier ?? s.tier) === 'Baseline' ? 'High' : 'Medium',
      evidence_context: d.reason ?? 'Demoted by validator: cited evidence does not prove the requirement.',
      mitigation_strategy: 'Address directly: the CV does not yet evidence this requirement.',
    });
    req.candidate_status = 'Gap';
    req.evidence_source = null;
    req.evidence_downgrade = { reason: d.reason ?? 'validator: insufficient evidence' };
    applied.push(`demote ${d.id} → gap (${req.id} → Gap)`);
  }

  // ── Promote: flip the gap's requirement → Met and remove the gap; the derivation materialises the
  // strength from that requirement. GRANTS credit, so it is gated: a hallucinated path would inflate the
  // fit score. Verify the path resolves AND a real requirement backs the gap; skip otherwise.
  for (const p of (patch.promote_gaps ?? [])) {
    const i = (gapAnalysis.gaps ?? []).findIndex(g => g.id === p?.id);
    if (i === -1) { skipped.push(`promote ${p?.id}: no such gap`); continue; }
    const g = gapAnalysis.gaps[i];
    const req = reqById.get(g.requirement_id);
    if (!req) { skipped.push(`promote ${p.id}: gap has no linked requirement (nothing to score)`); continue; }
    if (req.candidate_status === 'Pending') { skipped.push(`promote ${p.id}: requirement is Pending (administrative, unscored)`); continue; }
    const path = p.proposed_evidence_source;
    if (!path || (candidateProfile && resolvePath(candidateProfile, path, 'candidate_profile') == null)) {
      skipped.push(`promote ${p.id}: proposed_evidence_source does not resolve (${path ?? 'none'})`);
      continue;
    }
    gapAnalysis.gaps.splice(i, 1);
    req.candidate_status = 'Met';
    req.evidence_source = path;
    req.confidence_level = 4;
    req.evidence_type = 'direct';                       // derivation membership needs a tag
    req.strength_note = p.reason ?? 'Promoted by validator: evidence exists in the CV.';
    applied.push(`promote ${p.id} → strength (${req.id} → Met)`);
  }

  // ── Correct a cited path: fix it on the requirement; the derived strength picks up the new path.
  for (const c of (patch.correct_evidence_source ?? [])) {
    const s = (gapAnalysis.strengths ?? []).find(x => x.id === c?.id);
    if (!s) { skipped.push(`correct ${c?.id}: no such strength`); continue; }
    if (!c.new_path) { skipped.push(`correct ${c.id}: no new_path`); continue; }
    const req = reqById.get(s.requirement_id);
    if (!req) { skipped.push(`correct ${c.id}: strength has no linked requirement`); continue; }
    req.evidence_source = c.new_path;
    applied.push(`correct ${c.id} evidence_source`);
  }

  return { applied, skipped };
}

// Fail-open verdict. Written to disk like any other so the audit trail shows WHY an audit is missing.
const unavailable = reason => ({
  verdict: 'APPROVE',
  agent: 'analyst',
  summary: `analyst_validator_unavailable: ${reason}`,
  issues: [],
  patch: null,
});

/**
 * Run the semantic audit and, on REJECT, patch gap_analysis.json in place — exactly once, no loop.
 *
 * Must be called only once gap_analysis.json is known fresh (see finishAnalystTurn's awaitOutputReady
 * gate in dispatch.js) — it reads the file straight off disk.
 *
 * Never throws: every failure path returns the fail-open verdict, because the caller sits in a
 * .then() whose next step is checkJoin(), and a throw there would hang the analysis join.
 *
 * @returns {Promise<string|null>} compact summary line for state.analystValidatorSummary (checkJoin
 *          discards it — kept for parity/debuggability), or null if nothing to report.
 */
export async function runAnalystValidator() {
  const gapPath = join(WORKSPACE_DIR, 'gap_analysis.json');
  let verdict;
  let gapAnalysis = null;
  let candidateProfile = null;

  try {
    gapAnalysis     = readJSON('gap_analysis.json');
    candidateProfile = readJSON('candidate_profile.json');
    const enhancedJD = readJSON('enhanced_jd.json');
    const cvRaw      = readText('cv_raw.txt');
    // Optional — absence is normal and must never be reported as a finding.
    let coverLetter = '';
    try { coverLetter = readText('cover_letter_sample.txt'); } catch {}

    const userPrompt = [
      '## gap_analysis.json\n' + JSON.stringify(gapAnalysis),
      '## candidate_profile.json\n' + JSON.stringify(candidateProfile),
      '## enhanced_jd.json\n' + JSON.stringify(enhancedJD),
      '## cv_raw.txt (the candidate\'s raw, unedited prose)\n' + cvRaw,
      coverLetter ? '## cover_letter_sample.txt\n' + coverLetter : '## cover_letter_sample.txt\n(not provided — this is normal, do not flag it)',
      'Audit the gap analysis above. Output only the JSON object.',
    ].join('\n\n');

    const content = await callOpenRouter({
      model: OPENROUTER_MODEL,
      systemPrompt: SYSTEM_RUBRIC,
      userPrompt,
      temperature: 0,
      maxTokens: MAX_TOKENS,
      timeoutMs: TIMEOUT_MS,
      label: 'analyst_validator',
    });

    const parsed = extractJsonObject(content);
    if (!parsed) {
      // Log the raw head — a fail-open parse error is otherwise invisible (the pipeline just carries
      // on unaudited), and the model's actual output is the only way to tell a truncation from a
      // refusal from a prose preamble.
      console.warn(`[Analyst · validator] unparseable response (${content?.length ?? 0} chars): ${JSON.stringify(content?.slice(0, 300))}`);
      verdict = unavailable('parse_failed');
    } else if (!VERDICTS.has(String(parsed.verdict).toUpperCase())) {
      verdict = unavailable(`bad_verdict_enum: ${String(parsed.verdict).slice(0, 40)}`);
    } else {
      verdict = {
        verdict: String(parsed.verdict).toUpperCase(),
        agent: 'analyst',
        summary: String(parsed.summary ?? '').slice(0, 400),
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        patch: parsed.patch ?? null,
      };
    }
  } catch (err) {
    verdict = unavailable(err.reason ?? err.message);
  }

  if (verdict.summary?.startsWith('analyst_validator_unavailable')) {
    console.warn(`[Analyst · validator] ${verdict.summary} — skipping audit (fail-open)`);
  }

  // One fix pass, structurally — there is no loop and no re-validation, so the old "do NOT call the
  // validator a second time" instruction is now unrepresentable rather than merely forbidden.
  if (verdict.verdict === 'REJECT' && verdict.patch && gapAnalysis) {
    try {
      const { applied, skipped } = applyAnalystValidatorPatch(gapAnalysis, verdict.patch, candidateProfile);
      if (applied.length) {
        writeFileSync(gapPath, JSON.stringify(gapAnalysis, null, 2), 'utf8');
        console.log(`[Analyst · validator] patch applied: ${applied.join('; ')}`);
      }
      if (skipped.length) console.warn(`[Analyst · validator] patch entries skipped: ${skipped.join('; ')}`);
      verdict.patch_result = { applied, skipped };
    } catch (e) {
      console.error('[Analyst · validator] patch apply failed:', e.message);
      verdict.patch_result = { applied: [], skipped: [`patch_apply_error: ${e.message}`] };
    }
  }

  // Audit trail only — nothing reads this file now that buildAnalystValidatorSummary is gone. Kept
  // because a silent internal QA step with no artifact is undebuggable, and constants.js still
  // scaffolds the file.
  try {
    writeFileSync(join(WORKSPACE_DIR, 'analyst_validator_verdict.json'), JSON.stringify(verdict, null, 2), 'utf8');
  } catch (e) {
    console.warn(`[Analyst · validator] verdict write failed: ${e.message}`);
  }

  if (!verdict.verdict) return null;
  const count = verdict.issues?.length ?? 0;
  console.log(`[Analyst · validator] ${verdict.verdict} — ${count} issue(s)`);
  return `🔍 **Validator: ${verdict.verdict}** — ${count} issue${count === 1 ? '' : 's'}`;
}
