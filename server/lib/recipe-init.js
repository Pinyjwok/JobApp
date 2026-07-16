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

  // Per-agent reasoning vars — agent identity comes from the var name, not AgentSelector
  const REASONING_VARS = {
    'agentReasoning.mo_reasoning':        'Main Orchestrator',
    'agentReasoning.ps_reasoning':        'ProjectSetup',
    'agentReasoning.extractor_reasoning': 'Extractor',
    'agentReasoning.researcher_reasoning':'Researcher',
    'agentReasoning.jde_reasoning':       'JD Enhancer',
    'agentReasoning.analyst_reasoning':   'Analyst',
    'agentReasoning.reviewer_reasoning':  'Reviewer',
    'agentReasoning.ta_reasoning':        'Tone Analyst',
    'agentReasoning.sn_reasoning':        'Style Negotiator',
    'agentReasoning.pb_reasoning':        'Profile Builder',
    'agentReasoning.sc_reasoning':        'Skills Curator',
    'agentReasoning.hf_reasoning':        'History Formatter',
    'agentReasoning.cf_reasoning':        'Credentials Formatter',
    'agentReasoning.clw_reasoning':       'Cover Letter Writer',
    'agentReasoning.sr_reasoning':        'Style Reviewer',
    'agentReasoning.ic_reasoning':        'Integrity Checker',
    'agentReasoning.df_reasoning':        'Document Formatter',
  };

  for (const [varName, agentName] of Object.entries(REASONING_VARS)) {
    state.recipe.globalVariables.onChange(varName, (variable) => {
      const text = serializeVar(variable);
      if (!text) return;
      console.log(`[reasoning:${agentName}] ${text}`);
      broadcast({ type: 'reasoning', agent: agentName, text });
    });
  }

  // Fallback: KEMU canvas still wired to single AgentReasoning var (pre-per-agent wiring)
  state.recipe.globalVariables.onChange('AgentReasoning', (variable) => {
    const text = serializeVar(variable);
    if (!text) return;
    const agent = state.fallbackAgent ?? 'Unknown';
    console.log(`[reasoning:${agent}] ${text}`);
    broadcast({ type: 'reasoning', agent, text });
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
