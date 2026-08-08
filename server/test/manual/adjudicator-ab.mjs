// A/B harness for the gap adjudicator's rubric. MANUAL — not part of `npm test`.
//
// Why it's manual: it makes real OpenRouter calls (costs money, needs recipe/.env) and an LLM is not
// deterministic even at temperature 0, so it can't gate a commit. Read the table, judge the drift.
//
// What it's for: commit 63df8c4 changed one rubric EXAMPLE (a structural six-years-nursing case that
// returned plain ACCEPTED — a verdict adjudicateGapAnswers coerces away anyway, so the example only
// taught the model something the code overrides). Structural verdicts can't regress because of that
// coercion. The risk is elsewhere: dropping an ACCEPTED example can make the model stingier across the
// board and start downgrading fair NON-structural answers. So run the old rubric and the new one over
// the same fixtures and compare.
//
// Both sides run through the real adjudicateGapAnswers (parse, coercion, fallbacks included) — the old
// side by materialising the pre-change module next to llm.js so its relative import still resolves.
//
// Usage:
//   node server/test/manual/adjudicator-ab.mjs            # 1 run per side
//   node server/test/manual/adjudicator-ab.mjs --runs=3   # 3 runs per side, flags unstable items
//   node server/test/manual/adjudicator-ab.mjs --new-only  # skip the old side (half the cost)
//
// Cost: one batched call per side per run — a dozen short items on Sonnet, cents.

import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB_DIR    = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'lib');
const OLD_COMMIT = '63df8c4^';   // the commit that changed the rubric, one before
const OLD_TMP    = join(LIB_DIR, '__adjudicator_old.tmp.mjs');

const args    = process.argv.slice(2);
const RUNS    = Number(args.find(a => a.startsWith('--runs='))?.split('=')[1] ?? 1);
const NEW_ONLY = args.includes('--new-only');

// Fixtures. `expected` is a human judgement of the RIGHT answer, not a record of what the model said.
// The borderline non-structural items are the point — that's where a stingier rubric shows up first.
const ITEMS = [
  // --- structural: the ceiling is ACCEPTED_MITIGATED, enforced in code ---
  { gap_id: 'gap_1',  is_structural: true,  expected: 'ACCEPTED_MITIGATED',
    requirement: '5+ years registered nursing',
    answer: "I worked as an RN at St Vincent's for 6 years, most recently on the acute surgical ward." },
  { gap_id: 'gap_2',  is_structural: true,  expected: 'ACCEPTED_MITIGATED',
    requirement: 'Minimum 3 years professional UX design',
    answer: 'I have 1.5 years of contract UX at Bright Pixel plus a fintech onboarding project that lifted completion from 34% to 71%.' },
  { gap_id: 'gap_3',  is_structural: true,  expected: 'NOT_EVIDENCE',
    requirement: '10+ years senior leadership',
    answer: "I'm really keen to step into a leadership role and I think I'd be good at it." },
  { gap_id: 'gap_4',  is_structural: true,  expected: 'REQUIRES_ANCHOR',
    requirement: 'Minimum 5 years project management',
    answer: "I've done heaps of project management over the years." },

  // --- non-structural: clear cases, should be stable across both rubrics ---
  { gap_id: 'gap_5',  is_structural: false, expected: 'ACCEPTED',
    requirement: 'Evidence of right to work in Australia',
    answer: 'I have Australian citizenship.' },
  { gap_id: 'gap_6',  is_structural: false, expected: 'ACCEPTED',
    requirement: 'Current First Aid certificate (HLTAID012)',
    answer: 'I completed HLTAID012 in March 2026 through St John, valid for three years.' },
  { gap_id: 'gap_7',  is_structural: false, expected: 'REQUIRES_ANCHOR',
    requirement: 'Experience with Agile delivery',
    answer: "I've used Agile a lot." },
  { gap_id: 'gap_8',  is_structural: false, expected: 'REJECTED',
    requirement: 'Lead a team of 10+',
    answer: 'I once helped onboard a new hire.' },
  { gap_id: 'gap_9',  is_structural: false, expected: 'NOT_EVIDENCE',
    requirement: 'Proficiency with Power BI',
    answer: "I'm hoping to do a Power BI course soon." },

  // --- non-structural borderlines: the drift detectors ---
  { gap_id: 'gap_10', is_structural: false, expected: 'ACCEPTED',
    requirement: 'Experience mentoring junior staff',
    answer: 'At Northbridge Group I ran weekly mentoring sessions for two junior analysts for about 18 months.' },
  { gap_id: 'gap_11', is_structural: false, expected: 'ACCEPTED',
    requirement: 'Stakeholder engagement in local government',
    answer: 'At Bright Pixel I ran fortnightly workshops with three council teams during the rates portal rebuild.' },
  { gap_id: 'gap_12', is_structural: false, expected: 'ACCEPTED',
    requirement: 'Working with Children Check',
    answer: 'I hold a current NSW Working with Children Check; the number is in my application.' },
  { gap_id: 'gap_13', is_structural: false, expected: 'REJECTED',
    requirement: 'Experience running Kubernetes in production',
    answer: "I've deployed a couple of side projects to a k8s cluster I run at home." },
];

// Words the rubric explicitly bans from `reason` — these go to the user's phone.
const JARGON = ['temporal', 'affiliation', 'domain', 'leverage', 'utilise', 'utilize', 'competency', 'competencies', 'articulate', 'stakeholder alignment'];

async function loadOldAdjudicator() {
  const src = execFileSync('git', ['show', `${OLD_COMMIT}:server/lib/adjudicator.js`], { encoding: 'utf8' });
  writeFileSync(OLD_TMP, src); // next to llm.js so `./llm.js` resolves
  return import(OLD_TMP);
}

const byId = results => new Map(results.map(r => [r.gap_id, r]));

async function collect(fn, runs) {
  const out = [];
  for (let i = 0; i < runs; i++) out.push(byId(await fn(ITEMS)));
  return out;
}

// One verdict per item if every run agreed, otherwise the set of verdicts seen.
function summarise(runs, id) {
  const seen = [...new Set(runs.map(r => r.get(id)?.verdict ?? '—'))];
  return { verdict: seen.length === 1 ? seen[0] : seen.join('/'), stable: seen.length === 1 };
}

const pad = (s, n) => String(s).padEnd(n);

async function main() {
  const { adjudicateGapAnswers } = await import('../../lib/adjudicator.js');

  let oldRuns = null;
  if (!NEW_ONLY) {
    const old = await loadOldAdjudicator();
    console.log(`Running OLD rubric (${OLD_COMMIT}) × ${RUNS}…`);
    oldRuns = await collect(old.adjudicateGapAnswers, RUNS);
  }
  console.log(`Running NEW rubric (working tree) × ${RUNS}…\n`);
  const newRuns = await collect(adjudicateGapAnswers, RUNS);

  console.log(pad('item', 8) + pad('expected', 20) + (oldRuns ? pad('old', 22) : '') + pad('new', 22) + 'flags');
  console.log('-'.repeat(oldRuns ? 96 : 74));

  const drift = [], mismatch = [], unstable = [], jargon = [];
  for (const item of ITEMS) {
    const n = summarise(newRuns, item.gap_id);
    const o = oldRuns ? summarise(oldRuns, item.gap_id) : null;
    const flags = [];
    if (!n.stable) { flags.push('UNSTABLE'); unstable.push(item.gap_id); }
    if (n.stable && n.verdict !== item.expected) { flags.push('MISMATCH'); mismatch.push(item.gap_id); }
    if (o && o.stable && n.stable && o.verdict !== n.verdict) { flags.push('DRIFT'); drift.push(`${item.gap_id} ${o.verdict}→${n.verdict}`); }

    const reason = newRuns[0].get(item.gap_id)?.reason ?? '';
    const hit = JARGON.filter(w => reason.toLowerCase().includes(w));
    if (hit.length) { flags.push(`JARGON:${hit.join(',')}`); jargon.push(item.gap_id); }

    console.log(pad(item.gap_id, 8) + pad(item.expected, 20) + (o ? pad(o.verdict, 22) : '') + pad(n.verdict, 22) + flags.join(' '));
  }

  // Reasons are shown to the user verbatim. Worth reading side by side on the structural items: the
  // coercion rewrites the VERDICT but never the model's sentence, so a rubric that tells the model to
  // say ACCEPTED there produces copy that contradicts the verdict the user is actually given.
  console.log('\nReasons (shown to the user — check they read plainly and match the verdict):');
  for (const item of ITEMS) {
    console.log(`  ${pad(item.gap_id, 8)} NEW: ${newRuns[0].get(item.gap_id)?.reason ?? ''}`);
    if (oldRuns) console.log(`  ${pad('', 8)} OLD: ${oldRuns[0].get(item.gap_id)?.reason ?? ''}`);
  }

  console.log('\nSummary');
  console.log(`  drift vs old : ${drift.length ? drift.join(', ') : 'none'}`);
  console.log(`  vs expected  : ${mismatch.length ? mismatch.join(', ') : 'all match'}`);
  console.log(`  unstable     : ${unstable.length ? unstable.join(', ') : 'none'}${RUNS === 1 ? ' (single run — rerun with --runs=3 to detect)' : ''}`);
  console.log(`  jargon       : ${jargon.length ? jargon.join(', ') : 'none'}`);
  console.log('\nPass = structural items on ACCEPTED_MITIGATED, no non-structural item drifting DOWN a');
  console.log('level, reasons plain. A downward drift on gap_10..gap_13 is the regression to watch for.');
}

try {
  await main();
} finally {
  try { unlinkSync(OLD_TMP); } catch {}
}
