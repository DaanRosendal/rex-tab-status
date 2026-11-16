# rex-tab-status

Shows what your coding agent is doing in its [Rex](https://www.superlogical.com/rex) tab label.

| State                                        | `default` | `ascii` | `minimal` | `circles` |
| -------------------------------------------- | --------- | ------- | --------- | --------- |
| working, including while subagents run       | ⏳        | `[..]`  | ◐         | 🟡        |
| needs you: a permission prompt or a question | ❓        | `[?]`   | ◆         | 🔴        |
| done                                         | ✅        | `[ok]`  | ✓         | 🟢        |
| failed, or needs new credentials             | ❌        | `[x]`   | ✗         | ⛔        |
| finished or failed five minutes ago          | 💤        | `[zz]`  | ○         | ⚪        |

A tab then reads like `⏳ Fix login redirect`. The name comes from the agent's terminal title, unless you renamed the tab. Then it keeps your name and only the emoji changes. Rex already marks unfocused tabs with a spinner, and this puts the state in the label itself.

## Requirements

- Rex, with `rex` on your `PATH`
- Node.js 22 or newer
- Claude Code or Codex with plugin support. Tested with Claude Code 2.1.325 and Codex 0.169.

## Install

```bash
# Claude Code
claude plugin marketplace add https://github.com/DaanRosendal/rex-tab-status.git
claude plugin install rex-tab-status@rex-tab-status

# Codex
codex plugin marketplace add https://github.com/DaanRosendal/rex-tab-status.git
codex plugin add rex-tab-status@rex-tab-status
```

Start a new session. In Codex, trust the hook in `/hooks`.

A background watcher reads Rex's status and tab titles, never your conversations.

## Settings

Put these in your shell profile, then stop the watcher once so it picks them up.

```bash
export REX_TAB_STATUS_THEME=ascii              # tabs read [..] Fix login redirect
export REX_TAB_STATUS_APPS=claude-code,aider   # which agents to follow
export REX_TAB_STATUS=off                      # turn it off
```

The theme is one of the table columns. By default it follows `claude-code` and `codex`.

## Stop or uninstall

```bash
pkill -f 'rex-tab-status.*watcher.mjs watch'
```

This restores your tab labels, and the next session starts the watcher again. Run it once after upgrading from 0.x. To uninstall, remove the plugin with `claude plugin uninstall rex-tab-status` or `codex plugin remove rex-tab-status@rex-tab-status`, then run the command above.

## Troubleshooting

If a tab never changes, check that your agent reports a status. An empty list means it is too old or does not report to Rex.

```bash
rex block call -b "$REX_BLOCK" program_status
```

See [AGENTS.md](AGENTS.md) to contribute and [CHANGELOG.md](CHANGELOG.md) for releases. Licensed under the [MIT License](LICENSE).
