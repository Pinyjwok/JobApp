import { state } from './state.js';

export function parseAndStripStatus(text) {
  const match = text?.match(/^pipeline_status:\s*([A-Z_]+)\s*$/m);
  const status = match?.[1] ?? null;
  const cleanText = text?.replace(/\npipeline_status:\s*[A-Z_]+[ \t]*(\n|$)/m, '\n').trim();
  return { status, cleanText: cleanText ?? text };
}

export function broadcast(payload) {
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of state.sseClients) {
    client.write(line);
  }
}

export function broadcastMode(mode, agent = null) {
  console.log(`[broadcastMode] mode=${mode} agent=${agent} clients=${state.sseClients.size}`);
  broadcast({ type: 'pipeline_mode', mode, agent });
}

export function broadcastAgentResult(result, agentName, foreground) {
  const text = typeof result === 'string' ? result
             : result != null             ? JSON.stringify(result)
             : null;
  if (!text) { console.log(`[broadcastAgentResult] ${agentName} — empty result, skipping`); return; }
  console.log(`✓ COMPLETE ${agentName} (${text.length} chars) foreground=${foreground} clients=${state.sseClients.size}`);
  broadcast({ type: 'agent_message', text, agent: agentName, background: !foreground });
  if (foreground) {
    broadcast({ type: 'stream_done' });
    broadcastMode('user_turn', agentName);
  }
}
