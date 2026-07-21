// Doc validator — the ProjectSetup "agent" that vets the two uploaded documents before the pipeline
// commits to them. Runs on EVERY new project (once, at ProjectSetup), not just on a suspicion.
//
// WHY THIS EXISTS: the upload endpoint only rejects files under 150 chars, and the old regex heuristic
// only caught CV/JD SWAPS. Neither notices when a document is simply the WRONG THING — a scanned PDF
// that extracted to garbage, an invoice, a cover letter in the CV slot, two unrelated PDFs. Those sailed
// straight through to the Extractor, which then failed on nonsense input with an opaque error. Judging
// "is this actually a CV / actually a JD" is irreducibly semantic — an LLM does it trivially, code does
// not. So the deterministic swap-regex is retired and this one call owns the whole verdict: is each
// document valid AND in the right slot.
//
// NON-BLOCKING by design. The verdict never hard-stops the user: a problem surfaces a notice with a
// "Continue anyway" escape hatch (broadcastSlotGate). FAIL-OPEN on any transport/parse failure — an LLM
// hiccup must not strand a legitimate upload, so an unreadable verdict proceeds exactly as before this
// check existed (no regression, the Extractor is still the backstop).

import { readFileSync } from 'fs';
import { join } from 'path';
import { WORKSPACE_DIR } from '../config/constants.js';
import { callOpenRouter } from './llm.js';

const OPENROUTER_MODEL = 'anthropic/claude-haiku-4.5'; // same slug as adjudicator.js — judgment call
const TIMEOUT_MS = 30_000;
const MAX_TOKENS = 512; // one JSON verdict, no reasoning model — a tight cap is plenty

// Only the head of each file is needed: a document's type is unambiguous within the first page, and
// sending the whole thing wastes tokens and risks a truncation-parse-fail (which would fail-open anyway).
const HEAD_CHARS = 4_000;

const SYSTEM_RUBRIC = `You vet two uploaded documents for a job-application tool. One was uploaded into the CV/resume slot, the other into the job-description (JD) slot. Classify what each ACTUALLY is.

A CV/RESUME describes ONE person: their work history, education, skills, achievements, contact details. Name-led or first-person.

A JOB DESCRIPTION advertises ONE role at a company: responsibilities, requirements, "we are looking for", "about us", how to apply, salary.

Anything else — an invoice, a letter, an article, an essay, garbled/extraction-failed text (repeated glyphs, no readable words), a blank or near-blank document — is OTHER.

Judge each document AS A WHOLE. A real CV often quotes the target role, and a real JD often lists "experience/skills/education" as requirements — surface keyword overlap does NOT make a document the wrong type. Be lenient about a genuine CV or JD (short, unusual formatting, non-English → still counts). Only return OTHER when the document is genuinely not a usable CV/JD.

Reply with ONLY a JSON object, no prose:
{"cv_slot_is": "CV" | "JD" | "OTHER", "jd_slot_is": "CV" | "JD" | "OTHER"}`;

// Returns { ok, problem } where problem is one of the broadcastSlotGate keys:
//   null          — both documents valid and in the right slots → proceed
//   'swap'        — a valid CV and JD, but swapped between the two slots
//   'cv_invalid'  — the CV slot does not hold a usable CV
//   'jd_invalid'  — the JD slot does not hold a usable JD
//   'both_invalid'— neither slot holds a usable document (and not a clean swap)
// Fail-open: any read/transport/parse failure returns { ok: true } (proceed, no notice).
export async function validateDocs() {
  let cv, jd;
  try { cv = readFileSync(join(WORKSPACE_DIR, 'cv_raw.txt'), 'utf8'); } catch { return { ok: true }; }
  try { jd = readFileSync(join(WORKSPACE_DIR, 'jd_raw.txt'), 'utf8'); } catch { return { ok: true }; }
  if (!cv.trim() || !jd.trim()) return { ok: true }; // emptiness is caught upstream (files_missing / <150)

  const userPrompt =
    `Document in the CV slot (cv_raw.txt):\n"""\n${cv.slice(0, HEAD_CHARS)}\n"""\n\n` +
    `Document in the JD slot (jd_raw.txt):\n"""\n${jd.slice(0, HEAD_CHARS)}\n"""`;

  let content;
  try {
    content = await callOpenRouter({
      model: OPENROUTER_MODEL,
      systemPrompt: SYSTEM_RUBRIC,
      userPrompt,
      temperature: 0,
      maxTokens: MAX_TOKENS,
      timeoutMs: TIMEOUT_MS,
      cacheSystem: true, // Anthropic-backed — the static rubric caches across calls
      label: 'doc_validator',
    });
  } catch (err) {
    console.warn(`[doc-validator] fail-open: ${err.reason ?? err.message}`);
    return { ok: true };
  }

  const parsed = extractJson(content);
  const cvIs = normType(parsed?.cv_slot_is);
  const jdIs = normType(parsed?.jd_slot_is);
  if (!cvIs || !jdIs) {
    console.warn('[doc-validator] fail-open: unparseable verdict');
    return { ok: true };
  }

  // A clean swap (each slot holds the other's valid document) is its own case — both files are usable,
  // they just need un-swapping. Otherwise flag whichever slot(s) don't hold their expected type.
  if (cvIs === 'JD' && jdIs === 'CV') return { ok: false, problem: 'swap' };
  const cvBad = cvIs !== 'CV';
  const jdBad = jdIs !== 'JD';
  if (cvBad && jdBad) return { ok: false, problem: 'both_invalid' };
  if (cvBad)          return { ok: false, problem: 'cv_invalid' };
  if (jdBad)          return { ok: false, problem: 'jd_invalid' };
  return { ok: true };
}

const normType = v => {
  const s = String(v ?? '').toUpperCase();
  return s === 'CV' || s === 'JD' || s === 'OTHER' ? s : null;
};

// Tolerant JSON pull — the model may fence it or add a stray line. Grab the first {...} block.
function extractJson(text) {
  if (typeof text !== 'string') return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}
