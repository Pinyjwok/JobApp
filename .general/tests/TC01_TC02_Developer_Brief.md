# Job App MVP — Developer QA Brief
## Test Cases TC01 & TC02 — Consolidated Findings

**Prepared by:** Claude (QA Analyst)
**Date:** 31 March 2026
**Model Under Test:** Gemini Flash 3 (JOBAPP2 v2)
**Test Cases:** TC01 Chloe Simmons (Early Childhood Educator) | TC02 Alistair P. Whitmore (Lecturer in Quantum Computing)

---

## Overall Verdict

The pipeline is not production-ready. Two test cases across two very different candidate profiles have confirmed a consistent set of P0 failures that would result in an applicant submitting a CV containing fabricated credentials, wrong publication records, or invented employment history. These are not edge cases — they occurred in both runs.

**TC01 Overall: 6.0 / 10 — REVIEW**
**TC02 Overall: 4.9 / 10 — FAIL**

The drop between TC01 and TC02 is driven by a more severe fabrication pattern in TC02, where the entire publication list was replaced with invented titles, co-authors, and journals. TC02 is an academic application where publication records are the first thing a selection committee verifies. The output would be immediately disqualifying.

The recommendation at the end of this brief is to address P0 issues before running further test cases. A third test case run on the current build would produce a third data point on the same failures.

---

## P0 Issues — Fix Before Any Further Testing

These are failures that directly harm the candidate. They must be resolved before the pipeline is considered safe to use.

### P0-1: Integrity Checker does not cross-check content against cv_raw.txt

**What happened (TC01):** The Credentials Formatter added the course code "HLTAID012" and "Includes CPR, Asthma & Anaphylaxis" to the candidate's First Aid credential. This detail came from the JD selection criteria, not from the candidate's CV. The Integrity Checker reviewed and passed all credentials as "100% verified."

**What happened (TC02):** The Profile Builder generated a full publication list with invented titles, co-authors, and journals that bear no resemblance to the source CV. The Integrity Checker did not flag any of these. It did, correctly, catch a mathematical error in the fit score — demonstrating that the IC is capable of catching errors when it checks the right thing, but it is not checking content claims against the source document.

**Why this matters:** A candidate who submits fabricated credentials or publication records will be immediately identified. In an academic context this is career-ending. In any professional context it constitutes fraud.

**Fix required:** The Integrity Checker must cross-reference every content claim in the output CV against `cv_raw.txt` (or `candidate_profile.json`) before passing it. The check must be: "Is this claim — in this specific form — supported by the source document?" If a claim contains detail not present in the source (a course code, a publication title, a grant amount, an award), it must be flagged as unverified and presented to the user before the output is finalised.

The IC currently appears to be checking the *structure* of the output (fit score math, requirement classification) but not the *content* (did the candidate actually publish this paper?). Both checks are required.

---

### P0-2: Assembly Coordinator phase loop — systematic at every phase transition

**What happened:** The Assembly Coordinator fails to complete SwitchAgent calls at phase boundaries. In TC01 this was observed at Phase 2→3 (approximately 14 loop repetitions) and Phase 3→4. In TC02 it was observed at Phase 5 (approximately 16 repetitions before breaking). This is not isolated to one phase boundary — it is systematic.

**Root cause:** Each handoff attempt reads state files, hits the EISDIR error from the WriteFile directory bug, burns 3–4 tool calls on recovery, then re-attempts ChangeAgent — restarting the cycle. The loop does not self-terminate.

**Downstream consequence:** When the loop eventually breaks (either via user nudge or timeout), the pipeline self-progresses through multiple phases without stopping for user review. In TC01 Run 2, Phases 4, 5, and 6 ran without a single user checkpoint after the Phase 3→4 loop broke. The user had no opportunity to review or approve the formatted history, credentials, or cover letter before they were written.

**Fix required (two parts):**
1. Resolve the WriteFile EISDIR bug — this is the root cause of the loop. WriteFile must write a file, not a directory.
2. Add a loop guard to the Assembly Coordinator: after N failed ChangeAgent attempts, surface a plain-language error to the user ("I'm having trouble advancing to the next phase — please type 'continue' to retry") rather than looping silently.

---

### P0-3: Gap identified but never addressed with user before assembly

**What happened (TC01 and TC02):** In both test cases, the Analyst correctly identified gaps between the candidate's profile and the JD requirements. In TC01, the Diploma gap was identified. In TC02, the "industry bridge" gap was identified as a central requirement. In both cases, a mitigation strategy was suggested in the gap analysis output. In both cases, the assembly agents wrote around the gap without ever asking the candidate: "The JD requires X — do you have any experience with this that isn't in your CV?"

**Why this matters:** Real candidates applying with a generic CV frequently have relevant experience that simply wasn't documented. A candidate who has done consulting work, industry briefings, or technology transfer activities would want that included in the application. The pipeline identified the gap correctly but then fabricated a mitigation (TC01: implied the candidate had more ECE framework knowledge than evidenced; TC02: framed microwave calibration as "industry-facing" without candidate confirmation) rather than asking the candidate.

**Fix required:** Add an explicit gap-filling dialogue step between the Analyst and the Reviewer (or between the Reviewer and the Tone Analyst). For each identified gap, the system must prompt the candidate: "The role requires [X]. Your CV doesn't show evidence of this. Do you have relevant experience we should include?" The candidate's response feeds back into the candidate profile before assembly begins. This is a design gap in the pipeline, not just a prompt fix.

---

## Systematic Issues — Confirmed Across Both Test Cases

These issues were observed in every run of both TC01 and TC02. They are not intermittent.

### Main Orchestrator ZERO OUTPUT violation

Despite the v3.3 ZERO OUTPUT instruction, the Main Orchestrator continues to produce verbose routing summaries at every pipeline transition. In TC02 it went further — after the Analyst completed, it produced a menu of options ("We can move on to the Analyst phase to refine the strategy, or start CV Assembly or Cover Letter generation") that was not only text output but also incorrect routing advice (offering to go back to a phase already completed).

**Classification:** Model failure — the instruction is clear but Gemini Flash 3 generates output anyway. Consider whether the MO routing can be implemented without an LLM call entirely (pure tool call logic). If that is not possible on the KEMU platform, the instruction framing needs to be strengthened further. The current "ZERO OUTPUT" directive is not enforced by the model.

---

### Researcher defaults to PD-level research only

In both test cases, the Researcher produced output that was substantively a restatement of information already in the PD — the company mission, the quantum hub reference, the CQC2T mention were all present in the job description before the Researcher ran. No genuine external research was evident.

**New finding from TC02:** When challenged, the Researcher did produce genuine, useful, school-level research — Prof. Lloyd Hollenberg's role, the IBM quantum partnership, Athena SWAN participation, the Melbourne Model curriculum structure. This is important: the capability is present in the model. The Researcher is not instructed to exercise it by default.

**Classification:** Prompt fix.

**Fix required:** The Researcher must be instructed to:
1. Identify the decision-making unit for the role (usually the School, Department, or Business Unit — not the parent organisation).
2. Research that unit first: key staff, current research agenda, recent grants, strategic direction.
3. Then supplement with organisational-level research.

The current instruction scope is too broad — it produces generic institutional content that any candidate could find on the About page, rather than targeted intelligence that gives the candidate an edge in tailoring their application.

---

### Cover Letter register calibration

**TC01:** First draft was overly academic, second draft overcompensated into casual register ("I am good at," "I really like"). The cover letter writer cannot find the middle register without explicit anchoring.

**TC02:** First draft was corporate-deferential ("I am eager to contribute," "I am inspired by," "I am uniquely positioned"). Revised to a better register after user prompt, but required user intervention.

**Pattern:** The Cover Letter Writer has no stable register target. It defaults to either formal-corporate (TC02) or academic-dense (TC01), and when corrected, swings to the opposite extreme. The tone brief from the Tone Analyst is not providing enough constraint.

**Fix required:** The Cover Letter Writer must receive and apply a named register target with example sentences drawn from the candidate's actual language (elevated, not replaced). The tone brief must include an explicit "avoid" list. Without these constraints, the agent will continue to require multiple correction cycles.

---

### "I'll be back soon" — no completion signal

Both the Researcher and JD Enhancer acknowledge work has begun but do not signal completion. Users must manually probe ("Have you done the work? Any progress?") to surface output. In TC02 Run 3 this required two separate prompts before the JD Enhancer surfaced its output.

**Fix required:** Either remove the in-progress acknowledgement entirely, or complete the work in the same turn before sending any message. An agent must not send "I'll be back soon" and then go silent.

---

## TC02-Specific Issues

### Name mismatch not detected (Whitmore / Vaughn-Smith)

The source CV header names the candidate "Dr. Alistair P. Whitmore" but every publication in the CV is attributed to "Vaughn-Smith, A." The cover letter email address also uses vaughnsmith. Not one agent in the pipeline — Extractor, Analyst, Reviewer, or Integrity Checker — flagged this inconsistency.

In the final output, publications were listed under "Whitmore, A.P." — the system resolved the inconsistency silently by adopting the CV header name, without ever noting that the source publications used a different name, and without asking the candidate to confirm which name is correct. For an academic application, publication attribution under the wrong name would be highly problematic.

**Fix required:** The Extractor must detect when the name in the CV header does not match the name on publications, and flag this for user confirmation before proceeding. This is an identity verification task that directly affects the integrity of the application.

---

### Fit score self-correction loop

The Analyst initially produced a 9.2 fit score with no mathematical basis. The Integrity Checker correctly identified this as a calculation error and rejected the output. The Analyst re-ran and produced a mathematically justified score of 7.3. The Reviewer then verified the revised math.

This is a positive finding — the correction loop worked. It confirms the IC is capable of catching analysis-level errors. The issue is that it took a full extra pipeline pass (Analyst → IC → Analyst → Reviewer → Tone Analyst) to resolve what should have been caught at the Analyst stage.

**Fix required:** The Analyst must verify its own fit score calculation before submitting. The weighted formula (Baseline contribution + Differentiator contribution) should be explicitly calculated and shown as part of the Analyst output, not inferred.

---

### CI vs AI on ARC grant — framing risk

The candidate's ARC Discovery Project grant lists them as Associate Investigator, not Chief Investigator. The JD explicitly requires candidates to "lead applications for competitive external research funding as a Chief Investigator (CI)." The Analyst listed the ARC grant as a Strength without noting this distinction. The cover letter stated "I secured $480,000 in ARC Discovery funding" — which implies lead CI status the candidate does not have.

**Fix required:** When extracting grant history, the Extractor must capture the candidate's role on each grant (Lead CI, Associate Investigator, named investigator, etc.). The Analyst must assess grant capability requirements against the candidate's CI-level track record specifically, not their total grant involvement.

---

### Duplicate publication in source CV

The source CV contained two entries that refer to the same paper: both listed in Physical Review Letters, volume 128, article number 120501, both on "Tripartite Analysis of Phase-Slippage." No agent detected this. The final CV output made no mention of it.

**Fix required (lower priority):** The Extractor should scan the publication list for duplicate DOIs, volume/article number combinations, or near-identical titles and flag them for user confirmation.

---

## Enhancement Recommendations

Two new principles confirmed across both test cases:

**E1 — School / Department first research scope**
The Researcher must identify where the hiring decision is made (which is almost always the School, Department, or Business Unit level, not the parent organisation) and research that unit as the primary target. Organisational research supplements it. This produces intelligence actually useful to the candidate — who the decision-makers are, what the group's current research priorities are, what the team looks like — rather than information the candidate could find on the organisation's homepage.

**E2 — Gap-filling dialogue as a required pipeline step**
Gaps identified by the Analyst must be raised with the candidate in a dedicated dialogue step before assembly begins. The current pipeline identifies gaps, proposes mitigations, then writes the mitigation into the CV without the candidate's input. This leads to either fabrication (TC01: implied ECE framework knowledge) or ineffective gap treatment (TC02: industry bridge gap never addressed). The candidate is the only reliable source of information about their own experience. Ask them.

---

## What the IC Getting Right Tells Us

It is worth noting that in TC02 the Integrity Checker caught the fit score math error (9.2 had no mathematical basis) and the requirement misclassification (Industry Bridge was Essential not Differentiator). It did this correctly, triggered a rejection, and the Analyst self-corrected. This shows the IC's correction loop architecture is sound.

The failure is in scope: the IC is checking the analysis layer (math, classification, tiering) but not the content layer (do these publications exist? is this credential accurate?). Extending the IC's cross-checking scope to content claims against cv_raw.txt would make it significantly more effective without changing its architecture.

---

## Recommended Fix Priority

| Priority | Fix | Agents Affected |
|---|---|---|
| P0 | IC must cross-check all content claims against cv_raw.txt | Integrity Checker |
| P0 | WriteFile EISDIR bug — writes directory not file | Infrastructure |
| P0 | AC phase loop guard — max N attempts then surface error | Assembly Coordinator |
| P0 | Gap-filling dialogue step before assembly | Analyst + pipeline design |
| P1 | Extractor: detect name mismatch across CV sections | Extractor |
| P1 | Extractor: capture CI vs AI role on each grant | Extractor |
| P1 | Researcher: School/Department-first research scope | Researcher |
| P1 | Completion signal — remove "I'll be back soon" pattern | Researcher, JD Enhancer |
| P1 | Analyst: self-verify fit score calculation before output | Analyst |
| P2 | Cover Letter Writer: named register target + avoid list | CoverLetter Writer |
| P2 | MO ZERO OUTPUT — consider removing LLM call from routing | Main Orchestrator |
| P2 | Tone label consistency across assembly agents | All assembly agents |

---

## Recommended Next Steps

1. Address P0 fixes above — all four are required before the pipeline is safe to use with real candidates.
2. Re-test with TC02 persona (Alistair Whitmore) after P0 fixes — this is the highest-value re-run because the publication fabrication was so severe that it will be immediately obvious whether the IC fix is working.
3. After P0 fixes are confirmed working, proceed to TC03 with a different persona type (career changer or overqualified candidate) to expose seniority and role-transition failure modes.

---

*Scorecard: QA_Scorecard_Claude.xlsx (Dashboard + TC01, TC02 detail sheets)*
*Known issues register: QA_SESSION_SETUP.md*
*Agent instructions: General/instructions/*
