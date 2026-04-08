import { useEffect, useRef } from 'react';
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
          <div
            className={`rounded-2xl px-4 py-3 text-sm ${
              msg.role === 'user'
                ? 'max-w-[75%] bg-violet-600 text-white'
                : 'w-full max-w-[90%] bg-slate-800 text-slate-300'
            }`}
          >
            {msg.role === 'agent' && (
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-violet-400 font-medium">
                  {msg.agent ?? 'Agent'}
                </span>
                {msg.streaming && (
                  <span className="inline-flex gap-0.5">
                    <span className="w-1 h-1 rounded-full bg-violet-400 animate-bounce [animation-delay:0ms]" />
                    <span className="w-1 h-1 rounded-full bg-violet-400 animate-bounce [animation-delay:150ms]" />
                    <span className="w-1 h-1 rounded-full bg-violet-400 animate-bounce [animation-delay:300ms]" />
                  </span>
                )}
              </div>
            )}
            {msg.role === 'user' ? (
              <p className="whitespace-pre-wrap">{msg.text}</p>
            ) : (
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                {msg.text}
              </ReactMarkdown>
            )}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
