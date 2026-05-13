import { useState } from 'react';

export function GapInterviewModal({ gaps, onSubmit }) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [visited, setVisited] = useState(new Set());

  const gap = gaps[index];
  const total = gaps.length;
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

  const answered = !!answers[gap.id]?.trim();
  const isLast = index === total - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md">
      <div className="animate-fade-in-up bg-gradient-to-b from-slate-800 to-slate-900 border border-slate-700/50 rounded-2xl p-8 w-full max-w-lg shadow-2xl shadow-violet-950/20 flex flex-col gap-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white tracking-tight">Gap Interview</h2>
              <p className="text-xs text-slate-400">Your answers strengthen the CV tailoring</p>
            </div>
          </div>
          <span className="text-xs text-slate-500 bg-slate-800/60 border border-slate-700/40 rounded-lg px-2.5 py-1">
            {index + 1} / {total}
          </span>
        </div>

        {/* Progress bar */}
        <div className="w-full h-1 bg-slate-700/50 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-all duration-300"
            style={{ width: `${((index + 1) / total) * 100}%` }}
          />
        </div>

        {/* Card */}
        <div className="flex flex-col gap-4">
          {/* Tier badge + question */}
          <div className="flex items-start gap-2">
            <span className={`mt-0.5 shrink-0 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md ${
              gap.tier === 'Baseline'
                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
                : 'bg-slate-700/50 text-slate-400 border border-slate-600/30'
            }`}>
              {gap.tier}
            </span>
            <p className="text-sm font-medium text-slate-200 leading-relaxed">{gap.gap_text}</p>
          </div>

          {/* Hint */}
          {gap.mitigation_strategy && (
            <p className="text-xs text-slate-500 leading-relaxed border-l-2 border-slate-700 pl-3">
              {gap.mitigation_strategy}
            </p>
          )}

          {/* Textarea */}
          <textarea
            value={answers[gap.id] ?? ''}
            onChange={e => handleAnswer(e.target.value)}
            onFocus={() => markVisited(gap.id)}
            placeholder="Describe any relevant experience, training, or context…"
            rows={4}
            className="w-full bg-slate-800/60 border border-slate-700/50 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20 resize-none transition-all"
          />

          {/* Skip warning */}
          <div className="flex items-center justify-between">
            <button
              onClick={handleSkip}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1.5 group"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 9l3 3m0 0l-3 3m3-3H8m13 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Skip
              <span className="text-slate-600 group-hover:text-slate-500 transition-colors">— may reduce tailoring quality for this requirement</span>
            </button>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={handleBack}
            disabled={index === 0}
            className="px-4 py-2 rounded-xl text-sm font-medium border border-slate-700/50 text-slate-400 hover:text-slate-200 hover:border-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
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
                  ? 'bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-lg shadow-violet-600/20'
                  : 'bg-slate-700/40 text-slate-500 cursor-not-allowed'
              }`}
            >
              Submit answers
            </button>
          ) : (
            <button
              onClick={handleNext}
              className="px-5 py-2 rounded-xl text-sm font-medium bg-slate-700/60 hover:bg-slate-700 text-slate-200 border border-slate-600/40 transition-all active:scale-[0.98]"
            >
              Next →
            </button>
          )}
        </div>

        {/* Submit hint when on last card but not all visited */}
        {isLast && !allVisited && (
          <p className="text-xs text-slate-600 text-center -mt-3">
            Review all gaps before submitting ({gaps.filter(g => !visited.has(g.id)).length} remaining)
          </p>
        )}
      </div>
    </div>
  );
}
