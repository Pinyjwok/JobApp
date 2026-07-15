import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PROJECT_DIR   = join(__dirname, '..', '..');
export const WORKSPACE_DIR = join(PROJECT_DIR, 'workspace');
export const SNAPSHOTS_DIR = join(PROJECT_DIR, 'workspace-snapshots');
export const HISTORY_FILE  = join(PROJECT_DIR, 'chat_history.json');

// Watchdog: max wait for a single KEMU node round-trip before declaring a stall (#2).
export const DISPATCH_TIMEOUT_MS = 180_000;

// Per-node timeout overrides. Heavy LLM nodes (deep analysis) legitimately run well past the
// 180s default — a too-short watchdog turns a slow-but-fine run into a false STALL. Keep the
// default tight for the fast linear agents; give the slow ones a generous budget.
export const NODE_TIMEOUT_MS = {
  analyst_background_input: 600_000, // Analyst full gap analysis — routinely minutes
  // Assembly LLM nodes: full-document reasoning (style review, integrity check, section
  // authoring) legitimately runs past the 180s default. A too-tight watchdog turns a
  // slow-but-fine run into a false STALL with no output. Give them a generous budget.
  style_negotiator_input:     420_000,
  profile_builder_input:      420_000,
  skills_curator_input:       420_000,
  history_formatter_input:    420_000,
  credentials_formatter_input:420_000,
  cover_letter_writer_input:  420_000,
  style_reviewer_input:       420_000,
  // The Integrity Checker does a full forensic check of every generated line against the source CV +
  // accepted gap evidence — it is *designed* to be slow. This budget is a genuine-crash backstop only,
  // not a slowness policy: a long-but-healthy run salvages its verdict off disk (see dispatchAssemblyPhase).
  integrity_checker_input:    1_200_000,
  document_formatter_input:   420_000,
};

// Status-tag fallback (#1): linear agents whose resulting pipeline_status is deterministic.
// On a dropped `pipeline_status:` tag, the server infers the expected status and advances.
// Analyst/Tone Analyst finish via checkJoin() → GAP_INTERVIEW (no direct tag) — intentionally absent.
export const EXPECTED_STATUS = {
  ProjectSetup:  'FILES_SAVED',
  Extractor:     'INITIALIZED',
  Researcher:    'RESEARCH_COMPLETE',
  'JD Enhancer': 'JD_ENHANCED',
};

// Output-file completion contracts — the file-driven replacement for the fragile
// `pipeline_status:` prose tag. Each agent writes exactly one artifact whose presence + shape
// (+ mtime freshness, checked in awaitOutputReady) proves it actually finished this turn. The
// server derives routing from the FILE, not the LLM's typed sentence (which Flash drops). The
// per-agent status/join effect lives in the callers (they need dispatch.js helpers); this map
// owns only `file` + the `ready(data)` shape guard. Mirrors the assembly phases, which already
// route this way (mergePhaseOutput / _phaseHasRealOutput).
export const COMPLETION_CONTRACTS = {
  Extractor:     { file: 'candidate_profile.json', ready: d => !!d?.personal_info?.name && Array.isArray(d?.work_history) },
  Researcher:    { file: 'research_output.json',   ready: d => d?.research_data === null || !!d?.research_data?.mission_values },
  'JD Enhancer': { file: 'enhanced_jd.json',       ready: d => !!d?.candidate_brief?.headline },
  // Analysis join (background, no next-status): each branch flips a boolean and calls checkJoin.
  // register + flagged_issues are written by the TA itself before it returns; the {} scaffold fails.
  'Tone Analyst':{ file: 'style_findings.json',    ready: d => Array.isArray(d?.flagged_issues) && typeof d?.register === 'string' && d.register.length > 0 },
  Analyst:       { file: 'gap_analysis.json',      ready: d => Array.isArray(d?.requirements) },
};

export const AGENT_FOREGROUND = new Set([
  'Main Orchestrator', 'ProjectSetup', 'Researcher',
  'Style Negotiator',
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
  'CV_BUILDING':        ' Message',
};

export const HAPPY_PATH = {
  'FILES_SAVED':        'Extractor',
  'INITIALIZED':        'Researcher',
  'RESEARCH_COMPLETE':  'JD Enhancer',
  'RESEARCH_PARTIAL':   'Main Orchestrator',
  'JD_ENHANCED':        'Analyst',
  'PARALLEL_ANALYSIS':  'Tone Analyst',
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
    { id: 'redo_analyst',     label: 'Look at how I fit again', variant: 'ghost'   },
    { id: 'redo_researcher',  label: 'Research the company again', variant: 'ghost'   },
    { id: 'redo_jd_enhancer', label: 'Re-read the job ad',      variant: 'ghost'   },
    { id: 'accept_anyway',    label: 'Looks good — keep going',  variant: 'primary' },
    { id: 'details',          label: 'Show me the details',     variant: 'ghost'   },
  ],
  'RESEARCH_FAILED': [
    { id: 'research_retry',  label: 'Try the research again',  variant: 'primary' },
    { id: 'research_skip',   label: 'Skip it (not recommended)', variant: 'ghost'   },
  ],
  'ANALYSIS_FAILED': [
    { id: 'analysis_retry',           label: 'Try again',                variant: 'primary' },
    { id: 'analysis_redo_researcher', label: 'Research the company first', variant: 'ghost'   },
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
  // Validator verdict files — pre-created so the validator agents OVERWRITE an existing file.
  // KEMU's WriteFile creates a nested dir (<name>/<name>) when the target doesn't already exist,
  // which then breaks the server's readFileSync (EISDIR). Scaffolding them avoids the create path.
  // analyst_validator_verdict.json is file-backed again (2026-06-17): the inline analyst_validator
  // writes it as the source of truth; the server reads it to broadcast the verdict bubble and the
  // Analyst reads it for its APPROVE/FLAG/REJECT branch (no longer parses the tool-call text).
  'analyst_validator_verdict.json':  {},
  'tone_validator_verdict.json':     {},
  'assembly_validator_verdict.json': {},
  'sn_output.json':         {},
  'sn_working.json':        {},
  // Synthesized by the server (synthesizeStyleGuide in dispatch.js) at SN-interview completion from
  // style_findings.json + sn_output.json. Read by CLW / Style Reviewer / HF / CF for the target voice.
  // Was historically orphaned (no agent wrote it) → cover letter fell back to generic AI register.
  'style_guide.json':       {},
  'pb_output.json':         {},
  'sc_output.json':         {},
  'hf_output.json':         {},
  'cf_output.json':         {},
  'clw_output.json':        {},
  'df_output.json':         {},
};
