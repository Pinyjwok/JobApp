import { useState, useEffect } from 'react';

const FILES = [
  'project_memory.json',
  'cv_assembly_state.json',
  'candidate_profile.json',
  'style_guide.json',
  'agent_reasoning.json',
];

export function WorkspaceInspector({ refresh, onClose }) {
  const [activeFile, setActiveFile] = useState(FILES[0]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  async function load(file) {
    setLoading(true);
    try {
      const r = await fetch(`/api/workspace?file=${file}`);
      setData(await r.json());
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(activeFile); }, [activeFile, refresh]);

  return (
    <div className="absolute bottom-20 right-4 z-50 w-[560px] max-h-[60vh] flex flex-col bg-slate-900 border border-slate-700 rounded-xl shadow-2xl">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-700">
        <span className="text-xs font-medium text-slate-300 flex-1">Workspace Files</span>
        <button
          onClick={() => load(activeFile)}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors px-2"
        >
          ↻ Refresh
        </button>
        <button
          onClick={onClose}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          ✕
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-3 pt-2 border-b border-slate-700 overflow-x-auto">
        {FILES.map((f) => (
          <button
            key={f}
            onClick={() => setActiveFile(f)}
            className={`text-xs px-2 py-1 rounded-t whitespace-nowrap transition-colors ${
              activeFile === f
                ? 'bg-slate-800 text-slate-200 border border-b-0 border-slate-600'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {f.replace('.json', '')}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading && <p className="text-xs text-slate-500 italic">Loading…</p>}
        {!loading && data === null && (
          <p className="text-xs text-slate-500 italic">File not found or empty</p>
        )}
        {!loading && data !== null && (
          <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap break-all">
            {JSON.stringify(data, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
