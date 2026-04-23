import { useState, useEffect } from 'react';

const FILES = [
  'project_memory.json',
  'gap_analysis.json',
  'cv_assembly_state.json',
  'candidate_profile.json',
  'style_guide.json',
  'agent_reasoning.json',
];
const KEMU_TAB = '__kemu__';

export function WorkspaceInspector({ refresh, onClose }) {
  const [activeFile, setActiveFile] = useState(FILES[0]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  async function load(file) {
    setLoading(true);
    try {
      if (file === KEMU_TAB) {
        const r = await fetch('/api/debug/vars');
        setData(await r.json());
      } else {
        const r = await fetch(`/api/workspace?file=${file}`);
        setData(await r.json());
      }
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(activeFile); }, [activeFile, refresh]);

  return (
    <div className="animate-fade-in-up absolute bottom-20 right-4 z-50 w-[580px] max-h-[60vh] flex flex-col overflow-hidden bg-slate-900/95 backdrop-blur-md border border-slate-700/50 rounded-xl shadow-2xl shadow-black/40">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-slate-800">
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        <span className="text-xs font-medium text-slate-300 flex-1">Workspace</span>
        <button
          onClick={() => load(activeFile)}
          className="text-[10px] text-slate-600 hover:text-slate-300 transition-colors px-1.5 py-0.5 rounded hover:bg-slate-800"
        >
          Refresh
        </button>
        <button
          onClick={onClose}
          className="text-slate-600 hover:text-slate-300 transition-colors p-0.5 rounded hover:bg-slate-800"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Tabs */}
      <div className="shrink-0 flex gap-0.5 px-3 pt-2 pb-0 overflow-x-auto">
        {FILES.map((f) => (
          <button
            key={f}
            onClick={() => setActiveFile(f)}
            className={`text-[11px] px-2.5 py-1.5 rounded-t-lg whitespace-nowrap transition-all ${
              activeFile === f
                ? 'bg-slate-800/80 text-slate-200 font-medium border-t border-x border-slate-700/50'
                : 'text-slate-600 hover:text-slate-400 hover:bg-slate-800/30'
            }`}
          >
            {f.replace('.json', '')}
          </button>
        ))}
        <button
          onClick={() => setActiveFile(KEMU_TAB)}
          className={`text-[11px] px-2.5 py-1.5 rounded-t-lg whitespace-nowrap transition-all ${
            activeFile === KEMU_TAB
              ? 'bg-amber-900/40 text-amber-300 font-medium border-t border-x border-amber-700/40'
              : 'text-amber-700 hover:text-amber-500 hover:bg-slate-800/30'
          }`}
        >
          KEMU vars
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 border-t border-slate-800/50">
        {loading && (
          <div className="flex items-center gap-2 py-4 justify-center">
            <div className="w-3 h-3 border-2 border-slate-700 border-t-violet-400 rounded-full animate-spin" />
            <span className="text-xs text-slate-600">Loading</span>
          </div>
        )}
        {!loading && data === null && (
          <p className="text-xs text-slate-600 italic text-center py-4">File not found or empty</p>
        )}
        {!loading && data !== null && (
          <pre className="text-[11px] text-slate-400 font-mono whitespace-pre-wrap break-all leading-relaxed">
            {JSON.stringify(data, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
