# Changelog

All notable changes to Harness Dashboard are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.2.0] - 2026-07-29

### Added

- **Reset countdowns** — Subscription cards show a prominent `Resets in 5h` (short relative format) for the primary window on each harness.
- **Compact HUD** — Header button **Compact** opens `/compact`: a small always-on-top window (desktop) with subscription meters, Refresh, and Expand. Frameless, semi-transparent, draggable; position saved in `~/.harness-dashboard/compact-bounds.json`. Works in the browser as a normal small window too.

### Changed

- Per-bucket reset labels use the same short relative format (`resets in 5h`).

## [1.1.0] - 2026-07-29

### Added

- **Desktop app (macOS)** — Electron wrapper with the same UI as the browser (`bun run desktop:dev`, `bun run desktop:build`). Packaged app listens on port **47831**; browser/terminal dev stays on **4000**.
- **CSS build pipeline** — Tailwind is precompiled to `src/ui/app.css` so styles load correctly in production and in the packaged app.
- **Subscription cookies in Settings** — Enter Claude, OpenCode, and Cursor session cookies in the UI. Values persist in `~/.harness-dashboard/secrets.json` (works in browser and desktop). `.env` still works; Settings values override when saved.
- **Live / Manual refresh toggle** — Switch in the dashboard header. **Live** (default) keeps SSE and file-watch ingest; **Manual** loads data only when you hit Refresh.
- **Dashboard section visibility** — **Sections** menu in the header to show or hide blocks (consumption, charts, heatmap, what-if, etc.). Hidden sections skip their API calls. **Minimal view** keeps only Subscription by harness.

### Changed

- Server defers Bun asset serving to the bundler (`return undefined` for non-API routes).
- Port is configurable via `HARNESS_DASHBOARD_PORT` (used by the desktop app).

## [1.0.0] - 2026-07-29

Initial release.

### Added

- **Unified harness dashboard** — Single local view for **Claude Code**, **OpenCode**, and **Cursor** token and cost usage.
- **Consumption metrics** — Tokens (in/out/cache), API-equivalent cost, harness-reported cost, and cache savings from local log files.
- **Subscription by harness** — Real quota meters per vendor:
  - Claude Code — 5h and 7d limits via session cookie + org ID
  - OpenCode Go — continuous / weekly / monthly meters
  - Cursor — Included, Other Models, and On-Demand spending
- **Charts and analysis** — Tokens over time (by model × harness or by harness), by-model breakdown, activity heatmap, top expensive sessions, what-if model swap.
- **Records page** — Paginated, searchable event log with per-row costs.
- **Live updates** — SSE plus filesystem watch on harness log paths; Cursor polled on an interval.
- **Settings** — Per-harness subscription plans, monthly budget and alerts, timezone, adapter toggles.
- **Export** — CSV and JSON for the current filter.
- **Privacy** — Binds to `127.0.0.1` only; read-only on harness data; no telemetry. Index in `~/.harness-dashboard/` (SQLite + config).

### Requirements

- macOS (Windows planned)
- [Bun 1.4.0+](https://bun.sh)
