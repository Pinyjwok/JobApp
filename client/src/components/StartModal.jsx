import { useState, useRef } from 'react';

// "edited 2h ago" from an ISO timestamp. Coarse buckets — this is a glanceable hint, not a clock.
function relativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.max(0, (Date.now() - then) / 1000);
  if (s < 45) return 'edited just now';
  const m = Math.round(s / 60);
  if (m < 60) return `edited ${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `edited ${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `edited ${d}d ago`;
  const w = Math.round(d / 7);
  if (w < 5) return `edited ${w}w ago`;
  return `edited ${new Date(iso).toLocaleDateString()}`;
}

const DocIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z" />
    <path d="M13 3v6h6M9 13h6M9 17h6" />
  </svg>
);

const CheckIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M5 13l4 4L19 7" />
  </svg>
);

// One document row in the "Your documents" panel — click or drag-drop to choose a file.
function DocRow({ label, badge, hint, file, onFile }) {
  const inputRef = useRef(null);
  const pick = () => inputRef.current?.click();

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${label}. ${file ? file.name : hint}`}
      onClick={pick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } }}
      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
      onDragOver={(e) => e.preventDefault()}
      className={`group flex items-center gap-3 rounded-xl border p-3 text-left cursor-pointer transition-all ${
        file ? 'border-accent/40 bg-accent/5' : 'border-line hover:border-accent/40 bg-surface-2'
      }`}
    >
      <input ref={inputRef} type="file" accept=".pdf,.txt" className="hidden"
        onChange={(e) => { const f = e.target.files[0]; if (f) onFile(f); }} />
      <div className={`w-9 h-9 shrink-0 rounded-lg flex items-center justify-center ${file ? 'bg-accent/15 text-accent' : 'bg-surface text-fg-muted'}`}>
        {file ? <CheckIcon className="w-4 h-4" /> : <DocIcon className="w-[18px] h-[18px]" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-fg">{label}</span>
          {badge && (
            <span className={`text-xs font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${
              badge === 'Required' ? 'bg-accent/10 text-accent' : 'bg-surface text-fg-muted'
            }`}>{badge}</span>
          )}
        </div>
        <p className="text-xs text-fg-faint truncate">{file ? file.name : hint}</p>
      </div>
      <span className="text-xs font-medium text-accent shrink-0 px-2">
        {file ? 'Replace' : 'Upload'}
      </span>
    </div>
  );
}

const STEPS = [
  { n: '1', title: 'Analyse', body: 'We read your CV and the job, research the company, and map your fit.' },
  { n: '2', title: 'Polish',  body: 'We learn your writing voice so everything sounds like you.' },
  { n: '3', title: 'Build',   body: 'We build each section and your cover letter - you approve as we go.' },
];

// The fresh-start flow: hero + steps + document uploads. Shared by first-time users and the
// "New application" path from the returning-user view.
function FreshStart({ onStart, onBack }) {
  const [cvFile, setCvFile] = useState(null);
  const [jdFile, setJdFile] = useState(null);
  const [clFile, setClFile] = useState(null);
  const bothReady = cvFile && jdFile;
  const requiredCount = (cvFile ? 1 : 0) + (jdFile ? 1 : 0);

  return (
    <div className="flex flex-col items-center gap-8">
      {onBack && (
        <button onClick={onBack} className="self-start text-xs text-fg-muted hover:text-fg-secondary transition-colors -mb-4">
          ← Back
        </button>
      )}

      {/* Hero */}
      <div className="flex flex-col items-center gap-4 text-center pt-2">
        <div className="w-14 h-14 rounded-2xl bg-accent flex items-center justify-center shadow-[var(--shadow-panel)]">
          <DocIcon className="w-7 h-7 text-accent-fg" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-fg tracking-tight">JobApp</h1>
          <p className="text-base text-fg-secondary mt-2 max-w-md">
            We tailor your CV and cover letter to each job.
          </p>
        </div>
      </div>

      {/* 3 step cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full">
        {STEPS.map((s) => (
          <div key={s.n} className="rounded-xl border border-line bg-surface-2 p-4 flex flex-col gap-2">
            <div className="w-6 h-6 rounded-full bg-accent/10 border border-accent/40 flex items-center justify-center">
              <span className="text-xs font-semibold text-accent">{s.n}</span>
            </div>
            <h3 className="text-sm font-semibold text-fg">{s.title}</h3>
            <p className="text-xs text-fg-secondary leading-relaxed">{s.body}</p>
          </div>
        ))}
      </div>

      {/* Documents */}
      <div className="w-full flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg">Your documents</h2>
          <span className="text-xs text-fg-muted">{requiredCount} of 2 required</span>
        </div>
        <DocRow label="CV / Resume"   badge="Required"    hint="PDF or TXT - drag or click" file={cvFile} onFile={setCvFile} />
        <DocRow label="Job Description" badge="Required"  hint="PDF or TXT - drag or click" file={jdFile} onFile={setJdFile} />
        <DocRow label="Cover Letter Sample" badge="Recommended" hint="Lets us match your writing voice" file={clFile} onFile={setClFile} />
      </div>

      {/* Start */}
      <div className="flex flex-col items-center gap-3">
        <button
          onClick={() => bothReady && onStart(cvFile, jdFile, clFile)}
          disabled={!bothReady}
          className={`w-full sm:w-auto px-10 py-3 rounded-xl text-sm font-medium transition-all active:scale-[0.99] ${
            bothReady
              ? 'bg-accent hover:brightness-110 text-accent-fg shadow-[var(--shadow-panel)]'
              : 'bg-surface-2 border border-line text-fg-faint cursor-not-allowed'
          }`}
        >
          Start  →
        </button>
        {!bothReady && (
          <p className="text-xs text-fg-faint">Add your CV and the job description to begin.</p>
        )}
      </div>
    </div>
  );
}

// The returning-user landing: resume the saved session, or expand the fresh-start flow.
function ReturningUser({ session, onResume, onNew }) {
  const title = [session?.position_title, session?.company_name].filter(Boolean).join(' · ') || 'Your last application';
  const edited = relativeTime(session?.editedAt);
  const files = session?.files || {};
  const drafted = session?.sectionsDrafted || 0;
  const total = session?.sectionsTotal || 0;

  const chips = [
    { key: 'cv', label: 'CV', on: files.cv },
    { key: 'jd', label: 'Job description', on: files.jd },
    { key: 'cl', label: 'Cover letter', on: files.cover_letter },
  ];

  return (
    <div className="flex flex-col items-center gap-7">
      {/* Header */}
      <div className="text-center pt-2">
        <h1 className="text-2xl font-bold text-fg tracking-tight">Welcome back</h1>
        <p className="text-base text-fg-secondary mt-2">Pick up where you left off, or start a new application.</p>
      </div>

      {/* Resume card */}
      <div className="w-full rounded-2xl border border-accent/30 bg-accent/5 p-4 flex flex-col gap-4 shadow-[var(--shadow-panel)]">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 shrink-0 rounded-xl bg-accent flex items-center justify-center">
            <DocIcon className="w-[21px] h-[21px] text-accent-fg" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-fg truncate">{title}</h2>
            {edited && (
              <div className="flex items-center gap-1 text-xs text-fg-muted mt-0.5">
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
                </svg>
                <span>{edited}</span>
              </div>
            )}
          </div>
          <button
            onClick={onResume}
            className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent hover:brightness-110 text-accent-fg text-sm font-medium transition-all active:scale-[0.99]"
          >
            Resume
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>

        {/* File chips + progress */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pl-1">
          {chips.filter(c => c.on).map((c) => (
            <span key={c.key} className="flex items-center gap-1 text-xs text-fg-secondary">
              <span className="w-3.5 h-3.5 rounded-full bg-accent/15 text-accent flex items-center justify-center">
                <CheckIcon className="w-2.5 h-2.5" />
              </span>
              {c.label}
            </span>
          ))}
          {drafted > 0 && total > 0 && (
            <span className="text-xs text-fg-muted ml-auto">{drafted} of {total} sections drafted</span>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="w-full flex items-center gap-3">
        <div className="flex-1 h-px bg-line" />
        <span className="text-xs text-fg-muted">or start a new application</span>
        <div className="flex-1 h-px bg-line" />
      </div>

      {/* New application */}
      <button
        onClick={onNew}
        className="w-full flex items-center gap-3 rounded-xl border border-line hover:border-accent/40 bg-surface-2 p-4 text-left transition-all active:scale-[0.99]"
      >
        <div className="w-10 h-10 shrink-0 rounded-lg bg-accent/10 flex items-center justify-center">
          <svg className="w-[17px] h-[17px] text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-fg">New application</div>
          <p className="text-xs text-fg-faint">Upload a CV and job description to begin</p>
        </div>
        <svg className="w-4 h-4 text-fg-muted shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
    </div>
  );
}

export function StartModal({ hasHistory, session, onStart, onResume, uploading = false }) {
  // Show the returning-user landing only when there's actually a session to resume.
  const showResume = hasHistory ?? (session?.hasHistory === true);
  const [forceNew, setForceNew] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-app overflow-y-auto py-10">
      <div className="animate-fade-in-up w-full max-w-2xl px-6 flex flex-col items-center">

        {uploading ? (
          <div className="flex flex-col items-center gap-4 py-8">
            <svg className="w-9 h-9 text-accent animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <p className="text-sm text-fg-secondary">Setting up your analysis…</p>
          </div>
        ) : showResume && !forceNew ? (
          <ReturningUser session={session} onResume={onResume} onNew={() => setForceNew(true)} />
        ) : (
          <FreshStart onStart={onStart} onBack={showResume ? () => setForceNew(false) : null} />
        )}

      </div>
    </div>
  );
}
