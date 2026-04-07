import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// SSE clients waiting for agent output
const sseClients = new Set();

let recipe = null;
let DataType = null;

export async function initRecipe(projectDir) {
  const recipePath = join(projectDir, 'JOBAPP');

  // Import edge runtime from the recipe's own node_modules using a file URL
  const runtimePath = join(recipePath, 'node_modules', '@kemu-io', 'edge-runtime', 'runner.js');
  const runtimeUrl = new URL(`file://${runtimePath}`).href;
  const edgeModule = await import(runtimeUrl);

  const kemuEdge = edgeModule.default;
  DataType = edgeModule.DataType;

  // Change working directory so the recipe can find its files
  process.chdir(recipePath);

  recipe = await kemuEdge.start();

  // Note: Settings.Project_Directory cannot be set via SDK (dots not allowed in variable names).
  // The recipe uses the value stored from the last KEMU session.

  // Stream agent output to all connected SSE clients
  recipe.globalVariables.onChange('AgentOutput', (variable) => {
    const payload = JSON.stringify({
      type: 'agent_output',
      value: variable.lastValue,
    });
    for (const client of sseClients) {
      client.write(`data: ${payload}\n\n`);
    }
  });

  // Forward agent selector changes so the UI knows which agent is active
  recipe.globalVariables.onChange('AgentSelector', (variable) => {
    const payload = JSON.stringify({
      type: 'agent_switch',
      agent: variable.lastValue,
    });
    for (const client of sseClients) {
      client.write(`data: ${payload}\n\n`);
    }
  });
}

// ── Routes ────────────────────────────────────────────────────────────────────

const router = (await import('express')).Router();
export default router;

// GET /api/stream — SSE connection for real-time agent output
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send a heartbeat immediately so the client knows the connection is alive
  res.write(': heartbeat\n\n');

  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

// POST /api/message — send a user message to the active agent
router.post('/message', async (req, res) => {
  const { message, sessionId = 'default' } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }

  if (!recipe) {
    return res.status(503).json({ error: 'Recipe not ready' });
  }

  try {
    await recipe.sendToInputWidget(' Message', {
      type: DataType.JsonObj,
      value: { query: message, sessionId },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('sendToInputWidget error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/status — read current pipeline status from project_memory.json
router.get('/status', (req, res) => {
  try {
    const memPath = join(dirname(dirname(__dirname)), 'project_memory.json');
    const memory = JSON.parse(readFileSync(memPath, 'utf8'));
    res.json({
      status: memory?.metadata?.status ?? null,
      phase: memory?.metadata?.current_phase ?? null,
    });
  } catch {
    res.json({ status: null, phase: null });
  }
});

// POST /api/abort — set the abort global variable
router.post('/abort', async (req, res) => {
  if (!recipe) return res.status(503).json({ error: 'Recipe not ready' });
  try {
    await recipe.globalVariables.setValue('Settings.Abort_All_Processing', true);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
