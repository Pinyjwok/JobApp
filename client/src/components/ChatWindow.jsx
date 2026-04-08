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
  code: ({ inline, children }) =>
    inline
      ? <code className="bg-slate-700 text-violet-300 px-1 py-0.5 rounded text-xs font-mono">{children}</code>
      : <code className="block bg-slate-900 text-slate-300 p-3 rounded-lg text-xs font-mono overflow-x-auto my-2 whitespace-pre">{children}</code>,
  pre: ({ children }) => <>{children}</>,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-violet-500 pl-3 text-slate-400 my-2">{children}</blockquote>,
  hr: () => <hr className="border-slate-600 my-3" />,
  table: ({ children }) => <div className="overflow-x-auto my-2"><table className="text-xs border-collapse w-full">{children}</table></div>,
  th: ({ children }) => <th className="border border-slate-600 px-2 py-1 bg-slate-700 text-slate-200 font-medium text-left">{children}</th>,
  td: ({ children }) => <td className="border border-slate-600 px-2 py-1 text-slate-300">{children}</td>,
};

const ERROR_RE = /\b(error|failed|critical|cannot|undefined)\b/i;

function AgentBubble({ msg }) {
  const [showReasoning, setShowReasoning] = useState(false);
  const hasError = ERROR_RE.test(msg.text);
  const hasReasoning = msg.reasoning?.trim().length > 0;

  return (
    <div className={`relative w-full max-w-[90%] rounded-2xl px-4 py-3 text-sm bg-slate-800 text-slate-300 ${hasError ? 'border border-red-700' : ''}`}>
      {/* Header row */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-violet-400 font-medium">{msg.agent ?? 'Agent'}</span>
        {msg.cost != null && (
          <span className="text-xs text-slate-500">${msg.cost.toFixed(4)}</span>
        )}
        {msg.turn != null && (
          <span className="text-xs text-slate-600 ml-auto">#{msg.turn}</span>
        )}
        {msg.streaming && !msg.stalled && (
          <span className="inline-flex gap-0.5 ml-auto">
            <span className="w-1 h-1 rounded-full bg-violet-400 animate-bounce [animation-delay:0ms]" />
            <span className="w-1 h-1 rounded-full bg-violet-400 animate-bounce [animation-delay:150ms]" />
            <span className="w-1 h-1 rounded-full bg-violet-400 animate-bounce [animation-delay:300ms]" />
          </span>
        )}
        {msg.stalled && (
          <span className="text-xs text-amber-400 ml-auto">⚠ Waiting…</span>
        )}
      </div>

      {/* Message body */}
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {msg.text}
      </ReactMarkdown>

      {/* Reasoning toggle */}
      {hasReasoning && (
        <div className="mt-2 border-t border-slate-700 pt-2">
          <button
            onClick={() => setShowReasoning((v) => !v)}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            {showReasoning ? '▲ Hide reasoning' : '▼ Show reasoning'}
          </button>
          {showReasoning && (
            <pre className="mt-2 text-xs text-slate-400 bg-slate-900 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
              {msg.reasoning}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export function ChatWindow({ messages }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
      {messages.map((msg, i) => (
        <div
          key={i}
          className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
        >
          {msg.role === 'user' ? (
            <div className="max-w-[75%] rounded-2xl px-4 py-3 text-sm bg-violet-600 text-white">
              <p className="whitespace-pre-wrap">{msg.text}</p>
            </div>
          ) : (
            <AgentBubble msg={msg} />
          )}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
