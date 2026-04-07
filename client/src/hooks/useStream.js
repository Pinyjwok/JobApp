import { useEffect, useRef } from 'react';

export function useStream(onMessage) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    const es = new EventSource('/api/stream');

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        onMessageRef.current(data);
      } catch {
        // ignore malformed frames
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects; nothing to do
    };

    return () => es.close();
  }, []);
}
