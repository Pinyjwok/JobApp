// Gap-answer evidence classifier.
//
// Classifying a free-text gap answer as EVIDENCE vs INTENT is a SEMANTIC judgment, not a lexical one:
// "I have Australian citizenship" (EVIDENCE) vs "I plan to get citizenship" (INTENT) share the same
// keywords. A regex structurally cannot separate assertion from aspiration, so this one step — and
// only this step — is delegated to an LLM. Everything downstream (path resolution, bucketing, verdict,
// fit score) stays deterministic on the server.
//
// Model: Claude Haiku 4.5 via OpenRouter. Batched (one call for all answers), temperature 0,
// JSON-only output, conservative bias (EVIDENCE only for concrete presently-true facts). On any
// failure/timeout the caller falls back to INTENT — never auto-inflates a gap to Met.

import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = join(__dirname, '..', '..', 'recipe', '.env');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = 'anthropic/claude-haiku-4.5'; // adjust if OpenRouter changes the slug
const TIMEOUT_MS = 15_000;

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
    console.warn('[classifier] could not read OPENROUTER_API_KEY:', e.message);
  }
  return _cachedKey;
}

// Static rubric — cache_control marks it cacheable across calls (OpenRouter passes this to Anthropic).
const SYSTEM_RUBRIC = `You classify a candidate's free-text answer about a job requirement they were flagged as not yet meeting.

Return EVIDENCE or INTENT for each item.

EVIDENCE = the answer ASSERTS a concrete, presently-true, verifiable fact that satisfies the requirement (a held qualification, citizenship/visa already granted, a specific past role/project/outcome, a named credential the person currently holds).

INTENT = aspiration, plan, eligibility, willingness, vague familiarity, or anything not yet true ("I plan to", "I'm eligible for", "I'm hoping to", "I'm familiar with the basics", "I would like to").

Rules:
- Judge the SHAPE of the claim (is it concrete present-tense evidence?), NOT whether it is true — truth is verified downstream.
- Be CONSERVATIVE: when unsure between EVIDENCE and INTENT, choose INTENT. A wrong EVIDENCE label inflates the candidate's profile; a wrong INTENT label is harmless (the user can re-answer).
- "I have / I hold / I am a / I completed / I worked as" → usually EVIDENCE. "I plan / I will / I'm hoping / I intend / I could / eligible" → INTENT.

Examples:
- requirement "Evidence of right to work in Australia" | answer "I have an Australian citizenship" -> EVIDENCE
- requirement "Evidence of right to work in Australia" | answer "I plan to apply for a working visa" -> INTENT
- requirement "First Aid (HLTAID012) certification" | answer "I'm hoping to do my first aid course soon" -> INTENT
- requirement "5+ years registered nursing" | answer "I worked as an RN at St Vincent's for 6 years" -> EVIDENCE
- requirement "Knowledge of Reggio Emilia philosophy" | answer "I'm interested in learning more about it" -> INTENT

Output ONLY a JSON array, no prose, no code fences:
[{"gap_id":"gap_1","label":"EVIDENCE","reason":"<short reason>"}, ...]
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
 * Classify a batch of answered gaps.
 * @param {Array<{gap_id:string, requirement:string, answer:string}>} items  non-skipped answers only
 * @returns {Promise<Array<{gap_id:string, label:'EVIDENCE'|'INTENT', reason:string}>>}
 *          Always returns one entry per input (INTENT fallback on any failure).
 */
export async function classifyGapAnswers(items) {
  const fallback = (reason) => items.map(i => ({ gap_id: i.gap_id, label: 'INTENT', reason }));
  if (!Array.isArray(items) || items.length === 0) return [];

  const key = getApiKey();
  if (!key) return fallback('classifier_unavailable: no OPENROUTER_API_KEY');

  const userPayload = JSON.stringify(items.map(i => ({ gap_id: i.gap_id, requirement: i.requirement, answer: i.answer })));
  const body = {
    model: OPENROUTER_MODEL,
    temperature: 0,
    max_tokens: 1024,
    messages: [
      { role: 'system', content: [{ type: 'text', text: SYSTEM_RUBRIC, cache_control: { type: 'ephemeral' } }] },
      { role: 'user', content: `Classify these items:\n${userPayload}` },
    ],
  };

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
      return fallback(`classifier_http_${resp.status}: ${errText.slice(0, 120)}`);
    }
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content ?? '';
    const parsed = extractJsonArray(typeof content === 'string' ? content : JSON.stringify(content));
    if (!Array.isArray(parsed)) return fallback('classifier_parse_failed');

    // Map by gap_id; coerce labels; default any missing/odd item to INTENT.
    const byId = new Map();
    for (const p of parsed) {
      if (!p || !p.gap_id) continue;
      const label = String(p.label).toUpperCase() === 'EVIDENCE' ? 'EVIDENCE' : 'INTENT';
      byId.set(p.gap_id, { gap_id: p.gap_id, label, reason: String(p.reason ?? '').slice(0, 200) });
    }
    return items.map(i => byId.get(i.gap_id) ?? { gap_id: i.gap_id, label: 'INTENT', reason: 'classifier_missing_item_fallback' });
  } catch (err) {
    return fallback(err.name === 'AbortError' ? 'classifier_timeout' : `classifier_error: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}
