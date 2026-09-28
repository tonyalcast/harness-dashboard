import { useEffect, useRef, useState } from "react";
import { SubscriptionCards } from "./components/SubscriptionCard";

export function CompactApp() {
  const [refreshToken, setRefreshToken] = useState(0);
  const [busy, setBusy] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);

  // Each extra account adds a row, so tell the Electron shell how tall the HUD
  // wants to be. There is no preload bridge; the main process reads this
  // marker from the title and resizes the window to fit.
  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const report = () => {
      const margin = 8; // .compact-shell has a 4px margin on each side
      document.title = `Harness — Compact [h=${Math.ceil(el.offsetHeight + margin)}]`;
    };
    const observer = new ResizeObserver(report);
    observer.observe(el);
    report();
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={shellRef} className="compact-shell">
      <header className="compact-drag flex items-center justify-between gap-1.5 px-2.5 py-1">
        <span className="text-[10px] uppercase tracking-[0.14em] text-muted select-none">
          Harness
        </span>
        <div className="compact-no-drag flex items-center gap-0.5">
          <button
            type="button"
            className="focus-ring text-[10px] text-accent hover:underline disabled:opacity-50 px-1"
            disabled={busy}
            onClick={() => setRefreshToken((n) => n + 1)}
            title="Refresh meters"
          >
            {busy ? "…" : "↻"}
          </button>
          <button
            type="button"
            className="focus-ring text-[10px] text-muted hover:text-text px-1"
            title="Open full dashboard"
            onClick={() => {
              if (window.opener && !window.opener.closed) {
                window.opener.focus();
                return;
              }
              window.open("/", "harness-main");
            }}
          >
            ↗
          </button>
          <button
            type="button"
            className="focus-ring text-[10px] text-muted hover:text-warn px-1"
            title="Close compact and quit the app"
            onClick={() => {
              // Electron: main process quits app + server on compact close.
              // Browser: only works if this window was opened via window.open.
              window.close();
            }}
          >
            ✕
          </button>
        </div>
      </header>
      <main className="px-2 pb-2 pt-0.5">
        <SubscriptionCards
          autoLoad
          compact
          hideHeader
          refreshToken={refreshToken}
          onBusyChange={setBusy}
        />
      </main>
    </div>
  );
}
