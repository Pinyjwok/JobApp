import { state } from './state.js';

export async function sendToNodeAndWait(nodeName, agentName, query = '__auto__', sessionId = 'default') {
  if (agentName) {
    await state.recipe.globalVariables.setValue('AgentSelector', agentName);
    await new Promise((r) => setTimeout(r, 150));
  }
  console.log(`▶ TRIGGER(wait) ${agentName ?? '(no agent)'} → node:${nodeName} query:${query}`);
  try {
    const result = await state.recipe.sendToInputWidgetAndWaitForOutput(nodeName, {
      type: state.DataType.JsonObj,
      value: { query, sessionId },
    });
    console.log(`✓ OUTPUT(wait) ${agentName} result_len=${JSON.stringify(result)?.length}`);
    return result;
  } catch (err) {
    console.log(`▶ TRIGGER(wait) fallback → node:' Message' (${nodeName} not found): ${err.message}`);
    return await state.recipe.sendToInputWidgetAndWaitForOutput(' Message', {
      type: state.DataType.JsonObj,
      value: { query, sessionId },
    });
  }
}
