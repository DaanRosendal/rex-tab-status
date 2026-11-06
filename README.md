# rex-tab-status

A Claude Code and Codex plugin that prefixes the Rex tab label with an emoji for the agent's state:

| Emoji | State |
| --- | --- |
| 💤 | idle for five minutes after startup or an interruption |
| ⏳ | working, including while subagents run |
| ❓ | needs you: a permission prompt or a question |
| ✅ | done |
| ❌ | the turn ended on an error |

The tab follows the agent's terminal title. A tab you renamed yourself keeps your name and only the emoji changes. When the agent exits, the prefix is removed and an auto-named tab goes back to Rex's default.

Idle starts a five-minute countdown. During that wait, the previous ✅ or ❌ stays visible. A newly started or interrupted idle tab has no emoji. Work or a question cancels the countdown.

It does nothing outside Rex or when `rex` is not on the `PATH`.

## Install

### Claude Code

Needs a Claude Code version with function hooks. Tested on 2.1.310.

At the prompt of a terminal session:

```
/plugin marketplace add git@gitlab.com:daan.rosendal/rex-tab-status.git
/plugin install rex-tab-status@rex-tab-status
```

From a shell:

```bash
claude plugin marketplace add git@gitlab.com:daan.rosendal/rex-tab-status.git
claude plugin install rex-tab-status@rex-tab-status
```

### Codex

Needs Node.js 22.18 or newer and a Codex version that reports program status to Rex. Tested on Codex 0.166.0.

```bash
codex plugin marketplace add git@gitlab.com:daan.rosendal/rex-tab-status.git
codex plugin add rex-tab-status@rex-tab-status
```

Start a new Codex session and review the plugin's hook in `/hooks`. The hook starts one background watcher per Rex server. It listens only to Codex's native program status reports, including permission prompts, questions, and errors. It does not connect to a model or read conversation transcripts.

Codex can leave its native status at working while an async question waits. The watcher also recognizes Codex's `Action Required` title marker so those questions show ❓ until answered.

Both hosts use the same repository and plugin name. Claude loads `hooks/hooks.json` and its function hooks. Codex's marketplace installs only `codex/`, keeping Git metadata and tests out of the bundle it fingerprints at startup. Its manifest selects `hooks/codex.json` and its background command hook. Both adapters use `codex/hooks/rex.ts` to update labels.

## Develop

```bash
claude plugin validate .
claude plugin test .
node --test tests/codex.test.mjs
node --test tests/rex-integration.test.mjs
```

The integration test creates and removes its own Rex server and terminals.

To install the checkout in Codex:

```bash
codex plugin marketplace add "$PWD"
codex plugin add rex-tab-status@rex-tab-status
```

## Limits

Two Claude sessions in split panes of one Rex tab overwrite each other's emoji. In auto mode a tool call the classifier decides on can show ❓ for a moment.

Multiple Codex panes in one tab share an emoji. Waiting for you takes priority over working, then error, done, and idle. The title follows the first Codex pane. In a tab shared by Claude and Codex, Claude owns the label and the Codex watcher leaves it alone.
