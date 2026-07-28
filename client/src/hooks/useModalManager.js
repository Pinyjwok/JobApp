import { useState, useEffect, useCallback } from 'react';

// Owns every modal / side-panel the app can show (UI-09): the three interviews (gap / style /
// integrity) with their data + minimize flags, the assembly revision modal, the StartModal, and the
// dev panels (timeline / inspector / status menu). It also owns `applyPending` — the single mapping
// from a /api/pending-interview response to the right open call, reused by both the reconnect resync
// and the returning-user resume flow so they can't drift apart.
//
// Depends only on `run` (for setPipelineMode), so it sits below useRunState and above the stream in
// the dependency order — no circular wiring.
export function useModalManager(run) {
  const { setPipelineMode } = run;

  // Interviews
  const [gapQuestions, setGapQuestions] = useState([]);
  const [gapAccepted, setGapAccepted] = useState([]); // accepted-claim ack strip (round ≥2)
  const [showGapModal, setShowGapModal] = useState(false);
  const [gapMinimized, setGapMinimized] = useState(false);

  const [styleGroups, setStyleGroups] = useState([]);
  const [showStyleModal, setShowStyleModal] = useState(false);
  const [styleMinimized, setStyleMinimized] = useState(false);

  const [icClaims, setIcClaims] = useState([]); // integrity-check flagged claims
  const [showIcModal, setShowIcModal] = useState(false);
  const [icMinimized, setIcMinimized] = useState(false);

  const [reviseAgent, setReviseAgent] = useState(null); // assembly section being revised; null = closed

  // Dev panels
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const [inspectorRefresh, setInspectorRefresh] = useState(0);

  // Start / resume modal
  const [modalState, setModalState] = useState(null);
  const [modalUploading, setModalUploading] = useState(false);
  const [historyForModal, setHistoryForModal] = useState([]);
  const [sessionMeta, setSessionMeta] = useState(null);

  // On first load, fetch saved history + session meta, then open the StartModal.
  useEffect(() => {
    Promise.all([
      fetch('/api/history').then((r) => r.json()).catch(() => []),
      fetch('/api/session-meta').then((r) => r.json()).catch(() => null),
    ])
      .then(([saved, meta]) => {
        setHistoryForModal(saved);
        setSessionMeta(meta);
        setModalState('pending');
      })
      .catch(() => setModalState('pending'));
  }, []);

  // Open helpers — pipeline-neutral on purpose. The SSE *_start events open a modal WITHOUT locking
  // input (the pipeline is mid-flight and will gate itself); only the resync/resume path locks via
  // applyPending. Keeping that split here preserves the pre-refactor behaviour exactly.
  const openGap = useCallback((gaps, accepted, { delay = 0 } = {}) => {
    setGapQuestions(gaps ?? []);
    setGapAccepted(accepted ?? []);
    setGapMinimized(false);
    if (delay) setTimeout(() => setShowGapModal(true), delay);
    else setShowGapModal(true);
  }, []);

  const openStyle = useCallback((groups) => {
    setStyleGroups(groups ?? []);
    setStyleMinimized(false);
    setShowStyleModal(true);
  }, []);

  const openIc = useCallback((claims, { delay = 0 } = {}) => {
    setIcClaims(claims ?? []);
    setIcMinimized(false);
    if (delay) setTimeout(() => setShowIcModal(true), delay);
    else setShowIcModal(true);
  }, []);

  const openRevise = useCallback((agent) => {
    setReviseAgent(agent ?? 'section');
  }, []);

  const bumpInspector = useCallback(() => setInspectorRefresh((n) => n + 1), []);

  // Map a /api/pending-interview payload onto the right modal. `guardOpen` skips types already shown
  // (reconnect path); the resume path passes guardOpen=false and also restores a stranded section
  // review. `requestSectionReview` lets the resume flow re-emit the Approve/Revise bubble when needed.
  const applyPending = useCallback((d, { guardOpen = false, requestSectionReview } = {}) => {
    if (d.type === 'gap' && d.gaps?.length && !(guardOpen && showGapModal)) {
      openGap(d.gaps, d.accepted ?? []);
      setPipelineMode('action_required');
    } else if (d.type === 'style' && d.groups?.length && !(guardOpen && showStyleModal)) {
      openStyle(d.groups);
      setPipelineMode('action_required');
    } else if (d.type === 'integrity' && d.claims?.length && !(guardOpen && showIcModal)) {
      openIc(d.claims);
      setPipelineMode('action_required');
    } else if (d.type === 'revise' && d.agent && !(guardOpen && reviseAgent)) {
      openRevise(d.agent);
      setPipelineMode('action_required');
    } else if (d.type === 'section_review' && requestSectionReview) {
      setPipelineMode('action_required');
      requestSectionReview();
    }
  }, [openGap, openStyle, openIc, openRevise, setPipelineMode, showGapModal, showStyleModal, showIcModal, reviseAgent]);

  return {
    // interview state
    gapQuestions, gapAccepted, showGapModal, gapMinimized, setShowGapModal, setGapMinimized,
    styleGroups, showStyleModal, styleMinimized, setShowStyleModal, setStyleMinimized,
    icClaims, showIcModal, icMinimized, setShowIcModal, setIcMinimized,
    reviseAgent, setReviseAgent,
    // dev panels
    showStatusMenu, setShowStatusMenu,
    showTimeline, setShowTimeline,
    showInspector, setShowInspector,
    inspectorRefresh, bumpInspector,
    // start/resume
    modalState, setModalState, modalUploading, setModalUploading,
    historyForModal, setHistoryForModal, sessionMeta,
    // openers
    openGap, openStyle, openIc, openRevise, applyPending,
  };
}
