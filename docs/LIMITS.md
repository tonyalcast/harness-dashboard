# Reading real rate limits

Status as of v1: **no reliable local source for Claude Code's 5-hour window**. The UI labels the window **Estimated** and infers blocks from event timestamps (a block opens at the first event after ≥5h of silence and closes 5h later).

## What we tried

| Location | Result |
|---|---|
| `~/.claude/projects/**/*.jsonl` | Usage tokens and timestamps only — no `resets_at` / utilization fields on assistant records |
| `~/.claude/.claude.json` | Account/migration flags; no rate-limit counters |
| `~/.claude/settings.json` | Theme/hooks only |
| `~/.claude/cache/` | Changelog / issue cache — unrelated |
| `~/.claude/session-env/` | Per-session env snapshots — no limit telemetry |
| `~/.claude/telemetry/` | Failed telemetry payloads; not a stable public schema |
| `~/Library/Caches/claude-cli-nodejs/` | MCP logs only |
| `~/.claude/statsig*` / GrowthBook files | Not present on this machine |

Claude Code surfaces `/usage` in the TUI, and community reports mention rate-limit telemetry with utilization + `resets_at`. That data appears to live server-side (or in memory) rather than in a durable local file we can read without calling Anthropic's API.

## What worked

- Inferring 5h blocks from timestamps (`src/core/window.ts`) — deterministic, offline, good enough for situational awareness.
- Labeling the UI **Estimated** with a tooltip explaining the gap vs a harness-reported value.

## What did not work

- Hunting for a `resets_at` / utilization JSON blob under `~/.claude/` outside `projects/`.
- Treating OpenCode session aggregates as a substitute for Anthropic's 5h window (different product, different limits).

## Where to look next

When Claude Code changes, re-check:

1. New files under `~/.claude/` whose names mention `usage`, `limit`, `rate`, or `quota`.
2. Assistant / system JSONL records for embedded `rate_limit` / `resets_at` fields.
3. Any local SQLite/LevelDB cache the CLI may add for `/usage`.
4. Official docs if Anthropic publishes a local usage file format.

If a reliable local source appears, wire it into `readReportedClaudeWindow()` and the UI will automatically switch the badge to **Reported**.
