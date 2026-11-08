# AGENTS.md

A Claude Code mod (`hooks/register.ts`) and a Codex background watcher (`codex/hooks/watcher.mjs`) that prefix the Rex tab label with a state emoji. Both paint through `codex/hooks/paint.ts` and `codex/hooks/themes.ts`. README.md describes the behavior.

## Commands

- `npm test`: unit tests for the watcher, lock, tabs, themes and manifests. Needs Node 22.18 or newer.
- `npm run test:plugin`: tests for the Claude mod in `tests/register.test.ts`. Needs the `claude` CLI.
- `npm run validate`: `claude plugin validate .`. Run it after touching `hooks/`.
- `npm run test:integration`: needs a real `rex` on the `PATH`.
- `npm run format`: Prettier. CI fails on unformatted files.

## Gotchas

- A hooks module may import only relative files and `claude-code`. Anything else, such as `node:fs`, stops the whole hook from loading and the tab never changes. `npm run validate` catches it.
- A plugin installed from a local directory marketplace loads its hooks from the repo, not from `~/.claude/plugins/cache`. Reload with `/reload-plugins`. A session that started earlier keeps running the old code.
- `tool.check` returns `ask` with `approver: 'person'` even when auto mode's classifier approves the call within a second or two. `ASK_GRACE_MS` in `register.ts` keeps those from flashing ❓.
- Codex's marketplace installs only `codex/`. Anything Codex needs at runtime must live there.
- Never remove an icon from a theme in `themes.ts`. Tabs already showing it could no longer be cleaned.
- `.claude-plugin/plugin.json` and `codex/.codex-plugin/plugin.json` must carry the same version. A test enforces it.

## Style

- Comments state timeless facts about the code, never the change that introduced them.
- No em dashes and no semicolons in prose, comments, the changelog or release notes.
- Keep changelog entries and commit messages short.

## Releasing

1. Bump the version in both plugin manifests. Use a patch bump for fixes and a minor bump for features.
2. Add a `## X.Y.Z` section at the top of `CHANGELOG.md`. The release workflow publishes it as the release notes.
3. Run `npm test`, `npm run test:plugin`, `npm run validate` and `npm run format:check`.
4. Commit, then `git tag -a vX.Y.Z -m "<short summary>"` and push the branch and the tag.

Pushing the tag runs `.github/workflows/release.yml`. It checks the tag against both manifests, runs the tests and creates the GitHub release. Do not create the release by hand.
