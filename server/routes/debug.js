import express from 'express';
import { state } from '../lib/state.js';
import { broadcast } from '../lib/broadcast.js';
import { dispatchAssemblyPhase } from '../lib/dispatch.js';

const router = express.Router();
export default router;

const DEBUG_VARS = ['pipeline_status', 'AgentSelector', 'research_confirmed', 'fit_score'];

// GET /api/debug/vars
router.get('/debug/vars', async (_req, res) => {
  if (!state.recipe) return res.status(503).json({ error: 'Recipe not ready' });
  const out = { _server: { analystDone: state.analystDone, taDone: state.taDone, pipelineStatus: state.pipelineStatus } };
  for (const v of DEBUG_VARS) {
    try {
      const val = await state.recipe.globalVariables.getValue(v);
      out[v] = val ?? null;
    } catch {
      out[v] = '(error)';
    }
  }
  console.log('[debug/vars]', JSON.stringify(out, null, 2));
  res.json(out);
});

// POST /api/dev/status
router.post('/dev/status', async (req, res) => {
  const { status } = req.body;
  if (!status || typeof status !== 'string') {
    return res.status(400).json({ error: 'status required' });
  }
  try {
    if (state.recipe) await state.recipe.globalVariables.setValue('pipeline_status', status);
    state.pipelineStatus = status;
    console.log(`[dev] status overridden → ${status}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dev/phase — jump straight to an assembly phase and (re-)fire it. Dev-only testing aid:
// pipeline_status is coarse (all assembly phases share CV_BUILDING) and resume reads cv_assembly_state,
// so this forces a specific phase to run regardless of recorded progress. Requires the workspace to
// already hold the assembly inputs (candidate_profile.json, cv_assembly_state.json, style_guide.json,
// prior phase outputs) — restore a snapshot first, then jump. Phase 1 = SN interview, 2–6 = sections,
// 7 = Style Reviewer gate, 8 = Integrity Checker gate.
router.post('/dev/phase', async (req, res) => {
  const n = Number(req.body?.phase);
  if (!Number.isInteger(n) || n < 1 || n > 9) {
    return res.status(400).json({ error: 'phase required (integer 1–9)' });
  }
  if (!state.recipe) return res.status(503).json({ error: 'Recipe not ready' });
  try {
    state.pipelineStatus = 'CV_BUILDING';
    await state.recipe.globalVariables.setValue('pipeline_status', 'CV_BUILDING');
    // dispatchAssemblyPhase sets state.currentAssemblyPhase = n itself; clearing stale review/SN state
    // first so the jump starts clean.
    state.snState = null;
    state.awaitingRevision = null;
    state.awaitingSectionReview = null;
    console.log(`[dev] jump to assembly phase ${n}`);
    res.json({ ok: true, phase: n });
    await dispatchAssemblyPhase(n);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inject
router.post('/inject', (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message required' });
  }
  broadcast({ type: 'agent_message', agent: 'System', text: message });
  broadcast({ type: 'stream_done' });
  res.json({ ok: true });
});
