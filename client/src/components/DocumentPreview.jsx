import { useState } from 'react';
import { cvToText } from '../lib/docText';

// DocumentPreview — first-class preview of the assembled application (CV + cover letter).
// NEW for the 2026-06 redesign. Renders the two finished artifacts as a page-like surface inside
// the chat stream, with a segmented CV / Cover-letter toggle and Copy / Download actions.
//
// Data contract (fed by tailored_cv.json + the cover-letter object):
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
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-muted">{children}</span>
      <span className="flex-1 h-px bg-line" />
    </div>
  );
}

function Role({ title, dates, employer, bullets = [] }) {
  return (
    <div className="mb-3.5 last:mb-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[14px] font-semibold text-fg">{title}</span>
        {dates && <span className="text-[12px] font-mono text-fg-muted shrink-0">{dates}</span>}
      </div>
      {employer && <div className="text-[13px] text-fg-secondary mt-0.5">{employer}</div>}
      {bullets.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {bullets.map((b, i) => (
            <li key={i} className="flex gap-2 text-[13px] text-fg-secondary leading-relaxed">
              <span className="text-fg-faint">•</span><span>{b}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
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

export function DocumentPreview({ doc, initialTab = 'cv', onCopy, onDownload }) {
  const [tab, setTab] = useState(initialTab);
  const cv = doc?.cv ?? {};
  const coverLetter = doc?.coverLetter ?? '';

  const activeText = () => (tab === 'cv' ? cvToText(cv) : coverLetter);

  function handleCopy() {
    navigator.clipboard?.writeText(activeText()).catch(() => {});
    onCopy?.(tab);
  }
  function handleDownload() {
    const name = (cv.name || 'document').replace(/\s+/g, '_');
    const blob = new Blob([activeText()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}-${tab === 'cv' ? 'cv' : 'cover-letter'}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    onDownload?.(tab);
  }

  const skills = cv.skills ?? {};
  const hasSkills = skills.technical?.length || skills.core?.length || skills.certifications?.length;

  const Seg = ({ id, children }) => (
    <button
      onClick={() => setTab(id)}
      className={`text-xs font-medium px-3.5 py-1.5 rounded-md transition-all ${
        tab === id ? 'bg-surface text-fg shadow-[var(--shadow-panel)]' : 'text-fg-muted hover:text-fg-secondary'
      }`}
    >
      {children}
    </button>
  );

  return (
    <div className="animate-fade-in-up w-full max-w-2xl">
      {/* toolbar */}
      <div className="flex items-center justify-between mb-3">
        <div className="inline-flex gap-0.5 bg-surface-2 border border-line rounded-lg p-0.5">
          <Seg id="cv">CV</Seg>
          <Seg id="cover">Cover letter</Seg>
        </div>
        <div className="flex items-center gap-4">
          <ToolbarButton icon={<CopyIcon />} onClick={handleCopy}>Copy</ToolbarButton>
          <ToolbarButton icon={<DownloadIcon />} onClick={handleDownload}>.txt</ToolbarButton>
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
                  <p className="text-[13.5px] leading-[1.65] text-fg">{cv.profile}</p>
                </>
              )}

              {hasSkills && (
                <>
                  <DocSectionHeader>Skills</DocSectionHeader>
                  <div className="text-[13px] leading-[1.7] text-fg-secondary space-y-0.5">
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
                  <div className="text-[13px] leading-[1.7] text-fg-secondary">
                    {cv.education.map((e, i) => <div key={i}>{e}</div>)}
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="max-w-[64ch] whitespace-pre-wrap text-[14px] leading-relaxed text-fg">
              {coverLetter}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
