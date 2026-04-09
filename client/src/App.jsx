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
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-base">
      {modalState === 'pending' && (
        <StartModal
          hasHistory={historyForModal.length > 0}
          onNew={handleModalNew}
          onResume={handleModalResume}
        />
      )}

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
          onClick={handleAutoContinue}
          className={`text-xs rounded-lg px-3 py-1.5 transition-colors border ${
            autoContinue
              ? 'text-green-300 border-green-700 bg-green-950 hover:border-green-500'
              : 'text-slate-400 border-slate-600 hover:text-slate-200 hover:border-slate-400'
          }`}
          title={autoContinue ? 'Auto-continue ON — click to pause' : 'Auto-continue OFF — click to enable'}
        >
          {autoContinue ? 'Auto ●' : 'Auto'}
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
        <ChatWindow messages={messages} isWaiting={isWaiting} />
        {showTimeline && <AgentTimeline turns={turns} />}
      </div>

      {showInspector && (
        <WorkspaceInspector refresh={inspectorRefresh} onClose={() => setShowInspector(false)} />
      )}

      {bothFilesReady && (
        <div className="px-4 py-2 bg-indigo-950 border-t border-indigo-800 flex items-center justify-between">
          <span className="text-xs text-indigo-300">
            CV and JD uploaded — ready to begin
          </span>
          <button
            onClick={handleBegin}
            disabled={sending}
            className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg px-4 py-1.5 font-medium transition-colors"
          >
            Begin →
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
