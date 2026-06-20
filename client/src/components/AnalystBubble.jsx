import { useState } from 'react';

// ── Parser ────────────────────────────────────────────────────────────────────
function parseAnalystMsg(text) {
  const score      = (text.match(/Fit [Ss]core:\s*(\d+(?:\.\d+)?)\/10/) ?? [])[1];
  const [, s, g]   = text.match(/(\d+) strengths?,\s*(\d+) gaps?/) ?? [];
  // Top strength: everything up to the next labelled field or end-of-line
  const top        = (text.match(/Top strength:\s*([^\n]+)/) ?? [])[1]?.trim();
  // Key gap: text before the severity qualifier
  const gapMatch   = text.match(/Key gap:\s*([^\n(]+?)(?:\s*\(severity:\s*(\w+)\))?(?:\n|$)/);
  const gap        = gapMatch?.[1]?.trim();
  const gapSev     = gapMatch?.[2] ?? null;
  return {
    score:       score ? parseFloat(score) : null,
    strengths:   s     ? parseInt(s)       : null,
    gaps:        g     ? parseInt(g)       : null,
    topStrength: top   ?? null,
    keyGap:      gap   ?? null,
    gapSeverity: gapSev,
  };
}

// ── Chevron ───────────────────────────────────────────────────────────────────
function Chevron({ open }) {
  return (
    <svg width={10} height={10} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .18s', flexShrink: 0 }}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

// ── Score colour ──────────────────────────────────────────────────────────────
function scoreClass(n) {
  if (n == null) return 'text-fg-muted';
  if (n >= 7)    return 'text-success';
  if (n >= 5)    return 'text-warn';
  return 'text-danger';
}

// ── Gap severity colour ───────────────────────────────────────────────────────
function gapSevClass(sev) {
  if (!sev)                              return 'text-warn   bg-warn/10   border-warn/20';
  if (/critical/i.test(sev))            return 'text-danger bg-danger/10 border-danger/20';
  if (/high/i.test(sev))                return 'text-danger bg-danger/10 border-danger/20';
  return                                        'text-warn   bg-warn/10   border-warn/20';
}

// ── Expandable row ────────────────────────────────────────────────────────────
function DetailRow({ tag, tagClass, label, detail }) {
  const [open, setOpen] = useState(false);
  const preview = label.length > 65 ? label.slice(0, 65) + '…' : label;
  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-2 w-full py-[5px] px-1 rounded-md bg-transparent border-none cursor-pointer text-left transition-colors hover:bg-accent/5 ${open ? 'bg-accent/5' : ''}`}
      >
        <span className={`text-[9.5px] font-bold font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border flex-shrink-0 ${tagClass}`}>
          {tag}
        </span>
        <span className="text-[12.5px] text-fg-secondary flex-1 leading-snug">{preview}</span>
        <span className="text-fg-muted flex-shrink-0"><Chevron open={open} /></span>
      </button>
      {open && (
        <p className="text-[12.5px] text-fg-secondary leading-relaxed mx-1 mt-0.5 mb-2">{detail}</p>
      )}
    </div>
  );
}

// ── Gap severity grouping ───────────────────────────────────────────────────────
// Order severities most→least pressing; anything unrecognised lands under "Other".
const SEV_ORDER = ['critical', 'high', 'medium', 'low', 'administrative'];
function sevKey(sev) {
  const s = (sev ?? '').toLowerCase();
  return SEV_ORDER.includes(s) ? s : 'other';
}
function groupGapsBySeverity(gaps) {
  const buckets = new Map();
  for (const g of gaps) {
    const k = sevKey(g.severity);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(g);
  }
  const order = [...SEV_ORDER, 'other'];
  return order.filter(k => buckets.has(k)).map(k => ({ key: k, items: buckets.get(k) }));
}

// Collapsible severity group: header shows the severity label + count, body holds the rows.
function GapGroup({ groupKey, items, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  const tagClass = gapSevClass(groupKey === 'other' ? null : groupKey);
  const label = groupKey === 'other' ? 'gap' : groupKey;
  return (
    <div className="border-t border-line">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 w-full py-2 px-1 rounded-md bg-transparent border-none cursor-pointer text-left transition-colors hover:bg-accent/5"
      >
        <span className={`text-[9.5px] font-bold font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border flex-shrink-0 ${tagClass}`}>
          {label}
        </span>
        <span className="text-[11px] text-fg-muted font-medium flex-1">
          {items.length} gap{items.length !== 1 ? 's' : ''}
        </span>
        <span className="text-fg-muted flex-shrink-0"><Chevron open={open} /></span>
      </button>
      <div
        className="overflow-hidden transition-all duration-300 ease-out"
        style={{ maxHeight: open ? `${items.length * 200}px` : '0px', opacity: open ? 1 : 0 }}
      >
        <div className="pb-1">
          {items.map((g, i) => (
            <DetailRow
              key={`g${i}`}
              tag={`gap${g.severity ? ` · ${g.severity}` : ''}`}
              tagClass={gapSevClass(g.severity)}
              label={g.text}
              detail={g.text}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export function AnalystBubble({ msg }) {
  const parsed = parseAnalystMsg(msg.text);
  // Authoritative structured lists from the server (gap_analysis.json). Old history messages
  // predate this field → fall back to the single top-strength / key-gap parsed from the text.
  const data = msg.analystData;
  const score      = data?.score ?? parsed.score;
  const strengths  = data?.strengths ?? (parsed.topStrength ? [{ text: parsed.topStrength }] : []);
  const gaps       = data?.gaps ?? (parsed.keyGap ? [{ text: parsed.keyGap, severity: parsed.gapSeverity }] : []);

  return (
    <div className="animate-fade-in-up relative w-full max-w-[85%] rounded-xl border border-line border-l-[3px] border-l-line-strong bg-surface-2 px-4 py-3 text-sm text-fg shadow-[var(--shadow-panel)]">

      {/* Agent header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="w-1.5 h-1.5 rounded-full bg-fg-faint" />
        <span className="text-xs text-fg-secondary font-semibold">How you fit</span>
        {msg.cost != null && (
          <span className="text-[10px] text-fg-faint font-mono ml-0.5">${msg.cost.toFixed(4)}</span>
        )}
      </div>

      {/* Title + score */}
      <div className="flex items-baseline gap-3 mb-3">
        <div className="font-bold text-[15px]">
          <span className="text-success">✓</span> Here's how you fit this role
        </div>
        {score != null && (
          <span className={`text-[13px] font-bold font-mono ${scoreClass(score)}`}>
            {score}/10
          </span>
        )}
      </div>

      {/* Strengths / gaps count pills */}
      <div className="flex gap-2 mb-3 flex-wrap">
        <span className="text-[11px] px-2 py-1 rounded-md font-medium text-success bg-success/10 border border-success/20">
          {strengths.length} strength{strengths.length !== 1 ? 's' : ''}
        </span>
        <span className={`text-[11px] px-2 py-1 rounded-md font-medium border ${
          gaps.length === 0
            ? 'text-success bg-success/10 border-success/20'
            : gaps.length <= 4
            ? 'text-warn bg-warn/10 border-warn/20'
            : 'text-danger bg-danger/10 border-danger/20'
        }`}>
          {gaps.length} gap{gaps.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* All strengths */}
      {strengths.length > 0 && (
        <div className="border-t border-line">
          {strengths.map((s, i) => (
            <DetailRow
              key={`s${i}`}
              tag="strength"
              tagClass="text-success bg-success/10 border-success/20"
              label={s.text}
              detail={s.text}
            />
          ))}
        </div>
      )}

      {/* All gaps — grouped by severity, each group collapsible */}
      {gaps.length > 0 && (
        <div>
          {groupGapsBySeverity(gaps).map((grp, i) => (
            <GapGroup
              key={grp.key}
              groupKey={grp.key}
              items={grp.items}
              defaultOpen={i === 0}
            />
          ))}
        </div>
      )}

    </div>
  );
}
