# Parallel Pipeline Implementation Plan

**Created:** 2026-04-14  
**Status:** Planning — not started  
**Goal:** Eliminate user wait time by running analysis agents in background while Tone Analyst interviews user in foreground. Run assembly agents in parallel.

---

## Architecture Overview

### New Flow

```
ProjectSetup → Extractor → Researcher → JD Enhancer
                                              ↓ [FORK]
                    ┌─────────────────────────┤
          Path A (background)        Path B (foreground)
          Analyst → Reviewer         Tone Analyst (interactive)
          sets done_analysis=1       sets done_TA=1
                    └──────────── [JOIN — server checks both flags] ──┘
                                              ↓
                             AC → Style Negotiator
                                       ↓ [PARALLEL FORK]
                         PB  SC  HF  CF  CLW  (all 5 simultaneous)
                                  ↓ [JOIN]
                          Style Reviewer → Integrity Checker
```

### Key Principle
User never idles. TA interview occupies user while Analyst + Reviewer crunch in background. By the time interview ends, analysis is complete.

---

## Phase 1: Tone Analyst Fork (Pre-Assembly Parallelism)

### Fork Point
After `JD_ENHANCED` status — TA has JD available for tone calibration.

### New Status
Add `PARALLEL_ANALYSIS` — set after JD Enhancer completes. Blocks routing until both `done_analysis = 1` AND `done_TA = 1` flags are set.

### KEMU Canvas Changes (manual)
- JD Enhancer output fans out to:
  - (A) Set `AgentSelector = "Tone Analyst"` → routes future user messages to TA
  - (B) Trigger Analyst dedicated background input node directly
- Add dedicated background input nodes for: Analyst, Reviewer
- Background path: Analyst output → Reviewer input (direct connection, no user message needed)

### Completion Flags (Global Variables)
| Flag | Set By | Meaning |
|------|--------|---------|
| `done_TA` | Tone Analyst | Style interview complete, style_guide.json written |
| `done_analysis` | Reviewer | Full analysis + audit complete |

---

## Agent Instruction Changes

### Tone Analyst (v2.2 → v3.0)
- **Trigger change:** `REVIEW_COMPLETE` → `JD_ENHANCED` (parallel path)
- **Remove:** Phase 1 fit score display (`fit score: {fitScore}/10`) — not available yet
- **Remove:** Phase 1 completion summary ("analysis complete, research gathered, etc.")
- **Replace Phase 1 intro with:** direct style interview intro (no pipeline status)
- **On completion:** set `SetGlobalVariable("done_TA", 1)`, write `style_guide.json`
- **Do NOT call SwitchAgent** — server detects both flags and routes to AC
- **Status write:** write `TONE_ANALYZED` to `project_memory.json` when complete

### Analyst (v2.5 → v2.6)
- **Trigger:** dedicated background input (not through main Switch Board)
- **No user-facing output** — run silent (no completion display, no wait message)
- **On completion:** write gap_analysis to `project_memory.json`, set status `ANALYSIS_COMPLETE`
- Call SwitchAgent directly to Reviewer (background path, no server involvement)

### Reviewer (v2.5 → v2.6)
- **Trigger:** directly from Analyst via background SwitchAgent
- **Gap interview:** SKIP (user is busy with TA — gap interview removed from this path)
  - OR defer gap interview to after TA completes (user answers gap questions post-interview)
  - **Decision needed:** keep gap interview or remove?
- **On completion:** write `review_audit` to `project_memory.json`, set `SetGlobalVariable("done_analysis", 1)`
- **Do NOT call SwitchAgent** — server detects flag

### Assembly Coordinator (v3.10 → v4.0)
- After Style Negotiator completes, trigger all 5 parallel agents simultaneously:
  ```javascript
  SetGlobalVariable("trigger_PB", 1)
  SetGlobalVariable("trigger_SC", 1)
  SetGlobalVariable("trigger_HF", 1)
  SetGlobalVariable("trigger_CF", 1)
  SetGlobalVariable("trigger_CLW", 1)
  ```
- Poll flags each turn: check `done_PB && done_SC && done_HF && done_CF && done_CLW`
- When all done → SwitchAgent("Style Reviewer")

### Profile Builder, Skills Curator, History Formatter, Credentials Formatter, CoverLetter Writer
Each agent:
- **Trigger:** own dedicated KEMU input node (watched via `trigger_XX` global var)
- **Run independently** — no dependency on each other
- **On completion:** set own done flag (`done_PB`, `done_SC`, etc.)
- **Do NOT call SwitchAgent** — AC polls and routes to Style Reviewer

---

## Server Changes (`server/routes/pipeline.js`)

### New Status in HAPPY_PATH
```javascript
// Replace:
'JD_ENHANCED': 'Analyst',
'ANALYSIS_COMPLETE': 'Reviewer',
'REVIEW_COMPLETE': 'Tone Analyst',

// With:
'JD_ENHANCED': 'PARALLEL_FORK',  // special case — triggers both paths
'PARALLEL_ANALYSIS': 'CHECK_FLAGS',  // polls done_TA + done_analysis
```

### Fork Logic (after JD_ENHANCED)
```javascript
if (status === 'JD_ENHANCED') {
  // Set foreground agent to TA
  await setGlobalVar('AgentSelector', 'Tone Analyst')
  // Trigger background Analyst input directly (KEMU API call)
  await triggerBackgroundInput('analyst_background_input', {})
  // Update status to PARALLEL_ANALYSIS
  projectMemory.metadata.status = 'PARALLEL_ANALYSIS'
  writeProjectMemory(projectMemory)
}
```

### Join Logic (after PARALLEL_ANALYSIS)
```javascript
if (status === 'PARALLEL_ANALYSIS') {
  const doneTA = await getGlobalVar('done_TA')
  const doneAnalysis = await getGlobalVar('done_analysis')
  if (doneTA && doneAnalysis) {
    // Both complete — route to AC
    await setGlobalVar('AgentSelector', 'Assembly Coordinator')
    projectMemory.metadata.status = 'TONE_ANALYZED'
    writeProjectMemory(projectMemory)
  } else if (doneTA && !doneAnalysis) {
    // TA done, analysis still running — tell user to wait briefly
    injectMessage("Analysis almost complete — please wait a moment...")
  } else {
    // Still in TA interview — route message to TA
    await setGlobalVar('AgentSelector', 'Tone Analyst')
  }
}
```

---

## KEMU Canvas Changes (Manual — you do in editor)

### New Input Nodes Needed
| Node | Purpose |
|------|---------|
| `analyst_background_input` | Triggers Analyst without user message |
| `reviewer_background_input` | Triggered directly by Analyst on completion |
| `profile_builder_input` | Triggered by AC parallel dispatch |
| `skills_curator_input` | Triggered by AC parallel dispatch |
| `history_formatter_input` | Triggered by AC parallel dispatch |
| `credentials_formatter_input` | Triggered by AC parallel dispatch |
| `coverletter_writer_input` | Triggered by AC parallel dispatch |

### Wiring Changes
- JD Enhancer output → fan-out block → (A) main switch, (B) analyst_background_input
- Analyst background → Reviewer background (direct connection)
- AC output → 5 parallel assembly agent inputs (all triggered simultaneously)
- Each parallel agent output → global var setter (done_XX = 1)
- AC polls done flags → routes to Style Reviewer when all set

---

## Open Questions (Resolve Before Building)

1. **Gap interview fate:** Reviewer currently does multi-turn gap interview with user. In new flow, user is talking to TA while Reviewer runs in background. Options:
   - **Remove gap interview** — Reviewer skips it, accepts analysis as-is
   - **Defer gap interview** — after TA + Reviewer both done, MO runs gap interview before AC
   - **Move into TA session** — TA asks gap-type questions as part of style interview

2. **TA needs JD or not?** TA currently only reads `cv_raw.txt`. If forking at `JD_ENHANCED`, TA can also read `jd_raw.txt` for tone calibration. Confirm TA should read both.

3. **Cover letter sample upload:** User currently uploads cover letter sample during TA session. In new parallel flow, this still works — TA asks for it at start of interview.

4. **CV upload at session start:** User mentioned wanting CV upload at session start (before pipeline runs). This is a frontend StartModal change — add CV + JD upload to the modal before submitting. Separate task from parallel pipeline.

---

## Implementation Order

1. **TA v3.0** — update trigger, remove fit score display, add done_TA flag, remove SwitchAgent call
2. **Server join logic** — PARALLEL_ANALYSIS status, flag polling, fork trigger
3. **Analyst v2.6 + Reviewer v2.6** — silent background mode, done_analysis flag
4. **KEMU canvas** — background input nodes, wiring
5. **AC v4.0** — parallel dispatch of 5 assembly agents
6. **Assembly agents** — add done flags, remove SwitchAgent calls
7. **KEMU canvas** — parallel assembly input nodes
8. **Frontend StartModal** — CV upload at session start (separate)

---

## Files to Modify

| File | Change |
|------|--------|
| `docs/instructions/tone_analyst_agent_instructions.md` | v3.0 — new trigger, fork-aware |
| `docs/instructions/analyst_agent_instructions.md` | v2.6 — silent background mode |
| `docs/instructions/reviewer_agent_instructions.md` | v2.6 — silent, done flag, gap interview decision |
| `docs/instructions/assembly/assembly_coordinator_agent_instructions.md` | v4.0 — parallel dispatch |
| `docs/instructions/assembly/profile_builder_instructions.md` | v1.7 — done flag |
| `docs/instructions/assembly/skills_curator_agent_instructions.md` | v1.7 — done flag |
| `docs/instructions/assembly/history_formatter_agent_instructions.md` | v1.6 — done flag |
| `docs/instructions/assembly/credentials_formatter_agent_instructions.md` | v1.7 — done flag |
| `docs/instructions/assembly/coverletter_writer_agent_instructions.md` | v1.5 — done flag |
| `server/routes/pipeline.js` | Fork + join logic, PARALLEL_ANALYSIS status |
| `client/src/components/StartModal.jsx` | CV upload at session start |
| `recipe/recipe.kemu` | Background input nodes (via KEMU editor) |
