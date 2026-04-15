export function AgentTimeline({ turns }) {
  return (
    <div className="w-56 shrink-0 border-l border-slate-800 bg-slate-900/30 flex flex-col overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-800 text-xs font-medium text-slate-400 tracking-wide uppercase">
        Timeline
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-0">
        {turns.length === 0 && (
          <p className="text-xs text-slate-700 italic">No turns yet</p>
        )}
        {turns.map((turn, i) => {
          const elapsed = i > 0
            ? ((turn.timestamp - turns[i - 1].timestamp) / 1000).toFixed(1) + 's'
            : null;
          const isLast = i === turns.length - 1;
          return (
            <div key={i} className="relative flex gap-3">
              {/* Vertical line + dot */}
              <div className="flex flex-col items-center">
                <div className={`w-2 h-2 rounded-full mt-1 flex-shrink-0 ${isLast ? 'bg-violet-400 shadow-sm shadow-violet-400/30' : 'bg-slate-600'}`} />
                {i < turns.length - 1 && (
                  <div className="w-px flex-1 bg-slate-800 min-h-[24px]" />
                )}
              </div>
              {/* Content */}
              <div className="pb-3 min-w-0">
                <span className={`text-xs font-medium truncate block ${isLast ? 'text-slate-200' : 'text-slate-400'}`}>
                  {turn.agent}
                </span>
                <div className="flex gap-2 text-[10px] text-slate-600 mt-0.5">
                  {elapsed && <span>+{elapsed}</span>}
                  {turn.cost != null && <span className="font-mono">${turn.cost.toFixed(4)}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
