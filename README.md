# rex-tab-status

A Claude Code plugin that prefixes the Rex tab label with an emoji for Claude's state:

| Emoji | State |
| --- | --- |
| 💤 | idle: session started, or the turn was interrupted |
| ⏳ | working, including while subagents run |
| ❓ | needs you: a permission prompt or a question |
| ✅ | done |
| ❌ | the turn ended on an error |

The tab follows Claude's terminal title. A tab you renamed yourself keeps your name and only the emoji changes. When the session ends, the prefix is removed and an auto-named tab goes back to Rex's default.

It does nothing outside Rex or when `rex` is not on the `PATH`.

## Install

Needs a Claude Code version with function hooks. Tested on 2.1.310.

At the prompt of a terminal session:

```
/plugin marketplace add https://github.com/DaanRosendal/rex-tab-status.git
/plugin install rex-tab-status@rex-tab-status
```

From a shell:

```bash
claude plugin marketplace add https://github.com/DaanRosendal/rex-tab-status.git
claude plugin install rex-tab-status@rex-tab-status
```

## Develop

```bash
claude plugin validate .
claude plugin test .
```

## Limits

Two Claude sessions in split panes of one Rex tab overwrite each other's emoji. In auto mode a tool call the classifier decides on can show ❓ for a moment.
