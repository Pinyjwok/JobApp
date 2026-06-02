import { useState, useRef } from 'react';

function FileDropZone({ label, hint, file, onFile }) {
  const inputRef = useRef(null);

  function handleDrop(e) {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  }

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      className={`relative cursor-pointer rounded-xl border-2 border-dashed p-5 text-center transition-all ${
        file
          ? 'border-accent bg-accent/10'
          : 'border-line-strong hover:border-accent/50 bg-surface-2'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.txt"
        className="hidden"
        onChange={(e) => { const f = e.target.files[0]; if (f) onFile(f); }}
      />
      {file ? (
        <div className="flex items-center justify-center gap-2">
          <svg className="w-4 h-4 text-accent shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-sm text-accent truncate max-w-[200px]">{file.name}</span>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1">
          <svg className="w-5 h-5 text-fg-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          <p className="text-sm font-medium text-fg-secondary">{label}</p>
          <p className="text-xs text-fg-faint">{hint}</p>
        </div>
      )}
    </div>
  );
}

const STEPS = [
  { n: '1', title: 'Analyse', body: 'We read your CV and the job, research the company, and map your fit.' },
  { n: '2', title: 'Polish',  body: 'We learn your writing voice so everything sounds like you.' },
  { n: '3', title: 'Build',   body: 'We build each section and your cover letter — you approve as we go.' },
];

export function StartModal({ hasHistory, onStart, onResume, uploading = false }) {
  const [cvFile, setCvFile] = useState(null);
  const [jdFile, setJdFile] = useState(null);
  const [clFile, setClFile] = useState(null);
  const [showCl, setShowCl] = useState(false);
  const bothReady = cvFile && jdFile;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-app overflow-y-auto py-10">
      <div className="animate-fade-in-up w-full max-w-2xl px-6 flex flex-col items-center gap-8">

        {/* Hero */}
        <div className="flex flex-col items-center gap-4 text-center pt-4">
          <div className="w-14 h-14 rounded-2xl bg-accent flex items-center justify-center shadow-[var(--shadow-panel)]">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7 text-accent-fg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-fg tracking-tight">JobApp</h1>
            <p className="text-base text-fg-secondary mt-2 max-w-md">
              Land the interview. We tailor your CV and cover letter to the job — in about a minute.
            </p>
          </div>
        </div>

        {uploading ? (
          <div className="flex flex-col items-center gap-4 py-8">
            <svg className="w-9 h-9 text-accent animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <p className="text-sm text-fg-secondary">Setting up your analysis…</p>
            <div className="flex flex-col items-center gap-1 text-xs text-fg-muted">
              {cvFile && <span>✓ {cvFile.name}</span>}
              {jdFile && <span>✓ {jdFile.name}</span>}
              {clFile && <span>✓ {clFile.name}</span>}
            </div>
          </div>
        ) : (
          <>
            {/* Resume — only when history exists */}
            {hasHistory && (
              <div className="w-full flex flex-col gap-4">
                <button
                  onClick={onResume}
                  className="w-full py-3 rounded-xl bg-accent hover:brightness-110 text-accent-fg text-sm font-medium transition-all shadow-[var(--shadow-panel)] active:scale-[0.99]"
                >
                  Resume your session
                </button>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-line" />
                  <span className="text-xs text-fg-muted">or start fresh</span>
                  <div className="flex-1 h-px bg-line" />
                </div>
              </div>
            )}

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

            {/* Uploads — CV + JD side by side */}
            <div className="w-full flex flex-col gap-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FileDropZone label="Your CV / Resume" hint="PDF or TXT — drag or click" file={cvFile} onFile={setCvFile} />
                <FileDropZone label="Job Description" hint="PDF or TXT — drag or click" file={jdFile} onFile={setJdFile} />
              </div>

              {showCl || clFile ? (
                <FileDropZone label="Cover Letter (optional)" hint="PDF or TXT — helps us match your voice" file={clFile} onFile={setClFile} />
              ) : (
                <button
                  onClick={() => setShowCl(true)}
                  className="text-xs text-fg-muted hover:text-fg-secondary transition-colors self-center py-1"
                >
                  + Add a cover letter sample (optional)
                </button>
              )}
            </div>

            {/* Start */}
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
              <p className="text-xs text-fg-faint -mt-4">Add your CV and the job description to begin.</p>
            )}
          </>
        )}

      </div>
    </div>
  );
}
