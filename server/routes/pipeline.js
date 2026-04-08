import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, rmSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = join(__dirname, '..', '..');
const WORKSPACE_DIR = join(PROJECT_DIR, 'workspace');

// SSE clients waiting for agent output
const sseClients = new Set();

function broadcast(payload) {
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    client.write(line);
  }
}

let recipe = null;
let DataType = null;

export async function initRecipe(projectDir) {
  const recipePath = join(projectDir, 'recipe');

  // Import edge runtime from the recipe's own node_modules using a file URL
  const runtimePath = join(recipePath, 'node_modules', '@kemu-io', 'edge-runtime', 'runner.js');
  const runtimeUrl = new URL(`file://${runtimePath}`).href;
  const edgeModule = await import(runtimeUrl);

  const kemuEdge = edgeModule.default;
  DataType = edgeModule.DataType;

  // Change working directory so the recipe can find its files
  process.chdir(recipePath);

  recipe = await kemuEdge.start();

  // Reset AgentSelector to Main Orchestrator so every fresh server start
  // routes the first message correctly regardless of last KEMU session state.
  try {
    await recipe.globalVariables.setValue('AgentSelector', 'Main Orchestrator');
    console.log('AgentSelector → Main Orchestrator');
  } catch (err) {
    console.warn('Could not reset AgentSelector:', err.message);
  }

  // Debounce timer — fires stream_done if no new tokens arrive for 5s.
  // Covers the last agent in a sequence who never calls SwitchAgent.
  let streamDoneTimer = null;

  function scheduleStreamDone() {
    clearTimeout(streamDoneTimer);
    streamDoneTimer = setTimeout(() => broadcast({ type: 'stream_done' }), 5000);
  }

  // AgentOutput is wired to each agent's `stream` port — fires per token chunk.
  recipe.globalVariables.onChange('AgentOutput', (variable) => {
    const chunk = typeof variable.lastValue === 'string'
      ? variable.lastValue
      : JSON.stringify(variable.lastValue);
    process.stdout.write(`[stream] ${chunk.slice(0, 60).replace(/\n/g, '↵')}${chunk.length > 60 ? '…' : ''}\n`);
    broadcast({ type: 'stream_token', chunk });
    scheduleStreamDone();
  });

  // AgentSelector changes when SwitchAgent fires — definitive end-of-stream signal.
  recipe.globalVariables.onChange('AgentSelector', (variable) => {
    console.log(`[agent] → ${variable.lastValue}`);
    clearTimeout(streamDoneTimer);
    broadcast({ type: 'stream_done' });
    broadcast({ type: 'agent_switch', agent: variable.lastValue });
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
  res.write(': heartbeat\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
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

  console.log(`[user] ${message.slice(0, 80)}`);
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
    const memory = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'project_memory.json'), 'utf8'));
    res.json({
      status: memory?.metadata?.status ?? null,
      phase: memory?.metadata?.current_phase ?? null,
    });
  } catch {
    res.json({ status: null, phase: null });
  }
});

// POST /api/reset — clear workspace and reset agent to Main Orchestrator
router.post('/reset', async (req, res) => {
  if (!recipe) return res.status(503).json({ error: 'Recipe not ready' });
  try {
    // Clear workspace files (JSON + txt)
    const { readdirSync } = await import('fs');
    const files = readdirSync(WORKSPACE_DIR).filter(f => f.endsWith('.json') || f.endsWith('.txt'));
    for (const f of files) {
      rmSync(join(WORKSPACE_DIR, f));
    }
    // Reset routing
    await recipe.globalVariables.setValue('AgentSelector', 'Main Orchestrator');
    console.log('[reset] workspace cleared, AgentSelector → Main Orchestrator');
    broadcast({ type: 'agent_switch', agent: 'Main Orchestrator' });
    res.json({ ok: true });
  } catch (err) {
    console.error('reset error:', err);
    res.status(500).json({ error: err.message });
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
