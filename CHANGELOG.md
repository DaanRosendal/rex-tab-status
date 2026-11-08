# Changelog

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

[0.5.1]: https://github.com/DaanRosendal/rex-tab-status/releases/tag/v0.5.1
[0.5.0]: https://github.com/DaanRosendal/rex-tab-status/releases/tag/v0.5.0
[0.4.1]: https://github.com/DaanRosendal/rex-tab-status/releases/tag/v0.4.1
[0.4.0]: https://github.com/DaanRosendal/rex-tab-status/releases/tag/v0.4.0
[0.3.3]: https://github.com/DaanRosendal/rex-tab-status/releases/tag/v0.3.3
[0.3.2]: https://github.com/DaanRosendal/rex-tab-status/releases/tag/v0.3.2
[0.2.0]: https://github.com/DaanRosendal/rex-tab-status/releases/tag/v0.2.0
[0.1.0]: https://github.com/DaanRosendal/rex-tab-status/releases/tag/v0.1.0
