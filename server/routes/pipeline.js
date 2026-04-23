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
  console.log(`[broadcastMode] mode=${mode} agent=${agent} clients=${sseClients.size}`);
  broadcast({ type: 'pipeline_mode', mode, agent });
}

// Foreground agents produce output visible to user + unlock input.
// Background agents produce output shown as compact bubbles only.
const AGENT_FOREGROUND = new Set([
  'Main Orchestrator', 'ProjectSetup', 'Tone Analyst', 'Reviewer',
  'Assembly Coordinator', 'Style Negotiator',
]);

let recipe = null;
let DataType = null;
let fallbackAgent = null;


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
    console.log(`▶ AGENT    ${fallbackAgent} (clients=${sseClients.size})`);
    broadcast({ type: 'agent_switch', agent: fallbackAgent });
  });

  recipe.globalVariables.onChange('pipeline_status', async (variable) => {
    await handlePipelineStatus(variable.lastValue);
  });

  // Resume after server restart: if pipeline was mid-run, re-fire the handler.
  // onChange only fires on *change* — existing KEMU state is invisible on cold start.
  try {
    const currentStatus = await recipe.globalVariables.getValue('pipeline_status');
    if (currentStatus) {
      console.log(`[resume] pipeline_status already = ${currentStatus} — re-firing handler`);
      await handlePipelineStatus(currentStatus, { resume: true });
    }
  } catch (err) {
    console.warn('[resume] could not read pipeline_status:', err.message);
  }
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

// These agents write status to project_memory.json but never call set_status() KEMU tool.
// After they complete, server must read the file to continue the pipeline.
const FILE_WRITER_STATUSES = new Set(['FILES_SAVED', 'INITIALIZED', 'RESEARCH_COMPLETE']);

const EXCEPTION_ACTION_BUTTONS = {
  'REVIEW_FAILED': [
    { id: 'redo_analyst',     label: 'Redo analysis',      variant: 'ghost'   },
    { id: 'redo_researcher',  label: 'Redo research',       variant: 'ghost'   },
    { id: 'redo_jd_enhancer', label: 'Redo JD enhancement', variant: 'ghost'   },
    { id: 'accept_anyway',    label: 'Accept & proceed',    variant: 'primary' },
    { id: 'details',          label: 'Show details',        variant: 'ghost'   },
  ],
  'RESEARCH_FAILED': [
    { id: 'research_retry',  label: 'Retry research',                 variant: 'primary' },
    { id: 'research_skip',   label: 'Skip & continue (not recommended)', variant: 'ghost' },
  ],
  'ANALYSIS_FAILED': [
    { id: 'analysis_retry',            label: 'Retry analysis',        variant: 'primary' },
    { id: 'analysis_redo_researcher',  label: 'Redo research first',   variant: 'ghost'   },
  ],
};

// Server-side join gate (replaces KEMU done_* flags).
let analystDone = false;
let taDone = false;
// TA session state — suppresses late TA broadcast after TONE_ANALYZED fires.
let taCompleted = false;
let taFirstTurnDone = false; // false → inject research-confirm buttons; true → inject yes/no
// Reviewer gap interview state — drives which buttons to inject.
let reviewerGapState = null; // 'question' | 'continue' | 'issue' | null
// SN session state — suppresses late SN broadcast after SN_COMPLETE fires.
let snCompleted = false;
// RESEARCH_PARTIAL flag — set in onChange (before Researcher output returns), consumed in .then() chain.
let researchPartial = false;

// Dedup: prevent double-dispatch when both onChange AND continueFromFile fire for same status.
const recentlyDispatched = new Map(); // status → timestamp ms

function broadcastAgentResult(result, agentName, foreground) {
  const text = typeof result === 'string' ? result
             : result != null             ? JSON.stringify(result)
             : null;
  if (!text) { console.log(`[broadcastAgentResult] ${agentName} — empty result, skipping`); return; }
  console.log(`✓ COMPLETE ${agentName} (${text.length} chars) foreground=${foreground} clients=${sseClients.size}`);
  broadcast({ type: 'agent_message', text, agent: agentName, background: !foreground });
  if (foreground) {
    broadcast({ type: 'stream_done' });
    broadcastMode('user_turn', agentName);
  }
}

async function handlePipelineStatus(status, { resume = false } = {}) {
  if (!status) return;
  if (!resume) {
    const last = recentlyDispatched.get(status);
    if (last && Date.now() - last < 30_000) {
      console.log(`[handlePipelineStatus] ${status} already dispatched ${Date.now() - last}ms ago — skip`);
      return;
    }
    recentlyDispatched.set(status, Date.now());
  }
  console.log(`◆ STATUS   ${status}${resume ? ' (resume)' : ''}`);
  broadcast({ type: 'status_changed', status });
  if (!resume) updateProjectMemoryStatus(status);

  if (resume) {
    if (status === 'JD_ENHANCED' || status === 'PARALLEL_ANALYSIS') {
      // Infer join state from workspace files
      const gapExists = (() => { try { readFileSync(join(WORKSPACE_DIR, 'gap_analysis.json')); return true; } catch { return false; } })();
      const styleExists = (() => { try { readFileSync(join(WORKSPACE_DIR, 'style_guide.json')); return true; } catch { return false; } })();
      analystDone = gapExists;
      taDone = styleExists;
      console.log(`[resume] ${status} — analystDone=${analystDone} taDone=${taDone}`);
      if (analystDone && taDone) {
        await checkJoin();
      } else if (!taDone) {
        console.log('[resume] style_guide missing — re-firing Tone Analyst');
        taCompleted = false;
        taFirstTurnDone = false;
        broadcastMode('auto_running', 'Tone Analyst');
        sendToNodeAndWait('tone_analyst_input', 'Tone Analyst', '__begin_interview__')
          .then(r => {
            if (!taCompleted) {
              broadcastAgentResult(r, 'Tone Analyst', true);
              injectTAButtons();
            }
          })
          .catch(err => console.error('[TA resume] error:', err));
      }
      if (!analystDone) {
        console.log('[resume] gap_analysis missing — re-firing Analyst');
        sendToNodeAndWait('analyst_background_input', null, '__analyze__')
          .then(r => { broadcastAgentResult(r, 'Analyst', false); analystDone = true; checkJoin(); })
          .catch(err => console.error('[Analyst resume] error:', err));
      }
    } else if (status === 'SN_START' || status === 'STYLE_NEGOTIATING') {
      console.log('[resume] re-firing Style Negotiator');
      snCompleted = false;
      broadcastMode('auto_running', 'Style Negotiator');
      sendToNodeAndWait('style_negotiator_input', 'Style Negotiator')
        .then(r => {
          broadcastAgentResult(r, 'Style Negotiator', !snCompleted);
          if (!snCompleted) injectSNButtons();
        })
        .catch(err => console.error('[SN resume] error:', err));
    }
    return;
  }

  if (status === 'RESEARCH_PARTIAL') {
    // onChange fires DURING Researcher execution (before output returns).
    // Set flag so the .then() chain can inject buttons AFTER Researcher output is broadcast.
    // Also override AgentSelector so Researcher's ChangeAgent("JD Enhancer") doesn't take effect.
    researchPartial = true;
    try { await recipe.globalVariables.setValue('AgentSelector', 'Main Orchestrator'); } catch {}
    return;
  }

  if (EXCEPTION_STATUSES.has(status)) {
    broadcastMode('user_turn', 'Main Orchestrator');
    sendToNodeAndWait(' Message', 'Main Orchestrator')
      .then(r => {
        broadcastAgentResult(r, 'Main Orchestrator', true);
        const buttons = EXCEPTION_ACTION_BUTTONS[status];
        if (buttons) broadcast({ type: 'action_required', context: status.toLowerCase(), prompt: '', actions: buttons });
      })
      .catch(err => console.error('[MO exception] error:', err));
    return;
  }

  if (status === 'JD_ENHANCED') {
    analystDone = false;
    taDone = false;
    taCompleted = false;
    taFirstTurnDone = false;
    broadcastMode('auto_running', 'Analysis');
    await recipe.globalVariables.setValue('pipeline_status', 'PARALLEL_ANALYSIS');
    updateProjectMemoryStatus('PARALLEL_ANALYSIS');
    // Fire TA (interactive) + Analyst (background) in parallel — each resolves after first response
    sendToNodeAndWait('tone_analyst_input', 'Tone Analyst', '__begin_interview__')
      .then(r => {
        if (!taCompleted) {
          broadcastAgentResult(r, 'Tone Analyst', true);
          injectTAButtons();
        }
      })
      .catch(err => console.error('[TA] error:', err));
    sendToNodeAndWait('analyst_background_input', null, '__analyze__')
      .then(r => { broadcastAgentResult(r, 'Analyst', false); analystDone = true; checkJoin(); })
      .catch(err => console.error('[Analyst] error:', err));
    return;
  }

  if (status === 'TONE_ANALYZED') {
    taCompleted = true; // suppress any late TA broadcast that returns after pipeline advances
    taDone = true;
    await checkJoin();
    return;
  }

  if (status === 'ANALYSIS_COMPLETE') {
    analystDone = true;
    await checkJoin();
    return;
  }

  if (status === 'RESEARCH_REDO') {
    broadcastMode('auto_running', 'Researcher');
    await recipe.globalVariables.setValue('research_confirmed', 0);
    sendToNodeAndWait('researcher_input', 'Researcher', '__redo__')
      .then(r => { broadcastAgentResult(r, 'Researcher', false); checkResearchRedoJoin(); })
      .catch(err => console.error('[Researcher redo] error:', err));
    await recipe.globalVariables.setValue('pipeline_status', 'PARALLEL_ANALYSIS');
    updateProjectMemoryStatus('PARALLEL_ANALYSIS');
    return;
  }

  if (status === 'SN_START') {
    snCompleted = false;
    broadcastMode('auto_running', 'Style Negotiator');
    await recipe.globalVariables.setValue('pipeline_status', 'STYLE_NEGOTIATING');
    updateProjectMemoryStatus('STYLE_NEGOTIATING');
    sendToNodeAndWait('style_negotiator_input', 'Style Negotiator')
      .then(r => {
        broadcastAgentResult(r, 'Style Negotiator', !snCompleted);
        if (!snCompleted) injectSNButtons();
      })
      .catch(err => console.error('[SN] error:', err));
    return;
  }

  if (status === 'SN_COMPLETE') {
    snCompleted = true; // suppress late SN broadcast if result returns after pipeline advances
    await dispatchAssemblyParallel();
    return;
  }

  if (AUTO_FIRE_STATUSES.has(status)) {
    const node = INPUT_NODE_MAP[status];
    const agent = HAPPY_PATH[status];
    if (!node) return;
    broadcastMode('auto_running', agent);
    console.log(`[pipeline_status] auto-fire ${status} → ${node}`);
    sendToNodeAndWait(node, agent)
      .then(async r => {
        broadcastAgentResult(r, agent, AGENT_FOREGROUND.has(agent));
        if (FILE_WRITER_STATUSES.has(status)) await continueFromFile(status);
        if (status === 'REVIEW_COMPLETE') injectACPhase0Buttons();
        // Researcher set RESEARCH_PARTIAL during execution — inject buttons NOW, after output is broadcast
        if (status === 'INITIALIZED' && researchPartial) {
          researchPartial = false;
          broadcastMode('user_turn');
          broadcast({
            type: 'action_required',
            context: 'research_partial',
            prompt: '',
            actions: [
              { id: 'research_partial_proceed', label: 'Proceed with partial research', variant: 'primary' },
              { id: 'research_retry',           label: 'Retry research',                variant: 'ghost'   },
            ],
          });
        }
      })
      .catch(err => console.error(`[${agent}] error:`, err));
  }
}

function injectTAButtons() {
  if (taCompleted) return;
  if (!taFirstTurnDone) {
    taFirstTurnDone = true;
    broadcast({
      type: 'action_required',
      context: 'ta_research_confirm',
      prompt: '',
      actions: [
        { id: 'ta_yes',           label: 'Yes, looks right',  variant: 'primary' },
        { id: 'ta_redo_research', label: 'Redo research',     variant: 'ghost'   },
      ],
    });
  } else {
    broadcast({
      type: 'action_required',
      context: 'ta_question',
      prompt: '',
      actions: [
        { id: 'ta_yes', label: 'Yes', variant: 'primary' },
        { id: 'ta_no',  label: 'No',  variant: 'ghost'   },
      ],
    });
  }
}

function injectReviewerButtons() {
  try {
    const mem = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'project_memory.json'), 'utf8'));
    const status = mem?.metadata?.status;
    if (status === 'REVIEW_COMPLETE' || status === 'REVIEW_FAILED') { reviewerGapState = null; return; }

    const reviewAudit = mem?.review_audit;
    if (reviewAudit) {
      // Phase 7.5 — issue backing in progress
      reviewerGapState = 'issue';
      const BACKABLE = ['A - Evidence Mismatch', 'B - Seniority Inflation', 'D - Missing Context'];
      const hasUnbacked = reviewAudit.issues_found?.some(i =>
        BACKABLE.includes(i.issue_type) && i.user_backed === undefined
      );
      if (hasUnbacked) {
        broadcast({ type: 'action_required', context: 'reviewer_issue', prompt: '', actions: [
          { id: 'reviewer_skip', label: 'Skip — leave flagged', variant: 'ghost' },
        ]});
      }
    } else if (reviewerGapState === 'question') {
      // Just showed a gap question — inject Skip button
      reviewerGapState = 'continue';
      broadcast({ type: 'action_required', context: 'reviewer_gap', prompt: '', actions: [
        { id: 'reviewer_skip', label: 'Skip this gap', variant: 'ghost' },
      ]});
    } else if (reviewerGapState === 'continue') {
      // Just recorded an answer — inject Continue button
      reviewerGapState = 'question';
      broadcast({ type: 'action_required', context: 'reviewer_continue', prompt: '', actions: [
        { id: 'reviewer_continue', label: 'Continue →', variant: 'primary' },
      ]});
    }
  } catch { /* project_memory may not exist */ }
}

function injectSNButtons() {
  if (snCompleted) return;
  broadcast({
    type: 'action_required',
    context: 'sn_format_options',
    prompt: '',
    actions: [
      { id: 'sn_apply_all',     label: 'Apply all standards',  variant: 'primary' },
      { id: 'sn_pronouns_only', label: 'Remove pronouns only', variant: 'ghost'   },
      { id: 'sn_custom',        label: 'Discuss custom format', variant: 'ghost'   },
      { id: 'sn_keep_current',  label: 'Keep current style',   variant: 'ghost'   },
    ],
  });
}

function injectACPhase0Buttons() {
  try {
    const cvState = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'cv_assembly_state.json'), 'utf8'));
    if (cvState.current_phase === 1 && cvState.phases?.[0]?.status === 'PENDING') {
      broadcast({
        type: 'action_required',
        context: 'cv_build_confirm',
        prompt: '',
        actions: [
          { id: 'ac_proceed', label: 'Proceed — build CV', variant: 'primary' },
          { id: 'ac_redo',    label: 'Go back & review',   variant: 'ghost'   },
        ],
      });
    }
  } catch { /* cv_assembly_state may not exist */ }
}

// Agents write status to project_memory.json but don't call set_status() KEMU tool.
// Read the new status from file and continue the pipeline manually.
async function continueFromFile(prevStatus) {
  try {
    const mem = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'project_memory.json'), 'utf8'));
    const newStatus = mem?.metadata?.status;
    if (newStatus && newStatus !== prevStatus) {
      console.log(`[continueFromFile] ${prevStatus} → ${newStatus}`);
      await handlePipelineStatus(newStatus);
    } else {
      console.log(`[continueFromFile] status unchanged (${newStatus}) after ${prevStatus} — no continuation`);
    }
  } catch (err) {
    console.error('[continueFromFile] error:', err.message);
  }
}

async function sendToNodeAndWait(nodeName, agentName, query = '__auto__', sessionId = 'default') {
  if (agentName) {
    await recipe.globalVariables.setValue('AgentSelector', agentName);
    await new Promise((r) => setTimeout(r, 150));
  }
  console.log(`▶ TRIGGER(wait) ${agentName ?? '(no agent)'} → node:${nodeName} query:${query}`);
  try {
    const result = await recipe.sendToInputWidgetAndWaitForOutput(nodeName, {
      type: DataType.JsonObj,
      value: { query, sessionId },
    });
    console.log(`✓ OUTPUT(wait) ${agentName} result_len=${JSON.stringify(result)?.length}`);
    return result;
  } catch (err) {
    console.log(`▶ TRIGGER(wait) fallback → node:' Message' (${nodeName} not found): ${err.message}`);
    return await recipe.sendToInputWidgetAndWaitForOutput(' Message', {
      type: DataType.JsonObj,
      value: { query, sessionId },
    });
  }
}

// Join: both TA interview complete + Analyst done → merge gap_analysis → dispatch Reviewer.
async function checkJoin() {
  if (!recipe) return;
  console.log(`[checkJoin] analystDone=${analystDone} taDone=${taDone}`);
  if (!analystDone || !taDone) {
    if (taDone && !analystDone) {
      broadcast({ type: 'agent_message', agent: 'System', text: 'Analysis still running in background — will begin gap review shortly…', background: true });
    }
    return;
  }
  analystDone = false;
  taDone = false;

  let fitScore = '?';
  try {
    const gapAnalysis = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'gap_analysis.json'), 'utf8'));
    const mem = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'project_memory.json'), 'utf8'));
    mem.gap_analysis = gapAnalysis;
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

  broadcast({ type: 'agent_message', agent: 'System', text: `Gap analysis complete. Fit score: **${fitScore}/10**.` });
  reviewerGapState = 'question';
  broadcastMode('auto_running', 'Reviewer');
  await recipe.globalVariables.setValue('pipeline_status', 'GAP_INTERVIEW');
  sendToNodeAndWait('reviewer_input', 'Reviewer', '__begin_gap_interview__')
    .then(r => { broadcastAgentResult(r, 'Reviewer', true); injectReviewerButtons(); })
    .catch(err => console.error('[Reviewer] error:', err));
}

// Research redo join: Researcher re-done mid-TA-interview.
async function checkResearchRedoJoin() {
  if (!recipe) return;
  try {
    const researchConfirmed = await recipe.globalVariables.getValue('research_confirmed');
    if (researchConfirmed !== 0) return;

    let researchSummary = 'Research updated.';
    try {
      const mem = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'project_memory.json'), 'utf8'));
      const r = mem.research_data || {};
      const company = mem.metadata?.company_name || 'the company';
      const priorities = (r.company_priorities || []).slice(0, 3).join(', ') || 'not captured';
      researchSummary = `Updated research for **${company}**:\n- Key priorities: ${priorities}`;
    } catch {}

    if (taDone) {
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
      broadcast({ type: 'agent_message', agent: 'System', text: researchSummary + '\n\n*(Research updated — gap analysis will use this once your style interview completes.)*' });
    }
  } catch (err) {
    console.error('[research redo join] error:', err.message);
  }
}

// Dispatch 5 assembly agents in parallel after Style Negotiator completes.
async function dispatchAssemblyParallel() {
  if (!recipe) return;
  try {
    console.log('[assembly] dispatching 5 agents in parallel');
    broadcastMode('auto_running', 'Building CV sections…');
    await recipe.globalVariables.setValue('pipeline_status', 'ASSEMBLY_PARALLEL');
    updateProjectMemoryStatus('ASSEMBLY_PARALLEL');

    const [pb, sc, hf, cf, clw] = await Promise.all([
      sendToNodeAndWait('profile_builder_input',      'Profile Builder',      '__build__'),
      sendToNodeAndWait('skills_curator_input',        'Skills Curator',       '__curate__'),
      sendToNodeAndWait('history_formatter_input',     'History Formatter',    '__format__'),
      sendToNodeAndWait('credentials_formatter_input', 'Credentials Formatter','__format__'),
      sendToNodeAndWait('cover_letter_writer_input',   'Cover Letter Writer',  '__write__'),
    ]);

    for (const [result, agent] of [[pb,'Profile Builder'],[sc,'Skills Curator'],[hf,'History Formatter'],[cf,'Credentials Formatter'],[clw,'Cover Letter Writer']]) {
      broadcastAgentResult(result, agent, false);
    }

    // Merge output files into cv_assembly_state.json before SR reads it
    await checkAssemblyJoin();

    broadcast({ type: 'agent_message', agent: 'System', text: 'Assembly complete — running style review.' });
    broadcastMode('auto_running', 'Style Reviewer');
    sendToNodeAndWait('style_reviewer_input', 'Style Reviewer')
      .then(r => { broadcastAgentResult(r, 'Style Reviewer', false); dispatchIntegrityChecker(); })
      .catch(err => console.error('[SR] error:', err));
  } catch (err) {
    console.error('[assembly parallel] error:', err.message);
  }
}

// Merge 5 parallel assembly output files into cv_assembly_state.json phases[1-5].
// Called after Promise.all resolves in dispatchAssemblyParallel, before SR is dispatched.
async function checkAssemblyJoin() {
  try {
    const cvState = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'cv_assembly_state.json'), 'utf8'));
    const outputFiles = [
      ['pb_output.json',  1],
      ['sc_output.json',  2],
      ['hf_output.json',  3],
      ['cf_output.json',  4],
      ['clw_output.json', 5],
    ];
    let mergedCount = 0;
    for (const [file, phaseIndex] of outputFiles) {
      try {
        const output = JSON.parse(readFileSync(join(WORKSPACE_DIR, file), 'utf8'));
        if (output?.status === 'COMPLETE') {
          cvState.phases[phaseIndex].status = 'COMPLETE';
          cvState.phases[phaseIndex].completed_at = output.completed_at ?? new Date().toISOString();
          cvState.phases[phaseIndex].data = output.data;
          mergedCount++;
        }
      } catch { /* file not written — agent failed */ }
    }
    if (mergedCount > 0) {
      cvState.current_phase = 7;
      cvState.metadata.completed_phases = mergedCount + 1; // +1 for SN (phases[0])
      cvState.metadata.last_updated = new Date().toISOString();
      writeFileSync(join(WORKSPACE_DIR, 'cv_assembly_state.json'), JSON.stringify(cvState, null, 2));
    }
    console.log(`[checkAssemblyJoin] merged ${mergedCount}/5 output files → cv_assembly_state.json`);
  } catch (err) {
    console.error('[checkAssemblyJoin] error:', err.message);
  }
}

async function dispatchIntegrityChecker() {
  if (!recipe) return;
  try {
    console.log('[assembly] dispatching Integrity Checker');
    broadcastMode('auto_running', 'Integrity Checker');
    await recipe.globalVariables.setValue('pipeline_status', 'INTEGRITY_CHECKING');
    updateProjectMemoryStatus('INTEGRITY_CHECKING');
    sendToNodeAndWait('integrity_checker_input', 'Integrity Checker', '__check__')
      .then(r => broadcastAgentResult(r, 'Integrity Checker', false))
      .catch(err => console.error('[IC] error:', err));
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
  let nextAgent = null;
  let node = ' Message';
  let prevStatus = null;

  try {
    const mem = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'project_memory.json'), 'utf8'));
    const status = mem?.metadata?.status;
    prevStatus = status ?? null;

    if (userWantsRerun) {
      const match = RERUN_MAP.find(r => r.pattern.test(message));
      if (match) {
        mem.metadata = mem.metadata ?? {};
        mem.metadata.status = match.resetStatus;
        writeFileSync(join(WORKSPACE_DIR, 'project_memory.json'), JSON.stringify(mem, null, 2));
        nextAgent = match.agent;
        node = INPUT_NODE_MAP[match.resetStatus] ?? ' Message';
        console.log(`[route] rerun "${match.agent}" — status reset to ${match.resetStatus}`);
        broadcast({ type: 'agent_message', agent: 'System', text: `Re-running **${match.agent}**…` });
        broadcastMode('auto_running', match.agent);
      } else {
        nextAgent = 'Main Orchestrator';
      }
    } else if (status && HAPPY_PATH[status]) {
      nextAgent = HAPPY_PATH[status];
      node = INPUT_NODE_MAP[status] ?? ' Message';
      console.log(`[route] ${status} → ${nextAgent} via ${node}`);
    } else if (status && EXCEPTION_STATUSES.has(status)) {
      nextAgent = 'Main Orchestrator';
    }
  } catch { /* no project_memory yet */ }

  if (!nextAgent) {
    nextAgent = fallbackAgent ?? 'Main Orchestrator';
    console.log(`[user] fallback → ${nextAgent}: ${message.slice(0, 80)}`);
  }

  res.json({ ok: true });
  const foreground = AGENT_FOREGROUND.has(nextAgent);
  sendToNodeAndWait(node, nextAgent, message, sessionId)
    .then(async r => {
      if (nextAgent === 'Tone Analyst') {
        // continueFromFile first — sets taCompleted if TONE_ANALYZED written, then broadcast correctly
        await continueFromFile(prevStatus);
        broadcastAgentResult(r, 'Tone Analyst', !taCompleted); // background if TA session ended
        if (!taCompleted) injectTAButtons();
      } else if (nextAgent === 'Reviewer') {
        broadcastAgentResult(r, 'Reviewer', true);
        injectReviewerButtons();
        await continueFromFile(prevStatus);
      } else if (nextAgent === 'Style Negotiator') {
        broadcastAgentResult(r, 'Style Negotiator', !snCompleted);
        if (!snCompleted) injectSNButtons();
      } else {
        broadcastAgentResult(r, nextAgent, foreground);
        await continueFromFile(prevStatus);
      }
    })
    .catch(err => console.error(`[${nextAgent}] message error:`, err));
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
        await recipe.globalVariables.setValue('pipeline_status', 'PARALLEL_ANALYSIS');
        updateProjectMemoryStatus('PARALLEL_ANALYSIS');
        analystDone = false;
        sendToNodeAndWait('analyst_background_input', null, '__analyze__')
          .then(r => { broadcastAgentResult(r, 'Analyst', false); analystDone = true; checkJoin(); })
          .catch(err => console.error('[Analyst confirm] error:', err));
        break;

      case 'research_redo':
        broadcast({ type: 'agent_message', agent: 'System', text: 'Re-running research…' });
        broadcastMode('auto_running', 'Researcher');
        await recipe.globalVariables.setValue('pipeline_status', 'PARALLEL_ANALYSIS');
        updateProjectMemoryStatus('PARALLEL_ANALYSIS');
        sendToNodeAndWait('researcher_input', 'Researcher', '__redo__')
          .then(r => { broadcastAgentResult(r, 'Researcher', false); checkResearchRedoJoin(); })
          .catch(err => console.error('[Researcher redo action] error:', err));
        break;

      case 'redo_analyst':
        broadcast({ type: 'agent_message', agent: 'System', text: 'Re-running gap analysis…' });
        broadcastMode('auto_running', 'Analyst');
        updateProjectMemoryStatus('JD_ENHANCED');
        analystDone = false;
        sendToNodeAndWait('analyst_background_input', null, '__analyze__')
          .then(r => { broadcastAgentResult(r, 'Analyst', false); analystDone = true; checkJoin(); })
          .catch(err => console.error('[Analyst redo action] error:', err));
        break;

      case 'redo_researcher':
        broadcast({ type: 'agent_message', agent: 'System', text: 'Re-running research…' });
        broadcastMode('auto_running', 'Researcher');
        updateProjectMemoryStatus('INITIALIZED');
        sendToNodeAndWait('researcher_input', 'Researcher', '__redo__')
          .then(async r => { broadcastAgentResult(r, 'Researcher', false); await continueFromFile('INITIALIZED'); })
          .catch(err => console.error('[Researcher redo action] error:', err));
        break;

      case 'redo_jd_enhancer':
        broadcast({ type: 'agent_message', agent: 'System', text: 'Re-running JD enhancement…' });
        broadcastMode('auto_running', 'JD Enhancer');
        updateProjectMemoryStatus('RESEARCH_COMPLETE');
        sendToNodeAndWait('jd_enhancer_input', 'JD Enhancer')
          .then(async r => { broadcastAgentResult(r, 'JD Enhancer', false); await continueFromFile('RESEARCH_COMPLETE'); })
          .catch(err => console.error('[JD Enhancer redo action] error:', err));
        break;

      case 'research_partial_proceed':
        broadcast({ type: 'agent_message', agent: 'System', text: 'Proceeding with partial research…' });
        updateProjectMemoryStatus('RESEARCH_COMPLETE');
        await handlePipelineStatus('RESEARCH_COMPLETE');
        break;

      case 'accept_anyway': {
        broadcast({ type: 'agent_message', agent: 'System', text: 'Proceeding with current analysis…' });
        updateProjectMemoryStatus('REVIEW_COMPLETE');
        await handlePipelineStatus('REVIEW_COMPLETE');
        break;
      }

      case 'details':
        broadcastMode('auto_running', 'Main Orchestrator');
        sendToNodeAndWait(' Message', 'Main Orchestrator', 'details')
          .then(r => broadcastAgentResult(r, 'Main Orchestrator', true))
          .catch(err => console.error('[MO details action] error:', err));
        break;

      case 'research_retry':
        broadcast({ type: 'agent_message', agent: 'System', text: 'Retrying research…' });
        broadcastMode('auto_running', 'Researcher');
        updateProjectMemoryStatus('INITIALIZED');
        sendToNodeAndWait('researcher_input', 'Researcher', '__redo__')
          .then(async r => { broadcastAgentResult(r, 'Researcher', false); await continueFromFile('INITIALIZED'); })
          .catch(err => console.error('[Researcher retry action] error:', err));
        break;

      case 'research_skip':
        broadcast({ type: 'agent_message', agent: 'System', text: 'Skipping research — continuing with available data…' });
        updateProjectMemoryStatus('RESEARCH_COMPLETE');
        await continueFromFile('INITIALIZED');
        break;

      case 'analysis_retry':
        broadcast({ type: 'agent_message', agent: 'System', text: 'Retrying gap analysis…' });
        broadcastMode('auto_running', 'Analyst');
        updateProjectMemoryStatus('JD_ENHANCED');
        analystDone = false;
        sendToNodeAndWait('analyst_background_input', null, '__analyze__')
          .then(r => { broadcastAgentResult(r, 'Analyst', false); analystDone = true; checkJoin(); })
          .catch(err => console.error('[Analyst retry action] error:', err));
        break;

      case 'analysis_redo_researcher':
        broadcast({ type: 'agent_message', agent: 'System', text: 'Re-running research before retrying analysis…' });
        broadcastMode('auto_running', 'Researcher');
        updateProjectMemoryStatus('INITIALIZED');
        sendToNodeAndWait('researcher_input', 'Researcher', '__redo__')
          .then(async r => { broadcastAgentResult(r, 'Researcher', false); await continueFromFile('INITIALIZED'); })
          .catch(err => console.error('[Researcher for analysis action] error:', err));
        break;

      case 'ac_proceed':
        broadcastMode('auto_running', 'Assembly Coordinator');
        sendToNodeAndWait('assembly_coordinator_input', 'Assembly Coordinator', 'proceed')
          .then(r => broadcastAgentResult(r, 'Assembly Coordinator', true))
          .catch(err => console.error('[AC proceed action] error:', err));
        break;

      case 'ac_redo':
        broadcastMode('auto_running', 'Main Orchestrator');
        sendToNodeAndWait(' Message', 'Main Orchestrator', 'redo')
          .then(r => broadcastAgentResult(r, 'Main Orchestrator', true))
          .catch(err => console.error('[AC redo action] error:', err));
        break;

      case 'ta_yes':
      case 'ta_no': {
        let pStatus = null;
        try {
          const mem = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'project_memory.json'), 'utf8'));
          pStatus = mem?.metadata?.status ?? null;
        } catch {}
        broadcastMode('auto_running', 'Tone Analyst');
        sendToNodeAndWait(' Message', 'Tone Analyst', id === 'ta_yes' ? 'yes' : 'no')
          .then(async r => {
            await continueFromFile(pStatus);
            broadcastAgentResult(r, 'Tone Analyst', !taCompleted);
            if (!taCompleted) injectTAButtons();
          })
          .catch(err => console.error(`[TA ${id} action] error:`, err));
        break;
      }

      case 'ta_redo_research':
        broadcastMode('auto_running', 'Tone Analyst');
        // TA calls set_status("RESEARCH_REDO") internally — server handles researcher dispatch via onChange
        sendToNodeAndWait(' Message', 'Tone Analyst', 'redo')
          .then(r => {
            if (!taCompleted) {
              broadcastAgentResult(r, 'Tone Analyst', true);
              injectTAButtons();
            }
          })
          .catch(err => console.error('[TA redo_research action] error:', err));
        break;

      case 'reviewer_skip':
        broadcastMode('auto_running', 'Reviewer');
        sendToNodeAndWait('reviewer_input', 'Reviewer', 'skip')
          .then(r => { broadcastAgentResult(r, 'Reviewer', true); injectReviewerButtons(); })
          .catch(err => console.error('[Reviewer skip action] error:', err));
        break;

      case 'reviewer_continue':
        broadcastMode('auto_running', 'Reviewer');
        sendToNodeAndWait('reviewer_input', 'Reviewer', 'continue')
          .then(r => { broadcastAgentResult(r, 'Reviewer', true); injectReviewerButtons(); })
          .catch(err => console.error('[Reviewer continue action] error:', err));
        break;

      case 'sn_apply_all':
      case 'sn_pronouns_only':
      case 'sn_custom':
      case 'sn_keep_current': {
        const snMessageMap = {
          sn_apply_all:     'yes',
          sn_pronouns_only: 'no pronouns only',
          sn_custom:        'custom',
          sn_keep_current:  'skip',
        };
        broadcastMode('auto_running', 'Style Negotiator');
        sendToNodeAndWait('style_negotiator_input', 'Style Negotiator', snMessageMap[id])
          .then(r => {
            broadcastAgentResult(r, 'Style Negotiator', !snCompleted);
            if (!snCompleted) injectSNButtons();
          })
          .catch(err => console.error(`[SN ${id} action] error:`, err));
        break;
      }

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
router.get('/status', (_req, res) => {
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
    // ?full=1 clears everything (New button); otherwise preserve uploaded source files (BUG-145)
    const fullClear = req.query.full === '1';
    const PRESERVE = fullClear ? new Set() : new Set(['cv_raw.txt', 'jd_raw.txt', 'cover_letter_sample.txt']);
    try {
      const files = readdirSync(WORKSPACE_DIR);
      for (const f of files) {
        if (!PRESERVE.has(f)) rmSync(join(WORKSPACE_DIR, f), { force: true });
      }
    } catch {}

    // Clear chat history
    try { rmSync(HISTORY_FILE); } catch {}

    analystDone = false;
    taDone = false;

    // Clear pipeline KEMU global vars
    const ALL_PIPELINE_VARS = ['pipeline_status', 'research_confirmed', 'fit_score'];
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
router.post('/abort', async (_req, res) => {
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

router.get('/history', (_req, res) => {
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

// GET /api/debug/vars — dump KEMU global variable values + server-side join state
const DEBUG_VARS = ['pipeline_status', 'AgentSelector', 'research_confirmed', 'fit_score'];
router.get('/debug/vars', async (_req, res) => {
  if (!recipe) return res.status(503).json({ error: 'Recipe not ready' });
  const out = { _server: { analystDone, taDone } };
  for (const v of DEBUG_VARS) {
    try {
      const val = await recipe.globalVariables.getValue(v);
      out[v] = val ?? null;
    } catch {
      out[v] = '(error)';
    }
  }
  console.log('[debug/vars]', JSON.stringify(out, null, 2));
  res.json(out);
});
