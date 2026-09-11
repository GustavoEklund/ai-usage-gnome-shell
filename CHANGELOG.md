# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
as interpreted in [CONTRIBUTING.md](CONTRIBUTING.md#versioning).

## [Unreleased]

### Fixed

- The "Claude is throttling the usage check" notice kept coming back every few
  minutes. The extension asked the API for the percentages on every refresh,
  sixty times an hour, from a budget it shares with Claude Code itself — and
  after being refused it returned to exactly the cadence that earned the refusal.

  It now asks only when there is something to learn: the percentages move when
  Claude Code runs, and Claude Code leaves a trace when it does, so a transcript
  newer than the last answer is the signal to ask again. Failing that, it asks
  every ten minutes anyway, since quotas also reset on a clock. Refusals now back
  off further each time and reset on success.

  Measured on a real machine, 91 of 93 transcripts had gone untouched for half an
  hour, so most of those requests were learning nothing.

### Changed

- The default refresh interval is two minutes rather than one. The countdown in
  the panel has always updated on its own and still does, so nothing looks
  slower.

## [0.1.0] - 2026-09-11

First release.

### Added

- Panel indicator showing the tracked limit's percentage and time until it
  resets, next to a robot icon drawn for Yaru's symbolic conventions.
- Menu with every limit the account exposes — session, weekly, and per-model
  weekly — each with its own bar and reset time. Limits are rendered
  generically, so one Anthropic turns on server-side appears without an update.
- Tokens per day for the current week, Sunday to Saturday, with the
  input/output/cache-write/cache-read breakdown on a line that follows the
  pointer and rests on today.
- Tokens per model for the current week.
- Preferences: which limit the panel tracks, whether to show the percentage and
  the countdown, refresh interval, a notification on problems, and a style
  override for desktops whose shell theme does not declare the bar properties.
- Explicit reporting for every degraded state, each naming what happened and
  what to do about it — including the command to run, with a copy button.
- One-line installer, and `--uninstall`.
- A provider interface: adding one is a directory and a line in the registry.
  See [docs/adding-a-provider.md](docs/adding-a-provider.md).
- Update notice and one-click update: the extension asks GitHub about releases
  when it starts and a few times a day after that, shows a row when a newer one
  exists, and installs it on request through `gnome-extensions install`. Can be
  turned off, which stops it contacting GitHub at all.

### Security

- Claude Code's credentials are read and never written. The extension does not
  refresh the OAuth token, because Anthropic rotates the refresh token on use
  and racing Claude Code for it would sign the user out of their editor.
- Every error string passes through a redactor before reaching a log, a status
  message or the cache, with tests asserting no token can escape.
- The update button will only download an asset attached to a release of this
  repository, will only proceed if the bytes are an archive, and unpacks through
  GNOME's own `gnome-extensions install` rather than by hand.


[Unreleased]: https://github.com/GustavoEklund/ai-usage-gnome-shell/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/GustavoEklund/ai-usage-gnome-shell/releases/tag/v0.1.0
