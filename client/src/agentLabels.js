// Friendly, plain-language display names for the pipeline agents.
// The internal agent names (keys) are routing identifiers and must NOT change — this is a
// presentation-only map applied when rendering a bubble/timeline header, so a job applicant
// sees "Accuracy check" instead of "Integrity Checker".
const AGENT_LABELS = {
  'ProjectSetup':          'Setup',
  'Extractor':             'Your CV details',
  'Researcher':            'Company research',
  'JD Enhancer':           'The job, in detail',
  'Analyst':               'How you fit',
  'Analysis':              'Quality check',
  'Tone Analyst':          'Your writing voice',
  'Style Negotiator':      'Your writing style',
  'Profile Builder':       'Your profile',
  'Skills Curator':        'Your skills',
  'History Formatter':     'Your work history',
  'Credentials Formatter': 'Education & certifications',
  'CoverLetter Writer':    'Your cover letter',
  'Cover Letter Writer':   'Your cover letter',
  'Style Reviewer':        'Final polish',
  'Integrity Checker':     'Accuracy check',
  'Main Orchestrator':     'Assistant',
  'System':                'System',
};

export function agentLabel(name) {
  return AGENT_LABELS[name] ?? name;
}
