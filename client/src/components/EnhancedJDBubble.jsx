import { useState, useEffect } from 'react';
import { Eyebrow, CheckIcon, InfoIcon, Disclosure } from './primitives';

// ── Guided enhanced-JD review (MVP: read-only) ────────────────────────────────
// Shown at the JD_ENHANCED gate (server tags the message kind:'enhanced_jd'). Makes the JD Enhancer's
// work visible without dumping the whole ad: "What this role needs" is grouped (Must have / Nice to
// have / What you'd be doing) into collapsible, scannable lists — required is open by default, the rest
// collapse to a one-line preview. "How your research shaped this" renders the agent's candidate_brief;
// it does NOT re-render the company research (that card was already shown) — it links back to it.
// While the user reviews, a quiet "analysing" strip signals the background fit-analysis: the server
// fires the Analyst speculatively at this gate (fireSpeculativeAnalyst), so its latency hides behind
// the review. No in-place editing in this MVP — "Re-read the job ad" is the escape hatch for a misread.

const norm = arr => (Array.isArray(arr) ? arr.map(s => String(s).trim()).filter(Boolean) : []);

// Right-facing caret that rotates open (mirrors Disclosure's ▸/▾ but as an icon).
function Caret({ open }) {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .18s', flexShrink: 0 }}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

// ── One collapsible requirement group (read-only) ─────────────────────────────
// Dense list rows with a small marker (no per-row card chrome). `marker` is { cls, el }.
function ReqGroup({ label, items, open, onToggle, hint, marker }) {
  const count = items.length;
  if (!count) return null;

  return (
    <div className="border-t border-line first:border-t-0">
      <button
        type="button"
        onClick={onToggle}
        className="group flex w-full items-center gap-2 py-2.5 text-left"
      >
        <span className="text-fg-faint transition-colors group-hover:text-fg-secondary">
          <Caret open={open} />
        </span>
        <span className="text-[13px] font-semibold text-fg">{label}</span>
        <span className="rounded-full bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-fg-muted tabular-nums">
          {count}
        </span>
        {hint && !open && <span className="ml-auto truncate text-[11.5px] text-fg-faint">{hint}</span>}
      </button>

      {open && (
        <div className="animate-fade-in pb-2.5 pl-5">
          <ul className="flex flex-col">
            {items.map((v, i) => (
              <li key={i} className="flex items-start gap-2.5 py-1 text-[12.5px] leading-snug text-fg-secondary">
                <span className={`mt-[3px] ${marker.cls}`}>{marker.el}</span>
                <span>{v}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function EnhancedJDBubble({ msg, onAction, onJDConfirm }) {
  const [ejd, setEjd]         = useState(null);
  const [meta, setMeta]       = useState(null);
  const [loading, setLoading] = useState(true);

  const [submitted, setSubmitted] = useState(false);
  const [openGroup, setOpenGroup] = useState('req');       // 'req' | 'pref' | 'resp' | null
  const [researchOpen, setResearchOpen] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/workspace?file=enhanced_jd.json').then(r => r.json()).catch(() => null),
      fetch('/api/workspace?file=project_meta.json').then(r => r.json()).catch(() => null),
    ]).then(([e, m]) => {
      setEjd(e); setMeta(m);
    }).finally(() => setLoading(false));
  }, []);

  const brief    = ejd?.candidate_brief ?? null;
  const company  = meta?.company_name || null;
  const position = meta?.position_title || null;

  const reqd = norm(ejd?.requirements?.required_qualifications);
  const pref = norm(ejd?.requirements?.preferred_qualifications);
  const resp = norm(ejd?.role_details?.key_responsibilities);

  function handleContinue() {
    if (submitted) return;
    setSubmitted(true);
    onJDConfirm?.(null);   // MVP: no in-place edits — the reviewed JD is confirmed as-is
  }

  function handleRedo() {
    if (submitted) return;
    setSubmitted(true);
    onAction?.('jd_review_redo');
  }

  const toggle = id => () => setOpenGroup(g => (g === id ? null : id));

  const summary = brief?.headline
    || (position
        ? <>We read the <strong className="text-fg font-semibold">{position}</strong> ad{company ? <> at <strong className="text-fg font-semibold">{company}</strong></> : ''} and framed how you'd succeed in it.</>
        : 'Here’s the role you’re applying for, sharpened with what we learned.');

  const roleInContext   = brief?.role_in_context || ejd?.role_details?.overview || null;
  const whatToEmphasise = norm(brief?.what_to_emphasise);

  return (
    <div className="animate-fade-in-up relative w-full max-w-[85%] rounded-xl border border-line border-l-[3px] border-l-line-strong bg-surface-2 px-4 py-3.5 text-sm text-fg shadow-[var(--shadow-panel)]">

      {/* Agent header — no cost, no internal badges */}
      <div className="flex items-center gap-2 mb-2">
        <span className="w-1.5 h-1.5 rounded-full bg-fg-faint" />
        <span className="text-xs text-fg-secondary font-semibold">Job description, sharpened</span>
      </div>

      <div className="font-bold text-base mb-1 flex items-center gap-2">
        <span className="text-success"><CheckIcon /></span> Here&rsquo;s the role you&rsquo;re applying for
      </div>
      <p className="text-sm text-fg-secondary leading-relaxed mb-3">{summary}</p>

      {loading && (
        <div className="flex items-center gap-2 py-2 text-xs text-fg-faint">
          <span className="w-3 h-3 rounded-full border border-fg-faint border-t-transparent animate-spin" />
          Loading the enhanced job description…
        </div>
      )}

      {!loading && !ejd && (
        <p className="text-xs text-fg-faint italic">
          Enhanced job description not available - enhanced_jd.json not found in workspace.
        </p>
      )}

      {!loading && ejd && (
        <>
          {/* ── What this role needs (grouped, collapsible) ── */}
          <div className="rounded-xl border border-line bg-surface overflow-hidden">
            <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
              <Eyebrow tone="accent" icon={<CheckIcon className="w-3.5 h-3.5" />}>What this role needs</Eyebrow>
            </div>

            <p className="px-3 pb-1.5 text-[11.5px] text-fg-faint">
              Pulled straight from the ad — this is what we&rsquo;ll measure your CV against.
            </p>

            <div className="px-3 pb-2">
              <ReqGroup
                label="Must have" items={reqd}
                open={openGroup === 'req'} onToggle={toggle('req')} hint={reqd[0]}
                marker={{ cls: 'text-accent', el: <CheckIcon className="w-3 h-3" /> }}
              />
              <ReqGroup
                label="Nice to have" items={pref}
                open={openGroup === 'pref'} onToggle={toggle('pref')} hint={pref[0]}
                marker={{ cls: 'text-fg-faint', el: <span className="block w-1 h-1 rounded-full bg-current" /> }}
              />
              <ReqGroup
                label="What you’d be doing" items={resp}
                open={openGroup === 'resp'} onToggle={toggle('resp')} hint={resp[0]}
                marker={{ cls: 'text-fg-faint', el: <span className="block w-1 h-1 rounded-full bg-current" /> }}
              />
            </div>
          </div>

          {/* ── How your research shaped this (synthesis, not a research re-dump) ── */}
          {(roleInContext || whatToEmphasise.length > 0) && (
            <div className="border-t border-line mt-3 pt-3">
              <Eyebrow tone="muted" icon={<InfoIcon className="w-3.5 h-3.5" />} className="mb-2">How your research shaped this</Eyebrow>

              {roleInContext && (
                <div className="rounded-lg border border-line border-l-2 border-l-success/60 bg-success/5 px-3 py-2 mb-2">
                  <div className="font-mono text-[10px] font-bold uppercase tracking-wide text-success mb-1">The role, in context</div>
                  <p className="text-[12.5px] text-fg-secondary leading-relaxed m-0">{roleInContext}</p>
                </div>
              )}

              {whatToEmphasise.length > 0 && (
                <div className="rounded-lg border border-line border-l-2 border-l-warn/60 bg-warn/5 px-3 py-2">
                  <div className="font-mono text-[10px] font-bold uppercase tracking-wide text-warn mb-1.5">What to emphasise</div>
                  <ul className="m-0 pl-4 list-disc text-[12.5px] text-fg-secondary leading-relaxed space-y-0.5">
                    {whatToEmphasise.map((t, i) => <li key={i}>{t}</li>)}
                  </ul>
                </div>
              )}

              <div className="mt-2">
                <Disclosure
                  title="Where did this come from?"
                  open={researchOpen}
                  onToggle={() => setResearchOpen(v => !v)}
                >
                  <p className="text-[12.5px] text-fg-secondary leading-relaxed">
                    This builds on the company research shown earlier in this chat - its mission, culture,
                    strengths and hiring focus. We didn&rsquo;t repeat it here; scroll up to revisit the
                    research card.
                  </p>
                </Disclosure>
              </div>
            </div>
          )}

          {/* ── Quiet "productive wait" strip: signals the background fit-analysis is running ── */}
          {!submitted && (
            <div className="mt-3 rounded-lg border border-line bg-surface-3/60 px-3 py-2">
              <div className="flex items-center gap-2 text-[11.5px] text-fg-muted">
                <span className="flex gap-0.5">
                  <span className="w-1 h-1 rounded-full bg-accent jd-scan-dot" />
                  <span className="w-1 h-1 rounded-full bg-accent jd-scan-dot" style={{ animationDelay: '.2s' }} />
                  <span className="w-1 h-1 rounded-full bg-accent jd-scan-dot" style={{ animationDelay: '.4s' }} />
                </span>
                Matching your CV against these requirements — take a moment to review while we work.
              </div>
              <div className="mt-1.5 h-0.5 w-full overflow-hidden rounded-full bg-line">
                <div className="jd-scan-bar h-full w-full" />
              </div>
            </div>
          )}

          {/* ── Gate buttons ── */}
          <div className="flex gap-2 mt-3.5 pt-3 border-t border-line">
            <button
              onClick={handleContinue}
              disabled={submitted}
              className="text-[13px] font-semibold rounded-lg px-3.5 py-2 bg-accent text-accent-fg border border-accent disabled:opacity-50 disabled:cursor-default hover:opacity-90 transition-opacity"
            >
              Looks good - continue
            </button>
            <button
              onClick={handleRedo}
              disabled={submitted}
              className="text-[13px] font-semibold rounded-lg px-3.5 py-2 bg-surface text-fg-secondary border border-line disabled:opacity-50 disabled:cursor-default hover:border-line-strong transition-colors"
            >
              Re-read the job ad
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/*
  Add these keyframes once to your global stylesheet (index.css) for the "analysing" strip.
  They degrade gracefully if omitted — dots simply stay static.

  @keyframes jd-shimmer   { 0% { background-position:-140% 0 } 100% { background-position:240% 0 } }
  @keyframes jd-pulse-dot { 0%,100% { opacity:.35; transform:scale(.85) } 50% { opacity:1; transform:scale(1) } }
  .jd-scan-dot { animation: jd-pulse-dot 1.2s ease-in-out infinite; }
  .jd-scan-bar {
    background: linear-gradient(90deg, transparent, oklch(from var(--accent) l c h / .55), transparent);
    background-size: 40% 100%; background-repeat: no-repeat;
    animation: jd-shimmer 1.5s linear infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    .jd-scan-dot, .jd-scan-bar { animation: none; }
  }
*/
