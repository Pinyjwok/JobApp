// Themed toast + confirm (UI-07) — replaces native alert()/confirm(), which broke out of the dark
// theme, ignored light/dark, and blocked the thread. A tiny module-level bus so any component can
// call toast()/confirmDialog() without threading a context through the tree; <Toaster/> (mounted once
// in App) subscribes and renders.
const listeners = new Set();
let seq = 0;

function emit(event) {
  for (const fn of listeners) fn(event);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// toast(message, 'error' | 'success' | 'info')  → transient bottom-right notice.
export function toast(message, type = 'info', ttl = 4000) {
  emit({ kind: 'toast', toast: { id: ++seq, message, type, ttl } });
}

// confirmDialog({ title, message, confirmLabel, danger }) → Promise<boolean>.
// Resolves true on confirm, false on cancel / Esc / backdrop.
export function confirmDialog(opts) {
  return new Promise((resolve) => {
    emit({ kind: 'confirm', confirm: { id: ++seq, resolve, ...opts } });
  });
}
