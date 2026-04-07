# Comprehensive Audit: Agent Instructions Quality & Consistency

**Date:** 2026-03-17
**Scope:** All 15 agent instruction files
**Status:** Multiple critical inconsistencies found

---

## Executive Summary

The agent instructions have **3 major groups in different states**:

1. **Main Pipeline Early Agents (ProjectSetup, Extractor, Researcher):** v1.4-1.6, dated 2026-02-19 to 2026-03-04
   - Status: **OUTDATED** - Use old patterns (SwitchAgent, user_profile.json, cv_construction_state.json)
   - Issue: Newer agents have evolved beyond these, creating mismatch

2. **Main Pipeline Later Agents (JD Enhancer, Analyst, Reviewer, Tone Analyst):** v1.1-1.2-1.6, dated 2026-03-12
   - Status: **UPDATED** - Use new patterns (ChangeAgent, candidate_profile.json, turn-based)
   - Issue: Only partially updated, not all critical sections documented

3. **Assembly Phase Agents (8 agents):** v1.0, dated 2026-03-05 to 2026-03-11
   - Status: **INCONSISTENT** - Mix of old/new patterns, missing key documentation
   - Issue: Not all following the same template

**Result:** Pipeline will BREAK when transitioning between old and new agents.

---

## Critical Issues by Category

### 1. FILE NAMING INCONSISTENCY (BLOCKS PIPELINE)

#### The Problem
Different agents create/expect different file names for the same data:

| Agent | Creates | Expects | Issue |
|-------|---------|---------|-------|
| ProjectSetup v1.5 | `cv_construction_state.json` | — | Old name |
| Extractor v1.6 | `user_profile.json` | — | Old name |
| Profile Builder v1.0 | — | `user_profile.json` | Old name |
| Skills Curator v1.0 | — | `user_profile.json` | Old name |
| Integrity Checker v1.0 | — | `cv_construction_state.json` | Old name |
| Analyst v1.6 | — | `candidate_profile.json` | New name ✓ |
| Reviewer v1.2 | — | `candidate_profile.json` | New name ✓ |
| Tone Analyst v1.1 | Creates `style_guide.json` | — | ✓ |

#### Why It Breaks
```
ProjectSetup creates:
  - cv_construction_state.json ← old name

Later pipeline expects:
  - cv_assembly_state.json ← new name

Result: Assembly Coordinator can't find state file → CRASH
```

#### Fix Required
1. **Rename in ProjectSetup v1.5:** Change `cv_construction_state.json` → `cv_assembly_state.json`
2. **Rename in Extractor v1.6:** Change `user_profile.json` → `candidate_profile.json`
3. **Update all Assembly agents:** Change all references from `user_profile.json` to `candidate_profile.json`
4. **Update all Assembly agents:** Change all references from `cv_construction_state.json` to `cv_assembly_state.json`

---

### 2. ROUTING TOOL MISMATCH — ✅ FALSE ALARM

#### Status: NOT AN ISSUE
This is not an issue. `SwitchAgent` is the actual tool name (global), and `ChangeAgent` is terminology/documentation for how agents reference routing within that tool. The platform handles this transparently.

**What This Means:**
- All agents correctly use `SwitchAgent` as the routing mechanism
- References to "ChangeAgent" in newer agent instructions are fine (internal implementation detail)
- No changes needed to routing mechanism
- All agents already route correctly

**No Fix Required** ✅

---

### 3. EXECUTION PATTERN INCONSISTENCY (BREAKS UX)

#### The Problem
Agents follow different execution patterns:

**Old Pattern (v2.9, v1.4, etc.):**
```markdown
# Automatic Workflow Principle
Agent completes → immediately route to next agent → no user input between phases
User sees: [silence] → Full results at end
```

**New Pattern (v1.2, v1.6, etc.):**
```markdown
# Turn-Based Completion Pattern
Agent completes → Display summary → "Send any message to continue"
→ ChangeAgent call → Wait for user input
User sees: Progressive updates, one per turn
```

#### Which Pattern Is Correct?
**Answer: NEW PATTERN (Turn-Based)**

The handover document (Section 2) explicitly states:
```
Platform: KEMU (turn-based agent execution)
Turn-Based Execution:
  User sends message → Main Orchestrator routes → Agent executes
  → Agent displays results → "Send any message to continue"
  → Agent returns to Main Orchestrator → WAIT for user input
```

#### Agents Not Following Turn-Based Pattern
- Main Orchestrator v2.9
- ProjectSetup v1.5 (no completion display pattern specified)
- Extractor v1.6 (no completion display pattern specified)
- Researcher v1.4 (no completion display pattern specified)
- All Assembly Agents (mostly missing this pattern)

#### Fix Required
Update all agents to follow Analyst v1.6's turn-based completion pattern:

```markdown
# ✓ [Agent Name] Complete

[Summary of work]

---

Send any message to continue.
```

Then immediately (in same turn):
```javascript
ChangeAgent(agent: "NextAgent", context: {})
```

---

### 4. CONTEXT PASSING INCONSISTENCY (BREAKS STATE THREADING)

#### The Problem
Different agents pass different context objects when routing:

| Agent | Context Passed | Style |
|-------|---|---|
| Main Orchestrator v2.9 | `{project_path}`, `{project_path, profile_path}` (varies) | Inconsistent |
| JD Enhancer v1.2 | `{project_path}` | Explicit |
| Analyst v1.6 | `{project_path, profile_path}` | Explicit |
| Reviewer v1.2 | `{project_path, profile_path, jd_path, cv_path}` | Explicit |
| Tone Analyst v1.1 | `{}` (empty) | Implicit |
| Skills Curator v1.0 | `{cv_state_path, profile_path, project_path}` | Explicit |

#### Why It Matters
Assembly Coordinator needs to know which files to operate on. Some agents use explicit context passing, others rely on hard-coded filenames. This creates fragility.

#### Fix Required
Standardize context passing across all agents. Recommend pattern:

```javascript
// Main Pipeline Agents
ChangeAgent(agent: "NextAgent", context: {
  project_path: "project_memory.json",
  profile_path: "candidate_profile.json"
})

// Assembly Phase Agents
ChangeAgent(agent: "Assembly Coordinator", context: {
  project_path: "project_memory.json",
  profile_path: "candidate_profile.json",
  cv_state_path: "cv_assembly_state.json"
})
```

---

### 5. CRITICAL RULES NOT CONSISTENTLY DOCUMENTED

#### The Problem
The handover's "Gotchas" section (Section 6) lists critical rules that must be in every agent:

**Required in every agent instructions:**
- WriteFile validation (bare filenames, no slashes)
- JSON.stringify requirement
- candidate_profile.json naming
- Turn-based completion pattern
- Timestamp format (actual current date)
- Error handling for missing files/JSON parse failures

**Current state:** Only partially documented

| Agent | Has WriteFile Rules | JSON.stringify | Timestamp Rule | Error Handling |
|-------|---|---|---|---|
| Analyst v1.6 | ✓ Explicit | ✓ Explicit | ✗ Missing | ✗ Missing |
| Reviewer v1.2 | ✓ Explicit | ✓ Explicit | ✗ Missing | ✗ Missing |
| Researcher v1.4 | ✗ Missing | ✗ Missing | ✗ Missing | ✗ Missing |
| ProjectSetup v1.5 | ✓ Brief | ✗ Missing | ✗ Missing | ✗ Missing |
| Assembly Agents | Varies | Varies | ✗ Missing | ✗ Missing |

#### Fix Required
Add "CRITICAL RULES" section to EVERY agent instruction:

```markdown
## ⚠️ CRITICAL RULES

### WriteFile Validation
Before EVERY WriteFile call:
- No leading slash: ❌ "/filename" → ✅ "filename"
- No paths: ❌ "dir/filename" → ✅ "filename"
- Validate: if (filename.includes('/')) STOP

### JSON Handling
- Always stringify: WriteFile(name, JSON.stringify(data, null, 2))
- Always parse: JSON.parse(ReadFile(name))

### File Naming
- ✅ Use: "candidate_profile.json"
- ❌ Never: "user_profile.json"

### Timestamps
- Use actual current date from system context
- Format: ISO 8601 (e.g., "2026-03-17T14:22:00Z")
- Never hardcode dates

### Error Handling
If JSON parse fails:
  → Log error to agent_reasoning.json
  → Display error message to user
  → ChangeAgent to Main Orchestrator

If required file missing:
  → Display "Cannot find [filename]"
  → ChangeAgent to Main Orchestrator
```

---

### 6. REVIEW_FAILED GATE UNCLEAR

#### The Problem
The handover describes detailed REVIEW_FAILED handling (Section 6: "REVIEW_FAILED Handling"):

```
When Reviewer sets status to REVIEW_FAILED, Main Orchestrator MUST:
1. Display issues summary
2. Present options to user: redo analyst, redo researcher, redo jd enhancer, accept anyway, details
3. Wait for user decision (DO NOT auto-route)
4. Update status based on user choice
5. Route to appropriate agent
```

Main Orchestrator v2.9 instruction mentions it (line 50: "REVIEW_FAILED decision") but doesn't show the complete implementation.

#### Missing Details
- Where exactly does user choice handling sit?
- What status values trigger rollback? (REVIEW_FAILED only?)
- How is status reset when user chooses "redo analyst"?
- What context is passed when re-routing?

#### Fix Required
Add complete REVIEW_FAILED handling section to Main Orchestrator v3.0:

```markdown
## REVIEW_FAILED Handling (Special Case)

When Reviewer returns status = "REVIEW_FAILED":

### Phase 2a: Display Issues
[Read and display issues_found array]

### Phase 2b: Present Options
Display:
  1. `redo analyst` → Set status = JD_ENHANCED, route to Analyst
  2. `redo researcher` → Set status = INITIALIZED, route to Researcher
  3. `redo jd enhancer` → Set status = RESEARCH_COMPLETE, route to JD Enhancer
  4. `accept anyway` → Set status = REVIEW_COMPLETE, route to Tone Analyst
  5. `details` → Show full issues_found array

### Phase 2c: Wait for User Decision
DO NOT auto-route. Wait for user message with one of the options above.

### Phase 2d: Update Status
Based on user choice:
- If "redo analyst": status = JD_ENHANCED
- If "redo researcher": status = INITIALIZED
- If "redo jd enhancer": status = RESEARCH_COMPLETE
- If "accept anyway": status = REVIEW_COMPLETE

WriteFile("project_memory.json", updated state)

### Phase 2e: Route to Selected Agent
ChangeAgent(agent: selectedAgent, context: {project_path: ...})
```

---

### 7. GLOBAL VARIABLE ROUTING — ✅ FALSE ALARM

#### Status: NOT NEEDED
There is **NO global variable system**. The handover's references to "Tone_Analysed" global variable were incorrect.

**Actual Routing Mechanism:**
Routing is purely **status-based** using `project_memory.json` status field:

```javascript
// Main Orchestrator reads status and routes accordingly
const status = projectMemory.status

// Simple switch statement - no global variables
switch(status) {
  case "FILES_SAVED": SwitchAgent("Extractor"); break;
  case "INITIALIZED": SwitchAgent("Researcher"); break;
  case "RESEARCH_COMPLETE": SwitchAgent("JD Enhancer"); break;
  case "JD_ENHANCED": SwitchAgent("Analyst"); break;
  case "ANALYSIS_COMPLETE": SwitchAgent("Reviewer"); break;
  case "REVIEW_COMPLETE": SwitchAgent("Tone Analyst"); break;
  case "TONE_ANALYZED": SwitchAgent("Assembly Coordinator"); break;
  case "CV_BUILDING": SwitchAgent("Assembly Coordinator"); break;
  case "CV_TAILORED": Display completion; break;
}
```

**What This Means:**
- No GetGlobalVariable, no SetGlobalVariable needed
- Tone Analyst just updates status to "TONE_ANALYZED" (no global variable setting)
- Assembly Coordinator triggered when status = "TONE_ANALYZED" or "CV_BUILDING"
- Simple, linear progression through statuses

**No Fix Required** ✅

---

### 8. ASSEMBLY AGENT INCONSISTENCIES

#### The Problem
Assembly phase agents (1-8) have multiple issues:

**Issue 8a: Routing Pattern Inconsistency**

| Agent | Routing | Status |
|-------|---------|--------|
| Profile Builder v1.0 | `SwitchAgent(target: "Build Coordinator")` | ❌ Old |
| Skills Curator v1.0 | "DO NOT call ChangeAgent - just update cv_assembly_state.json and exit" | ❌ Unclear |
| Integrity Checker v1.0 | `SwitchAgent(target: "Build Coordinator")` | ❌ Old |
| Style Negotiator | (Not provided) | ? |
| History Formatter | (Not provided) | ? |
| Credentials Formatter | (Not provided) | ? |
| CoverLetter Writer | (Not provided) | ? |
| Style Reviewer | `SwitchAgent(target: "Build Coordinator")` | ❌ Old |

**Issue 8b: Missing Routing to Assembly Coordinator**
The handover says Assembly Coordinator routes to phase agents and back. But agents routing back shows confusion:
- Some use `SwitchAgent` to "Build Coordinator" (wrong)
- One says "DO NOT call ChangeAgent" (wrong)
- None show routing back to Assembly Coordinator

**Issue 8c: Phase State Management Unclear**
- How does Phase 1 update `current_phase` to 2?
- How does Assembly Coordinator know when to route to Phase 2?
- How does Phase 8 signal completion back to Main Orchestrator?

**Issue 8d: Turn-Based Completion Pattern Missing**
None of the assembly agents show the required turn-based pattern from Analyst v1.6.

#### Fix Required
All assembly agents must:
1. Change routing from `SwitchAgent` to `ChangeAgent`
2. Route back to Assembly Coordinator (not "Build Coordinator")
3. Follow turn-based completion pattern
4. Properly update `current_phase` in cv_assembly_state.json
5. Pass correct context back to Assembly Coordinator

---

### 9. ASSEMBLY COORDINATOR ROLE — ✅ RESOLVED

#### Status: FOUND
Assembly Coordinator v3.0 instructions were located and saved to:
```
/general/instructions/assembly_coordinator_agent_instructions.md
```

**What It Does (Correctly):**
- ✅ Routes to phase agents (1-8) based on current_phase in cv_assembly_state.json
- ✅ Handles all 3 exception types (ROUTING_INTERVENTION, INTEGRITY_FAILED, STYLE_FAILED)
- ✅ Implements state invalidation matrix correctly
- ✅ Finalizes CV assembly and returns to Main Orchestrator
- ✅ Uses ChangeAgent routing
- ✅ Uses turn-based completion pattern
- ✅ Implements user confirmation for exceptions

**Minor Improvements Suggested:**
- Add defensive coding for missing phase data (Phase 3 completion)
- Add validation that phase agents updated state correctly
- Clarify expected interface from phase agents

See ASSEMBLY_COORDINATOR_ASSESSMENT.md for detailed review.

---

### 10. STATE FILE STRUCTURE UNCLEAR FOR ASSEMBLY PHASE

#### The Problem
The handover specifies `cv_assembly_state.json` structure but it's not in the repository. The actual format agents expect is unclear.

**What we know from assembly agent instructions:**

Profile Builder expects:
```javascript
cvState.sections.style_negotiation.data.agreed_overrides
```

Skills Curator expects to update:
```javascript
cvState.current_phase
cvState.sections.[phase_name]
```

But the full schema isn't documented.

#### Fix Required
Create and document cv_assembly_state.json schema:

```json
{
  "current_phase": 1,
  "metadata": {
    "createdAt": "...",
    "lastUpdated": "...",
    "completed_sections": 0
  },
  "sections": {
    "style_negotiation": {
      "status": "PENDING|COMPLETE",
      "data": { ... }
    },
    "profile_builder": {
      "status": "PENDING|COMPLETE",
      "data": { ... }
    },
    ...
  }
}
```

Include this schema in ProjectSetup v1.5.

---

## Summary Table: What Needs Fixing

| Issue | Severity | Status | Fix Effort |
|-------|----------|--------|-----------|
| File naming (user_profile → candidate_profile) | CRITICAL | ⏳ TODO | HIGH |
| File naming (cv_construction → cv_assembly) | CRITICAL | ⏳ TODO | HIGH |
| Routing tool (SwitchAgent ↔ ChangeAgent) | CRITICAL | ✅ FALSE ALARM | 0 |
| Execution pattern (Auto → Turn-Based) | HIGH | ⏳ TODO | MEDIUM |
| Context passing standardization | MEDIUM | ⏳ TODO | LOW |
| Critical rules documentation | MEDIUM | ⏳ TODO | LOW |
| REVIEW_FAILED gate implementation | HIGH | ⏳ TODO | MEDIUM |
| Global variable routing logic | HIGH | ✅ NOT NEEDED | 0 |
| Assembly agent routing patterns | MEDIUM | ⏳ TODO (simpler now) | MEDIUM |
| Assembly Coordinator documentation | CRITICAL | ✅ FOUND | 0 |
| cv_assembly_state.json schema | MEDIUM | ⏳ TODO | LOW |

**Status Summary:**
- ✅ **3 Critical Issues RESOLVED** (no work needed)
- ⏳ **8 Issues Remaining** (but significantly simplified)

---

## Recommended Fix Order

1. **Fix Main Orchestrator v2.9 → v3.0** (highest impact)
   - Add two-switch routing logic
   - Replace SwitchAgent with ChangeAgent
   - Implement REVIEW_FAILED gate properly
   - Add global variable handling

2. **Fix ProjectSetup v1.5** (blocks all other agents)
   - Rename cv_construction_state → cv_assembly_state
   - Rename user_profile → candidate_profile
   - Add cv_assembly_state.json schema initialization
   - Replace SwitchAgent with ChangeAgent
   - Add turn-based completion pattern

3. **Fix Extractor v1.6** (blocks pipeline)
   - Rename user_profile → candidate_profile
   - Replace SwitchAgent with ChangeAgent
   - Add turn-based completion pattern

4. **Fix Researcher v1.4** (blocks JD Enhancer)
   - Replace SwitchAgent with ChangeAgent
   - Add turn-based completion pattern

5. **Create/Update Assembly Coordinator v3.0** (blocks all assembly)
   - Complete routing logic
   - Exception handling
   - State invalidation matrix implementation

6. **Fix all 8 Assembly Agents** (in parallel)
   - Use candidate_profile.json and cv_assembly_state.json
   - Replace SwitchAgent with ChangeAgent back to Assembly Coordinator
   - Add turn-based completion pattern
   - Implement proper phase state management

7. **Add Critical Rules section** to all agents (can be done in parallel with above)

---

**Total Work:** ~40-60 hours for complete reconciliation
**Risk:** VERY HIGH if not done before testing on KEMU platform

