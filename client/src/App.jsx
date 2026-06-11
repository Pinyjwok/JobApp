import { useState, useCallback, useRef, useEffect } from 'react';
import { ChatWindow } from './components/ChatWindow';
import { MessageInput } from './components/MessageInput';
import { StatusBar } from './components/StatusBar';
import { AgentTimeline } from './components/AgentTimeline';
import { WorkspaceInspector } from './components/WorkspaceInspector';
import { StartModal } from './components/StartModal';
import { GapInterviewModal } from './components/GapInterviewModal';
import { StyleInterviewModal } from './components/StyleInterviewModal';
import { useStream } from './hooks/useStream';
import { useTheme } from './theme';
import './index.css';

// Pipeline statuses the dev "Status" override can jump to.
// Happy-path order first, then exception/failure states.
const PIPELINE_STATUSES = [
  { value: 'FILES_SAVED',       group: 'pipeline' },
  { value: 'INITIALIZED',       group: 'pipeline' },
  { value: 'RESEARCH_COMPLETE', group: 'pipeline' },
  { value: 'RESEARCH_CONFIRM',  group: 'pipeline' },
  { value: 'JD_ENHANCED',       group: 'pipeline' },
  { value: 'PARALLEL_ANALYSIS', group: 'pipeline' },
  { value: 'ANALYSIS_COMPLETE', group: 'pipeline' },
  { value: 'GAP_INTERVIEW',     group: 'pipeline' },
  { value: 'REVIEW_COMPLETE',   group: 'pipeline' },
  { value: 'STYLE_NEGOTIATING', group: 'pipeline' },
  { value: 'TONE_ANALYZED',     group: 'pipeline' },
  { value: 'CV_BUILDING',       group: 'pipeline' },
  { value: 'CV_TAILORED',       group: 'pipeline' },
  { value: 'RESEARCH_PARTIAL',  group: 'exception' },
  { value: 'EXTRACTION_FAILED', group: 'exception' },
  { value: 'RESEARCH_FAILED',   group: 'exception' },
  { value: 'ANALYSIS_FAILED',   group: 'exception' },
  { value: 'REVIEW_FAILED',     group: 'exception' },
  { value: 'STYLE_FAILED',      group: 'exception' },
  { value: 'INTEGRITY_FAILED',  group: 'exception' },
];

function ThemeToggle({ theme, onToggle }) {
  return (
    <button
      onClick={onToggle}
      title="Toggle theme"
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-pressed={theme === 'dark'}
      className="grid place-items-center w-[34px] h-[30px] rounded-lg border border-line text-fg-secondary hover:text-fg hover:border-line-strong transition-all"
    >
      {theme === 'dark' ? (
        <svg className="w-[15px] h-[15px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg className="w-[15px] h-[15px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
        </svg>
      )}
    </button>
  );
}

export default function App() {
  const { theme, toggle } = useTheme();
  const [messages, setMessages] = useState([]);
  const [activeAgent, setActiveAgent] = useState(null);
  const [status, setStatus] = useState(null);
  const [sending, setSending] = useState(false);
  const [lastUserMessage, setLastUserMessage] = useState(null);
  const [turns, setTurns] = useState([]);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const [inspectorRefresh, setInspectorRefresh] = useState(0);
  const [isWaiting, _setIsWaiting] = useState(false);
  const setIsWaiting = (v) => { isWaitingRef.current = v; _setIsWaiting(v); };
  const [uploadedFiles, setUploadedFiles] = useState({});
  const [modalState, setModalState] = useState(null);
  const [modalUploading, setModalUploading] = useState(false);
  const [historyForModal, setHistoryForModal] = useState([]);
  const [pipelineMode, setPipelineMode] = useState('user_turn');
  const [runningAgent, setRunningAgent] = useState(null);
  const [gapQuestions, setGapQuestions] = useState([]);
  const [showGapModal, setShowGapModal] = useState(false);
  const [gapMinimized, setGapMinimized] = useState(false);
  const [styleGroups, setStyleGroups] = useState([]);
  const [showStyleModal, setShowStyleModal] = useState(false);
  const [styleMinimized, setStyleMinimized] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);

  const pendingReasoningRef = useRef('');
  const lastActivityRef = useRef(Date.now());
  const isWaitingRef = useRef(false);

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
    text: `Got your documents — thanks. I'm starting on the analysis now, which takes about a minute. I'll walk you through each step and check in with you along the way.`,
  };

  async function handleModalStart(cvFile, jdFile, clFile = null) {
    setModalUploading(true);

    // Full clear: a new session must not inherit ANY prior files — including a stale
    // cover_letter_sample.txt, which would otherwise survive and bleed into the run.
    await fetch('/api/reset?full=1', { method: 'POST' }).catch(() => {});

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
    if (clFile) await uploadFile(clFile, 'cover_letter_sample');

    setStatus(null);
    setActiveAgent('ProjectSetup');
    setTurns([{ agent: 'ProjectSetup', timestamp: Date.now(), cost: null }]);
    setLastUserMessage(null);
    setUploadedFiles({ cv_raw: cvFile.name, jd_raw: jdFile.name, ...(clFile ? { cover_letter_sample: clFile.name } : {}) });
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

  async function handleGapSubmit(answers) {
    setShowGapModal(false);
    setGapMinimized(false);
    try {
      await fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'gap_answers_submit', answers }),
      });
    } catch (err) {
      setMessages(prev => [...prev, { role: 'agent', agent: 'System', text: `Gap submit failed: ${err.message}` }]);
    }
  }

  async function handleStyleSubmit(answers) {
    setShowStyleModal(false);
    setStyleMinimized(false);
    try {
      await fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'style_answers_submit', answers }),
      });
    } catch (err) {
      setMessages(prev => [...prev, { role: 'agent', agent: 'System', text: `Style submit failed: ${err.message}` }]);
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
      } else if (data.type === 'gap_interview_start') {
        setGapQuestions(data.gaps ?? []);
        setShowGapModal(true);
        setGapMinimized(false);
      } else if (data.type === 'style_interview_start') {
        setStyleGroups(data.groups ?? []);
        setShowStyleModal(true);
        setStyleMinimized(false);
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
            'REVIEW_COMPLETE', 'STYLE_NEGOTIATING',
            'CV_BUILDING', 'PARALLEL_ANALYSIS',
          ]);
          if (d.status && interactiveStatuses.has(d.status) && !isWaitingRef.current) {
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
      if (target === 'cover_letter_sample') {
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

  async function handleSetStatus(s) {
    if (!s) return;
    setShowStatusMenu(false);
    await fetch('/api/dev/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: s }),
    }).catch(() => {});
    setStatus(s);
  }

  const inputDisabled = pipelineMode !== 'user_turn' || sending || showGapModal || showStyleModal;

  return (
    <div className="flex flex-col h-screen w-screen bg-app text-base">
      {modalState === 'pending' && (
        <StartModal
          hasHistory={historyForModal.length > 0}
          onStart={handleModalStart}
          onResume={handleModalResume}
          uploading={modalUploading}
        />
      )}
      {showGapModal && (
        <GapInterviewModal
          gaps={gapQuestions}
          onSubmit={handleGapSubmit}
          onHide={() => setGapMinimized(true)}
          minimized={gapMinimized}
        />
      )}
      {showGapModal && gapMinimized && (
        <button
          onClick={() => setGapMinimized(false)}
          className="animate-fade-in-up fixed bottom-24 right-6 z-40 flex items-center gap-2 rounded-full bg-accent hover:brightness-110 text-accent-fg text-sm font-medium px-4 py-2.5 shadow-lg transition-all active:scale-95"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-accent-fg/80 animate-pulse" />
          Continue gap interview
        </button>
      )}
      {showStyleModal && (
        <StyleInterviewModal
          groups={styleGroups}
          onSubmit={handleStyleSubmit}
          onHide={() => setStyleMinimized(true)}
          minimized={styleMinimized}
        />
      )}
      {showStyleModal && styleMinimized && (
        <button
          onClick={() => setStyleMinimized(false)}
          className="animate-fade-in-up fixed bottom-24 right-6 z-40 flex items-center gap-2 rounded-full bg-accent hover:brightness-110 text-accent-fg text-sm font-medium px-4 py-2.5 shadow-lg transition-all active:scale-95"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-accent-fg/80 animate-pulse" />
          Continue style interview
        </button>
      )}

      {/* Header */}
      <div className="px-5 py-3 border-b border-line flex items-center gap-3 bg-surface">
        <div className="w-2 h-2 rounded-full bg-success" />
        <h1 className="text-sm font-bold text-fg flex-1 tracking-tight">JobApp</h1>

        <div className="flex items-center gap-1 bg-chat rounded-lg p-0.5 border border-line">
          <button
            onClick={() => setShowInspector((v) => !v)}
            className={`text-xs rounded-md px-2.5 py-1 transition-all ${showInspector ? 'bg-surface-2 text-fg border border-line' : 'text-fg-muted hover:text-fg-secondary'}`}
          >
            Files
          </button>
          <button
            onClick={() => setShowTimeline((v) => !v)}
            className={`text-xs rounded-md px-2.5 py-1 transition-all ${showTimeline ? 'bg-surface-2 text-fg border border-line' : 'text-fg-muted hover:text-fg-secondary'}`}
          >
            Timeline
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <ThemeToggle theme={theme} onToggle={toggle} />
          <div className="relative">
            <button
              onClick={() => setShowStatusMenu((v) => !v)}
              className={`text-xs border rounded-lg px-2.5 py-1.5 transition-all ${showStatusMenu ? 'text-fg border-line-strong bg-surface-2' : 'text-fg-secondary hover:text-fg border-line hover:border-line-strong'}`}
            >
              Status
            </button>
            {showStatusMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowStatusMenu(false)} />
                <div className="absolute right-0 mt-1.5 z-50 w-56 max-h-[70vh] overflow-y-auto rounded-lg border border-line-strong bg-surface shadow-lg py-1">
                  <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">Pipeline</div>
                  {PIPELINE_STATUSES.filter((s) => s.group === 'pipeline').map((s) => (
                    <button
                      key={s.value}
                      onClick={() => handleSetStatus(s.value)}
                      className={`w-full text-left px-3 py-1.5 text-xs font-mono transition-colors hover:bg-surface-2 ${status === s.value ? 'text-accent font-semibold' : 'text-fg-secondary'}`}
                    >
                      {status === s.value ? '● ' : '   '}{s.value}
                    </button>
                  ))}
                  <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-faint border-t border-line mt-1">Exception</div>
                  {PIPELINE_STATUSES.filter((s) => s.group === 'exception').map((s) => (
                    <button
                      key={s.value}
                      onClick={() => handleSetStatus(s.value)}
                      className={`w-full text-left px-3 py-1.5 text-xs font-mono transition-colors hover:bg-surface-2 ${status === s.value ? 'text-danger font-semibold' : 'text-fg-secondary'}`}
                    >
                      {status === s.value ? '● ' : '   '}{s.value}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button
            onClick={handleAbort}
            className="text-xs text-danger hover:brightness-110 border border-danger/40 hover:border-danger/70 rounded-lg px-2.5 py-1.5 transition-all"
          >
            Abort
          </button>
          <button
            onClick={handleReset}
            className="text-xs text-fg-secondary hover:text-fg border border-line hover:border-line-strong rounded-lg px-2.5 py-1.5 transition-all"
          >
            New
          </button>
        </div>
      </div>

      <StatusBar status={status} activeAgent={activeAgent} />

      <div className="flex flex-1 overflow-hidden">
        <ChatWindow
          messages={messages}
          isWaiting={isWaiting || pipelineMode === 'auto_running'}
          onAction={handleAction}
          onUpload={async (actionId, file) => {
            if (actionId === 'ta_upload_cover') {
              setMessages(prev => prev.map(m =>
                m.role === 'actions' && !m.used ? { ...m, used: true } : m
              ));
              try {
                const body = await file.arrayBuffer();
                await fetch(`/api/upload?target=cover_letter_sample&filename=${encodeURIComponent(file.name)}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/octet-stream' },
                  body,
                });
                setMessages(prev => [...prev, { role: 'user', text: `Uploaded ${file.name} → cover_letter_sample.txt` }]);
                setUploadedFiles(prev => ({ ...prev, cover_letter_sample: file.name }));
                await fetch('/api/action', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ id: 'ta_upload_cover' }),
                });
              } catch (err) {
                setMessages(prev => [...prev, { role: 'agent', agent: 'System', text: `Upload failed: ${err.message}` }]);
              }
            } else if (actionId === 'cv_revalidate_upload' || actionId === 'jd_revalidate_upload') {
              setMessages(prev => prev.map(m =>
                m.role === 'actions' && !m.used ? { ...m, used: true } : m
              ));
              const target = actionId === 'cv_revalidate_upload' ? 'cv_raw' : 'jd_raw';
              await handleUpload(file.name, file, target);
              await handleSend('Files are saved to disk as cv_raw.txt and jd_raw.txt. Please initialise the project.');
            }
          }}
        />
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
