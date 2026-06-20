import { useState, useEffect } from 'react';

// Integrity-review modal — shown when the accuracy check (Integrity Checker) flags claims it couldn't
// back up. One card per flagged claim, grouped so skip-traced items read together. Each card resolves to
// remove it, back it with evidence, or keep it; the whole set submits in one POST (ic_remediation_submit).
// Framing rule: skipped ≠ false — copy is a gentle reminder, never blame.

// Why a claim was flagged, in plain language. Skip-traced claims get the gentle "came up earlier" line.
function whyFlagged(c) {
  if (c.from_skipped_gap) {
    return "This came up in your earlier questions but wasn't covered yet, so we couldn't back it up.";
  }
  switch (c.evidence_status) {
    case 'DATES_UNVERIFIED':  return "The dates here don't match what we have on file.";
    case 'UNVERIFIED_DETAIL': return "We couldn't verify this against your CV.";
    default:                  return "We couldn't find this in your CV or your interview answers.";
  }
}

const GROUPS = [
  { key: 'skipped', heading: "A few things we couldn't back up yet",
    blurb: 'These came up in your earlier questions. Add proof now, or leave them out.' },
  { key: 'other', heading: 'Other things to check',
    blurb: "We couldn't match these to your CV or answers." },
];

export function IntegrityReviewModal({ claims = [], onSubmit, onHide, minimized = false }) {
  const [decisions, setDecisions] = useState({});

  // Seed each card with its category default ('none' stays unset so the user must choose).
  useEffect(() => {
    const seeded = {};
    for (const c of claims) {
      if (c.defaultAction && c.defaultAction !== 'none') seeded[c.id] = { action: c.defaultAction, evidence: '' };
    }
    setDecisions(seeded);
  }, [claims]);

  function setAction(id, action) {
    setDecisions(prev => ({ ...prev, [id]: { ...prev[id], action } }));
  }
  function setEvidence(id, evidence) {
    setDecisions(prev => ({ ...prev, [id]: { ...prev[id], action: 'evidence', evidence } }));
  }
  function removeAll() {
    setDecisions(prev => {
      const next = { ...prev };
      for (const c of claims) {
        if (next[c.id]?.action === 'evidence') continue; // don't clobber a proof in progress
        next[c.id] = { ...next[c.id], action: 'remove' };
      }
      return next;
    });
  }

  // A card is resolved once it has an action; an evidence choice also needs non-empty text.
  function resolved(c) {
    const d = decisions[c.id];
    if (!d?.action) return false;
    if (d.action === 'evidence') return !!d.evidence?.trim();
    return true;
  }
  const remaining = claims.filter(c => !resolved(c)).length;
  const ready = remaining === 0;

  function handleSubmit() {
    if (!ready) return;
    onSubmit(decisions);
  }

  const byGroup = {
    skipped: claims.filter(c => c.group === 'skipped'),
    other:   claims.filter(c => c.group !== 'skipped'),
  };

  function actionLabels(c) {
    const opts = [];
    if (c.canProvideEvidence) opts.push({ value: 'evidence', label: 'Add proof' });
    opts.push({ value: 'remove', label: c.from_skipped_gap ? 'Leave it out' : 'Remove it' });
    if (c.evidence_status === 'DATES_UNVERIFIED') opts.unshift({ value: 'fix_dates', label: 'Fix the dates' });
    opts.push({ value: 'keep', label: 'Keep it as-is' });
    return opts;
  }

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md ${minimized ? 'hidden' : ''}`}>
      <div className="animate-fade-in-up bg-surface border border-line-strong rounded-2xl p-8 w-full max-w-xl shadow-[var(--shadow-float)] flex flex-col gap-5 max-h-[88vh]">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center shadow-[var(--shadow-panel)]">
              <svg className="w-4 h-4 text-accent-fg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-fg tracking-tight">A quick accuracy check</h2>
              <p className="text-xs text-fg-muted">A few claims need backing up — or leaving out</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={removeAll}
              className="text-xs text-fg-secondary hover:text-fg bg-surface-2 border border-line hover:border-line-strong rounded-lg px-2.5 py-1 transition-all"
            >
              Leave all out ({claims.length})
            </button>
            {onHide && (
              <button
                onClick={onHide}
                title="Hide — finish later to continue"
                className="text-xs text-fg-secondary hover:text-fg bg-surface-2 border border-line hover:border-line-strong rounded-lg px-2.5 py-1 transition-all"
              >
                Hide
              </button>
            )}
          </div>
        </div>

        {/* Claim list */}
        <div className="flex flex-col gap-5 overflow-y-auto pr-1">
          {GROUPS.map(g => {
            const items = byGroup[g.key];
            if (!items.length) return null;
            return (
              <div key={g.key} className="flex flex-col gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{g.heading}</p>
                  <p className="text-xs text-fg-faint mt-0.5">{g.blurb}</p>
                </div>
                {items.map(c => {
                  const d = decisions[c.id] ?? {};
                  return (
                    <div key={c.id} className="bg-surface-2 border border-line rounded-xl p-4 flex flex-col gap-3">
                      <div>
                        <p className="text-sm text-fg leading-snug">“{c.claim}”</p>
                        <p className="text-xs text-fg-muted mt-1">
                          <span className="text-fg-faint">In {c.sectionLabel} · </span>{whyFlagged(c)}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {actionLabels(c).map(opt => {
                          const active = d.action === opt.value;
                          return (
                            <button
                              key={opt.value}
                              onClick={() => opt.value === 'evidence' ? setAction(c.id, 'evidence') : setAction(c.id, opt.value)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all active:scale-[0.98] ${
                                active
                                  ? 'bg-accent/10 border-accent text-accent'
                                  : 'bg-surface border-line text-fg-secondary hover:border-line-strong hover:text-fg'
                              }`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                      {d.action === 'evidence' && (
                        <textarea
                          value={d.evidence ?? ''}
                          onChange={e => setEvidence(c.id, e.target.value)}
                          autoFocus
                          placeholder="Where does this come from? e.g. I ran this on the cobas analyser during my placement at…"
                          rows={2}
                          className="w-full bg-surface border border-line-strong rounded-lg px-3 py-2 text-sm text-fg placeholder-fg-faint focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/20 resize-none transition-all"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 pt-1 border-t border-line -mx-8 px-8 pt-4">
          {!ready && (
            <p className="text-xs text-fg-faint">
              {remaining} still need{remaining === 1 ? 's' : ''} a choice
            </p>
          )}
          <div className="flex-1" />
          <button
            onClick={handleSubmit}
            disabled={!ready}
            className={`px-5 py-2 rounded-xl text-sm font-medium transition-all active:scale-[0.98] ${
              ready
                ? 'bg-accent hover:brightness-110 text-accent-fg shadow-[var(--shadow-panel)]'
                : 'bg-surface-2 border border-line text-fg-faint cursor-not-allowed'
            }`}
          >
            Apply changes
          </button>
        </div>
      </div>
    </div>
  );
}
