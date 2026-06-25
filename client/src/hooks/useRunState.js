import { useState, useRef, useCallback } from 'react';

// Core run state — the mutable facts the whole app reads/writes during a pipeline run.
// Pulled out of App.jsx (UI-09) so the stream, modal manager, and action handlers can share
// one set of setters instead of one 800-line component owning everything. No SSE / fetch logic
// lives here — just the state and two tiny helpers (saveHistory, pushSystem) everyone needs.
export function useRunState() {
  const [messages, setMessages] = useState([]);
  const [activeAgent, setActiveAgent] = useState(null);
  const [status, setStatus] = useState(null);
  const [sending, setSending] = useState(false);
  const [lastUserMessage, setLastUserMessage] = useState(null);
  const [turns, setTurns] = useState([]);
  const [pipelineMode, setPipelineMode] = useState('user_turn');
  const [runningAgent, setRunningAgent] = useState(null);
  const [uploadedFiles, setUploadedFiles] = useState({});

  // isWaiting has a ref mirror so the SSE watchdog can read the live value without re-subscribing.
  const [isWaiting, _setIsWaiting] = useState(false);
  const isWaitingRef = useRef(false);
  const setIsWaiting = useCallback((v) => { isWaitingRef.current = v; _setIsWaiting(v); }, []);

  // Persist the conversation to disk, stripping transient render-only flags.
  const saveHistory = useCallback((msgs) => {
    const clean = msgs.map((m) => {
      const rest = { ...m };
      delete rest.streaming;
      delete rest.stalled;
      return rest;
    });
    fetch('/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(clean),
    }).catch(() => {});
  }, []);

  // Append a System bubble — the shared "something failed" surface used by every action handler.
  const pushSystem = useCallback(
    (text) => setMessages((prev) => [...prev, { role: 'agent', agent: 'System', text }]),
    [],
  );

  return {
    messages, setMessages,
    activeAgent, setActiveAgent,
    status, setStatus,
    sending, setSending,
    lastUserMessage, setLastUserMessage,
    turns, setTurns,
    isWaiting, setIsWaiting, isWaitingRef,
    pipelineMode, setPipelineMode,
    runningAgent, setRunningAgent,
    uploadedFiles, setUploadedFiles,
    saveHistory, pushSystem,
  };
}
