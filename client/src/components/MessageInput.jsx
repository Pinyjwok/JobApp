import { useState, useRef } from 'react';

export function MessageInput({ onSend, onUpload, disabled, lastUserMessage }) {
  const [text, setText] = useState('');
  const [injectMode, setInjectMode] = useState(false);
  const fileRef = useRef(null);

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
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
    if (e.key === 'Enter' && !e.shiftKey) {
      handleSubmit(e);
    }
  }

  async function handleFiles(e) {
    const files = Array.from(e.target.files);
    for (const file of files) {
      await onUpload(file.name, file);
    }
    e.target.value = '';
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-end gap-2 px-4 py-3 border-t border-slate-700"
    >
      <input
        ref={fileRef}
        type="file"
        accept=".txt,.pdf"
        multiple
        onChange={handleFiles}
        className="hidden"
      />

      {/* File upload */}
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={disabled}
        className="rounded-xl bg-slate-800 border border-slate-600 hover:border-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-slate-400 hover:text-violet-400 text-sm px-3 py-3 transition-colors"
        title="Upload .txt or .pdf files"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
        </svg>
      </button>

      {/* Textarea */}
      <textarea
        className="flex-1 resize-none rounded-xl bg-slate-800 border border-slate-600 text-sm text-slate-100 placeholder-slate-500 px-4 py-3 focus:outline-none focus:border-violet-500 transition-colors"
        rows={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={injectMode ? 'Inject agent message…' : 'Type a message…'}
        disabled={disabled && !injectMode}
      />

      {/* Re-send */}
      {lastUserMessage && !disabled && (
        <button
          type="button"
          onClick={() => onSend(lastUserMessage)}
          className="rounded-xl bg-slate-800 border border-slate-600 hover:border-violet-500 text-slate-400 hover:text-violet-400 text-xs px-3 py-3 transition-colors whitespace-nowrap"
          title={`Resend: "${lastUserMessage.slice(0, 30)}"`}
        >
          ↩
        </button>
      )}

      {/* Inject toggle */}
      <button
        type="button"
        onClick={() => setInjectMode((v) => !v)}
        className={`rounded-xl border text-xs px-3 py-3 transition-colors whitespace-nowrap ${
          injectMode
            ? 'bg-amber-900 border-amber-600 text-amber-300'
            : 'bg-slate-800 border-slate-600 text-slate-500 hover:text-slate-300'
        }`}
        title="Toggle inject mode (bypass KEMU)"
      >
        {injectMode ? 'Inject' : 'User'}
      </button>

      {/* Send */}
      <button
        type="submit"
        disabled={(disabled && !injectMode) || !text.trim()}
        className="rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-3 transition-colors"
      >
        Send
      </button>
    </form>
  );
}
