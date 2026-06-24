import { useState, useEffect } from 'react';
import { Modal } from './Modal';

// Revision popup for assembly section review. Replaces the old "type in the chat box" step so the
// revise flow matches the modal-driven gap/style interviews. Carries the free-text instruction that
// the server forwards to the section's agent as `__revise__: <text>`.
export function RevisionModal({ agent, onSubmit, onCancel }) {
  const [text, setText] = useState('');

  // Reset when a different section's revision opens.
  useEffect(() => { setText(''); }, [agent]);

  const ready = text.trim().length > 0;

  function handleSubmit() {
    if (!ready) return;
    onSubmit(text.trim());
  }

  return (
    <Modal onClose={onCancel} labelledBy="revise-title"
      className="animate-modal-in bg-surface border border-line-strong rounded-2xl p-8 w-full max-w-lg shadow-[var(--shadow-float)] flex flex-col gap-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center shadow-[var(--shadow-panel)]">
            <svg className="w-4 h-4 text-accent-fg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </div>
          <div>
            <h2 id="revise-title" className="text-sm font-semibold text-fg tracking-tight">Revise {agent}</h2>
            <p className="text-xs text-fg-muted">Describe what to change — the section is regenerated with your notes</p>
          </div>
        </div>

        {/* Instruction */}
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSubmit(); }}
          autoFocus
          placeholder="e.g. Make the summary more concise and lead with the lab experience…"
          rows={5}
          className="w-full bg-surface-2 border border-line-strong rounded-xl px-4 py-3 text-sm text-fg placeholder-fg-faint focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/20 resize-none transition-all"
        />

        {/* Navigation */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-sm font-medium border border-line text-fg-secondary hover:text-fg hover:border-line-strong transition-all"
          >
            Cancel
          </button>
          <div className="flex-1" />
          <button
            onClick={handleSubmit}
            disabled={!ready}
            className={`px-5 py-2 rounded-xl text-sm font-medium transition-all active:scale-[0.98] ${
              ready
                ? 'bg-accent hover:brightness-110 text-accent-fg shadow-[var(--shadow-panel)]'
                : 'bg-surface-2 border border-line text-fg-faint cursor-not-allowed'
            }`}
          >
            Send revision
          </button>
        </div>
    </Modal>
  );
}
