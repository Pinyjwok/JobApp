# TC08 — Developer Brief (Stalled at Assembly Coordinator)

**Test Date:** 2026-04-10 (initial run) / 2026-04-13 (continuation)
**Candidate:** Dr. Alistair P. Whitmore
**Role:** Lecturer in Quantum Computing
**Company:** The University of Melbourne
**Test Type:** Full pipeline run — Dr. Alistair Whitmore persona (academic, quantum computing). TC08 continued from TC07 after v1.14 ProjectSetup fix. Pipeline reached TONE_ANALYZED before stalling permanently on Assembly Coordinator SwitchAgent tool-name mismatch (BUG-137). Assembly phase never executed.
**Agent versions tested:** MO v5.4→v5.5, ProjectSetup v1.14, Extractor v2.2, Researcher v2.0, JD Enhancer v1.5, Analyst v2.4, Reviewer v2.4, Tone Analyst v2.1, Assembly Coordinator v3.9 (stall), Style Negotiator v1.6 (never ran)

---

## Executive Summary

TC08 is the first run to successfully complete the analysis phase (Extractor → Researcher → JD Enhancer → Analyst → Reviewer → Tone Analyst) with the Alistair Whitmore academic persona. The pipeline reached TONE_ANALYZED but stalled permanently at Assembly Coordinator due to a P0 infinite loop: AC's `SwitchAgent("Style Negotiator")` call fails silently in KEMU — control returns to AC each turn, producing 12+ repeated routing messages with no phase agent ever executing.

41 new bugs were found in TC08 (6 P0, 21 P1, 8 P2, 6 P3). The most critical are: fabricated publications claim in Analyst strength_2 (BUG-120), Reviewer WriteFile path corruption (BUG-117 — patched mid-run), and the AC routing loop (BUG-137). The timestamp hardcoding pattern (BUG-99/114/126/128/133) is now confirmed across 5 agents with no fix applied to date.

**TC08 Pipeline Verdict: STALLED — assembly blocked by BUG-137. 41 bugs in TC08 (BUG-98 to BUG-138). All-TC running total: 106 bugs (14 P0, 41 P1, 30 P2, 21 P3).**

---

## Bug Register

| ID | Agent | Severity | Category | Description | Status |
|----|-------|----------|----------|-------------|--------|
| BUG-98 | Analyst v2.3 | P0 | Malformed JSON | Stray `.` in output — `"tier":.Baseline"` — breaks server JSON.parse, triggers MO routing fallback | Fixed in v2.4 (pre-write validation) |
| BUG-99 | Analyst v2.3 | P1 | Date | `analyzed_at` hardcoded to `"2024-05-14T12:00:00Z"` — wrong year | Open (recurring) |
| BUG-100 | Analyst v2.3 | P1 | Date | Root `metadata.lastUpdated` also hardcoded `"2024-05-14T12:00:00Z"` | Open (recurring) |
| BUG-101 | Main Orchestrator v5.4 | P1 | Narration | MO produced routing narration + called `ChangeAgent("Main Orchestrator")` on itself as fallback for failed routing | Fixed in v5.5 |
| BUG-102 | Analyst v2.3 | P2 | Schema | Spurious `candidate_profile: null` at root of project_memory.json | Open |
| BUG-103 | Extractor v2.2 | P1 | Routing | Phase 7.5 name clarification stops pipeline — Extractor did not write INITIALIZED before asking. Server reads ANALYSIS_COMPLETE → routes to Reviewer. Clarification response lost. | Fixed in v2.2 |
| BUG-104 | Extractor v2.2 | P1 | Architecture | Multi-turn clarification incompatible with server-side routing — user's answer routed to Researcher, not Extractor. | Fixed in v2.2 (in-turn resolution) |
| BUG-105 | Extractor v2.2 | P2 | Schema | `personal_info.alternate_name` written as `""` despite detecting "Vaughn-Smith, A." in publications | Open |
| BUG-106 | Researcher v2.0 | P1 | Display | Double output — completion block rendered twice. Root cause: AgentOutput fired twice in one turn. | Fixed (500ms debounce in pipeline.js) |
| BUG-107 | JD Enhancer v1.5 | P0 | Loop | JD Enhancer self-loop — ran twice due to auto-continue race condition. AgentOutput fired before WriteFile completed; stream_done triggered re-route to JD Enhancer. | Fixed (same debounce fix) |
| BUG-108 | JD Enhancer v1.5 | P1 | Routing | Critical Rule 15 said "Use SwitchAgent" — ambiguous, could cause SwitchAgent call on completion. | Fixed in v1.5 — explicit ⛔ |
| BUG-109 | JD Enhancer v1.5 | P3 | Stale | conversation_history.json logs `next_agent: "Main Orchestrator"` — stale from pre-server-routing architecture | Fixed in v1.5 |
| BUG-110 | Analyst v2.4 | P0 | Malformed JSON | Malformed JSON again: `"tier":.Baseline"` on second run after v2.4 fix upload was delayed. Workspace patched manually. | Fixed (v2.4 uploaded post-run) |
| BUG-111 | Analyst v2.4 | P1 | Performance | ~24 reasoning cycles, fit score recalculated 3 times (6.9→8.5→8.2). Model compliance — Pro 2.5 verbosity. No fix applied. | Open (model behavior) |
| BUG-112 | Analyst v2.4 | P1 | Schema | `candidate_provided_evidence` missing from gap_analysis. Spec requires empty array `[]` initialized by Analyst for Reviewer to append to. | Open (recurring, now BUG-124) |
| BUG-113 | Analyst v2.4 | P3 | Stale | `metadata.analyst_version: "2.4"` — spec says `"2.1"`. Spec is stale, not an output bug. | Spec updated |
| BUG-114 | Analyst v2.4 | P3 | Date | `analyzed_at` and `lastUpdated` both show `"2026-04-10T11:00:00Z"` — time hardcoded, date correct. Recurring. | Open |
| BUG-115 | Main Orchestrator v5.4 | P1 | Narration | MO outputs banned phrase "You are now talking to the Main Orchestrator." on REVIEW_FAILED invocation. | Fixed in v5.5 |
| BUG-116 | Main Orchestrator v5.4 | P1 | Routing | MO calls ChangeAgent on itself to "transition into Main Orchestrator". ChangeAgent does not exist. Recurring from TC07 BUG-95/96. | Fixed in v5.5 |
| BUG-117 | Reviewer v2.3 | P0 | Data Loss | `WriteFile("workspaceproject_memory.json", ...)` — "workspace" prepended to filename. KEMU created directory instead of file. review_audit and REVIEW_FAILED status lost. Content also wrapped in extra `{"project_memory": {...}}` key. | Fixed in v2.4 |
| BUG-118 | Reviewer v2.3 | P1 | Logic | Gap interview skipped on REJECTED path. Spec requires gap interview before final verdict regardless of verdict type. | Open |
| BUG-119 | Reviewer v2.3 | P2 | Narration | Reasoning-level narration before structured output: "I have analyzed the input files and performed a forensic audit..." | Open |
| BUG-120 | Analyst v2.4 | P0 | Fabrication | strength_2 claims "peer-reviewed journals" but `publications: []` empty. Evidence path resolves to PI role description — no mention of publications. | Open (pending v2.5) |
| BUG-121 | Analyst v2.4 | P1 | Evidence | Grant gap severity overstated: candidate has Lead CI grant (Internal Seed Grant 2022). Analyst missed it, classified as High severity. Should be Medium with partial evidence. | Open (pending v2.5) |
| BUG-122 | Reviewer v2.4 | P1 | Logic | Score recalculation wrong: states "6.3" but drops differentiator term. Correct total = 6.3 + (1/2 × 3) = 7.8. Caused ~50 Analyst reasoning cycles contradicting the wrong number. | Open (pending v2.5) |
| BUG-123 | Analyst v2.4 | P1 | State | Analyst re-run does not clear stale `review_audit` from project_memory.json. Reviewer re-invocation guard would skip fresh audit if stale audit is present. | Open (pending v2.5) |
| BUG-124 | Analyst v2.4 | P1 | Schema | `candidate_provided_evidence` still absent from gap_analysis on Analyst re-run. Recurring (BUG-112). | Open (pending v2.5) |
| BUG-125 | Analyst v2.4 | P2 | Evidence | strength_7 and strength_9 share same evidence path `work_history[0].responsibilities[1]`. Two strengths cannot share one evidence source. | Open |
| BUG-126 | Analyst v2.4 | P3 | Date | `analyzed_at: "2026-04-10T12:00:00Z"` — 3 days stale (run was 2026-04-13). Recurring. | Open |
| BUG-127 | Reviewer v2.4 | P1 | Version | `reviewer_version: "2.0"` — current is v2.4. Version string not updated when instructions revised. | Open |
| BUG-128 | Reviewer v2.4 | P2 | Date | `reviewed_at: "2026-04-10T12:00:00Z"` — hardcoded stale (run was 2026-04-13). Recurring. | Open |
| BUG-129 | Reviewer v2.4 | P2 | Schema | `summary.unresolved_issues` missing. Spec requires this field. File has `high_issues`/`medium_issues`/`low_issues` instead. | Open |
| BUG-130 | Reviewer v2.4 | P3 | Schema | `candidate_provided_evidence` written as raw string inside gap_1 object AND in correct top-level array. Redundant non-spec field inside individual gap. | Open |
| BUG-131 | Tone Analyst v2.1 | P2 | UX | Seniority assessment shown to user as a confirmation/correction step. Wrong assessment ("Executive") required user correction, adding an extra turn. | Open |
| BUG-132 | Tone Analyst v2.1 | P1 | Logic | Seniority assessed as "Executive" for Postdoctoral Research Fellow / GTA. Incorrect — will skew style_guide register toward management language for an academic lecturer role. | Open |
| BUG-133 | Tone Analyst v2.1 | P3 | Date | `analyzed_at: "2024-07-11T12:00:00Z"` — wrong year (2024). Recurring timestamp hardcoding. | Open |
| BUG-134 | Tone Analyst v2.1 | P1 | Logic | Root `sentence_structure: "long complex"` captures current broken state, not agreed target (max 25-30 words). Assembly agents reading root field will apply wrong target style. | Open |
| BUG-135 | Tone Analyst v2.1 | P2 | Data Loss | `examples: []` empty despite 2 example phrases identified and shown in chat. Not persisted to file. | Open |
| BUG-136 | Tone Analyst v2.1 | P3 | Narration | Completion display names "Main Orchestrator" directly — borderline pipeline narration. | Open |
| BUG-137 | Assembly Coordinator v3.9 | P0 | Loop | AC infinite loop: `SwitchAgent("Style Negotiator")` fails silently, control returns to AC every turn. 12+ repetitions of "Phase 1/8: Style Negotiation..." with Style Negotiator never executing. AC also tried `ChangeAgent` as fallback — also failed. Root cause: SwitchAgent vs ChangeAgent tool name mismatch in KEMU. Pipeline stall — assembly cannot proceed. | Open (blocking TC09) |
| BUG-138 | Assembly Coordinator v3.9 | P1 | State | AC never wrote `CV_BUILDING` to project_memory.json. `pm.status` remains `TONE_ANALYZED`. Spec requires CV_BUILDING write on first invocation. | Open |

---

## Detailed Findings

### BUG-117 — Reviewer WriteFile path corruption (PIPELINE-CRITICAL)
**Agent:** Reviewer v2.3
**Severity:** P0
**Category:** Data Loss / EISDIR
**Observed:** Reviewer called `WriteFile("workspaceproject_memory.json", ...)` — "workspace" was prepended to the filename. KEMU interpreted this as a bare filename and created a directory named `workspaceproject_memory.json/` at the repo root containing the file inside it (identical pattern to BUG-36). Additionally, the written content was wrapped in an extra `{"project_memory": {...}}` key. Result: `workspace/project_memory.json` was never written; `review_audit` and `REVIEW_FAILED` status were lost.
**Expected:** `WriteFile("project_memory.json", JSON.stringify(projectMemory, null, 2))` — bare filename, flat object.
**Impact:** Review result (REVIEW_FAILED) and all audit data lost. Pipeline continued with stale ANALYSIS_COMPLETE status. Analyst had to re-run on next user message.
**Recommended fix (applied in v2.4):** (1) `filename.startsWith('workspace')` guard — abort with error if triggered. (2) Pre-write assertion: `JSON.stringify(projectMemory)` must NOT start with `{"project_memory"` — unwrap one level if detected.

---

### BUG-120 — Analyst fabricates peer-reviewed publications claim
**Agent:** Analyst v2.4
**Severity:** P0
**Category:** Fabrication
**Observed:** `strength_2.strength_text` claims "Documented track record of high-impact research in quantum computing in **peer-reviewed journals**." Evidence path: `candidate_profile.work_history[0].responsibilities[0]` = "Principal Investigator on the 'Noise-Mitigation in Qubit Arrays' project." — no mention of publications. `candidate_profile.publications = []` (empty).
**Expected:** If no publications, no publication claim. Evidence path must resolve to the actual claim.
**Impact:** IC (Integrity Checker) verifies strength claims against cv_raw.txt. cv_raw.txt does contain 11 publications (Vaughn-Smith, A.) — IC would verify this fabrication as PASSED since it reads cv_raw.txt not candidate_profile. This is a known gap in IC's verification coverage.
**Recommended fix (pending v2.5):** Before writing any strength about publications/research output, Analyst must check `candidate_profile.publications.length > 0`. If empty, ban claims about "peer-reviewed journals" or "publication track record."

---

### BUG-137 — Assembly Coordinator infinite loop (PIPELINE-FATAL)
**Agent:** Assembly Coordinator v3.9
**Severity:** P0
**Category:** Routing / Tool Mismatch
**Observed:** AC displays "Phase 1/8: Style Negotiation..." and calls `SwitchAgent("Style Negotiator")`, but control returns to AC on every subsequent turn. 12+ identical routing messages with no phase agent ever executing. AC reasoning confirms it eventually tried `ChangeAgent` as fallback — also failed. Style Negotiator was also reported to loop when manually invoked, confirming the same tool failure on SN's `SwitchAgent("Assembly Coordinator")` return call.
**Expected:** `SwitchAgent("Style Negotiator")` hands control to Style Negotiator; SN executes, writes phases[0], returns to AC.
**Root cause:** SwitchAgent vs ChangeAgent tool name mismatch in the KEMU tool schema exposed to Pro 2.5 model. AC instructions say `SwitchAgent`; KEMU may only offer `ChangeAgent`. Neither call successfully switches agents in AC's context. This is the same underlying failure as BUG-95/96 (MO) and BUG-116 (MO) but inverted.
**Impact:** Assembly phase permanently stalled. CV output impossible without fix.
**Recommended fix:** (1) Verify exact tool name KEMU exposes to AC/SN's model — check KEMU tool schema for Pro 2.5. (2) Update AC v3.10 and all phase agent instructions to use the verified tool name with a concrete working example call. (3) Add explicit ⛔ block for the wrong tool name (mirroring MO's ChangeAgent ban).

---

### BUG-122 — Reviewer fit score recalculation drops differentiator term
**Agent:** Reviewer v2.4
**Severity:** P1
**Category:** Logic
**Observed:** Reviewer states "With correct classifications, the score is 6.3." This is only the baseline component (9 baseline items × (7/10) = 6.3). Correct total = 6.3 (baseline) + 1.5 (differentiator: 1 met / 2 preferred × 3 weight) = 7.8. Analyst spent ~50 reasoning cycles arguing against the wrong number before committing to 7.8.
**Expected:** `fit_score = (baseline_met / baseline_total × 7) + (preferred_met / preferred_total × 3)`.
**Impact:** If Reviewer's 6.3 recalculation had been accepted, it would have triggered REVIEW_FAILED (threshold = 6.5) on a borderline candidate who actually scores 7.8 — a false rejection.
**Recommended fix (pending v2.5):** Reviewer score recalculation formula must explicitly sum both components. Add a worked example to instructions: `baseline_score + differentiator_score`, with the formula inline.

---

### BUG-134 — Tone Analyst writes current (bad) style as target
**Agent:** Tone Analyst v2.1
**Severity:** P1
**Category:** Logic
**Observed:** Root field `sentence_structure: "long complex"` reflects the candidate's current problematic writing style. User agreed to fix this (max 25-30 words per sentence). The agreed fix is in `agreed_approaches` but the root field was not updated.
**Expected:** After user accepts corrections, root style fields should reflect the agreed TARGET style, not the current state.
**Impact:** Assembly agents (Profile Builder, History Formatter, etc.) read root style_guide fields to calibrate their writing. Reading `sentence_structure: "long complex"` instructs them to write long complex sentences — exactly what was corrected.
**Recommended fix:** After agreement loop, TA must update root fields to reflect agreed targets: e.g., `sentence_structure: "concise, 25-30 words per sentence"`.

---

## Agent-by-Agent Summary

| Agent | Version | Status | Bugs |
|-------|---------|--------|------|
| ProjectSetup | v1.14 | ✓ (not reached — workspace pre-loaded) | — |
| Extractor | v2.2 | ⚠ partial | BUG-103, 104, 105 |
| Researcher | v2.0 | ⚠ minor | BUG-106 |
| JD Enhancer | v1.5 | ⚠ minor | BUG-107, 108, 109 |
| Analyst | v2.4 | ✗ multiple | BUG-98, 99, 100, 102, 110–114, 120–126 |
| Main Orchestrator | v5.4→v5.5 | ⚠ (exception path) | BUG-101, 115, 116 |
| Reviewer | v2.3→v2.4 | ✗ multiple | BUG-117, 118, 119, 127–130 |
| Tone Analyst | v2.1 | ⚠ partial | BUG-131–136 |
| Assembly Coordinator | v3.9 | ✗ stall | BUG-137, 138 |
| Style Negotiator | v1.6 | ✗ never ran | — (BUG-137 root) |

---

## Observations (Non-Bug)

- **Re-invocation guard working:** Reviewer correctly skipped Phase 1–7 on second invocation, jumping directly to gap interview. The `review_audit` presence check is functioning as designed.
- **Gap interview correct:** Reviewer asked only High-severity gaps (gap_1), skipped Medium (gap_2). User-provided evidence correctly captured in top-level `candidate_provided_evidence` array.
- **Server-side routing stable:** HAPPY_PATH routing (TONE_ANALYZED → AC, REVIEW_COMPLETE → TA, etc.) worked correctly throughout — no MO invocations on happy path.
- **style_guide.json structure good:** `register: "peer-collegial"` correctly inferred for academic context. `agreed_approaches` non-spec field is useful for assembly agents.
- **Analyst reasoning verbosity:** ~24–50 reasoning cycles per run for Pro 2.5. Expected for complex gap analysis but causes UI "stall" sensation. Consider adding a token budget hint in instructions.
- **Cover letter upload auto-continue:** Frontend fix applied mid-run — `cover_letter_sample` upload during Tone Analyst now auto-sends trigger message, skipping manual interaction.

---

## Fixes Required Before TC09

**P0 — Blocking (must fix before continuing):**

1. **BUG-137 — AC SwitchAgent/ChangeAgent mismatch:** Verify exact tool name KEMU exposes to Pro 2.5 model. Update AC v3.10 and all 8 phase agent instructions to use verified name. Add ⛔ ban on wrong tool name. This is the only fix blocking assembly from starting.

**P1 — High priority:**

2. **BUG-120 — Analyst v2.5 fabrication guard:** Add pre-write check: `if publications.length === 0 → ban publication claims in strengths`. Also fix BUG-121 (grants evidence scan — check all grants before scoring gap severity), BUG-123 (delete stale `review_audit` on re-run), BUG-124 (`candidate_provided_evidence: []` init).
3. **BUG-122 — Reviewer v2.5 score formula:** Explicit `baseline_score + differentiator_score` sum with worked example.
4. **BUG-127 — Reviewer version string:** Update `reviewer_version` to "2.4" in instructions.
5. **BUG-134 — TA sentence_structure target:** After agreement loop, update root `sentence_structure` field to reflect corrected target.
6. **BUG-132 — TA seniority assessment:** Academic role titles should not classify as "Executive". Add role-type heuristic: postdoc/researcher/GTA → Mid-career Academic or Early-career Academic.

**P2/P3 — Lower priority (if time permits):**

7. **Timestamp hardcoding (BUG-99/114/126/128/133):** Audit ALL agents for hardcoded dates. Add explicit timestamp instruction block in CLAUDE.md critical rules requiring `getCurrentISOTimestamp()` for all datetime fields.
8. **BUG-129 — Reviewer summary schema:** Add `unresolved_issues` field matching spec.
9. **BUG-135 — TA examples not persisted:** Persist example phrases from identified issues to `examples[]` in style_guide.json.
10. **BUG-131 — Seniority UX:** Consider removing confirmation step if confidence is high, or accepting upload as implicit "yes" to cover letter question.
