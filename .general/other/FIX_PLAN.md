# Fix Plan: Agent Instructions Reconciliation

**Date Created:** 2026-03-17
**Estimated Effort:** 40-50 hours
**Risk Level:** HIGH (fixes must be done before KEMU testing)

---

## Overview

The agent instructions have **file naming and pattern inconsistencies**:

1. **Early Agents** (v1.4-1.6, Feb-early March): Use user_profile.json and cv_construction_state.json
2. **Later Agents** (v1.2-1.6, March 12): Use candidate_profile.json (correct)
3. **Assembly Agents** (v1.0, March 5-11): Mixed naming conventions

**Corrections Applied:**
- ✅ Routing tool terminology (SwitchAgent/ChangeAgent) — NOT AN ISSUE
- ✅ Global variable routing logic — NOT NEEDED (use status-based routing only)
- ✅ Assembly Coordinator v3.0 — FOUND AND SAVED

**Remaining Issues:** 8 real problems with file naming, execution patterns, and documentation

---

## Fix Sequence (Must Follow This Order)

### Phase 1: Core Orchestration (Hours 0-10)

#### Task 1.1: Update Main Orchestrator v2.9 → v3.0 (2-3 hours)
**What:** Update orchestration logic (simplified - no global variables needed)
**Changes:**
- Verify status-based routing switch statement is correct
- Add complete REVIEW_FAILED gate with user choice handling
- Add turn-based completion pattern
- Add critical rules section
- Verify routing table matches: FILES_SAVED → INITIALIZED → RESEARCH_COMPLETE → JD_ENHANCED → ANALYSIS_COMPLETE → REVIEW_COMPLETE → TONE_ANALYZED → CV_BUILDING/CV_TAILORED

**Files to Update:**
- `/general/instructions/main_orchestrator_agent_instructions.md`

**Reference:**
- Current v2.9 in `/general/instructions/main_orchestrator_agent_instructions.md`
- Handover Section 2 (Architecture), Section 6 (REVIEW_FAILED Handling)
- Analyst v1.6 for turn-based pattern example

**Validation:**
- ✓ Status-based routing uses simple switch statement (no global variables)
- ✓ REVIEW_FAILED handling shows user choice options
- ✓ Tone Analyst just updates status (no SetGlobalVariable needed)
- ✓ Assembly Coordinator triggered by CV_BUILDING status
- ✓ Completion pattern matches Analyst v1.6
- ✓ No global variable logic needed

#### Task 1.2: Verify Tone Analyst v1.1 Sets Global Variable (0.5 hours)
**What:** Check if Tone Analyst properly sets Tone_Analysed = 1
**Changes Needed (if missing):**
```javascript
SetGlobalVariable("Tone_Analysed", 1)
```

**Files to Check:**
- `/general/instructions/tone_analyst_agent_instructions.md`

---

### Phase 2: First Worker Agents (Hours 10-13)

#### Task 2.1: Update ProjectSetup v1.5 (2-3 hours)
**What:** Fix file naming and routing
**Changes:**
- Rename file: `user_profile.json` → `candidate_profile.json` (everywhere)
- Rename file: `cv_construction_state.json` → `cv_assembly_state.json` (everywhere)
- Replace `SwitchAgent` with `ChangeAgent`
- Add turn-based completion pattern (after file initialization)
- Add cv_assembly_state.json schema initialization
- Add critical rules section
- Update comments/references to use new file names

**Files to Update:**
- `/general/instructions/project_setup_agent_instructions.md`

**Reference:**
- Current v1.5 in `/general/instructions/project_setup_agent_instructions.md`
- Analyst v1.6 for turn-based pattern
- Handover Section 5 (File Structure) for cv_assembly_state.json schema

**Validation:**
- ✓ No references to user_profile.json
- ✓ No references to cv_construction_state.json
- ✓ cv_assembly_state.json initialized with correct schema
- ✓ ChangeAgent called with correct context
- ✓ Completion pattern matches Analyst v1.6

#### Task 2.2: Update Extractor v1.6 (1 hour)
**What:** Fix file naming and routing
**Changes:**
- Change output: `user_profile.json` → `candidate_profile.json`
- Replace `SwitchAgent` with `ChangeAgent`
- Add turn-based completion pattern
- Update all references in documentation

**Files to Update:**
- `/general/instructions/extractor_agent_instructions.md`

**Validation:**
- ✓ No references to user_profile.json
- ✓ ChangeAgent used for routing
- ✓ Completion pattern matches Analyst v1.6

---

### Phase 3: Middle Pipeline Agents (Hours 13-14)

#### Task 3.1: Update Researcher v1.4 (1 hour)
**What:** Fix routing
**Changes:**
- Replace `SwitchAgent` with `ChangeAgent`
- Add turn-based completion pattern
- Add critical rules section

**Files to Update:**
- `/general/instructions/researcher_agent_instructions.md`

**Validation:**
- ✓ ChangeAgent used for routing
- ✓ Completion pattern matches Analyst v1.6

---

### Phase 4: Assembly Coordinator — ✅ COMPLETED

#### Task 4.1: ✅ Assembly Coordinator v3.0 FOUND (0 hours)
**Status:** RESOLVED

Assembly Coordinator v3.0 was located and is now saved at:
```
/general/instructions/assembly_coordinator_agent_instructions.md
```

**What It Already Does:**
- ✅ Routes between CV assembly phases (1-8)
- ✅ Handles all exceptions (ROUTING_INTERVENTION, INTEGRITY_FAILED, STYLE_FAILED)
- ✅ Implements state invalidation matrix
- ✅ Completes CV assembly and returns to Main Orchestrator
- ✅ Uses ChangeAgent (not SwitchAgent)
- ✅ Uses turn-based completion pattern
- ✅ Uses bare filenames and JSON.stringify()

**Minor Improvements Identified (Optional):**
- Add defensive coding for missing phase data in completion (Phase 3)
- Add validation that phase agents properly updated state
- Clarify expected interface from phase agents

See ASSEMBLY_COORDINATOR_ASSESSMENT.md for full review.

**Impact:** This eliminates the 6-8 hour blocker from the fix plan. Total effort reduced by 8 hours.

---

### Phase 5: Assembly Phase Agents (Hours 22-40)

#### Task 5.1-5.8: Update/Create 8 Assembly Phase Agents (1-2 hours each)

**Common Changes for All Assembly Agents:**
- File naming: `user_profile.json` → `candidate_profile.json`
- File naming: `cv_construction_state.json` → `cv_assembly_state.json`
- Routing: `SwitchAgent` → `ChangeAgent` (to Assembly Coordinator)
- Add turn-based completion pattern
- Add critical rules section
- Fix context object structure
- Verify phase state management (increment current_phase)

**Assembly Agent Phases:**

| Phase | Agent | Status | Changes |
|-------|-------|--------|---------|
| 1 | Style Negotiator | Not provided | Create from template |
| 2 | Profile Builder | v1.0 exists | Update existing |
| 3 | Skills Curator | v1.0 exists | Update existing |
| 4 | History Formatter | Not provided | Create from template |
| 5 | Credentials Formatter | Not provided | Create from template |
| 6 | CoverLetter Writer | Not provided | Create from template |
| 7 | Style Reviewer | v1.0 exists | Update existing |
| 8 | Integrity Checker | v1.0 exists | Update existing |

**For "Update Existing" Agents:**
1. Read current version
2. Apply common changes above
3. Verify against template in `/CLAUDE.md`
4. Test phase state transitions

**For "Create from Template" Agents:**
1. Copy template from `/CLAUDE.md` (Phase Agent Template section)
2. Fill in role-specific details
3. Implement Execution Protocol
4. Add phase-specific rules

**Files to Update/Create:**
```
/general/instructions/style_negotiator_instructions.md        [CREATE]
/general/instructions/profile_builder_instructions.md         [UPDATE]
/general/instructions/skills_curator_agent_instructions.md    [UPDATE]
/general/instructions/history_formatter_instructions.md       [CREATE]
/general/instructions/credentials_formatter_instructions.md   [CREATE]
/general/instructions/coverletter_writer_instructions.md      [CREATE]
/general/instructions/style_reviewer_agent_instructions.md    [UPDATE]
/general/instructions/integrity_checker_agent_instructions.md [UPDATE]
```

**Validation for Each Agent:**
- ✓ No user_profile.json references
- ✓ No cv_construction_state.json references
- ✓ ChangeAgent used to route back to Assembly Coordinator
- ✓ current_phase incremented in cv_assembly_state.json
- ✓ Completion pattern matches Analyst v1.6
- ✓ Critical rules section present
- ✓ Context object properly passed/received

---

### Phase 6: Standardization & Documentation (Hours 40-45)

#### Task 6.1: Add Critical Rules Section to Agents Missing It (1.5 hours)
**Agents that need this section added:**
- Main Orchestrator v3.0 (new in Task 1.1)
- ProjectSetup v1.5 (in Task 2.1)
- Researcher v1.4 (in Task 3.1)

**Template:**
```markdown
## ⚠️ CRITICAL RULES

[Copy from critical_rules.md in memory system]
```

#### Task 6.2: Update Handover Document (1 hour)
**What:** Update `/general/handover.md` with:
- New version numbers after updates
- Update file reference paths if they changed
- Add note about fixes applied

#### Task 6.3: Update CLAUDE.md (1 hour)
**What:** Update `/CLAUDE.md` with:
- Verify all examples use new file names
- Verify all examples use ChangeAgent
- Verify all examples follow turn-based pattern

#### Task 6.4: Verify All Agent Instructions Exist (0.5 hours)
**Validation:**
- ✓ All 15 agents have instruction files in `/general/instructions/`
- ✓ All instructions in CLAUDE.md match filenames in directory
- ✓ No version numbers in filenames
- ✓ Consistent naming convention (agent_name_instructions.md)

---

## Testing Strategy (Hours 45-50)

### Unit Testing
```bash
For each agent:
  1. Verify JSON schema valid
  2. Verify no syntax errors
  3. Verify file names are clean (no slashes)
```

### Integration Testing
```
1. Main Orchestrator routing:
   - Upload files → ProjectSetup
   - FILES_SAVED → Extractor
   - INITIALIZED → Researcher
   - ... continue to Tone Analyst
   - TONE_ANALYZED → Assembly Coordinator ✓

2. Assembly routing:
   - Tone_Analysed=1 → Assembly Coordinator
   - current_phase=1 → Style Negotiator
   - current_phase=2 → Profile Builder
   - ... continue through Phase 8
   - Complete → Main Orchestrator ✓

3. REVIEW_FAILED gate:
   - Reviewer returns REVIEW_FAILED
   - Show options to user
   - User chooses "redo analyst"
   - Status reset to JD_ENHANCED
   - Route to Analyst ✓

4. State management:
   - After each agent: cv_assembly_state.json valid
   - current_phase incremented correctly
   - Phase data properly stored
```

---

## Checklist: Before Starting

- [ ] All team members aware of timeline (40-50 hours)
- [ ] No new agent code being written until fixes complete
- [ ] Access to KEMU platform for testing after fixes
- [ ] Backup of current instructions (git commit or snapshot)
- [ ] Agreement on fix sequence (don't skip phases)

## Risk Mitigation

**Risk: Fixes break something that was working**
- Mitigation: Git commit before each task, can revert if needed

**Risk: Assembly Coordinator v3.0 is complex**
- Mitigation: Create early (Phase 4), test thoroughly, iterate

**Risk: Agents have subtle interdependencies**
- Mitigation: Test each fix immediately, don't batch too many changes

**Risk: Platform API changes between v2.9 and v3.0**
- Mitigation: Test with one agent first (ProjectSetup), verify routing works before fixing others

---

## Success Criteria

✓ All agents use ChangeAgent (not SwitchAgent)
✓ All agents use candidate_profile.json (not user_profile.json)
✓ All agents use cv_assembly_state.json (not cv_construction_state.json)
✓ All agents follow turn-based completion pattern
✓ All agents have critical rules section
✓ Main Orchestrator implements two-switch routing with global variables
✓ REVIEW_FAILED gate allows user to retry earlier phases
✓ Assembly Coordinator routes through all 8 phases
✓ All assembly agents route back to Assembly Coordinator
✓ Integration test: Full pipeline executes without errors
✓ All files created at root level (no subdirectories)

---

## Timeline Estimate

| Phase | Hours | Days | Status |
|-------|-------|------|--------|
| 1. Core Orchestration | 2-3 | 0.3 | ⏳ TODO (simplified) |
| 2. Early Workers | 3 | 0.5 | ⏳ TODO |
| 3. Middle Pipeline | 1 | 0.2 | ⏳ TODO |
| 4. Assembly Coordinator | 0 | 0 | ✅ DONE |
| 5. Assembly Agents (8 × 1-1.5) | 10 | 1.5 | ⏳ TODO |
| 6. Standardization | 2.5 | 0.3 | ⏳ TODO |
| 7. Testing | 3 | 0.5 | ⏳ TODO |
| **TOTAL** | **21.5-22.5** | **3-4 days** | 54% reduction |

(Assumes focused, uninterrupted work)

**Reduction Summary:**
- Assembly Coordinator v3.0 found: -8 hours
- No global variable logic needed: -6 hours
- No SwitchAgent/ChangeAgent replacement needed: -4 hours
- Simplified Main Orchestrator task: -4 hours

**Original estimate: 45.5 hours → Current estimate: 21.5-22.5 hours (53% reduction)**

