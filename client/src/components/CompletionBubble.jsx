import { useState } from 'react';
import { CheckIcon } from './primitives';
import { DocumentModal } from './DocumentPreview';
import { bothToText, downloadText } from '../lib/docText';
import { toast } from '../lib/toast';

// CompletionBubble — the "arrival" state. NEW for the 2026-06 redesign.
// Replaces the orchestrator echoing a markdown command list when status === 'CV_TAILORED'.
// View CV / View cover letter open the finished docs in a MODAL (the doc is already attached to the
// completion event) — the pipeline is over, so a dialog reads as "here's your result" rather than
// appending yet another chat bubble. Download/Copy act locally on the same doc (UI-03: honest buttons
// — no PDF lib yet, so it's .txt). If the doc is somehow missing, View falls back to the server action.
//
// Props:
//   meta = { role, company }   // from project_meta.json
//   doc  = { cv, coverLetter } // attached to the completion event (may be null)
//   onAction(id)               // same channel ActionBubble uses

const DocGlyph = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4" /><path d="M10 12h6M10 15.5h6" />
  </svg>
);
const MailGlyph = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3.5 6h17v12h-17z" /><path d="M4 6.5l8 6 8-6" />
  </svg>
);
const DownloadGlyph = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3.5v11" /><path d="M7.5 10.5 12 15l4.5-4.5" /><path d="M4.5 19.5h15" />
  </svg>
);

function PrimaryAction({ icon, children, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-surface-3 border border-line hover:border-accent/60 text-sm font-medium text-fg transition-all active:scale-[0.99]"
    >
      <span className="text-fg-secondary">{icon}</span>{children}
    </button>
  );
}

export function CompletionBubble({ meta = {}, doc, onAction }) {
  const { role, company } = meta;
  const fire = (id) => () => onAction?.(id);
  const [previewTab, setPreviewTab] = useState(null); // 'cv' | 'cover' | null

  // Open the in-page preview modal when we have the doc; fall back to the server-broadcast bubble only
  // if it's missing (shouldn't happen on a fresh completion — documentData is attached on the event).
  const view = (tab, fallbackId) => () => (doc ? setPreviewTab(tab) : onAction?.(fallbackId));

  // One-click download of both documents as a single .txt (PDF export is a separate follow-up).
  function handleDownload() {
    const name = (doc?.cv?.name || 'application').replace(/\s+/g, '_');
    downloadText(`${name}-application`, bothToText(doc));
  }
  function handleCopy() {
    navigator.clipboard?.writeText(bothToText(doc))
      .then(() => toast('Copied CV + cover letter', 'success'))
      .catch(() => toast('Copy failed', 'error'));
  }

  return (
    <div className="animate-fade-in-up w-full max-w-[85%] mx-auto bg-surface-2 border border-line rounded-2xl px-6 py-7 text-center shadow-[var(--shadow-panel)]">
      {/* success badge */}
      <div className="w-12 h-12 rounded-full bg-success/15 ring-1 ring-success/30 flex items-center justify-center mx-auto animate-modal-in">
        <CheckIcon className="w-6 h-6 text-success" />
      </div>

      <h2 className="text-lg font-semibold text-fg mt-4">Your application is ready</h2>
      <p className="text-sm text-fg-muted mt-1">Tailored CV and cover letter for</p>
      {(role || company) && (
        <p className="text-sm text-fg-secondary font-medium">
          {[role, company].filter(Boolean).join(' · ')}
        </p>
      )}

      {/* primary pair */}
      <div className="grid grid-cols-2 gap-2 mt-6 mb-2.5">
        <PrimaryAction icon={<DocGlyph />} onClick={view('cv', 'view_cv')}>View CV</PrimaryAction>
        <PrimaryAction icon={<MailGlyph />} onClick={view('cover', 'view_cover_letter')}>View cover letter</PrimaryAction>
      </div>

      {/* conversion CTA — real local download of both docs (.txt for now) */}
      <button
        onClick={handleDownload}
        disabled={!doc}
        className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-accent hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed text-accent-fg text-sm font-semibold shadow-[var(--shadow-panel)] transition-all active:scale-[0.99]"
      >
        <DownloadGlyph /> Download both (.txt)
      </button>

      {/* secondary links — only ones that do something */}
      <div className="flex items-center justify-center gap-2 mt-[18px] text-xs text-fg-muted">
        <button onClick={handleCopy} disabled={!doc} className="hover:text-fg-secondary disabled:opacity-40 transition-colors">Copy both</button>
        <span className="text-fg-faint">·</span>
        <button onClick={fire('review_audit')} className="hover:text-fg-secondary transition-colors">Quality review</button>
      </div>

      {/* demoted */}
      <div className="border-t border-line pt-4 mt-5">
        <button onClick={fire('start_over')} className="text-xs text-fg-faint hover:text-fg-muted transition-colors">
          Start a new application
        </button>
      </div>

      {previewTab && (
        <DocumentModal doc={doc} initialTab={previewTab} onClose={() => setPreviewTab(null)} />
      )}
    </div>
  );
}
