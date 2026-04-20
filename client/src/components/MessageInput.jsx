import { useState, useRef } from 'react';

const UPLOAD_TARGETS = [
  { label: 'CV / Resume', value: 'cv_raw' },
  { label: 'Job Description', value: 'jd_raw' },
  { label: 'Cover Letter Sample', value: 'cover_letter_sample' },
];

export function MessageInput({ onSend, onUpload, disabled, pipelineMode, runningAgent, lastUserMessage }) {
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

  // Placeholder text depends on pipeline state
  const placeholder = injectMode
    ? 'Inject agent message...'
    : isAutoRunning
      ? `Running: ${runningAgent ?? 'Pipeline'}…`
      : isActionRequired
        ? 'Select an option above…'
        : 'Type a message…';

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-end gap-2 px-5 py-3 border-t border-slate-800 bg-slate-900/50 backdrop-blur-sm"
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
          <div className="absolute bottom-full mb-2 left-0 z-50 bg-slate-800 border border-slate-700/50 rounded-xl shadow-2xl shadow-black/40 overflow-hidden min-w-max animate-fade-in-up">
            <button
              type="button"
              onClick={() => pickTarget(null)}
              className="w-full text-left px-4 py-2.5 text-xs text-slate-400 hover:bg-slate-700/50 hover:text-slate-200 transition-colors"
            >
              Auto-detect
            </button>
            {UPLOAD_TARGETS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => pickTarget(t.value)}
                className="w-full text-left px-4 py-2.5 text-xs text-slate-300 hover:bg-slate-700/50 hover:text-white transition-colors"
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
          className={`flex items-center gap-1.5 rounded-xl text-sm px-3 py-2.5 transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
            uploadTarget
              ? 'bg-violet-900/40 border border-violet-600/50 text-violet-300'
              : 'bg-slate-800/60 border border-slate-700/50 text-slate-500 hover:text-violet-400 hover:border-violet-500/50'
          }`}
          title={`Upload as: ${targetLabel}`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
          {uploadTarget && <span className="text-[10px]">{targetLabel}</span>}
        </button>
      </div>

      {/* Input area */}
      <div className="relative flex-1">
        <textarea
          className={`w-full resize-none rounded-xl bg-slate-800/40 border text-sm text-slate-100 px-4 py-2.5 focus:outline-none transition-all ${
            effectivelyDisabled
              ? 'border-slate-700/20 text-slate-600 placeholder-slate-700 cursor-not-allowed'
              : 'border-slate-700/40 placeholder-slate-600 focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20'
          }`}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={effectivelyDisabled}
        />
        {/* Pulse dot when auto_running */}
        {isAutoRunning && !injectMode && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse [animation-delay:0.2s]" />
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse [animation-delay:0.4s]" />
          </span>
        )}
      </div>

      {/* Re-send */}
      {lastUserMessage && !disabled && (
        <button
          type="button"
          onClick={() => onSend(lastUserMessage)}
          className="rounded-xl bg-slate-800/40 border border-slate-700/40 hover:border-violet-500/50 text-slate-500 hover:text-violet-400 text-xs px-2.5 py-2.5 transition-all"
          title={`Resend: "${lastUserMessage.slice(0, 30)}"`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a5 5 0 015 5v2M3 10l4-4m-4 4l4 4" />
          </svg>
        </button>
      )}

      {/* Inject toggle */}
      <button
        type="button"
        onClick={() => setInjectMode((v) => !v)}
        className={`rounded-xl border text-[10px] px-2.5 py-2.5 transition-all font-medium tracking-wide uppercase ${
          injectMode
            ? 'bg-amber-900/30 border-amber-600/50 text-amber-400'
            : 'bg-slate-800/40 border-slate-700/40 text-slate-600 hover:text-slate-400'
        }`}
        title="Toggle inject mode (bypass KEMU)"
      >
        {injectMode ? 'Inject' : 'User'}
      </button>

      {/* Send */}
      <button
        type="submit"
        disabled={effectivelyDisabled || !text.trim()}
        className="rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2.5 transition-all active:scale-95 shadow-lg shadow-violet-600/10 hover:shadow-violet-500/20"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
        </svg>
      </button>
    </form>
  );
}
