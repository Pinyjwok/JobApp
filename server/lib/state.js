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
  snState:              null, // 'modal' | 'summary' | null — single-fire SN modal interview
  awaitingRevision:     null,
};
