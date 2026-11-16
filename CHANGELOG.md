# Changelog

## 1.0.0

- Rewrite around the status that Claude Code and Codex report to Rex. One background watcher mirrors it into the tab label, so the per-agent hooks and their timing guesses are gone.
- Any agent that reports its status to Rex works. `REX_TAB_STATUS_APPS` lists the allowed apps and defaults to `claude-code,codex`.
- A permission ask from a background subagent shows ❓ at once. Rejected credentials show ❌.
- The plugin installs once for both agents from `plugin/`. A newer plugin version replaces the running watcher.
- Add `REX_TAB_STATUS=off` to disable it. If you ran 0.x, stop its old watchers once with the command in the README.
- Require Claude Code 2.1.325 or newer and Codex 0.169 or newer.

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
