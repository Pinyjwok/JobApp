# /update-instructions

Apply a change to a KEMU agent instruction file, bump its version, and sync the three places version
truth lives.

**Arguments:** `$ARGUMENTS` — agent name, optional bug ID(s), and a description of the change.

Examples:
- `assembly coordinator BUG-48 -- add hard stop after SwitchAgent call`
- `reviewer -- gap interview must ask up to 3 gaps not 1`
- `extractor BUG-150 -- company_name must be semantic-read not regex`

**Parsing:** agent name = everything before ` -- ` or before `BUG-`. Bug IDs = all `BUG-XX` tokens
(optional — the TC bug-log workflow is dormant, most changes now arrive without one). Fix description =
everything after ` -- `.

> **If the change is moving deterministic logic (math / string ops / path resolution / bucketing) out of
> the agent and into server JS, stop and use the `offload` skill instead.** That is a different, larger
> pass — it writes the server function, picks a hook point, and de-codes the agent. This command is for
> instruction-only edits.

---

## Agent → File Map

All paths relative to `/Users/piny/JobApp/docs/instructions/`.

| Agent (fuzzy match) | File |
|---|---|
| main orchestrator / MO | `main_orchestrator_agent_instructions.md` |
| project setup / PS | `project_setup_agent_instructions.md` |
| extractor | `extractor_agent_instructions.md` |
| researcher | `researcher_agent_instructions.md` |
| jd enhancer / JDE | `jd_enhancer_instructions.md` |
| analyst | `analyst_agent_instructions.md` |
| analyst validator | `analyst_validator_instructions.md` |
| reviewer | `reviewer_agent_instructions.md` |
| tone analyst / TA | `tone_analyst_agent_instructions.md` |
| assembly coordinator / AC | `assembly/assembly_coordinator_agent_instructions.md` |
| style negotiator / SN | `assembly/style_negotiator_instructions.md` |
| profile builder / PB | `assembly/profile_builder_instructions.md` |
| skills curator / SC | `assembly/skills_curator_agent_instructions.md` |
| history formatter / HF | `assembly/history_formatter_agent_instructions.md` |
| credentials formatter / CF | `assembly/credentials_formatter_agent_instructions.md` |
| coverletter writer / CLW | `assembly/coverletter_writer_agent_instructions.md` |
| style reviewer / SR | `assembly/style_reviewer_agent_instructions.md` |
| integrity checker / IC | `assembly/integrity_checker_agent_instructions.md` |
| document formatter / DF | `assembly/document_formatter_agent_instructions.md` |

**Retired — do not edit, the KEMU node is deleted:**

| Agent | File (lingers on disk) | Superseded by |
|---|---|---|
| tone validator | `tone_validator_instructions.md` | server `runToneValidation` (dispatch.js) |
| assembly validator | `assembly_validator_agent_instructions.md` | server `_assemblyChecks` / `_runAssemblyValidator` |

If the request targets a retired agent, say so and stop — the behaviour now lives in server JS, so the fix
belongs in `server/lib/dispatch.js`, not an instruction file. The **analyst** validator is still an LLM
(inline tool sub-agent, DeepSeek R4 Pro) and IS editable.

---

## Steps

### Step 1 — Identify the file and current version

1. Fuzzy-match the agent name to the map above.
2. Read the instruction file.
3. Current version is in the title line (`# Extractor Agent v2.5 — System Instructions`) and the identity
   table (`| **Version** | 2.5 |`). They must agree — if they don't, flag it.
4. New version = bump minor by 1 (v2.4 → v2.5). Major bumps are for role changes only (e.g. SR v2.x → v3.0
   when it became the final editorial polisher) — don't bump major without saying why.

### Step 2 — Read bug context (only if bug IDs given)

Read `docs/tc_running_log.md` and find those entries. The log is dormant (last written 2026-04-20, TC09) —
if the ID isn't there, don't invent context, just apply the described fix.

### Step 3 — Apply the fix

Minimum change to address the issue:
- Do NOT refactor unrelated sections.
- Prohibitions need the **reason** attached — a bare "don't" gets re-derived away by the next model.
  `**⚠️ Do NOT compute duration.** … hand-computed durations from a model are a known error source.`
- Update the version in the **title line**, the **identity table** (`**Version**` + `**Last Updated**`,
  today's date), and the **footer version string** if the file has one.
- Add a changelog blockquote near the top, matching house style:
  `> **v4.7 — <what changed>.** <why, in one or two sentences>`
- If the file has a Critical Rules footer list and the change adds a hard rule, append a numbered one-liner.

### Step 4 — Sync the version tables (all three, together)

1. `docs/CLAUDE.md` — "All Agents Complete" table row, plus a one-line entry in the relevant fix block.
   Its version table is worth syncing; its prose is stale — don't add narrative there.
2. `/Users/piny/.claude/projects/-Users-piny-JobApp/memory/MEMORY.md` — "Current Agent Versions" table row.
3. The agent file header (done in Step 3).

Drift between these three is the normal failure. Check all three even if only one was reported wrong.

For anything more than a one-line fix, also add a section at the top of **`docs/handover.md`** — the
authority doc, auto-loaded into every session by the SessionStart hook. Match the house shape
(`# ✅ IMPLEMENTED <date> — <what>` / Why / What shipped / Files touched / KEMU upload checklist). Write
"pending" where it's pending: handover already carries one claim that something was applied when it never
was (`handover.md:205`), and that survived because nobody re-checked.

### Step 5 — Flag the KEMU upload

**The edit is inert until the file is uploaded to KEMU.** The repo copy is not what runs. Mark the agent
`⏳ pending KEMU upload` in the `MEMORY.md` version table, and say so in the summary.

Note `docs/` is gitignored — these edits are local-only and won't show in `git status`.

### Step 6 — Update the bug log (only if bug IDs given)

Append ` — **FIXED in v{new_version}**` to each bug's line in `docs/tc_running_log.md`.

### Step 7 — Report

- Agent, old version → new version
- File path edited
- One-line description of the change
- Bug IDs addressed (if any)
- **⏳ pending KEMU upload** reminder
