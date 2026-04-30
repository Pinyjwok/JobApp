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
const SNAP_TAB = '__snapshots__';

function SnapshotsPanel() {
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(null); // action in progress

  async function loadSnapshots() {
    setLoading(true);
    try {
      const r = await fetch('/api/snapshots');
      setSnapshots(await r.json());
    } catch {
      setSnapshots([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadSnapshots(); }, []);

  async function handleSave() {
    const name = newName.trim().replace(/\s+/g, '-');
    if (!name) return;
    setBusy(`save-${name}`);
    try {
      const r = await fetch('/api/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!r.ok) { const e = await r.json(); alert(e.error); return; }
      setNewName('');
      await loadSnapshots();
    } finally {
      setBusy(null);
    }
  }

  async function handleRestore(name) {
    if (!confirm(`Restore snapshot "${name}"? Current workspace will be overwritten.`)) return;
    setBusy(`restore-${name}`);
    try {
      const r = await fetch('/api/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!r.ok) { const e = await r.json(); alert(e.error); }
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(name) {
    if (!confirm(`Delete snapshot "${name}"?`)) return;
    setBusy(`delete-${name}`);
    try {
      await fetch(`/api/snapshot/${name}`, { method: 'DELETE' });
      await loadSnapshots();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {/* Save current workspace */}
      <div className="flex gap-2">
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSave()}
          placeholder="snapshot-name (e.g. after-ta)"
          className="flex-1 text-xs bg-slate-800 border border-slate-700/50 rounded-lg px-3 py-1.5 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-violet-500/50"
        />
        <button
          onClick={handleSave}
          disabled={!newName.trim() || !!busy}
          className="text-xs px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium transition-colors"
        >
          Save
        </button>
      </div>

      {/* List */}
      {loading && (
        <div className="flex items-center gap-2 py-3 justify-center">
          <div className="w-3 h-3 border-2 border-slate-700 border-t-violet-400 rounded-full animate-spin" />
          <span className="text-xs text-slate-600">Loading</span>
        </div>
      )}
      {!loading && snapshots.length === 0 && (
        <p className="text-xs text-slate-600 italic text-center py-3">No snapshots yet</p>
      )}
      {!loading && snapshots.map(snap => (
        <div key={snap.name} className="flex items-center gap-2 bg-slate-800/50 border border-slate-700/30 rounded-lg px-3 py-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-slate-200 truncate">{snap.name}</p>
            <p className="text-[10px] text-slate-600 mt-0.5">
              {snap.status && <span className="text-violet-400 mr-2">{snap.status}</span>}
              {snap.savedAt ? new Date(snap.savedAt).toLocaleString() : ''}
              {snap.files ? ` · ${snap.files} files` : ''}
            </p>
          </div>
          <button
            onClick={() => handleRestore(snap.name)}
            disabled={!!busy}
            className="text-[11px] px-2.5 py-1 rounded bg-emerald-700/40 hover:bg-emerald-700/60 text-emerald-300 disabled:opacity-40 transition-colors"
          >
            {busy === `restore-${snap.name}` ? '…' : 'Restore'}
          </button>
          <button
            onClick={() => handleDelete(snap.name)}
            disabled={!!busy}
            className="text-[11px] px-2 py-1 rounded bg-red-900/30 hover:bg-red-900/50 text-red-400 disabled:opacity-40 transition-colors"
          >
            {busy === `delete-${snap.name}` ? '…' : '✕'}
          </button>
        </div>
      ))}
    </div>
  );
}

export function WorkspaceInspector({ refresh, onClose }) {
  const [activeFile, setActiveFile] = useState(FILES[0]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  async function load(file) {
    if (file === SNAP_TAB || file === KEMU_TAB) return;
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
        {activeFile !== SNAP_TAB && activeFile !== KEMU_TAB && (
          <button
            onClick={() => load(activeFile)}
            className="text-[10px] text-slate-600 hover:text-slate-300 transition-colors px-1.5 py-0.5 rounded hover:bg-slate-800"
          >
            Refresh
          </button>
        )}
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
        <button
          onClick={() => setActiveFile(SNAP_TAB)}
          className={`text-[11px] px-2.5 py-1.5 rounded-t-lg whitespace-nowrap transition-all ${
            activeFile === SNAP_TAB
              ? 'bg-emerald-900/40 text-emerald-300 font-medium border-t border-x border-emerald-700/40'
              : 'text-emerald-700 hover:text-emerald-500 hover:bg-slate-800/30'
          }`}
        >
          Snapshots
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 border-t border-slate-800/50">
        {activeFile === SNAP_TAB ? (
          <SnapshotsPanel />
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
