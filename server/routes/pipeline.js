import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, rmSync, readdirSync, mkdirSync } from 'fs';
import { extractText } from 'unpdf';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = join(__dirname, '..', '..');
const WORKSPACE_DIR = join(PROJECT_DIR, 'workspace');

const sseClients = new Set();

function broadcast(payload) {
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    client.write(line);
  }
}

function broadcastMode(mode, agent = null) {
  broadcast({ type: 'pipeline_mode', mode, agent });
}

const AGENT_OUTPUT_VARS = {
  ps_output:        { agent: 'ProjectSetup',           foreground: false },
  extractor_output: { agent: 'Extractor',              foreground: false },
  researcher_output:{ agent: 'Researcher',             foreground: false },
  jde_output:       { agent: 'JD Enhancer',            foreground: false },
  analyst_output:   { agent: 'Analyst',                foreground: false },
  ta_output:        { agent: 'Tone Analyst',           foreground: true  },
  reviewer_output:  { agent: 'Reviewer',               foreground: true  },
  ac_output:        { agent: 'Assembly Coordinator',   foreground: true  },
  sn_output:        { agent: 'Style Negotiator',       foreground: true  },
  mo_output:        { agent: 'Main Orchestrator',      foreground: true  },
  pb_output:        { agent: 'Profile Builder',        foreground: false },
  sc_output:        { agent: 'Skills Curator',         foreground: false },
  hf_output:        { agent: 'History Formatter',      foreground: false },
  cf_output:        { agent: 'Credentials Formatter',  foreground: false },
  clw_output:       { agent: 'CoverLetter Writer',     foreground: false },
  sr_output:        { agent: 'Style Reviewer',         foreground: false },
  ic_output:        { agent: 'Integrity Checker',      foreground: false },
};

let recipe = null;
let DataType = null;
let fallbackAgent = null;

const KNOWN_AGENTS = new Set(Object.values(AGENT_OUTPUT_VARS).map(v => v.agent));

function serializeVar(variable) {
  return typeof variable.lastValue === 'string'
    ? variable.lastValue
    : JSON.stringify(variable.lastValue);
}

function logText(text, maxLen = 80) {
  return `${text.slice(0, maxLen).replace(/\n/g, '↵')}${text.length > maxLen ? '…' : ''}`;
}

export async function initRecipe(projectDir) {
  if (recipe) return;
  const recipePath = join(projectDir, 'recipe');

  const runtimePath = join(recipePath, 'node_modules', '@kemu-io', 'edge-runtime', 'runner.js');
  const runtimeUrl = new URL(`file://${runtimePath}`).href;
  const edgeModule = await import(runtimeUrl);

  const kemuEdge = edgeModule.default;
  DataType = edgeModule.DataType;

  process.chdir(recipePath);
  recipe = await kemuEdge.start();

  try {
    await recipe.globalVariables.setValue('AgentSelector', 'Main Orchestrator');
    console.log('AgentSelector → Main Orchestrator');
  } catch (err) {
    console.warn('Could not reset AgentSelector:', err.message);
  }

  for (const [varName, { agent: agentName, foreground }] of Object.entries(AGENT_OUTPUT_VARS)) {
    recipe.globalVariables.onChange(varName, (variable) => {
      const text = serializeVar(variable);
      if (!text) return;
      console.log(`[${agentName}] ${logText(text)}`);
      broadcast({ type: 'agent_message', text, agent: agentName, background: !foreground });
      if (foreground) {
        broadcast({ type: 'stream_done' });
        broadcastMode('user_turn', agentName);
      }
    });
  }

  let agentOutputTimer = null;
  let pendingAgentOutput = null;
  recipe.globalVariables.onChange('AgentOutput', (variable) => {
    const text = serializeVar(variable);
    if (!text) return;
    if (KNOWN_AGENTS.has(fallbackAgent)) return;
    pendingAgentOutput = text;
    if (agentOutputTimer) clearTimeout(agentOutputTimer);
    agentOutputTimer = setTimeout(() => {
      agentOutputTimer = null;
      const finalText = pendingAgentOutput;
      pendingAgentOutput = null;
      console.log(`[fallback output:${fallbackAgent}] ${logText(finalText, 60)}`);
      broadcast({ type: 'agent_message', text: finalText, agent: fallbackAgent });
      broadcast({ type: 'stream_done' });
    }, 500);
  });

  recipe.globalVariables.onChange('AgentReasoning', (variable) => {
    const text = serializeVar(variable);
    if (!text) return;
    broadcast({ type: 'reasoning', text });
  });

  recipe.globalVariables.onChange('AgentDebug', (variable) => {
    const text = serializeVar(variable);
    if (!text) return;
    broadcast({ type: 'debug_token', chunk: text });
  });

  recipe.globalVariables.onChange('AgentSelector', (variable) => {
    fallbackAgent = variable.lastValue;
    console.log(`[agent] → ${fallbackAgent}`);
    broadcast({ type: 'agent_switch', agent: fallbackAgent });
  });

  recipe.globalVariables.onChange('pipeline_status', async (variable) => {
    const status = variable.lastValue;
    if (!status) return;
    console.log(`[pipeline_status] → ${status}`);
    broadcast({ type: 'status_changed', status });
    updateProjectMemoryStatus(status);

    if (EXCEPTION_STATUSES.has(status)) {
      broadcastMode('user_turn', 'Main Orchestrator');
      await sendToNode(' Message', 'Main Orchestrator');
      return;
    }

    if (status === 'JD_ENHANCED') {
      broadcastMode('auto_running', 'Analysis');
      await Promise.all([
        sendToNode('tone_analyst_input', 'Tone Analyst', '__begin_interview__'),
        sendToNode('analyst_background_input', null, '__analyze__'),
      ]);
      await recipe.globalVariables.setValue('pipeline_status', 'PARALLEL_ANALYSIS');
      updateProjectMemoryStatus('PARALLEL_ANALYSIS');
      return;
    }

    if (status === 'RESEARCH_REDO') {
      broadcastMode('auto_running', 'Researcher');
      await recipe.globalVariables.setValue('research_confirmed', 0);
      await recipe.globalVariables.setValue('done_researcher', null);
      await sendToNode('researcher_input', 'Researcher', '__redo__');
      await recipe.globalVariables.setValue('pipeline_status', 'PARALLEL_ANALYSIS');
      updateProjectMemoryStatus('PARALLEL_ANALYSIS');
      return;
    }

    if (status === 'ANALYSIS_COMPLETE') {
      await recipe.globalVariables.setValue('done_analysis', 1);
      await checkJoin();
      return;
    }

    if (status === 'TONE_ANALYZED') {
      return;
    }

    if (status === 'SN_START') {
      broadcastMode('auto_running', 'Style Negotiator');
      await sendToNode('style_negotiator_input', 'Style Negotiator');
      await recipe.globalVariables.setValue('pipeline_status', 'STYLE_NEGOTIATING');
      updateProjectMemoryStatus('STYLE_NEGOTIATING');
      return;
    }

    if (AUTO_FIRE_STATUSES.has(status)) {
      const node = INPUT_NODE_MAP[status];
      const agent = HAPPY_PATH[status];
      broadcastMode('auto_running', agent);
      if (node) {
        console.log(`[pipeline_status] auto-fire ${status} → ${node}`);
        await sendToNode(node, agent);
      }
    }
  });

  recipe.globalVariables.onChange('done_researcher', checkResearchRedoJoin);
  recipe.globalVariables.onChange('done_TA', checkJoin);
  recipe.globalVariables.onChange('done_analysis', checkJoin);
  recipe.globalVariables.onChange('done_SN', dispatchAssemblyParallel);
  for (const flag of ['done_PB', 'done_SC', 'done_HF', 'done_CF', 'done_CLW']) {
    recipe.globalVariables.onChange(flag, checkAssemblyJoin);
  }
  recipe.globalVariables.onChange('done_SR', dispatchIntegrityChecker);
}

const INPUT_NODE_MAP = {
  'FILES_SAVED':        'extractor_input',
  'INITIALIZED':        'researcher_input',
  'RESEARCH_COMPLETE':  'jd_enhancer_input',
  'JD_ENHANCED':        'analyst_background_input',
  'PARALLEL_ANALYSIS':  'tone_analyst_input',
  'GAP_INTERVIEW':      'reviewer_input',
  'REVIEW_COMPLETE':    'assembly_coordinator_input',
  'CV_BUILDING':        'assembly_coordinator_input',
  'SN_START':           'style_negotiator_input',
};

const HAPPY_PATH = {
  'FILES_SAVED':        'Extractor',
  'INITIALIZED':        'Researcher',
  'RESEARCH_COMPLETE':  'JD Enhancer',
  'RESEARCH_PARTIAL':   'Main Orchestrator',
  'JD_ENHANCED':        'Analyst',
  'PARALLEL_ANALYSIS':  'Tone Analyst',
  'GAP_INTERVIEW':      'Reviewer',
  'REVIEW_COMPLETE':    'Assembly Coordinator',
  'CV_BUILDING':        'Assembly Coordinator',
  'STYLE_NEGOTIATING':  'Style Negotiator',
};

const EXCEPTION_STATUSES = new Set([
  'REVIEW_FAILED', 'RESEARCH_FAILED', 'ANALYSIS_FAILED',
  'EXTRACTION_FAILED', 'CV_TAILORED',
  'INTEGRITY_FAILED', 'STYLE_FAILED',
]);

// Auto-fire next agent with no user message. JD_ENHANCED handled separately (fork).
const AUTO_FIRE_STATUSES = new Set([
  'FILES_SAVED', 'INITIALIZED', 'RESEARCH_COMPLETE', 'REVIEW_COMPLETE',
]);

async function sendToNode(nodeName, agentName, query = '__auto__', sessionId = 'default') {
  if (agentName) {
    await recipe.globalVariables.setValue('AgentSelector', agentName);
    await new Promise((r) => setTimeout(r, 150));
  }
  try {
    await recipe.sendToInputWidget(nodeName, {
      type: DataType.JsonObj,
      value: { query, sessionId },
    });
  } catch {
    await recipe.sendToInputWidget(' Message', {
      type: DataType.JsonObj,
      value: { query, sessionId },
    });
  }
}

// Join: both done_TA and done_analysis set → merge gap_analysis.json into project_memory.json → dispatch Reviewer.
async function checkJoin() {
  if (!recipe) return;
  try {
    const doneTA = await recipe.globalVariables.getValue('done_TA');
    const doneAnalysis = await recipe.globalVariables.getValue('done_analysis');

    if (doneTA && doneAnalysis) {
      // BUG-142 fix: Analyst writes gap_analysis.json to avoid race condition with TA.
      // Server merges here — single writer, no concurrent project_memory.json writes.
      let fitScore = '?';
      try {
        const gapAnalysis = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'gap_analysis.json'), 'utf8'));
        const mem = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'project_memory.json'), 'utf8'));
        mem.gap_analysis = gapAnalysis;
        // BUG-123 server-side: delete stale review_audit from prior run
        if (mem.review_audit) delete mem.review_audit;
        mem.metadata = mem.metadata ?? {};
        mem.metadata.status = 'GAP_INTERVIEW';
        mem.metadata.lastUpdated = new Date().toISOString();
        writeFileSync(join(WORKSPACE_DIR, 'project_memory.json'), JSON.stringify(mem, null, 2));
        fitScore = gapAnalysis.overall_fit_score ?? fitScore;
        console.log(`[join] merged gap_analysis.json → project_memory.json, fit score ${fitScore}`);
      } catch (mergeErr) {
        console.error('[join] merge error:', mergeErr.message);
      }

      broadcast({
        type: 'agent_message',
        agent: 'System',
        text: `Gap analysis complete. Fit score: **${fitScore}/10**.`,
      });
      broadcastMode('auto_running', 'Reviewer');
      await recipe.globalVariables.setValue('pipeline_status', 'GAP_INTERVIEW');
      await sendToNode('reviewer_input', 'Reviewer', '__begin_gap_interview__');
      // Mode switches to user_turn when Reviewer produces first question
    } else if (doneTA && !doneAnalysis) {
      broadcast({
        type: 'agent_message',
        agent: 'System',
        text: 'Analysis still running in background — will begin gap review shortly…',
      });
      broadcastMode('auto_running', 'Analyst');
    }
  } catch (err) {
    console.error('[join] error:', err.message);
  }
}

// Assembly join: all 5 agents done → Style Reviewer.
async function checkAssemblyJoin() {
  if (!recipe) return;
  try {
    const flags = await Promise.all(
      ['done_PB', 'done_SC', 'done_HF', 'done_CF', 'done_CLW'].map(f =>
        recipe.globalVariables.getValue(f)
      )
    );
    if (flags.every(Boolean)) {
      console.log('[join] all assembly agents done — dispatching Style Reviewer');
      broadcastMode('auto_running', 'Style Reviewer');
      await sendToNode('style_reviewer_input', 'Style Reviewer');
    }
  } catch (err) {
    console.error('[assembly join] error:', err.message);
  }
}

// Research redo join: Researcher re-done mid-TA-interview.
async function checkResearchRedoJoin() {
  if (!recipe) return;
  try {
    const researchConfirmed = await recipe.globalVariables.getValue('research_confirmed');
    if (researchConfirmed !== 0) return;

    const doneResearcher = await recipe.globalVariables.getValue('done_researcher');
    if (!doneResearcher) return;

    let researchSummary = 'Research updated.';
    try {
      const mem = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'project_memory.json'), 'utf8'));
      const r = mem.research_data || {};
      const company = mem.metadata?.company_name || 'the company';
      const priorities = (r.company_priorities || []).slice(0, 3).join(', ') || 'not captured';
      researchSummary = `Updated research for **${company}**:\n- Key priorities: ${priorities}`;
    } catch {}

    const doneTA = await recipe.globalVariables.getValue('done_TA');
    if (doneTA) {
      // Both complete — ask user to confirm via action buttons
      broadcast({
        type: 'action_required',
        context: 'research_confirm',
        prompt: researchSummary + '\n\nConfirm to proceed with gap analysis, or run research again.',
        actions: [
          { id: 'research_confirm', label: 'Confirm — proceed with analysis', variant: 'primary' },
          { id: 'research_redo',    label: 'Run research again',               variant: 'ghost'   },
        ],
      });
      broadcastMode('action_required');
      await recipe.globalVariables.setValue('pipeline_status', 'RESEARCH_CONFIRM');
      updateProjectMemoryStatus('RESEARCH_CONFIRM');
    } else {
      // TA still in progress — passive notification
      broadcast({
        type: 'agent_message',
        agent: 'System',
        text: researchSummary + '\n\n*(Research updated — gap analysis will use this once your style interview completes.)*',
      });
    }
  } catch (err) {
    console.error('[research redo join] error:', err.message);
  }
}

// Dispatch 5 assembly agents in parallel after Style Negotiator completes.
async function dispatchAssemblyParallel() {
  if (!recipe) return;
  try {
    const doneSN = await recipe.globalVariables.getValue('done_SN');
    if (!doneSN) return;
    console.log('[assembly] Style Negotiator done — dispatching 5 agents in parallel');
    broadcastMode('auto_running', 'Building CV sections…');
    await Promise.all([
      sendToNode('profile_builder_input',      'Profile Builder',      '__build__'),
      sendToNode('skills_curator_input',        'Skills Curator',       '__curate__'),
      sendToNode('history_formatter_input',     'History Formatter',    '__format__'),
      sendToNode('credentials_formatter_input', 'Credentials Formatter','__format__'),
      sendToNode('coverletter_writer_input',    'CoverLetter Writer',   '__write__'),
    ]);
    await recipe.globalVariables.setValue('pipeline_status', 'ASSEMBLY_PARALLEL');
    updateProjectMemoryStatus('ASSEMBLY_PARALLEL');
  } catch (err) {
    console.error('[assembly parallel] error:', err.message);
  }
}

// Dispatch Integrity Checker after Style Reviewer.
async function dispatchIntegrityChecker() {
  if (!recipe) return;
  try {
    const doneSR = await recipe.globalVariables.getValue('done_SR');
    if (!doneSR) return;
    console.log('[assembly] Style Reviewer done — dispatching Integrity Checker');
    broadcastMode('auto_running', 'Integrity Checker');
    await sendToNode('integrity_checker_input', 'Integrity Checker', '__check__');
    await recipe.globalVariables.setValue('pipeline_status', 'INTEGRITY_CHECKING');
    updateProjectMemoryStatus('INTEGRITY_CHECKING');
  } catch (err) {
    console.error('[integrity checker] error:', err.message);
  }
}

function updateProjectMemoryStatus(status) {
  try {
    const mem = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'project_memory.json'), 'utf8'));
    mem.metadata = mem.metadata ?? {};
    mem.metadata.status = status;
    writeFileSync(join(WORKSPACE_DIR, 'project_memory.json'), JSON.stringify(mem, null, 2));
  } catch { /* project_memory may not exist yet */ }
}

// ── Routes ────────────────────────────────────────────────────────────────────

const express = (await import('express')).default;
const router = express.Router();
export default router;

// GET /api/stream
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(': heartbeat\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// POST /api/upload
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
    } else {
      text = req.body.toString('utf8');
    }
    writeFileSync(join(WORKSPACE_DIR, `${target}.txt`), text, 'utf8');
    console.log(`[upload] ${originalName} → ${target}.txt (${text.length} chars)`);
    res.json({ ok: true, filename: `${target}.txt` });
  } catch (err) {
    console.error('[upload] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/message — send user message to active agent
router.post('/message', async (req, res) => {
  const { message, sessionId = 'default' } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }
  if (!recipe) {
    return res.status(503).json({ error: 'Recipe not ready' });
  }

  const RERUN_RE = /\b(rerun|re-run|redo|re-do|retry|re-try)\b/i;
  const RERUN_MAP = [
    { pattern: /extractor/i,           resetStatus: 'FILES_SAVED',       agent: 'Extractor'   },
    { pattern: /researcher|research/i, resetStatus: 'INITIALIZED',       agent: 'Researcher'  },
    { pattern: /jd.?enhancer|jd/i,     resetStatus: 'RESEARCH_COMPLETE', agent: 'JD Enhancer' },
    { pattern: /analyst/i,             resetStatus: 'JD_ENHANCED',       agent: 'Analyst'     },
    { pattern: /reviewer|review/i,     resetStatus: 'ANALYSIS_COMPLETE', agent: 'Reviewer'    },
  ];

  const userWantsRerun = RERUN_RE.test(message);
  try {
    const mem = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'project_memory.json'), 'utf8'));
    const status = mem?.metadata?.status;
    let nextAgent = null;

    if (userWantsRerun) {
      const match = RERUN_MAP.find(r => r.pattern.test(message));
      if (match) {
        mem.metadata = mem.metadata ?? {};
        mem.metadata.status = match.resetStatus;
        writeFileSync(join(WORKSPACE_DIR, 'project_memory.json'), JSON.stringify(mem, null, 2));
        nextAgent = match.agent;
        console.log(`[route] rerun "${match.agent}" — status reset to ${match.resetStatus}`);
        broadcast({ type: 'agent_message', agent: 'System', text: `Re-running **${match.agent}**…` });
        broadcastMode('auto_running', match.agent);
      } else {
        nextAgent = 'Main Orchestrator';
      }
    } else if (status && HAPPY_PATH[status]) {
      nextAgent = HAPPY_PATH[status];
    } else if (status && EXCEPTION_STATUSES.has(status)) {
      nextAgent = 'Main Orchestrator';
    }

    if (nextAgent) {
      const node = INPUT_NODE_MAP[status] ?? ' Message';
      if (!userWantsRerun) console.log(`[route] ${status} → ${nextAgent} via ${node}`);
      await sendToNode(node, nextAgent, message, sessionId);
      res.json({ ok: true });
      return;
    }
  } catch { /* no project_memory yet */ }

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

// POST /api/action — handle structured action button clicks
router.post('/action', express.json(), async (req, res) => {
  const { id } = req.body;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'id required' });
  }
  if (!recipe) {
    return res.status(503).json({ error: 'Recipe not ready' });
  }

  try {
    switch (id) {
      case 'research_confirm':
        broadcast({ type: 'agent_message', agent: 'System', text: 'Research confirmed — running gap analysis…' });
        broadcastMode('auto_running', 'Analyst');
        await recipe.globalVariables.setValue('research_confirmed', 1);
        await recipe.globalVariables.setValue('done_analysis', null);
        await sendToNode('analyst_background_input', null, '__analyze__');
        await recipe.globalVariables.setValue('pipeline_status', 'PARALLEL_ANALYSIS');
        updateProjectMemoryStatus('PARALLEL_ANALYSIS');
        break;

      case 'research_redo':
        broadcast({ type: 'agent_message', agent: 'System', text: 'Re-running research…' });
        broadcastMode('auto_running', 'Researcher');
        await recipe.globalVariables.setValue('done_researcher', null);
        await sendToNode('researcher_input', 'Researcher', '__redo__');
        await recipe.globalVariables.setValue('pipeline_status', 'PARALLEL_ANALYSIS');
        updateProjectMemoryStatus('PARALLEL_ANALYSIS');
        break;

      default:
        return res.status(400).json({ error: `unknown action: ${id}` });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[action] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/status
router.get('/status', (req, res) => {
  try {
    const memory = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'project_memory.json'), 'utf8'));
    res.json({
      status: memory?.metadata?.status ?? null,
      phase:  memory?.metadata?.current_phase ?? null,
    });
  } catch {
    res.json({ status: null, phase: null });
  }
});

// POST /api/reset — clear workspace and reset pipeline vars
router.post('/reset', async (req, res) => {
  if (!recipe) return res.status(503).json({ error: 'Recipe not ready' });
  try {
    // Preserve only uploaded source files — clear everything else (BUG-145 fix)
    const PRESERVE = new Set(['cv_raw.txt', 'jd_raw.txt', 'cover_letter_sample.txt']);
    try {
      const files = readdirSync(WORKSPACE_DIR);
      for (const f of files) {
        if (!PRESERVE.has(f)) rmSync(join(WORKSPACE_DIR, f), { force: true });
      }
    } catch {}

    // Clear chat history
    try { rmSync(HISTORY_FILE); } catch {}

    // Clear all pipeline global vars + per-agent output vars
    const ALL_PIPELINE_VARS = [
      'pipeline_status',
      'done_researcher', 'done_TA', 'done_analysis', 'done_RV',
      'research_confirmed', 'fit_score',
      'done_SN', 'done_PB', 'done_SC', 'done_HF', 'done_CF', 'done_CLW',
      'done_SR', 'done_IC',
      ...Object.keys(AGENT_OUTPUT_VARS),
    ];
    for (const v of ALL_PIPELINE_VARS) {
      try { await recipe.globalVariables.setValue(v, null); } catch {}
    }

    await recipe.globalVariables.setValue('AgentSelector', 'ProjectSetup');
    fallbackAgent = 'ProjectSetup';
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
router.post('/abort', async (req, res) => {
  if (!recipe) return res.status(503).json({ error: 'Recipe not ready' });
  try {
    broadcastMode('user_turn', 'Main Orchestrator');
    await recipe.globalVariables.setValue('Settings.Abort_All_Processing', true);
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

// GET /api/workspace
const WORKSPACE_ALLOWED = [
  'project_memory.json', 'cv_assembly_state.json',
  'candidate_profile.json', 'style_guide.json', 'agent_reasoning.json',
  'gap_analysis.json',
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

// POST /api/dev/status
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

// POST /api/inject
router.post('/inject', express.json(), (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message required' });
  }
  broadcast({ type: 'agent_message', agent: 'System', text: message });
  broadcast({ type: 'stream_done' });
  res.json({ ok: true });
});

const HISTORY_FILE = join(PROJECT_DIR, 'chat_history.json');

router.get('/history', (req, res) => {
  try {
    res.json(JSON.parse(readFileSync(HISTORY_FILE, 'utf8')));
  } catch {
    res.json([]);
  }
});

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
