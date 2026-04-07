# TC03 — Developer Brief

**Test Date:** 2026-04-01
**Candidate:** Chloe Simmons
**Role:** Qualified Early Childhood Educator (Diploma)
**Company:** City of Melbourne
**Test Type:** Full pipeline run — Chloe Simmons (same profile as TC01, fresh run post TC01/TC02 fix batch)
**Agent versions tested:** MO v3.6, ProjectSetup v1.6, Extractor v1.9, Researcher v1.7, JD Enhancer v1.2, Analyst v2.0, Reviewer v1.8, Tone Analyst v1.1, AC v3.3, Style Negotiator v1.2, Profile Builder v1.3, Skills Curator v1.3, History Formatter v1.3, Credentials Formatter v1.3, CoverLetter Writer v1.2, Style Reviewer v1.3, Integrity Checker v1.4

---

## Executive Summary

TC03 is the first full pipeline run after the TC01/TC02 fix batch (applied 2026-03-18 through 2026-03-31). The pipeline completed end-to-end with a final CV and cover letter produced, but **83 bugs were identified** (7 P0, 29 P1, 28 P2, 19 P3) — more than TC01/TC02 combined. The P0 fixes from TC01/TC02 were verified active (Integrity Checker now loads cv_raw.txt; AC has a WriteFile loop guard), but a new class of systemic failures emerged: the Main Orchestrator's ZERO OUTPUT rule is violated at every routing step, the Assembly Coordinator stalls at every phase transition requiring manual restart, and a pervasive timestamp fabrication class (13 distinct hardcoded dates) runs across all 17 agents. The final delivered CV contains two undisclosed fabricated skills (EYLF Application, Reflective Practice), a wrong email address, an incomplete cover letter (body only — no header or sign-off), and a banned phrase ("I pride myself on") that passed both Style Reviewer and Integrity Checker. The pipeline is structurally complete but requires significant instruction fixes before it can be considered reliable.

**TC03 Overall: 4.5 / 10 — FAIL**

---

## P0 Issues

### P0-1: Main Orchestrator ZERO OUTPUT — systemic, every routing step (BUG-03, BUG-18, BUG-26)

**What happened:** The MO generated narration output at all 10 observed routing transitions. Severity escalated across the run: early instances were 1–2 sentences; by the Analyst transition (BUG-03 recurrence 7) MO embedded a full pipeline summary inside the Analyst's output and held control with "Send any message to continue." At the REVIEW_FAILED gate (BUG-26), MO entered an infinite output loop generating hundreds of polling messages ("(I'm here!)", "(Waiting...)", "(Hello?)") that required force-stop by the user. At one routing step (BUG-18) MO produced no output and no SwitchAgent call — complete hang.

**Root cause:** MO v3.6 — with its ZERO OUTPUT rule clearly written at lines 59–91 of the instruction file, including explicit negative examples and repeated "ZERO OUTPUT" emphasis — was active on KEMU during TC03. This is a **model compliance failure**: Gemini Flash 3 generates text output during routing despite the instruction being explicit, comprehensive, and containing exact wrong-behavior examples. The instruction is not the problem; the underlying model does not consistently suppress output in routing contexts.

**Note on recurrence 10:** The MO output "Proceeding to style analysis despite warnings..." is NOT a ZERO OUTPUT violation — it is explicitly required by the Phase 2b 'accept anyway' handler in MO v3.6. Only 9 of the 10 counted routing steps are genuine violations.

**Impact:** Every routing step required an extra user turn. The REVIEW_FAILED gate required force-stop and recovery. Pipeline took 3× longer than expected due to repeated manual interventions.

**Fix required:** Prompt-based ZERO OUTPUT instructions cannot be reliably enforced by Gemini Flash 3. Consider: (1) structuring MO routing as a tool-call-only turn using a `stop_sequence` that terminates the response immediately after the SwitchAgent call; (2) exploring whether KEMU supports a system-level "no text output" mode for orchestrator agents; (3) switching MO to a model with stronger instruction-following compliance.

---

### P0-2: Assembly Coordinator stalls at every phase transition (BUG-40)

**What happened:** AC displayed the correct "Phase X/8: PhaseName..." header line at every assembly phase transition but then generated extended narration ("You're now talking to the Profile Builder... I will now guide you through...") instead of calling SwitchAgent. The SwitchAgent tool call never executed. This occurred at all 7 observed phase transitions (Phases 2→8). Required manual stop + restart of AC at each one.

**Root cause:** AC v3.3 — with its EXECUTE DON'T NARRATE block at lines 14–48 of the instruction file, including explicit ❌/✅ examples of correct vs wrong behavior — was active on KEMU during TC03. This is a **model compliance failure**: Gemini Flash 3 narrates what the next phase agent will do instead of calling SwitchAgent, despite the prohibition being explicit and demonstrated with exact wrong-behavior examples. The instruction is not the problem; the model does not reliably suppress post-header narration when routing.

**Impact:** 7 manual interventions required to complete the assembly phase. Each intervention added a user turn and risked context window contamination. Confirmed systemic — zero exceptions across all 8 phase transitions tested.

**Fix required:** Prompt-based "no narration" instructions cannot be reliably enforced by Gemini Flash 3. Same model-level mitigations apply as P0-1: stop_sequence after the Phase X/8 header line, or restructure the AC → phase agent handoff as a tool-call-only turn with no opportunity for additional text generation.

---

### P0-3: Fabricated evidence citations in gap analysis pass undetected (BUG-12)

**What happened:** The Analyst cited three fabricated evidence paths: (1) strength_2 cited `core_competencies[0]` ("Early childhood care") as evidence for "Drive QIP/NQS compliance" — no match; (2) strength_4 cited `work_history[0].responsibilities[3]` (Storypark app entry) as evidence for "Collaborate with City of Melbourne teams" — no match; (3) strength_5 cited `core_competencies[0]` for "Familiarity with City of Melbourne's inclusive strategies" — no match. The Reviewer (v1.8) caught strength_2 correctly via the gap interview but did not audit strength_4 or strength_5. Both passed through to the final CV.

**Root cause:** Analyst v2.0 generates evidence citations by inference rather than verified lookup. Confidence scores are absent (BUG-16), so the Reviewer cannot filter by confidence threshold.

**Impact:** Two fabricated strengths (strength_4 and strength_5) reached the final tailored_cv. The Skills Curator also promoted three fabricated skills into the output (EYLF Application, QIP Support, NQS Compliance) sourced from these fabricated strengths.

**Fix required:** Add confidence scores to all strength evidence citations (per CLAUDE.md methodology, confidence ≥ 4 required). Reviewer must explicitly audit all strength items, not just 3 of 5. Analyst should use verified field-path lookups before asserting evidence.

---

### P0-4: Tone Analyst failed to write output files on first attempt (BUG-30, BUG-31)

**What happened:** Tone Analyst displayed "Your style guide has been created and saved" and a full compliance summary, but `style_guide.json` did not exist on disk. `project_memory.json` status remained `REVIEW_COMPLETE` (not updated to `TONE_ANALYZED`). Pipeline stalled. Required a forced retry. Files were written correctly on the second attempt.

**Root cause:** WriteFile silently failed (likely EISDIR or EEXIST variant). Agent did not detect the failure and proceeded to display completion output. Status update was also skipped.

**Impact:** If the retry had not been triggered manually, the entire assembly phase would have run without a style guide. CoverLetter Writer v1.2 reads `style_guide.json` — it would have proceeded without style context.

**Fix required:** All agents must validate WriteFile success before displaying completion output (check that the file exists and is non-empty after write). Tone Analyst specifically needs the same WriteFile loop guard as AC v3.3.

---

### P0-5: History Formatter data loss on first run (BUG-47)

**What happened:** History Formatter displayed the formatted work history, showed a confirmation prompt, then routed to AC without waiting for user response and without writing phases[3].data. The Assembly Coordinator then injected its own confirmation prompt for the History Formatter's output — but AC has no write path for that data. phases[3] remained PENDING. Required manual re-invocation of History Formatter.

**Root cause:** History Formatter routed to AC in the same turn as the confirmation display, treating the prior "." input as the confirmation response (same class as BUG-53, BUG-46, BUG-38). AC then hijacked the confirmation flow (BUG-49), creating a dual-confirmation scenario where neither agent could write the data.

**Impact:** phases[3].data was null — formatted work history was permanently lost unless the agent was re-run. Recovery required. BUG-47 resolved on second run, but the scenario represents a P0 data loss risk.

**Fix required:** All assembly phase agents must display confirmation prompt AND STOP in that turn. Never route in the same turn as displaying a confirmation prompt.

---

### P0-6: Analyst fabricated evidence reaches final CV unchecked (BUG-77)

**What happened:** Integrity Checker flagged 3 of 5 fabricated skills (NQS Compliance, QIP Support, Sustainability) but missed "Early Years Learning Framework (EYLF) Application" (gap_2 — HIGH severity gap) and "Reflective Practice" (gap_5 — MEDIUM severity gap). The user was presented with 5 items to decide on but never informed that 2 additional fabricated skills were also in the CV. Both appear in the final `tailored_cv.skills.technical_skills` and `soft_skills` without any disclosure.

**Root cause:** Integrity Checker's claim verification did not check against gap_analysis to identify skills that are explicitly categorised as gaps. IC cross-referenced against cv_raw.txt but did not use the gap list as a negative check.

**Impact:** Final delivered CV contains fabricated skills the candidate does not have. For EYLF in particular (a HIGH severity gap and the most verifiable technical requirement for this role), the risk of candidate harm is significant.

**Fix required:** Integrity Checker must explicitly check that no claimed skill in the CV appears as a gap in gap_analysis. If a skill is listed as a gap AND appears in the skills section, it must be flagged regardless of whether it appears in cv_raw.txt.

---

## Bug Register

| ID | Agent | Severity | Category | Description |
|----|-------|----------|----------|-------------|
| BUG-01 | Main Orchestrator | P2 | Display | Welcome message says "CV Construction (automatic)" — assembly requires user interaction at each phase |
| BUG-02 | Main Orchestrator | P2 | Display | Emoji in welcome message (🎯, ✓) — inconsistent with Australian professional tone |
| BUG-03 | Main Orchestrator | P2 | Routing | ZERO OUTPUT rule violated at 9 of 10 observed routing steps — narration generated at every transition; escalating severity (polling loop at REVIEW_FAILED gate — see BUG-26). Recurrence 10 ("Proceeding to style analysis despite warnings...") is CORRECT per MO v3.6 Phase 2b 'accept anyway' handler — not a violation. Root cause: model compliance failure (instructions confirmed active on KEMU). |
| BUG-04 | ProjectSetup | P3 | Date | Hardcoded timestamps `2026-02-19T14:00:00Z` in project_memory.json and cv_assembly_state.json |
| BUG-05 | ProjectSetup | P2 | Routing | Missing "Send any message to continue." in completion display — may route without user turn |
| BUG-06 | Extractor | P1 | EISDIR | candidate_profile.json created as directory — WriteFile passed filename as both filePath and fileName |
| BUG-07 | Extractor | P3 | Date | Hardcoded lastUpdated `2026-03-31T10:00:00Z` |
| BUG-08 | Extractor | P1 | Routing | No WriteFile retry guard — entered ~30-step unguarded EISDIR recovery loop |
| BUG-09 | Researcher | P1 | Schema | research_data field names non-canonical: `culture_and_work_style` vs `culture_overview`, `strategic_plan_and_growth` vs `strategic_plan`, `interview_and_hiring_focus` vs `interview_focus` |
| BUG-10 | Researcher | P3 | Date | Hardcoded lastUpdated `2026-03-31T11:20:00Z` |
| BUG-11 | JD Enhancer | P3 | Date | Hardcoded timestamps `2026-03-31T11:45:00Z` |
| BUG-12 | Analyst | P0 | Fabrication | 3 fabricated evidence citations: strength_2 (QIP/NQS), strength_4 (CoM teams), strength_5 (CoM strategies) — none match cited candidate_profile paths |
| BUG-13 | Analyst | P1 | Fabrication | ATS keywords generic and non-ECE: ["leadership","management","communication","collaborative","technical","data analysis"] — "data analysis" has no basis in this role |
| BUG-14 | Analyst | P2 | Display | Fit score math error: differentiator 1/3×3 stored as 0.8 (should be 1.0); overall score 4.3 (should be 4.5) |
| BUG-15 | Analyst | P3 | Date | Hardcoded analyzed_at `2026-03-12T10:15:00Z` |
| BUG-16 | Analyst | P1 | Schema | Confidence scores missing from all 11 requirements and 5 strengths — mandatory per Evidence-Based Methodology |
| BUG-17 | Analyst | P1 | Routing | Read from rogue file candidate_profile_v1.json instead of canonical nested candidate_profile.json/candidate_profile.json |
| BUG-18 | Main Orchestrator | P0 | Routing | Complete hang after Analyst — no output, no SwitchAgent call; required manual force-stop and recovery |
| BUG-19 | Reviewer | P2 | Display | Item 3/3 displayed twice verbatim in gap interview output |
| BUG-20 | Reviewer | P1 | Routing | Reviewer stalled after Item 3 without displaying verdict or "Send any message to continue." — pipeline blocked from user perspective despite file written correctly |
| BUG-21 | Reviewer | P1 | Fabrication | Gap interview audited wrong strengths — fabricated "Ensure all childcare regulations..." and "Effective communication..." are not in gap_analysis; actual unverified strengths strength_4 and strength_5 were not audited |
| BUG-22 | Reviewer | P2 | Schema | item_id "strength_hidden" not a valid gap_analysis ID (valid: strength_1 through strength_5) |
| BUG-23 | Reviewer | P2 | Schema | review_audit.summary high_issues:1 but 3 High-severity items in issues_found — summary counts wrong |
| BUG-24 | Reviewer | P3 | Date | Hardcoded reviewed_at `2026-03-31T12:05:00Z` |
| BUG-25 | Reviewer | P2 | Schema | tailored_cv: null field dropped from project_memory.json on rewrite |
| BUG-26 | Main Orchestrator | P0 | Routing | Infinite output loop at REVIEW_FAILED gate — hundreds of polling messages generated; required force-stop |
| BUG-27 | Tone Analyst | P2 | Display | Seniority assessment shows "~4 years in childcare" — Happy Feet start 2020-01 = ~6.2 years to 2026-04-01 |
| BUG-28 | Tone Analyst | P1 | Fabrication | Opening and checkpoint display show fit score 8/10 then 8.5/10 — actual stored score 4.3/4.5 |
| BUG-29 | Tone Analyst | P2 | Display | "Quality review: Passed" — verdict was REJECTED/REVIEW_FAILED; user accepted via override |
| BUG-30 | Tone Analyst | P0 | Data Loss | style_guide.json not written despite agent claiming "created and saved" — WriteFile silently failed |
| BUG-31 | Tone Analyst | P0 | Routing | status not updated to TONE_ANALYZED after completion — MO would re-route to Tone Analyst |
| BUG-32 | Tone Analyst | P1 | Display | "Gaps identified: 2" — actual gap count is 6 |
| BUG-33 | Tone Analyst | P2 | Routing | Presenting REVIEW_FAILED-style routing options ("redo analysis", "redo research") — outside Tone Analyst authority |
| BUG-34 | Tone Analyst | P3 | Date | Hardcoded analyzed_at in style_guide.json `2026-03-31T12:20:00Z` |
| BUG-35 | Tone Analyst | P2 | Schema | analyzer_version: "1.4" in style_guide.json — Tone Analyst is v1.1 per CLAUDE.md |
| BUG-36 | Tone Analyst | P2 | Fabrication | role_indicators ["leading","strategic","overseeing","driving"] fabricated to justify user-corrected seniority — none appear in Chloe's CV |
| BUG-37 | Style Negotiator | P3 | Date | Hardcoded timestamps `2026-03-17T10:30:00Z` in cv_assembly_state.json |
| BUG-38 | Style Negotiator | P2 | Routing | Missing "Send any message to continue." — completed without turn-based wait |
| BUG-39 | Assembly Coordinator | P1 | Routing | AC narrated after Style Negotiation ("I've received the agreed style overrides... will now move on to Profile Building") — EXECUTE DON'T NARRATE violation |
| BUG-40 | Assembly Coordinator | P0 | Routing | AC stalls at every phase transition — outputs Phase X/8 header then narrates instead of calling SwitchAgent; 7 manual restarts required across 8 phases. Root cause: model compliance failure (AC v3.3 EXECUTE DON'T NARRATE confirmed active on KEMU). |
| BUG-41 | Profile Builder | P1 | Fabrication | Email changed from source chlo-bear99@email.com to chloe_b_simmons@email.com without user instruction or change notice; wrong email in all subsequent phases and final CV |
| BUG-42 | Profile Builder | P3 | Date | Hardcoded timestamps `2026-03-31T13:00:00Z` |
| BUG-43 | Skills Curator | P3 | Date | Hardcoded timestamps `2026-03-31T13:15:00Z` |
| BUG-44 | Skills Curator | P1 | Schema | current_phase added inside metadata object — CLAUDE.md schema places it at top level only; creates duplicate field in wrong location |
| BUG-45 | Skills Curator | P1 | Fabrication | 3 fabricated skills: EYLF Application (gap_2 HIGH), Sustainability-focused Learning Support (not in profile), Reflective Practice (gap_5 MEDIUM) |
| BUG-46 | Skills Curator | P2 | Routing | Missing "Send any message to continue." — same class as BUG-38 |
| BUG-47 | History Formatter | P0 | Data Loss | phases[3].data not written; agent routed to AC without user confirmation and without writing state; formatted history permanently lost until manual recovery run |
| BUG-48 | History Formatter | P2 | Display | Formatted history displayed twice verbatim with slightly different footer |
| BUG-49 | History Formatter | P2 | Routing | AC injected own confirmation prompt for History Formatter output — overriding and duplicating confirmation, creating dual-confirmation with no write path from AC |
| BUG-50 | History Formatter | P3 | Display | Date format numeric YYYY-MM (e.g. "2020-01") — user preference is month-word abbreviated (e.g. "Jan 2020") |
| BUG-51 | History Formatter | P1 | Schema | Top-level current_phase field dropped from cv_assembly_state.json on rewrite — only exists in metadata.current_phase from this point forward; persists to end of run |
| BUG-52 | History Formatter | P3 | Date | Hardcoded timestamps `2026-03-31T14:30:00Z` |
| BUG-53 | Credentials Formatter | P1 | Routing | Displayed confirmation prompt then immediately completed without waiting — treated prior "." message as 'yes'; user_confirmed: true set without explicit confirmation |
| BUG-54 | Credentials Formatter | P1 | Schema | change_log (4-entry audit array) and final_cv fields dropped from cv_assembly_state.json on rewrite — audit trail broken for remainder of run |
| BUG-55 | Credentials Formatter | P2 | EISDIR | EISDIR on candidate_profile.json — 3rd distinct agent instance; self-recovered via ScanDirectory, user not notified |
| BUG-56 | Credentials Formatter | P2 | Schema | WriteFile EEXIST errors — agent used empty-string filePath workaround (incorrect KEMU pattern); likely caused BUG-54 schema truncation |
| BUG-57 | Credentials Formatter | P3 | Date | Hardcoded timestamps `2026-03-31T14:45:00Z` |
| BUG-58 | Assembly Coordinator | P2 | Routing | KEMU SSE stream error during AC → CoverLetter Writer SwitchAgent call; recovered on second prompt |
| BUG-59 | CoverLetter Writer | P1 | Display | Missing letter structure — body paragraphs only; no header, date, Re: line, salutation, or sign-off despite v1.2 fix |
| BUG-60 | CoverLetter Writer | P1 | Display | Banned phrase "I pride myself on" in cover letter — banned phrases guard (v1.2) failed to catch it |
| BUG-61 | CoverLetter Writer | P3 | Display | Cover letter references "2026 child safety reforms" — phrasing differs from enhanced_jd "Best Start, Best Life" but underlying facts verified in research_data; reclassified from P1 |
| BUG-62 | CoverLetter Writer | P2 | Schema | change_log still absent — not restored; audit trail broken since Phase 5 |
| BUG-63 | CoverLetter Writer | P3 | Date | Hardcoded timestamps `2026-03-31T15:05:00Z` |
| BUG-64 | Style Reviewer | P1 | Fabrication | False PASS — cover letter excluded from banned-phrase analysis; "I pride myself on" (BUG-60) not caught; PASS verdict written to file and presented to Integrity Checker as cleared |
| BUG-65 | Style Reviewer | P2 | Schema | final_cv: null added inside metadata object — creates duplicate (also at top level); change_log still absent |
| BUG-66 | Style Reviewer | P2 | Display | phases[6].data too sparse — no per-section verdicts, no record of what was checked vs excluded |
| BUG-67 | Style Reviewer | P3 | Date | Hardcoded timestamps `2026-03-31T15:15:00Z` |
| BUG-68 | Assembly Coordinator | P1 | Routing | Silent 2-minute hang at Phase 8 transition (Style Reviewer → Integrity Checker); 3rd distinct AC failure mode (narrate / SSE error / silent hang) |
| BUG-69 | Integrity Checker | N/A | Not a Bug | current_phase = 9 is **by design** — AC v3.3 line 430 explicitly sets `current_phase = 9` in the INTEGRITY_FAILED 'accept anyway' handler to trigger Phase 3 completion. Originally logged as P1 Schema; reclassified to not-a-bug after instruction review. |
| BUG-70 | Integrity Checker | P1 | Display | Double completion output with inconsistent counts (7 "Changes logged" vs 9 "Verified Changes"); file reflects second run |
| BUG-71 | Integrity Checker | P1 | Fabrication | Missed 2 of 5 BUG-45 fabrications: EYLF Application (gap_2 HIGH) and Reflective Practice (gap_5 MEDIUM) not flagged; both in final CV |
| BUG-72 | Integrity Checker | P1 | Fabrication | Cover letter not verified — IC checked skills and profile only; no cover letter content check |
| BUG-73 | Integrity Checker | P2 | Schema | verified_changes field lists previous phases' work (style overrides, bullet consolidations) not IC corrections — misleadingly implies 9 IC-made changes |
| BUG-74 | Integrity Checker | P2 | Schema | top-level final_cv field removed; schema continues degrading — each agent strips fields set by prior agents |
| BUG-75 | Integrity Checker | P3 | Date | Hardcoded timestamps `2026-03-31T15:30:00Z` |
| BUG-76 | Main Orchestrator | P1 | Display | Final display "9 improvements" sourced from IC's misleadingly-named verified_changes — not real user-facing improvements |
| BUG-77 | Main Orchestrator | P1 | Fabrication | EYLF Application + Reflective Practice in final tailored_cv.skills — never disclosed; IC missed them; user made no decision on these |
| BUG-78 | Main Orchestrator | P2 | Display | Cover letter body-only in final tailored_cv — BUG-59 persists to final deliverable |
| BUG-79 | Main Orchestrator | P2 | Display | Final display "Quality-reviewed and validated" — review_audit.overall_verdict = "REJECTED"; misleading |
| BUG-80 | Main Orchestrator | P3 | Date | Hardcoded timestamps `2026-03-31T15:35:00Z` — 13th fabricated date |
| BUG-81 | Assembly Coordinator | P1 | Schema | Phase 3 completion check uses `styleReviewData.passed` (boolean) — actual schema field is `style_compliance: "PASS"/"FAIL"` (string); boolean check will always be falsy, breaking Phase 3 completion logic |
| BUG-82 | Assembly Coordinator | P1 | Schema | Phase 3 completion check uses `integrityData.passed` (boolean) — actual schema field is `integrity_status: "PASSED"/"FAILED"` (string); boolean check will always be falsy, breaking Phase 3 completion logic |
| BUG-83 | Assembly Coordinator | P1 | Schema | Phase 3 completion uses `historyData.length` and `credentialsData.length` — both phase data objects are objects not arrays; `.length` is always `undefined` (falsy), breaking Phase 3 completion guard |
| BUG-84 | Main Orchestrator | P3 | Display | Instruction file title header says "Orchestrator Agent v3.5" but version metadata and changelog show v3.6 — title mismatch unresolved from 2026-03-19 fix batch |

---

## Detailed Findings — Top Issues

### BUG-41 — Email silently changed in Profile Builder
**Agent:** Profile Builder v1.3
**Severity:** P1
**Category:** Fabrication
**Observed:** Profile Builder wrote `chloe_b_simmons@email.com` to phases[1].data.contact_details and displayed it in the confirmation prompt. Source file (`candidate_profile.json`) has `chlo-bear99@email.com`. No change notice shown; user confirmed 'yes' to the modified email.
**Expected:** Contact details sourced verbatim from candidateProfile.personal_info.contact.* with no modification.
**Instruction reference:** profile_builder_instructions.md — Phase 2 data sourcing
**Impact:** Wrong email in all subsequent phases and in the final tailored_cv. Candidate's application would list an email address they do not own.
**Recommended fix:** Profile Builder must display a diff when contact data differs from source. Extract email character-for-character from candidateProfile; never paraphrase or "clean" it.

---

### BUG-51 — top-level current_phase dropped, persists to end of run
**Agent:** History Formatter v1.3 (introduced); all subsequent agents (persisted)
**Severity:** P1
**Category:** Schema
**Observed:** History Formatter rewrote cv_assembly_state.json with `current_phase` only inside `metadata` (BUG-44 introduced it there; HF read it from metadata and wrote it back only there). Top-level `current_phase` field absent from Phase 4 onwards. CLAUDE.md schema and AC routing logic expect `cvState.current_phase` at top level.
**Expected:** `current_phase` at top level of cv_assembly_state.json per CLAUDE.md schema.
**Impact:** AC routing logic reads `cvState.current_phase` — field absent means routing value undefined. AC has been using `metadata.current_phase` by adaptation, but this is not the specified schema and creates unpredictable behaviour.
**Recommended fix:** Each agent must read and write the full cv_assembly_state.json schema. Fix Skills Curator (BUG-44 source) to not add current_phase inside metadata. Add schema validation before WriteFile in all assembly agents.

---

### BUG-54 — Schema truncation cascade across agents
**Agent:** Credentials Formatter v1.3 (introduced); subsequent agents (persisted)
**Severity:** P1
**Category:** Schema
**Observed:** Credentials Formatter's EEXIST recovery rewrote cv_assembly_state.json without `change_log` (4 audit entries) or `final_cv`. Neither field was restored by CoverLetter Writer (which restored `final_cv: null`), Style Reviewer (which moved `final_cv` into metadata), or Integrity Checker (which removed the top-level `final_cv` entirely). By end of run: `change_log` fully absent, `final_cv` only in metadata.
**Expected:** Every agent reads and preserves all top-level fields from the existing JSON before writing back.
**Impact:** Complete loss of audit trail. No phase completion entries in change_log from Phase 5 onwards.
**Recommended fix:** Agents must parse the full existing JSON, modify only the fields they own, then write back. Never reconstruct the JSON object from scratch — this is the root cause of all truncation bugs.

---

### BUG-59 — Cover letter missing full letter structure
**Agent:** CoverLetter Writer v1.2
**Severity:** P1
**Category:** Display / Fabrication
**Observed:** Stored `coverletter_text` and displayed draft contain 4 body paragraphs only. No header block (Chloe Simmons / address / date), no "Re:" line, no salutation ("Dear Hiring Manager"), no sign-off ("Yours sincerely, / Chloe Simmons").
**Expected:** v1.2 fix explicitly assembles "a full letter (header + date + Re: line + salutation + body + sign-off) — no more [Your Name] placeholders." (CLAUDE.md)
**Impact:** Final delivered CV package includes an incomplete cover letter. The document is not submittable as-is.
**Recommended fix:** CoverLetter Writer must assemble the letter from candidateProfile.personal_info.contact.* as specified. Structure template: `[Name] / [Address] / [Date] / [Company] / Re: [Role] / Dear [Hiring Manager] / [Body] / Yours sincerely, / [Name]`. Assert presence of each structural element before writing.

---

### BUG-64 — Style Reviewer false PASS on cover letter
**Agent:** Style Reviewer v1.3
**Severity:** P1
**Category:** Fabrication
**Observed:** Style Reviewer declared "Issues Found: 0" and status PASS. Reasoning trace: "The Cover Letter, with its inherent first-person voice, has been excluded from this part of the analysis." Cover letter contains "I pride myself on" — a banned phrase per v1.2 guard.
**Expected:** Implicit-first-person rule correctly exempt for cover letters, but banned phrases apply universally. Style Reviewer must check banned phrases in all sections including cover letter.
**Impact:** False PASS stored in phases[6].data, presented to Integrity Checker as cleared. Banned phrase in final tailored_cv.cover_letter.coverletter_text.
**Recommended fix:** Style Reviewer must separate the two style checks: (1) implicit-first-person — CV sections only; (2) banned phrases — all sections including cover letter. The reasoning trace shows the agent correctly identified the exemption for "I" pronouns but incorrectly applied it to the entire cover letter analysis.

---

## Systemic Findings

### Timestamp Fabrication — 13 Distinct Dates (Class Bug)
Every agent in the pipeline generated hardcoded timestamps instead of reading the current date from system context (CLAUDE.md Critical Rule 4). 13 distinct fabricated dates were logged across the run. All are from 2026-02-19 to 2026-03-31; actual run date was 2026-04-01. This class affects all 17 agents.

**Recommended fix:** Add a single instruction to every agent: "Use `getCurrentISOTimestamp()` — call the system date tool to get the actual current time. Never hardcode a date." Consider adding a timestamp utility function reference in CLAUDE.md.

### EISDIR — 4 Agents Affected (Class Bug)
candidate_profile.json exists as a directory (created by Extractor WriteFile bug — BUG-06). Every agent that reads candidate_profile.json hits an EISDIR error on first attempt. All self-recovered via ScanDirectory + nested path read, but: user is never notified, recovery adds 3–5 reasoning steps per agent, and Credentials Formatter's recovery triggered EEXIST WriteFile errors that caused schema truncation (BUG-54).

**Root cause:** Single Extractor WriteFile error propagating to all downstream agents.
**Recommended fix:** Fix Extractor WriteFile pattern (bare filename only, no filePath duplication). Add EISDIR handling to all agents: if ReadFile("candidate_profile.json") fails with EISDIR, automatically try "candidate_profile.json/candidate_profile.json" — documented as the fallback in CLAUDE.md.

### Schema Mutation Cascade — cv_assembly_state.json
The cv_assembly_state.json schema degraded progressively as each agent rewrote it from scratch rather than patching targeted fields. By end of run: `current_phase` moved to metadata only (BUG-44/51), `change_log` absent (BUG-54), `final_cv` absent at top level (BUG-74). The file is functional but the schema is no longer spec-compliant.

**Recommended fix:** Mandate a "read-modify-write" pattern for all agents: `const state = JSON.parse(ReadFile("cv_assembly_state.json")); /* modify only owned fields */; WriteFile("cv_assembly_state.json", JSON.stringify(state, null, 2))`. Never reconstruct the object from scratch.

---

## Agent-by-Agent Summary

| Agent | Version | Status | Bugs |
|-------|---------|--------|------|
| Main Orchestrator | v3.6 | ⚠ Significant | BUG-01, 02, 03×9, 18, 26, 76, 79, 84 |
| ProjectSetup | v1.6 | ✓ Minor | BUG-04, 05 |
| Extractor | v1.9 | ⚠ Moderate | BUG-06, 07, 08 |
| Researcher | v1.7 | ⚠ Moderate | BUG-09, 10 |
| JD Enhancer | v1.2 | ✓ Minor | BUG-11 |
| Analyst | v2.0 | ✗ Critical | BUG-12, 13, 14, 15, 16, 17 |
| Reviewer | v1.8 | ⚠ Moderate | BUG-19, 20, 21, 22, 23, 24, 25 |
| Tone Analyst | v1.1 | ✗ Critical | BUG-27, 28, 29, 30, 31, 32, 33, 34, 35, 36 |
| Assembly Coordinator | v3.3 | ✗ Critical | BUG-39, 40×7, 58, 68, 81, 82, 83 |
| Style Negotiator | v1.2 | ✓ Minor | BUG-37, 38 |
| Profile Builder | v1.3 | ⚠ Moderate | BUG-41, 42 |
| Skills Curator | v1.3 | ⚠ Moderate | BUG-43, 44, 45, 46 |
| History Formatter | v1.3 | ✗ Critical | BUG-47, 48, 49, 50, 51, 52 |
| Credentials Formatter | v1.3 | ⚠ Moderate | BUG-53, 54, 55, 56, 57 |
| CoverLetter Writer | v1.2 | ⚠ Moderate | BUG-59, 60, 61, 62, 63 |
| Style Reviewer | v1.3 | ⚠ Moderate | BUG-64, 65, 66, 67 |
| Integrity Checker | v1.4 | ⚠ Moderate | BUG-69, 70, 71, 72, 73, 74, 75 |

---

## Observations (Non-Bug)

- **Pipeline completed end-to-end** for the first time — all 8 assembly phases ran, final tailored_cv was assembled in project_memory.json with all sections present. This is a meaningful milestone.
- **Integrity Checker correctly caught 3 of 5 fabricated skills** — NQS Compliance, QIP Support, and Sustainability-focused Learning Support flagged. The IC's cv_raw.txt cross-reference (v1.4 fix) is working.
- **WwCC number correctly sourced** — Credentials Formatter read "1554321A-01" from candidate_profile.json without fabrication.
- **9-year experience calculation correct** — Profile Builder v1.3 fix (earliest start year 2017 → 2026 = 9 years) confirmed working.
- **Cover letter company intelligence is genuine** — "2026 child safety reforms", "National Early Childhood Worker Register", and "City for All" all verified against research_data. Researcher v1.7 hiring_unit_intelligence field is populating correctly.
- **Reasoning trace visible to user** in KEMU interface across multiple agents — unclear if this is a debug mode artifact or a display configuration issue. If unintentional, should be suppressed for production runs.
- **REVIEW_FAILED gate correctly presented all 5 user options** — MO v3.6's gate logic is correct; only the infinite polling loop (BUG-26) is the implementation bug.
- **INTEGRITY_FAILED exception handler correctly fired** — AC presented the user with proceed/rework options when IC returned FAILED. The handler is working as designed.

---

## Fixes Required Before TC04

### Priority 1 — Model compliance mitigations (P0 routing failures)
All agent instructions were confirmed active on KEMU during TC03. BUG-03 and BUG-40 are **model compliance failures** — Gemini Flash 3 does not reliably suppress output in routing contexts even with explicit ZERO OUTPUT / EXECUTE DON'T NARRATE instructions containing negative examples. Instruction-level fixes alone cannot resolve these.

1. **Investigate stop_sequence for MO and AC** — test whether adding a stop_sequence character immediately after the SwitchAgent call prevents further text generation. This is the lowest-risk mitigation with no instruction rewrite needed.
2. **Explore KEMU tool-call-only turn mode** — if KEMU supports a system-level constraint that ends the turn immediately after a tool call (SwitchAgent), enable it for MO and AC routing steps.
3. **Evaluate model replacement** — assess whether switching MO and AC to a model with stronger instruction-following resolves the compliance failures. Benchmark on ZERO OUTPUT and EXECUTE DON'T NARRATE tasks specifically.
4. **Fix AC Phase 3 completion logic** — fix BUG-81/82/83: `styleReviewData.passed` → `styleReviewData.style_compliance === "PASS"`, `integrityData.passed` → `integrityData.integrity_status === "PASSED"`, `historyData.length` / `credentialsData.length` → presence checks on the objects.

### Priority 2 — Instruction fixes (P0/P1 content bugs)

4. **Analyst** — Add confidence scores to all evidence citations; validate evidence paths before asserting; make gap interview audit all 5 strengths not 3.
5. **Profile Builder** — Source email verbatim from candidateProfile; display change notice if any contact field differs from source.
6. **History Formatter + all assembly phase agents** — Add read-modify-write pattern for cv_assembly_state.json; never reconstruct from scratch. Fixes BUG-51, 54, 65, 74.
7. **CoverLetter Writer** — Implement full letter structure (header + date + Re: line + salutation + body + sign-off) from candidateProfile.personal_info.contact.*. Add banned phrases check that explicitly covers cover letter text.
8. **Style Reviewer** — Separate implicit-first-person check (CV sections only) from banned phrases check (all sections). Cover letter must be scanned for banned phrases.
9. **Integrity Checker** — Add gap_analysis negative check: any skill listed as a gap must be flagged if it also appears in the skills section. Add cover letter to verification scope.
10. **Tone Analyst** — Add WriteFile success validation before displaying completion; add status update to TONE_ANALYZED before completion display.

### Priority 3 — Class bugs (P2/P3, lower urgency)

11. **All agents** — Timestamp: replace hardcoded dates with system date call (`getCurrentISOTimestamp()`). Single instruction addition to CLAUDE.md that applies universally.
12. **Extractor** — Fix WriteFile pattern (bare filename only) to permanently resolve EISDIR root cause. Add EISDIR fallback documentation to CLAUDE.md.
13. **History Formatter** — Fix date format to month-word abbreviated (e.g. "Jan 2020 – Present") per user preference.
14. **Integrity Checker** — Fix current_phase increment to not go beyond total_phases (cap at `total_phases` on final phase).
