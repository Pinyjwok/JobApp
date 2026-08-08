// Regression test for _stripListClaims (server/lib/dispatch.js) — the server-side half of IC remediation.
//
// Guards the 2026-08-08 fix: career_history and key_achievements used to fall through to
// sectionType 'other', where this function had no code path to work_history[].bullets or
// key_achievements at all. Removals were structurally impossible, so the same claims re-flagged every
// round until IC_REMEDIATION_CAP dumped the user on "use it as-is".
//
// Two properties are load-bearing and easy to regress:
//   1. bullets/achievements match by CONTAINMENT (IC quotes a fragment, not the whole string), but the
//      containment set is SCOPED to claims naming that section — otherwise a short skills claim like
//      "Figma" deletes every bullet that merely mentions Figma;
//   2. every touched phase is re-synced to its output file. The delivered document is built from
//      pb/sc/hf_output.json (buildDocumentData), NOT from cv_assembly_state.json, so a removal that
//      only lands in state clears the integrity check and still ships in the CV.
//
// Run: node --test server/test/ic-list-claim-strip.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the workspace readers at a throwaway fixture dir BEFORE dispatch.js (→ constants.js) is imported.
const fixtureDir = mkdtempSync(join(tmpdir(), 'icstrip-'));
process.env.JOBAPP_WORKSPACE_DIR = fixtureDir;
const { _stripListClaims } = await import('../lib/dispatch.js');

const w = (name, obj) => writeFileSync(join(fixtureDir, name), JSON.stringify(obj, null, 2));
const read = name => JSON.parse(readFileSync(join(fixtureDir, name), 'utf8'));

const FABRICATED_BULLET = 'Reduced onboarding drop-off by 43% across the retail portfolio';
const REAL_BULLET       = 'Rebuilt the design system in Figma with the platform squad';
const FABRICATED_ACHV   = 'Named national designer of the year in 2024';
const REAL_ACHV         = 'Shipped the Spark accessibility uplift ahead of schedule';

// Mirrors the shapes the assembly phases actually write: phases[1] Profile Builder (key_achievements),
// phases[2] Skills Curator, phases[3] History Formatter (work_history[].bullets).
function seed() {
  const profileData = {
    profile_paragraph: { formatted_text: 'Senior product designer with a decade in regulated services.' },
    key_achievements: [FABRICATED_ACHV, REAL_ACHV],
  };
  const skillsData = {
    technical_skills: ['Figma', 'Design systems', 'Kubernetes'],
    soft_skills: ['Facilitation'],
    certifications: [],
    total_skills: 4,
  };
  const historyData = {
    work_history: [
      { employer: 'Bright Pixel Studio', bullets: [FABRICATED_BULLET, REAL_BULLET] },
      { employer: 'Northbridge Group',   bullets: ['Ran discovery for the claims rewrite'] },
    ],
    total_bullets: 3,
  };
  w('cv_assembly_state.json', {
    phases: [
      { phase: 1, data: {} },
      { phase: 2, data: profileData },
      { phase: 3, data: skillsData },
      { phase: 4, data: historyData },
      { phase: 5, data: {} }, { phase: 6, data: {} }, { phase: 7, data: {} }, { phase: 8, data: {} },
    ],
    metadata: { last_updated: '2026-01-01T00:00:00.000Z' },
  });
  w('pb_output.json', { data: profileData });
  w('sc_output.json', { data: skillsData });
  w('hf_output.json', { data: historyData });
  w('candidate_profile.json', { publications: [], awards: [] });
}

const claim = (section, text, sectionType = 'list') => ({ section, sectionType, claim: text });

test('career_history: a quoted FRAGMENT splices the whole bullet, siblings survive', () => {
  seed();
  // IC quotes the metric, not the sentence — containment is why this has to work.
  const removed = _stripListClaims([claim('career_history', 'onboarding drop-off by 43%')]);

  assert.equal(removed, 1);
  const wh = read('cv_assembly_state.json').phases[3].data.work_history;
  assert.deepEqual(wh[0].bullets, [REAL_BULLET]);
  assert.equal(wh[1].bullets.length, 1);              // other employers untouched
  assert.equal(read('cv_assembly_state.json').phases[3].data.total_bullets, 2); // recomputed, not stale
  // The shipped document reads hf_output.json, so the removal has to be there too.
  assert.deepEqual(read('hf_output.json').data.work_history[0].bullets, [REAL_BULLET]);
});

test('key_achievements: fragment match, spliced from state AND pb_output.json', () => {
  seed();
  const removed = _stripListClaims([claim('key_achievements', 'national designer of the year')]);

  assert.equal(removed, 1);
  assert.deepEqual(read('cv_assembly_state.json').phases[1].data.key_achievements, [REAL_ACHV]);
  assert.deepEqual(read('pb_output.json').data.key_achievements, [REAL_ACHV]);
});

test('a short skills claim does NOT delete bullets that merely mention it', () => {
  seed();
  // The over-deletion trap: "Figma" appears inside REAL_BULLET. Scoping containment to claims naming
  // that section is the only thing keeping the bullet alive.
  const removed = _stripListClaims([claim('skills', 'Figma')]);

  assert.equal(removed, 1);
  const cv = read('cv_assembly_state.json');
  assert.deepEqual(cv.phases[2].data.technical_skills, ['Design systems', 'Kubernetes']);
  assert.equal(cv.phases[2].data.total_skills, 3);
  assert.deepEqual(cv.phases[3].data.work_history[0].bullets, [FABRICATED_BULLET, REAL_BULLET]); // intact
  assert.deepEqual(read('sc_output.json').data.technical_skills, ['Design systems', 'Kubernetes']);
  // Untouched phases must not be rewritten from state.
  assert.deepEqual(read('hf_output.json').data.work_history[0].bullets, [FABRICATED_BULLET, REAL_BULLET]);
});

test("an unrecognised section stays best-effort: whole-item match only", () => {
  seed();
  const fragment = _stripListClaims([claim('mystery_section', 'national designer', 'other')]);
  assert.equal(fragment, 0, 'a fragment must not over-delete through the unknown-section path');
  assert.equal(read('cv_assembly_state.json').phases[1].data.key_achievements.length, 2);

  const whole = _stripListClaims([claim('mystery_section', FABRICATED_ACHV, 'other')]);
  assert.equal(whole, 1);
  assert.deepEqual(read('cv_assembly_state.json').phases[1].data.key_achievements, [REAL_ACHV]);
});

test('mixed batch across three sections removes each once', () => {
  seed();
  const removed = _stripListClaims([
    claim('career_history', 'onboarding drop-off by 43%'),
    claim('key_achievements', 'national designer of the year'),
    claim('skills', 'Kubernetes'),
  ]);

  assert.equal(removed, 3);
  const cv = read('cv_assembly_state.json');
  assert.deepEqual(cv.phases[3].data.work_history[0].bullets, [REAL_BULLET]);
  assert.deepEqual(cv.phases[1].data.key_achievements, [REAL_ACHV]);
  assert.deepEqual(cv.phases[2].data.technical_skills, ['Figma', 'Design systems']);
  assert.notEqual(cv.metadata.last_updated, '2026-01-01T00:00:00.000Z');
});

test('no claims / no match writes nothing', () => {
  seed();
  const before = readFileSync(join(fixtureDir, 'cv_assembly_state.json'), 'utf8');
  assert.equal(_stripListClaims([]), 0);
  assert.equal(_stripListClaims([claim('career_history', 'a claim nobody made')]), 0);
  assert.equal(readFileSync(join(fixtureDir, 'cv_assembly_state.json'), 'utf8'), before);
});
