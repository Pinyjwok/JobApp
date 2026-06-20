import { useState, useEffect } from 'react';

// Single-fire style interview. Mirrors GapInterviewModal (card deck, visited gating, minimize/hide), but
// each card is a style dimension with a three-way choice control, plus a final optional "additional notes"
// card carrying a severity dropdown. The whole answer set is submitted in one POST.

const SEVERITY_OPTIONS = [
  { value: 'high',   label: 'High — treat as a must' },
  { value: 'medium', label: 'Medium — strong preference' },
  { value: 'low',    label: 'Low — nice to have' },
];

const NOTE_ID = '__note__';

export function StyleInterviewModal({ groups, onSubmit, onHide, minimized = false }) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [note, setNote] = useState({ text: '', severity: 'medium' });
  const [visited, setVisited] = useState(new Set());

  // Fresh interview (new groups) must not inherit prior index/answers. Seed each dimension with the
  // default 'recommended' choice so a card is complete as soon as it's seen.
  useEffect(() => {
    setIndex(0);
    setNote({ text: '', severity: 'medium' });
    setVisited(new Set());
    const seeded = {};
    for (const g of groups) seeded[g.id] = { choice: 'recommended' };
    setAnswers(seeded);
  }, [groups]);

  // Cards = dimension groups + a trailing note card.
  const cards = [...groups, { id: NOTE_ID, isNote: true }];
  const total = cards.length;
  const card = cards[Math.min(index, Math.max(0, total - 1))];
  const isLast = index === total - 1;

  function markVisited(id) {
    setVisited(prev => new Set([...prev, id]));
  }

  function setChoice(id, choice) {
    setAnswers(prev => ({ ...prev, [id]: { ...prev[id], choice } }));
    markVisited(id);
  }

  function setCustomText(id, text) {
    setAnswers(prev => ({ ...prev, [id]: { ...prev[id], choice: 'customise', custom_text: text } }));
    markVisited(id);
  }

  // A dimension card is complete once it carries any choice. Customise-with-empty-text is allowed: the
  // server (buildSNOutput) already folds that case into keep_current, so blocking submit on it here only
  // dead-locks Skip/Apply for no reason. Note card is optional — always complete.
  function cardComplete(c) {
    if (c.isNote) return true;
    const a = answers[c.id];
    return !!(a && a.choice);
  }
  // The note card is optional — never require visiting it (otherwise an untouched text box blocks submit).
  const allReady = cards.every(c => c.isNote || (visited.has(c.id) && cardComplete(c)));
  const remaining = cards.filter(c => !c.isNote && !(visited.has(c.id) && cardComplete(c))).length;

  function handleNext() { markVisited(card.id); setIndex(index + 1); }
  function handleBack() { setIndex(index - 1); }
  function handleSubmit({ skipNote = false } = {}) {
    const payload = { ...answers };
    if (!skipNote && note.text.trim()) payload[NOTE_ID] = { text: note.text.trim(), severity: note.severity };
    onSubmit(payload);
  }

  if (!card) return null;

  const current = answers[card.id] ?? { choice: 'recommended' };

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md ${minimized ? 'hidden' : ''}`}>
      <div className="animate-fade-in-up bg-surface border border-line-strong rounded-2xl p-8 w-full max-w-lg shadow-[var(--shadow-float)] flex flex-col gap-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center shadow-[var(--shadow-panel)]">
              <svg className="w-4 h-4 text-accent-fg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-fg tracking-tight">Your writing style</h2>
              <p className="text-xs text-fg-muted">Set how your CV should read and sound</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-fg-muted bg-surface-2 border border-line rounded-lg px-2.5 py-1 whitespace-nowrap font-mono">
              {index + 1} / {total}
            </span>
            {onHide && (
              <button
                onClick={onHide}
                title="Hide — finish later to continue"
                className="text-xs text-fg-secondary hover:text-fg bg-surface-2 border border-line hover:border-line-strong rounded-lg px-2.5 py-1 transition-all flex items-center gap-1"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
                Hide
              </button>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full h-1 bg-line rounded-full overflow-hidden">
          <div className="h-full bg-accent transition-all duration-300" style={{ width: `${((index + 1) / total) * 100}%` }} />
        </div>

        {/* Card */}
        {card.isNote ? (
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="text-sm font-semibold text-fg">Anything else? <span className="text-fg-muted font-normal">(optional)</span></h3>
              <p className="text-xs text-fg-muted mt-1 leading-relaxed">A free-text note for anything the cards didn't cover. Importance tells the assembly agents how hard to weight it.</p>
            </div>
            <textarea
              value={note.text}
              onChange={e => setNote(n => ({ ...n, text: e.target.value }))}
              onFocus={() => markVisited(NOTE_ID)}
              placeholder="e.g. Keep my volunteering section — it's relevant to this role"
              rows={4}
              className="w-full bg-surface-2 border border-line-strong rounded-xl px-4 py-3 text-sm text-fg placeholder-fg-faint focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/20 resize-none transition-all"
            />
            <label className="flex items-center justify-between gap-3 text-xs text-fg-secondary">
              <span className="font-medium">Importance</span>
              <select
                value={note.severity}
                onChange={e => setNote(n => ({ ...n, severity: e.target.value }))}
                disabled={!note.text.trim()}
                className="flex-1 max-w-[16rem] bg-surface-2 border border-line-strong rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-accent/60 disabled:opacity-40 transition-all"
              >
                {SEVERITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <h3 className="text-sm font-semibold text-fg leading-snug">{card.title}</h3>

            {card.finding && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted mb-1">What the style analysis found</p>
                <p className="text-sm text-fg-secondary leading-relaxed whitespace-pre-line">{card.finding}</p>
              </div>
            )}

            {(card.examples ?? []).length > 0 && (
              <div className="flex flex-col gap-1.5 border-l-2 border-line pl-3">
                {card.examples.slice(0, 2).map((ex, i) => (
                  <p key={i} className="text-xs text-fg-muted italic leading-relaxed">{ex}</p>
                ))}
              </div>
            )}

            {card.recommendation && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted mb-1">Recommendation</p>
                <p className="text-sm text-fg leading-relaxed">{card.recommendation}</p>
              </div>
            )}

            {card.insight && (
              <p className="text-xs text-fg-faint italic leading-relaxed">{card.insight}</p>
            )}

            {/* Choice control */}
            <div className="flex flex-col gap-2 pt-1">
              {[
                { value: 'recommended',  label: 'Use recommended' },
                { value: 'keep_current', label: 'Keep current style' },
                { value: 'customise',    label: 'Customise…' },
              ].map(opt => {
                const active = current.choice === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setChoice(card.id, opt.value)}
                    className={`text-left px-4 py-2.5 rounded-xl text-sm font-medium border transition-all active:scale-[0.99] ${
                      active
                        ? 'bg-accent/10 border-accent text-accent'
                        : 'bg-surface-2 border-line text-fg-secondary hover:border-line-strong hover:text-fg'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}

              {current.choice === 'customise' && (
                <textarea
                  value={current.custom_text ?? ''}
                  onChange={e => setCustomText(card.id, e.target.value)}
                  placeholder="Describe your preference for this dimension…"
                  rows={3}
                  className="mt-1 w-full bg-surface-2 border border-line-strong rounded-xl px-4 py-3 text-sm text-fg placeholder-fg-faint focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/20 resize-none transition-all"
                />
              )}
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={handleBack}
            disabled={index === 0}
            className="px-4 py-2 rounded-xl text-sm font-medium border border-line text-fg-secondary hover:text-fg hover:border-line-strong disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            Back
          </button>

          <div className="flex-1" />

          {isLast ? (
            <div className="flex items-center gap-2">
              {card.isNote && !note.text.trim() && (
                <button
                  onClick={() => handleSubmit({ skipNote: true })}
                  disabled={!allReady}
                  className="px-4 py-2 rounded-xl text-sm font-medium border border-line text-fg-secondary hover:text-fg hover:border-line-strong disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >
                  Skip
                </button>
              )}
              <button
                onClick={() => handleSubmit()}
                disabled={!allReady}
                className={`px-5 py-2 rounded-xl text-sm font-medium transition-all active:scale-[0.98] ${
                  allReady
                    ? 'bg-accent hover:brightness-110 text-accent-fg shadow-[var(--shadow-panel)]'
                    : 'bg-surface-2 border border-line text-fg-faint cursor-not-allowed'
                }`}
              >
                Apply &amp; continue
              </button>
            </div>
          ) : (
            <button
              onClick={handleNext}
              className="px-5 py-2 rounded-xl text-sm font-medium bg-surface-2 hover:brightness-105 text-fg-secondary border border-line-strong transition-all active:scale-[0.98]"
            >
              Next →
            </button>
          )}
        </div>

        {isLast && !allReady && (
          <p className="text-xs text-fg-faint text-center -mt-3">
            Review all cards before applying ({remaining} need{remaining === 1 ? 's' : ''} a choice)
          </p>
        )}
      </div>
    </div>
  );
}
