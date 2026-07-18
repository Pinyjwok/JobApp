import { useState, useEffect } from 'react';

// ── Field ordering & labels ───────────────────────────────────────────────────
const INTEL_FIELDS = [
  ['mission_values',           'Mission & Values'],
  ['culture_overview',         'Culture'],
  ['key_strengths',            'Key Strengths'],
  ['interview_focus',          'Interview Focus'],
  ['recent_developments',      'Recent Developments'],
  ['known_challenges',         'Known Challenges'],
  ['strategic_plan',           'Strategic Direction'],
  ['hiring_unit',              'Hiring Unit'],
  ['hiring_unit_intelligence', 'Hiring Unit Intelligence'],
];

// The 3 always-visible highlight cards (Variation B)
const HIGHLIGHTS = [
  {
    key: 'interview_focus',
    label: 'Interview Focus',
    color: 'var(--accent)',
    bg: 'rgba(var(--accent-rgb, 91 139 240) / .08)',
    border: 'rgba(var(--accent-rgb, 91 139 240) / .18)',
    // Tailwind fallbacks for bg-accent/10 aren't always available via CSS vars — use inline styles
    colorStyle: { color: 'var(--accent)' },
    bgStyle:    { background: 'oklch(from var(--accent) l c h / .08)', border: '1px solid oklch(from var(--accent) l c h / .18)', borderLeft: '2.5px solid var(--accent)' },
  },
  {
    key: 'culture_overview',
    label: 'Culture',
    color: 'var(--success)',
    colorStyle: { color: 'var(--success)' },
    bgStyle:    { background: 'oklch(from var(--success) l c h / .07)', border: '1px solid oklch(from var(--success) l c h / .18)', borderLeft: '2.5px solid var(--success)' },
  },
  {
    key: 'key_strengths',
    label: 'Key Strengths',
    color: 'var(--warn)',
    colorStyle: { color: 'var(--warn)' },
    bgStyle:    { background: 'oklch(from var(--warn) l c h / .07)', border: '1px solid oklch(from var(--warn) l c h / .18)', borderLeft: '2.5px solid var(--warn)' },
  },
];
const HIGHLIGHT_KEYS = new Set(HIGHLIGHTS.map(h => h.key));

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Parse the company name from the researcher's completion message.
 *  Quality + field counts are NO LONGER scraped from prose — the server owns the verdict and stamps it
 *  into research_output.json (read below), since Researcher v2.3 dropped the status/quality text.
 *  Tolerates both the v2.3 message ("…gathered for Suncorp Group.") and the old em-dash form. */
function parseResearchMsg(text) {
  const company = (text.match(/gathered for\s+\*?\*?(.+?)\*?\*?\s*(?:[—–.]|$)/m) ?? [])[1]?.trim() ?? null;
  return { company };
}

/** Normalise a research_data field value to a readable string */
function coerceContent(val) {
  if (!val) return null;
  if (Array.isArray(val)) return val.join(' ');
  return String(val);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Chevron({ open }) {
  return (
    <svg
      width={11} height={11} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .18s', flexShrink: 0 }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function QualityBadge({ quality, filled, total }) {
  const ok = quality === 'RESEARCH_COMPLETE';
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-mono font-semibold border ${
      ok ? 'text-success border-success/20 bg-success/10' : 'text-warn border-warn/20 bg-warn/10'
    }`}>
      {filled != null && total != null ? `${filled}/${total} · ` : ''}
      {ok ? 'COMPLETE' : quality === 'RESEARCH_PARTIAL' ? 'PARTIAL' : 'FAILED'}
    </span>
  );
}

function HighlightCard({ item, hue }) {
  const [exp, setExp] = useState(false);
  const CUT = 120;
  const long = item.content.length > CUT;

  return (
    <div className="rounded-lg px-3 py-2" style={{ borderRadius: 8, ...hue.bgStyle }}>
      <div
        className="text-xs font-bold uppercase tracking-[.07em] mb-1 font-mono"
        style={hue.colorStyle}
      >
        {hue.label}
      </div>
      <p className="text-xs text-fg-secondary leading-relaxed m-0">
        {exp || !long ? item.content : item.content.slice(0, CUT) + '…'}
      </p>
      {long && (
        <button
          onClick={() => setExp(v => !v)}
          className="mt-1 text-xs bg-transparent border-none cursor-pointer p-0 hover:opacity-75 transition-opacity"
          style={hue.colorStyle}
        >
          {exp ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

function IntelRow({ item, active, onToggle }) {
  return (
    <div>
      <button
        onClick={onToggle}
        className={`flex items-center gap-2 w-full px-2 py-[5px] rounded-md border-none bg-transparent cursor-pointer text-left transition-colors hover:bg-accent/5 ${active ? 'bg-accent/5' : ''}`}
      >
        <span className="text-xs text-fg-secondary font-medium flex-1">{item.label}</span>
        <span className="text-fg-muted"><Chevron open={active} /></span>
      </button>
      {active && (
        <p className="text-xs text-fg-secondary leading-relaxed mx-2 mt-0.5 mb-2">
          {item.content}
        </p>
      )}
    </div>
  );
}

function SourceRow({ source }) {
  const [open, setOpen] = useState(false);
  const isCo = source.origin === 'company';

  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-2 w-full px-2 py-[5px] rounded-md border-none bg-transparent cursor-pointer text-left transition-colors hover:bg-accent/5 ${open ? 'bg-accent/5' : ''}`}
      >
        <span className={`text-xs px-1.5 py-0.5 rounded font-mono font-bold uppercase tracking-wider flex-shrink-0 ${
          isCo ? 'text-accent bg-accent/10' : 'text-fg-muted bg-fg-faint/20'
        }`}>
          {isCo ? 'co' : 'sec'}
        </span>
        <span className="text-xs text-fg-secondary flex-1 leading-snug">{source.title}</span>
        {source.url && (
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="text-xs text-fg-faint hover:text-accent transition-colors flex-shrink-0"
            title={source.url}
          >
            ↗
          </a>
        )}
        <span className="text-fg-muted flex-shrink-0"><Chevron open={open} /></span>
      </button>
      {open && (
        <div className="pb-2" style={{ paddingLeft: 40, paddingRight: 8 }}>
          {source.snippet ? (
            <p className="text-xs text-fg-muted leading-relaxed m-0">{source.snippet}</p>
          ) : (
            <p className="text-xs text-fg-faint font-mono m-0">
              No summary yet —{' '}
              <span className="text-fg-faint">
                persist Tavily <code className="text-accent/70">snippet</code> per-source to enable
              </span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SourceGroup({ sources, label }) {
  if (!sources.length) return null;
  return (
    <div className="mb-1.5">
      <div className="text-xs font-bold font-mono uppercase tracking-widest text-fg-faint px-2 py-1">
        {label}
      </div>
      {sources.map((s, i) => <SourceRow key={i} source={s} />)}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function ResearchBubble({ msg }) {
  const [data, setData]               = useState(null);
  const [quality, setQuality]         = useState(null);   // server-derived verdict, read from the file
  const [loading, setLoading]         = useState(true);
  const [moreOpen, setMoreOpen]       = useState(false);
  const [activeIntel, setActiveIntel] = useState(null);

  const parsed = parseResearchMsg(msg.text);

  useEffect(() => {
    fetch('/api/workspace?file=research_output.json')
      .then(r => r.json())
      .then(d => { setData(d?.research_data ?? null); setQuality(d?.quality ?? null); })
      .catch(() => { setData(null); setQuality(null); })
      .finally(() => setLoading(false));
  }, []);

  // Build full intelligence list from research_data
  const intel = data
    ? INTEL_FIELDS
        .map(([key, label]) => {
          const content = coerceContent(data[key]);
          return content ? { key, label, content } : null;
        })
        .filter(Boolean)
    : [];

  const highlights  = HIGHLIGHTS
    .map(hue => ({ hue, item: intel.find(i => i.key === hue.key) }))
    .filter(({ item }) => !!item);

  const remaining   = intel.filter(i => !HIGHLIGHT_KEYS.has(i.key));
  const sources     = data?.sources ?? [];
  const companySrcs = sources.filter(s => s.origin === 'company');
  const sectorSrcs  = sources.filter(s => s.origin === 'sector');

  // Verdict + counts from the file (server-owned), not the prose. filled/total are display-only.
  const filled   = intel.length || null;
  const total    = filled != null ? INTEL_FIELDS.length : null;
  const hasError = quality === 'RESEARCH_FAILED';

  return (
    <div className={`animate-fade-in-up relative w-full max-w-[85%] rounded-xl border border-line border-l-[3px] border-l-line-strong bg-surface-2 px-4 py-3 text-sm text-fg shadow-[var(--shadow-panel)] ${hasError ? 'ring-1 ring-danger/40' : ''}`}>

      {/* Agent header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="w-1.5 h-1.5 rounded-full bg-fg-faint" />
        <span className="text-xs text-fg-secondary font-semibold">Company research</span>
        {msg.cost != null && (
          <span className="text-xs text-fg-faint font-mono ml-0.5">${msg.cost.toFixed(4)}</span>
        )}
        {quality && (
          <div className="ml-auto">
            <QualityBadge quality={quality} filled={filled} total={total} />
          </div>
        )}
      </div>

      {/* Title */}
      <div className="font-bold text-base mb-1">
        <span className="text-success">✓</span> Here's what we found
      </div>

      {/* Summary line */}
      <p className="text-sm text-fg-secondary leading-relaxed mb-3">
        Company intelligence gathered for{' '}
        <strong className="text-fg font-semibold">{parsed.company ?? 'the company'}</strong>
      </p>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center gap-2 py-2 text-xs text-fg-faint">
          <span className="w-3 h-3 rounded-full border border-fg-faint border-t-transparent animate-spin" />
          Loading intelligence…
        </div>
      )}

      {/* Body — only shown once data resolves */}
      {!loading && (
        <>
          {/* ── Highlight cards ── */}
          {highlights.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {highlights.map(({ hue, item }) => (
                <HighlightCard key={hue.key} item={item} hue={hue} />
              ))}
            </div>
          )}

          {/* ── More intelligence (remaining fields) ── */}
          {remaining.length > 0 && (
            <div className="border-t border-line mt-2.5">
              <button
                onClick={() => setMoreOpen(v => !v)}
                className="flex items-center gap-1.5 w-full py-2 bg-transparent border-none cursor-pointer text-fg-muted text-xs font-bold uppercase tracking-[.07em] hover:text-fg-secondary transition-colors"
              >
                <span className="text-fg-muted"><Chevron open={moreOpen} /></span>
                More Intelligence
                <span className="ml-auto text-fg-faint normal-case tracking-normal font-normal text-xs">
                  {remaining.length} fields
                </span>
              </button>
              {moreOpen && (
                <div className="pb-1">
                  {remaining.map(item => (
                    <IntelRow
                      key={item.key}
                      item={item}
                      active={activeIntel === item.key}
                      onToggle={() => setActiveIntel(v => v === item.key ? null : item.key)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Sources ── */}
          {(companySrcs.length > 0 || sectorSrcs.length > 0) && (
            <div className="border-t border-line mt-2.5">
              <div className="py-2 text-fg-muted text-xs font-bold uppercase tracking-[.07em]">
                Sources
              </div>
              <SourceGroup sources={companySrcs} label="Company" />
              <SourceGroup sources={sectorSrcs}  label="Sector"  />
              <div className="h-1" />
            </div>
          )}

          {/* Fallback: no structured data loaded (e.g. workspace reset) */}
          {!data && (
            <p className="text-xs text-fg-faint italic">
              Intelligence not available — research_output.json not found in workspace.
            </p>
          )}
        </>
      )}
    </div>
  );
}
