# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project Overview

**CV Optimization Multi-Agent System** - A KEMU-based workflow that transforms raw CV and job description files into tailored, ATS-compliant application materials through a 15-phase pipeline.

- **Platform:** KEMU (turn-based agent execution)
- **Routing:** Status-based using `project_memory.json.status` — simple switch statement, NO global variables
- **Routing Tool:** `SwitchAgent(target: ...)` — ChangeAgent does not exist
- **Tech Stack:** JSON state management, file-based context passing, evidence-based gap analysis

---

## Current Implementation Status

### ✅ All Agents Complete
| Agent | Version | File |
|-------|---------|------|
| Main Orchestrator | v5.3 | `main_orchestrator_agent_instructions.md` |
| ProjectSetup | v1.14 | `project_setup_agent_instructions.md` |
| Extractor | v2.1 | `extractor_agent_instructions.md` |
| Researcher | v2.0 | `researcher_agent_instructions.md` |
| JD Enhancer | v1.4 | `jd_enhancer_instructions.md` |
| Analyst | v2.3 | `analyst_agent_instructions.md` |
| Reviewer | v2.3 | `reviewer_agent_instructions.md` |
| Tone Analyst | v2.1 | `tone_analyst_agent_instructions.md` |
| Assembly Coordinator | v3.9 | `assembly_coordinator_agent_instructions.md` |
| Style Negotiator | v1.6 | `style_negotiator_instructions.md` |
| Profile Builder | v1.6 | `profile_builder_instructions.md` |
| Skills Curator | v1.6 | `skills_curator_agent_instructions.md` |
| History Formatter | v1.5 | `history_formatter_agent_instructions.md` |
| Credentials Formatter | v1.6 | `credentials_formatter_agent_instructions.md` |
| CoverLetter Writer | v1.4 | `coverletter_writer_agent_instructions.md` |
| Style Reviewer | v1.5 | `style_reviewer_agent_instructions.md` |
| Integrity Checker | v1.8 | `integrity_checker_agent_instructions.md` |

### ✅ TC05 Fixes Applied (2026-04-03) — 14 changes

All fixes from `TC05_Developer_Brief.md` applied. Full details in `.general/tests/TC05_Developer_Brief.md`.

**P0 fixes:**
- **Analyst v2.2**: Pre-write guard checks `research_data`/`enhanced_jd` intact before writing gap_analysis. Verify path fixed (`verified.status` → `verified.metadata.status`). `analyst_version` corrected to "2.1".
- **Integrity Checker v1.7**: Skills check now uses `verifyEvidence()` against `cv_raw.txt` (was checking candidateProfile only — missed fabricated skills). Status restricted to `"PASSED"` or `"FAILED"` only — `"VERIFIED_WITH_WARNINGS"` removed entirely.

**P1 fixes:**
- **Assembly Coordinator v3.6**: Completion writes now use ReadFile verification instead of try/catch (KEMU doesn't throw on write failure). Mandatory verify block before displaying completion. Banned narration outputs block with 5 real examples added.
- **Credentials Formatter v1.5**: Removed "same turn, no waiting" — SwitchAgent now fires on next turn after user message.
- **Tone Analyst v1.7**: `register` field added at root of `style_guide.json` ("peer-collegial"/"confident-professional"/"direct-practical"). CoverLetter Writer reads this field.
- **Main Orchestrator v4.0**: Critical Rule 11 added — SwitchAgent target must use double quotes only. No single quotes inside the value.

**P2 fixes:**
- **Profile Builder v1.6**: `experience_years`, `profile_statement`, `key_themes` added to `phases[1].data`.
- **Style Negotiator v1.5**: `negotiation_summary` field added to `phases[0].data`.
- **Reviewer v2.0**: Gap interview rewritten as single-gap-per-invocation (turn-based). Interim write after each answer persists evidence across re-invocations. Top-level `candidate_provided_evidence[]` array built. Skip marker added.
- **ProjectSetup v1.11**: Guard comment added — do NOT extract `companyName`/`positionTitle`/`sector` from JD content.
- **Skills Curator v1.5**: `tailoring_notes` field added to `phases[2].data`.
- **Style Reviewer v1.5**: `verdict` and `fixes_applied` fields added to `phases[6].data`.
- **agent_test_specs.md**: `analyst_version` → "2.1", `reviewer_version` → "2.0".

### ✅ Frontend Integration Fixes (2026-04-08)

**Agent instruction fixes (from live frontend run observations):**
- **Main Orchestrator v4.2**: ONE CALL RULE added — SwitchAgent must be called exactly once per routing turn; do not re-call to verify or confirm. Addresses repeated SwitchAgent invocations observed via AgentReasoning port.
- **Main Orchestrator v4.3**: REVIEW_FAILED deadlock fix — added explicit ⛔ block in ZERO OUTPUT section: display options menu then STOP, never call SwitchAgent. Calling SwitchAgent in REVIEW_FAILED state locks the frontend (textarea disabled, no output).
- **Main Orchestrator v4.4**: BUG-TC06-01 — REVIEW_FAILED pre-routing check added before routing table switch; routing table entry now has explicit DO NOT call SwitchAgent/ChangeAgent. BUG-TC06-07 — added "You are now back with the Main Orchestrator." and "As instructed, please start a new conversation..." to banned phrases list.
- **Tone Analyst v1.9**: BUG-TC06-04 — removed "Clear this chat" / "start a new conversation" instruction from proceed path; replaced with standard turn-based completion pattern (display ✓ complete, wait, SwitchAgent on next turn).
- **Reviewer v2.2**: BUG-TC06-02 — re-invocation guard added in Phase 1: if review_audit already exists, skip to Phase 8 (gap interview) or Phase 9 (write) instead of re-running full audit. BUG-TC06-06 — Phase 11 fit score line now reads ANALYSIS_REJECTED from saved audit rather than defaulting to "✓ Accurate".
- **Analyst v2.3**: BUG-TC06-03 — path validation added in Phase 10 before write: gaps with evidence_source paths that don't resolve in enhanced_jd are removed before writing gap_analysis. Prevents fabricated paths reaching the Reviewer.

**Frontend (client/src/):**
- SSE streaming fixed — delta computation prevents duplicate message accumulation (AgentOutput fires with full accumulated text, not just delta)
- Streaming deduplication: `lastAgentOutput` tracker in `server/routes/pipeline.js`
- AgentReasoning + AgentDebug global variables wired — reasoning logged to console, debug (token costs) parsed for timeline
- File upload: `.pdf` and `.txt` supported; `cover_letter_sample.txt` target added for Tone Analyst
- 10 testing/debug UI features added:
  1. **Workspace inspector** — "Files" button, floating panel with 5 file tabs, auto-refreshes on stream_done (`GET /api/workspace`)
  2. **Reasoning panel** — collapsible "▼ Show reasoning" under each agent bubble
  3. **Agent timeline** — "Timeline" sidebar: agent name, elapsed time, cost per turn
  4. **Error highlighting** — red border on bubbles matching error/failed/critical/cannot/undefined
  5. **Stall indicator** — "⚠ Waiting…" in amber after 4s with no tokens
  6. **Re-send button** — ↩ resends last user message
  7. **Turn counter** — #N in top-right of each agent bubble
  8. **Cost display** — $0.0xxx next to agent name (from debug tokens)
  9. **Status override** — "Set status" button → prompt → `POST /api/dev/status`
  10. **Inject mode** — "User/Inject" toggle in input bar → `POST /api/inject` bypasses KEMU

**New server endpoints (`server/routes/pipeline.js`):**
- `GET /api/workspace?file=<name>` — read workspace JSON file (allowlist enforced)
- `POST /api/dev/status` — override `project_memory.json` metadata.status
- `POST /api/inject` — broadcast stream_token/stream_done directly (bypass KEMU)

### ✅ Server-Side Routing + Complete-Message Architecture (2026-04-09)

**Root cause:** KEMU fires `AgentSelector` change (from `SwitchAgent`) *before* streaming text output — causing output to appear under the wrong agent label in the UI. Also, MO was being invoked for every happy-path transition, creating latency and narration risks.

**Architectural changes (this session):**

**Server-side pre-message routing** (`server/routes/pipeline.js`):
- `/api/message` now reads `project_memory.json` status before forwarding to KEMU
- Sets `AgentSelector` directly, then waits 150ms (let agent_switch SSE reach client), then sends message
- MO no longer handles happy-path routing — server owns it entirely
- `HAPPY_PATH` map: `FILES_SAVED→Extractor, INITIALIZED→Researcher, RESEARCH_COMPLETE→JD Enhancer, JD_ENHANCED→Analyst, ANALYSIS_COMPLETE→Reviewer, REVIEW_COMPLETE→Tone Analyst, TONE_ANALYZED→AC, CV_BUILDING→AC`
- `EXCEPTION_STATUSES`: `REVIEW_FAILED, RESEARCH_FAILED, ANALYSIS_FAILED, EXTRACTION_FAILED, CV_TAILORED` → route to MO

**Complete-message output model** (text port, not stream port):
- `AgentOutput` wired to agent's `text` port in KEMU — fires once per turn with full text
- Eliminates streaming race conditions, delta tracking, debounce timer, stall indicators
- SSE event: `agent_message` (replaces `stream_token`) carries complete text in one shot
- `AgentReasoning` wired to `reasoning` port — fires once per turn, buffered in `pendingReasoningRef`, attached to next `agent_message`

**StartModal + hardcoded welcome:**
- On page load, fetches `GET /api/history`; if messages exist shows "Resume session" option
- New session: calls `POST /api/reset` (clears workspace, sets `AgentSelector=ProjectSetup`), then injects hardcoded welcome message into React state — no agent call needed
- Welcome message lives in `App.jsx` `WELCOME_MESSAGE` constant — removed from MO and ProjectSetup instructions
- `modalState`: `null` (loading) → `'pending'` (show modal) → `'hidden'` (in session)

**Agent instruction changes (this session):**
- **Main Orchestrator v5.1**: Phase 2 (welcome message) removed entirely. Routing table: `if (!status || isInit) → SwitchAgent("ProjectSetup") immediately, no output`. Banned phrases: "You are now talking to the ProjectSetup agent." (and any agent name).
- **ProjectSetup v1.13**: Critical Rule 11 rewritten from "Always call SwitchAgent" to "⛔ DO NOT call SwitchAgent". Phase 0 guard strengthened. Phase 9 stale comment fixed (was "routes to MO", now "Extractor, server-handled"). ZERO NARRATION RULE corrected (frontend shows welcome, not PS).
- **Reviewer v2.3**: After completion display — hard ⛔ DO NOT call SwitchAgent. Server reads status and routes automatically. Critical Rule 10 changed from "Use SwitchAgent" to "Never call SwitchAgent on completion."
- **Tone Analyst v2.1**: STARTUP ZERO NARRATION RULE added. Bans: "You are now talking to the Tone Analyst.", apology messages, repeating Reviewer's completion text, pipeline narration.

**Removed from frontend:**
- `stallTimerRef`, `turnCounterRef`, streaming state, pre-connect buffer, bouncing dots, stall indicator (⚠ Waiting…), turn counter badge (#N)
- `stream_token` SSE event no longer used (server no longer broadcasts it)

### ✅ TC07 Fixes Applied (2026-04-09) — 4 changes

TC07 aborted at Analyst due to pipeline-fatal fabrication in cv_raw.txt (BUG-91) and malformed JSON from Analyst (BUG-98). Fixes applied mid-run.

**P0 fix:**
- **ProjectSetup v1.14**: Phase 1 pre-check added — always attempt `ReadFile("cv_raw.txt")` and `ReadFile("jd_raw.txt")` before any MODE A/B logic. If both exist and non-empty, skip Phase 2/3 and proceed directly to Phase 4. Fixes root cause of cv_raw.txt fabrication: server upload writes files correctly to disk, but PS was overwriting them with hallucinated content because the file bytes were not in the KEMU context.

**P1 fixes:**
- **Main Orchestrator v5.3**: Critical Rule 6 added — explicit ⛔ ban on `ChangeAgent`. "The routing tool is `SwitchAgent`. `ChangeAgent` does not exist in KEMU." TC07 observed MO calling `ChangeAgent("Main Orchestrator")` three times in one turn.
- **`client/src/App.jsx`**: `handleBegin()` trigger message changed from `"Files uploaded — CV: ${cv_raw}, JD: ${jd_raw}. Please begin."` → `"Files are saved to disk as cv_raw.txt and jd_raw.txt. Please initialise the project."` Old message referenced original filenames (e.g. `alistair_cv.txt`) that don't exist on disk.

**P2 fix:**
- **`agent_test_specs.md`**: All agent versions updated to current; all main pipeline agent routing updated from `SwitchAgent("Main Orchestrator")` → `DO NOT call SwitchAgent — server routes automatically`; Analyst spec gains JSON integrity note; ProjectSetup spec gains verbatim content rule.

### ✅ Live Pipeline Fixes (2026-04-09) — Session 2

**Server (`server/routes/pipeline.js`):**
- **Rerun intent detection**: `/api/message` checks for "rerun/redo/retry" keywords before HAPPY_PATH lookup. Matches target agent name (`RERUN_MAP`), resets `project_memory.json` status to correct pre-agent value, broadcasts "Re-running **Agent**…" via SSE, sets `AgentSelector` directly. MO not involved — avoids Flash 3 read-modify-write reasoning loops.
- **Tavily fix**: `Kemu.helpers.http` → native `fetch` (was "HTTP service not found" in edge runtime). `max_results` bumped 5→10.
- **Tavily sector-aware keywords**: Widget now takes `companyName` + `sector` as additional inputs. Detects academic institutions (`/university|college|institute.../i`) and switches keyword set — academic keywords cover research priorities/faculty/grants/supervision; corporate keywords cover culture/metrics/career growth.

**Frontend (`client/src/`):**
- **Thinking indicator**: `isWaiting` state in App.jsx — set on `handleSend`, cleared on `agent_message`. `ChatWindow` shows animated bouncing-dots bubble ("Thinking…") while waiting for agent response.

**Agent instructions:**
- **ProjectSetup v1.13**: Critical Rule 11 "Always call SwitchAgent when done" → "⛔ DO NOT call SwitchAgent". Phase 0 guard strengthened with explicit warning. Phase 9 stale comment "routes to Main Orchestrator" → "routes to Extractor (server-handled)". ZERO NARRATION RULE corrected — frontend shows welcome, not PS.
- **Main Orchestrator v5.2**: Phase 2 (Rerun Intent) added — handles rerun/redo/retry messages routed from server. `RERUN_MAP` resets status and calls SwitchAgent to target agent. Falls back to menu if target unrecognisable.

### ✅ TC06 Assembly Fixes Applied (2026-04-07) — 18 changes

Post-continuation fixes after TC06 full run. Full details in `TC06_Developer_Brief.md`.

**P0 fixes:**
- **Assembly Coordinator v3.9**: INTEGRITY_FAILED handler now reads `unsupported_claims_detail` array (was reading `unsupported_claims` count — broke display + remediation logic). Re-run loop guard added: scans forward past COMPLETE phases before routing. CV_BUILDING write added on first invocation.
- **Credentials Formatter v1.6**: Phase 0 startup guard added — validates cv_assembly_state.json readable and current_phase = 5 before proceeding; displays error and stops on failure.
- **Integrity Checker v1.8**: JSON escaping note added (single quotes must NOT be escaped as `\'` in JSON).

**P1 fixes:**
- **Tone Analyst v1.8**: Root-level fields (`tone`, `voice`, `sentence_structure`, `formatting`, `examples`) added to style_guide.json output. Register computation moved before styleGuide object. Phase 13 redundant ReadFile removed.
- **Style Negotiator v1.6**: `agreed_overrides` changed from Array to Object with snake_case keys. `negotiation_summary` changed from Object to string.
- **Skills Curator v1.6**: `tailoring_notes` changed from Array to joined string. Certifications path fixed to `skills?.certifications || additional_information?.certifications`.
- **History Formatter v1.5**: `formatted_entries` renamed to `work_history` in phases[3].data.
- **Credentials Formatter v1.6**: Certifications path fixed to `skills?.certifications`. Output schema fixed: `education` and `certifications` now at root of phases[4].data (not nested under `formatted_credentials`). Education items now `{institution, qualification, year}`.
- **CoverLetter Writer v1.4**: phases[5].data restructured to spec-required nested `cover_letter` object with sub-fields. `register_used` field added.
- **Integrity Checker v1.8**: Spec-required field aliases added: `fabrications_found`, `checks_performed`, `evidence_verification`.
- **agent_test_specs.md**: IC spec updated to document actual IC output fields.

### ✅ TC06 Fixes Applied (2026-04-03) — 7 changes

All fixes from `TC06_Developer_Brief.md`. Full details in `.general/tests/TC06_Developer_Brief.md`.

**P1 fixes:**
- **Reviewer v2.1**: All WriteFile calls changed to positional params (were named — caused EISDIR, review_audit never written). ReadFile verify after Phase 9 write now checks `review_audit` presence AND `status` value. `version` string in reasoning log corrected from "1.5" → "2.1".
- **JD Enhancer v1.4**: All WriteFile calls changed to positional params. `enhanced_at` now explicitly set via `getCurrentISOTimestamp()` in Phase 7 (was declared in schema but never populated). WriteFile rules section updated to show positional syntax as CORRECT.
- **Main Orchestrator v4.1**: Banned narration phrases block added (6 real examples from TC06) immediately after ZERO OUTPUT rule.

**P2 fixes:**
- **Reviewer v2.1**: Gap interview continuation condition fixed — `totalAddressed` now counts skipped + answered gaps (was `totalAnswered` counting only answered, allowing infinite skips). Added explicit `⚠️ DO NOT PROCEED TO PHASE 9` warning before the continuation check.
- **Reviewer v2.1**: Phase 7.5 display — removed premature "Final verdict: APPROVED" line. Now shows "Audit phase complete — proceeding to gap evidence review." Added bold warning that final verdict is Phase 11 only.
- **Extractor v2.1**: `publications`, `grants`, `awards` moved to root level of candidate_profile.json (were nested under `additional_information{}`). Phase 7.5 publications read path updated accordingly.

---

## Model Assignment

**Gemini Pro 2.5 (complex judgment / strict compliance):**

| Agent | Version | Reason |
|-------|---------|--------|
| Analyst | v2.2 | Complex evidence matching, read-modify-write on large JSON |
| Reviewer | v2.0 | Multi-phase forensic audit, gap interview state tracking |
| Tone Analyst | v1.8 | Schema compliance under long instruction file |
| Assembly Coordinator | v3.9 | ZERO OUTPUT enforcement, exception routing, completion writes |
| Integrity Checker | v1.8 | Strict PASSED/FAILED gate, fabrication detection |

**Gemini Flash 3.0 preview (deterministic / simple tasks):**

| Agent | Version |
|-------|---------|
| Main Orchestrator | v5.3 |
| ProjectSetup | v1.14 |
| Extractor | v2.1 |
| Researcher | v2.0 |
| JD Enhancer | v1.4 |
| Style Negotiator | v1.6 |
| Profile Builder | v1.6 |
| Skills Curator | v1.6 |
| History Formatter | v1.5 |
| Credentials Formatter | v1.6 |
| CoverLetter Writer | v1.4 |
| Style Reviewer | v1.5 |

---

## Test Run History

| Run | Model | Verdict | Score | Bugs | Notes |
|-----|-------|---------|-------|------|-------|
| TC01 | Flash 3 | REVIEW | 6.0/10 | ~12 P0s | IC not checking cv_raw.txt, EISDIR, no gap interview |
| TC02 | Flash 3 | FAIL | 4.9/10 | ~12 P0s | Academic profile, full publication fabrication |
| TC03 | Flash 3 | FAIL | 4.5/10 | 83 | First post-fix run; MO/AC compliance failures systemic |
| TC04 | Flash 3 | ABORTED | N/A | 6 | EISDIR infrastructure blocker; testing infra built |
| TC05 | Flash 3 + Pro 2.5 (MO only) | PARTIAL PASS | ~6.5/10 | 29 | First end-to-end completion; final CV unsaved, IC passed fabrications |
| TC06 | Flash 3 + Pro 2.5 (5 agents) | PARTIAL | — | 18 (assembly) | ✅ Complete — assembly phase fixes applied |
| TC07 | Flash 3 + Pro 2.5 | ABORTED | — | 8 (BUG-90–97) | Aborted at ProjectSetup: cv_raw.txt fabricated (BUG-91), Analyst wrote malformed JSON (BUG-98). MO calling ChangeAgent (BUG-95/96). Fixes applied. |

### ⏳ Next Steps

1. **Re-upload instructions** — MO v5.3, ProjectSetup v1.14 must be re-pasted into KEMU before TC08
2. **TC08** — resume Alistair Whitmore run from current state (ANALYSIS_COMPLETE) — Reviewer onwards; or reset for a clean full run to validate PS v1.14 fix

---

## System Architecture

### Orchestration Flow

```
Express Server (server/routes/pipeline.js) — status router
├─ Main Pipeline (server pre-routes before each message)
│  ├─ ProjectSetup → Extractor → Researcher → JD Enhancer   [Flash 3]
│  └─ Analyst [Pro 2.5] → Reviewer [Pro 2.5] → Tone Analyst [Pro 2.5]
│
└─ Assembly Coordinator v3.9 [Pro 2.5] (sub-orchestrator, self-routing)
   ├─ Style Negotiator      (Phase 1) [Flash 3]
   ├─ Profile Builder       (Phase 2) [Flash 3]
   ├─ Skills Curator        (Phase 3) [Flash 3]
   ├─ History Formatter     (Phase 4) [Flash 3]
   ├─ Credentials Formatter (Phase 5) [Flash 3]
   ├─ CoverLetter Writer    (Phase 6) [Flash 3]
   ├─ Style Reviewer        (Phase 7) [Flash 3]
   └─ Integrity Checker     (Phase 8) [Pro 2.5]

Main Orchestrator v5.3 [Flash 3] — exception handler only
  Invoked for: REVIEW_FAILED, RESEARCH_FAILED, ANALYSIS_FAILED, EXTRACTION_FAILED, CV_TAILORED
  NOT invoked for any happy-path transition
```

### Routing Logic (Server-Side)

**Happy-path routing is owned by the Express server** (`/api/message` endpoint), not by Main Orchestrator:

```javascript
// server/routes/pipeline.js — HAPPY_PATH map
const HAPPY_PATH = {
  'FILES_SAVED':        'Extractor',
  'INITIALIZED':        'Researcher',
  'RESEARCH_COMPLETE':  'JD Enhancer',
  'RESEARCH_PARTIAL':   'Main Orchestrator',  // surfaces to user
  'JD_ENHANCED':        'Analyst',
  'ANALYSIS_COMPLETE':  'Reviewer',
  'REVIEW_COMPLETE':    'Tone Analyst',
  'TONE_ANALYZED':      'Assembly Coordinator',
  'CV_BUILDING':        'Assembly Coordinator',
};

const EXCEPTION_STATUSES = new Set([
  'REVIEW_FAILED', 'RESEARCH_FAILED', 'ANALYSIS_FAILED',
  'EXTRACTION_FAILED', 'CV_TAILORED',
]);

// On each POST /api/message:
// 1. Read project_memory.json → get status
// 2. Set AgentSelector to next agent
// 3. Wait 150ms (agent_switch SSE propagates to client)
// 4. sendToInputWidget (forward user message to KEMU)
```

**Main Orchestrator** is only invoked for exception statuses. In the `ANALYSIS_COMPLETE` + `review_audit` case, auto-continue pauses and routes to Reviewer for gap interview.

### Assembly Phase Routing

Phase agents return directly to **Assembly Coordinator** (not Main Orchestrator). Assembly Coordinator reads `current_phase` and routes to the next phase agent, looping until all 8 phases are done.

```
Phase Agent → SwitchAgent("Assembly Coordinator")
Assembly Coordinator: reads current_phase → SwitchAgent("Next Phase Agent")
```

**CV_BUILDING status:** Assembly Coordinator sets `status = CV_BUILDING` in `project_memory.json` on its first invocation (when it sees `TONE_ANALYZED`). This is idempotent — subsequent invocations skip the write.

Main Orchestrator's `CV_BUILDING` case only triggers for genuine exception re-entry (e.g. INTEGRITY_FAILED or STYLE_FAILED: Assembly Coordinator WAITs, user responds, message re-enters via Main Orchestrator).

### Key Files

| File | Purpose | Created By |
|------|---------|------------|
| `project_memory.json` | Main state: metadata, research, gap_analysis, review_audit, tailored_cv | ProjectSetup |
| `candidate_profile.json` | Extracted CV data | Extractor |
| `cv_assembly_state.json` | Assembly phases array, current_phase, status | ProjectSetup |
| `cv_raw.txt` | User's uploaded CV (read-only after creation) | ProjectSetup |
| `jd_raw.txt` | Job description (read-only after creation) | ProjectSetup |
| `style_guide.json` | Writing style analysis | Tone Analyst |
| `conversation_history.json` | Audit log | ProjectSetup |
| `agent_reasoning.json` | Decision log | ProjectSetup |

---

## Critical Rules (Apply to Every Agent)

### 1. WriteFile — Bare Filenames Only
```javascript
// ALWAYS validate before writing
const filename = "project_memory.json"
if (filename.startsWith('/') || filename.includes('/') || filename.includes('\\')) {
  ERROR: "Invalid filename"
  STOP
}
WriteFile(filename, JSON.stringify(data, null, 2))
```

### 2. File Naming
- ✅ `candidate_profile.json` — NEVER `user_profile.json` (triggers subdirectory platform bug)
- ✅ `cv_assembly_state.json` — NEVER `cv_construction_state.json`

### 3. Turn-Based Completion Pattern
Every **worker agent** MUST end with:
```markdown
# ✓ {Agent Name} Complete

{Summary of what was done}

---

Send any message to continue.
```
**Turn ENDS here. Worker WAITS for user to send a message.**

**On next turn (after user message):**
```javascript
// ⚠️ Main pipeline agents (Extractor, Researcher, JD Enhancer, Analyst, Reviewer, Tone Analyst):
// DO NOT call SwitchAgent. The server reads project_memory.json status and routes automatically.
// Just write status to project_memory.json, display completion, wait.

// Assembly phase agents return to Assembly Coordinator:
SwitchAgent(target: "Assembly Coordinator", context: {})
```

**Server-side routing flow:**
```
Worker writes status → displays summary → waits → user sends message →
Server reads status → sets AgentSelector → sends message to KEMU →
Next Worker processes and displays output → waits
```

**Main Orchestrator produces ZERO text output during routing** — only invoked for exception statuses (REVIEW_FAILED etc.). No greetings, no summaries, no agent-switch narration.

**⛔ Banned in all agents:** "You are now talking to [Agent Name].", hand-off narration, apology messages about pipeline transitions, repeating the previous agent's output.

### 4. Timestamps
- Use actual current date from system context: `"Today's date is 2026-03-18"`
- Format: ISO 8601 — `"2026-03-18T14:22:00Z"`
- Never hardcode dates

### 5. JSON Handling
- WriteFile always receives a string: `JSON.stringify(data, null, 2)`
- ReadFile always needs parsing: `JSON.parse(ReadFile(filename))`
- **Named parameters BANNED:** Never call `WriteFile({filePath: ..., fileName: ...})` — this creates a directory instead of a file on KEMU

### 6. EISDIR Fallback — candidate_profile.json
If `ReadFile("candidate_profile.json")` fails with EISDIR (directory exists instead of file — created by Extractor WriteFile bug):
```javascript
// Try nested path fallback
const fallback = ReadFile("candidate_profile.json/candidate_profile.json")
if (fallback) {
  const candidateProfile = JSON.parse(fallback)
  // Proceed normally — log the fallback in agent_reasoning.json
} else {
  ERROR: "candidate_profile.json unreadable — Extractor must re-run"
}
```

### 7. Read-Modify-Write — cv_assembly_state.json
Assembly phase agents MUST read-modify-write. NEVER reconstruct from scratch:
```javascript
const cvState = JSON.parse(ReadFile("cv_assembly_state.json"))
// Modify ONLY your owned fields: cvState.phases[N-1], cvState.current_phase,
// cvState.metadata.completed_phases, cvState.metadata.last_updated
WriteFile("cv_assembly_state.json", JSON.stringify(cvState, null, 2))
```
Reconstructing from scratch strips fields written by prior agents (change_log, final_cv, etc.).

---

## cv_assembly_state.json Schema

Initialized by ProjectSetup v1.6, read by Assembly Coordinator and all phase agents:

```json
{
  "current_phase": 1,
  "metadata": {
    "started_at": "ISO timestamp",
    "last_updated": "ISO timestamp",
    "status": "ACTIVE",
    "total_phases": 8,
    "completed_phases": 0
  },
  "phases": [
    { "phase_number": 1, "phase_name": "Style Negotiation",      "agent": "Style Negotiator",     "status": "PENDING", "completed_at": null, "data": null },
    { "phase_number": 2, "phase_name": "Profile Building",       "agent": "Profile Builder",       "status": "PENDING", "completed_at": null, "data": null },
    { "phase_number": 3, "phase_name": "Skills Curation",        "agent": "Skills Curator",        "status": "PENDING", "completed_at": null, "data": null },
    { "phase_number": 4, "phase_name": "History Formatting",     "agent": "History Formatter",     "status": "PENDING", "completed_at": null, "data": null },
    { "phase_number": 5, "phase_name": "Credentials Formatting", "agent": "Credentials Formatter", "status": "PENDING", "completed_at": null, "data": null },
    { "phase_number": 6, "phase_name": "Cover Letter Writing",   "agent": "CoverLetter Writer",    "status": "PENDING", "completed_at": null, "data": null },
    { "phase_number": 7, "phase_name": "Style Review",           "agent": "Style Reviewer",        "status": "PENDING", "completed_at": null, "data": null },
    { "phase_number": 8, "phase_name": "Integrity Check",        "agent": "Integrity Checker",     "status": "PENDING", "completed_at": null, "data": null }
  ],
  "user_request": null,
  "final_cv": null,
  "change_log": []
}
```

**When a phase agent completes:** update `phases[N-1].status = "COMPLETE"`, `phases[N-1].data = {output}`, increment `current_phase` to N+1.

**Assembly Coordinator exception statuses** (set in `metadata.status`): `ROUTING_INTERVENTION`, `INTEGRITY_FAILED`, `STYLE_FAILED`

---

## Status Progression

```
FILES_SAVED → INITIALIZED → RESEARCH_COMPLETE → JD_ENHANCED
→ ANALYSIS_COMPLETE → REVIEW_COMPLETE → TONE_ANALYZED
→ CV_BUILDING → CV_TAILORED
```

**Exception statuses:** `REVIEW_FAILED`, `EXTRACTION_FAILED`, `RESEARCH_FAILED`, `ANALYSIS_FAILED`

### REVIEW_FAILED Gate
Main Orchestrator presents user choices:
- `redo analyst` → reset status to `JD_ENHANCED`
- `redo researcher` → reset status to `INITIALIZED`
- `redo jd enhancer` → reset status to `RESEARCH_COMPLETE`
- `accept anyway` → reset status to `REVIEW_COMPLETE`
- `details` → show full issues list
Only case where Main Orchestrator writes to `project_memory.json`.

---

## Assembly Phase Agent Template

For creating new or updating existing assembly phase agents:

```markdown
# [Agent Name] v1.0 — System Instructions

## Agent Identity
| Field | Value |
| Agent Name | [Name] |
| Version | 1.0 |
| Pipeline Position | Assembly Phase [N] |
| Trigger | current_phase = [N] in cv_assembly_state.json |
| Output Status | Updates cv_assembly_state.json phases[N-1] |

## Authority
READ: cv_assembly_state.json, project_memory.json, candidate_profile.json
WRITE: cv_assembly_state.json only
PRESERVE: All other files

## Tools: ReadFile, WriteFile, SwitchAgent

## Execution Protocol
### Phase 1: Load State
const cvState = JSON.parse(ReadFile("cv_assembly_state.json"))
const projectMemory = JSON.parse(ReadFile("project_memory.json"))
const candidateProfile = JSON.parse(ReadFile("candidate_profile.json"))

### Phase 2: [Agent-specific work]

### Phase 3: Update cv_assembly_state.json
cvState.phases[N-1].status = "COMPLETE"
cvState.phases[N-1].completed_at = getCurrentISOTimestamp()
cvState.phases[N-1].data = { ...output }
cvState.current_phase = N+1
cvState.metadata.completed_phases += 1
cvState.metadata.last_updated = getCurrentISOTimestamp()
WriteFile("cv_assembly_state.json", JSON.stringify(cvState, null, 2))

### Phase 4: Display & Return
# ✓ [Agent Name] Complete
[Summary]
---
Send any message to continue.

SwitchAgent(target: "Assembly Coordinator", context: {})

## ⚠️ Critical Rules
1. Bare filenames, no leading slashes
2. Always JSON.stringify() before WriteFile
3. candidate_profile.json (never user_profile.json)
4. cv_assembly_state.json (never cv_construction_state.json)
5. Return to Assembly Coordinator (NOT Main Orchestrator)
6. Read style overrides from cvState.phases[0].data?.agreed_overrides (NOT cvState.sections)
7. Use actual current date for timestamps
```

### State Invalidation Matrix (Assembly Coordinator handles this)
```javascript
const INVALIDATION = {
  "style":        { affects: [1,2,3,4,5,6,7] },
  "contact":      { affects: [2] },
  "profile":      { affects: [2,7,8] },
  "skills":       { affects: [3,7,8] },
  "history":      { affects: [4,7,8] },
  "credentials":  { affects: [5,7,8] },
  "cover_letter": { affects: [6,7,8] }
}
```

---

## Evidence-Based Methodology (Analyst & Reviewer)

**Confidence Levels:**
- 5 = Directly Verified (exact match in source)
- 4 = Strongly Supported (clear evidence, minor interpretation)
- 3 = Reasonably Supported (inference required)
- 2 = Weakly Supported (thin evidence)
- 1 = Unsupported
- **Rule: Only approve confidence ≥ 4**

**Fit Score:** Baseline (70%, required skills) + Differentiator (30%, preferred skills) = 0-10

---

## Reference Files

| File | Purpose |
|------|---------|
| `general/handover.md` | Full architecture, changelog, gotchas |
| `AUDIT_REPORT.md` | 10 issues found, status of each |
| `FIX_PLAN.md` | Task-by-task implementation plan |
| `CORRECTIONS_APPLIED.md` | Key corrections (no global variables, SwitchAgent terminology) |

### Agent Instruction Files

**Main Pipeline:**

| File | Agent | Version |
|------|-------|---------|
| `.general/instructions/main_orchestrator_agent_instructions.md` | Main Orchestrator | v5.2 |
| `.general/instructions/project_setup_agent_instructions.md` | ProjectSetup | v1.13 |
| `.general/instructions/extractor_agent_instructions.md` | Extractor | v2.1 |
| `.general/instructions/researcher_agent_instructions.md` | Researcher | v1.9 |
| `.general/instructions/jd_enhancer_instructions.md` | JD Enhancer | v1.4 |
| `.general/instructions/analyst_agent_instructions.md` | Analyst | v2.3 |
| `.general/instructions/reviewer_agent_instructions.md` | Reviewer | v2.3 |
| `.general/instructions/tone_analyst_agent_instructions.md` | Tone Analyst | v2.1 |

**Assembly Phase:**

| File | Agent | Version |
|------|-------|---------|
| `.general/instructions/assembly/assembly_coordinator_agent_instructions.md` | Assembly Coordinator | v3.9 |
| `.general/instructions/assembly/style_negotiator_instructions.md` | Style Negotiator | v1.6 |
| `.general/instructions/assembly/profile_builder_instructions.md` | Profile Builder | v1.6 |
| `.general/instructions/assembly/skills_curator_agent_instructions.md` | Skills Curator | v1.6 |
| `.general/instructions/assembly/history_formatter_agent_instructions.md` | History Formatter | v1.5 |
| `.general/instructions/assembly/credentials_formatter_agent_instructions.md` | Credentials Formatter | v1.6 |
| `.general/instructions/assembly/coverletter_writer_agent_instructions.md` | CoverLetter Writer | v1.4 |
| `.general/instructions/assembly/style_reviewer_agent_instructions.md` | Style Reviewer | v1.5 |
| `.general/instructions/assembly/integrity_checker_agent_instructions.md` | Integrity Checker | v1.8 |

---

## Live Test Run — /test-agent Skill

### What this is

A live end-to-end test run of the full pipeline is in progress (or may be resumed). After each KEMU agent completes, the user invokes `/test-agent <agent-name>` and pastes the chat output. Claude Code logs findings to the running bug log and shows a compact summary.

### Skill location

The `/test-agent` skill is defined in the project's Claude Code settings (accessible via the `Skill` tool). It provides full instructions for what to read, how to cross-check, how to assign bug IDs, and how to append to the log.

### How to continue

If the user says "continue the test run", "resume testing", or invokes `/test-agent <agent>`:

1. **Invoke the Skill tool** with `skill: "test-agent"` — this loads the full instructions.
2. The user will paste the KEMU chat output for the current agent.
3. Read `cv_assembly_state.json` (for assembly agents) or `project_memory.json` (for main pipeline agents).
4. Cross-check file data vs chat output vs instruction expectations.
5. Append findings to `.general/tc_running_log.md` using sequential bug IDs (check log for last ID used).
6. Show a compact summary ending with the running total.

### Current test run state (as of last context)

TC03 complete. Running log cleared. Brief at `.general/TC03_Developer_Brief.md`.

| Item | Value |
|------|-------|
| Running log | `.general/tc_running_log.md` (cleared — ready for TC04) |
| Last bug ID logged | BUG-80 |
| TC03 total | 80 bugs (7 P0, 27 P1, 28 P2, 18 P3) |
| Pipeline reached | CV_TAILORED — full end-to-end completion |
| TC03 verdict | 4.5/10 — FAIL |

### Before TC04 — priority actions

All instructions confirmed active on KEMU during TC03. BUG-03 and BUG-40 are model compliance failures — not upload gaps.

1. **Model compliance mitigation** — test stop_sequence or tool-call-only mode for MO and AC to suppress routing narration (BUG-03, BUG-40)
2. **Fix AC Phase 3 field names** — `styleReviewData.passed` → `style_compliance === "PASS"`, `integrityData.passed` → `integrity_status === "PASSED"`, `historyData.length` / `credentialsData.length` → object presence checks (BUG-81, 82, 83)
3. **Fix MO title header** — still says "Orchestrator Agent v3.5" despite v3.6 content (BUG-84)
4. **Instruction fixes (P0/P1)** — see TC03 Priority 2 list in TC03_Developer_Brief.md
