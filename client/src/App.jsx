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
  const [isWaiting, setIsWaiting] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState({});
  const [modalState, setModalState] = useState(null);
  const [modalUploading, setModalUploading] = useState(false);
  const [historyForModal, setHistoryForModal] = useState([]);
  const [pipelineMode, setPipelineMode] = useState('user_turn');
  const [runningAgent, setRunningAgent] = useState(null);

  const pendingReasoningRef = useRef('');
  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    fetch('/api/history')
      .then((r) => r.json())
      .then((saved) => {
        setHistoryForModal(saved);
        setModalState('pending');
      })
      .catch(() => setModalState('pending'));
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

**2. Style Optimisation** (discussion)
   - Understand your writing preferences and ideal tone

**3. CV Assembly** (interactive)
   - Build each CV section with your approval
   - Write tailored cover letter
   - Verify accuracy and consistency

Setting up your analysis — this takes about a minute.`,
  };

  async function handleModalStart(cvFile, jdFile) {
    setModalUploading(true);

    await fetch('/api/reset', { method: 'POST' }).catch(() => {});

    const uploadFile = async (file, target) => {
      const body = await file.arrayBuffer();
      await fetch(`/api/upload?target=${target}&filename=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body,
      });
    };
    await uploadFile(cvFile, 'cv_raw');
    await uploadFile(jdFile, 'jd_raw');

    setStatus(null);
    setActiveAgent('ProjectSetup');
    setTurns([{ agent: 'ProjectSetup', timestamp: Date.now(), cost: null }]);
    setLastUserMessage(null);
    setUploadedFiles({ cv_raw: cvFile.name, jd_raw: jdFile.name });
    setPipelineMode('user_turn');
    const initial = [WELCOME_MESSAGE];
    setMessages(initial);
    saveHistory(initial);
    setModalUploading(false);
    setModalState('hidden');

    await handleSend('Files are saved to disk as cv_raw.txt and jd_raw.txt. Please initialise the project.');
  }

  function handleModalResume() {
    setMessages(historyForModal);
    setModalState('hidden');
    fetch('/api/status')
      .then((r) => r.json())
      .then((d) => {
        if (d.status) setStatus(d.status);
      })
      .catch(() => {});
  }

  async function handleAction(id) {
    // Mark the action message as used
    setMessages(prev => prev.map(m =>
      m.role === 'actions' && !m.used ? { ...m, used: true } : m
    ));
    try {
      await fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
    } catch (err) {
      setMessages(prev => [...prev, { role: 'agent', agent: 'System', text: `Action failed: ${err.message}` }]);
    }
  }

  useStream(
    useCallback((data) => {
      lastActivityRef.current = Date.now();
      if (data.type === 'agent_message') {
        setIsWaiting(false);
        const reasoning = pendingReasoningRef.current;
        pendingReasoningRef.current = '';
        setMessages((prev) => {
          const next = [...prev, {
            role: 'agent',
            agent: data.agent ?? activeAgent,
            text: data.text,
            reasoning,
            background: data.background ?? false,
          }];
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
      } else if (data.type === 'action_required') {
        setMessages((prev) => {
          const next = [...prev, {
            role: 'actions',
            context: data.context,
            prompt: data.prompt,
            actions: data.actions,
            used: false,
          }];
          saveHistory(next);
          return next;
        });
      } else if (data.type === 'pipeline_mode') {
        setPipelineMode(data.mode);
        if (data.agent) setRunningAgent(data.agent);
        if (data.mode === 'user_turn') setIsWaiting(false);
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
      } else if (data.type === 'status_changed') {
        setStatus(data.status);
      } else if (data.type === 'stream_done') {
        setIsWaiting(false);
        setPipelineMode('user_turn');
      }
    }, [activeAgent])
  );

  useEffect(() => {
    const id = setInterval(() => {
      if (pipelineMode !== 'auto_running') return;
      if (Date.now() - lastActivityRef.current <= 45_000) return;
      fetch('/api/status')
        .then((r) => r.json())
        .then((d) => {
          const interactiveStatuses = new Set([
            'GAP_INTERVIEW', 'REVIEW_COMPLETE', 'STYLE_NEGOTIATING',
            'CV_BUILDING', 'PARALLEL_ANALYSIS',
          ]);
          if (d.status && interactiveStatuses.has(d.status)) {
            setIsWaiting(false);
            setPipelineMode('user_turn');
            setMessages((prev) => [...prev, {
              role: 'agent', agent: 'System',
              text: 'Agent may be ready — pipeline is active. Type to continue or click Abort.',
            }]);
          }
          lastActivityRef.current = Date.now();
        })
        .catch(() => {});
    }, 15_000);
    return () => clearInterval(id);
  }, [pipelineMode]);

  async function handleSend(text) {
    setLastUserMessage(text);
    setMessages((prev) => {
      const next = [...prev, { role: 'user', text }];
      saveHistory(next);
      return next;
    });
    setSending(true);
    setIsWaiting(true);
    setPipelineMode('auto_running');
    try {
      await fetch('/api/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'agent', agent: 'System', text: `Error: ${err.message}` }]);
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
      setMessages((prev) => [...prev, { role: 'user', text: `Uploaded ${name} → ${target}.txt` }]);
      setUploadedFiles((prev) => ({ ...prev, [target]: name }));
      if (target === 'cover_letter_sample' && activeAgent === 'Tone Analyst') {
        await handleSend('Cover letter uploaded — please proceed with the analysis.');
      }
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'agent', agent: 'System', text: `Upload failed: ${err.message}` }]);
    }
  }

  async function handleAbort() {
    await fetch('/api/abort', { method: 'POST' }).catch(() => {});
    setSending(false);
    setIsWaiting(false);
    setPipelineMode('user_turn');
    setMessages((prev) => [...prev, { role: 'agent', agent: 'System', text: '⏹ Processing aborted.' }]);
  }

  async function handleReset() {
    if (!confirm('Clear workspace and start a new session?')) return;
    await fetch('/api/reset?full=1', { method: 'POST' }).catch(() => {});
    setMessages([]);
    setStatus(null);
    setActiveAgent('Main Orchestrator');
    setTurns([]);
    setLastUserMessage(null);
    setUploadedFiles({});
    setPipelineMode('user_turn');
    setModalUploading(false);
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

  const inputDisabled = pipelineMode !== 'user_turn' || sending;

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0a0c10] text-base">
      {modalState === 'pending' && (
        <StartModal
          hasHistory={historyForModal.length > 0}
          onStart={handleModalStart}
          onResume={handleModalResume}
          uploading={modalUploading}
        />
      )}

      {/* Header */}
      <div className="px-5 py-3 border-b border-slate-800 flex items-center gap-3 bg-slate-900/40 backdrop-blur-sm">
        <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/30 animate-pulse" />
        <h1 className="text-sm font-semibold text-slate-200 flex-1 tracking-tight">JobApp</h1>

        <div className="flex items-center gap-1 bg-slate-800/40 rounded-lg p-0.5 border border-slate-700/30">
          <button
            onClick={() => setShowInspector((v) => !v)}
            className={`text-[10px] rounded-md px-2.5 py-1 transition-all ${showInspector ? 'bg-slate-700/60 text-slate-200' : 'text-slate-500 hover:text-slate-300'}`}
          >
            Files
          </button>
          <button
            onClick={() => setShowTimeline((v) => !v)}
            className={`text-[10px] rounded-md px-2.5 py-1 transition-all ${showTimeline ? 'bg-slate-700/60 text-slate-200' : 'text-slate-500 hover:text-slate-300'}`}
          >
            Timeline
          </button>
        </div>

        <div className="flex items-center gap-1.5">
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
        <ChatWindow messages={messages} isWaiting={isWaiting || pipelineMode === 'auto_running'} onAction={handleAction} />
        {showTimeline && <AgentTimeline turns={turns} />}
      </div>

      {showInspector && (
        <WorkspaceInspector refresh={inspectorRefresh} onClose={() => setShowInspector(false)} />
      )}

      <MessageInput
        onSend={handleSend}
        onUpload={handleUpload}
        disabled={inputDisabled}
        pipelineMode={pipelineMode}
        runningAgent={runningAgent}
        lastUserMessage={lastUserMessage}
      />
    </div>
  );
}
