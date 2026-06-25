// Three user-facing phases — internal pipeline stages collapse into these.
const PHASES = [
  { key: 'analyse', label: 'Analyse' },
  { key: 'polish',  label: 'Polish' },
  { key: 'build',   label: 'Build' },
];

// status → { phase, done: [phases completed], substep }
const STATUS_MAP = {
  FILES_SAVED:       { phase: 'analyse', done: [],                    substep: 'Reading your CV and the job ad…' },
  INITIALIZED:       { phase: 'analyse', done: [],                    substep: 'Researching the company…' },
  RESEARCH_COMPLETE: { phase: 'analyse', done: [],                    substep: 'Reviewing the research with you…' },
  RESEARCH_CONFIRM:  { phase: 'analyse', done: [],                    substep: 'Sharpening the job description…' },
  JD_ENHANCED:       { phase: 'analyse', done: [],                    substep: 'Analysing how well you fit…' },
  PARALLEL_ANALYSIS: { phase: 'analyse', done: [],                    substep: 'Analysing how well you fit…' },
  ANALYSIS_COMPLETE: { phase: 'analyse', done: [],                    substep: 'Checking the analysis…' },
  GAP_INTERVIEW:     { phase: 'analyse', done: [],                    substep: 'Reviewing the gaps with you…' },
  REVIEW_COMPLETE:   { phase: 'polish',  done: ['analyse'],           substep: 'Learning your writing voice…' },
  STYLE_NEGOTIATING: { phase: 'polish',  done: ['analyse'],           substep: 'Agreeing your style with you…' },
  TONE_ANALYZED:     { phase: 'build',   done: ['analyse', 'polish'], substep: 'Building your documents…' },
  CV_BUILDING:       { phase: 'build',   done: ['analyse', 'polish'], substep: 'Building your documents…' },
  CV_TAILORED:       { phase: 'build',   done: ['analyse', 'polish', 'build'], substep: 'Your documents are ready.' },
};

const FAILED_MAP = {
  EXTRACTION_FAILED: { phase: 'analyse', done: [],                    substep: "Could not read a file — let's fix that." },
  RESEARCH_FAILED:   { phase: 'analyse', done: [],                    substep: "Research hit a snag — let's retry." },
  ANALYSIS_FAILED:   { phase: 'analyse', done: [],                    substep: "Analysis hit a snag — let's retry." },
  REVIEW_FAILED:     { phase: 'analyse', done: [],                    substep: 'A few things to review together.' },
  STYLE_FAILED:      { phase: 'build',   done: ['analyse', 'polish'], substep: 'A style check needs your input.' },
  INTEGRITY_FAILED:  { phase: 'build',   done: ['analyse', 'polish'], substep: 'An accuracy check needs your input.' },
};

// Overall pipeline progress 0–100 (UI-05). Gives continuous forward motion across the ~15 internal
// stages so a long single step (the Integrity Checker can run ~20 min) doesn't read as "frozen".
const PROGRESS = {
  FILES_SAVED: 5, INITIALIZED: 12, RESEARCH_COMPLETE: 20, RESEARCH_CONFIRM: 24,
  JD_ENHANCED: 30, PARALLEL_ANALYSIS: 34, ANALYSIS_COMPLETE: 40, GAP_INTERVIEW: 44,
  REVIEW_COMPLETE: 50, STYLE_NEGOTIATING: 56, TONE_ANALYZED: 60, CV_BUILDING: 64,
  CV_TAILORED: 100,
};
// Within the build phase, advance by which assembly agent is running.
const ASSEMBLY_PROGRESS = {
  'Style Negotiator': 58, 'Profile Builder': 66, 'Skills Curator': 70, 'History Formatter': 74,
  'Credentials Formatter': 78, 'CoverLetter Writer': 82, 'Style Reviewer': 88,
  'Integrity Checker': 93, 'Document Formatter': 97,
};

const ASSEMBLY_SUBSTEP = {
  'Style Negotiator':       'Agreeing your style with you…',
  'Profile Builder':        'Writing your profile — review & approve.',
  'Skills Curator':         'Curating your skills — review & approve.',
  'History Formatter':      'Shaping your work history — review & approve.',
  'Credentials Formatter':  'Formatting your credentials — review & approve.',
  'CoverLetter Writer':     'Drafting your cover letter — review & approve.',
  'Style Reviewer':         'Polishing the wording…',
  'Integrity Checker':      'Double-checking every claim…',
};

export function StatusBar({ status, activeAgent, running = false }) {
  const failed = FAILED_MAP[status];
  const info = STATUS_MAP[status];

  const activePhase = failed?.phase ?? info?.phase ?? null;
  const donePhases = new Set(failed?.done ?? info?.done ?? []);

  let substep = failed?.substep ?? info?.substep ?? null;
  if (info?.phase === 'build' && activeAgent && ASSEMBLY_SUBSTEP[activeAgent]) {
    substep = ASSEMBLY_SUBSTEP[activeAgent];
  }

  const isComplete = status === 'CV_TAILORED';
  const hasFailure = Boolean(failed);

  const pct = hasFailure
    ? (failed.phase === 'build' ? 85 : 35)
    : (info?.phase === 'build' && activeAgent && ASSEMBLY_PROGRESS[activeAgent]) || PROGRESS[status] || 0;

  return (
    <div className="px-5 py-3 bg-surface border-b border-line">
      {status && (
        <div className="h-[3px] w-full max-w-md mx-auto mb-3 bg-line rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ease-out ${
              hasFailure ? 'bg-danger' : isComplete ? 'bg-success' : 'bg-accent'
            } ${running && !isComplete && !hasFailure ? 'animate-pulse-soft' : ''}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      <div className="flex items-center justify-center gap-1 max-w-md mx-auto">
        {PHASES.map((phase, i) => {
          const isDone = donePhases.has(phase.key) || isComplete;
          const isActive = phase.key === activePhase && !isDone;
          const isFailedHere = hasFailure && phase.key === activePhase;

          let dotColor, labelColor, connectorColor;
          if (isFailedHere) {
            dotColor = 'bg-danger';
            labelColor = 'text-danger font-semibold';
            connectorColor = 'bg-line';
          } else if (isDone) {
            dotColor = 'bg-success';
            labelColor = 'text-success';
            connectorColor = 'bg-success/40';
          } else if (isActive) {
            dotColor = 'bg-accent animate-pulse-soft';
            labelColor = 'text-accent font-semibold';
            connectorColor = 'bg-line';
          } else {
            dotColor = 'bg-fg-faint';
            labelColor = 'text-fg-faint';
            connectorColor = 'bg-line';
          }

          return (
            <div key={phase.key} className="flex items-center">
              <div className="flex items-center gap-1.5">
                <div className={`w-2.5 h-2.5 rounded-full transition-all duration-500 ${dotColor}`} />
                <span className={`text-xs leading-none transition-colors ${labelColor}`}>
                  {phase.label}
                </span>
              </div>
              {i < PHASES.length - 1 && (
                <div className={`h-px w-10 mx-2 flex-shrink-0 transition-colors duration-500 ${isDone ? connectorColor : 'bg-line'}`} />
              )}
            </div>
          );
        })}
      </div>

      {substep && (
        <div className="flex items-center justify-center mt-2">
          <span className={`text-xs transition-colors ${hasFailure ? 'text-danger' : isComplete ? 'text-success' : 'text-fg-secondary'}`}>
            {!isComplete && !hasFailure && <span className="text-accent mr-1">▸</span>}
            {substep}
          </span>
        </div>
      )}
    </div>
  );
}
