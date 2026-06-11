import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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

// One semantic vocabulary, not 19 per-agent colors:
//   neutral  → the assistant is talking          (border-l-line-strong)
//   accent   → something needs the user          (handled by ActionBubble)
//   success  → a background step completed
//   danger   → an error surfaced                 (ring-danger)
function AgentBubble({ msg }) {
  const [showReasoning, setShowReasoning] = useState(false);
  const hasError = ERROR_RE.test(msg.text);
  const hasReasoning = msg.reasoning?.trim().length > 0;

  // Compact success tick for PS validation success
  if (msg.compact && msg.text === 'SETUP_COMPLETE') {
    return (
      <div className="animate-fade-in-up flex items-center gap-2.5 px-3 py-2 rounded-lg border-l-2 border-l-line-strong bg-surface-2 border border-line text-xs text-fg-muted max-w-[85%]">
        <span className="font-medium text-fg-secondary">{msg.agent}</span>
        <svg className="w-3 h-3 shrink-0 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        <span className="text-fg-muted">Files validated</span>
      </div>
    );
  }

  // Background steps — dimmer, single-line
  if (msg.background) {
    return (
      <div className="animate-fade-in-up flex items-center gap-2.5 px-3 py-2 rounded-lg bg-surface-2 border border-line text-xs text-fg-muted max-w-[85%]">
        <svg className="w-3 h-3 shrink-0 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        <span className="text-fg-muted truncate">{msg.text?.split('\n')[0]?.replace(/^#+\s*/, '') ?? 'Complete'}</span>
      </div>
    );
  }

  return (
    <div className={`animate-fade-in-up relative w-full max-w-[85%] rounded-xl border border-line border-l-[3px] border-l-line-strong bg-surface-2 px-4 py-3 text-sm text-fg shadow-[var(--shadow-panel)] ${hasError ? 'ring-1 ring-danger/40' : ''}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="w-1.5 h-1.5 rounded-full bg-fg-faint" />
        <span className="text-xs text-fg-secondary font-semibold">{msg.agent ?? 'Agent'}</span>
        {msg.cost != null && (
          <span className="text-[10px] text-fg-faint font-mono">${msg.cost.toFixed(4)}</span>
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
            className="text-[11px] text-fg-muted hover:text-fg-secondary transition-colors flex items-center gap-1"
          >
            <span className="text-[9px]">{showReasoning ? '▲' : '▼'}</span>
            {showReasoning ? 'Hide reasoning' : 'Show reasoning'}
          </button>
          {showReasoning && (
            <pre className="mt-2 text-[11px] text-fg-muted bg-app rounded-lg p-3 overflow-x-auto whitespace-pre-wrap border border-line max-h-64 overflow-y-auto">
              {msg.reasoning}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// Inline action buttons — rendered when server sends action_required event
function ActionBubble({ msg, onAction, onUpload }) {
  const fileInputRef = useRef(null);
  const [uploadPending, setUploadPending] = useState(null);

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file || !uploadPending) return;
    const target = uploadPending;
    e.target.value = '';
    setUploadPending(null);
    // onUpload may be async — swallow/surface rejection so a failed upload doesn't become an
    // unhandled promise rejection.
    Promise.resolve(onUpload(target, file)).catch(err => {
      console.error('[upload] failed:', err);
      alert('Upload failed. Please try again.');
    });
  }

  return (
    <div className="animate-fade-in-up w-full max-w-[85%] rounded-xl bg-surface-2 border border-line border-l-[3px] border-l-accent px-4 py-3 shadow-[var(--shadow-panel)]">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-accent mb-2">Needs your input</div>
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

// System notices — terse, centered status lines
function SystemNotice({ msg }) {
  return (
    <div className="animate-fade-in-up flex items-center gap-2 mx-auto max-w-[80%] text-xs text-fg-muted">
      <span className="h-px flex-1 bg-line" />
      <span className="shrink-0 px-1">{msg.text}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

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

export function ChatWindow({ messages, isWaiting, onAction, onUpload }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isWaiting]);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3 bg-chat">
      {messages.map((msg, i) => (
        <div
          key={i}
          className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
        >
          {msg.role === 'user' ? (
            <div className="animate-fade-in-up max-w-[70%] rounded-xl rounded-br-sm bg-accent text-accent-fg px-4 py-2.5 text-sm shadow-[var(--shadow-panel)]">
              <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
            </div>
          ) : msg.role === 'actions' ? (
            <ActionBubble msg={msg} onAction={onAction} onUpload={onUpload} />
          ) : msg.agent === 'System' && !msg.background ? (
            <SystemNotice msg={msg} />
          ) : (
            <AgentBubble msg={msg} />
          )}
        </div>
      ))}
      {isWaiting && <ThinkingIndicator />}
      <div ref={bottomRef} />
    </div>
  );
}
