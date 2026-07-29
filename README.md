# harness-dashboard

Local-first dashboard for AI coding-harness consumption across **Claude Code**, **OpenCode**, and **Cursor**.

Single user. Runs entirely on `localhost`. No telemetry. No cloud.

![harness-dashboard](docs/screenshot.png)

> Screenshot: run `bun dev` and capture `http://127.0.0.1:4000` into `docs/screenshot.png`.

## What it does

- Tracks tokens and cost across Claude Code, OpenCode, and (optionally) Cursor
- Shows the active **5-hour window** burn gauge with burn rate and projected depletion
- Weekly usage against a **calibrated** baseline (always marked as an estimate)
- API-equivalent cost vs harness-reported cost, side by side
- Cache savings, model breakdown, what-if swap, export (CSV/JSON)
- Live updates via SSE + `fs.watch`

## Privacy promise

- **Local only** — binds to `127.0.0.1:4000`, never `0.0.0.0`
- **Read-only on harness data** — never writes, moves, or locks a byte inside `~/.claude`, `~/.local/share/opencode`, or Cursor directories
- **Zero telemetry** — nothing leaves your machine unless you enable the optional Cursor adapter (which calls Cursor's own account API with *your* cookie)
- Index lives in `~/.harness-dashboard/` (SQLite + config + pricing cache)

## Install and run

Requires [Bun 1.4.0+](https://bun.sh).

```bash
git clone <repo> && cd harness-dashboard
bun install
bun dev          # http://127.0.0.1:4000
bun start        # production mode
bun test
bun run build    # standalone binary in dist/
```

Port **4000** is fixed — easy to remember, avoids the crowded 3000/8080/5173 range.

## Enabling Cursor (optional, unofficial, fragile)

1. Copy `.env.example` → `.env`
2. Set `CURSOR_SESSION_COOKIE` to your Cursor session token (from browser cookies)
3. Restart the dashboard

The cookie is **never** logged, written to SQLite, returned by any API route, or rendered in the UI.

This path uses an undocumented Cursor account endpoint. It will break without warning. On failure the UI shows: *Cursor session expired. Refresh the cookie in `.env`.* Last good data is kept.

## How cost is calculated

Two numbers, never conflated:

| Number | Meaning |
|---|---|
| **API-equivalent** | What the same tokens would cost at public list rates (LiteLLM pricing, with a bundled offline fallback). Always computed. |
| **Reported** | What the harness itself recorded, when trustworthy. Rendered as `—` when absent. Never fabricated. |

OpenCode often writes `cost: 0` on nonzero-token messages — we treat that as missing, not free.

Cache writes and cache reads are priced separately. Unknown models cost `$0` and appear under an "unpriced models" note.

## Real subscription usage (optional, unofficial, fragile)

The token totals above are what you *consumed*. They are not the same thing as how much of
your **subscription** you have burned — Anthropic weights the two differently, and cache
reads (often >90% of raw token volume) barely count against your limits.

To read the real numbers — the ones behind `claude.ai/settings/usage` and the `/usage`
command — set two values in `.env` yourself:

1. Open <https://claude.ai/settings/usage> while logged in
2. DevTools → Application → Cookies → `https://claude.ai` → copy `sessionKey` into
   `CLAUDE_SESSION_COOKIE`
3. DevTools → Network → press **Refresh** on that page → the request goes to
   `/api/organizations/<ORG_ID>/usage` → copy that `<ORG_ID>` into `CLAUDE_ORG_ID`
4. Restart the dashboard

The **Subscription** row then sits directly under Consumption, split by harness so it
lines up with the By harness cards above it:

| Harness | What it shows |
|---|---|
| **Claude Code** | Your real 5-hour and 7-day limit usage, with reset times |
| **OpenCode** | Nothing to show — it runs on your own API keys, so there is no quota pool. Its API-equivalent cost *is* your bill |
| **Cursor** | Request quota against your plan, when `CURSOR_SESSION_COOKIE` is set |

These are three independent readings, not one number split three ways — each vendor meters
differently.

Same caveats as the Cursor adapter: this is an undocumented endpoint and it will break
without warning. On failure the card keeps the last good reading and says why. The cookie
is **never** logged, written to SQLite, returned by any API route, or rendered in the UI.

**When the shape changes:** the parser looks for anything limit-shaped rather than fixed
field names, so a rename degrades to fewer buckets instead of a crash. `GET
/api/subscription/raw` returns the untouched payload (localhost only) so you can see what
actually came back and adjust `findBuckets` in `src/adapters/claude-subscription.ts`.

## Weekly percentages are estimates

Anthropic no longer publishes absolute weekly caps. Configure your plan (`pro` / `max5x` / `max20x`) and a baseline. The ring shows **est.** with a tooltip.

**Calibrate:** when you actually hit a limit, click Calibrate — the current 7-day token total becomes the new baseline (adjusted for plan multiplier).

## Production dependencies

| Package | Why |
|---|---|
| `react` | UI state and composition |
| `react-dom` | DOM renderer for React 19 |
| `react-is` | Peer required by Recharts for element type checks |
| `recharts` | Time-series and bar charts |
| `lucide-react` | Tree-shakeable icons |
| `tailwindcss` | Utility styling (CSS-first v4) |
| `bun-plugin-tailwind` | Tailwind processing inside Bun.serve HTML imports |

## License

MIT
