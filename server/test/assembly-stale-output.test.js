// Regression test for the freshness guard in mergePhaseOutput (server/lib/dispatch.js).
//
// Guards the 2026-08-09 fix: a phase artifact left over from a PREVIOUS run must not be merged into
// cv_assembly_state.json and shown to the user as this turn's section. The shape guard
// (_phaseHasRealOutput) can't see the difference — Credentials Formatter's legitimately-empty
// education[]/certifications[] is a valid schema either way — so mtime is the only honest signal.
// The check used to run AFTER the write and only warn, so the bad state was already on disk.
//
// The no-dispatchStart case matters just as much: resume and the revise re-merge legitimately merge an
// old file, so freshness must stay opt-in per call or those flows break.
//
// Run: node --test server/test/assembly-stale-output.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the workspace readers at a throwaway fixture dir BEFORE dispatch.js (→ constants.js) is imported.
const fixtureDir = mkdtempSync(join(tmpdir(), 'stalemerge-'));
process.env.JOBAPP_WORKSPACE_DIR = fixtureDir;
const { mergePhaseOutput } = await import('../lib/dispatch.js');

const w = (name, obj) => writeFileSync(join(fixtureDir, name), JSON.stringify(obj, null, 2));
const read = name => JSON.parse(readFileSync(join(fixtureDir, name), 'utf8'));

// Phase 5 = Credentials Formatter → cf_output.json. Empty arrays are a REAL section (candidate has no
// formal education/certs), which is exactly why the shape guard can't catch a stale file here.
const CF_EMPTY = { data: { education: [], certifications: [] } };

function resetState() {
  w('cv_assembly_state.json', {
    current_phase: 5,
    phases: Array.from({ length: 8 }, (_, i) => ({ phase: i + 1, status: 'PENDING', data: null })),
    metadata: { completed_phases: 4, last_updated: '2026-01-01T00:00:00.000Z' },
  });
}

// Write cf_output.json and force its mtime to `secondsAgo` in the past.
function writeOutput(data, secondsAgo = 0) {
  w('cf_output.json', data);
  if (secondsAgo) {
    const t = new Date(Date.now() - secondsAgo * 1000);
    utimesSync(join(fixtureDir, 'cf_output.json'), t, t);
  }
}

test('stale artifact is rejected and cv_assembly_state is left untouched', async () => {
  resetState();
  writeOutput(CF_EMPTY, 600); // written 10 minutes before this "dispatch"
  const before = readFileSync(join(fixtureDir, 'cv_assembly_state.json'), 'utf8');

  const result = await mergePhaseOutput(5, Date.now());

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'stale_output');
  // The whole point of moving the check ahead of the write: nothing may have been persisted.
  assert.equal(readFileSync(join(fixtureDir, 'cv_assembly_state.json'), 'utf8'), before);
  assert.equal(read('cv_assembly_state.json').phases[4].status, 'PENDING');
});

test('fresh artifact merges and advances', async () => {
  resetState();
  writeOutput(CF_EMPTY);

  const result = await mergePhaseOutput(5, Date.now() - 5000); // dispatch started before the write

  assert.equal(result.ok, true);
  const cv = read('cv_assembly_state.json');
  assert.equal(cv.phases[4].status, 'COMPLETE');
  assert.deepEqual(cv.phases[4].data, CF_EMPTY.data); // empty arrays are a real, complete section
  assert.equal(cv.current_phase, 6);
  assert.equal(cv.metadata.completed_phases, 5);
});

test('no dispatchStart skips the freshness check (resume / revise re-merge)', async () => {
  resetState();
  writeOutput(CF_EMPTY, 86_400); // a day old — these callers merge old files on purpose

  const result = await mergePhaseOutput(5);

  assert.equal(result.ok, true);
  assert.equal(read('cv_assembly_state.json').phases[4].status, 'COMPLETE');
});

test('empty output still fails before freshness is considered', async () => {
  resetState();
  writeOutput({ data: {} }); // fresh, but no schema — the agent asked a question instead of building

  const result = await mergePhaseOutput(5, Date.now() - 5000);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'empty_output');
  assert.equal(read('cv_assembly_state.json').phases[4].status, 'PENDING');
});

test('a phase with no output file is a no-op pass (SR/IC write state themselves)', async () => {
  resetState();
  assert.deepEqual(await mergePhaseOutput(7, Date.now()), { ok: true });
  assert.deepEqual(await mergePhaseOutput(8, Date.now()), { ok: true });
});
