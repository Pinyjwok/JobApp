import { useState } from 'react';
import { cvToText, downloadText } from '../lib/docText';
import { toast } from '../lib/toast';
import { Modal } from './Modal';

// DocumentPreview — first-class preview of the assembled application (CV + cover letter).
// NEW for the 2026-06 redesign. Renders the two finished artifacts as a page-like surface inside
// the chat stream, with a segmented CV / Cover-letter toggle and Copy / Download actions.
//
// Data contract (built server-side by buildDocumentData from the per-section output files —
// pb/sc/hf/cf/clw_output.json — NOT from any single tailored_cv.json):
//   doc = {
//     cv: {
//       name, headline, contact,                       // header
//       profile,                                        // string
//       experience: [{ title, dates, employer, bullets:[] }],
//       education:  [ "Bachelor of Social Work · RMIT · 2016", … ]  // strings
//     },
//     coverLetter: "Dear …\n\n…"                        // plain text, \n\n paragraphs
//   }
//
// `initialTab` lets the completion screen open straight to 'cv' or 'cover'.

function DocSectionHeader({ children }) {
  return (
    <div className="flex items-center gap-3 mt-[18px] mb-2 first:mt-0">
      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-fg-muted">{children}</span>
      <span className="flex-1 h-px bg-line" />
    </div>
  );
}

function Role({ title, dates, employer, bullets = [] }) {
  return (
    <div className="mb-3.5 last:mb-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-fg">{title}</span>
        {dates && <span className="text-xs font-mono text-fg-muted shrink-0">{dates}</span>}
      </div>
      {employer && <div className="text-sm text-fg-secondary mt-0.5">{employer}</div>}
      {bullets.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {bullets.map((b, i) => (
            <li key={i} className="flex gap-2 text-sm text-fg-secondary leading-relaxed">
              <span className="text-fg-faint">•</span><span>{b}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Seg({ id, active, onSelect, children }) {
  return (
    <button
      onClick={() => onSelect(id)}
      className={`text-xs font-medium px-3.5 py-1.5 rounded-md transition-all ${
        active ? 'bg-surface text-fg shadow-[var(--shadow-panel)]' : 'text-fg-muted hover:text-fg-secondary'
      }`}
    >
      {children}
    </button>
  );
}

function ToolbarButton({ icon, children, onClick }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 text-xs text-fg-secondary hover:text-fg transition-colors">
      {icon}{children}
    </button>
  );
}

const CopyIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 9h9v11H9z" /><path d="M5 15V4h11" />
  </svg>
);
const DownloadIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3.5v11" /><path d="M7.5 10.5 12 15l4.5-4.5" /><path d="M4.5 19.5h15" />
  </svg>
);

export function DocumentPreview({ doc, initialTab = 'cv', onClose }) {
  const [tab, setTab] = useState(initialTab);
  const cv = doc?.cv ?? {};
  const coverLetter = doc?.coverLetter ?? '';

  const activeText = () => (tab === 'cv' ? cvToText(cv) : coverLetter);

  function handleCopy() {
    navigator.clipboard?.writeText(activeText())
      .then(() => toast(tab === 'cv' ? 'CV copied' : 'Cover letter copied', 'success'))
      .catch(() => toast('Copy failed', 'error'));
  }
  function handleDownload() {
    const name = (cv.name || 'document').replace(/\s+/g, '_');
    downloadText(`${name}-${tab === 'cv' ? 'cv' : 'cover-letter'}`, activeText());
  }

  const skills = cv.skills ?? {};
  const hasSkills = skills.technical?.length || skills.core?.length || skills.certifications?.length;

  return (
    <div className="animate-fade-in-up w-full max-w-2xl">
      {/* toolbar */}
      <div className="flex items-center justify-between mb-3">
        <div className="inline-flex gap-0.5 bg-surface-2 border border-line rounded-lg p-0.5">
          <Seg id="cv" active={tab === 'cv'} onSelect={setTab}>CV</Seg>
          <Seg id="cover" active={tab === 'cover'} onSelect={setTab}>Cover letter</Seg>
        </div>
        <div className="flex items-center gap-4">
          <ToolbarButton icon={<CopyIcon />} onClick={handleCopy}>Copy</ToolbarButton>
          <ToolbarButton icon={<DownloadIcon />} onClick={handleDownload}>.txt</ToolbarButton>
          {onClose && (
            <button onClick={onClose} aria-label="Close preview" className="text-fg-muted hover:text-fg transition-colors -mr-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* paper */}
      <div className="bg-surface border border-line rounded-xl px-8 py-7 shadow-[var(--shadow-panel)]">
        <div className="max-w-[68ch] mx-auto">
          {tab === 'cv' ? (
            <>
              {cv.name && <div className="text-xl font-semibold tracking-tight text-fg">{cv.name}</div>}
              {cv.headline && <div className="text-sm text-accent mt-1">{cv.headline}</div>}
              {cv.contact && <div className="text-xs font-mono text-fg-muted mt-1.5">{cv.contact}</div>}

              {cv.profile && (
                <>
                  <DocSectionHeader>Profile</DocSectionHeader>
                  <p className="text-sm leading-[1.65] text-fg">{cv.profile}</p>
                </>
              )}

              {hasSkills && (
                <>
                  <DocSectionHeader>Skills</DocSectionHeader>
                  <div className="text-sm leading-[1.7] text-fg-secondary space-y-0.5">
                    {skills.technical?.length > 0 && <div><span className="text-fg-muted">Technical: </span>{skills.technical.join(' · ')}</div>}
                    {skills.core?.length > 0 && <div><span className="text-fg-muted">Core: </span>{skills.core.join(' · ')}</div>}
                    {skills.certifications?.length > 0 && <div><span className="text-fg-muted">Certifications: </span>{skills.certifications.join(' · ')}</div>}
                  </div>
                </>
              )}

              {cv.experience?.length > 0 && (
                <>
                  <DocSectionHeader>Experience</DocSectionHeader>
                  {cv.experience.map((r, i) => <Role key={i} {...r} />)}
                </>
              )}

              {cv.education?.length > 0 && (
                <>
                  <DocSectionHeader>Education &amp; Certifications</DocSectionHeader>
                  <div className="text-sm leading-[1.7] text-fg-secondary">
                    {cv.education.map((e, i) => <div key={i}>{e}</div>)}
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="max-w-[64ch] whitespace-pre-wrap text-sm leading-relaxed text-fg">
              {coverLetter}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// DocumentModal — the completion screen's "View CV / View cover letter" opens the finished documents
// in a focused dialog rather than appending another chat bubble. The pipeline is over at this point,
// so a modal (Esc / backdrop / × to dismiss) reads as "here's your result" instead of "keep chatting".
export function DocumentModal({ doc, initialTab = 'cv', onClose }) {
  return (
    <Modal onClose={onClose} labelledBy="doc-preview-title" className="w-full max-w-2xl">
      <h2 id="doc-preview-title" className="sr-only">Your tailored documents</h2>
      <DocumentPreview doc={doc} initialTab={initialTab} onClose={onClose} />
    </Modal>
  );
}
