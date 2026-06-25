import express from 'express';
import { readFileSync, writeFileSync, rmSync, readdirSync, mkdirSync, cpSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import {
  WORKSPACE_DIR, PROJECT_DIR, SNAPSHOTS_DIR, HISTORY_FILE,
  WORKSPACE_SCAFFOLD, HAPPY_PATH,
} from '../config/constants.js';
import { state } from '../lib/state.js';
import { broadcast, broadcastMode, substituteDate } from '../lib/broadcast.js';
import { handlePipelineStatus } from '../lib/pipeline-state.js';
import { assemblyResumeAgent, toIcClientClaim } from '../lib/dispatch.js';

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

// GET /api/pending-interview — re-derives any interview the pipeline is currently blocked on,
// so a page reload can reopen the right modal (the gap_/style_interview_start SSE events only fire
// once and won't replay on reconnect). Payloads mirror the broadcasts in dispatch.js exactly.
router.get('/pending-interview', (_req, res) => {
  if (state.pipelineStatus === 'GAP_INTERVIEW') {
    // Round 2 (re-ask): the pending cards + accepted ack strip live on state, not on disk —
    // reconstruct from there so a reload mid-loop reopens the right (smaller) interview.
    if (state.gapRound >= 2) {
      return res.json({ type: 'gap', round: state.gapRound, accepted: state.gapAccepted ?? [], gaps: state.gapPending ?? [] });
    }
    let gaps = [];
    try {
      const gapData = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'gap_analysis.json'), 'utf8'));
      gaps = (gapData.gaps ?? []).filter(g => g.severity === 'High');
    } catch {}
    return res.json({ type: 'gap', round: 1, accepted: [], gaps });
  }
  if (state.icReview?.claims?.length) {
    return res.json({ type: 'integrity', claims: state.icReview.claims.map(toIcClientClaim) });
  }
  if (state.awaitingRevision) {
    return res.json({ type: 'revise', agent: state.awaitingRevision.agent });
  }
  if (state.awaitingSectionReview) {
    return res.json({ type: 'section_review', ...state.awaitingSectionReview });
  }
  if (state.snState === 'modal') {
    let groups = [];
    try {
      groups = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'sn_working.json'), 'utf8'))?.groups ?? [];
    } catch {}
    return res.json({
      type: 'style',
      groups: groups.map(g => ({
        id: g.id, title: g.title, finding: g.finding,
        examples: g.examples ?? [], recommendation: g.recommendation, insight: g.insight ?? '',
      })),
    });
  }
  res.json({ type: null });
});

// GET /api/workspace
const WORKSPACE_ALLOWED = [
  'project_meta.json', 'candidate_profile.json',
  'research_output.json', 'enhanced_jd.json', 'gap_analysis.json',
  'review_audit.json', 'tailored_cv.json',
  'style_findings.json', 'tone_validator_verdict.json', 'assembly_validator_verdict.json',
  'cv_assembly_state.json', 'sn_groups.json', 'sn_output.json', 'sn_working.json',
  'pb_output.json', 'sc_output.json', 'hf_output.json', 'cf_output.json', 'clw_output.json', 'df_output.json',
];

router.get('/workspace', (req, res) => {
  const file = req.query.file;
  if (!WORKSPACE_ALLOWED.includes(file)) {
    return res.status(400).json({ error: 'not allowed' });
  }
  try {
    res.json(JSON.parse(substituteDate(readFileSync(join(WORKSPACE_DIR, file), 'utf8'))));
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
        if (!PRESERVE.has(f)) rmSync(join(WORKSPACE_DIR, f), { recursive: true, force: true });
      }
    } catch {}

    for (const [filename, data] of Object.entries(WORKSPACE_SCAFFOLD)) {
      writeFileSync(join(WORKSPACE_DIR, filename), JSON.stringify(data, null, 2), 'utf8');
    }

    try { rmSync(HISTORY_FILE); } catch {}

    state.analystDone          = false;
    state.taDone               = false;
    state.pipelineStatus       = null;
    state.analystOutputText    = null;
    state.reviewerGapState     = null;
    state.researchPartial      = false;
    state.awaitingJDReview     = false;
    state.pendingTADispatch    = false;
    state.currentAssemblyPhase = 0;
    state.snState              = null;
    state.awaitingRevision     = null;
    state.retryThunk           = null;
    state.lastDispatch         = null;
    state.recentlyDispatched.clear();

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
    res.json(JSON.parse(substituteDate(readFileSync(HISTORY_FILE, 'utf8'))));
  } catch {
    res.json([]);
  }
});

// GET /api/session-meta
// Lightweight summary for the StartModal "Continue where you left off" card: the position/company
// being tailored for, when the session was last touched (mtime of chat_history.json → "edited 2h
// ago"), which source files are present, and how far assembly drafting has progressed.
router.get('/session-meta', (_req, res) => {
  const meta = { hasHistory: false, editedAt: null, position_title: '', company_name: '',
                 files: { cv: false, jd: false, cover_letter: false },
                 sectionsDrafted: 0, sectionsTotal: 0 };

  // hasHistory + editedAt from the chat history file
  try {
    const hist = JSON.parse(readFileSync(HISTORY_FILE, 'utf8'));
    if (Array.isArray(hist) && hist.length > 0) {
      meta.hasHistory = true;
      meta.editedAt = statSync(HISTORY_FILE).mtime.toISOString();
    }
  } catch {}

  // position/company from project_meta.json
  try {
    const pm = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'project_meta.json'), 'utf8'));
    meta.position_title = pm.position_title || '';
    meta.company_name   = pm.company_name || '';
  } catch {}

  // which source files exist
  meta.files.cv           = existsSync(join(WORKSPACE_DIR, 'cv_raw.txt'));
  meta.files.jd           = existsSync(join(WORKSPACE_DIR, 'jd_raw.txt'));
  meta.files.cover_letter = existsSync(join(WORKSPACE_DIR, 'cover_letter_sample.txt'));

  // assembly drafting progress — phases 1-6 are the content sections (7-9 are review/format gates)
  try {
    const as = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'cv_assembly_state.json'), 'utf8'));
    const sections = (as.phases || []).filter(p => p.phase_number >= 1 && p.phase_number <= 6);
    meta.sectionsTotal   = sections.length;
    meta.sectionsDrafted = sections.filter(p => /^(COMPLETE|COMPLETED|APPROVED|DONE)$/i.test(p.status || '')).length;
  } catch {}

  res.json(meta);
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
    // Chat history lives outside WORKSPACE_DIR (PROJECT_DIR/chat_history.json), so the loop above
    // misses it. Copy it in under an underscore name (excluded from the workspace on restore) so a
    // snapshot also captures the conversation — useful for reproducing a run in testing.
    let chatMessages = 0;
    try {
      if (existsSync(HISTORY_FILE)) {
        cpSync(HISTORY_FILE, join(dest, '_chat_history.json'));
        try { chatMessages = JSON.parse(readFileSync(HISTORY_FILE, 'utf8')).length; } catch {}
      }
    } catch {}
    const status = state.pipelineStatus;
    writeFileSync(join(dest, '_snapshot.json'), JSON.stringify({
      savedAt: new Date().toISOString(),
      status,
      files,
      chatMessages,
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
    const files = readdirSync(src).filter(f => f !== '_snapshot.json' && f !== '_chat_history.json');
    for (const f of files) {
      try { cpSync(join(src, f), join(WORKSPACE_DIR, f)); } catch {}
    }
    // Restore the captured chat history (or start empty if the snapshot has none, so a stale
    // conversation doesn't bleed through). The client reloads it via the history_reload event below.
    let restoredHistory = [];
    try {
      const histSrc = join(src, '_chat_history.json');
      if (existsSync(histSrc)) restoredHistory = JSON.parse(readFileSync(histSrc, 'utf8'));
    } catch {}
    if (!Array.isArray(restoredHistory)) restoredHistory = [];
    let status = null;
    try {
      const snapMeta = JSON.parse(readFileSync(join(src, '_snapshot.json'), 'utf8'));
      status = snapMeta?.status ?? null;
    } catch {}

    // The captured status is `state.pipelineStatus`, which is IN-MEMORY — a dev server restart between
    // reaching a phase and taking the snapshot wipes it to null (e.g. the SJ_SC snapshot: null status,
    // current_phase 6). A null/stale gate status (e.g. GAP_INTERVIEW) isn't in any resume branch, so the
    // restore would route to Main Orchestrator → ProjectSetup instead of the assembly phase. The real
    // assembly progress lives on disk in cv_assembly_state.json (now restored into the workspace) — trust
    // it: if it shows assembly genuinely in progress, resume there regardless of the captured status.
    const ASSEMBLY_RESUME = new Set(['REVIEW_COMPLETE', 'TONE_ANALYZED', 'STYLE_NEGOTIATING', 'SN_START', 'CV_BUILDING']);
    if (!ASSEMBLY_RESUME.has(status)) {
      try {
        const cv = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'cv_assembly_state.json'), 'utf8'));
        const phases = cv?.phases ?? [];
        const anyComplete = phases.some(p => p?.status === 'COMPLETE');
        const inProgress = cv?.metadata?.status === 'ACTIVE' && ((cv?.current_phase ?? 1) > 1 || anyComplete);
        if (inProgress) {
          console.log(`[restore] captured status "${status}" but cv_assembly_state shows assembly in progress (current_phase ${cv.current_phase}) — resuming assembly`);
          status = 'CV_BUILDING';
        }
      } catch {}
    }

    state.analystDone          = false;
    state.taDone               = false;
    state.analystOutputText    = null;
    state.reviewerGapState     = null;
    state.snState              = null;
    state.currentAssemblyPhase = 0;
    state.awaitingRevision     = null;
    state.awaitingJDReview     = false;
    state.retryThunk           = null;
    state.lastDispatch         = null;
    state.pipelineStatus       = status;

    if (status) {
      try { await state.recipe.globalVariables.setValue('pipeline_status', status); } catch {}
    }
    // Assembly-entry statuses aren't in HAPPY_PATH (the server resumes them via handlePipelineStatus
    // below → resumeAssembly, which lands at the phase actually reached, bypassing the deleted Assembly
    // Coordinator). Derive the real resume agent from cv_assembly_state.json so the "next agent" notice
    // matches where the user actually lands — not a hardcoded Style Negotiator.
    const nextAgent = ASSEMBLY_RESUME.has(status)
      ? assemblyResumeAgent()
      : (HAPPY_PATH[status] ?? 'Main Orchestrator');
    try { await state.recipe.globalVariables.setValue('AgentSelector', nextAgent); } catch {}
    state.fallbackAgent = nextAgent;
    // Land the restore notice inside the persisted history so the reload below renders it too — the
    // client overwrites its messages from /api/history, so a separate broadcast would be clobbered.
    restoredHistory.push({
      role: 'agent',
      agent: 'System',
      text: `Snapshot **${name}** restored. Status: \`${status}\` → next agent: **${nextAgent}**`,
    });
    try { writeFileSync(HISTORY_FILE, JSON.stringify(restoredHistory, null, 2)); } catch {}
    broadcast({ type: 'agent_switch',   agent: nextAgent });
    broadcast({ type: 'status_changed', status });
    broadcast({ type: 'history_reload' });
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
