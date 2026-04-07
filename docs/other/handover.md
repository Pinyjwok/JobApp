# CV Optimization Multi-Agent System - Context Handover Document

**Document Version:** 1.0
**Last Updated:** 2026-03-17
**Project Status:** Main pipeline agents complete (9/9), Assembly phase agents pending (0/8)

---

## 1. High-Level Overview

**Objective:** Build a multi-agent workflow system that transforms raw CV and job description files into optimized, ATS-compliant, evidence-based application materials through a structured 15-phase pipeline.

**Core Architecture:**
```
Main Pipeline (7 phases) → Tone Analysis → CV Assembly Pipeline (8 phases)
                                           ↓
                              Main Orchestrator ← Assembly Coordinator
```

**Platform:** KEMU (AI workflow builder with turn-based agent execution)

**Key Innovation:** Two-tier orchestration with automatic state-based routing, evidence-based gap analysis, and quality review gates.

---

## 2. System Architecture & Tech Stack

### **Agent Hierarchy**

```
Main Orchestrator v3.0 (primary router)
├─ Main Pipeline Agents (Switch #1, Tone_Analysed = 0)
│  ├─ ProjectSetup v1.6
│  ├─ Extractor v1.8
│  ├─ Researcher v1.4
│  ├─ JD Enhancer v1.2
│  ├─ Analyst v1.6
│  ├─ Reviewer v1.2
│  └─ Tone Analyst v1.1
│
└─ Assembly Coordinator v3.0 (sub-orchestrator, Switch #2, Tone_Analysed = 1)
   ├─ Style Negotiator (Phase 1) - PENDING
   ├─ Profile Builder (Phase 2) - PENDING
   ├─ Skills Curator (Phase 3) - PENDING
   ├─ History Formatter (Phase 4) - PENDING
   ├─ Credentials Formatter (Phase 5) - PENDING
   ├─ CoverLetter Writer (Phase 6) - PENDING
   ├─ Style Reviewer (Phase 7) - PENDING
   └─ Integrity Checker (Phase 8) - PENDING
```

**Total Agents:** 17 (9 complete, 8 pending)

### **Technology Stack**

```yaml
Platform: KEMU
  - Turn-based agent execution (user input required between agents)
  - ChangeAgent routing (NOT SwitchAgent)
  - Global variables (SetGlobalVariable/GetGlobalVariable)
  - Two-switch routing architecture

Tools:
  - ReadFile: Read files using bare filenames
  - WriteFile: Write JSON strings (NOT objects) using bare filenames
  - ChangeAgent: Route to next agent with context object
  - SetGlobalVariable: Control routing switches
  - GetGlobalVariable: Check routing state

File System:
  - All files at root level (NO subdirectories)
  - Bare filenames ONLY (no leading slash, no paths)
  - JSON.stringify() required for all WriteFile operations
```

### **Critical Platform Constraints (KEMU)**

**Turn-Based Execution:**
```
User sends message → Main Orchestrator routes → Agent executes
→ Agent displays results → "Send any message to continue"
→ Agent returns to Main Orchestrator → WAIT for user input
→ User sends message → Next agent executes → Repeat
```

**Two-Switch Routing:**
```javascript
// Switch #1 (Main Pipeline)
if (Tone_Analysed == 0) {
  Route based on status:
    FILES_SAVED → Extractor
    INITIALIZED → Researcher
    RESEARCH_COMPLETE → JD Enhancer
    JD_ENHANCED → Analyst
    ANALYSIS_COMPLETE → Reviewer
    REVIEW_COMPLETE → Tone Analyst
}

// Switch #2 (CV Assembly)
if (Tone_Analysed == 1) {
  Route to Assembly Coordinator
  → Assembly Coordinator reads cv_assembly_state.json
  → Routes to phase agents (1-8)
}
```

**Tone Analyst sets `Tone_Analysed = 1` before returning to Main Orchestrator**

---

## 3. Core Workflow

### **Phase-by-Phase Data Flow**

```
[User uploads CV + JD]
           ↓
┌──────────────────────────────────────────────────────────┐
│ PHASE 1: PROJECT SETUP                                   │
│ Agent: ProjectSetup v1.6                                 │
│ Input: CV file, JD file from conversation context       │
│ Output: cv_raw.txt, jd_raw.txt, project_memory.json     │
│ Status: FILES_SAVED                                      │
└──────────────────────────────────────────────────────────┘
           ↓
┌──────────────────────────────────────────────────────────┐
│ PHASE 2: DATA EXTRACTION                                 │
│ Agent: Extractor v1.8                                    │
│ Input: cv_raw.txt, jd_raw.txt                           │
│ Output: candidate_profile.json (NOT user_profile.json)  │
│ Updates: project_memory.json metadata                    │
│ Status: INITIALIZED                                      │
└──────────────────────────────────────────────────────────┘
           ↓
┌──────────────────────────────────────────────────────────┐
│ PHASE 3: COMPANY RESEARCH                                │
│ Agent: Researcher v1.4                                   │
│ Input: Company name from metadata                        │
│ API: ResearchCompany (Tavily)                           │
│ Output: research_data (7 fields)                        │
│ Status: RESEARCH_COMPLETE                                │
└──────────────────────────────────────────────────────────┘
           ↓
┌──────────────────────────────────────────────────────────┐
│ PHASE 4: JD ENHANCEMENT                                  │
│ Agent: JD Enhancer v1.2                                  │
│ Input: jd_raw.txt, research_data                        │
│ Output: enhanced_jd (context-rich job description)       │
│ Status: JD_ENHANCED                                      │
└──────────────────────────────────────────────────────────┘
           ↓
┌──────────────────────────────────────────────────────────┐
│ PHASE 5: GAP ANALYSIS                                    │
│ Agent: Analyst v1.6                                      │
│ Input: candidate_profile.json, enhanced_jd              │
│ Process: Match requirements → Classify tiers             │
│          → Calculate fit score → Generate recommendations│
│ Output: gap_analysis (strengths, gaps, fit score)       │
│ Status: ANALYSIS_COMPLETE                                │
└──────────────────────────────────────────────────────────┘
           ↓
┌──────────────────────────────────────────────────────────┐
│ PHASE 6: QUALITY REVIEW                                  │
│ Agent: Reviewer v1.2                                     │
│ Input: gap_analysis, candidate_profile, enhanced_jd     │
│ Process: Audit evidence → Assign confidence (1-5)       │
│          → Categorize issues → Make verdict             │
│ Output: review_audit                                     │
│ Status: REVIEW_COMPLETE or REVIEW_FAILED                 │
│                                                          │
│ If REVIEW_FAILED:                                        │
│   → Main Orchestrator presents options to user          │
│   → User decides: redo Analyst/Researcher/JD Enhancer   │
│                   or accept anyway                       │
└──────────────────────────────────────────────────────────┘
           ↓
┌──────────────────────────────────────────────────────────┐
│ PHASE 7: TONE ANALYSIS                                   │
│ Agent: Tone Analyst v1.1                                 │
│ Input: cv_raw.txt                                        │
│ Process: Analyze writing style, tone patterns           │
│ Output: style_guide.json                                │
│ Action: SetGlobalVariable("Tone_Analysed", 1)           │
│ Status: TONE_ANALYZED                                    │
└──────────────────────────────────────────────────────────┘
           ↓
┌──────────────────────────────────────────────────────────┐
│ CV ASSEMBLY PIPELINE (Phases 1-8)                       │
│ Orchestrator: Assembly Coordinator v3.0                 │
│ State File: cv_assembly_state.json                      │
│                                                          │
│ Phase 1: Style Negotiator → style decisions             │
│ Phase 2: Profile Builder → professional summary         │
│ Phase 3: Skills Curator → categorized skills            │
│ Phase 4: History Formatter → work experience            │
│ Phase 5: Credentials Formatter → education/certs        │
│ Phase 6: CoverLetter Writer → cover letter              │
│ Phase 7: Style Reviewer → consistency check             │
│ Phase 8: Integrity Checker → evidence validation        │
│                                                          │
│ Output: tailored_cv in project_memory.json              │
│ Status: CV_TAILORED                                      │
└──────────────────────────────────────────────────────────┘
           ↓
    [Complete]
```

---

## 4. Development History & Major Changes

### **Evolution Timeline**

```
2026-02-19: v1.0 - Initial agent instructions (ProjectSetup, Extractor, Orchestrator v2.5)
            - Automatic workflow (no user input between phases)
            - Single-tier orchestration

2026-02-26: v2.0 - Researcher, JD Enhancer, Analyst, Reviewer added
            - Automatic routing between all agents
            - Review gates introduced (REVIEW_FAILED handling)

2026-03-09: v2.5 - Assembly Coordinator concept introduced
            - CV assembly broken into 8 phases
            - Still automatic workflow

2026-03-11: v3.0 - KEMU migration (turn-based execution required)
            - Two-switch routing architecture designed
            - Global variable (Tone_Analysed) for switch control
            - Assembly Coordinator as sub-orchestrator

2026-03-12: v3.1 - candidate_profile.json rename (was user_profile.json)
            - Fixed subdirectory creation bug
            - Turn-based completion displays added to all agents
            - ChangeAgent (not SwitchAgent) tool name correction

2026-03-14: v3.2 - JD Enhancer v1.2, Analyst v1.6, Reviewer v1.2 complete
            - Assembly Coordinator v3.0 complete with phase routing logic
            - All main pipeline agents updated for turn-based pattern
```

### **Critical Architectural Pivots**

#### **Pivot 1: Automatic → Turn-Based (March 11)**
**Before:**
```
Agent completes → Auto-route to next → Agent completes → Auto-route → ...
User sees: [silence] → Full results at end
Turns: 2 total (upload + completion)
```

**After:**
```
Agent completes → Display results → "Send any message to continue"
→ Wait for user input → Route to next agent
User sees: Progressive updates, controls pacing
Turns: 1 per phase (9-15 total)
```

**Reason:** KEMU platform requirement (turn-based execution mandatory)

#### **Pivot 2: Single-Tier → Two-Tier Orchestration (March 9)**
**Before:**
```
Main Orchestrator routes to all 15 agents directly
```

**After:**
```
Main Orchestrator (phases 1-7)
    ↓
Assembly Coordinator (phases 8-15)
    ↓
Individual phase agents
```

**Reason:** CV assembly needed sub-orchestration for:
- State invalidation matrix
- Exception handling (ROUTING_INTERVENTION, INTEGRITY_FAILED, STYLE_FAILED)
- Phase dependencies
- User-requested changes

#### **Pivot 3: user_profile.json → candidate_profile.json (March 12)**
**Before:**
```javascript
WriteFile("user_profile.json", content)
Result: /user_profile.json/user_profile.json (subdirectory created!)
```

**After:**
```javascript
WriteFile("candidate_profile.json", content)
Result: candidate_profile.json (at root level)
```

**Reason:** Platform bug - certain filenames trigger subdirectory creation

---

## 5. Current State

### **✅ Complete (9/17 agents)**

| Agent | Version | Status | Phases | Output |
|-------|---------|--------|--------|--------|
| Main Orchestrator | v3.0 | ✅ Complete | Routing logic | Routes to agents |
| ProjectSetup | v1.6 | ✅ Complete | 9 phases | FILES_SAVED |
| Extractor | v1.8 | ✅ Complete | 9 phases | INITIALIZED |
| Researcher | v1.4 | ✅ Complete | 8 phases | RESEARCH_COMPLETE |
| JD Enhancer | v1.2 | ✅ Complete | 9 phases | JD_ENHANCED |
| Analyst | v1.6 | ✅ Complete | 12 phases | ANALYSIS_COMPLETE |
| Reviewer | v1.2 | ✅ Complete | 10 phases | REVIEW_COMPLETE/FAILED |
| Tone Analyst | v1.1 | ✅ Complete | Unknown | TONE_ANALYZED |
| Assembly Coordinator | v3.0 | ✅ Complete | 3 phases | Routes to phase agents |

### **⏳ Pending (8/17 agents)**

All CV assembly phase executor agents need complete instructions:

1. **Style Negotiator** - Phase 1
   - Format decisions (chronological vs functional)
   - Length targets
   - Section ordering
   - Visual styling preferences
   - Output: `style_decisions` in cv_assembly_state.json

2. **Profile Builder** - Phase 2
   - Professional summary generation
   - Value proposition synthesis
   - Key strengths extraction
   - Output: `profile_summary` data object

3. **Skills Curator** - Phase 3
   - Skill categorization (Core/Technical/Interpersonal)
   - ATS keyword optimization
   - Prioritization logic
   - Output: `skills_section` data object

4. **History Formatter** - Phase 4
   - Work experience formatting
   - Achievement quantification
   - Chronological ordering
   - Output: `work_history_formatted` data object

5. **Credentials Formatter** - Phase 5
   - Education formatting
   - Certifications presentation
   - Output: `credentials_section` data object

6. **CoverLetter Writer** - Phase 6
   - Tailored cover letter generation
   - Fit score integration
   - Company research integration
   - Output: `cover_letter` data object

7. **Style Reviewer** - Phase 7
   - Consistency validation
   - Formatting compliance check
   - Output: review status (PASS/STYLE_FAILED)

8. **Integrity Checker** - Phase 8
   - Evidence validation
   - Claim verification
   - Output: review status (PASS/INTEGRITY_FAILED)

### **📁 File Structure**

```
project_directory/
├─ cv_raw.txt (uploaded CV)
├─ jd_raw.txt (uploaded job description)
├─ project_memory.json (main state file)
├─ candidate_profile.json (extracted profile data)
├─ cv_assembly_state.json (assembly pipeline state)
├─ conversation_history.json (audit log)
├─ agent_reasoning.json (decision log)
└─ style_guide.json (tone analysis output)
```

### **project_memory.json Structure**

```json
{
  "metadata": {
    "companyName": "string",
    "positionTitle": "string",
    "sector": "string",
    "cv_source": "cv_raw.txt",
    "jd_source": "jd_raw.txt",
    "createdAt": "ISO timestamp",
    "lastUpdated": "ISO timestamp",
    "status": "FILES_SAVED | INITIALIZED | ...",
    "version": "1.0"
  },
  "research_data": {
    "mission_values": "string",
    "culture_and_work_style": "string",
    "recent_developments": ["array"],
    "key_strengths": ["array"],
    "known_challenges": ["array"],
    "strategic_plan_and_growth": "string",
    "interview_and_hiring_focus": "string"
  },
  "enhanced_jd": {
    "original_jd_summary": "string",
    "company_context": {},
    "role_details": {},
    "requirements": {},
    "what_you_get": {},
    "interview_preparation": {},
    "metadata": {}
  },
  "gap_analysis": {
    "strengths": [],
    "gaps": [],
    "requirements": [],
    "ats_keywords": [],
    "overall_fit_score": 0-10,
    "fit_rationale": "string",
    "recommendations": [],
    "metadata": {}
  },
  "review_audit": {
    "overall_verdict": "APPROVED | REJECTED",
    "issues_found": [],
    "approved_items": [],
    "summary": {}
  },
  "tailored_cv": null,  // Populated by Assembly Coordinator at completion
  "change_log": []
}
```

---

## 6. Implicit Context & "Gotchas"

### **CRITICAL: WriteFile Rules**

```javascript
// ❌ WRONG - Leading slash
WriteFile("/project_memory.json", content)

// ❌ WRONG - Path construction
const path = "project_memory.json"
WriteFile(path + "/data", content)

// ❌ WRONG - Passing object instead of string
WriteFile("project_memory.json", projectMemory)

// ✅ CORRECT - Bare filename + JSON string
const filename = "project_memory.json"
if (filename.startsWith('/') || filename.includes('/')) {
  ERROR: "Invalid filename"
  STOP
}
const jsonString = JSON.stringify(projectMemory, null, 2)
WriteFile("project_memory.json", jsonString)
```

**Mandatory pre-write check for EVERY WriteFile call:**
```javascript
const filename = "project_memory.json"
if (filename.startsWith('/') || filename.includes('/') || filename.includes('\\')) {
  ERROR: "Invalid filename - contains slash"
  STOP
}
WriteFile(filename, JSON.stringify(data, null, 2))
```

### **CRITICAL: candidate_profile.json NOT user_profile.json**

```javascript
// ❌ WRONG - Triggers subdirectory bug
WriteFile("user_profile.json", content)
Result: /user_profile.json/user_profile.json

// ✅ CORRECT
WriteFile("candidate_profile.json", content)
Result: candidate_profile.json
```

**All agents must use `candidate_profile.json` consistently**

### **CRITICAL: Turn-Based Completion Pattern**

Every agent MUST end with:
```markdown
# ✓ {Agent Name} Complete

{Summary of what was done}

---

Send any message to continue.
```

Then immediately:
```javascript
ChangeAgent(
  agent: "Main Orchestrator",
  context: {}
)
```

**Agent must NOT wait for user input before calling ChangeAgent**
**Agent must NOT display progress during execution (Phases 1-N silent)**
**Agent ONLY displays final summary at end**

### **Evidence-Based Methodology**

**Confidence Level Scoring (Reviewer agent):**
```
5 = Directly Verified (exact match in source)
4 = Strongly Supported (clear evidence with minor interpretation)
3 = Reasonably Supported (evidence supports with inference)
2 = Weakly Supported (plausible but thin evidence)
1 = Unsupported (no evidence or contradicted)

Rule: Only approve items with confidence ≥ 4
```

**Every strength must have:**
```json
{
  "strength_text": "Specific achievement claim",
  "evidence_source": "candidate_profile.work_history[0].achievements[2]",
  "confidence_level": 4-5,
  "tier": "Baseline" | "Differentiator"
}
```

**Every gap must have:**
```json
{
  "gap_text": "Missing requirement",
  "requirement_source": "enhanced_jd.requirements.required_qualifications[3]",
  "severity": "High" | "Medium" | "Low",
  "tier": "Baseline" | "Differentiator"
}
```

### **Two-Tier Requirement Classification**

```
Baseline (Required/Must-Have):
- Foundational qualifications
- Non-negotiable skills
- Regulatory requirements
- Core competencies
- Weight: 70% of fit score

Differentiator (Preferred/Nice-to-Have):
- Competitive advantages
- Advanced skills
- Certifications beyond minimum
- Leadership experience
- Weight: 30% of fit score
```

**Classification rules:**
- "Required", "Must have", "Essential" → Baseline
- "Preferred", "Desired", "Ideal" → Differentiator
- Experience requirements (years) → Baseline
- Advanced certifications → Differentiator

### **Fit Score Calculation**

```javascript
// Baseline score (0-7 points)
const baselineTotal = requirements.filter(r => r.tier === "Baseline").length
const baselineMet = requirements.filter(r => r.tier === "Baseline" && r.candidate_status === "Met").length
const baselineScore = (baselineMet / baselineTotal) * 7

// Differentiator score (0-3 points)
const diffTotal = requirements.filter(r => r.tier === "Differentiator").length
const diffMet = requirements.filter(r => r.tier === "Differentiator" && r.candidate_status === "Met").length
const diffScore = (diffMet / diffTotal) * 3

// Overall fit score (0-10)
const overallFitScore = Math.round((baselineScore + diffScore) * 10) / 10
```

### **REVIEW_FAILED Handling**

When Reviewer sets status to `REVIEW_FAILED`, Main Orchestrator MUST:

1. Display issues summary
2. Present options to user:
   - `redo analyst` → status = JD_ENHANCED, route to Analyst
   - `redo researcher` → status = INITIALIZED, route to Researcher
   - `redo jd enhancer` → status = RESEARCH_COMPLETE, route to JD Enhancer
   - `accept anyway` → status = REVIEW_COMPLETE, route to Tone Analyst
   - `details` → Show full issues_found array

3. Wait for user decision (DO NOT auto-route)
4. Update status based on user choice
5. Route to appropriate agent

**This is the ONLY case where Main Orchestrator writes to project_memory.json**

### **Assembly Coordinator as Sub-Orchestrator**

```javascript
// Main Orchestrator delegates ALL CV assembly to Assembly Coordinator
if (status === "TONE_ANALYZED" || status === "CV_BUILDING") {
  ChangeAgent(
    agent: "Assembly Coordinator",
    context: {
      project_path: "project_memory.json",
      profile_path: "candidate_profile.json",
      cv_state_path: "cv_assembly_state.json"
    }
  )
}
```

**Assembly Coordinator responsibilities:**
- Read cv_assembly_state.json
- Route to phase agents (1-8) based on current_phase
- Handle exceptions (ROUTING_INTERVENTION, INTEGRITY_FAILED, STYLE_FAILED)
- Manage state invalidation matrix
- Finalize CV at completion (phase > 8)
- Update project_memory.json with tailored_cv
- Set status to CV_TAILORED

### **State Invalidation Matrix**

When user requests change to earlier section:

```javascript
const INVALIDATION_MATRIX = {
  "style": { affects: [1,2,3,4,5,6,7], message: "All sections" },
  "contact": { affects: [2], message: "Profile only" },
  "profile": { affects: [2,7,8], message: "Profile, Style Review, Integrity" },
  "skills": { affects: [3,7,8], message: "Skills, Style Review, Integrity" },
  "history": { affects: [4,7,8], message: "History, Style Review, Integrity" },
  "credentials": { affects: [5,7,8], message: "Credentials, Style Review, Integrity" },
  "cover_letter": { affects: [6,7,8], message: "Cover Letter, Style Review, Integrity" }
}

// If user requests change that invalidates completed phases:
// 1. Set status to ROUTING_INTERVENTION
// 2. Display affected phases
// 3. Wait for user confirmation (proceed/cancel)
// 4. If proceed: reset affected phases to PENDING, route to earliest affected phase
```

### **Timestamps - Current Date Awareness**

```javascript
// ❌ WRONG - Hardcoded date
const timestamp = "2026-02-19T09:32:00Z"

// ✅ CORRECT - Use actual current date from system context
// System message contains: "The current date is Tuesday, March 17, 2026"
const timestamp = getCurrentISOTimestamp()
// Example: "2026-03-17T14:22:00Z"

// NEVER hardcode dates
// ALWAYS use actual date/time from system context
```

### **Status Progression (Complete Path)**

```
FILES_SAVED
   ↓
INITIALIZED
   ↓
RESEARCH_COMPLETE
   ↓
JD_ENHANCED
   ↓
ANALYSIS_COMPLETE
   ↓
REVIEW_COMPLETE (or REVIEW_FAILED → user decision → rollback)
   ↓
TONE_ANALYZED
   ↓
CV_BUILDING (Assembly Coordinator active)
   ↓
CV_TAILORED
```

**Exception statuses:**
- `EXTRACTION_FAILED` - Cannot parse CV/JD
- `RESEARCH_FAILED` - Cannot gather company data
- `ANALYSIS_FAILED` - Cannot complete gap analysis
- `REVIEW_FAILED` - Quality issues detected
- `ROUTING_INTERVENTION` - User requested change
- `INTEGRITY_FAILED` - Unsupported claims found
- `STYLE_FAILED` - Formatting violations

---

## 7. Immediate Next Steps

### **Priority 1: Complete Assembly Phase Agents (8 agents)**

Each agent needs complete instructions following this template:

```markdown
# [Agent Name] v1.0 — System Instructions

## Agent Identity
| Field | Value |
| Agent Name | [Name] |
| Version | 1.0 |
| Role | [Description] |
| Pipeline Position | Assembly Phase [N] |
| Trigger | current_phase = [N] in cv_assembly_state.json |
| Output | [data object name] |

## Role
[What this agent does]

## Authority
READ: cv_assembly_state.json, project_memory.json, candidate_profile.json
WRITE: cv_assembly_state.json (update phase data)
PRESERVE: All other files

## Tools
ReadFile, WriteFile, ChangeAgent

## Execution Protocol
### Phase 1: Load State
### Phase 2: [Agent-specific processing]
### Phase 3: Generate Output
### Phase 4: Update cv_assembly_state.json
### Phase 5: Display Results & Return

## Display Pattern
# ✓ [Agent Name] Complete
[Summary]
---
Send any message to continue.

ChangeAgent(agent: "Assembly Coordinator")

## Critical Rules
1. Use bare filenames
2. Always stringify JSON
3. Turn-based completion
4. candidate_profile.json (not user_profile.json)
```

### **Priority 2: Verify Tone Analyst v1.1 Instructions**

- Instructions referenced in updated_instructions.md as "same as provided earlier"
- Need to confirm complete instructions exist
- Must include SetGlobalVariable("Tone_Analysed", 1)
- Must follow turn-based completion pattern

### **Priority 3: Integration Testing**

Once all 17 agents complete:
1. Test full pipeline (upload → CV_TAILORED)
2. Verify turn-based execution works
3. Test REVIEW_FAILED rollback paths
4. Test Assembly Coordinator phase routing
5. Test state invalidation matrix
6. Verify all files created at root level
7. Check all timestamps use current date

---

## 8. Reference Documentation

### **Source Files**

```
/mnt/project/
├─ Project_Setup_Agent_Instructions (ProjectSetup v1.4 source)
├─ Extractor_Agent_Instructions (Extractor v1.6 source)
├─ Orchestrator_Agent_Instructions_ (Orchestrator v2.6 source)
├─ Researcher_Agent_Instructions_ (Researcher v1.3 source)
├─ JD_Enhancer_Instructions_ (JD Enhancer v1.1 source)
├─ Analyst_Agent_Instructions (Analyst v1.5 source)
├─ Reviewer_Agent_Instructions (Reviewer v1.1 source)
└─ updated_instructions.md (Main Orchestrator v3.0 + updated agents)

/mnt/user-data/outputs/
├─ jd_enhancer_v1.2_complete.md (JD Enhancer v1.2)
├─ analyst_v1.6_complete.md (Analyst v1.6)
├─ reviewer_v1.2_complete.md (Reviewer v1.2)
└─ assembly_coordinator_v3.0_complete.md (Assembly Coordinator v3.0)
```

### **Conversation Transcripts**

```
/mnt/transcripts/
├─ 2026-03-14-23-25-35-cv-agent-instructions-complete.txt
├─ 2026-03-12-05-11-12-cv-agent-instructions-update.txt
├─ 2026-03-12-04-41-08-cv-agent-system-turnbased-updates.txt
├─ 2026-03-12-02-14-10-cv-agent-assembly-engine-routing.txt
├─ 2026-03-11-03-30-33-cv-agent-system-refactor-hybrid-routing.txt
├─ 2026-03-09-11-36-52-cv-agent-system-build-coordinator.txt
└─ 2026-03-04-21-08-40-ux-fixes-silent-worker-completion.txt
```

---

## 9. Context for Next Session

**If user says "continue the job app project":**

The new AI should:
1. Read this entire handover document
2. Acknowledge current state: 9/17 agents complete, 8 assembly phase agents pending
3. Ask which assembly phase agent to build next, or
4. Offer to create all 8 assembly agents systematically

**If user provides updates to existing agents:**
- Apply changes to source instructions
- Increment version number
- Update changelog
- Note any breaking changes

**If user reports bugs:**
- Check against "Gotchas" section first
- Verify WriteFile using bare filenames + JSON.stringify
- Confirm ChangeAgent (not SwitchAgent)
- Check candidate_profile.json (not user_profile.json)

---

**End of Handover Document**

**Next AI Instance:** You now have complete context on the CV Optimization Multi-Agent System. The main pipeline (9 agents) is complete. The CV assembly phase (8 agents) needs complete instructions following the established patterns and principles.