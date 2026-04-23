import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import pipelineRouter, { initRecipe } from './routes/pipeline.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = join(__dirname, '..');
const WORKSPACE_DIR = join(PROJECT_DIR, 'workspace');
const RECIPE_FILE = join(PROJECT_DIR, 'recipe', 'recipe.kemu');

/**
 * Patch recipe.kemu so Settings.Project_Directory (and related paths) point
 * to this machine's workspace/ folder. Detects the previously stored path
 * automatically — no hardcoding needed.
 */
function patchRecipePaths() {
  let raw = readFileSync(RECIPE_FILE, 'utf8');

  // Detect the old path stored in Settings.Project_Directory
  const idx = raw.indexOf('"Settings.Project_Directory"');
  if (idx === -1) {
    console.warn('Warning: Settings.Project_Directory not found in recipe.kemu');
    return;
  }

  const context = raw.substring(Math.max(0, idx - 600), idx);
  const valueMatch = context.match(/"lastValue":"(\/[^"]+)"/);
  if (!valueMatch) {
    console.warn('Warning: Could not extract current path from recipe.kemu');
    return;
  }

  const oldPath = valueMatch[1].replace(/\/$/, ''); // strip trailing slash
  const newPath = WORKSPACE_DIR;

  if (oldPath === newPath) {
    console.log('Recipe paths already correct.');
    return;
  }

  // Replace all occurrences (with and without trailing slash)
  raw = raw.replaceAll(oldPath + '/', newPath + '/');
  raw = raw.replaceAll(oldPath, newPath);

  writeFileSync(RECIPE_FILE, raw);
  console.log(`Recipe paths updated: ${oldPath} → ${newPath}`);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/api', pipelineRouter);

// Serve built React frontend in production
const CLIENT_DIST = join(__dirname, '..', 'client', 'dist');
if (existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get('*', (_req, res) => res.sendFile(join(CLIENT_DIST, 'index.html')));
}

const PORT = process.env.PORT || 3001;

async function main() {
  // Ensure workspace directory exists
  mkdirSync(WORKSPACE_DIR, { recursive: true });

  // Patch recipe.kemu paths for this machine
  patchRecipePaths();

  console.log('Starting KEMU recipe...');
  await initRecipe(PROJECT_DIR);
  console.log('Recipe running.');

  app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
