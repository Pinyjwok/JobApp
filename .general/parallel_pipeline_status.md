# Parallel Pipeline + BUG-144 — Current Status

**Last updated:** 2026-04-21

---

## What's Done

### Server (`server/routes/pipeline.js`) ✅
- `AGENT_OUTPUT_VARS` — per-agent output vars + foreground flag (ps_output, analyst_output, etc.)
- `KNOWN_AGENTS` — module-scope Set, built once from AGENT_OUTPUT_VARS values
- `serializeVar()` / `logText()` helpers extracted
- `if (recipe) return;` idempotent guard on initRecipe
- `ASSEMBLY_PHASE_FILES` constant (pb/sc/hf/cf/clw → phases[1..5])
- `checkAssemblyJoin()` — merges 5 output files into cv_assembly_state.json, sets current_phase=7, dispatches Style Reviewer
- `dispatchAssemblyParallel()` — sends to 5 input nodes in parallel after done_SN
- WORKSPACE_ALLOWED — 5 new files added (pb_output.json etc.)
- **Fix:** `coverletter_writer_input` → `cover_letter_writer_input` (+ agent name `'Cover Letter Writer'`)

### Agent Instructions ✅ (files updated, need re-upload to KEMU)
- Profile Builder v1.6 → v1.7: writes `pb_output.json`, not cv_assembly_state.json
- Skills Curator v1.6 → v1.7: writes `sc_output.json`
- History Formatter v1.5 → v1.6: writes `hf_output.json` (two-turn state also in hf_output.json)
- Credentials Formatter v1.6 → v1.7: writes `cf_output.json`
- CoverLetter Writer v1.4 → v1.5: writes `clw_output.json`

### Frontend (`client/src/App.jsx`) ✅
- Removed `stageIndex` useState — derived inline from `STATUS_STAGE_INDEX[status]`

---

## Pending

### 1. KEMU canvas — export recipe ✅
User is adding per-agent output vars in KEMU canvas:
- `ps_output`, `extractor_output`, `researcher_output`, `jde_output`, `analyst_output`
- `ta_output`, `reviewer_output`, `ac_output`, `sn_output`, `mo_output`
- `pb_output`, `sc_output`, `hf_output`, `cf_output`, `clw_output`, `sr_output`, `ic_output`

Also need input nodes (already confirmed in recipe):
- `profile_builder_input`, `skills_curator_input`, `history_formatter_input`
- `credentials_formatter_input`, `cover_letter_writer_input` ✓
- `style_reviewer_input`, `integrity_checker_input` ✓

**Action:** Export recipe from KEMU → `recipe/recipe.kemu` → restart server.

### 2. Re-upload 5 agent instructions to KEMU ✅
After verifying the local files are correct (already updated):
- profile_builder_instructions.md (v1.7)
- skills_curator_agent_instructions.md (v1.7)
- history_formatter_agent_instructions.md (v1.6)
- credentials_formatter_agent_instructions.md (v1.7)
- coverletter_writer_agent_instructions.md (v1.5)

### 3. Test assembly join ⏳
Verify after full export + upload:
- Each of 5 agents writes its `{prefix}_output.json` with `status: "COMPLETE"`
- `done_PB/SC/HF/CF/CLW` all fire
- `checkAssemblyJoin()` reads all 5 files, merges into cv_assembly_state.json
- `current_phase = 7`, `completed_phases = 6`
- Style Reviewer dispatched automatically

---

## Known Recipe Issues (pre-export)
| Issue | Status |
|-------|--------|
| Per-agent output vars missing from recipe | ✅ user adding in KEMU |
| `cover_letter_writer_input` node name | ✅ fixed in server |
| `mo_output` absent from recipe | ✅ user adding |

---

## Root Cause Summary (BUG-144)
5 parallel assembly agents (PB/SC/HF/CF/CLW) all did read-modify-write on `cv_assembly_state.json` — last writer wins, 4 agents' data silently clobbered. Fix: each agent writes to dedicated `{prefix}_output.json`; server merges all 5 at `checkAssemblyJoin()` as sole writer.
