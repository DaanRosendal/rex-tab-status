# AGENTS.md

A Claude Code mod (`claude/hooks/register.ts`) and a Codex background watcher (`codex/hooks/watcher.mjs`) that prefix the Rex tab label with a state emoji. README.md describes the behavior.

## Layout

- `shared/` is the source of truth for code every harness uses: `core.ts` (the pure status logic), `paint.ts` and `themes.ts`.
- `shared/core.ts` turns normalized events into the status to show: working, blocked, done, the idle wait and the ask grace. It reads no clock. `step` returns the timers it wants running, and each adapter starts them with its own clock through `Timers`.
- `claude/` and `codex/` are complete plugin roots. Each holds its manifest, hook config, adapter and a generated copy of `shared/` in `hooks/vendor/`.
- `harnesses.json` lists every harness: root, manifest, marketplace and vendor directory. Scripts and tests read it, so a new harness is one entry.
- Never edit `hooks/vendor/`. Edit `shared/`, then run `npm run sync`.

## Commands

- `npm test`: unit tests for the watcher, lock, tabs, themes, manifests and vendored copies. Needs Node 22.18 or newer.
- `npm run test:plugin`: tests for the Claude mod in `claude/tests/`. Needs the `claude` CLI.
- `npm run validate`: `claude plugin validate claude`. Run it after touching `claude/hooks/`.
- `npm run sync`: copy `shared/` into every harness. `npm run sync:check` fails on drift.
- `npm run version:check`: fail when a manifest disagrees with `package.json`.
- `npm run test:integration`: needs a real `rex` on the `PATH`.
- `npm run format`: Prettier. CI fails on unformatted files.

## Gotchas

- A hooks module may import only relative files and `claude-code`. Anything else, such as `node:fs`, stops the whole hook from loading and the tab never changes. `npm run validate` catches it. Keep `shared/` free of `node:*` imports for the same reason.
- An installed plugin contains only its own root, so a harness can never import from outside it. That is why `shared/` is copied in.
- A plugin installed from a local directory marketplace loads its hooks from the repo, not from `~/.claude/plugins/cache`. Reload with `/reload-plugins`. A session that started earlier keeps running the old code.
- `tool.check` returns `ask` with `approver: 'person'` even when auto mode's classifier approves the call within a second or two. `ASK_GRACE_MS` in `register.ts` keeps those from flashing ❓.
- Never remove an icon from a theme in `themes.ts`. Tabs already showing it could no longer be cleaned.
- `lock.mjs` and `rex-cli.mjs` are identical in rex-session-names. Keep both copies in sync.

## Style

- Comments state timeless facts about the code, never the change that introduced them.
- No em dashes and no semicolons in prose, comments, the changelog or release notes.
- Keep changelog entries and commit messages short.

## Adding a harness

1. Create `<name>/` as the plugin root with its manifest and hook config.
2. Add an entry to `harnesses.json`.
3. Write a thin adapter that maps the host's events to `core.ts` events, starts the timers `step` asks for, and paints `shown` with `paint.ts`. It imports only from its own `hooks/vendor/`.
4. Run `npm run sync`.
5. Add the marketplace file, and tests for the adapter.

## Releasing

1. Run `npm run bump -- X.Y.Z`. Use a patch bump for fixes and a minor bump for features.
2. Add a `## X.Y.Z` section at the top of `CHANGELOG.md`. The release workflow publishes it as the release notes.
3. Run `npm test`, `npm run test:plugin`, `npm run validate`, `npm run sync:check` and `npm run format:check`.
4. Commit, then `git tag -a vX.Y.Z -m "<short summary>"` and push the branch and the tag.

Pushing the tag runs `.github/workflows/release.yml`. It checks the tag against every manifest, runs the tests and creates the GitHub release. Do not create the release by hand.
