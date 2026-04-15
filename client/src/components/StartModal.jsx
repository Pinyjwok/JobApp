export function StartModal({ hasHistory, onNew, onResume }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md">
      <div className="animate-fade-in-up bg-gradient-to-b from-slate-800 to-slate-900 border border-slate-700/50 rounded-2xl p-8 w-full max-w-sm shadow-2xl shadow-violet-950/20 flex flex-col gap-6">
        {/* Logo area */}
        <div className="flex flex-col items-center gap-3 pt-2">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div className="text-center">
            <h2 className="text-lg font-semibold text-white tracking-tight">JobApp CV Optimizer</h2>
            <p className="text-sm text-slate-400 mt-1">
              {hasHistory
                ? 'Pick up where you left off, or start fresh.'
                : 'Create tailored CVs and cover letters.'}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          {hasHistory && (
            <button
              onClick={onResume}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-sm font-medium transition-all shadow-lg shadow-violet-600/20 hover:shadow-violet-500/30 active:scale-[0.98]"
            >
              Resume session
            </button>
          )}
          <button
            onClick={onNew}
            className={`w-full py-2.5 rounded-xl text-sm font-medium transition-all active:scale-[0.98] ${
              hasHistory
                ? 'bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border border-slate-600/50 hover:border-slate-500/50'
                : 'bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-lg shadow-violet-600/20 hover:shadow-violet-500/30'
            }`}
          >
            {hasHistory ? 'New session' : 'Get started'}
          </button>
        </div>
      </div>
    </div>
  );
}
