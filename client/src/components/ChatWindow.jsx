import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ResearchBubble } from './ResearchBubble';
import { AnalystBubble }  from './AnalystBubble';
import { SectionBubble }  from './SectionBubble';
import { ReviewBubble }   from './ReviewBubble';
import { CompletionBubble } from './CompletionBubble';
import { DocumentPreview }  from './DocumentPreview';
import { EnhancedJDBubble } from './EnhancedJDBubble';
import { agentLabel }     from '../agentLabels';
import { toast }          from '../lib/toast';

// Background "tick" bubbles show only the first line of an agent's text, next to a green check icon.
// Agent first-lines arrive with inconsistent decoration ("✓ Extractor Complete", "**✓ Data loaded.**",
// "## Title") — strip all of it so every tick renders uniformly: one check + clean text, no double
// ticks, no leaked markdown.
function cleanTickLabel(text) {
  const first = (text ?? '').split('\n')[0];
  const cleaned = first
    .replace(/[*_`]/g, '')              // markdown emphasis / code
    .replace(/^#+\s*/, '')              // heading hashes
    .replace(/^[\s✓✔✅✗❌•]+/, '')        // leading status glyphs / bullets
    .trim();
  return cleaned || 'Done';
}

// Completion lines ("<Agent> Complete") differ per agent ("Extractor Complete", "Tone Analyst
// Complete") — for a consistent "✓ <step>" style, show the friendly step name instead. Informational
// lines ("Project initialised — CV and JD saved", "Analysis still running…") keep their wording.
function tickLabel(msg) {
  const cleaned = cleanTickLabel(msg.text);
  if (/\bcomplete\b/i.test(cleaned) && msg.agent) return agentLabel(msg.agent);
  return cleaned;
}

const mdComponents = {
  h1: ({ children }) => <h1 className="text-lg font-bold text-fg mt-4 mb-2 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="text-base font-semibold text-fg mt-4 mb-1.5 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold text-fg mt-3 mb-1 first:mt-0">{children}</h3>,
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-fg">{children}</strong>,
  em: ({ children }) => <em className="italic text-fg-secondary">{children}</em>,
  code: ({ inline, children }) => {
    const text = String(children ?? '');
    const treatAsInline = inline || !text.includes('\n');
    return treatAsInline
      ? <code className="bg-accent/10 text-accent px-1.5 py-0.5 rounded text-xs font-mono">{children}</code>
      : <code className="block bg-app text-fg-secondary p-3 rounded-lg text-xs font-mono overflow-x-auto my-2 whitespace-pre border border-line">{children}</code>;
  },
  pre: ({ children }) => <>{children}</>,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-accent/50 pl-3 text-fg-muted my-2 italic">{children}</blockquote>,
  hr: () => <hr className="border-line my-3" />,
  a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2 hover:opacity-80">{children}</a>,
  table: ({ children }) => <div className="overflow-x-auto my-2"><table className="text-xs border-collapse w-full">{children}</table></div>,
  th: ({ children }) => <th className="border border-line px-2.5 py-1.5 bg-surface-2 text-fg font-medium text-left">{children}</th>,
  td: ({ children }) => <td className="border border-line px-2.5 py-1.5 text-fg-secondary">{children}</td>,
};

const ERROR_RE = /\bFAILED\b|✗\s|\bError:/;

// ── Message type detectors ─────────────────────────────────────────────────────

/** Researcher completion → ResearchBubble.
 *  Anchor on the stable "Researcher Complete" heading (the completion message the agent always prints),
 *  NOT a scraped status enum — since Researcher v2.3 the server owns the COMPLETE/PARTIAL/FAILED verdict
 *  and the agent no longer types it into the prose. Old-format enum kept as a fallback for safety. */
function isResearchComplete(msg) {
  return (
    msg.agent === 'Researcher' &&
    !msg.background &&
    typeof msg.text === 'string' &&
    (/Researcher Complete/i.test(msg.text) || /RESEARCH_(COMPLETE|PARTIAL|FAILED)/.test(msg.text))
  );
}

/** Analyst completion → AnalystBubble */
function isAnalystComplete(msg) {
  return (
    msg.agent === 'Analyst' &&
    !msg.background &&
    typeof msg.text === 'string' &&
    msg.text.includes('Analyst Complete')
  );
}

/** Assembly section completion (profile/skills/history/credentials/cover letter) → SectionBubble */
function isAssemblySection(msg) {
  return !msg.background && msg.sectionData != null && typeof msg.sectionData.kind === 'string';
}

/** Quality review verdict → ReviewBubble */
function isQualityReview(msg) {
  return (
    msg.agent === 'Analysis' &&
    !msg.background &&
    typeof msg.text === 'string' &&
    msg.text.includes('Quality Review Complete')
  );
}

/** ProjectSetup completion → compact tick (full bubble is overkill) */
function isProjectSetup(msg) {
  return (
    msg.agent === 'ProjectSetup' &&
    !msg.background &&
    typeof msg.text === 'string' &&
    msg.text.includes('ProjectSetup Complete')
  );
}

/** MO quality-review warning notice → compact warning chip */
function isQualityReviewNotice(msg) {
  return (
    msg.agent === 'Main Orchestrator' &&
    !msg.background &&
    typeof msg.text === 'string' &&
    msg.text.startsWith('⚠ Quality Review Found Issues')
  );
}

/** Application finished (status CV_TAILORED) → CompletionBubble. The server tags this message
 *  kind:'completion'; the old MO command list stays as text fallback when no kind is set. */
function isCompletion(msg) {
  return msg.kind === 'completion' && !msg.background;
}

/** Assembled CV / cover-letter preview → DocumentPreview. Carries documentData (built server-side by
 *  buildDocumentData from the per-section output files) and an optional initialTab set by the
 *  view_cv / view_cover_letter action. */
function isDocument(msg) {
  return !msg.background && msg.documentData != null;
}

/** JD enhancement done (status JD_ENHANCED) → EnhancedJDBubble. Server tags this message
 *  kind:'enhanced_jd'; the bubble fetches enhanced_jd.json itself and is read-only. */
function isEnhancedJD(msg) {
  return msg.kind === 'enhanced_jd' && !msg.background;
}

// ── Compact renders (no separate file needed) ─────────────────────────────────

function CheckIcon() {
  return (
    <svg className="w-3 h-3 shrink-0 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

/** ProjectSetup Complete — same visual weight as background ticks */
function ProjectSetupTick() {
  return (
    <div className="animate-fade-in-up flex items-center gap-2.5 px-3 py-2 rounded-lg bg-surface-2 border border-line text-xs text-fg-muted max-w-[85%]">
      <CheckIcon />
      <span className="text-fg-muted">Project initialised - CV and JD saved</span>
    </div>
  );
}

/** ⚠ Quality Review Found Issues — compact warning chip before action buttons */
function QualityReviewNotice({ msg }) {
  const counts = (msg.text.match(/Issues found:([^\n]+)/) ?? [])[1]?.trim() ?? '';
  const hasCritical = /Critical:\s*[1-9]/.test(msg.text);
  const hasHigh     = /High:\s*[1-9]/.test(msg.text);
  return (
    <div className={`animate-fade-in-up flex items-center gap-2.5 px-3 py-2 rounded-lg bg-surface-2 border text-xs max-w-[85%] ${
      hasCritical || hasHigh ? 'border-danger/25' : 'border-warn/25'
    }`}>
      <span className={hasCritical || hasHigh ? 'text-danger' : 'text-warn'}>⚠</span>
      <span className="text-fg-secondary font-medium">A few things to review together</span>
      {counts && <span className="text-fg-faint ml-1">{counts}</span>}
    </div>
  );
}

// ── Standard AgentBubble (unchanged) ─────────────────────────────────────────

function AgentBubble({ msg }) {
  const [showReasoning, setShowReasoning] = useState(false);
  const hasError = ERROR_RE.test(msg.text);
  const hasReasoning = msg.reasoning?.trim().length > 0;

  if (msg.compact && msg.text === 'SETUP_COMPLETE') {
    return (
      <div className="animate-fade-in-up flex items-center gap-2.5 px-3 py-2 rounded-lg border-l-2 border-l-line-strong bg-surface-2 border border-line text-xs text-fg-muted max-w-[85%]">
        <span className="font-medium text-fg-secondary">{agentLabel(msg.agent)}</span>
        <CheckIcon />
        <span className="text-fg-muted">Files checked</span>
      </div>
    );
  }

  if (msg.background) {
    return (
      <div className="animate-fade-in-up flex items-center gap-2.5 px-3 py-2 rounded-lg bg-surface-2 border border-line text-xs text-fg-muted max-w-[85%]">
        <CheckIcon />
        <span className="text-fg-muted truncate">{tickLabel(msg)}</span>
      </div>
    );
  }

  return (
    <div className={`animate-fade-in-up relative w-full max-w-[85%] rounded-xl border border-line border-l-[3px] border-l-line-strong bg-surface-2 px-4 py-3 text-sm text-fg shadow-[var(--shadow-panel)] ${hasError ? 'ring-1 ring-danger/40' : ''}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="w-1.5 h-1.5 rounded-full bg-fg-faint" />
        <span className="text-xs text-fg-secondary font-semibold">{agentLabel(msg.agent ?? 'Agent')}</span>
        {msg.cost != null && (
          <span className="text-xs text-fg-faint font-mono">${msg.cost.toFixed(4)}</span>
        )}
      </div>
      <div className="prose-sm">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
          {msg.text}
        </ReactMarkdown>
      </div>
      {hasReasoning && (
        <div className="mt-2.5 border-t border-line pt-2">
          <button
            onClick={() => setShowReasoning((v) => !v)}
            className="text-xs text-fg-muted hover:text-fg-secondary transition-colors flex items-center gap-1"
          >
            <span className="text-xs">{showReasoning ? '▲' : '▼'}</span>
            {showReasoning ? 'Hide reasoning' : 'Show reasoning'}
          </button>
          {showReasoning && (
            <pre className="mt-2 text-xs text-fg-muted bg-app rounded-lg p-3 overflow-x-auto whitespace-pre-wrap border border-line max-h-64 overflow-y-auto">
              {msg.reasoning}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ── ActionBubble ──────────────────────────────────────────────────────────────

function ActionBubble({ msg, onAction, onUpload }) {
  const fileInputRef = useRef(null);
  const [uploadPending, setUploadPending] = useState(null);

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file || !uploadPending) return;
    const target = uploadPending;
    e.target.value = '';
    setUploadPending(null);
    Promise.resolve(onUpload(target, file)).catch(err => {
      console.error('[upload] failed:', err);
      toast('Upload failed. Please try again.', 'error');
    });
  }

  return (
    <div className="animate-fade-in-up w-full max-w-[85%] rounded-xl bg-surface-2 border border-line border-l-[3px] border-l-accent px-4 py-3 shadow-[var(--shadow-panel)]">
      <div className="text-xs font-semibold uppercase tracking-wider text-accent mb-2">Needs your input</div>
      {msg.prompt && (
        <div className="text-sm text-fg mb-3 prose-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
            {msg.prompt}
          </ReactMarkdown>
        </div>
      )}
      <div className="flex gap-2 flex-wrap">
        {msg.actions?.map((action) => (
          <button
            key={action.id}
            onClick={() => {
              if (msg.used) return;
              if (action.type === 'upload') {
                setUploadPending(action.id);
                fileInputRef.current?.click();
              } else {
                onAction(action.id);
              }
            }}
            disabled={msg.used}
            className={`text-sm rounded-lg px-4 py-2 transition-all font-medium disabled:opacity-40 disabled:cursor-not-allowed ${
              action.variant === 'primary'
                ? 'bg-accent hover:brightness-110 text-accent-fg'
                : 'bg-surface hover:bg-chat border border-line-strong text-fg-secondary hover:text-fg'
            } ${msg.used ? '' : 'active:scale-95'}`}
          >
            {action.label}
          </button>
        ))}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.txt,.doc,.docx"
        className="hidden"
        onChange={handleFileChange}
      />
      {msg.used && (
        <p className="text-xs text-fg-faint mt-2">Option selected.</p>
      )}
    </div>
  );
}

// ── SystemNotice ──────────────────────────────────────────────────────────────

function SystemNotice({ msg }) {
  return (
    <div className="animate-fade-in-up flex items-center gap-2 mx-auto max-w-[80%] text-xs text-fg-muted">
      <span className="h-px flex-1 bg-line" />
      <span className="shrink-0 px-1">{msg.text}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

// ── ThinkingIndicator ─────────────────────────────────────────────────────────

function ThinkingIndicator() {
  return (
    <div className="flex justify-start animate-fade-in-up">
      <div className="rounded-xl px-4 py-3 text-sm bg-surface-2 border border-line text-fg-secondary flex items-center gap-2.5">
        <span className="flex gap-1 items-center">
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce [animation-delay:-0.3s]" />
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce [animation-delay:-0.15s]" />
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" />
        </span>
        <span className="text-xs text-fg-muted">Thinking</span>
      </div>
    </div>
  );
}

// ── Tick grouping (UI-05) ─────────────────────────────────────────────────────
// Background "✓ step done" bubbles used to stream as one row each — a wall of ticks during the
// long pipeline. Collapse a run of them into a single summary row (latest step + count) that
// expands on demand, so the live conversation stays readable.
function isTick(msg) {
  return msg.role !== 'user' && msg.role !== 'actions' && msg.background === true;
}

function CollapsedTicks({ items }) {
  const [open, setOpen] = useState(false);
  const latest = items[items.length - 1];
  return (
    <div className="animate-fade-in-up w-full max-w-[85%]">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex items-center gap-2.5 w-full text-left px-3 py-2 rounded-lg bg-surface-2 border border-line hover:border-line-strong text-xs text-fg-muted transition-all"
      >
        <CheckIcon />
        <span className="text-fg-secondary truncate">{tickLabel(latest)}</span>
        <span className="text-fg-faint whitespace-nowrap">· {items.length} steps done</span>
        <span className="ml-auto text-xs text-fg-faint">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="mt-1.5 ml-1 pl-3 border-l border-line flex flex-col gap-1 animate-fade-in">
          {items.map((m, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-fg-muted py-0.5">
              <CheckIcon />
              <span className="truncate">{tickLabel(m)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Stable React keys per message-object identity (UI-10). Array-index keys made React remount every
// bubble below a collapsing tick group — losing Disclosure/scroll state. A module-level WeakMap keyed
// on the message object gives each one a key that survives re-renders; a full array swap (history
// restore) creates fresh objects, which re-key — the intended remount. WeakMap = no leak.
const _keyMap = new WeakMap();
let _keySeq = 0;
function keyFor(m) {
  let k = _keyMap.get(m);
  if (!k) { k = `k${++_keySeq}`; _keyMap.set(m, k); }
  return k;
}

// The full per-message router (non-tick messages).
function renderBubble(msg, onAction, onUpload) {
  if (msg.role === 'user') {
    return (
      <div className="animate-fade-in-up max-w-[70%] rounded-xl rounded-br-sm bg-accent text-accent-fg px-4 py-2.5 text-sm shadow-[var(--shadow-panel)]">
        <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
      </div>
    );
  }
  if (msg.role === 'actions') return <ActionBubble msg={msg} onAction={onAction} onUpload={onUpload} />;
  if (msg.agent === 'System' && !msg.background) return <SystemNotice msg={msg} />;
  if (isCompletion(msg)) return <CompletionBubble meta={msg.meta} doc={msg.documentData} onAction={onAction} />;
  if (isDocument(msg)) return <DocumentPreview doc={msg.documentData} initialTab={msg.initialTab} />;
  if (isEnhancedJD(msg)) return <EnhancedJDBubble />;
  if (isResearchComplete(msg)) return <ResearchBubble msg={msg} />;
  if (isAnalystComplete(msg)) return <AnalystBubble msg={msg} />;
  if (isAssemblySection(msg)) return <SectionBubble msg={msg} />;
  if (isQualityReview(msg)) return <ReviewBubble msg={msg} />;
  if (isProjectSetup(msg)) return <ProjectSetupTick />;
  if (isQualityReviewNotice(msg)) return <QualityReviewNotice msg={msg} />;
  return <AgentBubble msg={msg} />;
}

// ── ChatWindow ────────────────────────────────────────────────────────────────

export function ChatWindow({ messages, isWaiting, onAction, onUpload }) {
  const bottomRef = useRef(null);
  const scrollRef = useRef(null);
  const atBottomRef = useRef(true);     // latest value for the scroll effect (avoids stale closure)
  const [atBottom, setAtBottom] = useState(true);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    atBottomRef.current = near;
    setAtBottom(near);
  }

  // Only follow new content when the user is already at the bottom — don't yank them down while
  // they're reading earlier messages mid-run.
  useEffect(() => {
    if (atBottomRef.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isWaiting]);

  function jumpToLatest() {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }

  // Collapse consecutive background ticks into groups. Keys come from message identity (keyFor), so a
  // group is keyed by its first tick — stable as more ticks fold into it.
  const groups = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (isTick(msg)) {
      const last = groups[groups.length - 1];
      if (last?.type === 'ticks') last.items.push(msg);
      else groups.push({ type: 'ticks', items: [msg], key: keyFor(msg) });
    } else {
      groups.push({ type: 'msg', msg, key: keyFor(msg) });
    }
  }

  return (
    <div className="relative flex-1 min-h-0 flex flex-col bg-chat">
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
        {groups.map((g) => {
          if (g.type === 'ticks') {
            return (
              <div key={g.key} className="flex justify-start">
                {g.items.length >= 2 ? <CollapsedTicks items={g.items} /> : <AgentBubble msg={g.items[0]} />}
              </div>
            );
          }
          return (
            <div key={g.key} className={`flex ${g.msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {renderBubble(g.msg, onAction, onUpload)}
            </div>
          );
        })}
        {isWaiting && <ThinkingIndicator />}
        <div ref={bottomRef} />
      </div>

      {!atBottom && (
        <button
          onClick={jumpToLatest}
          className="animate-fade-in absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 rounded-full bg-surface-2 border border-line-strong text-fg-secondary hover:text-fg text-xs font-medium px-3.5 py-1.5 shadow-[var(--shadow-float)] transition-all"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12l7 7 7-7" /></svg>
          Latest
        </button>
      )}
    </div>
  );
}
