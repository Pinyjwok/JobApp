import express from 'express';
import { readFileSync, writeFileSync, rmSync, readdirSync, mkdirSync, cpSync, existsSync } from 'fs';
import { join } from 'path';
import {
  WORKSPACE_DIR, PROJECT_DIR, SNAPSHOTS_DIR, HISTORY_FILE,
  WORKSPACE_SCAFFOLD, HAPPY_PATH,
} from '../config/constants.js';
import { state } from '../lib/state.js';
import { broadcast, broadcastMode } from '../lib/broadcast.js';
import { handlePipelineStatus } from '../lib/pipeline-state.js';

const router = express.Router();
export default router;

// GET /api/status
router.get('/status', (_req, res) => {
  let currentPhase = null;
  try {
    const cvState = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'cv_assembly_state.json'), 'utf8'));
    currentPhase = cvState?.current_phase ?? null;
  } catch {}
  res.json({ status: state.pipelineStatus, phase: currentPhase });
});

// GET /api/workspace
const WORKSPACE_ALLOWED = [
  'project_meta.json', 'cv_assembly_state.json',
  'candidate_profile.json', 'style_guide.json', 'style_findings.json',
  'research_output.json', 'enhanced_jd.json', 'gap_analysis.json',
  'review_audit.json', 'tailored_cv.json',
  'pb_output.json', 'sc_output.json', 'hf_output.json', 'cf_output.json', 'clw_output.json',
];

router.get('/workspace', (req, res) => {
  const file = req.query.file;
  if (!WORKSPACE_ALLOWED.includes(file)) {
    return res.status(400).json({ error: 'not allowed' });
  }
  try {
    res.json(JSON.parse(readFileSync(join(WORKSPACE_DIR, file), 'utf8')));
  } catch {
    res.json(null);
  }
});

// POST /api/reset — clear workspace and reset pipeline vars
const ALL_PIPELINE_VARS = ['pipeline_status', 'research_confirmed', 'fit_score'];

router.post('/reset', async (req, res) => {
  if (!state.recipe) return res.status(503).json({ error: 'Recipe not ready' });
  try {
    // ?full=1 clears everything (New button); otherwise preserve uploaded source files (BUG-145)
    const fullClear = req.query.full === '1';
    const PRESERVE  = fullClear ? new Set() : new Set(['cv_raw.txt', 'jd_raw.txt', 'cover_letter_sample.txt']);
    try {
      const files = readdirSync(WORKSPACE_DIR);
      for (const f of files) {
        if (!PRESERVE.has(f)) rmSync(join(WORKSPACE_DIR, f), { force: true });
      }
    } catch {}

    for (const [filename, data] of Object.entries(WORKSPACE_SCAFFOLD)) {
      writeFileSync(join(WORKSPACE_DIR, filename), JSON.stringify(data, null, 2), 'utf8');
    }

    try { rmSync(HISTORY_FILE); } catch {}

    state.analystDone    = false;
    state.taDone         = false;
    state.pipelineStatus = null;

    for (const v of ALL_PIPELINE_VARS) {
      try { await state.recipe.globalVariables.setValue(v, null); } catch {}
    }

    await state.recipe.globalVariables.setValue('AgentSelector', 'ProjectSetup');
    state.fallbackAgent = 'ProjectSetup';
    console.log('[reset] workspace cleared, pipeline vars reset, AgentSelector → ProjectSetup');
    broadcast({ type: 'agent_switch', agent: 'ProjectSetup' });
    broadcastMode('user_turn', 'ProjectSetup');
    res.json({ ok: true });
  } catch (err) {
    console.error('reset error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/abort
router.post('/abort', async (_req, res) => {
  if (!state.recipe) return res.status(503).json({ error: 'Recipe not ready' });
  try {
    broadcastMode('user_turn', 'Main Orchestrator');
    await state.recipe.globalVariables.setValue('Settings.Abort_All_Processing', true);
    await state.recipe.globalVariables.setValue('AgentSelector', 'Main Orchestrator');
    await state.recipe.sendToInputWidget(' Message', {
      type: state.DataType.JsonObj,
      value: { query: '__stall__', sessionId: 'default' },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/history
router.get('/history', (_req, res) => {
  try {
    res.json(JSON.parse(readFileSync(HISTORY_FILE, 'utf8')));
  } catch {
    res.json([]);
  }
});

// POST /api/history
router.post('/history', (req, res) => {
  try {
    const messages = req.body;
    if (!Array.isArray(messages)) return res.status(400).json({ error: 'array expected' });
    writeFileSync(HISTORY_FILE, JSON.stringify(messages, null, 2));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/snapshots
router.get('/snapshots', (_req, res) => {
  try {
    if (!existsSync(SNAPSHOTS_DIR)) return res.json([]);
    const entries = readdirSync(SNAPSHOTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => {
        let meta = {};
        try { meta = JSON.parse(readFileSync(join(SNAPSHOTS_DIR, d.name, '_snapshot.json'), 'utf8')); } catch {}
        return { name: d.name, ...meta };
      })
      .sort((a, b) => (b.savedAt ?? '').localeCompare(a.savedAt ?? ''));
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/snapshot
router.post('/snapshot', (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string' || !/^[\w\-]+$/.test(name)) {
    return res.status(400).json({ error: 'name required (alphanumeric/dash/underscore only)' });
  }
  try {
    const dest  = join(SNAPSHOTS_DIR, name);
    mkdirSync(dest, { recursive: true });
    const files = readdirSync(WORKSPACE_DIR);
    for (const f of files) {
      try { cpSync(join(WORKSPACE_DIR, f), join(dest, f)); } catch {}
    }
    const status = state.pipelineStatus;
    writeFileSync(join(dest, '_snapshot.json'), JSON.stringify({
      savedAt: new Date().toISOString(),
      status,
      files,
    }, null, 2));
    console.log(`[snapshot] saved → ${name} (status: ${status}, ${files.length} files)`);
    res.json({ ok: true, name, status, files: files.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/restore
router.post('/restore', async (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' });
  const src = join(SNAPSHOTS_DIR, name);
  if (!existsSync(src)) return res.status(404).json({ error: `snapshot "${name}" not found` });
  if (!state.recipe)    return res.status(503).json({ error: 'Recipe not ready' });

  try {
    const existing = readdirSync(WORKSPACE_DIR);
    for (const f of existing) {
      try { rmSync(join(WORKSPACE_DIR, f), { force: true, recursive: true }); } catch {}
    }
    const files = readdirSync(src).filter(f => f !== '_snapshot.json');
    for (const f of files) {
      try { cpSync(join(src, f), join(WORKSPACE_DIR, f)); } catch {}
    }
    let status = null;
    try {
      const snapMeta = JSON.parse(readFileSync(join(src, '_snapshot.json'), 'utf8'));
      status = snapMeta?.status ?? null;
    } catch {}

    state.analystDone          = false;
    state.taDone               = false;
    state.analystOutputText    = null;
    state.reviewerGapState     = null;
    state.snState              = null;
    state.currentAssemblyPhase = 0;
    state.awaitingRevision     = null;
    state.pipelineStatus       = status;

    if (status) {
      try { await state.recipe.globalVariables.setValue('pipeline_status', status); } catch {}
    }
    const nextAgent = HAPPY_PATH[status] ?? 'Main Orchestrator';
    try { await state.recipe.globalVariables.setValue('AgentSelector', nextAgent); } catch {}
    state.fallbackAgent = nextAgent;
    broadcast({ type: 'agent_switch',   agent: nextAgent });
    broadcast({ type: 'status_changed', status });
    broadcast({ type: 'agent_message',  agent: 'System', text: `Snapshot **${name}** restored. Status: \`${status}\` → next agent: **${nextAgent}**` });
    console.log(`[restore] ${name} → workspace (status: ${status}, next: ${nextAgent})`);
    res.json({ ok: true, name, status, nextAgent });
    // Resume pipeline logic for auto-start statuses (e.g. CV_BUILDING → SN interview)
    await handlePipelineStatus(status, { resume: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/snapshot/:name
router.delete('/snapshot/:name', (req, res) => {
  const { name } = req.params;
  if (!/^[\w\-]+$/.test(name)) return res.status(400).json({ error: 'invalid name' });
  const dest = join(SNAPSHOTS_DIR, name);
  if (!existsSync(dest)) return res.status(404).json({ error: 'not found' });
  try {
    rmSync(dest, { recursive: true, force: true });
    console.log(`[snapshot] deleted: ${name}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
