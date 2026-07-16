// Shared design primitives extracted for the 2026-06 UI redesign.
//   • SectionDivider — hairline-topped, eyebrow-labelled section (SectionBubble, DocumentPreview)
//   • Disclosure     — collapsible detail panel, mirrors AgentBubble's reasoning toggle
//                      (StyleInterviewModal evidence, GapInterviewModal accepted strip)
//   • Eyebrow        — the small uppercase kicker used across both
//   • Tone glyphs    — CheckIcon / WarnIcon / InfoIcon (inline SVGs replacing the
//                      placeholder emoji shown in the mockups)

const TONE = {
  muted:   'text-fg-muted',
  success: 'text-success',
  warn:    'text-warn',
  accent:  'text-accent',
};

export function CheckIcon({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg className={`${className} shrink-0`} fill="none" viewBox="0 0 24 24" stroke="currentColor"
      strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

export function WarnIcon({ className = 'w-3 h-3' }) {
  return (
    <svg className={`${className} shrink-0`} fill="none" viewBox="0 0 24 24" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3.2 1.8 20.5h20.4L12 3.2z" /><path d="M12 10v4" /><path d="M12 17.4h.01" />
    </svg>
  );
}

export function InfoIcon({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg className={`${className} shrink-0`} fill="none" viewBox="0 0 24 24" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9.2" /><path d="M12 11v5" /><path d="M12 7.6h.01" />
    </svg>
  );
}

// Small uppercase kicker. tone: muted | success | warn | accent
export function Eyebrow({ tone = 'muted', icon, children, className = '' }) {
  return (
    <div className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider ${TONE[tone]} ${className}`}>
      {icon}{children}
    </div>
  );
}

// Hairline-topped, eyebrow-labelled section. `first` suppresses the top rule.
// `rule` adds a trailing hairline after the label (document-style header).
export function SectionDivider({ label, tone = 'muted', icon, first = false, rule = false, children }) {
  return (
    <div className={first ? '' : 'border-t border-line pt-3 mt-3'}>
      {rule ? (
        <div className="flex items-center gap-3 mb-2">
          <Eyebrow tone={tone} icon={icon}>{label}</Eyebrow>
          <span className="flex-1 h-px bg-line" />
        </div>
      ) : (
        <Eyebrow tone={tone} icon={icon} className="mb-1.5">{label}</Eyebrow>
      )}
      {children}
    </div>
  );
}

// Collapsible detail panel. Controlled — pass `open` + `onToggle` (mirrors the
// AgentBubble reasoning toggle: text-xs caret, quiet trigger row).
export function Disclosure({ title, open, onToggle, children }) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1.5 text-xs text-fg-muted hover:text-fg-secondary transition-colors"
      >
        <span className="text-xs">{open ? '▾' : '▸'}</span>
        {title}
      </button>
      {open && (
        <div className="bg-surface-3 border border-line rounded-xl px-4 py-3 mt-2 space-y-2.5 animate-fade-in">
          {children}
        </div>
      )}
    </div>
  );
}
