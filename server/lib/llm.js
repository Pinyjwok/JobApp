// Shared OpenRouter transport for the server's LLM calls.
//
// This plumbing lived inline in adjudicator.js, which was the only direct-API caller. The Analyst
// Validator (analyst-validator.js) now needs the identical HTTP/key/retry/timeout behaviour, so the
// transport moved here rather than being copy-pasted. Everything ABOVE the transport stays with each
// caller, because they legitimately disagree:
//   adjudicator.js       → expects a JSON array of per-gap verdicts, fails CLOSED (a wrong ACCEPTED
//                          inflates the candidate, so a blip must not grant credit).
//   analyst-validator.js → expects a single JSON object, fails OPEN (advisory QA nothing gates on;
//                          skipping it silently beats stalling the pipeline).
// So this module owns key read, request shape, timeout and retry, and returns raw completion text.
// Parsing, shape validation and fallback policy are the caller's.

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = join(__dirname, '..', '..', 'recipe', '.env');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Transport failure carrying the caller's `label`-prefixed reason string (e.g. "adjudicator_timeout").
// Callers map .reason straight into their own fallback payload, so the strings stay caller-namespaced.
export class OpenRouterError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'OpenRouterError';
    this.reason = reason;
  }
}

// Memoized across the process — the key file is read once. `undefined` = not yet read, `null` = read
// and absent (so a missing key doesn't re-read the file on every call).
let _cachedKey;
export function getOpenRouterKey() {
  if (_cachedKey !== undefined) return _cachedKey;
  _cachedKey = null;
  try {
    const raw = readFileSync(ENV_FILE, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*OPENROUTER_API_KEY\s*=\s*(.+?)\s*$/);
      if (m) { _cachedKey = m[1].replace(/^['"]|['"]$/g, ''); break; }
    }
  } catch (e) {
    console.warn('[llm] could not read OPENROUTER_API_KEY:', e.message);
  }
  return _cachedKey;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * One OpenRouter chat completion. Retries once on transient failure (429 / 5xx / network / timeout)
 * so a blip doesn't get mistaken for a real answer; other 4xx and parse failures are non-retryable.
 *
 * @param {object}  o
 * @param {string}  o.model         OpenRouter model slug.
 * @param {string}  o.systemPrompt  Static rubric.
 * @param {string}  o.userPrompt    Per-call payload.
 * @param {number} [o.temperature]  Default 0 — these are judgment calls, not creative writing.
 * @param {number} [o.maxTokens]    Omitted → provider default.
 * @param {number} [o.timeoutMs]    Per-attempt abort budget (not a total across retries).
 * @param {boolean}[o.cacheSystem]  Mark the system prompt cacheable (Anthropic-only; OpenRouter passes
 *                                  the field through, so only set it for Anthropic-backed models).
 * @param {string} [o.label]        Prefix for reason strings, e.g. "adjudicator" → "adjudicator_timeout".
 * @returns {Promise<string>}       Raw completion text on 2xx.
 * @throws  {OpenRouterError}       On no key, exhausted retries, or a non-retryable HTTP status.
 */
export async function callOpenRouter({
  model, systemPrompt, userPrompt,
  temperature = 0, maxTokens, timeoutMs = 20_000,
  cacheSystem = false, label = 'llm',
}) {
  const key = getOpenRouterKey();
  if (!key) throw new OpenRouterError(`${label}_unavailable: no OPENROUTER_API_KEY`);

  const body = {
    model,
    temperature,
    ...(maxTokens != null ? { max_tokens: maxTokens } : {}),
    messages: [
      {
        role: 'system',
        content: cacheSystem
          ? [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]
          : systemPrompt,
      },
      { role: 'user', content: userPrompt },
    ],
  };

  const MAX_ATTEMPTS = 2;
  let lastReason = `${label}_unknown`;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        lastReason = `${label}_http_${resp.status}: ${errText.slice(0, 120)}`;
        const retryable = resp.status === 429 || resp.status >= 500;
        if (retryable && attempt < MAX_ATTEMPTS) { await sleep(400 * attempt); continue; }
        throw new OpenRouterError(lastReason);
      }
      const data = await resp.json();
      const content = data?.choices?.[0]?.message?.content ?? '';
      return typeof content === 'string' ? content : JSON.stringify(content);
    } catch (err) {
      // A non-retryable status already decided its outcome above — don't let the retry arm re-handle it.
      if (err instanceof OpenRouterError) throw err;
      lastReason = err.name === 'AbortError' ? `${label}_timeout` : `${label}_error: ${err.message}`;
      if (attempt < MAX_ATTEMPTS) { await sleep(400 * attempt); continue; }
      throw new OpenRouterError(lastReason);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new OpenRouterError(lastReason);
}
