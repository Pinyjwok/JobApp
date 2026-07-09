import { useState, useRef } from 'react';
import { DEV } from '../lib/dev';

const UPLOAD_TARGETS = [
  { label: 'CV / Resume', value: 'cv_raw' },
  { label: 'Job Description', value: 'jd_raw' },
  { label: 'Cover Letter Sample', value: 'cover_letter_sample' },
];

export function MessageInput({ onSend, onUpload, disabled, pipelineMode, lastUserMessage }) {
  const [text, setText] = useState('');
  const [injectMode, setInjectMode] = useState(false);
  const [uploadTarget, setUploadTarget] = useState(null);
  const [showTargetMenu, setShowTargetMenu] = useState(false);
  const fileRef = useRef(null);

  const isAutoRunning = pipelineMode === 'auto_running';
  const isActionRequired = pipelineMode === 'action_required';
  const effectivelyDisabled = disabled && !injectMode;

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || effectivelyDisabled) return;
    if (injectMode) {
      fetch('/api/inject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      }).catch(() => {});
    } else {
      onSend(trimmed);
    }
    setText('');
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) handleSubmit(e);
  }

  async function handleFiles(e) {
    const files = Array.from(e.target.files);
    for (const file of files) await onUpload(file.name, file, uploadTarget);
    e.target.value = '';
  }

  function pickTarget(target) {
    setUploadTarget(target);
    setShowTargetMenu(false);
    setTimeout(() => fileRef.current?.click(), 50);
  }

  const targetLabel = UPLOAD_TARGETS.find((t) => t.value === uploadTarget)?.label ?? 'Auto';

  const placeholder = injectMode
    ? 'Inject agent message...'
    : isAutoRunning
      ? 'Working on it…'
      : isActionRequired
        ? 'Select an option above…'
        : 'Type a message…';

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-end gap-2 px-5 py-3 border-t border-line bg-surface"
    >
      <input
        ref={fileRef}
        type="file"
        accept=".txt,.pdf"
        multiple
        onChange={handleFiles}
        className="hidden"
      />

      {/* Upload */}
      <div className="relative">
        {showTargetMenu && (
          <div className="absolute bottom-full mb-2 left-0 z-50 bg-surface border border-line rounded-xl shadow-[var(--shadow-float)] overflow-hidden min-w-max animate-fade-in-up">
            <button
              type="button"
              onClick={() => pickTarget(null)}
              className="w-full text-left px-4 py-2.5 text-xs text-fg-secondary hover:bg-chat hover:text-fg transition-colors"
            >
              Auto-detect
            </button>
            {UPLOAD_TARGETS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => pickTarget(t.value)}
                className="w-full text-left px-4 py-2.5 text-xs text-fg-secondary hover:bg-chat hover:text-fg transition-colors"
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => setShowTargetMenu((v) => !v)}
          disabled={disabled}
          aria-label={`Upload a file (as: ${targetLabel})`}
          className={`flex items-center gap-1.5 rounded-xl text-sm px-3 py-2.5 transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
            uploadTarget
              ? 'bg-accent/10 border border-accent/40 text-accent'
              : 'bg-surface-2 border border-line text-fg-muted hover:text-accent hover:border-accent/50'
          }`}
          title={`Upload as: ${targetLabel}`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
          {uploadTarget && <span className="text-xs">{targetLabel}</span>}
        </button>
      </div>

      {/* Input area */}
      <div className="relative flex-1">
        <textarea
          className={`w-full resize-none rounded-xl bg-surface-2 border text-sm text-fg px-4 py-2.5 focus:outline-none transition-all ${
            effectivelyDisabled
              ? 'border-line text-fg-faint placeholder-fg-faint cursor-not-allowed'
              : 'border-line-strong placeholder-fg-faint focus:border-accent/60 focus:ring-1 focus:ring-accent/20'
          }`}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={effectivelyDisabled}
        />
        {isAutoRunning && !injectMode && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse [animation-delay:0.2s]" />
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse [animation-delay:0.4s]" />
          </span>
        )}
      </div>

      {/* Re-send */}
      {lastUserMessage && !disabled && (
        <button
          type="button"
          onClick={() => onSend(lastUserMessage)}
          aria-label="Resend last message"
          className="rounded-xl bg-surface-2 border border-line hover:border-accent/50 text-fg-muted hover:text-accent text-xs px-2.5 py-2.5 transition-all"
          title={`Resend: "${lastUserMessage.slice(0, 30)}"`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a5 5 0 015 5v2M3 10l4-4m-4 4l4 4" />
          </svg>
        </button>
      )}

      {/* Inject toggle — developer-only (bypasses KEMU) */}
      {DEV && (
        <button
          type="button"
          onClick={() => setInjectMode((v) => !v)}
          aria-pressed={injectMode}
          className={`rounded-xl border text-xs px-2.5 py-2.5 transition-all font-medium tracking-wide uppercase ${
            injectMode
              ? 'bg-warn/10 border-warn/40 text-warn'
              : 'bg-surface-2 border-line text-fg-muted hover:text-fg-secondary'
          }`}
          title="Toggle inject mode (bypass KEMU)"
        >
          {injectMode ? 'Inject' : 'User'}
        </button>
      )}

      {/* Send */}
      <button
        type="submit"
        disabled={effectivelyDisabled || !text.trim()}
        aria-label="Send message"
        className="rounded-xl bg-accent hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed text-accent-fg text-sm font-medium px-4 py-2.5 transition-all active:scale-95"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
        </svg>
      </button>
    </form>
  );
}
