import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { extractText } from 'unpdf';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = join(__dirname, '..', '..');
const WORKSPACE_DIR = join(PROJECT_DIR, 'workspace');

// SSE clients waiting for agent output
const sseClients = new Set();

// Auto-continue: server auto-routes after each stream_done
let autoContinue = false;

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

  // AgentOutput is wired to each agent's `text` port — fires once per turn with complete text.
  // Some agents (e.g. Researcher) set AgentOutput more than once per turn (intermediate + final).
  // Debounce: wait 500ms after the last fire, then broadcast only the final value.
  let agentOutputTimer = null;
  let pendingAgentOutput = null;
  recipe.globalVariables.onChange('AgentOutput', (variable) => {
    const text = typeof variable.lastValue === 'string'
      ? variable.lastValue
      : JSON.stringify(variable.lastValue);
    if (!text) return;
    pendingAgentOutput = text;
    if (agentOutputTimer) clearTimeout(agentOutputTimer);
    agentOutputTimer = setTimeout(() => {
      agentOutputTimer = null;
      const finalText = pendingAgentOutput;
      pendingAgentOutput = null;
      console.log(`[agent output] ${finalText.slice(0, 80).replace(/\n/g, '↵')}${finalText.length > 80 ? '…' : ''}`);
      broadcast({ type: 'agent_message', text: finalText });
      broadcast({ type: 'stream_done' });
      if (autoContinue) routeFromStatus();
    }, 500);
  });

  // AgentReasoning — wired to each agent's `reasoning` port — fires once per turn.
  recipe.globalVariables.onChange('AgentReasoning', (variable) => {
    const text = typeof variable.lastValue === 'string'
      ? variable.lastValue
      : JSON.stringify(variable.lastValue);
    if (!text) return;
    broadcast({ type: 'reasoning', text });
  });

  // AgentDebug — wired to each agent's `debug` port — fires once per turn.
  recipe.globalVariables.onChange('AgentDebug', (variable) => {
    const text = typeof variable.lastValue === 'string'
      ? variable.lastValue
      : JSON.stringify(variable.lastValue);
    if (!text) return;
    broadcast({ type: 'debug_token', chunk: text });
  });

  // AgentSelector changes when SwitchAgent fires.
  recipe.globalVariables.onChange('AgentSelector', (variable) => {
    const agent = variable.lastValue;
    console.log(`[agent] → ${agent}`);
    broadcast({ type: 'agent_switch', agent });
    if (agent === 'Main Orchestrator' && autoContinue) {
      autoContinue = false;
      broadcast({ type: 'auto_continue_paused' });
    }
  });

  // Init trigger is now client-driven (StartModal) — no server-side auto-trigger.
}

// ── Server-side pipeline routing ──────────────────────────────────────────────

const HAPPY_PATH = {
  'FILES_SAVED':        'Extractor',
  'INITIALIZED':        'Researcher',
  'RESEARCH_COMPLETE':  'JD Enhancer',
  'RESEARCH_PARTIAL':   'Main Orchestrator',  // surfaces to user
  'JD_ENHANCED':        'Analyst',
  'ANALYSIS_COMPLETE':  'Reviewer',
  'REVIEW_COMPLETE':    'Tone Analyst',
  'TONE_ANALYZED':      'Assembly Coordinator',
  'CV_BUILDING':        'Assembly Coordinator',
};

const EXCEPTION_STATUSES = new Set([
  'REVIEW_FAILED', 'RESEARCH_FAILED', 'ANALYSIS_FAILED',
  'EXTRACTION_FAILED', 'CV_TAILORED',
]);

// Called after stream_done when auto-continue is on.
// Reads project_memory.json, sets AgentSelector, sends continuation message.
async function routeFromStatus() {
  if (!recipe) return;
  let status;
  try {
    const mem = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'project_memory.json'), 'utf8'));
    status = mem?.metadata?.status;
  } catch {
    return; // no project_memory yet (e.g. before first upload)
  }

  if (!status) return;

  // Special case: ANALYSIS_COMPLETE with review_audit present = Reviewer gap interview loop.
  // Pause auto-continue so the user can type their gap answer manually.
  if (status === 'ANALYSIS_COMPLETE') {
    try {
      const mem2 = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'project_memory.json'), 'utf8'));
      if (mem2.review_audit) {
        // Gap interview in progress — set AgentSelector to Reviewer but don't auto-send
        await recipe.globalVariables.setValue('AgentSelector', 'Reviewer');
        if (autoContinue) {
          autoContinue = false;
          broadcast({ type: 'auto_continue_paused' });
          console.log('[route] Gap interview active — auto-continue paused');
        }
        return;
      }
    } catch {}
  }

  let nextAgent;
  if (EXCEPTION_STATUSES.has(status)) {
    nextAgent = 'Main Orchestrator';
  } else if (HAPPY_PATH[status]) {
    nextAgent = HAPPY_PATH[status];
  } else {
    // Unknown or mid-assembly status — let AC handle internally
    return;
  }

  console.log(`[route] ${status} → ${nextAgent}`);
  try {
    await recipe.globalVariables.setValue('AgentSelector', nextAgent);
    await recipe.sendToInputWidget(' Message', {
      type: DataType.JsonObj,
      value: { query: '__auto__', sessionId: 'default' },
    });
  } catch (err) {
    console.error('[route] error:', err.message);
  }
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

  // Detect user rerun/redo/retry intent — server handles status reset + routing
  // directly, keeping MO out of it (Flash 3 loops on read-modify-write instructions).
  const RERUN_RE = /\b(rerun|re-run|redo|re-do|retry|re-try)\b/i;
  const RERUN_MAP = [
    { pattern: /extractor/i,             resetStatus: 'FILES_SAVED',       agent: 'Extractor' },
    { pattern: /researcher|research/i,   resetStatus: 'INITIALIZED',       agent: 'Researcher' },
    { pattern: /jd.?enhancer|jd/i,       resetStatus: 'RESEARCH_COMPLETE', agent: 'JD Enhancer' },
    { pattern: /analyst/i,               resetStatus: 'JD_ENHANCED',       agent: 'Analyst' },
    { pattern: /reviewer|review/i,       resetStatus: 'ANALYSIS_COMPLETE', agent: 'Reviewer' },
    { pattern: /tone.?analyst|tone/i,    resetStatus: 'REVIEW_COMPLETE',   agent: 'Tone Analyst' },
  ];

  // Route to the correct agent based on current status before forwarding.
  // This keeps MO out of the happy path entirely — the server owns routing.
  const userWantsRerun = RERUN_RE.test(message);
  try {
    const mem = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'project_memory.json'), 'utf8'));
    const status = mem?.metadata?.status;
    let nextAgent = null;

    if (userWantsRerun) {
      const match = RERUN_MAP.find(r => r.pattern.test(message));
      if (match) {
        // Reset status so target agent sees the correct pre-state
        mem.metadata = mem.metadata ?? {};
        mem.metadata.status = match.resetStatus;
        writeFileSync(join(WORKSPACE_DIR, 'project_memory.json'), JSON.stringify(mem, null, 2));
        nextAgent = match.agent;
        console.log(`[route] rerun "${match.agent}" — status reset to ${match.resetStatus}`);
        // Broadcast confirmation to chat so user sees feedback immediately
        broadcast({ type: 'agent_message', text: `Re-running **${match.agent}**…` });
      } else {
        // Could not identify target — route to MO for clarification
        nextAgent = 'Main Orchestrator';
        console.log(`[route] rerun intent but no agent match — routing to MO`);
      }
    } else if (status && HAPPY_PATH[status]) {
      nextAgent = HAPPY_PATH[status];
    } else if (status && EXCEPTION_STATUSES.has(status)) {
      nextAgent = 'Main Orchestrator';
    }

    if (nextAgent) {
      await recipe.globalVariables.setValue('AgentSelector', nextAgent);
      if (!userWantsRerun) console.log(`[route] ${status} → ${nextAgent} (pre-message)`);
      await new Promise((r) => setTimeout(r, 150));
    }
  } catch { /* no project_memory yet — leave AgentSelector as-is */ }

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
    // Point directly to ProjectSetup — no __init__ needed
    await recipe.globalVariables.setValue('AgentSelector', 'ProjectSetup');
    console.log('[reset] workspace cleared, AgentSelector → ProjectSetup');
    broadcast({ type: 'agent_switch', agent: 'ProjectSetup' });
    res.json({ ok: true });
  } catch (err) {
    console.error('reset error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/abort — stop processing and route to MO for stall recovery
router.post('/abort', async (req, res) => {
  if (!recipe) return res.status(503).json({ error: 'Recipe not ready' });
  try {
    autoContinue = false;
    broadcast({ type: 'auto_continue_changed', enabled: false });
    await recipe.globalVariables.setValue('Settings.Abort_All_Processing', true);
    // Route to MO so it can inform user and offer retry
    await recipe.globalVariables.setValue('AgentSelector', 'Main Orchestrator');
    await recipe.sendToInputWidget(' Message', {
      type: DataType.JsonObj,
      value: { query: '__stall__', sessionId: 'default' },
    });
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

// POST /api/auto-continue — toggle server-side auto-routing on/off
router.post('/auto-continue', express.json(), (req, res) => {
  autoContinue = req.body?.enabled ?? !autoContinue;
  console.log(`[auto-continue] ${autoContinue ? 'ON' : 'OFF'}`);
  broadcast({ type: 'auto_continue_changed', enabled: autoContinue });
  res.json({ enabled: autoContinue });
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
