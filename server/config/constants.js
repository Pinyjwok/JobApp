import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PROJECT_DIR   = join(__dirname, '..', '..');
export const WORKSPACE_DIR = join(PROJECT_DIR, 'workspace');
export const SNAPSHOTS_DIR = join(PROJECT_DIR, 'workspace-snapshots');
export const HISTORY_FILE  = join(PROJECT_DIR, 'chat_history.json');

export const AGENT_FOREGROUND = new Set([
  'Main Orchestrator', 'ProjectSetup', 'Researcher', 'Reviewer',
  'Assembly Coordinator', 'Style Negotiator',
  'Profile Builder', 'Skills Curator', 'History Formatter',
  'Credentials Formatter', 'Cover Letter Writer',
  'Style Reviewer', 'Integrity Checker', 'Document Formatter',
]);

// Sequential assembly phase map — phaseNumber → agent config
// outputFile: null for SR/IC which write cv_assembly_state.json directly
export const ASSEMBLY_PHASES = {
  1: { agent: 'Style Negotiator',     inputNode: 'style_negotiator_input',     outputFile: 'sn_output.json'  },
  2: { agent: 'Profile Builder',       inputNode: 'profile_builder_input',       outputFile: 'pb_output.json'  },
  3: { agent: 'Skills Curator',        inputNode: 'skills_curator_input',        outputFile: 'sc_output.json'  },
  4: { agent: 'History Formatter',     inputNode: 'history_formatter_input',     outputFile: 'hf_output.json'  },
  5: { agent: 'Credentials Formatter', inputNode: 'credentials_formatter_input', outputFile: 'cf_output.json'  },
  6: { agent: 'Cover Letter Writer',   inputNode: 'cover_letter_writer_input',   outputFile: 'clw_output.json' },
  7: { agent: 'Style Reviewer',        inputNode: 'style_reviewer_input',        outputFile: null              },
  8: { agent: 'Integrity Checker',     inputNode: 'integrity_checker_input',     outputFile: null              },
  9: { agent: 'Document Formatter',    inputNode: 'document_formatter_input',    outputFile: 'df_output.json'  },
};

export const INPUT_NODE_MAP = {
  'FILES_SAVED':        'extractor_input',
  'INITIALIZED':        'researcher_input',
  'RESEARCH_COMPLETE':  'jd_enhancer_input',
  'JD_ENHANCED':        'analyst_background_input',
  'PARALLEL_ANALYSIS':  ' Message',
  'GAP_INTERVIEW':      'reviewer_input',
  'CV_BUILDING':        ' Message',
};

export const HAPPY_PATH = {
  'FILES_SAVED':        'Extractor',
  'INITIALIZED':        'Researcher',
  'RESEARCH_COMPLETE':  'JD Enhancer',
  'RESEARCH_PARTIAL':   'Main Orchestrator',
  'JD_ENHANCED':        'Analyst',
  'PARALLEL_ANALYSIS':  'Tone Analyst',
  'GAP_INTERVIEW':      'Reviewer',
  'CV_BUILDING':        'Main Orchestrator',
  'STYLE_NEGOTIATING':  'Style Negotiator',
};

export const EXCEPTION_STATUSES = new Set([
  'REVIEW_FAILED', 'RESEARCH_FAILED', 'ANALYSIS_FAILED',
  'EXTRACTION_FAILED', 'CV_TAILORED',
  'INTEGRITY_FAILED', 'STYLE_FAILED',
]);

export const AUTO_FIRE_STATUSES = new Set([
  'FILES_SAVED', 'INITIALIZED',
  // REVIEW_COMPLETE removed — handled specially: server starts SN interview directly
]);

export const EXCEPTION_ACTION_BUTTONS = {
  'REVIEW_FAILED': [
    { id: 'redo_analyst',     label: 'Redo analysis',      variant: 'ghost'   },
    { id: 'redo_researcher',  label: 'Redo research',       variant: 'ghost'   },
    { id: 'redo_jd_enhancer', label: 'Redo JD enhancement', variant: 'ghost'   },
    { id: 'accept_anyway',    label: 'Accept & proceed',    variant: 'primary' },
    { id: 'details',          label: 'Show details',        variant: 'ghost'   },
  ],
  'RESEARCH_FAILED': [
    { id: 'research_retry',  label: 'Retry research',                    variant: 'primary' },
    { id: 'research_skip',   label: 'Skip & continue (not recommended)', variant: 'ghost'   },
  ],
  'ANALYSIS_FAILED': [
    { id: 'analysis_retry',           label: 'Retry analysis',      variant: 'primary' },
    { id: 'analysis_redo_researcher', label: 'Redo research first',  variant: 'ghost'   },
  ],
};

const CV_ASSEMBLY_PHASES = [
  { phase_number: 1, phase_name: 'Style Negotiation',      agent: 'Style Negotiator',     status: 'PENDING', completed_at: null, data: null },
  { phase_number: 2, phase_name: 'Profile Building',       agent: 'Profile Builder',       status: 'PENDING', completed_at: null, data: null },
  { phase_number: 3, phase_name: 'Skills Curation',        agent: 'Skills Curator',        status: 'PENDING', completed_at: null, data: null },
  { phase_number: 4, phase_name: 'History Formatting',     agent: 'History Formatter',     status: 'PENDING', completed_at: null, data: null },
  { phase_number: 5, phase_name: 'Credentials Formatting', agent: 'Credentials Formatter', status: 'PENDING', completed_at: null, data: null },
  { phase_number: 6, phase_name: 'Cover Letter Writing',   agent: 'CoverLetter Writer',    status: 'PENDING', completed_at: null, data: null },
  { phase_number: 7, phase_name: 'Style Review',           agent: 'Style Reviewer',        status: 'PENDING', completed_at: null, data: null },
  { phase_number: 8, phase_name: 'Integrity Check',        agent: 'Integrity Checker',     status: 'PENDING', completed_at: null, data: null },
  { phase_number: 9, phase_name: 'Document Formatting',    agent: 'Document Formatter',    status: 'PENDING', completed_at: null, data: null },
];

export const WORKSPACE_SCAFFOLD = {
  'project_meta.json': {
    company_name: '', position_title: '', sector: '',
    cv_source: 'cv_raw.txt', jd_source: 'jd_raw.txt',
    created_at: null, version: '1.0',
  },
  'research_output.json':  {},
  'enhanced_jd.json':      {},
  'review_audit.json':     {},
  'tailored_cv.json':      {},
  'cv_assembly_state.json': {
    current_phase: 1,
    metadata: { started_at: null, last_updated: null, status: 'ACTIVE', total_phases: 9, completed_phases: 0 },
    phases: CV_ASSEMBLY_PHASES,
    user_request: null,
    final_cv: null,
    change_log: [],
  },
  'candidate_profile.json': {},
  'gap_analysis.json':      {},
  'style_findings.json':    {},
  'sn_output.json':         {},
  'pb_output.json':         {},
  'sc_output.json':         {},
  'hf_output.json':         {},
  'cf_output.json':         {},
  'clw_output.json':        {},
  'df_output.json':         {},
};
