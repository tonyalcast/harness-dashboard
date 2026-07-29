# Future (out of scope for v1)

- Per-project / per-repo breakdown (schema already carries `project`; only the UI is missing).
- Multi-machine and custom-directory aggregation.
- Multi-user support.
- CLI mode (`bunx harness-dashboard --live`).
- Git correlation: cost per commit, per branch, per PR.
- OpenCode parent/subagent session grouping.
- Public `/api/summary` contract for third-party tools to build on.
- Additional harnesses: Codex CLI, Amp, Aider.
- Reading real reported limits if and when the harnesses expose them locally.

## Notes discovered during v1

- **OpenCode storage moved to SQLite.** Current installs keep usage in `~/.local/share/opencode/opencode.db` (`message.data` JSON). The adapter also still supports the documented `project/<slug>/storage/` and legacy `storage/message/` layouts when present.
