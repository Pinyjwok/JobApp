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
| Main Orchestrator | v4.1 | `main_orchestrator_agent_instructions.md` |
| ProjectSetup | v1.9 | `project_setup_agent_instructions.md` |
| Extractor | v2.1 | `extractor_agent_instructions.md` |
| Researcher | v1.8 | `researcher_agent_instructions.md` |
| JD Enhancer | v1.4 | `jd_enhancer_instructions.md` |
| Analyst | v2.2 | `analyst_agent_instructions.md` |
| Reviewer | v2.1 | `reviewer_agent_instructions.md` |
| Tone Analyst | v1.8 | `tone_analyst_agent_instructions.md` |
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
| Main Orchestrator | v4.0 |
| ProjectSetup | v1.11 |
| Extractor | v2.0 |
| Researcher | v1.8 |
| JD Enhancer | v1.3 |
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
| TC06 | Flash 3 + Pro 2.5 (5 agents) | — | — | — | **ACTIVE** — regression validation on Chloe Simmons |

**TC06 critical validations:**
1. BUG-08 fix — does Analyst overwrite guard hold?
2. BUG-26 fix — does IC v1.7 catch fabricated skills?
3. BUG-28/29 fix — does AC final CV persist to both files?
4. Reviewer gap interview — does it cover all 3 high-severity gaps now?

Expected: bug count 10–15, zero P0s = PASS. Switch to new persona for TC07.

### ⏳ Next Steps

1. **Run TC06** — Chloe Simmons, regression validation
2. **TC07 (after TC06 PASS)** — new candidate persona (academic or career-transition) to surface new failure modes
3. **Tone Analyst chat-clear UX** — add instruction to clear chat before CV assembly begins

---

## System Architecture

### Orchestration Flow

```
Main Orchestrator v4.0 [Pro 2.5] (status router)
├─ Main Pipeline
│  ├─ ProjectSetup → Extractor → Researcher → JD Enhancer   [Flash 3]
│  └─ Analyst [Pro 2.5] → Reviewer [Pro 2.5] → Tone Analyst [Pro 2.5]
│
└─ Assembly Coordinator v3.6 [Pro 2.5] (sub-orchestrator)
   ├─ Style Negotiator      (Phase 1) [Flash 3]
   ├─ Profile Builder       (Phase 2) [Flash 3]
   ├─ Skills Curator        (Phase 3) [Flash 3]
   ├─ History Formatter     (Phase 4) [Flash 3]
   ├─ Credentials Formatter (Phase 5) [Flash 3]
   ├─ CoverLetter Writer    (Phase 6) [Flash 3]
   ├─ Style Reviewer        (Phase 7) [Flash 3]
   └─ Integrity Checker     (Phase 8) [Pro 2.5]
```

### Routing Logic (Main Orchestrator)

**Simple status switch — no global variables:**

```javascript
const status = projectMemory.metadata.status

switch(status) {
  case "FILES_SAVED":       SwitchAgent("Extractor"); break;
  case "INITIALIZED":       SwitchAgent("Researcher"); break;
  case "RESEARCH_COMPLETE": SwitchAgent("JD Enhancer"); break;
  case "JD_ENHANCED":       SwitchAgent("Analyst"); break;
  case "ANALYSIS_COMPLETE": SwitchAgent("Reviewer"); break;
  case "REVIEW_COMPLETE":   SwitchAgent("Tone Analyst"); break;
  case "TONE_ANALYZED":     SwitchAgent("Assembly Coordinator"); break;
  case "CV_BUILDING":       SwitchAgent("Assembly Coordinator"); break;
  case "CV_TAILORED":       Display completion; break;
  case "REVIEW_FAILED":     Wait for user choice; break;
}
```

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
// Main pipeline agents return to Main Orchestrator:
SwitchAgent(target: "Main Orchestrator", context: {})

// Assembly phase agents return to Assembly Coordinator:
SwitchAgent(target: "Assembly Coordinator", context: {})
```

**Main Orchestrator produces ZERO text output during routing** — it reads status and calls SwitchAgent. No greetings, no summaries, no menus, no options. The flow is:
```
Worker displays summary → waits → user sends message →
Worker routes to Orchestrator →
Orchestrator: ReadFile + SwitchAgent (ZERO OUTPUT) →
Next Worker processes and displays output → waits
```
One user message per step. Orchestrator is silent and invisible.

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
| `.general/instructions/main_orchestrator_agent_instructions.md` | Main Orchestrator | v3.6 |
| `.general/instructions/project_setup_agent_instructions.md` | ProjectSetup | v1.6 |
| `.general/instructions/extractor_agent_instructions.md` | Extractor | v1.9 |
| `.general/instructions/researcher_agent_instructions.md` | Researcher | v1.7 |
| `.general/instructions/jd_enhancer_instructions.md` | JD Enhancer | v1.2 |
| `.general/instructions/analyst_agent_instructions.md` | Analyst | v2.0 |
| `.general/instructions/reviewer_agent_instructions.md` | Reviewer | v2.0 |
| `.general/instructions/tone_analyst_agent_instructions.md` | Tone Analyst | v1.7 |

**Assembly Phase:**

| File | Agent | Version |
|------|-------|---------|
| `.general/instructions/assembly/assembly_coordinator_agent_instructions.md` | Assembly Coordinator | v3.8 |
| `.general/instructions/assembly/style_negotiator_instructions.md` | Style Negotiator | v1.5 |
| `.general/instructions/assembly/profile_builder_instructions.md` | Profile Builder | v1.6 |
| `.general/instructions/assembly/skills_curator_agent_instructions.md` | Skills Curator | v1.5 |
| `.general/instructions/assembly/history_formatter_agent_instructions.md` | History Formatter | v1.3 |
| `.general/instructions/assembly/credentials_formatter_agent_instructions.md` | Credentials Formatter | v1.5 |
| `.general/instructions/assembly/coverletter_writer_agent_instructions.md` | CoverLetter Writer | v1.3 |
| `.general/instructions/assembly/style_reviewer_agent_instructions.md` | Style Reviewer | v1.5 |
| `.general/instructions/assembly/integrity_checker_agent_instructions.md` | Integrity Checker | v1.7 |

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
