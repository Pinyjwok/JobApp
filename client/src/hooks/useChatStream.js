import { useState, useRef, useEffect, useCallback } from 'react';
import { useStream } from './useStream';

// All SSE handling for a run (UI-09): translates each server event into run-state / modal updates,
// patches late-arriving reasoning onto the right bubble, tracks per-turn cost, and runs the
// stalled-pipeline watchdog. Returns the live connection state for the reconnect banner + resync.
//
// Sits below useRunState + useModalManager in the dependency order: it pushes into both but neither
// depends on it (the connection→resync bridge lives in App).
export function useChatStream(run, modal) {
  const {
    activeAgent, setActiveAgent, setStatus, setMessages, saveHistory,
    setIsWaiting, isWaitingRef, setPipelineMode, setRunningAgent, setTurns,
    pipelineMode,
  } = run;
  const { openGap, openStyle, openIc, openRevise, bumpInspector, setModalState } = modal;

  const [connection, setConnection] = useState('connecting'); // connecting | open | reconnecting | closed
  const pendingReasoningRef = useRef({}); // { [agent]: text }
  const lastActivityRef = useRef(0);
  useEffect(() => { lastActivityRef.current = Date.now(); }, []);

  useStream(
    useCallback((data) => {
      lastActivityRef.current = Date.now();
      if (data.type === 'agent_message') {
        setIsWaiting(false);
        const agentName = data.agent ?? activeAgent;
        const reasoning = pendingReasoningRef.current[agentName] ?? '';
        delete pendingReasoningRef.current[agentName];
        setMessages((prev) => {
          const next = [...prev, {
            role: 'agent',
            agent: agentName,
            text: data.text,
            reasoning,
            background: data.background ?? false,
            analystData: data.analystData ?? null,
            sectionData: data.sectionData ?? null,
            documentData: data.documentData ?? null,
            initialTab: data.initialTab ?? null,
            kind: data.kind ?? null,
            meta: data.meta ?? null,
          }];
          saveHistory(next);
          return next;
        });
        bumpInspector();
        fetch('/api/status')
          .then((r) => r.json())
          .then((d) => setStatus(d.status))
          .catch(() => {});
      } else if (data.type === 'reasoning') {
        pendingReasoningRef.current[data.agent] = data.text;
        // Late-arrival: if the agent_message already landed, patch it in-place
        setMessages((prev) => {
          const idx = [...prev].reverse().findIndex(
            (m) => m.role === 'agent' && m.agent === data.agent && !m.reasoning?.trim()
          );
          if (idx === -1) return prev;
          const realIdx = prev.length - 1 - idx;
          delete pendingReasoningRef.current[data.agent];
          const updated = [...prev];
          updated[realIdx] = { ...updated[realIdx], reasoning: data.text };
          return updated;
        });
      } else if (data.type === 'action_required') {
        setMessages((prev) => {
          const next = [...prev, {
            role: 'actions',
            context: data.context,
            prompt: data.prompt,
            actions: data.actions,
            used: false,
          }];
          saveHistory(next);
          return next;
        });
      } else if (data.type === 'pipeline_mode') {
        setPipelineMode(data.mode);
        if (data.agent) setRunningAgent(data.agent);
        if (data.mode === 'user_turn') setIsWaiting(false);
        // Keep the spinner up while the pipeline is still working. Each assembly section emits an
        // agent_message that clears isWaiting; without this the spinner vanished and never returned
        // between sequential phases. The next phase re-enters auto_running, so re-show it.
        else if (data.mode === 'auto_running') setIsWaiting(true);
      } else if (data.type === 'debug_token') {
        try {
          const debug = JSON.parse(data.chunk);
          if (debug.usage?.cost != null) {
            setTurns((prev) => {
              const idx = [...prev].reverse().findIndex((t) => t.cost == null);
              if (idx === -1) return prev;
              const realIdx = prev.length - 1 - idx;
              const updated = [...prev];
              updated[realIdx] = { ...updated[realIdx], cost: debug.usage.cost };
              return updated;
            });
          }
        } catch { /* non-JSON debug token */ }
      } else if (data.type === 'agent_switch') {
        setActiveAgent(data.agent);
        setTurns((prev) => {
          const last = prev[prev.length - 1];
          if (last?.agent === data.agent && Date.now() - last.timestamp < 2000) return prev;
          return [...prev, { agent: data.agent, timestamp: Date.now(), cost: null }];
        });
      } else if (data.type === 'gap_interview_start') {
        // Let the Analyst-complete bubble land and register visually before the modal
        // eases in over it — avoids the jarring instant hand-off to user control.
        openGap(data.gaps ?? [], data.accepted ?? [], { delay: 650 });
      } else if (data.type === 'style_interview_start') {
        openStyle(data.groups ?? []);
      } else if (data.type === 'integrity_review_start') {
        // Let the "we found a few things" bubble land before the modal eases in over it.
        openIc(data.claims ?? [], { delay: 650 });
      } else if (data.type === 'assembly_revise_start') {
        openRevise(data.agent ?? 'section');
      } else if (data.type === 'status_changed') {
        setStatus(data.status);
      } else if (data.type === 'history_reload') {
        // Snapshot restore swapped the persisted history out from under us — pull the new
        // conversation and replace the rendered messages wholesale.
        fetch('/api/history')
          .then((r) => r.json())
          .then((saved) => { if (Array.isArray(saved)) setMessages(saved); })
          .catch(() => {});
        setModalState('hidden');
      } else if (data.type === 'stream_done') {
        setIsWaiting(false);
        setPipelineMode('user_turn');
      }
    }, [activeAgent, setActiveAgent, setStatus, setMessages, saveHistory, setIsWaiting,
        setPipelineMode, setRunningAgent, setTurns, openGap, openStyle, openIc, openRevise,
        bumpInspector, setModalState]),
    useCallback((state) => setConnection(state), [])
  );

  // Stalled-pipeline watchdog: if we've been auto_running with no SSE traffic for 45s and the server
  // reports an interactive status, hand control back to the user rather than spin forever.
  useEffect(() => {
    const id = setInterval(() => {
      if (pipelineMode !== 'auto_running') return;
      if (Date.now() - lastActivityRef.current <= 45_000) return;
      fetch('/api/status')
        .then((r) => r.json())
        .then((d) => {
          const interactiveStatuses = new Set([
            'REVIEW_COMPLETE', 'STYLE_NEGOTIATING',
            'CV_BUILDING', 'PARALLEL_ANALYSIS',
          ]);
          if (d.status && interactiveStatuses.has(d.status) && !isWaitingRef.current) {
            setIsWaiting(false);
            setPipelineMode('user_turn');
            setMessages((prev) => [...prev, {
              role: 'agent', agent: 'System',
              text: 'Agent may be ready - pipeline is active. Type to continue or click Abort.',
            }]);
          }
          lastActivityRef.current = Date.now();
        })
        .catch(() => {});
    }, 15_000);
    return () => clearInterval(id);
  }, [pipelineMode, isWaitingRef, setIsWaiting, setPipelineMode, setMessages]);

  return { connection, lastActivityRef };
}
