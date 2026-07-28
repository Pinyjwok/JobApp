// Regression test for the cover-letter branch of _assemblyChecks (server/lib/dispatch.js).
//
// Guards the 2026-07-20 fix: the server must NOT auto-delete a candidate's own achievement metrics
// from the cover letter. A prior "specific company claim" check flagged every number-bearing sentence
// as an unsupported company claim (validated against research_output only) and handed it to the SR
// __remediate__ re-flow, which gutted letters (e.g. Michelle Tanaka's "34% → 71%" vanished). That
// semantic vetting is owned by the phase-8 Integrity Checker; there must be no deterministic duplicate.
//
// Run: JOBAPP_WORKSPACE_DIR is set per-test to an isolated fixture dir, then dispatch.js is imported.
// node --test server/test/assembly-coverletter-checks.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the workspace readers at a throwaway fixture dir BEFORE dispatch.js (→ constants.js) is imported.
const fixtureDir = mkdtempSync(join(tmpdir(), 'asmcheck-'));
process.env.JOBAPP_WORKSPACE_DIR = fixtureDir;
const w = (name, obj) => writeFileSync(join(fixtureDir, name), typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));

// A realistic letter carrying the candidate's OWN metrics (traceable to the CV, NOT to company research).
const coverLetter = {
  salutation: 'Dear Hiring Manager,',
  full_letter: [
    'Dear Hiring Manager,',
    "At Bright Pixel Studio I led an end-to-end fintech onboarding redesign that improved task completion from 34% to 71%.",
    'Earlier, advising on M&A transactions of $50M to $500M taught me to translate complex requirements under deadline pressure.',
    "Suncorp's investment in the Spark design system signals a real commitment to design maturity.",
  ].join('\n\n'),
};
w('clw_output.json', { data: { cover_letter: coverLetter } });
w('project_meta.json', { company_name: 'Suncorp', position_title: 'UX/UI Designer' });
// research_output does NOT contain the candidate's metrics — the whole point of the old bug.
w('research_output.json', { research_data: { company_priorities: 'Spark design system; accessibility-first standards' } });
w('candidate_profile.json', {
  work_history: [{ employer: 'Bright Pixel Studio', achievements: ['Improved task completion from 34% to 71%'] }],
});
w('gap_analysis.json', { strengths: [] });
w('cv_raw.txt', 'Bright Pixel Studio — improved task completion from 34% to 71%. M&A transactions of $50M to $500M.');

const { _assemblyChecks } = await import('../lib/dispatch.js');

test.after(() => rmSync(fixtureDir, { recursive: true, force: true }));

test('candidate metric sentences are never queued for auto-delete', () => {
  const issues = _assemblyChecks('coverletter_writer');
  const proseRemovals = issues.filter(i => i.remedy?.kind === 'prose');
  assert.equal(
    proseRemovals.length, 0,
    `No cover-letter prose should be auto-deleted, got: ${JSON.stringify(proseRemovals)}`,
  );
  // Belt-and-suspenders: the candidate's metrics must not appear in any issue at all.
  const blob = JSON.stringify(issues);
  assert.ok(!blob.includes('34%') && !blob.includes('71%') && !blob.includes('$50M'),
    `Candidate metrics must not be flagged: ${blob}`);
});

test('deterministic cover-letter checks still fire (branch is alive)', () => {
  // A letter that never names the company should still raise the (advisory) company-name issue,
  // proving the branch runs and only the destructive check was removed.
  w('clw_output.json', { data: { cover_letter: { full_letter: 'Dear Hiring Manager, I would love this UX/UI Designer role.' } } });
  const issues = _assemblyChecks('coverletter_writer');
  assert.ok(
    issues.some(i => /Company name/i.test(i.problem)),
    `Expected the company-name check to fire, got: ${JSON.stringify(issues)}`,
  );
  // And it is advisory only — no remedy, so nothing gets auto-deleted.
  assert.equal(issues.filter(i => i.remedy).length, 0);
});
