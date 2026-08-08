// Tees all console output to a per-run log file. The dev server only writes to the interactive
// terminal, so anything not captured in the moment is gone — including the per-agent reasoning
// stream (recipe-init.js's `[reasoning:<agent>]` lines) and the raw dispatch banners/errors that
// would confirm intermittent KEMU failures after the fact.
// Import this FIRST in server/index.js so every subsequent module's console.* calls are captured.
//
// Writes are ASYNC (one persistent append stream). The previous appendFileSync blocked the event loop
// on every console.* call — and the reasoning stream alone emits hundreds per turn, in the middle of
// request handling and KEMU callbacks. Three properties are preserved deliberately:
//   1. logging can never take down the app — every failure path downgrades to console-only;
//   2. bounded memory — past MAX_PENDING_BYTES lines are dropped (and counted), never queued unbounded;
//   3. crash-time lines still land — the file exists for post-hoc forensics, so whatever hasn't
//      flushed is written synchronously from the `exit` handler.
import { createWriteStream, appendFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { format } from 'util';

const original = { log: console.log, warn: console.warn, error: console.error, debug: console.debug };

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, '..', '..', 'logs');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
export const LOG_FILE_PATH = join(LOG_DIR, `dev-${stamp}.log`);

const MAX_PENDING_BYTES = 4 * 1024 * 1024;
const unflushed = [];   // handed to the stream, not yet flushed to the fd (the crash-safety tail)
let pendingBytes = 0;
let dropped = 0;

// File logging is best-effort: a read-only or full disk must not abort server startup, so a failed
// mkdir (or stream open) just disables the file copy and leaves console behaviour untouched.
let stream = null;
let disabledReason = null;
try {
  mkdirSync(LOG_DIR, { recursive: true });
  stream = createWriteStream(LOG_FILE_PATH, { flags: 'a' });
  stream.on('error', (err) => disableFileLogging(err.message));
} catch (err) {
  disabledReason = err.message;
}

function disableFileLogging(reason) {
  if (!stream) return;
  const dead = stream;
  stream = null;
  disabledReason = reason;
  unflushed.length = 0;
  pendingBytes = 0;
  try { dead.destroy(); } catch {}
  original.warn(`[logger] file logging disabled: ${reason}`);
}

// console-compatible formatting: util.format is what console.* itself uses, so `%s`/`%d` placeholders
// and values like undefined, NaN, functions, symbols and circular objects render in the file exactly
// as they do on the terminal. (The old hand-rolled JSON.stringify mapping turned `undefined` into an
// empty string, dropped functions/symbols entirely, and ignored placeholders.)
function serialize(args) {
  try { return format(...args); } catch { return args.map(String).join(' '); }
}

function write(line) {
  if (!stream) return;
  if (pendingBytes + Buffer.byteLength(line) > MAX_PENDING_BYTES) { dropped++; return; }
  if (dropped > 0) {
    line = `[${new Date().toISOString()}] [WARN] [logger] dropped ${dropped} line(s) — write backlog exceeded ${MAX_PENDING_BYTES} bytes\n${line}`;
    dropped = 0;
  }
  const bytes = Buffer.byteLength(line);
  pendingBytes += bytes;
  unflushed.push(line);
  // Stream write callbacks fire in write order, so shifting keeps `unflushed` the not-yet-durable tail.
  stream.write(line, () => { unflushed.shift(); pendingBytes -= bytes; });
}

function tee(level, orig) {
  return (...args) => {
    orig(...args);
    try {
      write(`[${new Date().toISOString()}] [${level}] ${serialize(args)}\n`);
    } catch {
      // Logging must never take down the app.
    }
  };
}

// Last-gasp flush: `exit` handlers are synchronous-only, so pending async writes would otherwise be
// lost — exactly the lines that explain a crash. May duplicate a line that flushed during the race;
// a duplicate beats a missing one in a forensic log.
process.on('exit', () => {
  if (!stream || unflushed.length === 0) return;
  try { appendFileSync(LOG_FILE_PATH, unflushed.join('')); } catch {}
});

console.log   = tee('LOG',   original.log);
console.warn  = tee('WARN',  original.warn);
console.error = tee('ERROR', original.error);
console.debug = tee('DEBUG', original.debug);

console.log(stream
  ? `[logger] mirroring console output to ${LOG_FILE_PATH}`
  : `[logger] file logging unavailable (${disabledReason}) — console only`);
