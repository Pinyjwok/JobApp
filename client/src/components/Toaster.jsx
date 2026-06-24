import { useEffect, useState } from 'react';
import { subscribe } from '../lib/toast';
import { Modal } from './Modal';

// Renders toasts + the confirm dialog driven by lib/toast's bus. Mount once near the app root.
const TONE = {
  error:   { bar: 'border-l-danger',  icon: 'text-danger',  glyph: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18.6A2 2 0 0 0 3.5 21.6h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z' },
  success: { bar: 'border-l-success', icon: 'text-success', glyph: 'M5 13l4 4L19 7' },
  info:    { bar: 'border-l-accent',  icon: 'text-accent',  glyph: 'M12 8h.01M11 12h1v4h1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z' },
};

function ToastCard({ t, onDone }) {
  useEffect(() => {
    const id = setTimeout(onDone, t.ttl);
    return () => clearTimeout(id);
  }, [t, onDone]);
  const tone = TONE[t.type] ?? TONE.info;
  return (
    <div
      role="status"
      className={`animate-fade-in-up pointer-events-auto flex items-start gap-2.5 w-80 max-w-[calc(100vw-2rem)] rounded-xl bg-surface-2 border border-line ${tone.bar} border-l-[3px] px-4 py-3 shadow-[var(--shadow-float)]`}
    >
      <svg className={`w-4 h-4 mt-0.5 shrink-0 ${tone.icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d={tone.glyph} />
      </svg>
      <p className="flex-1 text-[13px] leading-snug text-fg-secondary">{t.message}</p>
      <button onClick={onDone} aria-label="Dismiss" className="text-fg-faint hover:text-fg-secondary transition-colors -mr-1 -mt-0.5">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
  );
}

function ConfirmDialog({ c, onClose }) {
  const titleId = `confirm-${c.id}`;
  function answer(v) { c.resolve(v); onClose(); }
  return (
    <Modal onClose={() => answer(false)} labelledBy={titleId}
      className="animate-modal-in bg-surface border border-line-strong rounded-2xl p-7 w-full max-w-sm shadow-[var(--shadow-float)]">
      <h2 id={titleId} className="text-sm font-semibold text-fg tracking-tight">{c.title ?? 'Are you sure?'}</h2>
      {c.message && <p className="text-[13px] text-fg-muted mt-2 leading-relaxed">{c.message}</p>}
      <div className="flex items-center gap-2 mt-6">
        <div className="flex-1" />
        <button
          onClick={() => answer(false)}
          className="px-4 py-2 rounded-xl text-sm font-medium border border-line text-fg-secondary hover:text-fg hover:border-line-strong transition-all"
        >
          {c.cancelLabel ?? 'Cancel'}
        </button>
        <button
          onClick={() => answer(true)}
          className={`px-5 py-2 rounded-xl text-sm font-medium text-accent-fg transition-all active:scale-[0.98] shadow-[var(--shadow-panel)] ${
            c.danger ? 'bg-danger hover:brightness-110' : 'bg-accent hover:brightness-110'
          }`}
        >
          {c.confirmLabel ?? 'Confirm'}
        </button>
      </div>
    </Modal>
  );
}

export function Toaster() {
  const [toasts, setToasts] = useState([]);
  const [confirm, setConfirm] = useState(null);

  useEffect(() => subscribe((e) => {
    if (e.kind === 'toast') setToasts(prev => [...prev, e.toast]);
    else if (e.kind === 'confirm') setConfirm(e.confirm);
  }), []);

  return (
    <>
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <ToastCard key={t.id} t={t} onDone={() => setToasts(prev => prev.filter(x => x.id !== t.id))} />
        ))}
      </div>
      {confirm && <ConfirmDialog c={confirm} onClose={() => setConfirm(null)} />}
    </>
  );
}
