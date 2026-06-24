import { useEffect, useRef } from 'react';

// Accessible modal primitive (UI-02). The interview/revision modals were bare `fixed inset-0` divs:
// no dialog role, no focus trap, no Esc, focus could tab out behind them. This wraps the shared
// behaviour once so every dialog inherits it:
//   • role="dialog" + aria-modal + aria-labelledby (pass `labelledBy` matching your heading id)
//   • focus moves into the dialog on open and is restored to the trigger on close
//   • Tab / Shift+Tab cycle stays inside the dialog
//   • Esc and backdrop click call onClose (opt out per dialog)
//
// Children are the dialog *panel* (its own card styling stays in the calling component). When
// `minimized` is true the dialog is visually hidden but kept mounted (the interview "Hide" flow).
const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Modal({
  onClose,
  labelledBy,
  minimized = false,
  closeOnBackdrop = true,
  closeOnEsc = true,
  className = '',
  children,
}) {
  const panelRef = useRef(null);
  const restoreRef = useRef(null);

  // Remember the element that had focus, move focus into the dialog, restore on unmount.
  useEffect(() => {
    restoreRef.current = document.activeElement;
    const panel = panelRef.current;
    const first = panel?.querySelector(FOCUSABLE);
    (first ?? panel)?.focus({ preventScroll: true });
    return () => {
      const el = restoreRef.current;
      if (el && typeof el.focus === 'function') el.focus({ preventScroll: true });
    };
  }, []);

  function onKeyDown(e) {
    if (e.key === 'Escape' && closeOnEsc && onClose) {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const nodes = panelRef.current?.querySelectorAll(FOCUSABLE);
    if (!nodes || nodes.length === 0) { e.preventDefault(); return; }
    const list = Array.from(nodes).filter(n => n.offsetParent !== null || n === document.activeElement);
    if (list.length === 0) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md ${minimized ? 'hidden' : 'animate-fade-in'}`}
      onMouseDown={(e) => {
        // Only a click that starts AND ends on the backdrop dismisses (avoids text-selection drags).
        if (closeOnBackdrop && onClose && e.target === e.currentTarget) onClose();
      }}
      onKeyDown={onKeyDown}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`outline-none ${className}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
