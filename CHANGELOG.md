# Changelog

## 0.4.1

- Stop the ❓ from flashing in Claude Code's auto mode. A permission ask now shows ❓ only if it is still open after two seconds, so calls the classifier approves quickly never change the tab.

## 0.4.0

- Add icon themes: `default`, `ascii`, `minimal` and `circles`, selected with `REX_TAB_STATUS_THEME`.
- Keep the Codex watcher running through malformed Rex data, and stop it from dropping events during startup.
- Start the Codex watcher only inside a Rex terminal.
