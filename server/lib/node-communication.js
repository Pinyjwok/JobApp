import { state } from './state.js';
import { DISPATCH_TIMEOUT_MS, NODE_TIMEOUT_MS } from '../config/constants.js';

// Log separators so each agent's execution block stands apart in the server console.
// Every agent dispatch flows through sendToNodeAndWait, so this is the one place a
// banner reliably brackets "this agent is running" — the interleaved [Stage · …] lines
// from dispatch.js then sit visibly under a named header.
const RULE = '─'.repeat(72);
function banner(agent, nodeName, query, timeoutMs) {
  const q = query === '__auto__' ? '' : `  ·  query:${query}`;
  console.log(`\n┌${RULE}`);
  console.log(`│ ▶ ${agent ?? '(no agent)'}  ·  node:${nodeName}${q}  ·  timeout ${Math.round(timeoutMs / 1000)}s`);
  console.log(`└${RULE}`);
}
function footer(agent, ok, detail, startedAt) {
  const mark = ok ? '✓' : '✗';
  console.log(`${mark} ${agent ?? '(no agent)'}  ·  ${detail}  ·  ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`);
}

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
  const startedAt = Date.now();
  banner(agentName, nodeName, query, timeoutMs);
  try {
    const result = await withTimeout(
      state.recipe.sendToInputWidgetAndWaitForOutput(nodeName, {
        type: state.DataType.JsonObj,
        value: { query, sessionId },
      }),
      timeoutMs,
      agentName ?? nodeName,
    );
    footer(agentName, true, `${JSON.stringify(result)?.length ?? 0} chars`, startedAt);
    return result;
  } catch (err) {
    // A timeout means the node received the message but never produced output — falling back
    // to ' Message' would just hang again. Surface the stall to the caller instead.
    if (err.message?.startsWith('STALL:')) { footer(agentName, false, err.message, startedAt); throw err; }
    console.log(`  ↳ fallback → node:' Message' (${nodeName} not found): ${err.message}`);
    const fallback = await withTimeout(
      state.recipe.sendToInputWidgetAndWaitForOutput(' Message', {
        type: state.DataType.JsonObj,
        value: { query, sessionId },
      }),
      timeoutMs,
      agentName ?? ' Message',
    );
    footer(agentName, true, `${JSON.stringify(fallback)?.length ?? 0} chars (fallback)`, startedAt);
    return fallback;
  }
}
