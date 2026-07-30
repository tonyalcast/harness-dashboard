import { watch, type FSWatcher } from "fs";
import { loadConfig } from "../config";
import { getAdapters } from "./ingest-runner";
import { WATCH_DEBOUNCE_MS, CURSOR_POLL_MS } from "./constants";

let timer: ReturnType<typeof setTimeout> | null = null;
let watchers: FSWatcher[] = [];
let cursorTimer: ReturnType<typeof setInterval> | null = null;
let onChange: (() => void) | null = null;

export function startWatching(cb: () => void) {
  onChange = cb;
  stopWatching();

  const paths = new Set<string>();
  for (const a of getAdapters()) {
    for (const p of a.watchPaths()) paths.add(p);
  }

  for (const p of paths) {
    try {
      const w = watch(p, { recursive: true }, () => schedule());
      watchers.push(w);
    } catch (err) {
      console.error("[watch] failed for", p, err instanceof Error ? err.message : err);
    }
  }

  // Cursor is polled, never watched
  cursorTimer = setInterval(() => {
    if (loadConfig().refreshMode !== "live") return;
    const hasCursor = getAdapters().some((a) => a.source === "cursor");
    if (hasCursor) schedule();
  }, CURSOR_POLL_MS);
}

function schedule() {
  if (loadConfig().refreshMode !== "live") return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    onChange?.();
  }, WATCH_DEBOUNCE_MS);
}

export function stopWatching() {
  for (const w of watchers) {
    try {
      w.close();
    } catch {
      /* ignore */
    }
  }
  watchers = [];
  if (cursorTimer) clearInterval(cursorTimer);
  cursorTimer = null;
  if (timer) clearTimeout(timer);
  timer = null;
}
