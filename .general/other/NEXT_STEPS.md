# Next Steps

Last updated: 2026-03-19

---

## Outstanding Issues

### 1. Assembly Coordinator Not Working
- Assembly Coordinator is failing in live KEMU sessions (exact failure mode TBD)
- Needs diagnosis: check routing logic, phase read/write, SwitchAgent calls
- May be related to status not being set to `CV_BUILDING` correctly on re-entry

### 2. Update All Agent Instructions in KEMU
- Local instruction files have been updated but changes need to be pushed/applied inside the KEMU platform
- All 17 agents need their instructions refreshed in KEMU to reflect latest versions
- Priority: Assembly Coordinator + all 8 assembly phase agents

### 3. Optimise Final Output
- Final CV and cover letter output formatting needs review and polish
- Consider: section ordering, spacing, visual hierarchy, ATS compatibility
- Cover letter header/footer assembly needs real-world testing

### 4. Test Assembly Agents for More Consistent Output
- Run full assembly pipeline end-to-end and log results
- Identify which agents produce inconsistent or off-format output
- Focus areas: tone consistency, Australian English compliance, bullet formatting

### 5. Agent Original Documents
- Preserve / archive original (pre-edit) agent instruction documents
- Useful for diffing changes and rolling back if needed
- Consider versioned backup folder: `.general/instructions/archive/`

---

## Recently Completed
- Fixed version title mismatches across all 17 agent instruction files (2026-03-19)
- Added Australian English standard to Critical Rules of all 9 assembly agents (2026-03-19)
- Fixed Cover Letter Writer to use real contact data instead of placeholders (2026-03-19)
