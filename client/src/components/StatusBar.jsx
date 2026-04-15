const ASSEMBLY_AGENTS = [
  'Style Negotiator', 'Profile Builder', 'Skills Curator', 'History Formatter',
  'Credentials Formatter', 'CoverLetter Writer', 'Style Reviewer', 'Integrity Checker',
];

const ASSEMBLY_SHORT = {
  'Style Negotiator': 'Style',
  'Profile Builder': 'Profile',
  'Skills Curator': 'Skills',
  'History Formatter': 'History',
  'Credentials Formatter': 'Credentials',
  'CoverLetter Writer': 'Cover Letter',
  'Style Reviewer': 'Style Review',
  'Integrity Checker': 'Integrity',
  'Assembly Coordinator': '',
};

const STAGES = [
  { key: 'setup',    label: 'Setup',    doneAt: ['FILES_SAVED', 'INITIALIZED', 'RESEARCH_COMPLETE', 'JD_ENHANCED', 'ANALYSIS_COMPLETE', 'REVIEW_COMPLETE', 'TONE_ANALYZED', 'CV_BUILDING', 'CV_TAILORED'] },
  { key: 'extract',  label: 'Extract',  doneAt: ['INITIALIZED', 'RESEARCH_COMPLETE', 'JD_ENHANCED', 'ANALYSIS_COMPLETE', 'REVIEW_COMPLETE', 'TONE_ANALYZED', 'CV_BUILDING', 'CV_TAILORED'] },
  { key: 'research', label: 'Research', doneAt: ['RESEARCH_COMPLETE', 'JD_ENHANCED', 'ANALYSIS_COMPLETE', 'REVIEW_COMPLETE', 'TONE_ANALYZED', 'CV_BUILDING', 'CV_TAILORED'] },
  { key: 'enhance',  label: 'Enhance',  doneAt: ['JD_ENHANCED', 'ANALYSIS_COMPLETE', 'REVIEW_COMPLETE', 'TONE_ANALYZED', 'CV_BUILDING', 'CV_TAILORED'] },
  { key: 'analyse',  label: 'Analyse',  doneAt: ['ANALYSIS_COMPLETE', 'REVIEW_COMPLETE', 'TONE_ANALYZED', 'CV_BUILDING', 'CV_TAILORED'] },
  { key: 'review',   label: 'Review',   doneAt: ['REVIEW_COMPLETE', 'TONE_ANALYZED', 'CV_BUILDING', 'CV_TAILORED'], failAt: ['REVIEW_FAILED'] },
  { key: 'tone',     label: 'Tone',     doneAt: ['TONE_ANALYZED', 'CV_BUILDING', 'CV_TAILORED'] },
  { key: 'assemble', label: 'Assemble', doneAt: ['CV_TAILORED'] },
  { key: 'done',     label: 'Done',     doneAt: ['CV_TAILORED'] },
];

const ACTIVE_AT = {
  FILES_SAVED:       'extract',
  INITIALIZED:       'research',
  RESEARCH_COMPLETE: 'enhance',
  JD_ENHANCED:       'analyse',
  ANALYSIS_COMPLETE: 'review',
  REVIEW_COMPLETE:   'tone',
  TONE_ANALYZED:     'assemble',
  CV_BUILDING:       'assemble',
  CV_TAILORED:       'done',
  REVIEW_FAILED:     'review',
  EXTRACTION_FAILED: 'extract',
  RESEARCH_FAILED:   'research',
  ANALYSIS_FAILED:   'analyse',
};

const FAILED_STAGES = {
  REVIEW_FAILED:     'review',
  EXTRACTION_FAILED: 'extract',
  RESEARCH_FAILED:   'research',
  ANALYSIS_FAILED:   'analyse',
};

export function StatusBar({ status, activeAgent }) {
  const activeKey = ACTIVE_AT[status] ?? null;
  const failedKey = FAILED_STAGES[status] ?? null;

  const assemblyPhase = activeAgent && ASSEMBLY_AGENTS.includes(activeAgent)
    ? ASSEMBLY_SHORT[activeAgent] ?? activeAgent
    : null;

  return (
    <div className="px-5 py-3 bg-slate-900/50 border-b border-slate-800">
      <div className="flex items-center gap-1">
        {STAGES.map((stage, i) => {
          const isDone = stage.doneAt.includes(status);
          const isActive = stage.key === activeKey && !isDone;
          const isFailed = stage.key === failedKey;

          let dotColor, labelColor, connectorColor;
          if (isFailed) {
            dotColor = 'bg-red-500 shadow-red-500/30 shadow-sm';
            labelColor = 'text-red-400';
            connectorColor = 'bg-red-900/50';
          } else if (isDone) {
            dotColor = 'bg-emerald-400 shadow-emerald-400/20 shadow-sm';
            labelColor = 'text-emerald-400';
            connectorColor = 'bg-emerald-800/40';
          } else if (isActive) {
            dotColor = 'bg-violet-400 shadow-violet-400/30 shadow-sm animate-pulse-soft';
            labelColor = 'text-violet-300 font-semibold';
            connectorColor = 'bg-slate-700';
          } else {
            dotColor = 'bg-slate-700';
            labelColor = 'text-slate-600';
            connectorColor = 'bg-slate-800';
          }

          return (
            <div key={stage.key} className="flex items-center">
              <div className="flex flex-col items-center gap-1 min-w-[44px]">
                <div className={`w-2 h-2 rounded-full transition-all duration-500 ${dotColor}`} />
                <span className={`text-[10px] leading-none transition-colors ${labelColor}`}>
                  {stage.label}
                </span>
                {stage.key === 'assemble' && assemblyPhase && (
                  <span className="text-[9px] text-violet-400/80 font-medium leading-none">
                    {assemblyPhase}
                  </span>
                )}
              </div>
              {i < STAGES.length - 1 && (
                <div className={`h-px w-4 flex-shrink-0 transition-colors duration-500 ${isDone ? connectorColor : 'bg-slate-800'}`} />
              )}
            </div>
          );
        })}

        {/* Active agent chip */}
        <div className="flex-1 flex justify-end">
          {activeAgent && (
            <div className="flex items-center gap-1.5 bg-slate-800/60 border border-slate-700/50 rounded-full px-2.5 py-1">
              <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse-soft" />
              <span className="text-[10px] text-slate-300 font-medium">{activeAgent}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
