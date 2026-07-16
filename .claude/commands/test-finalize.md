# /test-finalize

Called at the end of a full KEMU test run to write the completed TC brief.

---

## Step 1 — Read the running log and final state

1. `docs/tc_running_log.md` — in full
2. `docs/tc_state.md` — `current_tc`, `last_bug_id`, `running_totals`
3. `workspace/project_meta.json` — candidate/company/position metadata
4. `docs/tests/TC08_Developer_Brief.md` — the most recent brief; match its format and tone
5. `docs/handover.md` — the authority on current architecture (auto-loaded by the SessionStart hook, so
   it's already in context). Use it to sanity-check findings before they harden into a brief. Don't cite
   `docs/CLAUDE.md` — its prose is stale.

**`project_memory.json` does not exist** — it was eliminated. Final pipeline status is a server-owned
in-memory variable, not a file; take the run's end state from the log and from which output files exist
in `workspace/` (`tailored_cv.json` present ⇒ the run reached `CV_TAILORED`).

---

## Step 2 — Determine the output filename

Briefs live in `docs/tests/`. Existing: TC01_TC02, TC03–TC08. Next is `TC09_Developer_Brief.md`, then
TC10, etc. Use `current_tc` from `tc_state.md` if it disagrees with the filename sequence — and flag the
disagreement rather than silently picking one.

---

## Step 3 — Write the brief

Write to `docs/tests/TC[XX]_Developer_Brief.md`:

```markdown
# TC[XX] — Developer Brief
**Test Date:** [today]
**Candidate:** [name from candidate_profile.json or the log]
**Role:** [position_title from project_meta.json]
**Company:** [company_name from project_meta.json]
**Test Type:** [e.g. "Full pipeline run — first run after the deterministic-offload passes"]
**Agent versions tested:** [from the running log]

---

## Executive Summary

[2-3 sentences: overall pipeline health, bug count by severity, which agents had issues, how far the run got]

---

## Bug Register

| ID | Agent | Severity | Category | Description | Instruction File | Status |
|----|-------|----------|----------|-------------|------------------|--------|
| BUG-01 | ... | P0 | ... | ... | ... | New |

**Agent** may be `Server` — see the split below. For Server bugs the "Instruction File" column is the
source file (e.g. `server/lib/dispatch.js`).

---

## Server vs Agent split

List separately any finding whose owner is the server, not an agent. The server-owned surfaces are in the
preamble of `docs/agent_test_specs.md` (durations, seniority years, fit score, review audit, tone
validation, assembly validation, adjudicator verdicts, date substitution, style-guide synthesis).

This section exists because the offloads moved a whole class of former agent bugs into
`server/lib/dispatch.js`, and a brief that files them against agents sends fixes to the wrong file — and
those fixes would then need a KEMU upload that isn't actually required.

---

## Detailed Findings

### BUG-XX — [Short title]
**Agent:** [name, or Server]
**Severity:** [P0/P1/P2/P3]
**Category:** [Data Loss / Fabrication / Schema / Routing / Display / Date / Server-owned / etc.]
**Observed:** [what actually happened — file data or chat output]
**Expected:** [what the spec says should happen]
**Reference:** [spec section, instruction file, or server function]
**Impact:** [effect on downstream agents or output quality]
**Recommended fix:** [concrete change]

---

## Agent-by-Agent Summary

| Agent | Version | Status | Bugs |
|-------|---------|--------|------|
| ProjectSetup | v1.18 | ✓ / ⚠ / ✗ | BUG-XX, ... |

---

## Observations (Non-Bug)

[What worked, quality notes, things to watch next run]

---

## Fixes Required Before TC[XX+1]

Priority order:
1. [P0 fixes]
2. [P1 fixes]
3. [P2/P3 if time permits]

**Split by where the fix lands:**
- **Server** (`server/lib/dispatch.js` etc.) — live on restart, no upload
- **Agent instructions** — inert until uploaded to KEMU. List which agents need re-upload.
```

---

## Step 4 — Sync versions

If the run revealed a version mismatch (agent reported a version that disagrees with the tables), fix all
three places: `docs/CLAUDE.md`, `MEMORY.md`, and the agent file header. See `/update-instructions` Step 4.

---

## Step 5 — Clear the running log

Reset `docs/tc_running_log.md` to just its `# TC Running Log` heading so it's ready for the next run.

---

## Step 6 — Confirm

Show the output filename and total bug count, split agent vs server. Flag which agents need a KEMU
upload. Do not repeat the brief content.

Note `docs/` is gitignored — the brief is local-only and won't show in `git status`.
