import { state } from './state.js';
import { DISPATCH_TIMEOUT_MS, NODE_TIMEOUT_MS } from '../config/constants.js';

// Watchdog (#2): race a node round-trip against a timeout. On timeout, reject with a
// STALL-tagged error so callers can distinguish a hang from a node-not-found error.
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`STALL: ${label} no response after ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function sendToNodeAndWait(nodeName, agentName, query = '__auto__', sessionId = 'default') {
  if (agentName) {
    await state.recipe.globalVariables.setValue('AgentSelector', agentName);
    await new Promise((r) => setTimeout(r, 150));
  }
  state.lastDispatch = { nodeName, agentName, query, sessionId };
  const timeoutMs = NODE_TIMEOUT_MS[nodeName] ?? DISPATCH_TIMEOUT_MS;
  console.log(`▶ TRIGGER(wait) ${agentName ?? '(no agent)'} → node:${nodeName} query:${query} (timeout ${Math.round(timeoutMs / 1000)}s)`);
  try {
    const result = await withTimeout(
      state.recipe.sendToInputWidgetAndWaitForOutput(nodeName, {
        type: state.DataType.JsonObj,
        value: { query, sessionId },
      }),
      timeoutMs,
      agentName ?? nodeName,
    );
    console.log(`✓ OUTPUT(wait) ${agentName} result_len=${JSON.stringify(result)?.length}`);
    return result;
  } catch (err) {
    // A timeout means the node received the message but never produced output — falling back
    // to ' Message' would just hang again. Surface the stall to the caller instead.
    if (err.message?.startsWith('STALL:')) throw err;
    console.log(`▶ TRIGGER(wait) fallback → node:' Message' (${nodeName} not found): ${err.message}`);
    return await withTimeout(
      state.recipe.sendToInputWidgetAndWaitForOutput(' Message', {
        type: state.DataType.JsonObj,
        value: { query, sessionId },
      }),
      timeoutMs,
      agentName ?? ' Message',
    );
  }
}
