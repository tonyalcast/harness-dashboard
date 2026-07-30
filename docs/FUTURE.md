# Future (out of scope for current release)

- **Windows support** (paths, data dirs, and adapter discovery beyond macOS).
- Per-project / per-repo breakdown (schema already carries `project`; only the UI is missing).
- Multi-machine and custom-directory aggregation.
- Multi-user support.
- CLI mode (`bunx harness-dashboard usage` / `--live`).
- Native **menu bar tray** (zero footprint until click) — compact HUD covers the always-visible case today.
- Opt-in browser-cookie / Keychain import for subscription auth (explicit button; never silent).
- Git correlation: cost per commit, per branch, per PR.
- OpenCode parent/subagent session grouping.
- Public `/api/summary` contract for third-party tools to build on.
- Additional harnesses: Codex CLI, Amp, Aider.
- Reading real reported limits if and when the harnesses expose them locally.
- Burn-down charts vs ideal pace until reset; provider status/incident badges.

## Notes discovered during v1

- **OpenCode storage moved to SQLite.** Current installs keep usage in `~/.local/share/opencode/opencode.db` (`message.data` JSON). The adapter also still supports the documented `project/<slug>/storage/` and legacy `storage/message/` layouts when present.
- **Claude Code Keychain / `.credentials.json` ≠ `CLAUDE_SESSION_COOKIE`.** Subscription meters need the claude.ai `sessionKey` cookie; CLI OAuth tokens are a different auth surface.
