// Tests for healNestedArtifacts (server/lib/workspace-heal.js).
//
// The bug it repairs: KEMU's WriteFile creates workspace/<name>.json/<name>.json — a DIRECTORY holding
// the payload — when an agent calls it with named params. Observed live on sn_groups.json. The server's
// read then throws EISDIR into a catch that treats any failure as "no artifact", so the Style Negotiator
// silently degraded to floor-only groups.
//
// The repair moves files and must never destroy anything, so the destructive edges are what's tested:
// a wrapper holding extra files keeps them, and directories that merely look similar are left alone.
//
// Run: node --test server/test/workspace-heal.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.JOBAPP_WORKSPACE_DIR = mkdtempSync(join(tmpdir(), 'healdefault-'));
const { healNestedArtifacts } = await import('../lib/workspace-heal.js');

const fresh = () => mkdtempSync(join(tmpdir(), 'heal-'));

// The exact shape KEMU produces: a directory named like the file, with the file inside it.
function nest(dir, name, content) {
  mkdirSync(join(dir, name));
  writeFileSync(join(dir, name, name), content);
}

test('lifts a nested artifact back to the canonical path', () => {
  const ws = fresh();
  const payload = JSON.stringify([{ dimension: 'seniority' }]);
  nest(ws, 'sn_groups.json', payload);

  assert.deepEqual(healNestedArtifacts(ws), ['sn_groups.json']);

  const path = join(ws, 'sn_groups.json');
  assert.ok(statSync(path).isFile(), 'canonical path must now be a file, not a directory');
  assert.equal(readFileSync(path, 'utf8'), payload); // content preserved byte for byte
  assert.deepEqual(readdirSync(ws), ['sn_groups.json'], 'wrapper dir removed, no aside left behind');
});

test('repairs several artifacts in one sweep', () => {
  const ws = fresh();
  nest(ws, 'sn_groups.json', '[]');
  nest(ws, 'cf_output.json', '{"data":{}}');
  writeFileSync(join(ws, 'pb_output.json'), '{"data":{}}'); // already fine

  assert.deepEqual(healNestedArtifacts(ws).sort(), ['cf_output.json', 'sn_groups.json']);
  for (const f of ['sn_groups.json', 'cf_output.json', 'pb_output.json']) {
    assert.ok(statSync(join(ws, f)).isFile());
  }
});

test('a healthy workspace is untouched', () => {
  const ws = fresh();
  writeFileSync(join(ws, 'sn_groups.json'), '[]');
  mkdirSync(join(ws, 'archive')); // an ordinary directory

  assert.deepEqual(healNestedArtifacts(ws), []);
  assert.ok(statSync(join(ws, 'sn_groups.json')).isFile());
  assert.ok(statSync(join(ws, 'archive')).isDirectory());
});

test('a .json directory without the matching payload is left alone', () => {
  const ws = fresh();
  mkdirSync(join(ws, 'notes.json'));
  writeFileSync(join(ws, 'notes.json', 'something-else.txt'), 'keep me');

  assert.deepEqual(healNestedArtifacts(ws), []);
  assert.ok(statSync(join(ws, 'notes.json')).isDirectory(), 'only the exact <name>/<name> shape is the bug');
  assert.equal(readFileSync(join(ws, 'notes.json', 'something-else.txt'), 'utf8'), 'keep me');
});

test('extra files in the wrapper are kept, not cleaned up silently', () => {
  const ws = fresh();
  nest(ws, 'sn_groups.json', '[]');
  writeFileSync(join(ws, 'sn_groups.json', 'stray.txt'), 'do not delete me');

  assert.deepEqual(healNestedArtifacts(ws), ['sn_groups.json']);
  assert.ok(statSync(join(ws, 'sn_groups.json')).isFile()); // payload lifted

  // The stray survives in an aside directory rather than being removed with the wrapper.
  const aside = readdirSync(ws).find(n => n.startsWith('.sn_groups.json.nested-'));
  assert.ok(aside, 'wrapper with leftovers must be kept aside');
  assert.equal(readFileSync(join(ws, aside, 'stray.txt'), 'utf8'), 'do not delete me');
});

test('running twice is a no-op the second time', () => {
  const ws = fresh();
  nest(ws, 'sn_groups.json', '[]');

  assert.equal(healNestedArtifacts(ws).length, 1);
  assert.deepEqual(healNestedArtifacts(ws), []);
});

test('a missing workspace dir is not an error', () => {
  assert.deepEqual(healNestedArtifacts(join(tmpdir(), 'definitely-not-here-' + Date.now())), []);
});
