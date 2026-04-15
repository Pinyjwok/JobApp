import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const mdComponents = {
  h1: ({ children }) => <h1 className="text-lg font-bold text-slate-100 mt-4 mb-2 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="text-base font-semibold text-slate-100 mt-4 mb-1.5 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold text-slate-200 mt-3 mb-1 first:mt-0">{children}</h3>,
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-slate-100">{children}</strong>,
  em: ({ children }) => <em className="italic text-slate-300">{children}</em>,
  code: ({ inline, children }) => {
    const text = String(children ?? '');
    const treatAsInline = inline || !text.includes('\n');
    return treatAsInline
      ? <code className="bg-slate-700/60 text-violet-300 px-1.5 py-0.5 rounded text-xs font-mono">{children}</code>
      : <code className="block bg-slate-950/60 text-slate-300 p-3 rounded-lg text-xs font-mono overflow-x-auto my-2 whitespace-pre border border-slate-800/50">{children}</code>;
  },
  pre: ({ children }) => <>{children}</>,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-violet-500/50 pl-3 text-slate-400 my-2 italic">{children}</blockquote>,
  hr: () => <hr className="border-slate-700/50 my-3" />,
  table: ({ children }) => <div className="overflow-x-auto my-2"><table className="text-xs border-collapse w-full">{children}</table></div>,
  th: ({ children }) => <th className="border border-slate-700/50 px-2.5 py-1.5 bg-slate-800/60 text-slate-200 font-medium text-left">{children}</th>,
  td: ({ children }) => <td className="border border-slate-700/50 px-2.5 py-1.5 text-slate-300">{children}</td>,
};

// Agent color map — each pipeline stage gets a distinct accent
const AGENT_COLORS = {
  'JobApp':                 'border-l-violet-500',
  'System':                 'border-l-slate-500',
  'ProjectSetup':           'border-l-sky-500',
  'Extractor':              'border-l-cyan-500',
  'Researcher':             'border-l-teal-500',
  'JD Enhancer':            'border-l-emerald-500',
  'Analyst':                'border-l-amber-500',
  'Reviewer':               'border-l-orange-500',
  'Main Orchestrator':      'border-l-rose-500',
  'Tone Analyst':           'border-l-pink-500',
  'Assembly Coordinator':   'border-l-indigo-500',
  'Style Negotiator':       'border-l-violet-400',
  'Profile Builder':        'border-l-purple-400',
  'Skills Curator':         'border-l-fuchsia-400',
  'History Formatter':      'border-l-blue-400',
  'Credentials Formatter':  'border-l-sky-400',
  'CoverLetter Writer':     'border-l-teal-400',
  'Style Reviewer':         'border-l-emerald-400',
  'Integrity Checker':      'border-l-lime-400',
};

const AGENT_DOT_COLORS = {
  'JobApp':                 'bg-violet-500',
  'System':                 'bg-slate-500',
  'ProjectSetup':           'bg-sky-500',
  'Extractor':              'bg-cyan-500',
  'Researcher':             'bg-teal-500',
  'JD Enhancer':            'bg-emerald-500',
  'Analyst':                'bg-amber-500',
  'Reviewer':               'bg-orange-500',
  'Main Orchestrator':      'bg-rose-500',
  'Tone Analyst':           'bg-pink-500',
  'Assembly Coordinator':   'bg-indigo-500',
  'Style Negotiator':       'bg-violet-400',
  'Profile Builder':        'bg-purple-400',
  'Skills Curator':         'bg-fuchsia-400',
  'History Formatter':      'bg-blue-400',
  'Credentials Formatter':  'bg-sky-400',
  'CoverLetter Writer':     'bg-teal-400',
  'Style Reviewer':         'bg-emerald-400',
  'Integrity Checker':      'bg-lime-400',
};

// Only flag genuine failure states
const ERROR_RE = /\bFAILED\b|✗\s|\bError:/;

function AgentBubble({ msg }) {
  const [showReasoning, setShowReasoning] = useState(false);
  const hasError = ERROR_RE.test(msg.text);
  const hasReasoning = msg.reasoning?.trim().length > 0;
  const borderColor = AGENT_COLORS[msg.agent] ?? 'border-l-slate-600';
  const dotColor = AGENT_DOT_COLORS[msg.agent] ?? 'bg-slate-600';

  return (
    <div className={`animate-fade-in-up relative w-full max-w-[85%] rounded-xl border-l-[3px] ${borderColor} bg-slate-800/70 backdrop-blur-sm px-4 py-3 text-sm text-slate-300 ${hasError ? 'ring-1 ring-red-700/40' : ''}`}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
        <span className="text-xs text-slate-400 font-medium">{msg.agent ?? 'Agent'}</span>
        {msg.cost != null && (
          <span className="text-[10px] text-slate-600 font-mono">${msg.cost.toFixed(4)}</span>
        )}
      </div>

      {/* Body */}
      <div className="prose-sm">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
          {msg.text}
        </ReactMarkdown>
      </div>

      {/* Reasoning */}
      {hasReasoning && (
        <div className="mt-2.5 border-t border-slate-700/50 pt-2">
          <button
            onClick={() => setShowReasoning((v) => !v)}
            className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1"
          >
            <span className="text-[9px]">{showReasoning ? '▲' : '▼'}</span>
            {showReasoning ? 'Hide reasoning' : 'Show reasoning'}
          </button>
          {showReasoning && (
            <pre className="mt-2 text-[11px] text-slate-500 bg-slate-950/40 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap border border-slate-800/50 max-h-64 overflow-y-auto">
              {msg.reasoning}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex justify-start animate-fade-in-up">
      <div className="rounded-xl px-4 py-3 text-sm bg-slate-800/50 border border-slate-700/30 text-slate-400 flex items-center gap-2.5">
        <span className="flex gap-1 items-center">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400/60 animate-bounce [animation-delay:-0.3s]" />
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400/60 animate-bounce [animation-delay:-0.15s]" />
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400/60 animate-bounce" />
        </span>
        <span className="text-xs text-slate-500">Thinking</span>
      </div>
    </div>
  );
}

export function ChatWindow({ messages, isWaiting }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isWaiting]);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
      {messages.map((msg, i) => (
        <div
          key={i}
          className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
        >
          {msg.role === 'user' ? (
            <div className="animate-fade-in-up max-w-[70%] rounded-xl rounded-br-sm bg-gradient-to-br from-violet-600 to-indigo-600 text-white px-4 py-2.5 text-sm shadow-lg shadow-violet-600/10">
              <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
            </div>
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
