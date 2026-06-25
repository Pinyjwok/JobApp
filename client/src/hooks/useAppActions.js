import { confirmDialog } from '../lib/toast';

const WELCOME_MESSAGE = {
  role: 'agent',
  agent: 'JobApp',
  text: `Got your documents — thanks. I'm starting on the analysis now, I'll walk you through each step and check in with you along the way.`,
};

// All user/server actions for a run (UI-09): message send, the three interview submits, assembly
// revise/cancel, file upload, abort/reset, the dev status override, and the start/resume flows. Each
// is a thin wrapper over /api/* that reads from `run` (state) and `modal` (which dialog to close).
// Pulled out of App.jsx so the component is just composition + render.
export function useAppActions(run, modal) {
  const {
    setMessages, saveHistory, setStatus, setActiveAgent, setTurns,
    setLastUserMessage, setSending, setIsWaiting, setPipelineMode,
    setUploadedFiles, pushSystem,
  } = run;

  async function handleSend(text) {
    setLastUserMessage(text);
    setMessages((prev) => {
      const next = [...prev, { role: 'user', text }];
      saveHistory(next);
      return next;
    });
    setSending(true);
    setIsWaiting(true);
    setPipelineMode('auto_running');
    try {
      await fetch('/api/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
    } catch (err) {
      pushSystem(`Error: ${err.message}`);
    } finally {
      setSending(false);
    }
  }

  async function handleModalStart(cvFile, jdFile, clFile = null) {
    modal.setModalUploading(true);

    // Full clear: a new session must not inherit ANY prior files — including a stale
    // cover_letter_sample.txt, which would otherwise survive and bleed into the run.
    await fetch('/api/reset?full=1', { method: 'POST' }).catch(() => {});

    const uploadFile = async (file, target) => {
      const body = await file.arrayBuffer();
      await fetch(`/api/upload?target=${target}&filename=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body,
      });
    };
    await uploadFile(cvFile, 'cv_raw');
    await uploadFile(jdFile, 'jd_raw');
    if (clFile) await uploadFile(clFile, 'cover_letter_sample');

    setStatus(null);
    setActiveAgent('ProjectSetup');
    setTurns([{ agent: 'ProjectSetup', timestamp: Date.now(), cost: null }]);
    setLastUserMessage(null);
    setUploadedFiles({ cv_raw: cvFile.name, jd_raw: jdFile.name, ...(clFile ? { cover_letter_sample: clFile.name } : {}) });
    setPipelineMode('user_turn');
    const initial = [WELCOME_MESSAGE];
    setMessages(initial);
    saveHistory(initial);
    modal.setModalUploading(false);
    modal.setModalState('hidden');

    await handleSend('Files are saved to disk as cv_raw.txt and jd_raw.txt. Please initialise the project.');
  }

  function handleModalResume() {
    setMessages(modal.historyForModal);
    modal.setModalState('hidden');
    fetch('/api/status')
      .then((r) => r.json())
      .then((d) => { if (d.status) setStatus(d.status); })
      .catch(() => {});
    // Reopen any interview the pipeline is still blocked on — these modals are driven by one-shot
    // SSE events that won't replay on reconnect, so a reload would otherwise strand the run.
    fetch('/api/pending-interview')
      .then((r) => r.json())
      .then((d) => {
        modal.applyPending(d, {
          // The Approve/Revise bubble is normally restored from chat history. Only ask the server to
          // re-emit it if the restored history doesn't already end with a live (unused) section-review
          // actions bubble — avoids stacking a duplicate on a normal reload.
          requestSectionReview: () => {
            const last = [...modal.historyForModal].reverse().find((m) => m.role === 'actions');
            const hasLive = last && !last.used && last.context === 'assembly_section_review';
            if (!hasLive) {
              fetch('/api/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: 'resume_section_review' }),
              }).catch(() => {});
            }
          },
        });
      })
      .catch(() => {});
  }

  // Mark all live (unused) action bubbles as used — they've been answered.
  const consumeActions = () =>
    setMessages((prev) => prev.map((m) => (m.role === 'actions' && !m.used ? { ...m, used: true } : m)));

  async function handleAction(id) {
    // 'Start a new application' (completion screen) is a pure client reset — reuse the New-session flow.
    if (id === 'start_over') { handleReset(); return; }
    // 'Revise…' is reversible (opens a modal you can Cancel out of), so leave the section-review
    // buttons live — don't grey them. They're disabled on submit instead (handleReviseSubmit).
    if (id !== 'assembly_revise') consumeActions();
    try {
      await fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
    } catch (err) {
      pushSystem(`Action failed: ${err.message}`);
    }
  }

  async function handleGapSubmit(answers) {
    modal.setShowGapModal(false);
    modal.setGapMinimized(false);
    try {
      await fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'gap_answers_submit', answers }),
      });
    } catch (err) {
      pushSystem(`Gap submit failed: ${err.message}`);
    }
  }

  async function handleStyleSubmit(answers) {
    try {
      await fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'style_answers_submit', answers }),
      });
      // Only dismiss once the submit lands — keep the modal (and answers) on failure.
      modal.setShowStyleModal(false);
      modal.setStyleMinimized(false);
    } catch (err) {
      pushSystem(`Style submit failed: ${err.message}`);
    }
  }

  async function handleIcSubmit(decisions) {
    try {
      await fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'ic_remediation_submit', decisions }),
      });
      // Only dismiss once the submit lands — keep the modal (and choices) on failure.
      modal.setShowIcModal(false);
      modal.setIcMinimized(false);
      setPipelineMode('auto_running');
    } catch (err) {
      pushSystem(`Accuracy submit failed: ${err.message}`);
    }
  }

  async function handleReviseSubmit(text) {
    modal.setReviseAgent(null);
    // Now the revise is committed — disable the section-review buttons (a fresh review bubble
    // appears once the agent finishes revising).
    consumeActions();
    try {
      await fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'assembly_revise_submit', text }),
      });
    } catch (err) {
      pushSystem(`Revision failed: ${err.message}`);
    }
  }

  async function handleReviseCancel() {
    modal.setReviseAgent(null);
    // Server clears awaitingRevision and re-shows the Approve/Revise buttons for this section.
    try {
      await fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'assembly_revise_cancel' }),
      });
    } catch { /* best-effort — buttons just won't restore */ }
  }

  async function handleUpload(name, fileObj, forcedTarget = null) {
    let target;
    if (forcedTarget) {
      target = forcedTarget;
    } else {
      const lower = name.toLowerCase();
      if (lower.includes('cover') || lower.includes('cl_') || lower.includes('_cl')) {
        target = 'cover_letter_sample';
      } else if (lower.includes('cv') || lower.includes('resume')) {
        target = 'cv_raw';
      } else if (lower.includes('jd') || lower.includes('job')) {
        target = 'jd_raw';
      } else {
        const choice = prompt(`What is "${name}"? Type "cv", "jd", or "cover":`);
        if (choice?.toLowerCase().startsWith('cv')) target = 'cv_raw';
        else if (choice?.toLowerCase().startsWith('jd')) target = 'jd_raw';
        else if (choice?.toLowerCase().startsWith('cover')) target = 'cover_letter_sample';
        else return;
      }
    }

    try {
      const body = await fileObj.arrayBuffer();
      await fetch(`/api/upload?target=${target}&filename=${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body,
      });
      setMessages((prev) => [...prev, { role: 'user', text: `Uploaded ${name} → ${target}.txt` }]);
      setUploadedFiles((prev) => ({ ...prev, [target]: name }));
      if (target === 'cover_letter_sample') {
        await handleSend('Cover letter uploaded — please proceed with the analysis.');
      }
    } catch (err) {
      pushSystem(`Upload failed: ${err.message}`);
    }
  }

  // The Approve/Revise / re-validate upload buttons inside chat bubbles route here.
  async function handleSectionUpload(actionId, file) {
    if (actionId === 'ta_upload_cover') {
      consumeActions();
      try {
        const body = await file.arrayBuffer();
        await fetch(`/api/upload?target=cover_letter_sample&filename=${encodeURIComponent(file.name)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body,
        });
        setMessages((prev) => [...prev, { role: 'user', text: `Uploaded ${file.name} → cover_letter_sample.txt` }]);
        setUploadedFiles((prev) => ({ ...prev, cover_letter_sample: file.name }));
        await fetch('/api/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: 'ta_upload_cover' }),
        });
      } catch (err) {
        pushSystem(`Upload failed: ${err.message}`);
      }
    } else if (actionId === 'cv_revalidate_upload' || actionId === 'jd_revalidate_upload') {
      consumeActions();
      const target = actionId === 'cv_revalidate_upload' ? 'cv_raw' : 'jd_raw';
      await handleUpload(file.name, file, target);
      await handleSend('Files are saved to disk as cv_raw.txt and jd_raw.txt. Please initialise the project.');
    }
  }

  async function handleAbort() {
    await fetch('/api/abort', { method: 'POST' }).catch(() => {});
    setSending(false);
    setIsWaiting(false);
    setPipelineMode('user_turn');
    pushSystem('⏹ Processing aborted.');
  }

  async function handleReset() {
    const ok = await confirmDialog({
      title: 'Start a new session?',
      message: 'This clears the current workspace and conversation.',
      confirmLabel: 'Start new',
      danger: true,
    });
    if (!ok) return;
    await fetch('/api/reset?full=1', { method: 'POST' }).catch(() => {});
    setMessages([]);
    setStatus(null);
    setActiveAgent('Main Orchestrator');
    setTurns([]);
    setLastUserMessage(null);
    setUploadedFiles({});
    setPipelineMode('user_turn');
    modal.setModalUploading(false);
    modal.setHistoryForModal([]);
    modal.setModalState('pending');
  }

  async function handleSetStatus(s) {
    if (!s) return;
    modal.setShowStatusMenu(false);
    await fetch('/api/dev/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: s }),
    }).catch(() => {});
    setStatus(s);
  }

  // Dev: jump to and re-fire a specific assembly phase (server /api/dev/phase). Unlike a status
  // override, this actually dispatches the agent — the workspace must already hold the assembly
  // inputs (restore a snapshot first). The run goes auto_running; status/mode arrive over SSE.
  async function handleSetPhase(n) {
    if (!n) return;
    modal.setShowStatusMenu(false);
    setStatus('CV_BUILDING');
    setIsWaiting(true);
    setPipelineMode('auto_running');
    try {
      await fetch('/api/dev/phase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase: n }),
      });
    } catch (err) {
      pushSystem(`Phase jump failed: ${err.message}`);
    }
  }

  return {
    handleSend, handleModalStart, handleModalResume, handleAction,
    handleGapSubmit, handleStyleSubmit, handleIcSubmit,
    handleReviseSubmit, handleReviseCancel, handleUpload, handleSectionUpload,
    handleAbort, handleReset, handleSetStatus, handleSetPhase,
  };
}
