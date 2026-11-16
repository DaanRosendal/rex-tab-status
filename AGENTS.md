# AGENTS.md

A plugin for Claude Code and Codex that prefixes the Rex tab label with a state emoji. One background watcher follows the status that agents report to Rex, so no per-agent code exists. README.md describes the behavior.

## Layout

- `plugin/` is the only directory the hosts install. It holds the manifest, the SessionStart hook and the watcher in `src/`.
- `status.mjs` reduces the status records of a pane, then of a window, to one state. `label.mjs` decides the label to write. Both are pure.
- `tabs.mjs` reads Rex, applies those decisions and keeps the sleep timers. `themes.mjs` holds the icon presets, `rex-cli.mjs` runs `rex`, and `lock.mjs` is the per-server lock.
- `watcher.mjs` is the entry point: `start` (the hook), `watch`, `stop` and `doctor`. Run `doctor` as `node plugin/src/watcher.mjs doctor` to list each pane's status and flag agents that report none.
- `.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json` both point at `./plugin`.
- `tests/helpers/fake-rex.mjs` is a single-window Rex used by the unit tests.

## Commands

- `npm test`: unit tests. Needs Node 22 or newer.
- `npm run test:integration`: needs a real `rex` on the `PATH`. It starts its own server and emulates an agent.
- `npm run validate`: `claude plugin validate` on the plugin and the marketplace. Needs the `claude` CLI.
- `npm run format`: Prettier. CI fails on unformatted files.

## Gotchas

- The hook must print nothing and exit 0, because Claude adds its output to the conversation.
- A running watcher keeps its old code after an update. `start` replaces it when the plugin version is higher, so bump the version for every change that users should receive. A dev checkout keeps the same version, so run `node plugin/src/watcher.mjs stop` after editing.
- A lock file only names a holder when its pid is a process running `watcher.mjs watch`, because a recycled pid must neither block a claim nor be sent a signal. A stale lock is removed under a guard file so two claimers never remove each other's.
- A tab with a status-like name and no record of ours is never touched, so a watcher killed without cleanup leaves its prefix behind.
- Rex keeps `done` and `error` records after their program exits, so `reduceBlock` only counts a record whose owner is the foreground process or one of its ancestors.
- Rex trims labels on both ends and resets an empty one to `Window <hex>`. Our own writes come back as label events, so `isEcho` compares them with recent writes.
- Rex does not derive labels from the terminal title. The watcher takes the name from the title of the focused agent pane.
- Never remove an icon from a theme in `themes.mjs`. Tabs already showing it could no longer be cleaned.
- Hosts copy and fingerprint the whole plugin directory. Keep it to the files the manifest test lists, with no symlinks and only Node built-ins.

## Style

- Comments state timeless facts about the code, never the change that introduced them.
- No em dashes and no semicolons in prose, comments, the changelog or release notes.
- Keep changelog entries and commit messages short.

## Releasing

1. Set the version in `plugin/.claude-plugin/plugin.json`.
2. Add a `## X.Y.Z` section at the top of `CHANGELOG.md`. The release workflow publishes it as the release notes.
3. Run `npm test`, `npm run validate` and `npm run format:check`.
4. Merge to `master`, because both marketplaces and the README install commands track the default branch. Then `git tag -a vX.Y.Z -m "<short summary>"` and push the branch and the tag.

Pushing the tag runs `.github/workflows/release.yml`. It checks the tag against the manifest, runs the tests and creates the GitHub release. Do not create the release by hand.
