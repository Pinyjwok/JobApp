// Regression test for server/lib/logger.js.
//
// Guards the 2026-08-09 rewrite (sync appendFileSync → async append stream):
//   - the file copy must stay byte-identical to what the terminal shows, which is why serialize() is
//     util.format now — the old hand-rolled version emitted an empty string for undefined, dropped
//     functions and symbols, and ignored %s/%d placeholders;
//   - an unusable LOG_DIR must not abort server startup (logger.js is the FIRST import in index.js,
//     so a throw there takes the whole server with it);
//   - lines logged immediately before the process dies must still reach the file — post-crash
//     forensics is the entire reason this file exists, and async writes are what put that at risk.
//
// Each case runs in a child process: logger.js patches the global console and opens a stream on
// import, so it can't be imported into the test runner itself. LOG_DIR is `../../logs` relative to the
// module, so the child gets a copy of logger.js inside a throwaway tree to control where it writes.
//
// Run: node --test server/test/logger.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOGGER_SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'logger.js');

// A throwaway tree shaped like the repo (<root>/server/lib/logger.js → <root>/logs).
function stageLogger({ blockLogDir = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'loggertest-'));
  mkdirSync(join(root, 'server', 'lib'), { recursive: true });
  copyFileSync(LOGGER_SRC, join(root, 'server', 'lib', 'logger.js'));
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  // A FILE where the logs/ DIRECTORY must go — mkdirSync throws EEXIST, the same class of failure as a
  // read-only or full disk.
  if (blockLogDir) writeFileSync(join(root, 'logs'), 'not a directory');
  return root;
}

// Run `body` in a child that has imported the staged logger. Returns its stdout and the log file text.
function runChild(root, body) {
  const entry = join(root, 'run.mjs');
  writeFileSync(entry, `import { LOG_FILE_PATH } from ${JSON.stringify(join(root, 'server', 'lib', 'logger.js'))};\n${body}\n`);
  const stdout = execFileSync(process.execPath, [entry], { encoding: 'utf8' });
  let file = null;
  try {
    const dir = join(root, 'logs');
    const [name] = readdirSync(dir);
    file = name ? readFileSync(join(dir, name), 'utf8') : null;
  } catch { /* logs/ may not exist — that's a valid outcome for the blocked-dir case */ }
  return { stdout, file };
}

// Strip the `[iso-timestamp] [LEVEL] ` prefix so file lines can be compared to terminal lines.
const stripPrefix = text => text
  .split('\n')
  .filter(Boolean)
  .map(l => l.replace(/^\[[^\]]+\] \[[A-Z]+\] /, ''));

test('file copy matches console output, placeholders and all', () => {
  const root = stageLogger();
  const { stdout, file } = runChild(root, `
    console.log('fmt %s and %d', 'str', 42);
    console.log(undefined, NaN, null);
    console.log({ a: 1 }, [1, 2], Symbol('s'), function named() {});
    const circular = {}; circular.self = circular;
    console.log('circular:', circular);
  `);

  // Same values, same rendering — the file is a transcript, not a re-interpretation.
  assert.deepEqual(stripPrefix(file), stdout.split('\n').filter(Boolean));
  assert.match(file, /fmt str and 42/);        // %s/%d substituted, not printed literally
  assert.match(file, /undefined NaN null/);    // the old serializer dropped undefined entirely
  assert.match(file, /Symbol\(s\)/);
  assert.match(file, /\[Function: named\]/);
  assert.match(file, /Circular/);              // must not throw on a cycle
});

test('errors keep their stack', () => {
  const root = stageLogger();
  const { file } = runChild(root, `console.error(new Error('boom'));`);
  assert.match(file, /\[ERROR\] Error: boom/);
  assert.match(file, /\n\s+at /); // stack, not just the message
});

test('an unusable log dir disables file logging instead of killing startup', () => {
  const root = stageLogger({ blockLogDir: true });
  const { stdout, file } = runChild(root, `console.log('server still booting');`);

  assert.match(stdout, /file logging unavailable/);
  assert.match(stdout, /server still booting/); // console behaviour untouched
  assert.equal(file, null);                     // nothing written, no throw
});

test('lines logged just before a hard exit still reach the file', () => {
  const root = stageLogger();
  // process.exit() runs no pending async writes — only the sync `exit` flush can save these.
  const { file } = runChild(root, `
    for (let i = 0; i < 5; i++) console.log('crash-tail line ' + i);
    process.exit(0);
  `);

  for (let i = 0; i < 5; i++) assert.match(file, new RegExp(`crash-tail line ${i}`));
});

test('a high-volume burst neither blocks nor drops (well under the backlog cap)', () => {
  const root = stageLogger();
  // The reasoning stream emits hundreds of lines per turn; this is the shape that used to block the
  // event loop on every single call.
  const { file } = runChild(root, `
    for (let i = 0; i < 2000; i++) console.log('reasoning chunk ' + i);
    await new Promise(r => setTimeout(r, 200));
  `);

  assert.equal(stripPrefix(file).filter(l => l.startsWith('reasoning chunk')).length, 2000);
  assert.doesNotMatch(file, /dropped \d+ line/);
});
