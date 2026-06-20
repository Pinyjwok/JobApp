import { agentLabel } from '../agentLabels';

export function AgentTimeline({ turns }) {
  return (
    <div className="w-56 shrink-0 border-l border-line bg-surface flex flex-col overflow-hidden">
      <div className="px-4 py-2.5 border-b border-line text-xs font-medium text-fg-muted tracking-wide uppercase">
        Timeline
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-0">
        {turns.length === 0 && (
          <p className="text-xs text-fg-faint italic">No turns yet</p>
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
                <div className={`w-2 h-2 rounded-full mt-1 flex-shrink-0 ${isLast ? 'bg-accent' : 'bg-fg-faint'}`} />
                {i < turns.length - 1 && (
                  <div className="w-px flex-1 bg-line min-h-[24px]" />
                )}
              </div>
              {/* Content */}
              <div className="pb-3 min-w-0">
                <span className={`text-xs font-medium truncate block ${isLast ? 'text-fg' : 'text-fg-secondary'}`}>
                  {agentLabel(turn.agent)}
                </span>
                <div className="flex gap-2 text-[10px] text-fg-faint mt-0.5">
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
