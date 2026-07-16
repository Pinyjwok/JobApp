# /test-agent

Called after each KEMU agent completes during a test run. The user provides the agent name as the
argument and pastes the chat interface output in the same message.

**Arguments:** `$ARGUMENTS` — the agent name, with an optional `--reasoning` flag.

- `extractor` — agent name only
- `extractor --reasoning` — message contains chat output AND a reasoning block (separated by
  `---reasoning---` or clearly labelled)

Agent name = all non-`--` tokens joined. When `--reasoning` is passed, treat reasoning as additional
evidence and tag reasoning-only findings `(reasoning)` — they are still bugs.

---

## Step 1 — Read state and specs

1. `docs/tc_state.md` — `last_bug_id` and `running_totals`
2. `docs/agent_test_specs.md` — the section for this agent **plus the "Read this before filing any bug"
   preamble**. The preamble carries the server-owned-logic table, which is what stops most false bugs.

Do NOT read the full agent instruction file. The spec has what's needed.

**Authority order when sources disagree:** the **code** (`server/lib/dispatch.js`,
`server/config/constants.js`) beats **`docs/handover.md`** beats this spec beats `docs/CLAUDE.md` (stale —
don't cite it). handover.md is auto-loaded into your context by the SessionStart hook, so it's already
there; grep it before filing anything architectural. But treat its "applied / done" claims as unverified —
it's a plan-and-log hybrid and has at least one known-false cleanup claim. Confirm against code.

---

## Step 2 — Read the agent's output files

All paths relative to `/Users/piny/JobApp/workspace/`. **`project_memory.json` does not exist** — it was
eliminated. If the spec and a file disagree, trust the file and flag the spec.

| Agent | Files to read |
|---|---|
| main orchestrator | none written — chat output only (reads `mo_dispatch.json`) |
| project setup | `project_meta.json`; confirm `cv_raw.txt` + `jd_raw.txt` exist **as files, not dirs** |
| extractor | `candidate_profile.json`, `project_meta.json` |
| researcher | `research_output.json` |
| jd enhancer | `enhanced_jd.json` |
| analyst | `gap_analysis.json`, `analyst_validator_verdict.json` |
| analyst validator | `analyst_validator_verdict.json` |
| tone analyst | `style_findings.json`, `tone_validator_verdict.json` (server's strip log) |
| reviewer | `review_audit.json` (server-written), `gap_analysis.json` |
| style negotiator | `sn_groups.json` (agent's only write); `sn_output.json` for the server's merge |
| profile builder | `pb_output.json`, `cv_assembly_state.json` → `phases[1]` |
| skills curator | `sc_output.json`, `cv_assembly_state.json` → `phases[2]` |
| history formatter | `hf_output.json`, `cv_assembly_state.json` → `phases[3]` |
| credentials formatter | `cf_output.json`, `cv_assembly_state.json` → `phases[4]` |
| cover letter writer | `clw_output.json`, `cv_assembly_state.json` → `phases[5]` |
| style reviewer | `cv_assembly_state.json` → `phases[6]` + `current_phase` |
| integrity checker | `cv_assembly_state.json` → `phases[7]` + `current_phase` |
| document formatter | `df_output.json`, `tailored_cv.json`, `cv_assembly_state.json` → `phases[8]` |

For any assembly agent also read `assembly_validator_verdict.json` — the server's FLAG notes for that
phase.

**Retired — if the user names one of these, stop and say so.** Their output appearing at all is **P0**
(stale KEMU node still wired): `tone validator`, `assembly validator`, `assembly coordinator`.

---

## Step 3 — Cross-check against spec

1. **File vs chat** — discrepancies between what was saved and what was displayed
2. **File vs spec** — missing fields, wrong values, schema mismatch, hardcoded timestamps
3. **Chat vs spec** — missing required display elements, banned narration, hand-off announcements

**Before filing, check the server-owned table in the spec preamble.** If the wrong value is
`duration_years`, seniority years, `fit_score`, `review_audit.json`, style-guide contents, or a stripped
quote, the agent is innocent — the bug is in `server/lib/dispatch.js`. File it against **Server**, not
the agent.

The mirror check: if the agent **computed** something server-owned, that IS an agent bug (**P1**), even
when the number is right.

---

## Step 4 — Assign bug IDs

Sequential from `last_bug_id` in `docs/tc_state.md`.

- **P0** — data loss, fabrication reaching output, infinite loop, pipeline stall
- **P1** — wrong data written, schema mismatch, routing failure, agent doing server-owned math
- **P2** — display issues, missing non-critical fields, narration, hardcoded dates
- **P3** — cosmetic, header/version drift

---

## Step 5 — Append to the running log

Append to `docs/tc_running_log.md`:

```markdown
## [Agent Name] — [timestamp from file or "unknown"]

**Version logged:** [value or "not found"]
**Output file(s):** [written / missing]
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

If no bugs: `✓ No issues found.` under Findings.

---

## Step 6 — Update tc_state.md

Overwrite `docs/tc_state.md`:

```
last_bug_id: BUG-XX
running_totals: N bugs (X P0, Y P1, Z P2, W P3)
current_tc: TCxx
```

---

## Step 7 — Report

Compact table — bug IDs, severities, one-line descriptions. Don't repeat the full log. End with:

`Running total: N bugs (X P0, Y P1, Z P2, W P3)`

---

## Seed-Based Testing

Seeds in `docs/seeds/` and `docs/snapshots/`. **All predate the `project_memory.json` elimination** — any
seed containing that file will not load. Verify a seed's file set against the table in
`docs/agent_test_specs.md` before use; prefer re-cutting from a clean run.

**Creating a seed:** after a clean run reaches the target state, copy `workspace/` to
`docs/seeds/seed_<name>/` before continuing.
