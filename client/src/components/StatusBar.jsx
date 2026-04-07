const STATUS_LABELS = {
  FILES_SAVED: 'Files saved',
  INITIALIZED: 'Initialized',
  RESEARCH_COMPLETE: 'Research complete',
  JD_ENHANCED: 'JD enhanced',
  ANALYSIS_COMPLETE: 'Analysis complete',
  REVIEW_COMPLETE: 'Review complete',
  TONE_ANALYZED: 'Tone analyzed',
  CV_BUILDING: 'Building CV…',
  CV_TAILORED: 'CV complete',
  REVIEW_FAILED: 'Review failed',
};

export function StatusBar({ status, activeAgent }) {
  const label = STATUS_LABELS[status] ?? status ?? 'Idle';

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-700 text-xs text-slate-400">
      <span>
        Pipeline:{' '}
        <span className={`font-medium ${status === 'CV_TAILORED' ? 'text-green-400' : status === 'REVIEW_FAILED' ? 'text-red-400' : 'text-violet-400'}`}>
          {label}
        </span>
      </span>
      {activeAgent && (
        <span>
          Active agent: <span className="font-medium text-slate-200">{activeAgent}</span>
        </span>
      )}
    </div>
  );
}
