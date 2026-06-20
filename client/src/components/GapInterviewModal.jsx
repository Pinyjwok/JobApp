import { useState, useEffect } from 'react';

export function GapInterviewModal({ gaps, accepted = [], onSubmit, onHide, minimized = false }) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [visited, setVisited] = useState(new Set());

  // A fresh interview (new gaps) must not inherit the prior run's index/answers/visited —
  // a stale index can exceed the new length and crash on gaps[index].
  useEffect(() => {
    setIndex(0);
    setAnswers({});
    setVisited(new Set());
  }, [gaps]);

  const total = gaps.length;
  // Clamp: the reset effect runs after render, so on the render where gaps shrank, a stale index
  // could otherwise index past the array.
  const gap = gaps[Math.min(index, Math.max(0, total - 1))];
  const allVisited = gaps.every(g => visited.has(g.id));

  function markVisited(id) {
    setVisited(prev => new Set([...prev, id]));
  }

  function handleAnswer(text) {
    setAnswers(prev => ({ ...prev, [gap.id]: text }));
    markVisited(gap.id);
  }

  function handleSkip() {
    setAnswers(prev => { const next = { ...prev }; delete next[gap.id]; return next; });
    markVisited(gap.id);
    if (index < total - 1) setIndex(index + 1);
  }

  function handleNext() {
    markVisited(gap.id);
    setIndex(index + 1);
  }

  function handleBack() {
    setIndex(index - 1);
  }

  function handleSubmit() {
    onSubmit(answers);
  }

  if (!gap) return null;

  const isLast = index === total - 1;
  const isReask = accepted.length > 0; // round ≥2: some claims already accepted, these need a better answer

  return (
    <div className={`animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md ${minimized ? 'hidden' : ''}`}>
      <div className="animate-modal-in bg-surface border border-line-strong rounded-2xl p-8 w-full max-w-lg shadow-[var(--shadow-float)] flex flex-col gap-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center shadow-[var(--shadow-panel)]">
              <svg className="w-4 h-4 text-accent-fg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-fg tracking-tight">A few quick questions</h2>
              <p className="text-xs text-fg-muted">
                {isReask ? 'A couple of answers need a bit more detail' : 'Your answers help us tailor your CV to this role'}
              </p>
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
          <div
            className="h-full bg-accent transition-all duration-300"
            style={{ width: `${((index + 1) / total) * 100}%` }}
          />
        </div>

        {/* Accepted ack strip (round ≥2) — claims already counted, shown read-only */}
        {accepted.length > 0 && (
          <div className="flex flex-col gap-1.5 rounded-xl border border-success/30 bg-success/10 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-success">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              {accepted.length} {accepted.length === 1 ? 'answer counted' : 'answers counted'}
            </div>
            <ul className="flex flex-col gap-1">
              {accepted.map((a, i) => (
                <li key={i} className="text-xs text-fg-secondary leading-relaxed pl-5">{a.gap_text}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Card */}
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-2">
            <span className={`mt-0.5 shrink-0 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md border ${
              gap.tier === 'Baseline'
                ? 'bg-warn/10 text-warn border-warn/30'
                : 'bg-surface-2 text-fg-muted border-line'
            }`}>
              {gap.tier === 'Baseline' ? 'Important' : 'Nice to have'}
            </span>
            <p className="text-sm font-medium text-fg leading-relaxed">{gap.gap_text}</p>
          </div>

          {gap.mitigation_strategy && (
            <p className={`text-xs leading-relaxed border-l-2 pl-3 ${
              isReask ? 'text-warn border-warn/40' : 'text-fg-muted border-line'
            }`}>
              {isReask && <span className="font-semibold">Needs more detail: </span>}
              {gap.mitigation_strategy}
            </p>
          )}

          <textarea
            value={answers[gap.id] ?? ''}
            onChange={e => handleAnswer(e.target.value)}
            onFocus={() => markVisited(gap.id)}
            placeholder="Describe any relevant experience, training, or context…"
            rows={4}
            className="w-full bg-surface-2 border border-line-strong rounded-xl px-4 py-3 text-sm text-fg placeholder-fg-faint focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/20 resize-none transition-all"
          />

          <div className="flex items-center justify-between">
            <button
              onClick={handleSkip}
              className="text-xs text-fg-muted hover:text-fg-secondary transition-colors flex items-center gap-1.5 group"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 9l3 3m0 0l-3 3m3-3H8m13 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Skip
              <span className="text-fg-faint group-hover:text-fg-muted transition-colors">— we'll leave this one out</span>
            </button>
          </div>
        </div>

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
            <button
              onClick={handleSubmit}
              disabled={!allVisited}
              className={`px-5 py-2 rounded-xl text-sm font-medium transition-all active:scale-[0.98] ${
                allVisited
                  ? 'bg-accent hover:brightness-110 text-accent-fg shadow-[var(--shadow-panel)]'
                  : 'bg-surface-2 border border-line text-fg-faint cursor-not-allowed'
              }`}
            >
              Done
            </button>
          ) : (
            <button
              onClick={handleNext}
              className="px-5 py-2 rounded-xl text-sm font-medium bg-surface-2 hover:brightness-105 text-fg-secondary border border-line-strong transition-all active:scale-[0.98]"
            >
              Next →
            </button>
          )}
        </div>

        {isLast && !allVisited && (
          <p className="text-xs text-fg-faint text-center -mt-3">
            Have a look at each question first ({gaps.filter(g => !visited.has(g.id)).length} to go)
          </p>
        )}
      </div>
    </div>
  );
}
