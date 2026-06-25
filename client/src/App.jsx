import { useRef, useEffect } from 'react';
import { ChatWindow } from './components/ChatWindow';
import { MessageInput } from './components/MessageInput';
import { StatusBar } from './components/StatusBar';
import { AgentTimeline } from './components/AgentTimeline';
import { WorkspaceInspector } from './components/WorkspaceInspector';
import { StartModal } from './components/StartModal';
import { GapInterviewModal } from './components/GapInterviewModal';
import { StyleInterviewModal } from './components/StyleInterviewModal';
import { RevisionModal } from './components/RevisionModal';
import { IntegrityReviewModal } from './components/IntegrityReviewModal';
import { Toaster } from './components/Toaster';
import { useTheme } from './theme';
import { useRunState } from './hooks/useRunState';
import { useModalManager } from './hooks/useModalManager';
import { useChatStream } from './hooks/useChatStream';
import { useAppActions } from './hooks/useAppActions';
import { DEV } from './lib/dev';
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

// Assembly is server-owned and every phase shares the coarse CV_BUILDING status, so a plain status
// override can't resume a specific agent. These map to /api/dev/phase, which jumps to and re-fires the
// chosen phase (workspace must already hold the assembly inputs — restore a snapshot first).
const ASSEMBLY_PHASES_DEV = [
  { phase: 1, label: '1 · Style Negotiator' },
  { phase: 2, label: '2 · Profile Builder' },
  { phase: 3, label: '3 · Skills Curator' },
  { phase: 4, label: '4 · History Formatter' },
  { phase: 5, label: '5 · Credentials Formatter' },
  { phase: 6, label: '6 · Cover Letter Writer' },
  { phase: 7, label: '7 · Style Reviewer' },
  { phase: 8, label: '8 · Integrity Checker' },
  { phase: 9, label: '9 · Document Formatter' },
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
  const run = useRunState();
  const modal = useModalManager(run);
  const { connection } = useChatStream(run, modal);
  const actions = useAppActions(run, modal);

  // Bridge: after a reconnect, one-shot SSE events (interview prompts, status) fired while we were
  // offline are gone. Resync from disk so the run isn't stranded waiting on a modal that never
  // re-opens (UI-08). guardOpen skips any interview already on screen.
  const wasDisconnectedRef = useRef(false);
  useEffect(() => {
    if (connection === 'reconnecting' || connection === 'closed') {
      wasDisconnectedRef.current = true;
      return;
    }
    if (connection === 'open' && wasDisconnectedRef.current) {
      wasDisconnectedRef.current = false;
      fetch('/api/status').then((r) => r.json()).then((d) => { if (d.status) run.setStatus(d.status); }).catch(() => {});
      fetch('/api/pending-interview')
        .then((r) => r.json())
        .then((d) => modal.applyPending(d, { guardOpen: true }))
        .catch(() => {});
    }
    // run.setStatus + modal.applyPending are the only members used and are stable references.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, run.setStatus, modal.applyPending]);

  const inputDisabled =
    run.pipelineMode !== 'user_turn' || run.sending ||
    modal.showGapModal || modal.showStyleModal || modal.showIcModal || !!modal.reviseAgent;

  return (
    <div className="flex flex-col h-screen w-screen bg-app text-base">
      <Toaster />
      {(connection === 'reconnecting' || connection === 'closed') && (
        <div className="animate-fade-in fixed top-3 left-1/2 -translate-x-1/2 z-[55] flex items-center gap-2 rounded-full bg-warn/15 ring-1 ring-warn/40 px-3.5 py-1.5 text-xs text-warn shadow-[var(--shadow-panel)]">
          <span className="w-1.5 h-1.5 rounded-full bg-warn animate-pulse" />
          {connection === 'closed' ? 'Connection lost — reload to reconnect.' : 'Reconnecting…'}
        </div>
      )}
      {modal.modalState === 'pending' && (
        <StartModal
          hasHistory={modal.historyForModal.length > 0}
          session={modal.sessionMeta}
          onStart={actions.handleModalStart}
          onResume={actions.handleModalResume}
          uploading={modal.modalUploading}
        />
      )}
      {modal.showGapModal && (
        <GapInterviewModal
          gaps={modal.gapQuestions}
          accepted={modal.gapAccepted}
          onSubmit={actions.handleGapSubmit}
          onHide={() => modal.setGapMinimized(true)}
          minimized={modal.gapMinimized}
        />
      )}
      {modal.showGapModal && modal.gapMinimized && (
        <button
          onClick={() => modal.setGapMinimized(false)}
          className="animate-fade-in-up fixed bottom-24 right-6 z-40 flex items-center gap-2 rounded-full bg-accent hover:brightness-110 text-accent-fg text-sm font-medium px-4 py-2.5 shadow-lg transition-all active:scale-95"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-accent-fg/80 animate-pulse" />
          Continue gap interview
        </button>
      )}
      {modal.showStyleModal && (
        <StyleInterviewModal
          groups={modal.styleGroups}
          onSubmit={actions.handleStyleSubmit}
          onHide={() => modal.setStyleMinimized(true)}
          minimized={modal.styleMinimized}
        />
      )}
      {modal.showStyleModal && modal.styleMinimized && (
        <button
          onClick={() => modal.setStyleMinimized(false)}
          className="animate-fade-in-up fixed bottom-40 right-6 z-40 flex items-center gap-2 rounded-full bg-accent hover:brightness-110 text-accent-fg text-sm font-medium px-4 py-2.5 shadow-lg transition-all active:scale-95"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-accent-fg/80 animate-pulse" />
          Continue style interview
        </button>
      )}
      {modal.showIcModal && (
        <IntegrityReviewModal
          claims={modal.icClaims}
          onSubmit={actions.handleIcSubmit}
          onHide={() => modal.setIcMinimized(true)}
          minimized={modal.icMinimized}
        />
      )}
      {modal.showIcModal && modal.icMinimized && (
        <button
          onClick={() => modal.setIcMinimized(false)}
          className="animate-fade-in-up fixed bottom-56 right-6 z-40 flex items-center gap-2 rounded-full bg-accent hover:brightness-110 text-accent-fg text-sm font-medium px-4 py-2.5 shadow-lg transition-all active:scale-95"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-accent-fg/80 animate-pulse" />
          Finish accuracy check
        </button>
      )}
      {modal.reviseAgent && (
        <RevisionModal
          agent={modal.reviseAgent}
          onSubmit={actions.handleReviseSubmit}
          onCancel={actions.handleReviseCancel}
        />
      )}

      {/* Header */}
      <div className="px-5 py-3 border-b border-line flex items-center gap-3 bg-surface">
        <div className="w-2 h-2 rounded-full bg-success" />
        <h1 className="text-sm font-bold text-fg flex-1 tracking-tight">JobApp</h1>

        {DEV && (
          <div className="flex items-center gap-1 bg-chat rounded-lg p-0.5 border border-line">
            <button
              onClick={() => modal.setShowInspector((v) => !v)}
              className={`text-xs rounded-md px-2.5 py-1 transition-all ${modal.showInspector ? 'bg-surface-2 text-fg border border-line' : 'text-fg-muted hover:text-fg-secondary'}`}
            >
              Files
            </button>
            <button
              onClick={() => modal.setShowTimeline((v) => !v)}
              className={`text-xs rounded-md px-2.5 py-1 transition-all ${modal.showTimeline ? 'bg-surface-2 text-fg border border-line' : 'text-fg-muted hover:text-fg-secondary'}`}
            >
              Timeline
            </button>
          </div>
        )}

        <div className="flex items-center gap-1.5">
          <ThemeToggle theme={theme} onToggle={toggle} />
          {DEV && (
          <div className="relative">
            <button
              onClick={() => modal.setShowStatusMenu((v) => !v)}
              className={`text-xs border rounded-lg px-2.5 py-1.5 transition-all ${modal.showStatusMenu ? 'text-fg border-line-strong bg-surface-2' : 'text-fg-secondary hover:text-fg border-line hover:border-line-strong'}`}
            >
              Status
            </button>
            {modal.showStatusMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => modal.setShowStatusMenu(false)} />
                <div className="absolute right-0 mt-1.5 z-50 w-56 max-h-[70vh] overflow-y-auto rounded-lg border border-line-strong bg-surface shadow-lg py-1">
                  <div className="px-3 pt-1.5 pb-1 text-xs font-semibold uppercase tracking-wider text-fg-faint">Assembly · re-fire phase</div>
                  {ASSEMBLY_PHASES_DEV.map((p) => (
                    <button
                      key={p.phase}
                      onClick={() => actions.handleSetPhase(p.phase)}
                      className="w-full text-left px-3 py-1.5 text-xs font-mono text-fg-secondary transition-colors hover:bg-surface-2"
                    >
                      {'   '}{p.label}
                    </button>
                  ))}
                  <div className="px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wider text-fg-faint border-t border-line mt-1">Pipeline · set status</div>
                  {PIPELINE_STATUSES.filter((s) => s.group === 'pipeline').map((s) => (
                    <button
                      key={s.value}
                      onClick={() => actions.handleSetStatus(s.value)}
                      className={`w-full text-left px-3 py-1.5 text-xs font-mono transition-colors hover:bg-surface-2 ${run.status === s.value ? 'text-accent font-semibold' : 'text-fg-secondary'}`}
                    >
                      {run.status === s.value ? '● ' : '   '}{s.value}
                    </button>
                  ))}
                  <div className="px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wider text-fg-faint border-t border-line mt-1">Exception</div>
                  {PIPELINE_STATUSES.filter((s) => s.group === 'exception').map((s) => (
                    <button
                      key={s.value}
                      onClick={() => actions.handleSetStatus(s.value)}
                      className={`w-full text-left px-3 py-1.5 text-xs font-mono transition-colors hover:bg-surface-2 ${run.status === s.value ? 'text-danger font-semibold' : 'text-fg-secondary'}`}
                    >
                      {run.status === s.value ? '● ' : '   '}{s.value}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          )}
          <button
            onClick={actions.handleAbort}
            className="text-xs text-danger hover:brightness-110 border border-danger/40 hover:border-danger/70 rounded-lg px-2.5 py-1.5 transition-all"
          >
            Abort
          </button>
          <button
            onClick={actions.handleReset}
            className="text-xs text-fg-secondary hover:text-fg border border-line hover:border-line-strong rounded-lg px-2.5 py-1.5 transition-all"
          >
            New
          </button>
        </div>
      </div>

      <StatusBar status={run.status} activeAgent={run.activeAgent} running={run.pipelineMode === 'auto_running'} />

      <div className="flex flex-1 overflow-hidden">
        <ChatWindow
          messages={run.messages}
          isWaiting={run.isWaiting || run.pipelineMode === 'auto_running'}
          onAction={actions.handleAction}
          onUpload={actions.handleSectionUpload}
          onJDConfirm={actions.handleJDConfirm}
        />
        {modal.showTimeline && <AgentTimeline turns={run.turns} />}
      </div>

      {modal.showInspector && (
        <WorkspaceInspector refresh={modal.inspectorRefresh} onClose={() => modal.setShowInspector(false)} />
      )}

      <MessageInput
        onSend={actions.handleSend}
        onUpload={actions.handleUpload}
        disabled={inputDisabled}
        pipelineMode={run.pipelineMode}
        runningAgent={run.runningAgent}
        lastUserMessage={run.lastUserMessage}
      />
    </div>
  );
}
