import express from 'express';
import { state } from '../lib/state.js';
import { broadcast } from '../lib/broadcast.js';

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
