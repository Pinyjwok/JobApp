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
  reviewerGapState:     null,
  researchPartial:      false,
  pipelineStatus:       null,
  recentlyDispatched:   new Map(),
  pendingTADispatch:    false,
  // assembly sequential state
  currentAssemblyPhase: 0,
  snState:              null, // 'modal' | null — single-fire SN modal interview
  awaitingRevision:     null,
  // watchdog / stall recovery
  lastDispatch:         null, // { nodeName, agentName, query, sessionId } — last node round-trip (debug)
  retryThunk:           null, // () => re-fire the last dispatch — invoked by the stall Retry button
};
