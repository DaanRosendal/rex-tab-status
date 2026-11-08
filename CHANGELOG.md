# Changelog

## 0.5.1

- Stop the ❓ from flickering while background subagents run. Their permission asks are never dialogs, so they no longer show ❓ until the tool finishes.

## 0.5.0

- Split the repo into `claude/` and `codex/` plugin roots that share one status core in `shared/`. Both adapters now follow the same rules for working, blocked, done and the idle wait.
- A `/clear` or a second session start now restarts the five-minute idle wait.
- Add `harnesses.json`, so supporting another harness is one entry plus a thin adapter.

## 0.4.1

- Stop the ❓ from flashing in Claude Code's auto mode. A permission ask now shows ❓ only if it is still open after two seconds, so calls the classifier approves quickly never change the tab.

## 0.4.0

- Add icon themes: `default`, `ascii`, `minimal` and `circles`, selected with `REX_TAB_STATUS_THEME`.
- Keep the Codex watcher running through malformed Rex data, and stop it from dropping events during startup.
- Start the Codex watcher only inside a Rex terminal.
