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
      className={`relative cursor-pointer rounded-xl border-2 border-dashed p-4 text-center transition-all ${
        file
          ? 'border-violet-500/60 bg-violet-500/10'
          : 'border-slate-600/50 hover:border-slate-500/70 bg-slate-800/40'
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
          <svg className="w-4 h-4 text-violet-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-sm text-violet-300 truncate max-w-[180px]">{file.name}</span>
        </div>
      ) : (
        <div>
          <p className="text-sm font-medium text-slate-300">{label}</p>
          <p className="text-xs text-slate-500 mt-0.5">{hint}</p>
        </div>
      )}
    </div>
  );
}

export function StartModal({ hasHistory, onStart, onResume, uploading = false }) {
  const [cvFile, setCvFile] = useState(null);
  const [jdFile, setJdFile] = useState(null);
  const bothReady = cvFile && jdFile;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md">
      <div className="animate-fade-in-up bg-gradient-to-b from-slate-800 to-slate-900 border border-slate-700/50 rounded-2xl p-8 w-full max-w-sm shadow-2xl shadow-violet-950/20 flex flex-col gap-6">

        {/* Logo */}
        <div className="flex flex-col items-center gap-3 pt-2">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div className="text-center">
            <h2 className="text-lg font-semibold text-white tracking-tight">JobApp CV Optimizer</h2>
            <p className="text-sm text-slate-400 mt-1">
              {uploading
                ? 'Setting up your analysis…'
                : hasHistory
                  ? 'Resume your session or start fresh.'
                  : 'Upload your documents to begin.'}
            </p>
          </div>
        </div>

        {uploading ? (
          /* Uploading state — spinner + file names */
          <div className="flex flex-col items-center gap-4 py-2">
            <svg className="w-8 h-8 text-violet-400 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <div className="flex flex-col items-center gap-1 text-xs text-slate-400">
              {cvFile && <span>✓ {cvFile.name}</span>}
              {jdFile && <span>✓ {jdFile.name}</span>}
            </div>
          </div>
        ) : (
          <>
            {/* Resume — only when history exists */}
            {hasHistory && (
              <>
                <button
                  onClick={onResume}
                  className="w-full py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-sm font-medium transition-all shadow-lg shadow-violet-600/20 hover:shadow-violet-500/30 active:scale-[0.98]"
                >
                  Resume session
                </button>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-slate-700/60" />
                  <span className="text-xs text-slate-500">or start fresh</span>
                  <div className="flex-1 h-px bg-slate-700/60" />
                </div>
              </>
            )}

            {/* File uploads */}
            <div className="flex flex-col gap-2.5">
              <FileDropZone label="CV / Resume" hint="PDF or TXT — drag or click" file={cvFile} onFile={setCvFile} />
              <FileDropZone label="Job Description" hint="PDF or TXT — drag or click" file={jdFile} onFile={setJdFile} />
            </div>

            {/* Start button */}
            <button
              onClick={() => bothReady && onStart(cvFile, jdFile)}
              disabled={!bothReady}
              className={`w-full py-2.5 rounded-xl text-sm font-medium transition-all active:scale-[0.98] ${
                bothReady
                  ? 'bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-lg shadow-violet-600/20 hover:shadow-violet-500/30'
                  : 'bg-slate-700/40 text-slate-500 cursor-not-allowed'
              }`}
            >
              Start analysis
            </button>
          </>
        )}

      </div>
    </div>
  );
}
