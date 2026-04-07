implemen# TC05 — Developer Brief

**Test Date:** 2026-04-02 (completed 2026-04-03)
**Candidate:** Chloe Simmons
**Role:** Qualified Early Childhood Educator (Diploma)
**Company:** City of Melbourne
**Test Type:** Full pipeline regression run — Chloe Simmons (same profile as TC03/TC04), first run on Gemini Pro 2.5 with bulk WriteFile fix applied across all 17 agents
**Agent versions tested:** MO v3.9, ProjectSetup v1.10 → v1.11 (mid-run fix), Extractor v1.9 → v2.0 (mid-run fix), Researcher v1.8, JD Enhancer v1.3, Analyst v2.1, Reviewer v1.9, Tone Analyst v1.6, Assembly Coordinator v3.6, Style Negotiator v1.3, Profile Builder v1.4, Skills Curator v1.5, History Formatter v1.4, Credentials Formatter v1.3, CoverLetter Writer v1.3, Style Reviewer v1.4, Integrity Checker v1.5

---

## Executive Summary

TC05 achieved the first complete end-to-end run on Gemini Pro 2.5, reaching a final assembled CV and cover letter. However, 29 bugs were found across the pipeline (5 P0, 9 P1, 9 P2, 6 P3). The most critical failures are: the Analyst completely overwrote `project_memory.json` with only gap_analysis data (BUG-08), destroying all prior pipeline state; the Integrity Checker passed two fabricated skills through to the final CV (BUG-26); and the Assembly Coordinator never saved the final CV to any file (BUG-29). EISDIR recurred in v1.10 but was resolved mid-run with a targeted fix. The assembly phase produced high-quality CV content but suffered from systemic schema mismatches and model compliance issues (AC narration at every phase transition, Credentials Formatter self-confirming without user input).

**TC05 Pipeline Verdict: PARTIAL PASS — reached CV_TAILORED but with fabrications and unsaved output.**

---

## Bug Register

| ID | Agent | Severity | Category | Description | Status |
|----|-------|----------|----------|-------------|--------|
| BUG-01 | ProjectSetup v1.10 | P0 | EISDIR | WriteFile called with `filePath: "/project_memory.json"` — leading slash causes EISDIR. cv_raw.txt and jd_raw.txt not written. | Fixed mid-run (v1.11) |
| BUG-02 | ProjectSetup v1.10 | P3 | Date | Timestamp hardcoded `2025-05-14T00:00:00Z` (one year old) | Fixed mid-run (v1.11) |
| BUG-03 | ProjectSetup v1.11 | P2 | Schema | `companyName`, `positionTitle`, `sector` pre-populated — ProjectSetup should leave empty | Open |
| BUG-04 | ProjectSetup v1.11 | P3 | Date | Timestamp format `T10:00:00Z` — minor; spec shows `T00:00:00Z` | Open |
| BUG-05 | Extractor v1.9 | P0 | EISDIR | `candidate_profile.json` not written — old positional WriteFile syntax causes EISDIR | Fixed mid-run (v2.0) |
| BUG-06 | Extractor v1.9 | P1 | Write Fail | `project_memory.json` not updated to INITIALIZED — write failure from EISDIR | Fixed mid-run (v2.0) |
| BUG-07 | Main Orchestrator | P1 | Model Compliance | MO generates routing narration at every transition despite ZERO OUTPUT rule — consumes user message, requires second message to advance | Open (model issue) |
| BUG-08 | Analyst v2.1 | P0 | Data Loss | `project_memory.json` completely overwritten with gap_analysis content at root — all prior data (metadata.status, research_data, enhanced_jd) destroyed | Open |
| BUG-09 | Analyst v2.1 | P3 | Spec Stale | `metadata.analyst_version` = "2.1" but spec says "2.0" — spec needs updating | Open (spec) |
| BUG-10 | Reviewer v1.9 (first run) | P0 | Write Fail | Reviewer wrote nothing — no review_audit, no status update. Caused by degraded input from BUG-08 | Resolved by manual patch |
| BUG-11 | Reviewer v1.9 (first run) | P1 | Gap Interview | Gap Interview skipped entirely — 3 high-severity gaps present, none interviewed. candidate_provided_evidence not written | Resolved by manual patch |
| BUG-12 | Reviewer v1.9 (first run) | P1 | Display | Self-contradicting display: "Issues remaining: 2" + "Final verdict: APPROVED" + "All remaining issues resolved" | Resolved by manual patch |
| BUG-13 | Reviewer v1.9 (re-run) | P2 | Schema | `gap_analysis.candidate_provided_evidence` array absent — stored inline in gap_3 object instead of top-level array | Open |
| BUG-14 | Reviewer v1.9 (re-run) | P2 | Gap Interview | Only 1 of 3 high-severity gaps interviewed (gap_1 Diploma, gap_2 reflective practice skipped) | Open |
| BUG-15 | Reviewer v1.9 | P3 | Spec Stale | `reviewer_version` = "1.9" but spec says "1.8" — spec needs updating | Open (spec) |
| BUG-16 | Main Orchestrator | P1 | Routing | `SwitchAgent("'Tone Analyst'")` — spurious single quotes caused KEMU to reject agent name. Required manual switch | Open |
| BUG-17 | Tone Analyst v1.6 | P1 | Schema | `style_guide.json` missing top-level `register` field and flat `tone`, `voice`, `sentence_structure`, `formatting` keys — CoverLetter Writer reads `register` for letter style selection | Open |
| BUG-18 | Tone Analyst v1.6 | P3 | Date | `analyzed_at` = "2026-04-01T12:00:00Z" — one day before test date. Hardcoded. | Open |
| BUG-19 | Assembly Coordinator v3.6 | P2 | Model Compliance | AC narrates at every phase transition throughout all 8 phases — ZERO OUTPUT rule violated persistently | Open (model issue) |
| BUG-20 | Style Negotiator v1.3 | P2 | Schema | `agreed_overrides` saved as Array instead of Object; `negotiation_summary` field absent | Open |
| BUG-21 | Profile Builder v1.4 | P2 | Schema | `phases[1].data` missing `profile_statement`, `experience_years`, `key_themes` fields. Experience stated as "6 years" not ~9 (earliest start 2017) | Open |
| BUG-22 | Skills Curator v1.5 | P2 | Schema | `tailoring_notes` field absent | Open |
| BUG-23 | History Formatter v1.4 | P2 | Display | Two versions of formatted history displayed without user input between them — turn-based pattern violated | Open |
| BUG-24 | Credentials Formatter v1.3 | P1 | Auto-Proceed | Self-confirmed without user input — generated "Confirmation received" and proceeded to AC unprompted | Open |
| BUG-25 | Style Reviewer v1.4 | P2 | Schema | `phases[6].data` missing `fixes_applied` (Array) and `verdict` fields | Open |
| BUG-26 | Integrity Checker v1.5 | P0 | Fabrication | 2 fabricated skills passed through to final CV — "Regulatory Compliance & Record Keeping" and "Inclusive Early Childhood Practice" both NOT_FOUND in cv_raw.txt | Open |
| BUG-27 | Integrity Checker v1.5 | P1 | Invalid Status | `integrity_status: "VERIFIED_WITH_WARNINGS"` — not a valid value. AC exception handler did not fire; assembled CV with fabrications | Open |
| BUG-28 | Assembly Coordinator v3.6 | P1 | Write Fail | `project_memory.json` status not updated to "CV_TAILORED" after full assembly — still shows "TONE_ANALYZED" | Open |
| BUG-29 | Assembly Coordinator v3.6 | P1 | Write Fail | `final_cv` and `tailored_cv` both null — assembled CV displayed in chat but not saved to any file | Open |

---

## Detailed Findings

### BUG-08 — Analyst overwrites project_memory.json
**Agent:** Analyst v2.1
**Severity:** P0
**Category:** Data Loss
**Observed:** `project_memory.json` contains only gap_analysis data at root level. All prior fields gone: `metadata.status`, `metadata.companyName`, `metadata.positionTitle`, `research_data`, `enhanced_jd`.
**Expected:** Analyst reads existing project_memory.json, sets `project_memory.gap_analysis = analysisResult`, updates `metadata.status = "ANALYSIS_COMPLETE"`, and writes the merged object back.
**Instruction reference:** `analyst_agent_instructions.md` — completion phase WriteFile call
**Impact:** P0 cascaded into BUG-10/11/12 — Reviewer received degraded input and wrote nothing. Manual patch required to restore pipeline.
**Recommended fix:** Analyst completion phase must read-modify-write: `const pm = JSON.parse(ReadFile("project_memory.json")); pm.gap_analysis = analysisResult; pm.metadata.status = "ANALYSIS_COMPLETE"; WriteFile(...)`. Verify by checking `pm.research_data` exists before writing.

---

### BUG-16 — MO inserts spurious quotes in SwitchAgent call
**Agent:** Main Orchestrator v3.9
**Severity:** P1
**Category:** Routing
**Observed:** `SwitchAgent("'Tone Analyst'")` — KEMU rejected the agent name and threw a routing error.
**Expected:** `SwitchAgent(target: "Tone Analyst")` with no extra quotes.
**Instruction reference:** `main_orchestrator_agent_instructions.md` — REVIEW_COMPLETE routing case
**Impact:** Pipeline stalled, required manual agent switch.
**Recommended fix:** Replace instruction wording that shows agent names in single quotes (e.g. `route to 'Tone Analyst'`) with double-quoted form (`SwitchAgent(target: "Tone Analyst")`). The model echoes the instruction quote style into the tool call.

---

### BUG-17 — style_guide.json missing register field
**Agent:** Tone Analyst v1.6
**Severity:** P1
**Category:** Schema
**Observed:** `style_guide.json` root keys are `{metadata, cv_style, cover_letter_style, agreed_approaches}`. Required fields `tone`, `voice`, `sentence_structure`, `register`, `formatting` all absent at top level.
**Expected:** `style_guide.json` to have flat top-level keys including `register: "peer-collegial" | "confident-professional" | "direct-practical"`.
**Instruction reference:** `tone_analyst_agent_instructions.md` — WriteFile call and schema definition
**Impact:** CoverLetter Writer reads `style_guide.register` — field absent, Writer inferred register from context (happened to work this run, but is unreliable).
**Recommended fix:** Rewrite Tone Analyst WriteFile output to use spec-compliant schema. Map current nested fields to flat spec fields. Add register classification logic (sector + seniority → register mapping) and write result as `register: "confident-professional"` at root level.

---

### BUG-24 — Credentials Formatter self-confirms without user input
**Agent:** Credentials Formatter v1.3
**Severity:** P1
**Category:** Auto-Proceed
**Observed:** Agent displayed "Type **'yes'** to confirm or **'edit'** to request changes.**Confirmation received.**" on the same line — generated its own confirmation and immediately routed to AC. User [SYSTEM NOTE] confirms no input was received.
**Expected:** Agent displays prompt, ends turn, waits for user message, then on next invocation processes the input.
**Instruction reference:** `credentials_formatter_agent_instructions.md` — Phase 4 user confirmation step
**Impact:** User lost review opportunity for education and certification section. In this run data was correct, but could silently pass errors.
**Recommended fix:** Enforce turn-based pattern — completion display must end with "Send any message to continue." and SwitchAgent must be called on the subsequent turn (after user message), not in the same turn as the display.

---

### BUG-26 — Integrity Checker passes fabricated skills to final CV
**Agent:** Integrity Checker v1.5
**Severity:** P0
**Category:** Fabrication
**Observed:** "Regulatory Compliance & Record Keeping" and "Inclusive Early Childhood Practice" flagged as NOT_FOUND in cv_raw.txt (keyword overlap check), noted as `ic_corrections`, but retained in final CV under the justification of "ATS optimization." Assembly metadata reads "VERIFIED_WITH_WARNINGS (2 minor skills claims extrapolated for ATS optimization)."
**Expected:** Skills not found in cv_raw.txt must be removed or replaced before final output. Spec explicitly: "Banned: Passing fabrications through."
**Instruction reference:** `integrity_checker_agent_instructions.md` — fabrication handling section
**Impact:** Final CV contains two unverified skill claims not present in candidate's source material.
**Recommended fix:** IC must remove or replace any claim flagged NOT_FOUND, present the removal to user for acknowledgement, and never retain under any "ATS optimization" framing. The FAILED path must fire when fabrications are detected.

---

### BUG-27 — Invalid integrity_status prevents INTEGRITY_FAILED exception
**Agent:** Integrity Checker v1.5
**Severity:** P1
**Category:** Invalid Status
**Observed:** `integrity_status: "VERIFIED_WITH_WARNINGS"` written to phases[7].data.
**Expected:** `"PASSED"` or `"FAILED"`. AC pass check is `integrityData.integrity_status === "PASSED"` — strict equality fails for any other value, so exception handler should trigger INTEGRITY_FAILED. Instead AC assembled CV normally.
**Instruction reference:** `integrity_checker_agent_instructions.md` — completion WriteFile, and `assembly_coordinator_agent_instructions.md` — Phase 8 exception check
**Impact:** AC's safety gate was bypassed. Two fabrications entered the final CV that the IC itself had detected.
**Recommended fix:** IC must write only `"PASSED"` or `"FAILED"`. If any NOT_FOUND claims remain in the output, status must be `"FAILED"`. Remove the "VERIFIED_WITH_WARNINGS" concept entirely.

---

### BUG-28 + BUG-29 — Final CV not persisted
**Agent:** Assembly Coordinator v3.6 (final assembly)
**Severity:** P1
**Category:** Write Fail
**Observed:** After displaying the full assembled CV in chat, `project_memory.json` status remains "TONE_ANALYZED" (not "CV_TAILORED"). `tailored_cv` null in project_memory.json. `final_cv` null in cv_assembly_state.json. `change_log: []` throughout all 8 phases.
**Expected:** AC sets `project_memory.metadata.status = "CV_TAILORED"`, writes assembled content to `project_memory.tailored_cv` and `cv_assembly_state.final_cv`.
**Instruction reference:** `assembly_coordinator_agent_instructions.md` — completion / all-phases-done handler
**Impact:** CV output exists only in KEMU chat context. If user clears chat or MO is re-entered, pipeline appears stuck at TONE_ANALYZED and routes back to AC — which would attempt to re-assemble from scratch.
**Recommended fix:** Add explicit WriteFile calls in AC completion block for both `project_memory.json` (set status + write tailored_cv) and `cv_assembly_state.json` (write final_cv). Verify both writes before displaying completion message.

---

## Agent-by-Agent Summary

| Agent | Version | Status | Bugs |
|-------|---------|--------|------|
| Main Orchestrator | v3.9 | ⚠ | BUG-07 (ongoing), BUG-16 |
| ProjectSetup | v1.10 → v1.11 | ✓ (after fix) | BUG-01, BUG-02 (fixed), BUG-03, BUG-04 |
| Extractor | v1.9 → v2.0 | ✓ (after fix) | BUG-05, BUG-06 (fixed) |
| Researcher | v1.8 | ✓ | — |
| JD Enhancer | v1.3 | ✓ | — |
| Analyst | v2.1 | ✗ | BUG-08, BUG-09 |
| Reviewer | v1.9 | ⚠ | BUG-10, BUG-11, BUG-12 (first run, patched), BUG-13, BUG-14, BUG-15 |
| Tone Analyst | v1.6 | ⚠ | BUG-17, BUG-18 |
| Assembly Coordinator | v3.6 | ⚠ | BUG-19, BUG-28, BUG-29 |
| Style Negotiator | v1.3 | ⚠ | BUG-20 |
| Profile Builder | v1.4 | ⚠ | BUG-21 |
| Skills Curator | v1.5 | ⚠ | BUG-22 |
| History Formatter | v1.4 | ⚠ | BUG-23 |
| Credentials Formatter | v1.3 | ✗ | BUG-24 |
| CoverLetter Writer | v1.3 | ✓ | — |
| Style Reviewer | v1.4 | ⚠ | BUG-25 |
| Integrity Checker | v1.5 | ✗ | BUG-26, BUG-27 |

---

## Observations (Non-Bug)

**Model upgrade (Gemini Pro 2.5) is a net positive.** Compared to TC03/TC04 on Gemini Flash 3, the model produced substantially better CV content quality — more specific bullets, better cover letter integration of company intelligence, more accurate skills prioritisation. The quality of the assembled output (ignoring fabrications) is noticeably higher.

**Main pipeline core is stable.** Researcher, JD Enhancer, and CoverLetter Writer produced clean output with no spec violations. Research quality was substantive and role-specific (Best Start Best Life reforms, ECEC wage retention grant, both specific centres named).

**Reviewer gap interview did fire** (one question asked about QIP/A&R participation). This is new compared to TC03 — the interview mechanism is working even if incomplete (BUG-14).

**Style Reviewer PASS path worked correctly** — chained directly to Integrity Checker without requiring a user turn. This was a previously broken path.

**EISDIR is structurally resolved.** The `filePath: ""` named-param fix holds. No new EISDIR incidents after v1.11/v2.0 upload. This is a firm regression closure.

**Cover letter quality was excellent** — company culture references integrated, no placeholders, register-appropriate (confident-professional inferred from context despite missing style_guide.register field).

**change_log empty throughout** — all 8 assembly agents skipped the `change_log.push()` step in their completion logic. Not pipeline-breaking but reduces audit trail.

---

## Fixes Required Before TC06

### Priority 1 — P0 (must fix)

1. **BUG-08 — Analyst overwrites project_memory.json:** Change Analyst completion phase to read-modify-write. Set `pm.gap_analysis = result; pm.metadata.status = "ANALYSIS_COMPLETE"`.

2. **BUG-26 — Integrity Checker passes fabrications:** Remove any skill or claim NOT_FOUND in cv_raw.txt before writing final output. Status must be "FAILED" if any claim fails the keyword overlap check.

### Priority 2 — P1 (high impact)

3. **BUG-29 — Final CV not saved:** AC completion block must write `project_memory.tailored_cv` and `cv_assembly_state.final_cv`, and set status "CV_TAILORED".

4. **BUG-27 — Invalid integrity_status:** IC must only ever write "PASSED" or "FAILED". Remove "VERIFIED_WITH_WARNINGS" entirely.

5. **BUG-24 — Credentials Formatter auto-confirms:** Enforce turn-based pattern — display ends turn, SwitchAgent fires on next turn after user message.

6. **BUG-17 — style_guide.json missing register:** Rewrite Tone Analyst output schema to match spec. Add register field (`peer-collegial`/`confident-professional`/`direct-practical`).

7. **BUG-16 — MO quote error on SwitchAgent:** Update all MO routing instructions to show agent names in double-quoted format only — eliminate single-quote style that the model echoes into tool calls.

### Priority 3 — P2/P3 (fix if time permits)

8. **BUG-21 — Profile Builder experience years:** Fix calculation to use `earliestStartYear → today` for `experience_years` field; add `profile_statement`, `key_themes` to phases[1].data schema.

9. **BUG-20 — Style Negotiator schema:** Change `agreed_overrides` to Object; add `negotiation_summary` field.

10. **BUG-19 — AC routing narration:** Strengthen AC ZERO OUTPUT rule in instructions — add negative examples of full phase summaries as banned output.

11. **BUG-13 — Reviewer candidate_provided_evidence location:** Store gap interview responses in top-level `gap_analysis.candidate_provided_evidence[]` array, not inline in individual gap objects.

12. **BUG-14 — Reviewer gap interview coverage:** Ask about all high-severity baseline gaps (up to 3) — current logic stopped after 1.

13. **BUG-03 — ProjectSetup pre-populates fields:** Remove any JD-parsing logic from ProjectSetup; `companyName`, `positionTitle`, `sector` must be written as empty strings.

14. **BUG-22/25 — Missing spec fields:** Add `tailoring_notes` to Skills Curator output; add `verdict` and `fixes_applied` to Style Reviewer output.

15. **Update agent_test_specs.md:** Bump `analyst_version` to "2.1" and `reviewer_version` to "1.9" to match live agent versions (BUG-09, BUG-15).
