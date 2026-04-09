# TC07 — Developer Brief (Aborted — Pipeline-Fatal Bug)

**Test Date:** 2026-04-09
**Candidate:** Dr. Alistair P. Whitmore
**Role:** Lecturer in Quantum Computing
**Company:** University of Melbourne (School of Physics)
**Test Type:** New persona run — Dr. Alistair Whitmore (academic, quantum computing). TC07 was aborted at ProjectSetup after BUG-91 was discovered: cv_raw.txt contains entirely fabricated content, making all downstream extraction and integrity verification invalid.
**Agent versions tested:** MO v5.2, ProjectSetup v1.13, Researcher v2.0 (only three agents reached before abort)

---

## Executive Summary

TC07 was aborted after two pipeline stages due to a pipeline-fatal bug: ProjectSetup hallucinated a synthetic CV and stored it in `cv_raw.txt` instead of preserving the user's uploaded content verbatim. The fabricated CV describes a completely different academic (CQC2T Sr. Research Fellow, Yale postdoc, Oxford PhD 2011–2015) with no overlap to the actual candidate (UTS postdoc 2021–present, Cavendish Lab 2015–2020, Cambridge PhD 2018). Since every downstream agent — Extractor, Analyst, and Integrity Checker — reads `cv_raw.txt` as the ground truth for evidence verification, this invalidates the entire pipeline output.

Secondary findings: Main Orchestrator used the wrong routing tool (`ChangeAgent` instead of `SwitchAgent`) and violated the ONE CALL RULE by calling it three times. ProjectSetup also produced banned pipeline narration and hardcoded timestamps.

**TC07 Pipeline Verdict: ABORTED — pipeline-fatal fabrication in cv_raw.txt (BUG-91). 8 bugs total in TC07 (BUG-90 to BUG-97). Running all-TC total: 65 bugs (8 P0, 20 P1, 22 P2, 15 P3).**

---

## Bug Register

| ID | Agent | Severity | Category | Description | Status |
|----|-------|----------|----------|-------------|--------|
| BUG-90 | Researcher v2.0 | P3 | Narration | Completion output includes banned hand-off narration: "Next: JD Enhancer will analyse and enrich the job description." | Open |
| BUG-91 | ProjectSetup v1.13 | P0 | Fabrication | cv_raw.txt contains entirely fabricated content — a different academic's profile (CQC2T, Yale, Oxford) bearing no resemblance to the uploaded CV (UTS, Cavendish, Cambridge). Breaks all downstream evidence verification. | Open |
| BUG-92 | ProjectSetup v1.13 | P1 | Data Loss | jd_raw.txt is a compressed summary (~1,344 bytes) of the full JD. Missing: salary details, accountability percentages (45/40/15), full KSC essential/desirable split, PCS Level B appendix, mandatory compliance section. | Open |
| BUG-93 | ProjectSetup v1.13 | P1 | Date | Timestamps hardcoded to `2025-05-14T10:00:00Z` / `10:10:00Z`. Today is 2026-04-09. Recurring pattern from TC06 (BUG-30). | Open |
| BUG-94 | ProjectSetup v1.13 | P2 | Schema | metadata.version = "2.0" — spec requires "1.0" written by ProjectSetup. | Open |
| BUG-95 | Main Orchestrator v5.2 | P1 | Routing | MO used `ChangeAgent` instead of `SwitchAgent` — wrong tool name. Reasoning explicitly states "I will call ChangeAgent a third time." `ChangeAgent` does not exist in KEMU. | Open |
| BUG-96 | Main Orchestrator v5.2 | P1 | Routing | ONE CALL RULE violated — MO called ChangeAgent/SwitchAgent three times in same turn attempting to switch to ProjectSetup. | Open |
| BUG-97 | ProjectSetup v1.13 | P2 | Narration | Completion display includes banned pipeline narration: "Next: The Extractor agent will now parse your CV and the job description to identify key details like the company name, position, and technical requirements." | Open |

---

## Detailed Findings

### BUG-91 — cv_raw.txt fabricated (PIPELINE-FATAL)
**Agent:** ProjectSetup v1.13
**Severity:** P0
**Category:** Fabrication / Data Loss
**Observed:** `cv_raw.txt` (1,277 bytes) contains a synthetic academic CV describing a "Senior Research Fellow at CQC2T" with a postdoc at "Yale Quantum Institute" and a PhD from "University of Oxford, 2011–2015."
**Expected:** Raw verbatim content of the uploaded CV (Dr. Alistair P. Whitmore, UTS Postdoctoral Research Fellow 2021–present, Cavendish Laboratory 2015–2020, PhD Cambridge 2018).
**Impact:** Extractor extracts the wrong person's history. Integrity Checker's `verifyEvidence()` reads cv_raw.txt as ground truth — it will verify claims against the fabricated document, not the candidate's actual background. Every output from this pipeline run is invalid.
**Recommended fix:** ProjectSetup must write the raw file upload content verbatim using `WriteFile("cv_raw.txt", rawCvContent)` where `rawCvContent` is exactly the text provided by the user — no summarization, reformatting, or generation. Add an explicit instruction: "WRITE THE USER'S TEXT EXACTLY AS PROVIDED. DO NOT SUMMARIZE, REWRITE, OR GENERATE CONTENT."

### BUG-92 — jd_raw.txt summarized
**Agent:** ProjectSetup v1.13
**Severity:** P1
**Category:** Data Loss
**Observed:** `jd_raw.txt` (1,344 bytes) contains a condensed summary with generic bullet points. The actual JD is substantially longer and includes: full salary ($110,245–$130,801 p.a. + 17% super), three-part accountability breakdown (Research 45%, Teaching 40%, Service 15%), detailed KSC with separate essential/desirable criteria, PCS Level B classification appendix, and mandatory compliance section (WWCC, OHS, Equal Opportunity).
**Expected:** Raw verbatim JD content.
**Impact:** JD Enhancer and Analyst operate on incomplete requirements. Salary and classification details are lost. Desirable criteria (supervision experience, industry partnerships) absent from gap analysis.
**Recommended fix:** Same as BUG-91 — WriteFile with verbatim content only.

### BUG-95 — MO uses ChangeAgent (wrong tool)
**Agent:** Main Orchestrator v5.2
**Severity:** P1
**Category:** Routing
**Observed:** MO reasoning explicitly states "I will call `ChangeAgent` a third time" when attempting to switch to ProjectSetup. `ChangeAgent` does not exist in KEMU — the correct tool is `SwitchAgent`.
**Expected:** `SwitchAgent(target: "ProjectSetup", context: {})` called once.
**Impact:** If ChangeAgent silently fails, MO loops. If KEMU treats it as a no-op tool call, the agent switch never happens. Explains why MO retried three times.
**Recommended fix:** MO instructions already say `SwitchAgent` — this is a model compliance failure. Consider adding an explicit ⛔ block: "The routing tool is SwitchAgent. ChangeAgent does not exist. Never call ChangeAgent."

### BUG-96 — MO ONE CALL RULE violated
**Agent:** Main Orchestrator v5.2
**Severity:** P1
**Category:** Routing
**Observed:** MO called ChangeAgent/SwitchAgent three times in the same turn. Reasoning shows it retried because the previous call appeared not to work.
**Expected:** SwitchAgent called exactly once per routing turn.
**Impact:** Each extra SwitchAgent call can trigger an extra agent_switch SSE event, potentially causing the frontend to label subsequent output under the wrong agent name.
**Recommended fix:** Already addressed in v5.2 ONE CALL RULE instruction. Model compliance issue — reinforcement may require a stop_sequence or tool-call-only mode for MO.

---

## Agent-by-Agent Summary

| Agent | Version | Status | Bugs |
|-------|---------|--------|------|
| Main Orchestrator | v5.2 | ✗ Fail | BUG-95, BUG-96 |
| ProjectSetup | v1.13 | ✗ Fail | BUG-91 (P0), BUG-92, BUG-93, BUG-94, BUG-97 |
| Extractor | v2.1 | — Not reached | — |
| Researcher | v2.0 | ⚠ Minor | BUG-90 |
| JD Enhancer | v1.4 | — Not reached (aborted) | — |
| All assembly agents | — | — Not reached | — |

---

## Observations (Non-Bug)

- Researcher v2.0 schema was fully correct — all 9 fields present, 8/8 count displayed, status RESEARCH_COMPLETE. Only issue was one narration line.
- Server-side rerun intent detection worked correctly for the Researcher rerun triggered by user.
- MO's reasoning loop (multiple ChangeAgent retries) indicates the model does not receive clear feedback when a tool call fails silently — it retries instead of stopping. Stop-sequence or tool-call-only mode for MO routing turns would prevent this.
- Timestamp hardcoding (`2025-05-14`) has now appeared in TC06 (BUG-30) and TC07 (BUG-93) — it is a persistent pattern in Gemini Flash 3 agents. Likely to recur in all agents unless an explicit guard is added to agent instructions (e.g., "The hardcoded date 2025-05-14 is WRONG — always use getCurrentISOTimestamp()").
- cv_raw.txt fabrication may be caused by KEMU WriteFile receiving a generated string rather than the raw upload content. Investigate whether the raw upload is correctly plumbed through to ProjectSetup's input context.

---

## Fixes Required Before TC08

**P0 — Must fix:**
1. **ProjectSetup v1.13** — Enforce verbatim file save for cv_raw.txt and jd_raw.txt. Add explicit instruction: "DO NOT summarize, reformat, or generate CV/JD content. Write the user's raw input exactly as provided using WriteFile." Investigate whether raw upload content is correctly available in agent context.

**P1 — Should fix:**
2. **Main Orchestrator v5.2** — Add explicit ⛔ block banning `ChangeAgent`. "The routing tool is `SwitchAgent`. `ChangeAgent` does not exist in this system." Consider enforcing ONE CALL RULE via stop_sequence on routing turns.
3. **ProjectSetup v1.13** — Remove pipeline narration from completion display ("Next: The Extractor agent will now parse your CV...").
4. **Timestamp guard** — Add a shared note to all agents: "The date 2025-05-14 is a wrong hardcoded example from past runs. Always call `getCurrentISOTimestamp()`. Never hardcode any date."

**P2 — Nice to fix:**
5. **ProjectSetup v1.13** — Fix metadata.version to "1.0".
6. **Researcher agent_test_specs.md** — Update spec version from v1.8 to v2.0.
