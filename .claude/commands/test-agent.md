# /test-agent

Called after each KEMU agent completes during a test run. The user provides the agent name as the argument and pastes the chat interface output in the same message.

## What to do

**Arguments:** `$ARGUMENTS` — the agent name, with an optional `--reasoning` flag.

Examples:
- `extractor` — agent name only
- `extractor --reasoning` — agent name with reasoning; message contains chat output AND reasoning block (separated by `---reasoning---` or clearly labelled)

**Parsing:**
```
const args = "$ARGUMENTS".trim().split(/\s+/)
const agentName = args.filter(a => !a.startsWith("--")).join(" ")
const includesReasoning = args.includes("--reasoning")
```

When `--reasoning` is passed, treat reasoning as additional evidence. Log reasoning-only findings with `(reasoning)` tag — they are still bugs.

---

### Step 1 — Read state file and agent specs

Read both files at the start of every invocation:

1. **`/Users/piny/JobApp/.general/tc_state.md`** — get `last_bug_id` and `running_totals`
2. **`/Users/piny/JobApp/.general/agent_test_specs.md`** — get verification criteria for this agent (read the relevant section only)

Do NOT read the full agent instruction files. The spec file has everything needed.

---

### Step 2 — Read the agent's output files

| Agent | Files to read from `/Users/piny/JobApp/` |
|-------|------------------------------------------|
| main orchestrator | No files written — check chat output only |
| project setup | `project_memory.json`, `cv_assembly_state.json`; confirm `cv_raw.txt` + `jd_raw.txt` exist |
| extractor | `candidate_profile.json`, `project_memory.json` |
| researcher | `project_memory.json` (research_data section) |
| jd enhancer | `project_memory.json` (enhanced_jd section) |
| analyst | `project_memory.json` (gap_analysis section) |
| reviewer | `project_memory.json` (review_audit + metadata.status) |
| tone analyst | `style_guide.json`, `project_memory.json` (metadata.status only) |
| assembly coordinator | `cv_assembly_state.json` (current_phase, metadata.status), `project_memory.json` (metadata.status) |
| style negotiator | `cv_assembly_state.json` → phases[0] |
| profile builder | `cv_assembly_state.json` → phases[1] |
| skills curator | `cv_assembly_state.json` → phases[2] |
| history formatter | `cv_assembly_state.json` → phases[3] |
| credentials formatter | `cv_assembly_state.json` → phases[4] |
| coverletter writer | `cv_assembly_state.json` → phases[5] |
| style reviewer | `cv_assembly_state.json` → phases[6] + metadata.status |
| integrity checker | `cv_assembly_state.json` → phases[7] + metadata.status |

For large files (project_memory.json after analyst/reviewer), use `offset`/`limit` to read only the relevant section rather than the full file.

---

### Step 3 — Cross-check against spec

Using the criteria from `agent_test_specs.md` for this agent:

1. **File data vs chat output** — flag discrepancies between what was saved and what was displayed
2. **File data vs spec** — flag missing fields, wrong values, wrong status, hardcoded timestamps, schema mismatches
3. **Chat output vs spec** — flag missing required display elements, banned phrases, wrong routing messages

---

### Step 4 — Assign bug IDs

Continue sequentially from `last_bug_id` in `tc_state.md` (e.g. if last is BUG-06, next is BUG-07).

Severity:
- **P0 — Critical:** Data loss, fabrication passed through, infinite loop, pipeline stall
- **P1 — High:** Wrong data written, schema mismatch, routing failure
- **P2 — Medium:** Display issues, missing fields, wrong version logged
- **P3 — Low:** Minor formatting, cosmetic, date/time inaccuracy

---

### Step 5 — Append to running log

Append to `/Users/piny/JobApp/.general/tc_running_log.md`:

```markdown
## [Agent Name] — [timestamp from file or "unknown"]

**Status written:** [value or "N/A"]
**Version logged:** [value or "not found"]
**Phase advanced:** [N → N+1 or "N/A"]

### Findings

| ID | Severity | Description |
|----|----------|-------------|
| BUG-XX | P0 | ... |

### Chat vs File discrepancies
[List or "None detected"]

### Notes
[Non-bug observations]
```

If no bugs: write `✓ No issues found.` under Findings.

---

### Step 6 — Update tc_state.md

Overwrite `/Users/piny/JobApp/.general/tc_state.md` with updated values:

```
last_bug_id: BUG-XX
running_totals: N bugs (X P0, Y P1, Z P2, W P3)
current_tc: TCxx
```

---

### Step 7 — Display summary to user

Show a compact table — bug IDs, severities, one-line descriptions. Do not repeat the full log. End with:

`Running total: N bugs (X P0, Y P1, Z P2, W P3)`

---

## Seed-Based Testing

For targeted reruns without running the full pipeline:

### Seed A — Post-JD Enhancer (`status: JD_ENHANCED`)
**Location:** `/Users/piny/JobApp/.general/seeds/seed_a_jd_enhanced/`
**Files:** project_memory.json (JD_ENHANCED), candidate_profile.json, cv_raw.txt, jd_raw.txt, conversation_history.json, agent_reasoning.json
**Use for:** Testing Analyst and Reviewer in isolation — copy all files to KEMU workspace, set Analyst as active agent

### Seed B — Post-Tone Analyst (`status: TONE_ANALYZED`)
**Location:** `/Users/piny/JobApp/.general/snapshots/pre_assembly/chloe_simmons/`
**Files:** Full pre-assembly state including style_guide.json, candidate_profile.json, project_memory.json
**Use for:** Testing full assembly phase — copy all files to KEMU workspace, set Assembly Coordinator as active agent

### Creating new seeds mid-run
After a clean pipeline run reaches a target state, snapshot the KEMU workspace files to `.general/seeds/seed_[name]/` before continuing.
