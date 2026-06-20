// Gap-answer adjudicator.
//
// Supersedes evidence-classifier.js. Classifying EVIDENCE vs INTENT and judging whether the evidence
// actually clears the requirement's bar are the SAME cognitive act — read the candidate's free-text
// answer against the requirement and decide what it is worth. So they collapse into one LLM call that
// returns a single verdict per gap. Only ACCEPTED grants credit; the other three keep the gap open.
// Everything downstream (path resolution, bucketing, fit score) stays deterministic on the server.
//
// Verdicts:
//   ACCEPTED        concrete, presently-true fact that satisfies the requirement AND names where it
//                   happened (role/employer/project/credential held) → counts as Met (Candidate Evidence)
//   REQUIRES_ANCHOR concrete fact but UNANCHORED — no role/project a CV writer could attach it to.
//                   Carries anchor_prompt; the gap interview re-asks for the anchor.
//   REJECTED        a fact-claim, but too weak/partial to satisfy THIS requirement.
//   NOT_EVIDENCE    aspiration / plan / eligibility / vague familiarity (the old INTENT label).
//
// Model: Claude Haiku 4.5 via OpenRouter (known-good slug). Swap OPENROUTER_MODEL to a stronger
// reasoner if judgment quality needs it. Batched (one call for all answers), temperature 0, JSON-only.
// FAIL-CLOSED: on any failure/timeout every item falls back to NOT_EVIDENCE — never auto-inflates a
// gap to Met.

import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = join(__dirname, '..', '..', 'recipe', '.env');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = 'anthropic/claude-sonnet-4.6'; // judgment-heavy — Sonnet over Haiku
const TIMEOUT_MS = 20_000;

const VERDICTS = new Set(['ACCEPTED', 'REQUIRES_ANCHOR', 'REJECTED', 'NOT_EVIDENCE']);

let _cachedKey;
function getApiKey() {
  if (_cachedKey !== undefined) return _cachedKey;
  _cachedKey = null;
  try {
    const raw = readFileSync(ENV_FILE, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*OPENROUTER_API_KEY\s*=\s*(.+?)\s*$/);
      if (m) { _cachedKey = m[1].replace(/^['"]|['"]$/g, ''); break; }
    }
  } catch (e) {
    console.warn('[adjudicator] could not read OPENROUTER_API_KEY:', e.message);
  }
  return _cachedKey;
}

// Static rubric — cache_control marks it cacheable across calls (OpenRouter passes this to Anthropic).
const SYSTEM_RUBRIC = `You are a hiring manager judging a candidate's free-text answer about a job requirement they were flagged as not yet meeting. For each item return ONE verdict.

ACCEPTED        = a concrete, presently-true fact that satisfies the requirement AND names where it happened (a specific role, employer, project, or a credential currently held).
REQUIRES_ANCHOR = a concrete fact, but UNANCHORED: no role/employer/project/timeframe a CV writer could attach it to. Example: "I have Agile experience" with no where or when. Set anchor_prompt to a short question asking for the missing context.
REJECTED        = a fact-claim, but too weak, partial, or off-target to satisfy THIS requirement.
NOT_EVIDENCE    = aspiration, plan, eligibility, willingness, or vague familiarity. "I plan to", "I'm hoping to", "I'm eligible for", "I'm familiar with the basics".

Rules:
- Judge against the requirement's bar. Baseline/mandatory items demand stronger, more specific proof than preferred items.
- Be CONSERVATIVE. When unsure, choose the lower verdict (severity order, lowest first: NOT_EVIDENCE, REJECTED, REQUIRES_ANCHOR, ACCEPTED). A wrong ACCEPTED inflates the candidate; the other verdicts are recoverable (the user can re-answer).
- Only ACCEPTED grants credit. The other three keep the gap open.
- anchor_prompt: ONLY for REQUIRES_ANCHOR; a short question naming what's missing, e.g. "Which role or project was this at?". Empty string otherwise.
- reason: one short clause the user could read explaining the verdict.

Examples:
- requirement "Evidence of right to work in Australia" | answer "I have Australian citizenship" -> ACCEPTED
- requirement "5+ years registered nursing" | answer "I worked as an RN at St Vincent's for 6 years" -> ACCEPTED
- requirement "Experience with Agile delivery" | answer "I've used Agile a lot" -> REQUIRES_ANCHOR (anchor_prompt "Which role or project did you use Agile on?")
- requirement "Lead a team of 10+" | answer "I once helped onboard a new hire" -> REJECTED
- requirement "First Aid (HLTAID012) certification" | answer "I'm hoping to do my first aid course soon" -> NOT_EVIDENCE

Output ONLY a JSON array, no prose, no code fences:
[{"gap_id":"gap_1","verdict":"ACCEPTED","reason":"<short>","anchor_prompt":""}, ...]
One object per input item, same gap_id.`;

// Tolerant JSON-array extractor (handles accidental prose/fences around the array).
function extractJsonArray(text) {
  if (!text) return null;
  const fenced = text.replace(/```(?:json)?/gi, '').trim();
  const start = fenced.indexOf('[');
  const end = fenced.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return null;
  try { return JSON.parse(fenced.slice(start, end + 1)); } catch { return null; }
}

/**
 * Adjudicate a batch of answered gaps.
 * @param {Array<{gap_id:string, requirement:string, answer:string, tier?:string}>} items  non-skipped answers only
 * @returns {Promise<Array<{gap_id:string, verdict:string, reason:string, anchor_prompt:string}>>}
 *          Always returns one entry per input (NOT_EVIDENCE fallback on any failure).
 */
export async function adjudicateGapAnswers(items) {
  const fallback = (reason) => items.map(i => ({ gap_id: i.gap_id, verdict: 'NOT_EVIDENCE', reason, anchor_prompt: '' }));
  if (!Array.isArray(items) || items.length === 0) return [];

  const key = getApiKey();
  if (!key) return fallback('adjudicator_unavailable: no OPENROUTER_API_KEY');

  const userPayload = JSON.stringify(items.map(i => ({
    gap_id: i.gap_id, requirement: i.requirement, answer: i.answer, tier: i.tier ?? null,
  })));
  const body = {
    model: OPENROUTER_MODEL,
    temperature: 0,
    // Scale with item count so many answers can't truncate the JSON (→ parse fail → all-NOT_EVIDENCE).
    // Each item is a small object with a reason + optional anchor_prompt; ~280 tokens/item is ample.
    max_tokens: Math.min(4096, 400 + items.length * 280),
    messages: [
      { role: 'system', content: [{ type: 'text', text: SYSTEM_RUBRIC, cache_control: { type: 'ephemeral' } }] },
      { role: 'user', content: `Adjudicate these items:\n${userPayload}` },
    ],
  };

  // Retry once on transient failures (429 / 5xx / network / timeout) so a blip doesn't silently
  // reject real evidence. Non-retryable errors (4xx other than 429, parse failures) fall back immediately.
  const MAX_ATTEMPTS = 2;
  let lastReason = 'adjudicator_unknown';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const resp = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        lastReason = `adjudicator_http_${resp.status}: ${errText.slice(0, 120)}`;
        const retryable = resp.status === 429 || resp.status >= 500;
        if (retryable && attempt < MAX_ATTEMPTS) { await new Promise(r => setTimeout(r, 400 * attempt)); continue; }
        return fallback(lastReason);
      }
      const data = await resp.json();
      const content = data?.choices?.[0]?.message?.content ?? '';
      const parsed = extractJsonArray(typeof content === 'string' ? content : JSON.stringify(content));
      if (!Array.isArray(parsed)) return fallback('adjudicator_parse_failed');

      // Map by gap_id; coerce verdicts; default any missing/odd item to NOT_EVIDENCE.
      const byId = new Map();
      for (const p of parsed) {
        if (!p || !p.gap_id) continue;
        const verdict = VERDICTS.has(String(p.verdict).toUpperCase()) ? String(p.verdict).toUpperCase() : 'NOT_EVIDENCE';
        byId.set(p.gap_id, {
          gap_id: p.gap_id,
          verdict,
          reason: String(p.reason ?? '').slice(0, 240),
          anchor_prompt: verdict === 'REQUIRES_ANCHOR' ? String(p.anchor_prompt ?? '').slice(0, 240) : '',
        });
      }
      return items.map(i => byId.get(i.gap_id) ?? { gap_id: i.gap_id, verdict: 'NOT_EVIDENCE', reason: 'adjudicator_missing_item_fallback', anchor_prompt: '' });
    } catch (err) {
      lastReason = err.name === 'AbortError' ? 'adjudicator_timeout' : `adjudicator_error: ${err.message}`;
      if (attempt < MAX_ATTEMPTS) { await new Promise(r => setTimeout(r, 400 * attempt)); continue; }
      return fallback(lastReason);
    } finally {
      clearTimeout(timer);
    }
  }
  return fallback(lastReason);
}
