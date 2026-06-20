import { useState } from 'react';
import { agentLabel } from '../agentLabels';

// Turn a 0–10 fit score into plain words anyone understands.
function fitWording(score) {
  if (score == null) return null;
  if (score >= 8)   return 'a strong match';
  if (score >= 6.5) return 'a good match';
  if (score >= 5)   return 'a moderate match';
  if (score >= 3.5) return 'a partial match';
  return 'a stretch for now';
}

// ── Parser ────────────────────────────────────────────────────────────────────
function parseReviewMsg(raw) {
  // buildReviewSummary emits markdown-bold labels (e.g. "**Overall Verdict:** REJECTED").
  // Strip emphasis markers first so the label regexes below see "Overall Verdict: REJECTED" —
  // otherwise the "**" between the colon and the value breaks \s* and only the score parses,
  // collapsing every review to a contentless red ✗.
  const text       = raw.replace(/\*+/g, '');
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

  // Use inline style for border-left color to avoid Tailwind safelist issues
  const borderColor = ok ? 'var(--success)' : p.verdict === 'REJECTED' ? 'var(--danger)' : 'var(--line-strong)';

  const severitySummary = [
    p.critical > 0 && `${p.critical} critical`,
    p.high     > 0 && `${p.high} high`,
    p.medium   > 0 && `${p.medium} medium`,
  ].filter(Boolean).join(' · ');

  const fit = fitWording(p.score);

  return (
    <div
      className="animate-fade-in-up relative w-full max-w-[85%] rounded-xl border border-line border-l-[3px] bg-surface-2 px-4 py-3 text-sm text-fg shadow-[var(--shadow-panel)]"
      style={{ borderLeftColor: borderColor }}
    >
      {/* Agent header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="w-1.5 h-1.5 rounded-full bg-fg-faint" />
        <span className="text-xs text-fg-secondary font-semibold">{agentLabel('Analysis')}</span>
        {msg.cost != null && (
          <span className="text-[10px] text-fg-faint font-mono ml-0.5">${msg.cost.toFixed(4)}</span>
        )}
      </div>

      {/* Title — plain language */}
      <div className="font-bold text-[15px] mb-2">
        <span className={ok ? 'text-success' : 'text-danger'}>{ok ? '✓' : '✗'}</span>{' '}
        {ok ? 'Your details all check out' : 'A few things need another look'}
      </div>

      {/* Plain-language summary */}
      {ok ? (
        <p className="text-[13px] text-fg-secondary leading-relaxed mb-2">
          We went through everything in your background and it all holds up — nothing looks made up or exaggerated.
        </p>
      ) : (
        <p className="text-[13px] text-fg-secondary leading-relaxed mb-2">
          Before we build your CV, a couple of things in the analysis need checking. See what to review below.
        </p>
      )}

      {/* Fit score in words */}
      {p.score != null && fit && (
        <p className="text-[13px] text-fg leading-relaxed mb-1">
          Match for this role: <strong className="font-semibold">{p.score} out of 10</strong> — {fit}.
        </p>
      )}

      {/* Collapsible details — exact numbers kept here for the curious */}
      {(p.issueLines.length > 0 || p.reason || p.audited != null) && (
        <div className="border-t border-line mt-3">
          <button
            onClick={() => setShowDetails(v => !v)}
            className="flex items-center gap-1.5 w-full py-2 bg-transparent border-none cursor-pointer text-fg-muted text-[10.5px] font-bold uppercase tracking-[.07em] hover:text-fg-secondary transition-colors"
          >
            <Chevron open={showDetails} />
            {ok ? 'What we checked' : 'What to review'}
            {!ok && severitySummary && (
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
              {p.audited != null && (
                <p className="text-[12px] text-fg-secondary leading-relaxed px-1 mb-2">
                  We checked {p.audited} detail{p.audited !== 1 ? 's' : ''} drawn from your CV and the job ad
                  {p.approved != null && <> — {p.approved} are fully backed by what you provided</>}
                  {p.issueCount != null && p.issueCount > 0
                    ? <>, and {p.issueCount} need{p.issueCount !== 1 ? '' : 's'} another look.</>
                    : <>, with nothing to flag.</>}
                </p>
              )}
              {p.issueLines.map((issue, i) => (
                <IssueRow key={i} issue={issue} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
