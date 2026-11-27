# Changelog

## [1.3.0] - 2026-11-27

### Added

- Add `REX_TAB_STATUS_WATCH`, a pattern for background tasks that mean the agent is waiting. A finished Claude Code tab with a matching task still running shows 📡 and never falls asleep ([`30ef7e5`](https://github.com/DaanRosendal/rex-tab-status/commit/30ef7e5))

## [1.2.0] - 2026-11-18

### Changed

- Show 💤 fifteen minutes after an agent finished or failed, up from five ([`4dc2876`](https://github.com/DaanRosendal/rex-tab-status/commit/4dc2876))

### Added

- Add `REX_TAB_STATUS_SLEEP_MINUTES` to choose how long a finished or failed tab waits before showing 💤, with `0` to keep the result forever ([`4dc2876`](https://github.com/DaanRosendal/rex-tab-status/commit/4dc2876))

## [1.1.0] - 2026-11-18

### Changed

- Follow `pi` and `opencode` by default, next to `claude-code` and `codex` ([`56e5902`](https://github.com/DaanRosendal/rex-tab-status/commit/56e5902))
- Say in the README that any agent that reports status to Rex works, with install commands for each ([`d7d8061`](https://github.com/DaanRosendal/rex-tab-status/commit/d7d8061)) ([`f4f984a`](https://github.com/DaanRosendal/rex-tab-status/commit/f4f984a))

### Added

- Add Pi support. `pi install` adds an extension that starts the watcher with each session ([`56e5902`](https://github.com/DaanRosendal/rex-tab-status/commit/56e5902))
- Add OpenCode 2.x support. `opencode plugin add` installs a TUI plugin that starts the watcher ([`990b87c`](https://github.com/DaanRosendal/rex-tab-status/commit/990b87c))

## [1.0.0] - 2026-11-16

### Changed

- **Breaking:** Rewrite around the status that Claude Code and Codex report to Rex. One background watcher mirrors it into the tab label, replacing the per-agent hooks and their timing logic ([`0af773f`](https://github.com/DaanRosendal/rex-tab-status/commit/0af773f)) ([#1](https://github.com/DaanRosendal/rex-tab-status/pull/1))
- **Breaking:** Require Claude Code 2.1.325 or newer and Codex 0.169 or newer ([`0af773f`](https://github.com/DaanRosendal/rex-tab-status/commit/0af773f))
- Install once for both agents from `plugin/`, and replace a running watcher when a newer plugin version starts ([`0af773f`](https://github.com/DaanRosendal/rex-tab-status/commit/0af773f))
- Show a permission ask from a background subagent as ❓ at once, and rejected credentials as ❌ ([`0af773f`](https://github.com/DaanRosendal/rex-tab-status/commit/0af773f))

### Added

- Add `REX_TAB_STATUS_APPS` to choose which agents to follow, and `REX_TAB_STATUS=off` to disable the plugin ([`0af773f`](https://github.com/DaanRosendal/rex-tab-status/commit/0af773f))
- Add `stop` and `doctor` commands to the watcher ([`0af773f`](https://github.com/DaanRosendal/rex-tab-status/commit/0af773f))

### Removed

- **Breaking:** Remove `harnesses.json`, the shared status core and the per-agent hooks ([`0af773f`](https://github.com/DaanRosendal/rex-tab-status/commit/0af773f))

## [0.5.1] - 2026-11-08

### Fixed

- Stop ❓ from flickering while background subagents run, by ignoring their permission asks ([`83267b7`](https://github.com/DaanRosendal/rex-tab-status/commit/83267b7))

## [0.5.0] - 2026-11-08

### Changed

- Share one status core between the Claude Code and Codex plugins, so both follow the same rules for working, blocked, done and the idle wait ([`67c4d77`](https://github.com/DaanRosendal/rex-tab-status/commit/67c4d77))
- Restart the idle wait on `/clear` and on every new session start ([`67c4d77`](https://github.com/DaanRosendal/rex-tab-status/commit/67c4d77))

### Added

- Add `harnesses.json`, so supporting another agent takes one entry and a thin adapter ([`67c4d77`](https://github.com/DaanRosendal/rex-tab-status/commit/67c4d77))
- Add `AGENTS.md` and a tag-triggered release workflow ([`6dabc8c`](https://github.com/DaanRosendal/rex-tab-status/commit/6dabc8c))

## [0.4.1] - 2026-11-08

### Fixed

- Show ❓ only for asks still open after two seconds, so auto mode no longer makes it flash ([`3daf2d5`](https://github.com/DaanRosendal/rex-tab-status/commit/3daf2d5))

## [0.4.0] - 2026-11-07

### Changed

- Split the watcher into tabs, lock and CLI modules ([`d546ee2`](https://github.com/DaanRosendal/rex-tab-status/commit/d546ee2))

### Added

- Add a security policy, npm scripts and CI ([`0bdafed`](https://github.com/DaanRosendal/rex-tab-status/commit/0bdafed))

## [0.3.3] - 2026-11-07

### Changed

- Show the idle emoji only after five minutes of inactivity ([`ecef1b8`](https://github.com/DaanRosendal/rex-tab-status/commit/ecef1b8))

### Added

- Add icon themes: `default`, `ascii`, `minimal` and `circles` ([`08e510d`](https://github.com/DaanRosendal/rex-tab-status/commit/08e510d))
- Add the MIT license and public install URLs ([`47f0ceb`](https://github.com/DaanRosendal/rex-tab-status/commit/47f0ceb))

### Fixed

- Keep the Codex watcher running through malformed Rex data ([`b6ea6c1`](https://github.com/DaanRosendal/rex-tab-status/commit/b6ea6c1))
- Start the Codex watcher only inside a Rex terminal ([`b6ea6c1`](https://github.com/DaanRosendal/rex-tab-status/commit/b6ea6c1))

## [0.3.2] - 2026-11-05

### Added

- Add Codex support: a background watcher shows the same states on the tab label ([`6679a5d`](https://github.com/DaanRosendal/rex-tab-status/commit/6679a5d))

## [0.2.0] - 2026-10-29

### Fixed

- Clear the ❓ as soon as a dialog is answered ([`725e4c1`](https://github.com/DaanRosendal/rex-tab-status/commit/725e4c1))

## [0.1.0] - 2026-10-27

### Added

- Show Claude Code's state on the Rex tab label as an emoji: idle, working, needs you, done or error ([`2653a95`](https://github.com/DaanRosendal/rex-tab-status/commit/2653a95))
- Leave the tab alone in non-interactive sessions, and show refusals as errors ([`c4eee98`](https://github.com/DaanRosendal/rex-tab-status/commit/c4eee98))

[1.2.0]: https://github.com/DaanRosendal/rex-tab-status/releases/tag/v1.2.0
[1.1.0]: https://github.com/DaanRosendal/rex-tab-status/releases/tag/v1.1.0
[1.0.0]: https://github.com/DaanRosendal/rex-tab-status/releases/tag/v1.0.0
[0.5.1]: https://github.com/DaanRosendal/rex-tab-status/releases/tag/v0.5.1
[0.5.0]: https://github.com/DaanRosendal/rex-tab-status/releases/tag/v0.5.0
[0.4.1]: https://github.com/DaanRosendal/rex-tab-status/releases/tag/v0.4.1
[0.4.0]: https://github.com/DaanRosendal/rex-tab-status/releases/tag/v0.4.0
[0.3.3]: https://github.com/DaanRosendal/rex-tab-status/releases/tag/v0.3.3
[0.3.2]: https://github.com/DaanRosendal/rex-tab-status/releases/tag/v0.3.2
[0.2.0]: https://github.com/DaanRosendal/rex-tab-status/releases/tag/v0.2.0
[0.1.0]: https://github.com/DaanRosendal/rex-tab-status/releases/tag/v0.1.0
