# /update-instructions

Called when a bug fix needs to be applied to a KEMU agent instruction file.

## What to do

**Arguments:** `$ARGUMENTS` — the agent name, followed by the bug ID(s) to fix and a description of the change.

Examples:
- `assembly coordinator BUG-48 -- add hard stop after SwitchAgent call`
- `reviewer BUG-37 -- gap interview must ask up to 3 gaps not 1`
- `main orchestrator BUG-42 -- strengthen zero output rule`

**Parsing:**
```
const raw = "$ARGUMENTS"
// Agent name = everything before " -- " or before "BUG-"
// Bug IDs = all BUG-XX tokens
// Fix description = everything after " -- " if present
```

---

## Agent → File Map

| Agent Name (fuzzy match) | Instruction File |
|--------------------------|-----------------|
| main orchestrator / MO | `.general/instructions/main_orchestrator_agent_instructions.md` |
| project setup | `.general/instructions/project_setup_agent_instructions.md` |
| extractor | `.general/instructions/extractor_agent_instructions.md` |
| researcher | `.general/instructions/researcher_agent_instructions.md` |
| jd enhancer | `.general/instructions/jd_enhancer_instructions.md` |
| analyst | `.general/instructions/analyst_agent_instructions.md` |
| reviewer | `.general/instructions/reviewer_agent_instructions.md` |
| tone analyst | `.general/instructions/tone_analyst_agent_instructions.md` |
| assembly coordinator / AC | `.general/instructions/assembly/assembly_coordinator_agent_instructions.md` |
| style negotiator | `.general/instructions/assembly/style_negotiator_instructions.md` |
| profile builder | `.general/instructions/assembly/profile_builder_instructions.md` |
| skills curator | `.general/instructions/assembly/skills_curator_agent_instructions.md` |
| history formatter | `.general/instructions/assembly/history_formatter_agent_instructions.md` |
| credentials formatter | `.general/instructions/assembly/credentials_formatter_agent_instructions.md` |
| coverletter writer / cover letter | `.general/instructions/assembly/coverletter_writer_agent_instructions.md` |
| style reviewer | `.general/instructions/assembly/style_reviewer_agent_instructions.md` |
| integrity checker / IC | `.general/instructions/assembly/integrity_checker_agent_instructions.md` |

All paths are relative to `/Users/piny/JobApp/`.

---

## Steps

### Step 1 — Identify the file and current version

1. Match the agent name from `$ARGUMENTS` to the file map above (fuzzy match — "AC" = assembly coordinator, "MO" = main orchestrator, etc.)
2. Read the instruction file
3. Find the current version — look for `v{N}.{M}` in the first 20 lines (title/header)
4. Compute new version: bump minor by 1 (e.g. v3.7 → v3.8)

### Step 2 — Read the bug log for context (if bug IDs given)

If bug IDs were specified, read `/Users/piny/JobApp/.general/tc_running_log.md` and find those bug entries for full context on what needs fixing.

### Step 3 — Apply the fix

Make the minimum change needed to address the bug:
- Do NOT refactor unrelated sections
- Do NOT add comments beyond what's necessary for the fix
- Update the version string in the file header (title line)
- Update the version string in the file footer (final line)
- If the file has a changelog section, append a brief entry

### Step 4 — Update CLAUDE.md

In `/Users/piny/JobApp/.general/CLAUDE.md`:
1. Update the version in the "All Agents Complete" table
2. Update the version in the file reference table at the bottom
3. Add a one-line entry under the relevant TC fix block (or create a new one if needed)

### Step 5 — Update tc_running_log.md (if bug IDs given)

For each bug ID mentioned, append ` — **FIXED in v{new_version}**` to the bug's description line in the running log.

### Step 6 — Display summary

Show:
- Agent name + old version → new version
- File path edited
- Bug IDs addressed
- One-line description of the change made