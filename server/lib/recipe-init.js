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

  state.recipe.globalVariables.onChange('AgentReasoning', (variable) => {
    const text = serializeVar(variable);
    if (!text) return;
    broadcast({ type: 'reasoning', text });
  });

  state.recipe.globalVariables.onChange('AgentDebug', (variable) => {
    const text = serializeVar(variable);
    if (!text) return;
    broadcast({ type: 'debug_token', chunk: text });
  });

  state.recipe.globalVariables.onChange('AgentSelector', (variable) => {
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
