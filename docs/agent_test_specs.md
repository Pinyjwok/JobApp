# Agent Test Specifications

Concise verification criteria for each agent. Used by `/test-agent` skill — read this instead of full instruction files.

---

## Main Orchestrator (MO)

**Files:** none written by MO
**Routing target:** Reads `project_memory.json` metadata.status → SwitchAgent to next agent (zero output)
**Legitimate output cases (only):**
- Case A/B welcome — when project_memory.json missing/unreadable
- REVIEW_FAILED options display
- CV_TAILORED completion display
- UNKNOWN STATUS error display
**Banned:** Any narration during routing (summaries, descriptions, confirmations, greetings)
**Welcome display must start with:** `# Welcome to Your Job Application Assistant` (no preamble)

---

## ProjectSetup (v1.11)

**Files:** `project_memory.json`, `cv_assembly_state.json`; confirm `cv_raw.txt` + `jd_raw.txt` exist as files (not directories)
**Status after:** `metadata.status = "FILES_SAVED"`

**Schema — project_memory.json:**
| Field | Expected |
|-------|----------|
| metadata.companyName | `""` (empty — Extractor fills this) |
| metadata.positionTitle | `""` (empty) |
| metadata.sector | `""` (empty) |
| metadata.cv_source | `"cv_raw.txt"` |
| metadata.jd_source | `"jd_raw.txt"` |
| metadata.createdAt | Today's ISO date (not hardcoded) |
| metadata.lastUpdated | Today's ISO date |
| metadata.version | `"1.0"` |
| metadata.status | `"FILES_SAVED"` |
| research_data.mission_values | `""` |
| research_data.recent_developments | `[]` |
| enhanced_jd | `null` |
| gap_analysis | `null` |
| tailored_cv | `null` |

**Schema — cv_assembly_state.json:**
| Field | Expected |
|-------|----------|
| current_phase | `1` |
| metadata.status | `"ACTIVE"` |
| metadata.total_phases | `8` |
| metadata.completed_phases | `0` |
| metadata.started_at | Today's ISO date |
| all phases[*].status | `"PENDING"` |
| all phases[*].data | `null` |
| user_request | `null` |
| final_cv | `null` |
| change_log | `[]` |

**Routing:** Phase 0 on next user message → SwitchAgent("Main Orchestrator")
**Required display:** `# ✓ Project Setup Complete`, cv_raw.txt, jd_raw.txt, "Send any message to continue"
**Banned:** Company name pre-populated, any routing narration, SwitchAgent called in same turn as completion display

---

## Extractor (v2.1)

**Files:** `candidate_profile.json`, `project_memory.json`
**Status after:** `metadata.status = "INITIALIZED"`

**Schema — candidate_profile.json top-level keys:**
| Key | Expected |
|-----|----------|
| personal_info.name | Non-empty string |
| personal_info.contact.email | Present |
| personal_info.contact.phone | Present |
| work_history | Array, min 1 entry |
| work_history[*].employer | Non-empty |
| work_history[*].start_date | Present |
| education | Array, min 1 entry |
| skills | Object with sub-keys |
| publications | Array (empty OK if none in CV) |
| grants | Array (empty OK) |
| awards | Array (empty OK) |

**Publication schema (if present):** `{title, authors, journal, year}`
**Grant schema (if present):** `{title, body, amount, year, role}`
**Award schema (if present):** `{title, body, year}`

**Cross-check:** If candidate surname appears in publication authors — confirmed or updated via Phase 7.5 name check
**Routing:** SwitchAgent("Main Orchestrator")
**Required display:** Summary of extracted sections, counts (N roles, N qualifications, etc.)

---

## Researcher (v1.8)

**Files:** `project_memory.json` → `research_data`
**Status after:** `metadata.status = "RESEARCH_COMPLETE"`

**Schema — research_data:**
| Field | Expected |
|-------|----------|
| mission_values | Non-empty string |
| culture_and_work_style OR culture_overview | Non-empty string |
| recent_developments | Array, min 3 items |
| key_strengths | Array, min 3 items |
| known_challenges | Array, min 1 item |
| strategic_plan_and_growth OR strategic_plan | Non-empty string |
| interview_and_hiring_focus OR interview_focus | Non-empty string |
| hiring_unit | Non-empty string (extracted from jd_raw.txt) |
| hiring_unit_intelligence | Non-empty string |

**Field count logged:** Should show "/8" in display
**Routing:** SwitchAgent("Main Orchestrator")
**Banned:** Fabricated company data not traceable to Tavily results

---

## JD Enhancer (v1.4)

**Files:** `project_memory.json` → `enhanced_jd`
**Status after:** `metadata.status = "JD_ENHANCED"`

**Schema — enhanced_jd:**
| Field | Expected |
|-------|----------|
| company_context.mission_values | Non-empty |
| company_context.culture | Non-empty |
| company_context.recent_news | Array |
| company_context.strategic_direction | Non-empty |
| requirements.required_qualifications | Array, min 1 |
| requirements.preferred_qualifications | Array, min 1 |
| requirements.cultural_fit_attributes | Array |
| role_details.key_responsibilities | Array, min 3 |
| role_details.overview | Non-empty |
| role_details.success_metrics | Non-empty |
| what_you_get.company_strengths | Array |
| what_you_get.growth_opportunities | Non-empty |
| interview_preparation.key_themes | Array |
| metadata.enhanced_at | Today's ISO date |
| metadata.research_quality | `"SUFFICIENT"` or `"INSUFFICIENT"` |
| metadata.source_jd | `"jd_raw.txt"` |

**Routing:** SwitchAgent("Main Orchestrator")

---

## Analyst (v2.1)

**Files:** `project_memory.json` → `gap_analysis`
**Status after:** `metadata.status = "ANALYSIS_COMPLETE"`

**Schema — gap_analysis:**
| Field | Expected |
|-------|----------|
| requirements | Array; each has `{id, requirement_text, tier, candidate_status, source}` |
| requirements[*].candidate_status | `"Met"` or `"Gap"` |
| requirements where status="Met" | Must have `evidence_source` field |
| strengths | Array; each has `{id, strength_text, evidence_source, impact, tier, requirement_id}` |
| gaps | Array; each has `{id, gap_text, severity, tier, requirement_id, mitigation_strategy}` |
| overall_fit_score | Number 0–10 |
| fit_rationale | Non-empty string |
| ats_keywords | Array |
| candidate_provided_evidence | Present (may be empty array — added by Reviewer v1.8) |
| metadata.analyst_version | `"2.1"` |
| metadata.analyzed_at | ISO date |

**Display check:** Fit score shown with three-line breakdown (Baseline / Differentiator / Total)
**Routing:** SwitchAgent("Main Orchestrator")
**Banned:** `evidence_source` on a "Met" item pointing to a path that doesn't exist in candidate_profile.json

---

## Reviewer (v2.1)

**Files:** `project_memory.json` → `review_audit`, `metadata.status`
**Status after:** `metadata.status = "REVIEW_COMPLETE"` or `"REVIEW_FAILED"`

**Schema — review_audit:**
| Field | Expected |
|-------|----------|
| issues_found | Array (may be empty) |
| issues_found[*].item_id | Matches a requirements/strengths/gaps id |
| issues_found[*].issue_type | One of: A/B/C/D type codes |
| issues_found[*].severity | `"Critical"`, `"High"`, `"Medium"`, or `"Low"` |
| issues_found[*].confidence_level | 1–5 |
| overall_verdict | `"APPROVED"` or `"REJECTED"` |
| rejection_reason | Present if REJECTED |
| summary.approved_items | Number |
| summary.critical_issues | Number |
| summary.unresolved_issues | Number |
| metadata.reviewer_version | `"2.1"` |
| metadata.reviewed_at | ISO date |

**Gap Interview (Phase 8):** If high-severity baseline gaps exist, reviewer must ask candidate about up to 3 — responses stored in `gap_analysis.candidate_provided_evidence`
**Routing:** SwitchAgent("Main Orchestrator")
**REVIEW_FAILED path:** MO presents redo/accept options — does NOT auto-route

---

## Tone Analyst (v1.6)

**Files:** `style_guide.json`, `project_memory.json` status
**Status after:** `metadata.status = "TONE_ANALYZED"`

**Schema — style_guide.json:**
| Field | Expected |
|-------|----------|
| tone | Non-empty string |
| voice | Non-empty string |
| sentence_structure | Non-empty string |
| register | One of: `"peer-collegial"`, `"confident-professional"`, `"direct-practical"` |
| formatting | Object with preferences |
| examples | Array of extracted phrases (optional) |

**Routing:** SwitchAgent("Main Orchestrator") — must happen automatically after user approves style (no manual step)
**Display:** Style profile summary, must ask user to confirm before routing

---

## Assembly Coordinator (v3.6)

**Files:** `cv_assembly_state.json` (current_phase, metadata.status), `project_memory.json` (status → CV_BUILDING on first invocation)
**First invocation:** Sets `project_memory.json` metadata.status = `"CV_BUILDING"`
**Routing:** Reads current_phase → SwitchAgent to correct phase agent (zero output)

**Phase → Agent mapping:**
| current_phase | Target |
|--------------|--------|
| 1 | Style Negotiator |
| 2 | Profile Builder |
| 3 | Skills Curator |
| 4 | History Formatter |
| 5 | Credentials Formatter |
| 6 | CoverLetter Writer |
| 7 | Style Reviewer |
| 8 | Integrity Checker |

**Completion (all 8 done):** Sets `project_memory.json` status = `"CV_TAILORED"`, assembles `final_cv`
**Exception statuses:** `ROUTING_INTERVENTION`, `INTEGRITY_FAILED`, `STYLE_FAILED`
**AC exception field checks:**
- Phase 7 pass check: `styleReviewData.style_compliance === "PASS"` (NOT `.passed`)
- Phase 8 pass check: `integrityData.integrity_status === "PASSED"` (NOT `.passed`)
- Phase 4 completion check: object presence (NOT `historyData.length`)
- Phase 5 completion check: object presence (NOT `credentialsData.length`)
**Banned:** Any narration after routing — zero output between phases

---

## Style Negotiator (v1.3) — Phase 1

**Files:** `cv_assembly_state.json` → `phases[0]`
**Phase advance:** current_phase `1 → 2`, phases[0].status `PENDING → COMPLETE`

**Schema — phases[0].data:**
| Field | Expected |
|-------|----------|
| agreed_overrides | Object (may be empty `{}` if no overrides) |
| agreed_overrides keys | Style preference names |
| negotiation_summary | Non-empty string |
| completed_at | Today's ISO date |

**Style overrides written to:** `phases[0].data.agreed_overrides` (NOT `cvState.sections`)
**Routing:** SwitchAgent("Assembly Coordinator")
**Required display:** Style options presented, user confirmation received before writing

---

## Profile Builder (v1.4) — Phase 2

**Files:** `cv_assembly_state.json` → `phases[1]`
**Phase advance:** current_phase `2 → 3`, phases[1].status `PENDING → COMPLETE`

**Schema — phases[1].data:**
| Field | Expected |
|-------|----------|
| profile_statement | Non-empty string, 3–5 sentences |
| experience_years | Number based on `earliest start year → today` (NOT sum of duration_years) |
| key_themes | Array of strings |

**Experience year check:** If today is 2026, and earliest work_history start year is 2017 → experience_years should be ~9, NOT 12
**Routing:** SwitchAgent("Assembly Coordinator")
**Required display:** Draft profile for user review + confirmation prompt

---

## Skills Curator (v1.4) — Phase 3

**Files:** `cv_assembly_state.json` → `phases[2]`
**Phase advance:** current_phase `3 → 4`, phases[2].status `PENDING → COMPLETE`

**Schema — phases[2].data:**
| Field | Expected |
|-------|----------|
| technical_skills | Array of strings |
| soft_skills | Array of strings |
| certifications | Array of strings |
| tailoring_notes | Non-empty string |

**Tech detection:** `allTechSkills` list checked first (primary), then context
**Always shows full list for user confirmation** — no conditional auto-approve
**Routing:** SwitchAgent("Assembly Coordinator")

---

## History Formatter (v1.4) — Phase 4

**Files:** `cv_assembly_state.json` → `phases[3]`
**Phase advance:** current_phase `4 → 5`, phases[3].status `PENDING → COMPLETE`

**Schema — phases[3].data:**
| Field | Expected |
|-------|----------|
| work_history | Array, matches candidate_profile work_history count |
| work_history[*].employer | Non-empty |
| work_history[*].role | Non-empty |
| work_history[*].dates | Non-empty |
| work_history[*].bullets | Array of strings, telegraphic style |

**Display:** Header says "Display for User Review" (NOT "auto-approve")
**Routing:** SwitchAgent("Assembly Coordinator")
**Banned:** Routing to Main Orchestrator

---

## Credentials Formatter (v1.3) — Phase 5

**Files:** `cv_assembly_state.json` → `phases[4]`
**Phase advance:** current_phase `5 → 6`, phases[4].status `PENDING → COMPLETE`

**Schema — phases[4].data:**
| Field | Expected |
|-------|----------|
| education | Array |
| education[*].institution | Non-empty |
| education[*].qualification | Non-empty |
| education[*].year | Present |
| certifications | Array |

**Display:** Header says "Display for User Review" (NOT "auto-approve")
**Routing:** SwitchAgent("Assembly Coordinator")
**Banned:** Routing to Main Orchestrator

---

## CoverLetter Writer (v1.3) — Phase 6

**Files:** `cv_assembly_state.json` → `phases[5]`
**Phase advance:** current_phase `6 → 7`, phases[5].status `PENDING → COMPLETE`

**Schema — phases[5].data:**
| Field | Expected |
|-------|----------|
| cover_letter.header | Contains real contact info from candidateProfile.personal_info.contact (NOT placeholders) |
| cover_letter.date | Today's ISO date |
| cover_letter.re_line | Non-empty |
| cover_letter.salutation | Non-empty |
| cover_letter.opening_paragraph | Non-empty |
| cover_letter.connection_paragraph | Register-aware (based on style_guide.json register field) |
| cover_letter.closing_paragraph | Register-aware |
| cover_letter.sign_off | Non-empty |
| register_used | One of: `"peer-collegial"`, `"confident-professional"`, `"direct-practical"` |

**Banned:** `[Your Name]`, `[Your Email]`, `[Date]` or any other placeholder text; banned phrases from style guide
**Routing:** SwitchAgent("Assembly Coordinator")

---

## Style Reviewer (v1.4) — Phase 7

**Files:** `cv_assembly_state.json` → `phases[6]`, `metadata.status`
**Phase advance:** current_phase `7 → 8`, phases[6].status `PENDING → COMPLETE`

**Schema — phases[6].data:**
| Field | Expected |
|-------|----------|
| style_compliance | `"PASS"` or `"FAIL"` |
| issues_found | Array (empty if PASS) |
| fixes_applied | Array |
| verdict | `"PASS"`, `"PASS_WITH_FIXES"`, or `"FAIL"` |

**PASS/PASS_WITH_FIXES path:** metadata.status stays `"ACTIVE"`, routes directly to AC (no user turn)
**FAIL path (>2 issues):** metadata.status = `"STYLE_FAILED"`, AC exception handler fires
**Routing:** SwitchAgent("Assembly Coordinator")
**Banned:** Routing to Main Orchestrator; FAIL path without setting STYLE_FAILED status

---

## Integrity Checker (v1.8) — Phase 8

**Files:** `cv_assembly_state.json` → `phases[7]`, `metadata.status`
**Phase advance:** current_phase `8` (final), phases[7].status `PENDING → COMPLETE`

**Schema — phases[7].data:**
| Field | Expected |
|-------|----------|
| integrity_status | `"PASSED"` or `"FAILED"` |
| total_claims_checked | Number |
| unsupported_claims | Number (count) |
| unsupported_claims_detail | Array of `{section, claim, evidence_status}` — the primary claims array |
| ic_corrections | Array — subset of unsupported_claims_detail (NOT_FOUND, GAP_SKILL_FABRICATED, UNVERIFIED_DETAIL only) |
| fabrications_found | Array — alias for ic_corrections (spec field) |
| checks_performed | Array of section names checked (e.g. `["profile","skills","career_history","cover_letter","additional_information"]`) |
| evidence_verification | Object — `{method: "keyword_overlap", min_token_length: 4}` |

**Evidence verification method:** Keyword overlap against cv_raw.txt (>4-char tokens). NOT exact string match.
**PASSED path:** Chains directly to AC (no user turn required)
**FAILED path:** metadata.status = `"INTEGRITY_FAILED"`, AC exception handler fires
**additional_information check:** Publications and awards verified against cv_raw.txt
**Routing:** SwitchAgent("Assembly Coordinator")
**Banned:** Passing fabrications through; routing to Main Orchestrator
