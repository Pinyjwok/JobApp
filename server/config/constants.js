import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PROJECT_DIR   = join(__dirname, '..', '..');
// JOBAPP_WORKSPACE_DIR lets tests point the workspace readers at a fixture dir; unset in production.
export const WORKSPACE_DIR = process.env.JOBAPP_WORKSPACE_DIR || join(PROJECT_DIR, 'workspace');
export const SNAPSHOTS_DIR = join(PROJECT_DIR, 'workspace-snapshots');
export const HISTORY_FILE  = join(PROJECT_DIR, 'chat_history.json');

// Watchdog: max wait for a single KEMU node round-trip before declaring a stall (#2).
export const DISPATCH_TIMEOUT_MS = 180_000;

// Per-node timeout overrides. Heavy LLM nodes (deep analysis) legitimately run well past the
// 180s default — a too-short watchdog turns a slow-but-fine run into a false STALL. Keep the
// default tight for the fast linear agents; give the slow ones a generous budget.
export const NODE_TIMEOUT_MS = {
  analyst_background_input: 600_000, // Analyst full gap analysis — routinely minutes
  // JD Enhancer synthesizes research + JD into ad-anchored reqs + candidate-facing prose —
  // same document-synthesis weight as the assembly agents below, not a fast linear pass.
  jd_enhancer_input:        420_000,
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
// server derives routing from the FILE, not the LLM's typed sentence (which the linear agents can drop). The
// per-agent status/join effect lives in the callers (they need dispatch.js helpers); this map
// owns only `file`, the `ready(data)` shape guard, and `stamp`. Mirrors the assembly phases, which
// already route this way (mergePhaseOutput / _phaseHasRealOutput).
//
// `stamp` — dot-path of the artifact's completion timestamp, or null when it has none. Agents write
// the literal `__DATE_TODAY__` token there and the server is the only source of "now": awaitOutputReady
// stamps this the instant the artifact is proven fresh+valid, which is the truest "agent finished" time
// we have. Substitution alone is NOT enough — it only runs on the display path (broadcast + GET
// /api/workspace), so an unstamped field keeps the raw token ON DISK, where the next agent's ReadFile
// and any server-side date math both see garbage. Stamp every timestamp an agent is asked to write.
export const COMPLETION_CONTRACTS = {
  Extractor:     { file: 'candidate_profile.json', ready: d => !!d?.personal_info?.name && Array.isArray(d?.work_history), stamp: null },
  Researcher:    { file: 'research_output.json',   ready: d => d?.research_data === null || !!d?.research_data?.mission_values, stamp: 'completed_at' },
  'JD Enhancer': { file: 'enhanced_jd.json',       ready: d => !!d?.candidate_brief?.headline, stamp: 'metadata.enhanced_at' },
  // Analysis join (background, no next-status): each branch flips a boolean and calls checkJoin.
  // register + flagged_issues are written by the TA itself before it returns; the {} scaffold fails.
  'Tone Analyst':{ file: 'style_findings.json',    ready: d => Array.isArray(d?.flagged_issues) && typeof d?.register === 'string' && d.register.length > 0, stamp: 'analyzed_at' },
  Analyst:       { file: 'gap_analysis.json',      ready: d => Array.isArray(d?.requirements), stamp: 'metadata.analyzed_at' },
};

export const AGENT_FOREGROUND = new Set([
  'Main Orchestrator', 'ProjectSetup', 'Researcher',
  'Style Negotiator',
  'Profile Builder', 'Skills Curator', 'History Formatter',
  'Credentials Formatter', 'Cover Letter Writer',
  'Style Reviewer', 'Integrity Checker',
]);

// Sequential assembly phase map — phaseNumber → agent config
// outputFile: null for SR/IC which write cv_assembly_state.json directly
// Integrity Checker (8) is the LAST phase. A clean IC pass dispatches phase 9, which has no entry here
// → dispatchAssemblyPhase's no-phase branch sets CV_TAILORED + broadcastCompletion. (Document Formatter,
// the old phase 9, was scrapped 2026-07-20 — its df_output.json/tailored_cv.json were consumed by nothing;
// the finished-doc render comes from buildDocumentData over the per-section files, not DF.)
// `task` is the plain-language imperative sent as the dispatch query (dispatch.js
// dispatchAssemblyPhase). It replaces a single generic `__build_section__ role="…" company="…"`
// token that used to be shared by every phase. No agent actually reads the role/company params —
// each one pulls position_title/company_name straight from project_meta.json — so the token was
// pure noise, and worse: a bare `__build_section__` reads to a smaller model like an unset
// parameter list rather than a go-ahead. Haiku-class agents (History Formatter, Skills Curator,
// Credentials Formatter) would sometimes treat it as an incomplete request and stall instead of
// starting. Each phase now gets an explicit, agent-specific command sentence instead.
export const ASSEMBLY_PHASES = {
  1: { agent: 'Style Negotiator',     inputNode: 'style_negotiator_input',     outputFile: 'sn_output.json',
       task: 'Run the style negotiation interview now.' },
  2: { agent: 'Profile Builder',       inputNode: 'profile_builder_input',       outputFile: 'pb_output.json',
       task: 'Write the professional profile section now.' },
  3: { agent: 'Skills Curator',        inputNode: 'skills_curator_input',        outputFile: 'sc_output.json',
       task: 'Curate the skills section now.' },
  4: { agent: 'History Formatter',     inputNode: 'history_formatter_input',     outputFile: 'hf_output.json',
       task: 'Format the career history section now.' },
  5: { agent: 'Credentials Formatter', inputNode: 'credentials_formatter_input', outputFile: 'cf_output.json',
       task: 'Format the education and certifications section now.' },
  6: { agent: 'Cover Letter Writer',   inputNode: 'cover_letter_writer_input',   outputFile: 'clw_output.json',
       task: 'Write the cover letter now.' },
  7: { agent: 'Style Reviewer',        inputNode: 'style_reviewer_input',        outputFile: null,
       task: 'Run the final style review and polish pass now.' },
  8: { agent: 'Integrity Checker',     inputNode: 'integrity_checker_input',     outputFile: null,
       task: 'Run the integrity check now.' },
};

// Same-class fix as ASSEMBLY_PHASES.task: the linear main-pipeline dispatch paths
// (pipeline-state.js auto-fire, runLinearDispatch's default) were sending the bare '__auto__'
// sentinel as these agents' entire turn content. '__auto__' is only meaningful to Main
// Orchestrator's own prompt (the one place it's referenced in recipe.kemu) — Extractor,
// Researcher, and JD Enhancer's instructions never mention it, so each turn handed them an
// unexplained token instead of an instruction. ProjectSetup is intentionally absent: its happy
// path is server-owned (runProjectSetup, no KEMU round-trip) and its rare MODE B KEMU fallback
// (message.js fireUserMessage) always forwards the real user chat message, never '__auto__'.
export const LINEAR_TASKS = {
  Extractor:     'Extract the candidate profile from the uploaded CV now.',
  Researcher:    'Research the company and sector now.',
  'JD Enhancer': 'Enhance the job description now.',
};

// Generic fallback for any dispatch that reaches sendToNodeAndWait with no query — replaces the
// old '__auto__' sentinel, which no agent besides Main Orchestrator's own prompt ever defined.
export const DEFAULT_TASK = 'Start now.';

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
    { id: 'accept_anyway',    label: 'Looks good - keep going',  variant: 'primary' },
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
  'cv_assembly_state.json': {
    current_phase: 1,
    metadata: { started_at: null, last_updated: null, status: 'ACTIVE', total_phases: 8, completed_phases: 0 },
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
  // analyst_validator_verdict.json is now SERVER-written (2026-07-16), not KEMU-written: the audit
  // moved off the inline analyst_validator tool call into server/lib/analyst-validator.js. Nothing
  // reads it anymore — it is a pure audit trail for an otherwise invisible internal QA step. Kept
  // scaffolded so the file always exists with a readable shape.
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
};
