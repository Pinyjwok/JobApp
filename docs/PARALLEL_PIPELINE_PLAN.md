# Parallel Pipeline Implementation Plan

**Created:** 2026-04-14
**Last Updated:** 2026-04-20
**Status:** In Progress — Phases 1–8 complete; Phase 0 (TC09 fixes) pending KEMU upload + TC10 clean run

---

## Architectural Decisions (locked)

1. **Dedicated input nodes per agent** — each agent gets its own named KEMU input widget. Server fires via `sendToInputWidget(nodeName, data)`.
2. **KEMU global vars for routing** — agents do NOT call SetGlobalVariable directly. KEMU canvas wires each agent's text output port → "Set Global Variable" node → sets `pipeline_status`. Server listens via `recipe.globalVariables.onChange("pipeline_status", cb)`.
3. **Done flags via canvas output wiring** — parallel agent text output port wired directly to Set Global Variable node. No agent instruction change needed.
4. **Hybrid persistence** — KEMU var owns routing (fast). JSON write to `project_memory.json` happens async for crash recovery.
5. **AgentSelector removed from happy-path** — server fires input node directly.
6. **MO exception path** — MO keeps existing switchboard wiring for exception statuses only.
7. **`set_status` tool** — agents call this tool on completion to set `pipeline_status` KEMU global var. Single string argument. Tool already built and in KEMU canvas.

---

## Status Map

```
FILES_SAVED → INITIALIZED → RESEARCH_COMPLETE → JD_ENHANCED
→ PARALLEL_ANALYSIS (TA + Analyst running simultaneously)
→ GAP_INTERVIEW (join complete, Reviewer gap interview phase)
→ REVIEW_COMPLETE / REVIEW_FAILED
→ TONE_ANALYZED → CV_BUILDING → CV_TAILORED
```

Exception statuses (route to MO): `REVIEW_FAILED`, `RESEARCH_FAILED`, `ANALYSIS_FAILED`, `EXTRACTION_FAILED`, `CV_TAILORED`

---

## Phase 0 — TC09 Fixes ⏳ In Progress

| Task | File | Status |
|------|------|--------|
| Analyst v2.6 | `docs/instructions/analyst_agent_instructions.md` | ✅ Done (workspace prefix guard + all TC09 fixes) |
| Reviewer v2.5 | `docs/instructions/reviewer_agent_instructions.md` | ✅ Done |
| Upload to KEMU | KEMU canvas | ⏳ Pending |
| TC10 clean run | — | ⏳ Pending |

Outstanding bugs before TC10: BUG-130–139 (see `docs/tc_running_log.md`)

---

## Phase 1 — KEMU Canvas: Dedicated Input Nodes + Global Var Setters ✅ Complete

Two things per agent: (1) dedicated input node, (2) Set Global Variable node wired to text output.

### Input nodes to add

| Node name | Agent | Type | Dispatch trigger |
|-----------|-------|------|-----------------|
| `extractor_input` | Extractor | foreground | FILES_SAVED |
| `researcher_input` | Researcher | foreground | INITIALIZED |
| `jd_enhancer_input` | JD Enhancer | foreground | RESEARCH_COMPLETE |
| `analyst_background_input` | Analyst | background | RESEARCH_COMPLETE fork |
| `tone_analyst_input` | Tone Analyst | foreground | RESEARCH_COMPLETE fork |
| `reviewer_input` | Reviewer | foreground | GAP_INTERVIEW |
| `assembly_coordinator_input` | Assembly Coordinator | foreground | TONE_ANALYZED |
| `style_negotiator_input` | Style Negotiator | foreground (user interaction) | AC Phase 1 signal |
| `profile_builder_input` | Profile Builder | background | parallel after SN done |
| `skills_curator_input` | Skills Curator | background | parallel after SN done |
| `history_formatter_input` | History Formatter | background | parallel after SN done |
| `credentials_formatter_input` | Credentials Formatter | background | parallel after SN done |
| `coverletter_writer_input` | CoverLetter Writer | background | parallel after SN done |
| `style_reviewer_input` | Style Reviewer | background | all 5 done flags set |
| `integrity_checker_input` | Integrity Checker | background | done_SR set |

Existing `' Message'` node kept for MO exception path only.

### Global var wiring

**A) `set_status` tool call in agent instructions** — `pipeline_status` only (value varies per agent):

| Agent | Calls |
|-------|-------|
| ProjectSetup | `set_status("FILES_SAVED")` |
| Extractor | `set_status("INITIALIZED")` |
| Researcher | `set_status("RESEARCH_COMPLETE")` |
| JD Enhancer | `set_status("JD_ENHANCED")` |
| Analyst | _(no status call — background agent)_ |
| Tone Analyst | `set_status("TONE_ANALYZED")` |
| Reviewer | `set_status("REVIEW_COMPLETE")` or `set_status("REVIEW_FAILED")` |
| Assembly Coordinator | `set_status("CV_BUILDING")` |
| Integrity Checker | `set_status("CV_TAILORED")` |

**B) Canvas output wiring** — done flags only (text output → Set Global Variable node):

| Agent | Canvas wires |
|-------|-------------|
| Researcher | text output → `done_researcher = 1` |
| Tone Analyst | text output → `done_TA = 1` |
| Analyst | text output → `done_analysis = 1` |
| Reviewer | text output → `done_RV = 1` |
| Style Negotiator | text output → `done_SN = 1` |
| Profile Builder | text output → `done_PB = 1` |
| Skills Curator | text output → `done_SC = 1` |
| History Formatter | text output → `done_HF = 1` |
| Credentials Formatter | text output → `done_CF = 1` |
| CoverLetter Writer | text output → `done_CLW = 1` |
| Style Reviewer | text output → `done_SR = 1` |
| Integrity Checker | text output → `done_IC = 1` |

---

## Phase 2 — Server Infrastructure Refactor ✅ Complete

**File:** `server/routes/pipeline.js`

All changes implemented and backward-compatible. New handlers are silent until KEMU canvas Phase 1 is done.

### What was added

- **`INPUT_NODE_MAP`** — status → dedicated node name
- **`sendToNode(node, agent, query, sessionId)`** — tries dedicated node, falls back to `' Message'` + AgentSelector if node doesn't exist yet
- **`onChange("pipeline_status")`** — auto-fires next agent; handles parallel fork at `RESEARCH_COMPLETE`
- **`checkJoin()`** + `onChange("done_TA")` / `onChange("done_analysis")` — TA + Analyst join logic
- **`checkAssemblyJoin()`** + `onChange("done_PB/SC/HF/CF/CLW")` — assembly join logic
- **`updateProjectMemoryStatus()`** — async JSON write for crash recovery
- **`routeFromStatus()`** kept as fallback for auto-continue

### INPUT_NODE_MAP

```javascript
const INPUT_NODE_MAP = {
  'FILES_SAVED':        'extractor_input',
  'INITIALIZED':        'researcher_input',
  'RESEARCH_COMPLETE':  'jd_enhancer_input',
  'JD_ENHANCED':        'analyst_background_input',
  'PARALLEL_ANALYSIS':  'tone_analyst_input',
  'GAP_INTERVIEW':      'reviewer_input',
  'TONE_ANALYZED':      'assembly_coordinator_input',
  'CV_BUILDING':        'assembly_coordinator_input',
};
```

---

## Phase 3 — StartModal + Auto-chain PS→Ex→Rs ⏳ Pending

**Files:** `client/src/components/StartModal.jsx`, `client/src/App.jsx`

- StartModal: collect CV + JD uploads before pipeline starts (partially done per git status)
- PS→Ex→Rs auto-chains via `onChange("pipeline_status")` from Phase 2 — no changes needed server-side
- Frontend: ticking progress display (PS ✓ → Ex ✓ → Rs ✓) while agents run silently
- User sees no prompts between upload and TA interview start

---

## Phase 4 — Parallel Fork: TA + Analyst ✅ Complete (server-side)

Server fork implemented in `onChange("pipeline_status")` handler at `JD_ENHANCED`
(not RESEARCH_COMPLETE — Analyst requires `enhanced_jd` which JD Enhancer produces):

```javascript
// Fork — fire both simultaneously
await Promise.all([
  sendToNode('tone_analyst_input', 'Tone Analyst', '__begin_interview__'),
  sendToNode('analyst_background_input', null, '__analyze__'),
]);
await recipe.globalVariables.setValue('pipeline_status', 'PARALLEL_ANALYSIS');
```

Join via `checkJoin()` — fires fit score message to user when both `done_TA` and `done_analysis` set.

**Redo path:** Server sets `research_confirmed = 0`, fires `researcher_input` in background. TA continues interview uninterrupted. Researcher uses canvas done flag (`done_researcher = 1`) — NOT `set_status("RESEARCH_COMPLETE")`, which would re-trigger the fork. Server's `onChange("done_researcher")` checks `research_confirmed === 0`, broadcasts updated research summary to user, waits for confirm, then forks Analyst.

---

## Phase 5 — Agent Instruction Updates: TA + Analyst

| Agent | Version | Key changes | Status |
|-------|---------|-------------|--------|
| Tone Analyst | v3.0 | Phase 0 research checkpoint + redo path; remove Phase 13; Phase 1 intro rewrite (no fit score); call `set_status("TONE_ANALYZED")`; no SwitchAgent | ✅ Done |
| Analyst | v2.7 | Silent background mode (zero user output); `research_confirmed` guard; `requirement_source` validation (BUG-131); no SwitchAgent | ✅ Done |

---

## Phase 6 — Reviewer v3.0 Restructure ✅ Complete

**File:** `docs/instructions/reviewer_agent_instructions.md`

New phase order:
1. **Phase 0 (new): Gap Interview** — before audit, all High severity gaps, both tiers, no cap
   - Each response classified: EVIDENCE (resolves gap in-place) or INTENT (gap stays)
   - Resolved gaps moved to `candidate_backed_strengths`
   - Fit score recalculated in-place after all responses
2. **Phase 1–7: Forensic audit** — WITH candidate evidence already present
3. **Phase 7.5: Interactive issue resolution** — unchanged
4. **Verdict** — unchanged

Calls `set_status("REVIEW_COMPLETE")` or `set_status("REVIEW_FAILED")` on completion. No SwitchAgent.

---

## Phase 7 — AC v4.0 + Parallel Assembly ✅ Complete

**File:** `docs/instructions/assembly/assembly_coordinator_agent_instructions.md`

### AC v4.0 changes
- Phase 0: Go-back checkpoint (moved from TA Phase 13) — fit score, resolved gaps, verdict; options to proceed or redo
- On proceed: calls `set_status("SN_START")` to signal server to dispatch Style Negotiator
- AC then ends turn — server owns all subsequent dispatch

### Server assembly dispatch sequence

**Step 1 — Style Negotiator (foreground, user interaction):**
```javascript
// onChange("pipeline_status") → "SN_START"
await sendToNode('style_negotiator_input', 'Style Negotiator', '__begin__');
await recipe.globalVariables.setValue('pipeline_status', 'STYLE_NEGOTIATING');
```

**Step 2 — Parallel dispatch (triggered by done_SN):**
```javascript
// onChange("done_SN")
await Promise.all([
  sendToNode('profile_builder_input', 'Profile Builder', '__build__'),
  sendToNode('skills_curator_input', 'Skills Curator', '__curate__'),
  sendToNode('history_formatter_input', 'History Formatter', '__format__'),
  sendToNode('credentials_formatter_input', 'Credentials Formatter', '__format__'),
  sendToNode('coverletter_writer_input', 'CoverLetter Writer', '__write__'),
]);
await recipe.globalVariables.setValue('pipeline_status', 'ASSEMBLY_PARALLEL');
```

**Step 3 — Style Reviewer (triggered by all 5 done flags):**
```javascript
// checkAssemblyJoin() — all of done_PB/SC/HF/CF/CLW set
await sendToNode('style_reviewer_input', 'Style Reviewer', '__review__');
await recipe.globalVariables.setValue('pipeline_status', 'STYLE_REVIEWING');
```

**Step 4 — Integrity Checker (triggered by done_SR):**
```javascript
// onChange("done_SR")
await sendToNode('integrity_checker_input', 'Integrity Checker', '__check__');
await recipe.globalVariables.setValue('pipeline_status', 'INTEGRITY_CHECKING');
```

### Assembly agent changes (SN/PB/SC/HF/CF/CLW/SR/IC → v+1)
- Remove `SwitchAgent("Assembly Coordinator")` call from all assembly agents
- Canvas sets `done_XX = 1` on text output (no instruction change needed for flags)
- AC no longer sub-orchestrates — server owns dispatch after AC Phase 0 confirm

---

## Phase 8 — Global Var Reset ✅ Complete

`POST /api/reset` now clears all pipeline global vars:

```javascript
const PIPELINE_VARS = [
  'pipeline_status', 'done_researcher', 'done_TA', 'done_analysis', 'done_RV',
  'research_confirmed', 'fit_score',
  'done_SN', 'done_PB', 'done_SC', 'done_HF', 'done_CF', 'done_CLW',
  'done_SR', 'done_IC',
];
```

---

## Files to Modify

| File | Phase | Status |
|------|-------|--------|
| `server/routes/pipeline.js` | 2, 4, 8 | ✅ Done |
| `client/src/components/StartModal.jsx` | 3 | ✅ Done |
| `client/src/App.jsx` | 3 | ✅ Done |
| `docs/instructions/tone_analyst_agent_instructions.md` | 5 | ✅ Done |
| `docs/instructions/analyst_agent_instructions.md` | 5 | ✅ Done |
| `docs/instructions/reviewer_agent_instructions.md` | 6 | ✅ Done |
| `docs/instructions/assembly/assembly_coordinator_agent_instructions.md` | 7 | ✅ Done |
| `docs/instructions/assembly/style_negotiator_instructions.md` | 7 | ✅ Done |
| `docs/instructions/assembly/profile_builder_instructions.md` | 7 | ✅ Done |
| `docs/instructions/assembly/skills_curator_agent_instructions.md` | 7 | ✅ Done |
| `docs/instructions/assembly/history_formatter_agent_instructions.md` | 7 | ✅ Done |
| `docs/instructions/assembly/credentials_formatter_agent_instructions.md` | 7 | ✅ Done |
| `docs/instructions/assembly/coverletter_writer_agent_instructions.md` | 7 | ✅ Done |
| `docs/instructions/assembly/style_reviewer_agent_instructions.md` | 7 | ✅ Done |
| `docs/instructions/assembly/integrity_checker_agent_instructions.md` | 7 | ✅ Done |
| `recipe/recipe.kemu` | 1 | ✅ Done |

---

## Verification Checklist

- [ ] Phase 1: KEMU canvas has all dedicated input nodes + global var setters
- [ ] Phase 2: `onChange("pipeline_status")` fires correctly; `sendToNode` falls back cleanly
- [ ] Phase 3: Upload → PS→Ex→Rs completes silently; TA begins automatically
- [ ] Phase 4: TA interview runs while Analyst runs silently; join fires fit score message
- [ ] Phase 6: Gap interview runs before audit; Reviewer has full evidence
- [ ] Phase 7: 5 assembly agents complete in parallel; Style Reviewer fires after all done flags set
- [ ] Full TC run: StartModal → CV_TAILORED with no user idle time after uploads
