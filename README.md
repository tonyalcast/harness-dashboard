# Harness Dashboard

**One fuel gauge for every AI coding harness you actually use.**

A single provider is no longer enough. Most of us bounce between Claude Code, OpenCode, Cursor — different quotas, different models, different meters — and none of their dashboards talk to each other. Harness Dashboard consolidates **three** of them today into one local view. More harnesses will land as the landscape keeps splitting.

Single user. **macOS only** for now (Windows support planned). `localhost` only. No telemetry. No cloud.

![Harness Dashboard](docs/screenshot.png)

> Capture: `bun dev` → open `http://127.0.0.1:4000` → save as `docs/screenshot.png`.

---

## Why this exists

Vendor UIs answer *"how much of **our** plan did you burn?"*  
They never answer *"across everything I code with, where did the tokens go?"*

This does:

| | |
|---|---|
| **Consumption** | Tokens, API-equivalent $, reported $, cache savings — from local harness logs |
| **Subscription by harness** | Real quota pools per vendor (Claude limits, OpenCode Go meters, Cursor spending) |
| **Tokens over time** | Multi-line chart by model × harness, or rolled up by harness |
| **Live** | SSE + filesystem watch — refresh as you work |

Three independent readings. Not one number split three ways. Each vendor meters differently; we show that honestly.

---

## What you get

- Unified token & cost tracking across **Claude Code**, **OpenCode**, and **Cursor**
- **Subscription by harness** — continuous / weekly / monthly (OpenCode Go), Included / Other / On-Demand (Cursor), 5h & 7d (Claude)
- Side-by-side **API-equivalent** vs harness-**reported** cost
- Cache-savings accounting, model breakdown, what-if model swap
- Activity heatmap, top sessions, CSV/JSON export
- Live updates while you code

---

## Privacy promise

- **Local only** — binds to `127.0.0.1:4000`, never `0.0.0.0`
- **Read-only on harness data** — never writes, moves, or locks a byte inside `~/.claude`, `~/.local/share/opencode`, or Cursor dirs
- **Zero telemetry** — nothing leaves your machine unless *you* opt into a vendor cookie (Claude / OpenCode Go / Cursor), and those calls go only to that vendor
- Index lives in `~/.harness-dashboard/` (SQLite + config + pricing cache)

---

## Install and run

**Platform:** macOS today. Windows paths and adapters will land later — see `docs/FUTURE.md`.

Requires [Bun 1.4.0+](https://bun.sh).

```bash
git clone <repo> && cd harness-dashboard
bun install
bun dev          # http://127.0.0.1:4000
bun start        # production
bun test
bun run build    # standalone binary → dist/
```

Port **4000** is fixed on purpose.

Claude Code and OpenCode light up from local logs with zero config. Optional vendor cookies unlock **subscription** meters (and Cursor row-level usage) — see `.env.example`.

### Desktop app (macOS)

Native window with the same UI as the browser.

```bash
bun install
bun run desktop:dev      # dev: starts Bun server + Electron window
bun run desktop:build    # .app in dist/desktop/mac-arm64/
```

The packaged app embeds the compiled Bun server on port **47831** (browser/terminal dev stays on **4000**). Cookies from your project `.env` are synced to `~/.harness-dashboard/.env` for the packaged server.

---

## How cost is calculated

Two numbers. Never conflated.

| Number | Meaning |
|---|---|
| **API-equivalent** | What the same tokens would cost at public list rates. Always computed. |
| **Reported** | What the harness itself recorded, when trustworthy. Shown as `—` when absent — never invented. |

OpenCode often writes `cost: 0` on nonzero-token messages — we treat that as missing, not free. Cache write/read are priced separately. Unknown models cost `$0` and surface under an unpriced-models note.

---

## Subscription by harness (optional cookies)

Token totals are what you *consumed*. Subscription meters are what each vendor *counts against your plan* — weighted differently, often ignoring most cache reads.

Copy `.env.example` → `.env` and fill only what you need:

| Harness | Env | Source of truth |
|---|---|---|
| **Claude Code** | `CLAUDE_SESSION_COOKIE` + `CLAUDE_ORG_ID` | `claude.ai` usage API |
| **OpenCode Go** | `OPENCODE_GO_WORKSPACE_ID` + `OPENCODE_GO_AUTH_COOKIE` | Workspace `/go` page |
| **Cursor** | `CURSOR_SESSION_COOKIE` | Spending + usage-events APIs |

How to grab each value is spelled out in `.env.example` (DevTools → cookies / network). Cookies are **never** logged, written to SQLite, returned by any API route, or rendered in the UI.

These are undocumented endpoints. They can break without notice. On failure the card keeps the last good reading and says why.

**When a payload shape changes:** `GET /api/subscription/raw` (localhost) returns the untouched Claude payload for parser tweaks.

---

## Roadmap posture

Three harnesses today. The product assumption is durable: **the multi-provider workflow is the default**, not the exception. Expect more adapters as new coding agents matter.

**Platform:** macOS is supported now; **Windows support is planned**.

See also `docs/FUTURE.md` and `docs/LIMITS.md`.

---

## Production dependencies

| Package | Why |
|---|---|
| `react` / `react-dom` | UI |
| `react-is` | Peer for Recharts |
| `recharts` | Time-series charts |
| `lucide-react` | Icons |
| `tailwindcss` | Styling (v4) |
| `bun-plugin-tailwind` | Tailwind inside Bun.serve HTML imports |

---

## License

MIT
