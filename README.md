# rex-tab-status

Shows what your coding agent is doing in its [Rex](https://www.superlogical.com/rex) tab label. It works with Claude Code, Codex and any agent that reports its status to Rex.

| Emoji | State                                        |
| ----- | -------------------------------------------- |
| ⏳    | working, including while subagents run       |
| ❓    | needs you: a permission prompt or a question |
| ✅    | done                                         |
| ❌    | failed, or needs new credentials             |
| 💤    | finished or failed five minutes ago          |

A tab you renamed keeps its name and only the emoji changes. The prefix is removed when the agent exits.

Rex already marks unfocused tabs with a spinner and blocked symbols. This puts the state in the label, so you can read it on any tab, and adds themes.

## Requirements

- Rex, with `rex` on the `PATH`. Outside a Rex terminal the plugin does nothing.
- Node.js 22 or newer.
- Claude Code 2.1.325 or newer, or Codex 0.169 or newer.

## Install

Claude Code:

```bash
claude plugin marketplace add https://github.com/DaanRosendal/rex-tab-status.git
claude plugin install rex-tab-status@rex-tab-status
```

Codex:

```bash
codex plugin marketplace add https://github.com/DaanRosendal/rex-tab-status.git
codex plugin add rex-tab-status@rex-tab-status
```

Start a new session. In Codex, review and trust the hook in `/hooks`.

The hook starts one background watcher per Rex server. It reads Rex's status events only. It never reads transcripts and never calls a model.

## Settings

| Variable               | Effect                                                                       |
| ---------------------- | ---------------------------------------------------------------------------- |
| `REX_TAB_STATUS_THEME` | `default`, `ascii`, `minimal` or `circles`                                   |
| `REX_TAB_STATUS_APPS`  | Apps to follow, comma separated. Defaults to `claude-code,codex`. `*` is all |
| `REX_TAB_STATUS`       | Set to `off` to disable the plugin                                           |

| Theme     | Working | Needs you | Done   | Failed | Asleep |
| --------- | ------- | --------- | ------ | ------ | ------ |
| `default` | ⏳      | ❓        | ✅     | ❌     | 💤     |
| `ascii`   | `[..]`  | `[?]`     | `[ok]` | `[x]`  | `[zz]` |
| `minimal` | ◐       | ◆         | ✓      | ✗      | ○      |
| `circles` | 🟡      | 🔴        | 🟢     | ⛔     | ⚪     |

The watcher reads the settings when it starts. To pass one to Claude Code, add it to the `env` block of `~/.claude/settings.json`, then stop the watcher so the next session starts a new one.

## Stop or uninstall

Stopping the watcher restores your tab labels, and the next session starts it again:

```bash
pkill -f 'rex-tab-status.*watcher.mjs watch'
```

To remove the plugin, run `claude plugin uninstall rex-tab-status` or `codex plugin remove rex-tab-status`, then stop the watcher.

## Troubleshooting

If a tab never changes, check that the agent reports a status:

```bash
rex block call -b "$REX_BLOCK" program_status
```

An empty list means the agent is too old or does not report to Rex.

## Limits

- Two agents in one tab share one emoji. The highest-priority state wins, and the name comes from the focused agent pane.
- Only apps in `REX_TAB_STATUS_APPS` count, so other programs that report a status never paint a tab.

See [AGENTS.md](AGENTS.md) to contribute and [CHANGELOG.md](CHANGELOG.md) for releases. Licensed under the [MIT License](LICENSE).
