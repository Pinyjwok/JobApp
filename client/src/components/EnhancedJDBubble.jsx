import { useState, useEffect } from 'react';
import { Eyebrow, CheckIcon, InfoIcon, WarnIcon, Disclosure } from './primitives';

// ── Guided enhanced-JD review ─────────────────────────────────────────────────
// Shown at the JD_ENHANCED gate (server tags the message kind:'enhanced_jd'). Makes the JD Enhancer's
// work visible: "What this role needs" comes straight from the ad (requirements — editable, with a
// caution) and "How your research shaped this" renders the agent's user-facing candidate_brief. It does
// NOT re-render the company research (that card was already shown) — it links back to it instead.

const norm = arr => (Array.isArray(arr) ? arr.map(s => String(s).trim()).filter(Boolean) : []);
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// One editable requirement / responsibility row.
function ReqRow({ value, kind, editing, onChange, onRemove }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-line bg-surface px-2.5 py-2">
      {kind && (
        <span className={`mt-px shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide ${
          kind === 'pref' ? 'text-fg-muted bg-fg-faint/15' : 'text-accent bg-accent/10'
        }`}>
          {kind === 'pref' ? 'Pref' : 'Req'}
        </span>
      )}
      {editing ? (
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          className="flex-1 bg-transparent text-[13px] text-fg leading-snug outline-none border-b border-line focus:border-accent"
        />
      ) : (
        <span className="flex-1 text-[13px] text-fg leading-snug">{value}</span>
      )}
      {editing && (
        <button
          onClick={onRemove}
          className="shrink-0 font-mono text-[10px] text-fg-faint hover:text-danger transition-colors"
          title="Remove"
        >
          remove
        </button>
      )}
    </div>
  );
}

// An editable list of strings (required / preferred / responsibilities).
function EditableList({ items, setItems, kind, editing, addLabel }) {
  if (!items.length && !editing) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((v, i) => (
        <ReqRow
          key={i}
          value={v}
          kind={kind}
          editing={editing}
          onChange={nv => setItems(items.map((x, j) => (j === i ? nv : x)))}
          onRemove={() => setItems(items.filter((_, j) => j !== i))}
        />
      ))}
      {editing && (
        <button
          onClick={() => setItems([...items, ''])}
          className="self-start font-mono text-[11px] text-accent hover:opacity-75 transition-opacity"
        >
          + {addLabel}
        </button>
      )}
    </div>
  );
}

export function EnhancedJDBubble({ msg, onAction, onJDConfirm }) {
  const [ejd, setEjd]         = useState(null);
  const [meta, setMeta]       = useState(null);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing]   = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [respOpen, setRespOpen]   = useState(false);
  const [researchOpen, setResearchOpen] = useState(false);

  // Editable arrays — seeded once the JSON resolves.
  const [reqd, setReqd] = useState([]);
  const [pref, setPref] = useState([]);
  const [resp, setResp] = useState([]);
  const [orig, setOrig] = useState({ reqd: [], pref: [], resp: [] });

  useEffect(() => {
    Promise.all([
      fetch('/api/workspace?file=enhanced_jd.json').then(r => r.json()).catch(() => null),
      fetch('/api/workspace?file=project_meta.json').then(r => r.json()).catch(() => null),
    ]).then(([e, m]) => {
      setEjd(e); setMeta(m);
      if (e) {
        const r = norm(e?.requirements?.required_qualifications);
        const p = norm(e?.requirements?.preferred_qualifications);
        const k = norm(e?.role_details?.key_responsibilities);
        setReqd(r); setPref(p); setResp(k);
        setOrig({ reqd: r, pref: p, resp: k });
      }
    }).finally(() => setLoading(false));
  }, []);

  const brief    = ejd?.candidate_brief ?? null;
  const company  = meta?.company_name || null;
  const position = meta?.position_title || null;

  const changed =
    !sameList(reqd, orig.reqd) || !sameList(pref, orig.pref) || !sameList(resp, orig.resp);

  function handleContinue() {
    if (submitted) return;
    setSubmitted(true);
    setEditing(false);
    const edits = changed
      ? { required_qualifications: reqd, preferred_qualifications: pref, key_responsibilities: resp }
      : null;
    onJDConfirm?.(edits);
  }

  function handleRedo() {
    if (submitted) return;
    setSubmitted(true);
    onAction?.('jd_review_redo');
  }

  // Summary line: prefer the agent's headline, else describe what we did.
  const summary = brief?.headline
    || (position
        ? <>We read the <strong className="text-fg font-semibold">{position}</strong> ad{company ? <> at <strong className="text-fg font-semibold">{company}</strong></> : ''} and framed how you'd succeed in it.</>
        : 'Here’s the role you’re applying for, sharpened with what we learned.');

  // Research-shaped synthesis: candidate_brief if present, else a single line from the overview.
  const roleInContext   = brief?.role_in_context || ejd?.role_details?.overview || null;
  const whatToEmphasise = norm(brief?.what_to_emphasise);

  return (
    <div className="animate-fade-in-up relative w-full max-w-[85%] rounded-xl border border-line border-l-[3px] border-l-line-strong bg-surface-2 px-4 py-3 text-sm text-fg shadow-[var(--shadow-panel)]">

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
          {/* ── What this role needs (from the ad) ── */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Eyebrow tone="accent" icon={<CheckIcon className="w-3.5 h-3.5" />}>What this role needs</Eyebrow>
              {!submitted && (
                <button
                  onClick={() => setEditing(v => !v)}
                  className="font-mono text-[10.5px] text-fg-muted border border-line rounded-md px-2 py-0.5 hover:text-accent hover:border-accent/40 transition-colors"
                >
                  {editing ? 'Done' : '✎ Edit'}
                </button>
              )}
            </div>

            {editing && (
              <div className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/10 text-warn text-xs px-2.5 py-2 mb-2">
                <WarnIcon className="w-3.5 h-3.5 mt-px" />
                <span>
                  These come straight from the ad. Editing changes what we measure your CV against -
                  only fix something we mis-read; don&rsquo;t add requirements the ad doesn&rsquo;t list.
                </span>
              </div>
            )}

            <EditableList items={reqd} setItems={setReqd} kind="req"  editing={editing} addLabel="add required" />
            {(pref.length > 0 || editing) && (
              <div className="mt-1.5">
                <EditableList items={pref} setItems={setPref} kind="pref" editing={editing} addLabel="add preferred" />
              </div>
            )}

            {(resp.length > 0 || editing) && (
              <div className="mt-2">
                {editing ? (
                  <>
                    <div className="font-mono text-[10px] font-bold uppercase tracking-wide text-fg-muted mb-1">Key responsibilities</div>
                    <EditableList items={resp} setItems={setResp} kind={null} editing={editing} addLabel="add responsibility" />
                  </>
                ) : (
                  <Disclosure
                    title={`${resp.length} key responsibilit${resp.length === 1 ? 'y' : 'ies'}`}
                    open={respOpen}
                    onToggle={() => setRespOpen(v => !v)}
                  >
                    {resp.map((r, i) => (
                      <p key={i} className="text-[13px] text-fg-secondary leading-relaxed">• {r}</p>
                    ))}
                  </Disclosure>
                )}
              </div>
            )}
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

          {/* ── Gate buttons ── */}
          <div className="flex gap-2 mt-3.5 pt-3 border-t border-line">
            <button
              onClick={handleContinue}
              disabled={submitted}
              className="text-[13px] font-semibold rounded-lg px-3.5 py-2 bg-accent text-accent-fg border border-accent disabled:opacity-50 disabled:cursor-default hover:opacity-90 transition-opacity"
            >
              {changed ? 'Save & continue' : 'Looks good - continue'}
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
