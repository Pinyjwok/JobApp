# TC06 — Developer Brief (Complete)

**Test Date:** 2026-04-03 (partial run) + 2026-04-07 (continuation)
**Candidate:** Chloe Simmons
**Role:** Qualified Early Childhood Educator (Diploma)
**Company:** City of Melbourne
**Test Type:** Full pipeline run — Chloe Simmons (regression validation after TC05 fixes). Run in two sessions: partial run through Reviewer (2026-04-03), then continued from Reviewer v2.1 through full assembly and INTEGRITY_FAILED resolution (2026-04-07).
**Agent versions tested:** MO v4.0→v4.1, ProjectSetup v1.11, Extractor v2.0→v2.1, Researcher v1.8, JD Enhancer v1.3→v1.4, Analyst v2.2, Reviewer v2.0→v2.1, Tone Analyst v1.7, Assembly Coordinator v3.6→v3.8, Style Negotiator v1.5, Profile Builder v1.6, Skills Curator v1.5, History Formatter v1.4, Credentials Formatter v1.5, CoverLetter Writer v1.3, Style Reviewer v1.5, Integrity Checker v1.7

---

## Executive Summary

TC06 is the first full end-to-end run after TC05 fixes. The pipeline reached CV_TAILORED status but with a critical failure: the INTEGRITY_FAILED exception handler has no remediation logic — it acknowledged 5 unsupported claims, falsely declared "5 corrections applied", and force-completed the pipeline without re-running any phase agents. Fabrications remain in the final CV output.

On the positive side: IC correctly caught fabricated gap skills (BUG-26 TC05 fix held), AC loop fix (BUG-48) held for normal routing, Reviewer write fix (BUG-36) held, and Analyst overwrite guard (BUG-08) still solid. The pipeline now completes end-to-end, but the INTEGRITY_FAILED path is broken and multiple schema mismatches across assembly agents will cause downstream failures in future when agents actually try to read each other's output fields.

**TC06 Pipeline Verdict: FAIL — pipeline completed with fabrications in output. 7 P0s including INTEGRITY_FAILED false resolution. Total: 57 bugs (7 P0, 16 P1, 20 P2, 14 P3) across full run (BUG-30 through BUG-89).**

---

## TC06 Critical Regression Validations

| # | Regression | Result | Notes |
|---|-----------|--------|-------|
| 1 | BUG-08 — Analyst overwrite guard | **PASS ✓** | research_data, enhanced_jd, metadata all intact after Analyst |
| 2 | BUG-26 — IC catches fabricated skills | **PASS ✓** | "reflective practice" flagged as GAP_SKILL_FABRICATED |
| 3 | BUG-28/29 — AC saves final CV | **FAIL ✗** | final_cv not written (BUG-89); CV_TAILORED set but no assembled output |
| 4 | Reviewer gap interview ≥3 gaps | **PARTIAL** | 2 of 7 High gaps covered (was 1 in TC06 partial) |

---

## Bug Register

### Part 1 — Main Pipeline (2026-04-03 partial run, BUG-30 to BUG-39)

| ID | Agent | Severity | Category | Description | Status |
|----|-------|----------|----------|-------------|--------|
| BUG-30 | ProjectSetup v1.11 | P3 | Date | All timestamps in project_memory.json and cv_assembly_state.json hardcoded to `2025-05-14` | Open |
| BUG-31 | Main Orchestrator v4.0 | P1 | Model Compliance | MO narrates routing ("You are now talking to the Main Orchestrator...") — ZERO OUTPUT violation | Open (model) |
| BUG-32 | Extractor v2.0 | P2 | Schema | publications/grants/awards nested under additional_information{} instead of at candidate_profile root — **FIXED in v2.1** | Fixed |
| BUG-33 | JD Enhancer v1.3 | P3 | Date | enhanced_at hardcoded `2025-05-14T11:00:00Z` — **FIXED in v1.4** | Fixed |
| BUG-34 | Analyst v2.2 | P3 | Date | analyzed_at hardcoded `2025-05-14T12:00:00Z` | Open |
| BUG-35 | Analyst v2.2 | P3 | Model Compliance | Extra narration after completion marker | Open |
| BUG-36 | Reviewer v2.0 | P1 | Write Fail | review_audit not written, status stayed ANALYSIS_COMPLETE — **FIXED in v2.1** | Fixed |
| BUG-37 | Reviewer v2.0 | P2 | Gap Interview | Gap interview covered 1 of 7 High gaps — **FIXED in v2.1** (now 2 of 7) | Partial |
| BUG-38 | Reviewer v2.0 | P2 | Schema | candidate_provided_evidence inline on gap objects instead of root array — **FIXED in v2.1** | Fixed |
| BUG-39 | Reviewer v2.0 | P2 | Display | Premature final verdict before gap interview — **FIXED in v2.1** | Fixed |

### Part 2 — Full Continuation Run (2026-04-07, BUG-40 to BUG-89)

| ID | Agent | Severity | Category | Description | Status |
|----|-------|----------|----------|-------------|--------|
| BUG-40 | Reviewer v2.1 | P3 | Date | reviewed_at hardcoded `2025-05-14T13:00:00Z` | Open |
| BUG-41 | Reviewer v2.1 | P2 | Gap Interview | Gap interview covered 2 of 7 High gaps; spec requires up to 3 | Open |
| BUG-42 | Main Orchestrator v4.1 | P1 | Model Compliance | MO narrated routing to Tone Analyst — ZERO OUTPUT violation recurring | Open (model) |
| BUG-43 | Main Orchestrator v4.1 | P1 | Routing | Pipeline hung on MO→Tone Analyst transition; Tone Analyst never activated on one invocation | Open |
| BUG-44 | Tone Analyst v1.7 | P0 | Pipeline Stall | Tool call iteration limit (10) hit — status never updated to TONE_ANALYZED; pipeline stalled | Open |
| BUG-45 | Tone Analyst v1.7 | P1 | Schema | style_guide.json missing root-level fields (tone, voice, sentence_structure, formatting); fields nested under cv_style/cover_letter_style sub-objects | Open |
| BUG-47 | Tone Analyst v1.7 | P3 | Date | analyzed_at hardcoded `2024-05-22T12:00:00Z` | Open |
| BUG-48 | Assembly Coordinator v3.6 | P0 | Infinite Loop | AC continued executing after SwitchAgent, re-read stale phase state, called SwitchAgent again — infinite loop — **FIXED in v3.7** | Fixed |
| BUG-49 | Assembly Coordinator v3.6+ | P1 | Write | AC never writes project_memory.json status to CV_BUILDING on first invocation; status remains TONE_ANALYZED throughout assembly | Open |
| BUG-50 | Assembly Coordinator v3.6 | P2 | Model Compliance | AC output "Phase 1/8: Style Negotiation..." — ZERO OUTPUT violation during routing | Open (model) |
| BUG-51 | Style Negotiator v1.5 | P1 | Schema | agreed_overrides written as Array of strings instead of Object with named keys | Open |
| BUG-52 | Style Negotiator v1.5 | P1 | Schema | negotiation_summary written as Object instead of non-empty string | Open |
| BUG-53 | Style Negotiator v1.5 | P3 | Date | completed_at hardcoded `2025-05-14T10:15:00Z` | Open |
| BUG-54 | Profile Builder v1.6 | P2 | Logic | experience_years = 8; should be ~9 (earliest start 2017, today 2026) | Open |
| BUG-55 | Profile Builder v1.6 | P2 | Coordination | Displayed informal email (chlo-bear99@) instead of Tone Analyst's corrected professional email; user had to manually re-request correction | Open |
| BUG-56 | Profile Builder v1.6 | P3 | Date | completed_at hardcoded `2025-05-14T00:00:00Z` | Open |
| BUG-57 | Skills Curator v1.5 | P1 | Schema | tailoring_notes written as Array of strings instead of non-empty string | Open |
| BUG-58 | Skills Curator v1.5 | P2 | Model Compliance | Completion block includes routing narration ("You're now talking to the Assembly Coordinator") | Open |
| BUG-59 | Skills Curator v1.5 | P3 | Date | completed_at hardcoded `2025-05-14T00:00:00Z` | Open |
| BUG-60 | Assembly Coordinator v3.8 | P2 | Model Compliance | AC narrated routing plan before phase line — banned output | Open (model) |
| BUG-61 | History Formatter v1.4 | P1 | Schema | phases[3].data uses key `formatted_entries` instead of spec-required `work_history` | Open |
| BUG-62 | History Formatter v1.4 | P2 | Model Compliance | Routing narration after completion — "Moving to next phase" / "You are now talking to Assembly Coordinator" | Open |
| BUG-63 | History Formatter v1.4 | P3 | Date | completed_at hardcoded `2025-05-14T00:00:00Z` | Open |
| BUG-64 | Credentials Formatter v1.5 | P0 | Pipeline Stall | CF skipped entirely — activated but produced no output; phases[4] stuck PENDING | Open |
| BUG-65 | Credentials Formatter v1.5 | P1 | Wrong Path | CF instructions read certifications from `additional_information.certifications`; actual path is `skills.certifications` | Open |
| BUG-66 | Credentials Formatter v1.5 | P1 | Schema | education and certifications nested under `formatted_credentials` key instead of at root of phases[4].data | Open |
| BUG-67 | Credentials Formatter v1.5 | P1 | Schema | Education items have `{formatted_text, raw}` structure instead of spec-required `{institution, qualification, year}` | Open |
| BUG-68 | Credentials Formatter v1.5 | P3 | Date | completed_at hardcoded `2025-05-14T00:00:00Z` | Open |
| BUG-69 | Assembly Coordinator v3.6 | P0 | Routing | CoverLetter Writer skipped — AC called `"CoverLetter Writer"`, KEMU agent registered as `"Cover Letter Writer"` — **FIXED in v3.8** | Fixed |
| BUG-70 | Assembly Coordinator v3.8 | P0 | Infinite Loop | AC looped through phases 7+8 in same turn during re-run attempt — BUG-48 loop pattern recurring under re-run conditions | Open |
| BUG-71 | CoverLetter Writer v1.3 | P1 | Schema | phases[5].data uses flat strings (coverletter_body, coverletter_text) instead of nested cover_letter object; register_used missing | Open |
| BUG-72 | CoverLetter Writer v1.3 | P2 | Date | Cover letter date "14 May 2025" — hardcoded wrong year | Open |
| BUG-73 | CoverLetter Writer v1.3 | P2 | Model Compliance | Routing narration in completion block ("You're now talking to the Assembly Coordinator") | Open |
| BUG-74 | CoverLetter Writer v1.3 | P3 | Date | completed_at hardcoded `2025-05-14T14:30:00Z` | Open |
| BUG-75 | Style Reviewer v1.5 | P2 | Model Compliance | SR narrated routing ("Switching to Assembly Coordinator...") after completion marker | Open |
| BUG-76 | Assembly Coordinator v3.8 | P2 | Model Compliance | AC narrated routing to IC in completion bubble | Open (model) |
| BUG-77 | Style Reviewer v1.5 | P3 | Date | completed_at hardcoded `2025-05-14T15:00:00Z` | Open |
| BUG-78 | Integrity Checker v1.7 | P1 | Schema | phases[7].data missing spec-required fields (checks_performed, fabrications_found, evidence_verification); IC used own field names | Open |
| BUG-79 | Integrity Checker v1.7 | P0 | Data Corruption | IC wrote `\'` (invalid JSON escape) in cv_assembly_state.json — file unparseable; pipeline stalled; manually repaired | Open |
| BUG-80 | Integrity Checker v1.7 | P2 | Logic | Reasoning identified 6 unsupported claims; only 5 written to file — "education for sustainability" claim silently dropped | Open |
| BUG-81 | Integrity Checker v1.7 | P3 | Date | completed_at hardcoded `2025-05-14T16:00:00Z` | Open |
| BUG-82 | Assembly Coordinator v3.8 | P2 | Model Compliance | AC self-announced ("You are now speaking with the Assembly Coordinator") in exception handler | Open |
| BUG-83 | Assembly Coordinator v3.8 | P2 | Display | INTEGRITY_FAILED handler asked for user choice without displaying the list of unsupported claims | Open |
| BUG-84 | Assembly Coordinator v3.8 | P0 | Fabrication | AC declared "5 integrity corrections applied" and set CV_TAILORED without re-running any phase agents; fabrications remain in output | Open |
| BUG-85 | Assembly Coordinator v3.8 | P1 | Routing | AC narrated MO handoff ("I will hand you back to MO") but never called SwitchAgent | Open |
| BUG-86 | Assembly Coordinator v3.8 | P1 | Status | Invalid status transition INTEGRITY_FAILED → CV_TAILORED without remediation | Open |
| BUG-87 | Assembly Coordinator v3.8 | P2 | Display | Completion shows "✓ Application Complete" and "⚠ Issues found" simultaneously — contradictory | Open |
| BUG-88 | Assembly Coordinator v3.8 | P2 | Display | Fit score 2.1/10 displayed as final application score (it is the gap analysis score, not a quality score) | Open |
| BUG-89 | Assembly Coordinator v3.8 | P3 | Write | final_cv not written to project_memory.json despite AC claiming "✓ Optimised CV" | Open |

---

## Detailed Findings — Part 2 Continuation (Key Bugs)

### BUG-44 — Tone Analyst tool iteration limit abort
**Agent:** Tone Analyst v1.7
**Severity:** P0
**Category:** Pipeline Stall
**Observed:** Agent aborted mid-execution when KEMU hit the 10-tool-call iteration limit. project_memory.json status remained REVIEW_COMPLETE (not updated to TONE_ANALYZED). User had to manually patch project_memory.json to unblock.
**Root cause:** Tone Analyst uses ~10 tool calls for style analysis + multi-issue confirmation flow + framework aside. No margin for error.
**Recommended fix:** Either increase KEMU tool iteration limit, or restructure Tone Analyst to batch all writes in a single WriteFile call at the earliest possible point, before the confirmation flow begins.

---

### BUG-48 — Assembly Coordinator infinite loop after SwitchAgent (FIXED)
**Agent:** Assembly Coordinator v3.6
**Severity:** P0
**Category:** Infinite Loop
**Observed:** AC called SwitchAgent(target: "Style Negotiator") but did not stop execution. On the same turn, it re-read cv_assembly_state.json (still showing phase 1, since Style Negotiator hadn't run), and called SwitchAgent again — overriding the just-made routing call. Loop continued indefinitely.
**Fix applied (v3.7):** Hard-stop comment added after every SwitchAgent call in Phase 1 routing block; Critical Rule 14 added ("STOP AFTER SwitchAgent — your turn ends IMMEDIATELY"). Fix confirmed working — routing achieved on next test.
**Note:** BUG-70 shows the loop recurs under re-run conditions. Hard-stop fix is not sufficient.

---

### BUG-64 — Credentials Formatter silent skip
**Agent:** Credentials Formatter v1.5
**Severity:** P0
**Category:** Pipeline Stall
**Observed:** AC routed to Credentials Formatter (displayed "Phase 5/8: Credentials Formatting..."). CF activated but produced zero output — no chat response, no file writes. phases[4] remained PENDING.
**Expected:** CF reads cv_assembly_state.json and candidate_profile.json, formats credentials, writes phases[4].
**Root cause:** Unknown — possibly a startup error or early-exit bug in CF instructions. KEMU agent name matches exactly (confirmed by user).
**Recommended fix:** Add a startup guard and explicit error display: "If cv_assembly_state.json cannot be read or phase 5 is not PENDING, display an error and stop."

---

### BUG-79 — Integrity Checker JSON corruption
**Agent:** Integrity Checker v1.7
**Severity:** P0
**Category:** Data Corruption
**Observed:** IC wrote `\'` (escaped apostrophe) inside JSON string values. JSON does not support `\'` as an escape sequence — single quotes are not special characters in JSON and must not be escaped. The file became unparseable. All subsequent agents reading cv_assembly_state.json would fail.
**Fix applied (manual):** Python replace `content.replace("\\'", "'")` — all 5 occurrences removed.
**Recommended fix:** Add instruction note: "In JSON string values, single quotes (') are NOT escaped. Only double quotes, backslashes, and control characters require escaping in JSON."

---

### BUG-84 — AC false completion after INTEGRITY_FAILED (Critical)
**Agent:** Assembly Coordinator v3.8
**Severity:** P0
**Category:** Fabrication
**Observed:** User asked AC to fix 5 unsupported claims. AC responded "Regenerating affected sections to apply fixes..." then displayed a full completion summary claiming "5 integrity corrections applied". No phase agents were re-run. All completed_at timestamps in cv_assembly_state.json are identical to pre-fix state. project_memory.json status set to CV_TAILORED. Fabrications remain in output.
**Root cause:** AC INTEGRITY_FAILED exception handler has no remediation logic. It acknowledged the failure, narrated a fix, and force-completed the pipeline.
**Impact:** Candidate receives a CV with known fabricated claims, with no warning.
**Recommended fix:** AC INTEGRITY_FAILED handler must:
1. Read `phases[7].data.ic_corrections` (or equivalent) to identify which sections contain unsupported claims
2. Invalidate those phases (reset status to PENDING, clear data)
3. Reset current_phase to the earliest affected phase number
4. Display the list of unsupported claims with a choice: "remove and regenerate" or "accept as-is"
5. On "remove and regenerate": route to the first affected phase agent

---

## Agent-by-Agent Summary

| Agent | Version | Status | Key Bugs |
|-------|---------|--------|----------|
| Main Orchestrator | v4.0→v4.1 | ⚠ | BUG-31, BUG-42, BUG-43 |
| ProjectSetup | v1.11 | ⚠ | BUG-30 |
| Extractor | v2.0→v2.1 | ✓ | BUG-32 (fixed) |
| Researcher | v1.8 | ✓ | — |
| JD Enhancer | v1.3→v1.4 | ✓ | BUG-33 (fixed) |
| Analyst | v2.2 | ✓ | BUG-34, BUG-35 (minor) |
| Reviewer | v2.0→v2.1 | ⚠ | BUG-36 (fixed), BUG-37 (partial), BUG-40, BUG-41 |
| Tone Analyst | v1.7 | ✗ | BUG-44 (P0 stall), BUG-45, BUG-47 |
| Assembly Coordinator | v3.6→v3.8 | ✗ | BUG-48 (fixed), BUG-49, BUG-60, BUG-69 (fixed), BUG-70, BUG-76, BUG-82–89 |
| Style Negotiator | v1.5 | ⚠ | BUG-51, BUG-52, BUG-53 |
| Profile Builder | v1.6 | ⚠ | BUG-54, BUG-55, BUG-56 |
| Skills Curator | v1.5 | ⚠ | BUG-57, BUG-58, BUG-59 |
| History Formatter | v1.4 | ⚠ | BUG-61, BUG-62, BUG-63 |
| Credentials Formatter | v1.5 | ✗ | BUG-64 (P0 skip), BUG-65, BUG-66, BUG-67, BUG-68 |
| CoverLetter Writer | v1.3 | ⚠ | BUG-69 (fixed), BUG-71, BUG-72, BUG-73, BUG-74 |
| Style Reviewer | v1.5 | ✓ | BUG-75, BUG-77 (minor) |
| Integrity Checker | v1.7 | ⚠ | BUG-78, BUG-79 (P0 fixed), BUG-80, BUG-81 |

---

## Observations (Non-Bug)

- **BUG-08 FIXED + HELD** — Analyst pre-write guard working correctly across both runs. Most critical TC05 fix confirmed stable.
- **BUG-26 FIXED** — IC v1.7 correctly catches fabricated gap skills (GAP_SKILL_FABRICATED flag). The detection works; the remediation does not.
- **BUG-36 FIXED** — Reviewer v2.1 writes review_audit reliably with named-parameter fix.
- **AC hard-stop (BUG-48)** — Normal-path routing working. Loop only recurs under re-run conditions (BUG-70) — likely the phase state detection logic needs strengthening under non-linear phase entry.
- **Style Reviewer** — cleanest agent in assembly phase. PASS verdict, all 5 section_verdicts, correct status handling.
- **IC detection quality** — Identified 5/6 unsupported claims (1 dropped between reasoning and write). False positive on Baker's Delight bullet ("Served customers") worth investigating — this is real work history.
- **Hardcoded timestamps** — All 17 agents use hardcoded `2025-05-14` dates. Systemic issue. Proposed fix: `openrouter:datetime` server tool to provide real current time.

---

## Fixes Required Before TC07

### P0 — Fix before any further testing

1. **BUG-84 (AC — INTEGRITY_FAILED remediation)** — AC must invalidate affected phases, reset current_phase, and re-route. Currently force-completes with fabrications in output. This is the single most dangerous failure.
2. **BUG-44 (Tone Analyst — tool limit abort)** — Restructure to front-load WriteFile calls before confirmation flow, or increase KEMU iteration limit.
3. **BUG-64 (Credentials Formatter — silent skip)** — Add startup guard with error display. Investigate root cause of silent abort.
4. **BUG-70 (AC loop under re-run)** — Hard-stop fix not holding under re-run conditions. Strengthen phase-state detection: check if current_phase agent has already COMPLETED before routing.
5. **BUG-79 (IC — JSON corruption)** — Add note to IC instructions: do not escape single quotes in JSON.

### P1 — Fix to reach structural correctness

6. **BUG-49 (AC — CV_BUILDING never set)** — AC first-invocation write to project_memory.json never executes.
7. **BUG-45 (Tone Analyst — style_guide.json schema)** — Root-level fields (tone, voice, sentence_structure, formatting) missing; nested under sub-objects.
8. **BUG-61 (History Formatter — field name)** — `formatted_entries` → `work_history`.
9. **BUG-66/67 (Credentials Formatter — schema)** — education/certifications at root of phases[4].data, with correct item structure.
10. **BUG-65 (CF — wrong certifications path)** — `additional_information.certifications` → `skills.certifications`.
11. **BUG-71 (CoverLetter Writer — schema)** — Flat strings → nested `cover_letter` object with required sub-fields; add `register_used`.
12. **BUG-78 (IC — schema)** — Write spec-required fields: `checks_performed`, `fabrications_found`, `evidence_verification`.
13. **BUG-51/52 (Style Negotiator — schema)** — `agreed_overrides` as object not array; `negotiation_summary` as string not object.
14. **BUG-57 (Skills Curator — schema)** — `tailoring_notes` as string not array.
15. **BUG-85/86 (AC — invalid status transition)** — SwitchAgent must be called after INTEGRITY_FAILED resolution; status must not transition to CV_TAILORED without remediation.
16. **BUG-89 (AC — final_cv not written)** — final_cv assembly into project_memory.json missing.

### P2/P3 — Defer if time-constrained

17. **BUG-41 (Reviewer — gap interview coverage)** — Needs to reach 3 of 7 High gaps (currently 2).
18. **BUG-54/55 (Profile Builder — experience_years, email correction)** — Logic and coordination fixes.
19. **BUG-80 (IC — dropped claim)** — Reasoning-to-write consistency.
20. **Hardcoded timestamps (BUG-30, 34, 40, 47, 53, 56, 59, 63, 68, 74, 77, 81)** — Systemic fix via `openrouter:datetime` server tool across all 17 agents.
21. **Routing narration (BUG-42, 50, 58, 60, 62, 73, 75, 76, 82)** — Model compliance, may require stop_sequence or instruction strengthening.
22. **BUG-83 (AC — exception handler display)** — Show unsupported claims list before asking for user choice.
