import { useState, useEffect } from 'react';

const FILES = [
  'project_meta.json',
  'candidate_profile.json',
  'research_output.json',
  'enhanced_jd.json',
  'gap_analysis.json',
  'review_audit.json',
  'tailored_cv.json',
  'style_findings.json',
  'cv_assembly_state.json',
  'sn_output.json',
  'sn_working.json',
  'pb_output.json',
  'sc_output.json',
  'hf_output.json',
  'cf_output.json',
  'clw_output.json',
  'df_output.json',
];
const KEMU_TAB = '__kemu__';
const SNAP_TAB = '__snapshots__';

function SnapshotsPanel() {
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(null);

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
      const r = await fetch(`/api/snapshot/${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (!r.ok) { const e = await r.json().catch(() => ({})); alert(e.error || 'Delete failed'); return; }
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
          className="flex-1 text-xs bg-surface-2 border border-line rounded-lg px-3 py-1.5 text-fg placeholder-fg-faint focus:outline-none focus:border-accent/60"
        />
        <button
          onClick={handleSave}
          disabled={!newName.trim() || !!busy}
          className="text-xs px-3 py-1.5 rounded-lg bg-accent hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed text-accent-fg font-medium transition-all"
        >
          Save
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-3 justify-center">
          <div className="w-3 h-3 border-2 border-line border-t-accent rounded-full animate-spin" />
          <span className="text-xs text-fg-muted">Loading</span>
        </div>
      )}
      {!loading && snapshots.length === 0 && (
        <p className="text-xs text-fg-muted italic text-center py-3">No snapshots yet</p>
      )}
      {!loading && snapshots.map(snap => (
        <div key={snap.name} className="flex items-center gap-2 bg-surface-2 border border-line rounded-lg px-3 py-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-fg truncate">{snap.name}</p>
            <p className="text-[10px] text-fg-faint mt-0.5">
              {snap.status && <span className="text-accent mr-2">{snap.status}</span>}
              {snap.savedAt ? new Date(snap.savedAt).toLocaleString() : ''}
              {snap.files ? ` · ${snap.files} files` : ''}
            </p>
          </div>
          <button
            onClick={() => handleRestore(snap.name)}
            disabled={!!busy}
            className="text-[11px] px-2.5 py-1 rounded bg-success/15 hover:bg-success/25 text-success disabled:opacity-40 transition-colors"
          >
            {busy === `restore-${snap.name}` ? '…' : 'Restore'}
          </button>
          <button
            onClick={() => handleDelete(snap.name)}
            disabled={!!busy}
            className="text-[11px] px-2 py-1 rounded bg-danger/10 hover:bg-danger/20 text-danger disabled:opacity-40 transition-colors"
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
    if (file === SNAP_TAB) return;  // snapshots tab manages its own data
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
    <div className="animate-fade-in-up absolute bottom-20 right-4 z-50 w-[580px] max-h-[60vh] flex flex-col overflow-hidden bg-surface border border-line-strong rounded-xl shadow-[var(--shadow-float)]">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-line">
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-fg-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        <span className="text-xs font-medium text-fg-secondary flex-1">Workspace</span>
        {activeFile !== SNAP_TAB && (
          <button
            onClick={() => load(activeFile)}
            className="text-[10px] text-fg-faint hover:text-fg-secondary transition-colors px-1.5 py-0.5 rounded hover:bg-chat"
          >
            Refresh
          </button>
        )}
        <button
          onClick={onClose}
          className="text-fg-muted hover:text-fg transition-colors p-0.5 rounded hover:bg-chat"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Tabs */}
      <div className="shrink-0 flex gap-0.5 px-3 pt-2 pb-0 overflow-x-auto border-b border-line">
        {FILES.map((f) => (
          <button
            key={f}
            onClick={() => setActiveFile(f)}
            className={`text-[11px] px-2.5 py-1.5 rounded-t-lg whitespace-nowrap transition-all -mb-px ${
              activeFile === f
                ? 'bg-surface-2 text-fg font-medium border-t border-x border-line'
                : 'text-fg-muted hover:text-fg-secondary hover:bg-chat'
            }`}
          >
            {f.replace('.json', '')}
          </button>
        ))}
        <button
          onClick={() => setActiveFile(KEMU_TAB)}
          className={`text-[11px] px-2.5 py-1.5 rounded-t-lg whitespace-nowrap transition-all -mb-px ${
            activeFile === KEMU_TAB
              ? 'bg-warn/10 text-warn font-medium border-t border-x border-warn/30'
              : 'text-warn/70 hover:text-warn hover:bg-chat'
          }`}
        >
          KEMU vars
        </button>
        <button
          onClick={() => setActiveFile(SNAP_TAB)}
          className={`text-[11px] px-2.5 py-1.5 rounded-t-lg whitespace-nowrap transition-all -mb-px ${
            activeFile === SNAP_TAB
              ? 'bg-success/10 text-success font-medium border-t border-x border-success/30'
              : 'text-success/70 hover:text-success hover:bg-chat'
          }`}
        >
          Snapshots
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 bg-chat">
        {activeFile === SNAP_TAB ? (
          <SnapshotsPanel />
        ) : (
          <>
            {loading && (
              <div className="flex items-center gap-2 py-4 justify-center">
                <div className="w-3 h-3 border-2 border-line border-t-accent rounded-full animate-spin" />
                <span className="text-xs text-fg-muted">Loading</span>
              </div>
            )}
            {!loading && data === null && (
              <p className="text-xs text-fg-muted italic text-center py-4">File not found or empty</p>
            )}
            {!loading && data !== null && (
              <pre className="text-[11px] text-fg-secondary font-mono whitespace-pre-wrap break-all leading-relaxed">
                {JSON.stringify(data, null, 2)}
              </pre>
            )}
          </>
        )}
      </div>
    </div>
  );
}
