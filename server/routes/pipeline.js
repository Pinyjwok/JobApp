import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { extractText } from 'unpdf';

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
  let lastAgentOutput = '';
  let lastAgentReasoning = '';
  let lastAgentDebug = '';

  function scheduleStreamDone() {
    clearTimeout(streamDoneTimer);
    streamDoneTimer = setTimeout(() => {
      lastAgentOutput = '';
      lastAgentReasoning = '';
      lastAgentDebug = '';
      broadcast({ type: 'stream_done' });
    }, 5000);
  }

  // AgentOutput is wired to each agent's `stream` port — fires per token chunk.
  recipe.globalVariables.onChange('AgentOutput', (variable) => {
    const fullText = typeof variable.lastValue === 'string'
      ? variable.lastValue
      : JSON.stringify(variable.lastValue);
    const chunk = fullText.slice(lastAgentOutput.length);
    lastAgentOutput = fullText;
    if (!chunk) return;
    process.stdout.write(`[stream] ${chunk.slice(0, 60).replace(/\n/g, '↵')}${chunk.length > 60 ? '…' : ''}\n`);
    broadcast({ type: 'stream_token', chunk });
    scheduleStreamDone();
  });

  // AgentReasoning — wired to each agent's `reasoning` port.
  recipe.globalVariables.onChange('AgentReasoning', (variable) => {
    const fullText = typeof variable.lastValue === 'string'
      ? variable.lastValue
      : JSON.stringify(variable.lastValue);
    const chunk = fullText.slice(lastAgentReasoning.length);
    lastAgentReasoning = fullText;
    if (!chunk) return;
    broadcast({ type: 'reasoning_token', chunk });
  });

  // AgentDebug — wired to each agent's `debug` port.
  recipe.globalVariables.onChange('AgentDebug', (variable) => {
    const fullText = typeof variable.lastValue === 'string'
      ? variable.lastValue
      : JSON.stringify(variable.lastValue);
    const chunk = fullText.slice(lastAgentDebug.length);
    lastAgentDebug = fullText;
    if (!chunk) return;
    broadcast({ type: 'debug_token', chunk });
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

const express = (await import('express')).default;
const router = express.Router();
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

// POST /api/upload — save uploaded txt or pdf files to workspace as cv_raw.txt / jd_raw.txt
router.post('/upload', express.raw({ type: '*/*', limit: '10mb' }), async (req, res) => {
  const originalName = req.query.filename ?? '';
  const target = req.query.target;
  const isPdf = originalName.toLowerCase().endsWith('.pdf');

  if (!target || !/^(cv_raw|jd_raw|cover_letter_sample)$/.test(target)) {
    return res.status(400).json({ error: 'target must be cv_raw, jd_raw, or cover_letter_sample' });
  }

  try {
    let text;
    if (isPdf) {
      const { text: pages } = await extractText(new Uint8Array(req.body), { mergePages: true });
      text = pages;
      console.log(`[upload] ${originalName} → ${target}.txt (pdf, ${text.length} chars)`);
    } else {
      text = req.body.toString('utf8');
      console.log(`[upload] ${originalName} → ${target}.txt (text, ${text.length} chars)`);
    }
    writeFileSync(join(WORKSPACE_DIR, `${target}.txt`), text, 'utf8');
    res.json({ ok: true, filename: `${target}.txt` });
  } catch (err) {
    console.error('[upload] error:', err);
    res.status(500).json({ error: err.message });
  }
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
    // Clear chat history
    try { rmSync(HISTORY_FILE); } catch {}
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

// GET /api/workspace — read a workspace file (dev/testing)
const WORKSPACE_ALLOWED = [
  'project_memory.json', 'cv_assembly_state.json',
  'candidate_profile.json', 'style_guide.json', 'agent_reasoning.json',
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

// POST /api/dev/status — manually override project_memory.json status (dev/testing)
router.post('/dev/status', express.json(), (req, res) => {
  const { status } = req.body;
  if (!status || typeof status !== 'string') {
    return res.status(400).json({ error: 'status required' });
  }
  try {
    const mem = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'project_memory.json'), 'utf8'));
    mem.metadata = mem.metadata ?? {};
    mem.metadata.status = status;
    writeFileSync(join(WORKSPACE_DIR, 'project_memory.json'), JSON.stringify(mem, null, 2));
    console.log(`[dev] status overridden → ${status}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inject — inject a message directly as agent output (dev/testing)
router.post('/inject', express.json(), (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message required' });
  }
  broadcast({ type: 'stream_token', chunk: message });
  broadcast({ type: 'stream_done' });
  res.json({ ok: true });
});

const HISTORY_FILE = join(PROJECT_DIR, 'chat_history.json');

// GET /api/history — load persisted chat messages
router.get('/history', (req, res) => {
  try {
    const data = readFileSync(HISTORY_FILE, 'utf8');
    res.json(JSON.parse(data));
  } catch {
    res.json([]);
  }
});

// POST /api/history — save full messages array
router.post('/history', express.json({ limit: '10mb' }), (req, res) => {
  try {
    const messages = req.body;
    if (!Array.isArray(messages)) return res.status(400).json({ error: 'array expected' });
    writeFileSync(HISTORY_FILE, JSON.stringify(messages, null, 2));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
