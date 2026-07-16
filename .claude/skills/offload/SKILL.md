---
name: offload
description: Move deterministic logic out of a KEMU agent's instructions and into server JS (dispatch.js), then sync the agent file, version tables and memory. Use when an agent is hand-executing math, string ops, path resolution or bucketing — the recurring "LLMs executing pseudocode is a bug factory" fix.
argument-hint: <agent name> <what to offload> — e.g. "extractor duration_years math"
---

# /offload

Move deterministic logic from a KEMU agent instruction file into server JS. This has been done ~7 times
(fit score, review audit, seniority years, role durations, tone validation, assembly validation); the steps
below are what those passes actually did, not a generic refactor guide.

**Arguments:** `$ARGUMENTS` — agent name + what to offload. Fuzzy-match the agent (MO, AC, TA, IC, SN, PB…).

---

## Step 0 — Decide it actually qualifies

The rule, learned the hard way in both directions:

| Kind of work | Owner |
|---|---|
| Date math, sums, durations, ratios, scores | **server** |
| String matching, regex, verbatim checks, dedupe | **server** |
| Path resolution, file shape checks, field mapping | **server** |
| Bucketing/banding a number into a label | **server** |
| Counting, thresholds, gates on a number | **server** |
| "What does this human sentence mean?" | **LLM** |
| Semantic entailment, false-positive hunting | **LLM** |
| Relevance / classification requiring world knowledge | **LLM** |

**The inverse trap is real.** Don't fake judgment with regex. EVIDENCE-vs-INTENT gap-answer classification
("I have citizenship" vs "I plan to get citizenship" — same keywords) is irreducibly semantic and stayed an
LLM call in `server/lib/adjudicator.js` (OpenRouter, batched, temp 0, JSON-only, fail-closed). If the logic
needs to read a human sentence and decide what it *means*, it does not belong in this skill's pattern — it
belongs in an adjudicator-style LLM call, with the server still owning every mechanical effect afterwards.

The tell that something qualifies: **the agent is producing a number or a string it cannot verify**, and it
drifts between runs (the Tone Analyst re-estimated "today" and re-summed years forever — 8.25/8.3/8.4/12.3…),
or a model hand-computes a float (Extractor's `duration_years`).

Split judgment from mechanism. The agent keeps the judgment call and emits **tags only**; the server does the
math on those tags. Canonical example: TA emits `role_classification[]{employer, relevant, is_employment}`,
server reads `candidate_profile.json` dates and computes `years_experience` / `relevant_years_experience` /
`career_stage`.

If it doesn't qualify, say so and stop. Don't offload judgment.

---

## Step 1 — Read the current state

1. Agent instruction file in `docs/instructions/` (or `docs/instructions/assembly/`).
2. Find the pseudocode/math block to remove. Note **every** consumer of the field it produces — grep the
   workspace filename + field name across `docs/instructions/` and `server/`.
3. Read `server/lib/dispatch.js` around the lifecycle point where the agent returns.

Consumers must be unchanged by this work. The field keeps its name and shape; only the *producer* moves.

---

## Step 2 — Write the server function

In `server/lib/dispatch.js`. Match the house style exactly — read `computeRoleDurations` (~line 190),
`runToneValidation` (~228), `computeSeniorityYears` (~286) before writing.

Non-negotiables, all learned from real breakage:

- **Exported named function**, verb-first: `computeX` / `runX` / `applyX`.
- **A comment block above it explaining WHY** — which LLM failure this kills. Every existing offload has one.
  This is the single most valuable artifact of the pass; without it the next reader re-litigates the decision.
- **Read defensively, bail silently:**
  ```js
  let profile;
  try { profile = JSON.parse(readFileSync(join(WORKSPACE_DIR, 'candidate_profile.json'), 'utf8')); } catch { return; }
  ```
  A missing/unparseable file is a no-op, never a throw. `WORKSPACE_DIR` comes from `server/config/constants.js`.
- **Validate shape before touching:** `if (!Array.isArray(work) || !work.length) return;`
- **Idempotent.** Safe to call on every agent return. Track a `changed` flag and only write if it flipped.
- **Write back with 2-space JSON:** `writeFileSync(p, JSON.stringify(x, null, 2))`, wrapped so a write
  failure warns rather than crashes the pipeline: `catch (e) { console.warn(\`[durations] write failed: ${e.message}\`); }`
- **Tolerate real-world input.** `parseYearMonth` accepts `2025-03`, `03/2025`, `March 2025`, bare `2025`,
  `Present`. `normalizeForMatch` folds smart quotes/dashes/whitespace/case — a quote differing only by a curly
  apostrophe is still verbatim. Being strict here is what makes an LLM look tempting again.
- **Match loosely when joining agent tags to data.** Employer keys join via `normEmployer` + substring
  tolerance in both directions — the LLM will not echo the employer string byte-exact.
- If replacing a validator: still **write the verdict file** the downstream agent reads
  (`tone_validator_verdict.json` etc.) so no consumer changes. Deterministic remediation beats an LLM
  REJECT/retry loop — an ungrounded quote is the agent's own captured data, so just drop it and record it in
  `issues[]` with `severity: 'resolved'`.

---

## Step 3 — Pick the hook point

Call it where the agent's output is **known fresh**, not merely where the agent returned.

- Post-TA: inside `fireTAAndAnalyst`, **after** the `awaitOutputReady(agent, dispatchStart)` freshness guard
  passes and before `stampTimestamp` (see `runToneValidation()` / `computeSeniorityYears()` at ~line 362).
- Post-Extractor: inside `resolveExtractorStatus` on the success path (~line 886) — so it runs on *every*
  Extractor return, including redos.

`dispatchStart = Date.now()` is an mtime floor so a stale prior-run file can't satisfy the guard. If you skip
the freshness guard you will compute over last run's file. Order matters: strip/clean first, then compute over
the cleaned data, then stamp.

---

## Step 4 — De-code the agent instructions

Edit the agent file so it can no longer even attempt the work:

1. **Title line:** `# Extractor Agent v2.5 — System Instructions` → bump minor.
2. **Identity table:** `**Version** | 2.5` and `**Last Updated** | YYYY-MM-DD` (today, AU format elsewhere).
3. **Changelog note near the top**, blockquote style, stating what moved and why:
   > **v4.7 — seniority math offloaded to server.** Phase 2 no longer does date/year arithmetic (it caused
   > a cyclic re-estimation loop)… the TA emits **judgment only**…
4. **Replace the pseudocode block with prose.** Explicit prohibition + who owns it now + why:
   > **⚠️ Do NOT compute duration.** Do not calculate months/years, do not resolve "Present" to today, do not
   > do any date math. Just capture `start_date` and `end_date` verbatim. The server computes `duration_years`
   > … hand-computed durations from a model are a known error source.
5. **Schema comments** where the agent writes its output:
   `// NOTE: do NOT write years_experience / career_stage — the server computes them from the dates + your role_classification.`
   If a field is structurally required, tell it to emit `0` and note the server overwrites.
6. **Critical Rules footer** — append a numbered one-liner:
   `12. **Do NOT compute durations** - capture start_date/end_date verbatim; the server computes duration_years`
7. **Footer version string** if present.
8. If the offload deletes a validator node, mark the node **RETIRED** with the date and reason, and say the
   KEMU canvas node must be deleted.

Prohibitions land better with the *reason* attached — a bare "don't" gets re-derived away by the next model.

---

## Step 5 — Write it down (three places, all together)

**1 — `docs/handover.md`.** This is the authority doc and it's auto-loaded into every session by the
SessionStart hook, so it's the entry that actually gets read. Add a new section at the **top**
(reverse-chronological) matching the house shape:

```
# ✅ IMPLEMENTED <date> — <what moved> (live on restart, no KEMU change | ⚠️ KEMU upload)
## Why            ← the LLM failure this kills
## What shipped   ← function + file + hook point
## Files touched
## ⚠️ KEMU upload checklist
```

Be honest in it. handover has at least one claim that something was "applied" when it never was
(`handover.md:205`, the Assembly Coordinator cleanup) — that false claim survived because nobody
re-checked. If a step is pending, write pending.

**2 — the version tables**, all three, or they drift:
- `docs/CLAUDE.md` — "All Agents Complete" table row. (Its version table is still worth syncing; its
  prose is stale — don't add narrative there.)
- `/Users/piny/.claude/projects/-Users-piny-JobApp/memory/MEMORY.md` — agent version table row.
- The agent file header (done in Step 4).

**3 — the pattern entry.** Extend "Deterministic-logic → server offload pattern" in `MEMORY.md`: function
name, file, hook point, what the LLM was getting wrong, any consumer left unchanged. Match the existing
entries' shape.

---

## Step 6 — Verify

- `node --check server/lib/dispatch.js`
- Exercise the function against the real workspace files rather than trusting the read:
  back up the target (`cp workspace/candidate_profile.json /tmp/x.bak`), run the function via a small
  `node --input-type=module -e` script, diff the result, restore.
- Re-run it a second time and confirm nothing changes — that is the idempotency check.

---

## Step 7 — Report + flag the upload

Show: agent old→new version, server function + line, hook point, what the agent no longer does, files touched.

**The agent file change is inert until uploaded to KEMU.** Say so explicitly and mark it `⏳ pending KEMU
upload` in `MEMORY.md`. The server half goes live on restart; the agent half does not. A half-applied offload
— server computing, agent still computing too — means both write the same field and the agent's value can win.
