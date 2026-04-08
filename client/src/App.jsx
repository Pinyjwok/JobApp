import { useState, useCallback, useRef } from 'react';
import { ChatWindow } from './components/ChatWindow';
import { MessageInput } from './components/MessageInput';
import { StatusBar } from './components/StatusBar';
import { AgentTimeline } from './components/AgentTimeline';
import { WorkspaceInspector } from './components/WorkspaceInspector';
import { useStream } from './hooks/useStream';
import './index.css';

export default function App() {
  const [messages, setMessages] = useState([]);
  const [activeAgent, setActiveAgent] = useState(null);
  const [status, setStatus] = useState(null);
  const [sending, setSending] = useState(false);
  const [lastUserMessage, setLastUserMessage] = useState(null);
  const [turns, setTurns] = useState([]);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const [inspectorRefresh, setInspectorRefresh] = useState(0);
  const turnCounterRef = useRef(0);
  const stallTimerRef = useRef(null);

  useStream(
    useCallback((data) => {
      if (data.type === 'stream_token') {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'agent' && last?.streaming) {
            return [
              ...prev.slice(0, -1),
              { ...last, text: last.text + data.chunk, stalled: false },
            ];
          }
          // New streaming message — assign turn number
          const turn = ++turnCounterRef.current;
          // Start stall timer
          clearTimeout(stallTimerRef.current);
          stallTimerRef.current = setTimeout(() => {
            setMessages((p) => {
              const l = p[p.length - 1];
              if (l?.streaming) return [...p.slice(0, -1), { ...l, stalled: true }];
              return p;
            });
          }, 4000);
          return [
            ...prev,
            { role: 'agent', agent: activeAgent, text: data.chunk, streaming: true, turn, reasoning: '' },
          ];
        });
      } else if (data.type === 'stream_done') {
        clearTimeout(stallTimerRef.current);
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.streaming) {
            return [...prev.slice(0, -1), { ...last, streaming: false, stalled: false }];
          }
          return prev;
        });
        setInspectorRefresh((n) => n + 1);
        fetch('/api/status')
          .then((r) => r.json())
          .then((d) => setStatus(d.status))
          .catch(() => {});
      } else if (data.type === 'reasoning_token') {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'agent') {
            return [...prev.slice(0, -1), { ...last, reasoning: (last.reasoning ?? '') + data.chunk }];
          }
          return prev;
        });
      } else if (data.type === 'debug_token') {
        try {
          const debug = JSON.parse(data.chunk);
          if (debug.usage?.cost != null) {
            setTurns((prev) => {
              const idx = [...prev].reverse().findIndex((t) => t.cost == null);
              if (idx === -1) return prev;
              const realIdx = prev.length - 1 - idx;
              const updated = [...prev];
              updated[realIdx] = { ...updated[realIdx], cost: debug.usage.cost };
              return updated;
            });
          }
        } catch { /* non-JSON debug token */ }
      } else if (data.type === 'agent_switch') {
        setActiveAgent(data.agent);
        setTurns((prev) => [...prev, { agent: data.agent, timestamp: Date.now(), cost: null }]);
      }
    }, [activeAgent])
  );

  async function handleSend(text) {
    setLastUserMessage(text);
    setMessages((prev) => [...prev, { role: 'user', text }]);
    setSending(true);
    try {
      await fetch('/api/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'agent', agent: 'System', text: `Error: ${err.message}` },
      ]);
    } finally {
      setSending(false);
    }
  }

  async function handleUpload(name, fileObj) {
    const lower = name.toLowerCase();
    let target;
    if (lower.includes('cover') || lower.includes('cl_') || lower.includes('_cl')) {
      target = 'cover_letter_sample';
    } else if (lower.includes('cv') || lower.includes('resume')) {
      target = 'cv_raw';
    } else if (lower.includes('jd') || lower.includes('job')) {
      target = 'jd_raw';
    } else {
      const choice = prompt(`What is "${name}"? Type "cv", "jd", or "cover":`);
      if (choice?.toLowerCase().startsWith('cv')) target = 'cv_raw';
      else if (choice?.toLowerCase().startsWith('jd')) target = 'jd_raw';
      else if (choice?.toLowerCase().startsWith('cover')) target = 'cover_letter_sample';
      else return;
    }

    try {
      const body = await fileObj.arrayBuffer();
      await fetch(`/api/upload?target=${target}&filename=${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body,
      });
      setMessages((prev) => [
        ...prev,
        { role: 'user', text: `Uploaded ${name} → ${target}.txt` },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'agent', agent: 'System', text: `Upload failed: ${err.message}` },
      ]);
    }
  }

  async function handleAbort() {
    await fetch('/api/abort', { method: 'POST' }).catch(() => {});
    clearTimeout(stallTimerRef.current);
    setSending(false);
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.streaming) return [...prev.slice(0, -1), { ...last, streaming: false, stalled: false }];
      return [...prev, { role: 'agent', agent: 'System', text: '⏹ Processing aborted.' }];
    });
  }

  async function handleReset() {
    if (!confirm('Clear workspace and start a new session?')) return;
    await fetch('/api/reset', { method: 'POST' }).catch(() => {});
    clearTimeout(stallTimerRef.current);
    setMessages([]);
    setStatus(null);
    setActiveAgent('Main Orchestrator');
    setTurns([]);
    setLastUserMessage(null);
    turnCounterRef.current = 0;
  }

  async function handleSetStatus() {
    const s = prompt('Enter new pipeline status:');
    if (!s) return;
    await fetch('/api/dev/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: s }),
    }).catch(() => {});
    setStatus(s);
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-base">
      <div className="px-6 py-4 border-b border-slate-700 flex items-center gap-3">
        <div className="w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse" />
        <h1 className="text-lg font-semibold text-slate-100 flex-1">
          JobApp CV Optimizer
        </h1>
        <button
          onClick={() => setShowInspector((v) => !v)}
          className="text-xs text-slate-400 hover:text-slate-200 border border-slate-600 hover:border-slate-400 rounded-lg px-3 py-1.5 transition-colors"
        >
          Files
        </button>
        <button
          onClick={() => setShowTimeline((v) => !v)}
          className="text-xs text-slate-400 hover:text-slate-200 border border-slate-600 hover:border-slate-400 rounded-lg px-3 py-1.5 transition-colors"
        >
          Timeline
        </button>
        <button
          onClick={handleSetStatus}
          className="text-xs text-slate-400 hover:text-slate-200 border border-slate-600 hover:border-slate-400 rounded-lg px-3 py-1.5 transition-colors"
        >
          Set status
        </button>
        <button
          onClick={handleAbort}
          className="text-xs text-red-400 hover:text-red-300 border border-red-800 hover:border-red-600 rounded-lg px-3 py-1.5 transition-colors"
        >
          Abort
        </button>
        <button
          onClick={handleReset}
          className="text-xs text-slate-400 hover:text-slate-200 border border-slate-600 hover:border-slate-400 rounded-lg px-3 py-1.5 transition-colors"
        >
          New session
        </button>
      </div>

      <StatusBar status={status} activeAgent={activeAgent} />

      <div className="flex flex-1 overflow-hidden">
        <ChatWindow messages={messages} />
        {showTimeline && <AgentTimeline turns={turns} />}
      </div>

      {showInspector && (
        <WorkspaceInspector refresh={inspectorRefresh} onClose={() => setShowInspector(false)} />
      )}

      <MessageInput
        onSend={handleSend}
        onUpload={handleUpload}
        disabled={sending}
        lastUserMessage={lastUserMessage}
      />
    </div>
  );
}
