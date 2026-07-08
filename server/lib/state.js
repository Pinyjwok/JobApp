// Single shared mutable state object — imported by all lib modules and routes.
// ES module singleton: every importer gets the same reference.
export const state = {
  sseClients:           new Set(),
  recipe:               null,
  DataType:             null,
  fallbackAgent:        null,
  analystDone:          false,
  taDone:               false,
  analystOutputText:    null,
  analystValidatorSummary: null, // compact analyst_validator verdict line, surfaced in checkJoin
  reviewerGapState:     null,
  // gap-interview adjudication loop (2-round cap)
  gapRound:             1,    // 1 = first pass, 2 = re-ask of non-accepted answers
  gapAnswersAccum:      {},   // gap_id -> { answer, verdict, reason, anchor_prompt, tier, gap_text, skipped }
  gapAccepted:          [],   // [{ gap_text, evidence }] — accepted so far, shown as the modal ack strip
  gapPending:           [],   // gap-shaped cards still needing a better answer (for reload reconstruction)
  researchPartial:      false,
  awaitingJDReview:     false, // true while the guided enhanced-JD review gate is open (pre gap analysis)
  speculativeAnalystFired: false, // Analyst fired early at the review gate so its latency hides behind the user's review; consumed by fireTAAndAnalyst at confirm
  pipelineStatus:       null,
  recentlyDispatched:   new Map(),
  pendingTADispatch:    false,
  // assembly sequential state
  currentAssemblyPhase: 0,
  snState:              null, // 'modal' | null — single-fire SN modal interview
  awaitingRevision:     null,
  awaitingSectionReview: null, // { phaseNumber, agent } — section Approve/Revise pending (for resume)
  // integrity-check reject remediation
  icReview:             null, // { claims: [...] } — enriched flagged claims awaiting the integrity-review modal (for reload restore + submit trust model)
  icRemediationRound:   0,    // remediation attempts so far; at the cap the gate falls back to "Use it as-is"
  // watchdog / stall recovery
  lastDispatch:         null, // { nodeName, agentName, query, sessionId } — last node round-trip (debug)
  retryThunk:           null, // () => re-fire the last dispatch — invoked by the stall Retry button
};
