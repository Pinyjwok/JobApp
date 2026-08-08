import { join } from 'path';
import { state } from './state.js';
import { broadcast } from './broadcast.js';
import { handlePipelineStatus } from './pipeline-state.js';

function serializeVar(variable) {
  return typeof variable.lastValue === 'string'
    ? variable.lastValue
    : JSON.stringify(variable.lastValue);
}

export async function initRecipe(projectDir) {
  if (state.recipe) return;
  const recipePath = join(projectDir, 'recipe');

  const runtimePath = join(recipePath, 'node_modules', '@kemu-io', 'edge-runtime', 'runner.js');
  const runtimeUrl  = new URL(`file://${runtimePath}`).href;
  const edgeModule  = await import(runtimeUrl);

  const kemuEdge   = edgeModule.default;
  state.DataType   = edgeModule.DataType;

  process.chdir(recipePath);
  state.recipe = await kemuEdge.start();

  try {
    await state.recipe.globalVariables.setValue('AgentSelector', 'Main Orchestrator');
    console.log('AgentSelector → Main Orchestrator');
  } catch (err) {
    console.warn('Could not reset AgentSelector:', err.message);
  }

  // Per-agent reasoning vars — agent identity comes from the var name, not AgentSelector.
  // Name prefix must match the KEMU canvas group name exactly: "Agent Reasoning." (capitalized,
  // with a space) — NOT the camelCase "agentReasoning." this previously used, which silently
  // never matched any real variable (onChange on a name that doesn't exist just never fires,
  // no error), so this whole reasoning stream — server log AND the client's "Show reasoning"
  // panel — has been dead since it was added.
  const REASONING_VARS = {
    'Agent Reasoning.mo_reasoning':        'Main Orchestrator',
    'Agent Reasoning.ps_reasoning':        'ProjectSetup',
    'Agent Reasoning.extractor_reasoning': 'Extractor',
    'Agent Reasoning.researcher_reasoning':'Researcher',
    'Agent Reasoning.jde_reasoning':       'JD Enhancer',
    'Agent Reasoning.analyst_reasoning':   'Analyst',
    'Agent Reasoning.reviewer_reasoning':  'Reviewer',
    'Agent Reasoning.ta_reasoning':        'Tone Analyst',
    'Agent Reasoning.sn_reasoning':        'Style Negotiator',
    'Agent Reasoning.pb_reasoning':        'Profile Builder',
    'Agent Reasoning.sc_reasoning':        'Skills Curator',
    'Agent Reasoning.hf_reasoning':        'History Formatter',
    'Agent Reasoning.cf_reasoning':        'Credentials Formatter',
    'Agent Reasoning.clw_reasoning':       'Cover Letter Writer',
    'Agent Reasoning.sr_reasoning':        'Style Reviewer',
    'Agent Reasoning.ic_reasoning':        'Integrity Checker',
  };

  // Reasoning vars are wired to the model's stream port — they fire on every token/chunk, not
  // once per turn. Logging/broadcasting each change floods the console log with near-duplicate
  // lines for one turn's reasoning. Debounce per var: only emit once a var has gone quiet for
  // REASONING_DEBOUNCE_MS, with the latest (fullest) accumulated text.
  const REASONING_DEBOUNCE_MS = 5000;
  const reasoningTimers = new Map(); // varName -> timeout handle

  function scheduleReasoningFlush(varName, agentName, text) {
    clearTimeout(reasoningTimers.get(varName));
    reasoningTimers.set(varName, setTimeout(() => {
      reasoningTimers.delete(varName);
      console.log(`[reasoning:${agentName}] ${text}`);
      broadcast({ type: 'reasoning', agent: agentName, text });
    }, REASONING_DEBOUNCE_MS));
  }

  for (const [varName, agentName] of Object.entries(REASONING_VARS)) {
    state.recipe.globalVariables.onChange(varName, (variable) => {
      const text = serializeVar(variable);
      if (!text) return;
      scheduleReasoningFlush(varName, agentName, text);
    });
  }

  // Fallback: KEMU canvas still wired to single AgentReasoning var (pre-per-agent wiring)
  state.recipe.globalVariables.onChange('AgentReasoning', (variable) => {
    const text = serializeVar(variable);
    if (!text) return;
    const agent = state.fallbackAgent ?? 'Unknown';
    scheduleReasoningFlush('AgentReasoning', agent, text);
  });

  state.recipe.globalVariables.onChange('AgentDebug', (variable) => {
    const text = serializeVar(variable);
    if (!text) return;
    console.log(`[debug:${state.fallbackAgent}]`, text);
    broadcast({ type: 'debug_token', chunk: text });
  });

  state.recipe.globalVariables.onChange('AgentSelector', (variable) => {
    // The KEMU recipe spuriously re-selects ProjectSetup while an assembly section node runs (its
    // canvas default leaks through). Assembly is driven server-side via dispatchAssemblyPhase, NOT
    // AgentSelector, so this only corrupts fallbackAgent and flashes "Setup" in the timeline. Legit
    // ProjectSetup selection only happens at reset/new-session, when currentAssemblyPhase is 0.
    if (variable.lastValue === 'ProjectSetup' && state.currentAssemblyPhase > 0) {
      console.log(`▶ AGENT    ProjectSetup (ignored — assembly phase ${state.currentAssemblyPhase} active)`);
      return;
    }
    state.fallbackAgent = variable.lastValue;
    console.log(`▶ AGENT    ${state.fallbackAgent} (clients=${state.sseClients.size})`);
    broadcast({ type: 'agent_switch', agent: state.fallbackAgent });
  });

  state.recipe.globalVariables.onChange('pipeline_status', async (variable) => {
    await handlePipelineStatus(variable.lastValue);
  });

  // Resume after server restart: onChange only fires on *change* — re-fire existing status on cold start.
  try {
    const rawStatus    = await state.recipe.globalVariables.getValue('pipeline_status');
    const currentStatus = typeof rawStatus === 'string' ? rawStatus : rawStatus?.lastValue ?? null;
    if (currentStatus) {
      console.log(`[resume] pipeline_status already = ${currentStatus} — re-firing handler`);
      state.pipelineStatus = currentStatus;
      await handlePipelineStatus(currentStatus, { resume: true });
    }
  } catch (err) {
    console.warn('[resume] could not read pipeline_status:', err.message);
  }
}
