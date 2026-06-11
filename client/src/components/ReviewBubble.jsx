import { useState } from 'react';

// ── Parser ────────────────────────────────────────────────────────────────────
function parseReviewMsg(text) {
  const score      = (text.match(/Fit [Ss]core:\s*(\d+(?:\.\d+)?)\/10/) ?? [])[1];
  const verdict    = (text.match(/Overall Verdict:\s*(APPROVED|REJECTED)/) ?? [])[1];
  const reason     = (text.match(/Reason:\s*([^\n]+)/) ?? [])[1]?.trim();
  const [, aud]    = text.match(/Items Audited:\s*(\d+)/) ?? [];
  const [, appr]   = text.match(/Approved(?:\s+Items?)?:\s*(\d+)/) ?? [];
  const [, issues] = text.match(/Issues Found:\s*(\d+)/) ?? [];
  const [, crit]   = text.match(/Critical:\s*(\d+)/) ?? [];
  const [, high]   = text.match(/High:\s*(\d+)/) ?? [];
  const [, med]    = text.match(/Medium:\s*(\d+)/) ?? [];

  // Pull individual critical/high issue lines
  const issueLines = [...text.matchAll(/\[(Critical|High|Medium)\]\s*([^\n]+)/g)]
    .map(m => ({ severity: m[1], text: m[2].trim() }));

  return {
    score:      score   ? parseFloat(score) : null,
    verdict:    verdict ?? null,
    reason:     reason  ?? null,
    audited:    aud     ? parseInt(aud)    : null,
    approved:   appr    ? parseInt(appr)   : null,
    issueCount: issues  ? parseInt(issues) : null,
    critical:   crit    ? parseInt(crit)   : 0,
    high:       high    ? parseInt(high)   : 0,
    medium:     med     ? parseInt(med)    : 0,
    issueLines,
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

// ── Issue row ─────────────────────────────────────────────────────────────────
function IssueRow({ issue }) {
  const isCrit = /critical/i.test(issue.severity);
  const isHigh = /high/i.test(issue.severity);
  return (
    <div className={`text-[12px] leading-relaxed px-2.5 py-2 rounded-md ${
      isCrit ? 'bg-danger/8 border border-danger/15' :
      isHigh ? 'bg-warn/8 border border-warn/15'   :
               'bg-surface border border-line'
    }`}>
      <span className={`font-mono font-bold text-[9.5px] uppercase tracking-wider mr-2 ${
        isCrit ? 'text-danger' : isHigh ? 'text-warn' : 'text-fg-muted'
      }`}>
        {issue.severity}
      </span>
      <span className="text-fg-secondary">{issue.text}</span>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export function ReviewBubble({ msg }) {
  const p = parseReviewMsg(msg.text);
  const [showDetails, setShowDetails] = useState(false);

  const ok      = p.verdict === 'APPROVED';
  const hasData = p.verdict != null;

  // Use inline style for border-left color to avoid Tailwind safelist issues
  const borderColor = ok ? 'var(--success)' : p.verdict === 'REJECTED' ? 'var(--danger)' : 'var(--line-strong)';

  const severitySummary = [
    p.critical > 0 && `${p.critical} critical`,
    p.high     > 0 && `${p.high} high`,
    p.medium   > 0 && `${p.medium} medium`,
  ].filter(Boolean).join(' · ');

  return (
    <div
      className="animate-fade-in-up relative w-full max-w-[85%] rounded-xl border border-line border-l-[3px] bg-surface-2 px-4 py-3 text-sm text-fg shadow-[var(--shadow-panel)]"
      style={{ borderLeftColor: borderColor }}
    >
      {/* Agent header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="w-1.5 h-1.5 rounded-full bg-fg-faint" />
        <span className="text-xs text-fg-secondary font-semibold">Analysis</span>
        {msg.cost != null && (
          <span className="text-[10px] text-fg-faint font-mono ml-0.5">${msg.cost.toFixed(4)}</span>
        )}
      </div>

      {/* Title row */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="font-bold text-[15px]">
          <span className={ok ? 'text-success' : 'text-danger'}>{ok ? '✓' : '✗'}</span>{' '}
          Quality Review Complete
        </div>
        {p.score != null && (
          <span className="text-[12px] font-mono text-fg-muted">{p.score}/10</span>
        )}
        {hasData && (
          <span className={`text-[10.5px] px-2 py-0.5 rounded font-mono font-bold border ${
            ok ? 'text-success bg-success/10 border-success/20'
               : 'text-danger bg-danger/10 border-danger/20'
          }`}>
            {p.verdict}
          </span>
        )}
      </div>

      {/* Stats row */}
      {(p.audited != null || p.issueCount != null) && (
        <div className="flex items-center gap-1.5 text-[12px] text-fg-secondary mb-0 flex-wrap">
          {p.audited   != null && <span>{p.audited} audited</span>}
          {p.approved  != null && <span className="text-fg-faint">·</span>}
          {p.approved  != null && <span>{p.approved} approved</span>}
          {p.issueCount != null && <span className="text-fg-faint">·</span>}
          {p.issueCount != null && (
            <span className={p.issueCount > 0 ? 'text-danger font-medium' : 'text-success'}>
              {p.issueCount} issue{p.issueCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}

      {/* Collapsible details */}
      {(p.issueLines.length > 0 || p.reason || (!ok && severitySummary)) && (
        <div className="border-t border-line mt-3">
          <button
            onClick={() => setShowDetails(v => !v)}
            className="flex items-center gap-1.5 w-full py-2 bg-transparent border-none cursor-pointer text-fg-muted text-[10.5px] font-bold uppercase tracking-[.07em] hover:text-fg-secondary transition-colors"
          >
            <Chevron open={showDetails} />
            {ok ? 'Audit details' : 'Issues found'}
            {severitySummary && (
              <span className="ml-auto text-fg-faint normal-case tracking-normal font-normal text-[11px]">
                {severitySummary}
              </span>
            )}
          </button>

          {showDetails && (
            <div className="pb-2 space-y-1.5">
              {p.reason && (
                <p className="text-[12px] text-fg-secondary leading-relaxed px-1 mb-2">{p.reason}</p>
              )}
              {p.issueLines.map((issue, i) => (
                <IssueRow key={i} issue={issue} />
              ))}
              {p.issueLines.length === 0 && ok && (
                <p className="text-[12px] text-fg-secondary px-1">
                  {p.audited} items audited — no issues found.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
