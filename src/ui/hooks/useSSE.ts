import { useEffect, useRef, useState } from "react";

export type LiveStatus = "live" | "reconnecting" | "offline";

export function useSSE(url: string, onUpdate: () => void) {
  const [status, setStatus] = useState<LiveStatus>("offline");
  const backoff = useRef(1000);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (closed) return;
      es = new EventSource(url);
      es.addEventListener("hello", () => {
        setStatus("live");
        backoff.current = 1000;
      });
      es.addEventListener("update", () => {
        setStatus("live");
        onUpdateRef.current();
      });
      es.onopen = () => {
        setStatus("live");
        backoff.current = 1000;
      };
      es.onerror = () => {
        es?.close();
        setStatus("reconnecting");
        const wait = backoff.current;
        backoff.current = Math.min(30_000, backoff.current * 1.7);
        timer = setTimeout(connect, wait);
      };
    }

    connect();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      es?.close();
    };
  }, [url]);

  return { status };
}
