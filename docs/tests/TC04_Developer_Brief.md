# TC04 — Developer Brief

**Test Date:** 2026-04-02
**Candidate:** Chloe Simmons
**Role:** Qualified Early Childhood Educator (Diploma)
**Company:** City of Melbourne
**Test Type:** Regression run — same inputs as TC03. Aborted at ProjectSetup due to EISDIR platform bug. Testing infrastructure upgraded during the run.
**Agent versions tested:** MO v3.8, ProjectSetup v1.9

---

## Executive Summary

TC04 was aborted at ProjectSetup after two agents (MO and ProjectSetup) ran. All pipeline failures were traced to a single root cause: a leading slash in KEMU's WriteFile template string caused every file write to create a directory instead of a file (EISDIR), making state files unreadable and stalling the pipeline in an infinite ProjectSetup loop. The fix was applied mid-run. **4 of 6 logged bugs were resolved as a direct consequence.** Two bugs remain open going into TC05: one confirmed (MO process narration before the welcome display) and one pending verification (ProjectSetup completion display malformed output, possibly an artefact of stale EISDIR data).

The TC04 run also produced a full testing infrastructure upgrade: `agent_test_specs.md` (per-agent verification criteria), `tc_state.md` (lightweight bug tracking), two seed states for isolated agent testing (Seed A: post-JD Enhancer, Seed B: post-Tone Analyst), and a revised `/test-agent` skill with reduced token cost per invocation.

**TC04 verdict: ABORTED — infrastructure blocker resolved, proceed to TC05.**

---

## Bug Register

| ID | Agent | Severity | Category | Description | Status |
|----|-------|----------|----------|-------------|--------|
| BUG-01 | Main Orchestrator | P2 | Display | Process narration "I'll check for existing files in the directory:" leaked before welcome header. Welcome is a legitimate zero-output exception but must start directly with `# Welcome to Your Job Application Assistant`. | **Open** |
| BUG-02 | Main Orchestrator | P1 | EISDIR | TC03 residual EISDIR files prevented MO from reading project state → showed welcome instead of routing to Extractor. | **Resolved** |
| BUG-03 | ProjectSetup | P0 | Routing | Phase 0 catch block swallowed EISDIR read failure → re-ran full setup every user message → infinite loop, SwitchAgent(MO) never called. | **Resolved** |
| BUG-04 | ProjectSetup | P0 | EISDIR | All 6 state files created as directories (EISDIR). Root cause: leading slash in KEMU WriteFile template string. | **Resolved** |
| BUG-05 | ProjectSetup | P2 | Display | Completion display showed "Company: City of Melbourne (to be extracted)" — neither branch of `{companyName \|\| "to be extracted"}` template. Observed with stale EISDIR data; may be artefact. | **Pending TC05 verification** |
| BUG-06 | ProjectSetup | P3 | Timestamp | State files showed TC03 timestamp `2026-02-19` instead of `2026-04-02`. Caused by EISDIR write failure preventing fresh data from being written. | **Resolved** |

---

## Detailed Findings

### BUG-01 — MO process narration before welcome
**Agent:** Main Orchestrator
**Severity:** P2
**Category:** Display / Zero Output violation
**Observed:** Chat output began with `"I'll check for existing files in the directory:"` before the `# Welcome to Your Job Application Assistant` header.
**Expected:** Welcome message starts directly with `# Welcome to Your Job Application Assistant`. No preamble. The welcome IS a legitimate zero-output exception — but the exception covers only the welcome block itself, not process narration before it.
**Instruction reference:** `main_orchestrator_agent_instructions.md` — Phase 1, Case B display; ZERO OUTPUT rule (lines 60–82)
**Impact:** Minor UX issue. Does not affect pipeline function.
**Recommended fix:** Add explicit note to Phase 1 that the ScanDirectory check must produce no output. The Case A/B display blocks should be the first and only text generated.

---

### BUG-05 — ProjectSetup malformed company display (pending verification)
**Agent:** ProjectSetup
**Severity:** P2
**Category:** Display
**Observed:** Completion message showed `"Company: City of Melbourne (to be extracted)"` — combining a stale company name from TC03 residual data with the "to be extracted" fallback text.
**Expected:** Template `{companyName || "to be extracted"}` should yield either the name OR the fallback, not both. For a fresh run (new project, Phase 7 Case A), companyName should be `""` → display should show `"Company: to be extracted"`.
**Instruction reference:** `project_setup_agent_instructions.md` — Phase 9 display template
**Impact:** If this is an instruction bug (agent appends "(to be extracted)" as a fixed annotation regardless of companyName), the display is misleading but harmless. Needs TC05 confirmation with clean state.
**Recommended fix:** Verify in TC05. If reproduced, the display template in Phase 9 should be reviewed — the `||` operator should be evaluated, not printed literally.

---

## Agent-by-Agent Summary

| Agent | Version | Status | Bugs |
|-------|---------|--------|------|
| Main Orchestrator | v3.8 | ⚠ | BUG-01 (open), BUG-02 (resolved) |
| ProjectSetup | v1.9 | ⚠ | BUG-03/04/06 (resolved), BUG-05 (pending) |
| Extractor → Integrity Checker | — | Not reached | — |

---

## Observations (Non-Bug)

- MO v3.8 welcome body (Case B) matched the instruction template exactly — content is correct.
- ProjectSetup completion message structure was correct apart from the company name display.
- Testing infrastructure is now significantly more efficient: `agent_test_specs.md` eliminates full instruction file reads per invocation; `tc_state.md` eliminates log scanning for bug IDs; Seed A/B enable isolated agent testing without full pipeline re-runs.

---

## Testing Infrastructure Changes (Applied This Run)

| File | Purpose |
|------|---------|
| `.general/agent_test_specs.md` | Per-agent field-level verification criteria — replaces reading full instruction files |
| `.general/tc_state.md` | Lightweight bug ID + totals tracker — replaces scanning running log |
| `.general/seeds/seed_a_jd_enhanced/` | Seed state: post-JD Enhancer (`JD_ENHANCED`) — use to test Analyst/Reviewer in isolation |
| `.general/snapshots/pre_assembly/chloe_simmons/` | Seed B: post-Tone Analyst (`TONE_ANALYZED`) — use to test full assembly phase |
| `.claude/commands/test-agent.md` | Revised skill: reads spec + state files instead of full instruction files |

---

## Fixes Required Before TC05

**Confirmed open:**
1. **BUG-01 (P2)** — MO: add note to Phase 1 prohibiting any output before the Case A/B welcome block

**Pending verification in TC05:**
2. **BUG-05 (P2)** — ProjectSetup: if reproduced, fix the Phase 9 display template `{companyName || "to be extracted"}` evaluation

**Carry-forward from TC03 (unresolved in TC04):**
- MO ZERO OUTPUT model compliance failures (P0-1 in TC03) — stop_sequence mitigation untested
- AC phase narration model compliance failures (P0-2 in TC03) — stop_sequence mitigation untested
- All other TC03 P1/P2/P3 items not yet re-tested
