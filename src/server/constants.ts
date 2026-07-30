/** Default 4000 for browser/terminal. Desktop app sets HARNESS_DASHBOARD_PORT. */
export const PORT = Number(process.env.HARNESS_DASHBOARD_PORT) || 4000;
export const HOST = "127.0.0.1";
export const WINDOW_MS = 5 * 60 * 60 * 1000;
export const SSE_HEARTBEAT_MS = 30_000;
export const WATCH_DEBOUNCE_MS = 500;
export const CURSOR_POLL_MS = 60_000;
