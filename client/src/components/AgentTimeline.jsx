export function AgentTimeline({ turns }) {
  return (
    <div className="w-52 shrink-0 border-l border-slate-700 bg-slate-900 flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-700 text-xs font-medium text-slate-400">
        Agent Timeline
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {turns.length === 0 && (
          <p className="text-xs text-slate-600 italic">No turns yet</p>
        )}
        {turns.map((turn, i) => {
          const elapsed = i > 0
            ? ((turn.timestamp - turns[i - 1].timestamp) / 1000).toFixed(1) + 's'
            : null;
          return (
            <div key={i} className="text-xs">
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />
                <span className="text-slate-300 truncate font-medium">{turn.agent}</span>
              </div>
              <div className="ml-2.5 flex gap-2 text-slate-500 mt-0.5">
                {elapsed && <span>+{elapsed}</span>}
                {turn.cost != null && <span>${turn.cost.toFixed(4)}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
