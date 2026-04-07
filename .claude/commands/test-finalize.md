# /test-finalize

Called at the end of a full KEMU test run to write the completed TC brief.

## What to do

### Step 1 — Read the running log

Read `/Users/piny/JobApp/.general/tc_running_log.md` in full.

Also read:
- `/Users/piny/JobApp/project_memory.json` — for final pipeline status and candidate/company metadata
- `/Users/piny/JobApp/.general/TC01_TC02_Developer_Brief.md` — to match the format and style of the existing brief

### Step 2 — Determine the output filename

Check what TC brief files already exist in `/Users/piny/JobApp/.general/`:
- If TC01 and TC02 exist → new file is `TC03_Developer_Brief.md`
- If TC03 exists → `TC04_Developer_Brief.md`
- And so on.

### Step 3 — Write the TC brief

Write the new brief to `/Users/piny/JobApp/.general/[TCxx]_Developer_Brief.md` matching the format of `TC01_TC02_Developer_Brief.md`:

```markdown
# TC[XX] — Developer Brief
**Test Date:** [today's date]
**Candidate:** [name from project_memory or running log]
**Role:** [positionTitle]
**Company:** [companyName]
**Test Type:** [e.g. "Full pipeline run — Chloe Simmons (same profile as TC01, second run after TC01/TC02 fixes)"]
**Agent versions tested:** [list all agent versions from running log]

---

## Executive Summary

[2-3 sentence summary of overall pipeline health — how many bugs, what severity, which agents had issues]

---

## Bug Register

| ID | Agent | Severity | Category | Description | Instruction File | Status |
|----|-------|----------|----------|-------------|------------------|--------|
| BUG-01 | ... | P0 | ... | ... | ... | New |

---

## Detailed Findings

### BUG-XX — [Short title]
**Agent:** [name]
**Severity:** [P0/P1/P2/P3]
**Category:** [Data Loss / Fabrication / Schema / Routing / Display / Date / EISDIR / etc.]
**Observed:** [What actually happened — file data or chat output]
**Expected:** [What the instructions say should happen]
**Instruction reference:** [File and section]
**Impact:** [Effect on downstream agents or output quality]
**Recommended fix:** [Concrete change needed]

---

## Agent-by-Agent Summary

| Agent | Version | Status | Bugs |
|-------|---------|--------|------|
| ProjectSetup | v1.6 | ✓ / ⚠ / ✗ | BUG-XX, ... |
...

---

## Observations (Non-Bug)

[Things that worked well, quality notes, things to watch in next test run]

---

## Fixes Required Before TC[XX+1]

Priority order:
1. [P0 fixes]
2. [P1 fixes]
3. [P2/P3 fixes if time permits]
```

### Step 4 — Clear the running log

After writing the brief, delete or empty `/Users/piny/JobApp/.general/tc_running_log.md` so it's ready for the next test run.

### Step 5 — Confirm to user

Display the output filename and total bug count. Do not repeat the full brief content.
