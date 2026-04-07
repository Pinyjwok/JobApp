import { useState, useCallback } from 'react';
import { ChatWindow } from './components/ChatWindow';
import { MessageInput } from './components/MessageInput';
import { StatusBar } from './components/StatusBar';
import { useStream } from './hooks/useStream';
import './index.css';

export default function App() {
  const [messages, setMessages] = useState([]);
  const [activeAgent, setActiveAgent] = useState(null);
  const [status, setStatus] = useState(null);
  const [sending, setSending] = useState(false);

  useStream(
    useCallback((data) => {
      if (data.type === 'agent_output') {
        const text =
          typeof data.value === 'string'
            ? data.value
            : JSON.stringify(data.value, null, 2);
        setMessages((prev) => [
          ...prev,
          { role: 'agent', agent: activeAgent, text },
        ]);
        fetch('/api/status')
          .then((r) => r.json())
          .then((d) => setStatus(d.status))
          .catch(() => {});
      } else if (data.type === 'agent_switch') {
        setActiveAgent(data.agent);
      }
    }, [activeAgent])
  );

  async function handleSend(text) {
    setMessages((prev) => [...prev, { role: 'user', text }]);
    setSending(true);
    try {
      await fetch('/api/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'agent', agent: 'System', text: `Error: ${err.message}` },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-base">
      <div className="px-6 py-4 border-b border-slate-700 flex items-center gap-3">
        <div className="w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse" />
        <h1 className="text-lg font-semibold text-slate-100">
          JobApp CV Optimizer
        </h1>
      </div>

      <StatusBar status={status} activeAgent={activeAgent} />

      <ChatWindow messages={messages} />

      <MessageInput onSend={handleSend} disabled={sending} />
    </div>
  );
}
