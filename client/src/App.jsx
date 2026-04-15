import { useState, useCallback, useRef, useEffect } from 'react';
import { ChatWindow } from './components/ChatWindow';
import { MessageInput } from './components/MessageInput';
import { StatusBar } from './components/StatusBar';
import { AgentTimeline } from './components/AgentTimeline';
import { WorkspaceInspector } from './components/WorkspaceInspector';
import { StartModal } from './components/StartModal';
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
  const [autoContinue, setAutoContinue] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState({});
  const [modalState, setModalState] = useState(null);
  const [historyForModal, setHistoryForModal] = useState([]);
  // pending reasoning — attached to next agent_message that arrives
  const pendingReasoningRef = useRef('');

  // Load persisted chat history on mount, then decide what modal to show
  useEffect(() => {
    fetch('/api/history')
      .then((r) => r.json())
      .then((saved) => {
        setHistoryForModal(saved);
        setModalState('pending'); // show modal now that we know whether history exists
      })
      .catch(() => {
        setModalState('pending');
      });
  }, []);

  function saveHistory(msgs) {
    // eslint-disable-next-line no-unused-vars
    const clean = msgs.map(({ streaming, stalled, ...m }) => m);
    fetch('/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(clean),
    }).catch(() => {});
  }

  const WELCOME_MESSAGE = {
    role: 'agent',
    agent: 'JobApp',
    text: `# Welcome to Your Job Application Assistant

I'll help you create tailored application materials in 3 steps:

**1. Analysis** (automated)
   - Extract data from your CV and job description
   - Research the company deeply
   - Analyse your fit with detailed gap analysis

**2. Style Optimisation** (brief discussion)
   - Understand your writing preferences

**3. CV Assembly** (interactive)
   - Build each CV section with your approval
   - Write tailored cover letter
   - Verify accuracy and consistency

---

Upload your CV/resume and job description using the upload button below.`,
  };

  async function handleModalNew() {
    await fetch('/api/reset', { method: 'POST' }).catch(() => {});
    setStatus(null);
    setActiveAgent('ProjectSetup');
    setTurns([{ agent: 'ProjectSetup', timestamp: Date.now(), cost: null }]);
    setLastUserMessage(null);
    setUploadedFiles({});
    const initial = [WELCOME_MESSAGE];
    setMessages(initial);
    saveHistory(initial);
    setModalState('hidden');
  }

  function handleModalResume() {
    setMessages(historyForModal);
    setModalState('hidden');
    fetch('/api/status')
      .then((r) => r.json())
      .then((d) => setStatus(d.status))
      .catch(() => {});
  }

  useStream(
    useCallback((data) => {
      if (data.type === 'agent_message') {
        setIsWaiting(false);
        const reasoning = pendingReasoningRef.current;
        pendingReasoningRef.current = '';
        setMessages((prev) => {
          const next = [...prev, { role: 'agent', agent: activeAgent, text: data.text, reasoning }];
          saveHistory(next);
          return next;
        });
        setInspectorRefresh((n) => n + 1);
        fetch('/api/status')
          .then((r) => r.json())
          .then((d) => setStatus(d.status))
          .catch(() => {});
      } else if (data.type === 'reasoning') {
        pendingReasoningRef.current = data.text;
      } else if (data.type === 'stream_done') {
        // stream_done still fires — used for auto-continue signalling only
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
        setTurns((prev) => {
          const last = prev[prev.length - 1];
          if (last?.agent === data.agent && Date.now() - last.timestamp < 2000) return prev;
          return [...prev, { agent: data.agent, timestamp: Date.now(), cost: null }];
        });
      } else if (data.type === 'auto_continue_changed') {
        setAutoContinue(data.enabled);
      } else if (data.type === 'auto_continue_paused') {
        setAutoContinue(false);
      }
    }, [activeAgent])
  );

  async function handleSend(text) {
    setLastUserMessage(text);
    setMessages((prev) => {
      const next = [...prev, { role: 'user', text }];
      saveHistory(next);
      return next;
    });
    setSending(true);
    setIsWaiting(true);
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

  async function handleUpload(name, fileObj, forcedTarget = null) {
    let target;
    if (forcedTarget) {
      target = forcedTarget;
    } else {
      const lower = name.toLowerCase();
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
      setUploadedFiles((prev) => ({ ...prev, [target]: name }));
      if (target === 'cover_letter_sample' && activeAgent === 'Tone Analyst') {
        await handleSend('Cover letter uploaded — please proceed with the analysis.');
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'agent', agent: 'System', text: `Upload failed: ${err.message}` },
      ]);
    }
  }

  async function handleBegin() {
    setUploadedFiles({});
    const msg = `Files are saved to disk as cv_raw.txt and jd_raw.txt. Please initialise the project.`;
    await handleSend(msg);
  }

  async function handleAbort() {
    await fetch('/api/abort', { method: 'POST' }).catch(() => {});
    setSending(false);
    setIsWaiting(false);
    setMessages((prev) => [...prev, { role: 'agent', agent: 'System', text: '⏹ Processing aborted.' }]);
  }

  async function handleAutoContinue() {
    const next = !autoContinue;
    await fetch('/api/auto-continue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    }).catch(() => {});
    setAutoContinue(next);
  }

  async function handleReset() {
    if (!confirm('Clear workspace and start a new session?')) return;
    await fetch('/api/reset', { method: 'POST' }).catch(() => {});
    setMessages([]);
    setStatus(null);
    setActiveAgent('Main Orchestrator');
    setTurns([]);
    setLastUserMessage(null);
    setUploadedFiles({});
    // Re-show modal so user can explicitly start fresh
    setHistoryForModal([]);
    setModalState('pending');
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

  const bothFilesReady = uploadedFiles.cv_raw && uploadedFiles.jd_raw;

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0a0c10] text-base">
      {modalState === 'pending' && (
        <StartModal
          hasHistory={historyForModal.length > 0}
          onNew={handleModalNew}
          onResume={handleModalResume}
        />
      )}

      {/* Header */}
      <div className="px-5 py-3 border-b border-slate-800 flex items-center gap-3 bg-slate-900/40 backdrop-blur-sm">
        <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/30 animate-pulse" />
        <h1 className="text-sm font-semibold text-slate-200 flex-1 tracking-tight">
          JobApp
        </h1>

        {/* View toggles */}
        <div className="flex items-center gap-1 bg-slate-800/40 rounded-lg p-0.5 border border-slate-700/30">
          <button
            onClick={() => setShowInspector((v) => !v)}
            className={`text-[10px] rounded-md px-2.5 py-1 transition-all ${
              showInspector ? 'bg-slate-700/60 text-slate-200' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Files
          </button>
          <button
            onClick={() => setShowTimeline((v) => !v)}
            className={`text-[10px] rounded-md px-2.5 py-1 transition-all ${
              showTimeline ? 'bg-slate-700/60 text-slate-200' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Timeline
          </button>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleAutoContinue}
            className={`text-[10px] rounded-lg px-2.5 py-1.5 transition-all border ${
              autoContinue
                ? 'text-emerald-300 border-emerald-700/50 bg-emerald-950/40'
                : 'text-slate-500 border-slate-700/30 hover:text-slate-300 hover:border-slate-600'
            }`}
            title={autoContinue ? 'Auto-continue ON' : 'Auto-continue OFF'}
          >
            {autoContinue ? 'Auto ON' : 'Auto'}
          </button>
          <button
            onClick={handleSetStatus}
            className="text-[10px] text-slate-500 hover:text-slate-300 border border-slate-700/30 hover:border-slate-600 rounded-lg px-2.5 py-1.5 transition-all"
          >
            Status
          </button>
          <button
            onClick={handleAbort}
            className="text-[10px] text-red-400/70 hover:text-red-300 border border-red-900/30 hover:border-red-700/50 rounded-lg px-2.5 py-1.5 transition-all"
          >
            Abort
          </button>
          <button
            onClick={handleReset}
            className="text-[10px] text-slate-500 hover:text-slate-300 border border-slate-700/30 hover:border-slate-600 rounded-lg px-2.5 py-1.5 transition-all"
          >
            New
          </button>
        </div>
      </div>

      <StatusBar status={status} activeAgent={activeAgent} />

      <div className="flex flex-1 overflow-hidden">
        <ChatWindow messages={messages} isWaiting={isWaiting} />
        {showTimeline && <AgentTimeline turns={turns} />}
      </div>

      {showInspector && (
        <WorkspaceInspector refresh={inspectorRefresh} onClose={() => setShowInspector(false)} />
      )}

      {bothFilesReady && (
        <div className="px-5 py-2.5 bg-gradient-to-r from-violet-950/40 to-indigo-950/40 border-t border-violet-800/30 flex items-center justify-between shimmer-bg">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-violet-300/80">
              CV and JD uploaded
            </span>
          </div>
          <button
            onClick={handleBegin}
            disabled={sending}
            className="text-xs bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-40 text-white rounded-lg px-4 py-1.5 font-medium transition-all shadow-lg shadow-violet-600/10 active:scale-95"
          >
            Begin
          </button>
        </div>
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
