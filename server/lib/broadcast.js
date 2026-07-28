import { state } from './state.js';

// Agents never compute dates — they write the literal token `__DATE_TODAY__`
// (and `__DATE_TODAY__T00:00:00Z` for ISO timestamp fields). The server is the
// single source of truth for "today", substituting it just before content
// reaches the frontend. Timezone is intentionally a one-line constant.
const DATE_TZ = 'Australia/Sydney';
export const DATE_TOKEN = '__DATE_TODAY__';

export function todayInAU() {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DATE_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

// Replace every `__DATE_TODAY__` with today's AU date. Safe on any string —
// the token is unique and never appears in legitimate content.
export function substituteDate(str) {
  return typeof str === 'string' ? str.replaceAll(DATE_TOKEN, todayInAU()) : str;
}

export function parseAndStripStatus(text) {
  const match = text?.match(/^pipeline_status:\s*([A-Z_]+)\s*$/m);
  const status = match?.[1] ?? null;
  const cleanText = text?.replace(/\npipeline_status:\s*[A-Z_]+[ \t]*(\n|$)/m, '\n').trim();
  return { status, cleanText: cleanText ?? text };
}

export function broadcast(payload) {
  const line = `data: ${substituteDate(JSON.stringify(payload))}\n\n`;
  for (const client of state.sseClients) {
    client.write(line);
  }
}

export function broadcastMode(mode, agent = null) {
  console.log(`[broadcastMode] mode=${mode} agent=${agent} clients=${state.sseClients.size}`);
  broadcast({ type: 'pipeline_mode', mode, agent });
}

// Assembly worker agents are specified to open their bubble with a markdown section header
// ("## …" then later "# ✓ … Complete"). Some models — even Sonnet — still leak a chatty preamble or a
// "Reasoning (internal):" block before it despite the output-discipline instruction. Drop everything
// before the first header so the user only sees the finished section. Errors (no header) pass through.
const ASSEMBLY_AGENTS = new Set([
  'Style Negotiator', 'Profile Builder', 'Skills Curator', 'History Formatter',
  'Credentials Formatter', 'CoverLetter Writer', 'Style Reviewer', 'Integrity Checker',
]);
function stripAssemblyPreamble(text) {
  const m = text.match(/^#{1,2}\s+\S/m);
  return (m && m.index > 0) ? text.slice(m.index).trim() : text;
}

export function broadcastAgentResult(result, agentName, foreground) {
  let text = typeof result === 'string' ? result
           : result != null             ? JSON.stringify(result)
           : null;
  if (!text) { console.log(`[broadcastAgentResult] ${agentName} — empty result, skipping`); return; }
  if (ASSEMBLY_AGENTS.has(agentName)) text = stripAssemblyPreamble(text);
  console.log(`✓ COMPLETE ${agentName} (${text.length} chars) foreground=${foreground} clients=${state.sseClients.size}`);
  broadcast({ type: 'agent_message', text, agent: agentName, background: !foreground });
  if (foreground) {
    broadcast({ type: 'stream_done' });
    broadcastMode('user_turn', agentName);
  }
}
