// Tees all console output to a per-run log file. The dev server only writes to the interactive
// terminal, so anything not captured in the moment is gone — including the per-agent reasoning
// stream (recipe-init.js's `[reasoning:<agent>]` lines) and the raw dispatch banners/errors that
// would confirm intermittent KEMU failures after the fact.
// Import this FIRST in server/index.js so every subsequent module's console.* calls are captured.
import { appendFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(__dirname, '..', '..', 'logs');
mkdirSync(LOG_DIR, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
export const LOG_FILE_PATH = join(LOG_DIR, `dev-${stamp}.log`);

function serialize(args) {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return a.stack ?? a.message;
      try { return JSON.stringify(a); } catch { return String(a); }
    })
    .join(' ');
}

function tee(level, original) {
  return (...args) => {
    original(...args);
    try {
      appendFileSync(LOG_FILE_PATH, `[${new Date().toISOString()}] [${level}] ${serialize(args)}\n`);
    } catch {
      // Logging must never take down the app.
    }
  };
}

const original = { log: console.log, warn: console.warn, error: console.error, debug: console.debug };
console.log   = tee('LOG',   original.log);
console.warn  = tee('WARN',  original.warn);
console.error = tee('ERROR', original.error);
console.debug = tee('DEBUG', original.debug);

console.log(`[logger] mirroring console output to ${LOG_FILE_PATH}`);
