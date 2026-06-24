import { useEffect, useRef } from 'react';

// SSE subscription. EventSource auto-reconnects, but silently — a dropped pipe used to leave the app
// looking alive while no events arrived (UI-08). We now surface 'open' / 'reconnecting' so the UI can
// show a banner, and onStatus fires on every transition.
export function useStream(onMessage, onStatus) {
  const onMessageRef = useRef(onMessage);
  const onStatusRef = useRef(onStatus);

  // Keep callbacks fresh without re-opening the stream. Assigning in an effect (not during render)
  // satisfies react-hooks/refs.
  useEffect(() => {
    onMessageRef.current = onMessage;
    onStatusRef.current = onStatus;
  });

  useEffect(() => {
    const es = new EventSource('/api/stream');
    onStatusRef.current?.('connecting');

    es.onopen = () => onStatusRef.current?.('open');

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        onMessageRef.current(data);
      } catch {
        // ignore malformed frames
      }
    };

    es.onerror = () => {
      // readyState: 0 = browser is auto-reconnecting, 2 = connection closed for good.
      onStatusRef.current?.(es.readyState === EventSource.CLOSED ? 'closed' : 'reconnecting');
    };

    return () => es.close();
  }, []);
}
