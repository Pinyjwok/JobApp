// Dev-mode gate (UI-04). Developer-only affordances — workspace inspector, agent timeline, the
// pipeline-status override, and the KEMU inject toggle — must not reach a real job-seeker. They stay
// on in the Vite dev server (so the pipeline author keeps them), and in a production build only when
// explicitly opted in via `?dev` (persisted) or localStorage.
//
//   • `npm run dev`            → DEV true  (author keeps tooling)
//   • prod build, normal user  → DEV false (clean product)
//   • prod build + ?dev=1       → DEV true, remembered; ?dev=0 clears it
function resolveDev() {
  if (typeof window === 'undefined') return false;
  let stored = null;
  try { stored = localStorage.getItem('jobapp_dev'); } catch { /* private mode */ }

  const params = new URLSearchParams(window.location.search);
  if (params.has('dev')) {
    const on = params.get('dev') !== '0' && params.get('dev') !== 'false';
    try { localStorage.setItem('jobapp_dev', on ? '1' : '0'); } catch { /* ignore */ }
    return on;
  }
  if (stored === '1') return true;
  if (stored === '0') return false;
  return !!import.meta.env?.DEV;
}

// Resolved once at load — dev status doesn't change within a session.
export const DEV = resolveDev();
