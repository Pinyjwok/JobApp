# Fix Plan: Analyst → Reviewer Auto-Cascade

**Created:** 2026-03-26
**Status:** APPROVED — ready for implementation
**Scope:** Analyst v1.7 and Main Orchestrator v3.5

---

## Problem Summary

After the Analyst completes its gap analysis, the pipeline fails to auto-cascade to the Reviewer. Instead, one of two failure modes occurs:

- **Mode A:** User sends "continue" → Analyst re-runs full analysis and overwrites `gap_analysis` in `project_memory.json`
- **Mode B:** Main Orchestrator generates visible text during silent routing (violates ZERO OUTPUT rule), confusing the pipeline state

Root causes are ranked below by probability.

---

## Root Cause Analysis

### Cause 1 — MO v3.5: Three contradictory sections (VERY HIGH probability)
**File:** `main_orchestrator_agent_instructions.md`

Three sections directly contradict each other:

| Section | Line | Says |
|---------|------|------|
| ZERO OUTPUT Rule | 61–83 | "You call ReadFile → call SwitchAgent. Nothing else. **Never** generate any text during routing." |
| Automatic Workflow Principle | 98–116 | "2. **Display** brief progress update" (with example showing `Display "✓ Data extracted..."`) |
| Phase 2 routing table | 234–244 | Every row has a `Progress Message` column with display strings, including `"✓ Quality review..."` for `ANALYSIS_COMPLETE` |

The LLM resolves contradictions non-deterministically. Some turns it follows ZERO OUTPUT; other turns it follows the routing table and generates text. When it generates text, that output occupies the turn and MO may fail to call SwitchAgent in the same turn.

**Fix:** Remove the `Progress Message` column from the routing table entirely and delete the "Display brief progress update" step from the Automatic Workflow Principle. The ZERO OUTPUT rule is the correct behaviour — worker agents already display their own "Next:" lines to the user (added in Researcher v1.6 and JD Enhancer v1.3). Consolidate all three sections so they say the same thing.

---

### Cause 2 — Analyst v1.7: No re-invocation guard + contradictory Phase 12 (VERY HIGH probability)
**File:** `analyst_agent_instructions.md`

**Problem A — Missing re-invocation guard:**
Phase 1 (lines 206–236) reads `status` but does nothing with it:
```javascript
const status = projectMemory.metadata.status
// status is read but never checked against "ANALYSIS_COMPLETE"
```
The Reviewer has a correct guard (lines 143–149 of reviewer instructions):
```javascript
if (status === "REVIEW_COMPLETE" || status === "REVIEW_FAILED") {
  SwitchAgent(target: "Main Orchestrator", context: {})
  END TURN
}
```
The Analyst has no equivalent. When the user sends "continue" after seeing the Phase 12 summary, KEMU re-invokes the Analyst, which re-runs the full analysis from Phase 1 and overwrites `gap_analysis`.

**Problem B — Contradictory Phase 12 instructions:**
Phase 12 (lines 780–830) says:
```
Display: "Send any message to continue."
Then immediately:
  SwitchAgent(target: "Main Orchestrator", context: {})
Turn ENDS.
```
On KEMU's turn-based system, displaying output ends the turn. A SwitchAgent call after a display cannot execute in the same turn — the display already ended it. The `Then immediately: SwitchAgent(...)` instruction is unreachable in practice.

**Fix A:** Add re-invocation guard at the top of Phase 1, immediately after reading `status`:
```javascript
// RE-INVOCATION CHECK
if (status === "ANALYSIS_COMPLETE") {
  SwitchAgent(target: "Main Orchestrator", context: {})
  END TURN
}
```

**Fix B:** Remove the `Then immediately: SwitchAgent(...)` block from Phase 12. The turn-based pattern is: display output → turn ends → user sends message → re-invocation guard fires → routes to MO. Phase 12 should end at the display only.

Also update Critical Rules:
- Rule 20: Remove "Prompt for continuation — 'Send any message to continue'" (this is correct behaviour, but Rule 21 is the mechanism)
- Rule 21: Change to "End turn after display — SwitchAgent fires on re-invocation via guard in Phase 1"

---

### Cause 3 — Three-agent cascade in one KEMU turn (MEDIUM probability)
**Affected flow:** Analyst → MO → Reviewer

If MO's ZERO OUTPUT rule is followed correctly, MO reads status and calls SwitchAgent in the same turn that the Analyst returned to it. This chains three agents (Analyst→MO→Reviewer) within what KEMU may consider a single cascaded turn.

KEMU may have a cascade depth limit. If so, the Reviewer never gets invoked.

**Note:** This is secondary to Cause 1 and 2. The turn-based completion pattern (worker displays → waits → user message → routes to MO → MO silently routes to next worker) already breaks this cascade at the worker display step. Fixing Cause 2 (removing SwitchAgent from Phase 12, adding re-invocation guard) means:
- Analyst Phase 12: displays and ends turn
- User sends "continue"
- Analyst Phase 1 guard: routes to MO (turn ends)
- MO: reads ANALYSIS_COMPLETE → routes to Reviewer (turn ends)

This is a 3-step cascade across separate user-initiated turns — not a single-turn cascade. This cause is not an independent problem; it resolves automatically when Cause 2 is fixed.

**No separate fix needed.** Monitor after Cause 1 + 2 fixes.

---

### Cause 4 — MO pulling example text into live routing output (MEDIUM probability)
**File:** `main_orchestrator_agent_instructions.md`, lines 106–112

The Automatic Workflow Principle contains a live example:
```
You: Display "✓ Data extracted → Researching {Company}..."
You: SwitchAgent(Researcher) [immediately, same turn]
```
LLMs can pattern-match from this example and emit the example text literally during routing, rather than treating it as illustrative. This would produce visible output like `"✓ Data extracted → Researching {Company}..."` with the literal placeholder `{Company}` unresolved.

**Fix:** This is resolved by Fix 1 (removing the Automatic Workflow Principle's display step and the routing table's Progress Message column). The example block should be updated to show silent routing only.

---

### Cause 5 — Stale version string in Analyst Phase 11 log (LOW probability)
**File:** `analyst_agent_instructions.md`

Phase 11 logs `version: "1.6"` (stale). Should be `"1.7"`. Not a cascade issue — cosmetic only.

**Fix:** Update version string in Phase 11 log entry to `"1.7"`.

---

## Implementation Order

| # | Fix | File | Priority | Risk |
|---|-----|------|----------|------|
| 1 | Remove `Progress Message` column from routing table | MO | Critical | Low |
| 2 | Remove "Display brief progress update" from Automatic Workflow Principle | MO | Critical | Low |
| 3 | Update Automatic Workflow Principle example to show silent routing | MO | Critical | Low |
| 4 | Consolidate ZERO OUTPUT rule, AWP, and routing table into consistent message | MO | Critical | Low |
| 5 | Add re-invocation guard to Analyst Phase 1 | Analyst | Critical | Low |
| 6 | Remove unreachable SwitchAgent from Analyst Phase 12 | Analyst | Critical | Low |
| 7 | Update Analyst Critical Rules 20–21 | Analyst | Medium | Low |
| 8 | Update version string in Phase 11 log | Analyst | Low | None |

---

## Exact Changes

### MO Fix (main_orchestrator_agent_instructions.md)

**Section: Automatic Workflow Principle (lines 98–116)**

Replace:
```
When you regain control after a worker agent completes:

1. Read project_memory.json status
2. Display brief progress update
3. Immediately route to next agent (no waiting)

Example:
[Extractor completes, switches back to you]
You: Read status → "INITIALIZED"
You: Display "✓ Data extracted → Researching {Company}..."
You: SwitchAgent(Researcher) [immediately, same turn]

User sees continuous progress updates without needing to respond.
User can interrupt anytime by typing 'pause' to stop and review.
```

With:
```
When you regain control after a worker agent completes:

1. Read project_memory.json status
2. Immediately route to next agent — ZERO OUTPUT (no text, no display)

Example (correct silent routing):
[Extractor completes, switches back to you]
ReadFile("project_memory.json")          ← silent
status = "INITIALIZED"                   ← silent
SwitchAgent(target: "Researcher", ...)   ← silent
[Turn ends — no text output]

Worker agents display their own completion summaries and "Next:" lines.
You do NOT add additional progress messages.
User can interrupt anytime by typing 'pause' to stop and review.
```

**Section: Phase 2 routing table (lines 234–244)**

Remove the `Progress Message` column entirely. Replace the table with a compact reference matching CLAUDE.md:

```
| Status | Next Agent | Context Passed |
| --- | --- | --- |
| FILES_SAVED | Extractor | {project_path} |
| INITIALIZED | Researcher | {project_path} |
| RESEARCH_COMPLETE | JD Enhancer | {project_path} |
| JD_ENHANCED | Analyst | {project_path, profile_path} |
| ANALYSIS_COMPLETE | Reviewer | {project_path, profile_path, jd_path, cv_path} |
| REVIEW_COMPLETE | Tone Analyst | {project_path, profile_path} |
| TONE_ANALYZED | Assembly Coordinator | {project_path, profile_path, cv_state_path} |
| CV_BUILDING | Assembly Coordinator | {project_path, profile_path, cv_state_path} |
| REVIEW_FAILED | None (user choice) | N/A |
| CV_TAILORED | None (display completion) | N/A |
```

Also remove `Display:` lines from each `CASE` block in the routing logic (e.g. `Display: "✓ Files saved → Extracting data..."` at line 257, and equivalent lines for every other case). Each CASE block should contain only the SwitchAgent call.

**Version bump:** 3.5 → 3.6

---

### Analyst Fix (analyst_agent_instructions.md)

**Section: Phase 1 (after line 222 — after `const status = projectMemory.metadata.status`)**

Insert immediately after the status extraction line:
```javascript
// RE-INVOCATION CHECK
// If user sent "continue" after the completion display, analysis is already done.
// Route immediately to Main Orchestrator without re-running analysis.
if (status === "ANALYSIS_COMPLETE") {
  SwitchAgent(target: "Main Orchestrator", context: {})
  END TURN
}
```

**Section: Phase 12 (lines 822–828)**

Remove the `Then immediately:` block entirely. Phase 12 ends at the display.

Replace:
```
Send any message to continue.
```

**Then immediately:**
```javascript
SwitchAgent(
  target: "Main Orchestrator",
  context: {}
)
```

**Turn ENDS.**

With:
```
Send any message to continue.
```

**Turn ENDS. On next turn, Phase 1 re-invocation guard routes to Main Orchestrator.**

**Section: Critical Rules**

Rule 20: Change from:
```
20. **Prompt for continuation** - "Send any message to continue"
```
To:
```
20. **Prompt for continuation** - "Send any message to continue" — then end turn
```

Rule 21: Change from:
```
21. **Use SwitchAgent** - SwitchAgent(target: "Agent Name")
```
To:
```
21. **Re-invocation guard** - Phase 1 checks status === "ANALYSIS_COMPLETE" and routes immediately
```

**Section: Phase 11 agent_reasoning.json log**

Update version string: `"1.6"` → `"1.7"`

**Version bump:** 1.7 → 1.8

---

## Post-Fix Expected Behaviour

```
Analyst Phase 12: displays "✓ Gap Analysis Complete" summary
                  ends turn (no SwitchAgent here)
                  user sees: "Send any message to continue."

User sends: "continue"

Analyst Phase 1:  reads status = "ANALYSIS_COMPLETE"
                  re-invocation guard fires
                  SwitchAgent(target: "Main Orchestrator")
                  turn ends

Main Orchestrator: ReadFile("project_memory.json")    ← silent
                   status = "ANALYSIS_COMPLETE"        ← silent
                   SwitchAgent(target: "Reviewer")     ← silent
                   turn ends

Reviewer Phase 1:  begins audit
                   [no output until Phase 10]
```

---

## Files to Touch

1. `/Users/piny/JobApp/.general/instructions/main_orchestrator_agent_instructions.md`
2. `/Users/piny/JobApp/.general/instructions/analyst_agent_instructions.md`

**Do NOT touch any assembly agents, Reviewer, or other pipeline agents as part of this fix.**

---

## Version Tracking

| File | Before | After |
|------|--------|-------|
| main_orchestrator_agent_instructions.md | v3.5 | v3.6 |
| analyst_agent_instructions.md | v1.7 | v1.8 |
