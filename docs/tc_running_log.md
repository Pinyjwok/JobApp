# TC Running Log

## TC09 — 2026-04-20

**Run summary:** REVIEW_FAILED on first Analyst run (fabricated gap paths). Redo Analyst triggered — double-fired. Reviewer narrated banned hand-off. Processing aborted. Pipeline stalled.

---

| ID | Severity | Agent | Description |
|----|----------|-------|-------------|
| BUG-130 | P1 | Analyst | Gap IDs written as `gap_hidden_1`, `gap_hidden_2` — non-standard naming. Should be `gap_1`, `gap_2`. Reviewer displayed these IDs in audit output, indicating Analyst wrote hidden/extra gaps not shown in Phase 12 summary. |
| BUG-131 | P0 | Analyst | Phase 10 Step 3b validates gap `evidence_source` but NOT `requirement_source`. Fabricated paths (`enhanced_jd.key_responsibilities.duties[2]`, `duties[4]`) pass through unchecked. Reviewer flags both as High severity → REVIEW_FAILED. Fix: extend resolvePath validation to `requirement_source` on all gap objects. |
| BUG-132 | P0 | Server | After "redo analyst", Analyst fires twice. First run produces 7.7/10; user sends "." → Analyst fires again producing 6.9/10 with different results. Race condition: server routes "." to Analyst (status still JD_ENHANCED or ANALYSIS_COMPLETE not yet written) before first run completes. |
| BUG-133 | P2 | Reviewer | Produces banned narration on REVIEW_FAILED path: "I have completed the review and presented the results. The Main Orchestrator will now take over to discuss the next steps based on the REJECTED verdict." Explicitly banned in Reviewer Critical Rule. |
| BUG-134 | P1 | Server/KEMU | "⏹ Processing aborted" after double-fire (BUG-132). Second Analyst run and Reviewer competing caused KEMU to abort. Pipeline stalled — required restart. |

| BUG-135 | P1 | Reviewer | Second banned narration turn: "My role as the Reviewer is complete. The analysis was rejected due to quality issues. The Main Orchestrator will present you with the options to correct this. I have already handed off control and cannot take further action." Reviewer is producing multiple narration turns after Phase 11 ends. |
| BUG-136 | P0 | Server | After REVIEW_FAILED, user message "continue to orchestrator" routed to MO but MO said "You are now talking to the Main Orchestrator." — explicit banned phrase. Then user message "review failed what are your options" was routed to Reviewer instead of MO. Server failed to read REVIEW_FAILED status and set correct AgentSelector. Reviewer then presented REVIEW_FAILED options menu (MO's job). |
| BUG-137 | P2 | MO | Outputs banned phrase: "You are now talking to the Main Orchestrator." Listed in banned phrases since v4.4. |
| BUG-138 | P1 | Reviewer | Responds to post-Phase-11 user message by presenting REVIEW_FAILED options — MO's exclusive responsibility. Reviewer should produce zero output after Phase 11 write completes. |

| BUG-139 | P0 | Analyst | Re-run WriteFile prepends "workspace" to filenames — creates `workspaceproject_memory.json/` directory at repo root instead of writing file. Same as BUG-117 (Reviewer). Analyst filename guard missing `startsWith('workspace')` check. Fixed in v2.6. |

**TC09 total: 10 bugs (4 P0, 3 P1, 3 P2)**

---

## TC10 — Extractor (v2.2) — 2026-04-20

**Status written:** `EXTRACTION_FAILED` (metadata + root-level)
**Version logged:** v2.2 (via agent_test_specs.md; not logged in output)
**Phase advanced:** N/A — stopped at name mismatch

### Findings

| ID | Severity | Description |
|----|----------|-------------|
| BUG-140 | P2 | project_memory.json has duplicate root-level `status` field (= "EXTRACTION_FAILED") alongside `metadata.status`. Schema spec defines only `metadata.status`. Root-level field causes schema drift — downstream agents reading `projectMemory.status` instead of `projectMemory.metadata.status` would get stale values on next run if only `metadata.status` is updated. |
| BUG-141 | P3 | Spurious `project_path: "project_memory.json"` field at root of project_memory.json. Not in schema spec. Likely PS artifact. |

### Chat vs File discrepancies
None detected. MO correctly received EXTRACTION_FAILED and displayed 3-option menu (same person / name change / different person). Chat output matches file state.

### Notes
- EXTRACTION_FAILED path working correctly: failure_reason + alternate_name_detected written to metadata ✅
- candidate_profile.json written correctly with full extraction (11 publications, 2 roles, 3 education entries) ✅
- Publications faithfully copied from CV verbatim — name mismatch (Vaughn-Smith, A. vs Whitmore) correctly detected ✅
- agent_test_specs.md still lists Extractor as v2.1 — needs update to v2.2

---

## TC10 — Analyst (v2.7) — 2026-04-20

**Status written:** `ANALYSIS_COMPLETE` (after recovery)
**Phase advanced:** N/A (background agent)
**gap_analysis present:** Yes

### Findings

| ID | Severity | Description |
|----|----------|-------------|
| BUG-142 | P0 | Race condition: TA and Analyst simultaneously R/M/W `project_memory.json`. TA's write wiped the `enhanced_jd` section from PM while Analyst was processing. Analyst detected corruption mid-run. Recovery only succeeded because `enhanced_jd.json` (stale from prior run — see BUG-145) happened to exist in workspace. Without it, pipeline would be dead. |
| BUG-143 | P0 | AgentOutput KEMU global var shared by all agents — parallel agents overwrite each other's output. Analyst's set_status/completion text overwrote TA's interview output in AgentOutput. Last writer wins. |
| BUG-144 | P1 | Analyst v2.7 produced visible `set_status("ANALYSIS_COMPLETE")` as text output mid-run (before detecting corruption). Background agent spec requires zero text output. Output hitting AgentOutput also triggers the race condition in BUG-143. |
| BUG-145 | P1 | `/api/reset` does not clear `enhanced_jd.json` from workspace. Stale file from prior run persisted. Analyst used it for recovery — but this is lucky, not designed. If prior-run JD differed, recovery would produce wrong analysis. Fix: `POST /api/reset` must delete all non-raw workspace files (everything except cv_raw.txt / jd_raw.txt). |

### Chat vs File discrepancies
gap_analysis written to project_memory.json ✅. Analyst's reconstruction dropped `tailored_cv: null` and `status` root field (both schema deviations from prior agents — net neutral). Status ANALYSIS_COMPLETE written correctly. Recovery succeeded this run only due to stale file.

### Notes
- gap_analysis present and status = ANALYSIS_COMPLETE — pipeline can continue this run
- Race condition will recur deterministically on every clean run without architectural fix
- enhanced_jd.json should not exist in workspace (created by prior run, not cleaned by reset)
