# Contributing

Thanks for looking. This file covers the parts that are specific to this project;
the rest is ordinary.

## Getting set up

```bash
git clone https://github.com/GustavoEklund/ai-usage-gnome-shell
cd ai-usage-gnome-shell
make setup      # dependencies, and activates the versioned git hooks
make verify     # everything CI runs
make install    # install from the working tree
```

Then restart GNOME Shell — <kbd>Alt</kbd>+<kbd>F2</kbd>, `r`, <kbd>Enter</kbd> on
X11; log out and back in on Wayland — and watch it with
`journalctl -f -o cat /usr/bin/gnome-shell`.

You need GNOME Shell 45+, `gjs`, `gir1.2-soup-3.0`, `libglib2.0-bin`, Node 22+,
and `gettext` for `make pot`.

The helper runs on its own, which is usually the fastest way to see what the
extension sees:

```bash
gjs -m src/helper/main.js --pretty
gjs -m src/helper/main.js --now=2026-09-11T16:32:00Z   # pin the clock
```

## The one structural rule

**Logic is pure; every GI call is an injected adapter.** `ledger.js` receives a
`readChunk`, `limits.js` receives an `http`, `poller.js` hands its decisions to
`pollerLogic.js`. This is not style: it is what makes the coverage gate below
achievable, and it is why a bug in the JSONL parser can be reproduced in a test
instead of only on a machine with 100 MB of transcripts.

If new code cannot be tested under Node, the logic is in the wrong file.

## The gates

| When | What runs |
|---|---|
| `git commit` | `make lint` + unit tests |
| `git push` | `make verify` |
| CI, on push and PR | the same `make verify` |

`make verify` is lint, 100% coverage, the GJS integration test, the schema, and
the metadata/import/version validators. Hooks live in `.githooks/` and are
activated by `make setup`; there is no husky. A local hook can be skipped with
`--no-verify`, CI cannot, which is why they run the same command.

### Coverage

`src/lib/**` and `src/helper/**` are held at **100% of lines, branches, functions
and statements, per file**. A new module with no test fails the push.

The exclusion list in `vitest.config.js` is **closed**. It holds only files that
import `gi://` or `resource:///`, which no Node test runner can load: the UI
actors and the three thin Gio/Soup adapters. Each entry has a reason written next
to it. Adding to that list is not the fix for untestable code — extracting the
logic is.

Those exclusions are covered by other means: the adapters by the GJS integration
test, the UI by `make smoke`, which enables and disables the extension ten times
and fails if the shell logged anything. That is the only check that catches a
`disable()` which forgot to undo something.

### Things the gates learned the hard way

Each of these is now enforced, and each came from a real bug:

- `structuredClone` does not exist in GJS 1.80 — lint rule.
- `message.get_status()` throws on a 429, because `Soup.Status` has no such
  member; use `message.statusCode` — lint rule.
- `prefs.js` runs in a different process from the shell and has a different
  resource namespace — `tests/validate-imports.js`.
- An SVG whose first bytes are not `<svg` fails gdk-pixbuf's format sniffing and
  renders as nothing, silently — documented in `docs/adding-a-provider.md`.

## Changelog

**Every user-visible change adds a line to `## [Unreleased]` in
[CHANGELOG.md](CHANGELOG.md), in the same commit.** The format is
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/): `Added`, `Changed`,
`Deprecated`, `Removed`, `Fixed`, `Security`.

Write the entry for someone deciding whether to upgrade, not for someone reading
the diff. "Fixed a rate limit being reported as a network error, so the indicator
now backs off instead of retrying" beats "fix status handling".

Purely internal work — a refactor, a test, CI — needs no entry.

`make release` refuses to run on an empty `[Unreleased]`.

## Versioning

[Semantic Versioning](https://semver.org/), read as follows for a shell
extension:

| | When |
|---|---|
| **MAJOR** | Dropping a GNOME Shell version. Removing or renaming a GSettings key, which loses the user's setting. Anything that requires the user to act during an upgrade. |
| **MINOR** | A new provider, a new setting, a new section, a new supported GNOME version. |
| **PATCH** | Fixes, wording, theming, performance. |

The version lives in three files, and `tests/validate-version.js` fails the build
if they disagree: `package.json`, `src/metadata.json` (`version-name`), and the
newest heading in `CHANGELOG.md`.

`metadata.json` must never contain a `version` field. That integer belongs to
extensions.gnome.org, which assigns it at upload; setting it by hand breaks
updates there. The validator enforces this too.

The snapshot contract between the extension and the helper carries its own
`schemaVersion` in `src/lib/snapshot.js`. It is internal and unrelated to the
project's version — bump it only when the two halves stop being compatible, which
the extension detects and reports rather than misreading.

## Releasing

```bash
make release VERSION=0.2.0
git push origin main --follow-tags
```

`make release` promotes `[Unreleased]` to a dated heading, fixes up the changelog
links, bumps the version in all three files, regenerates the translation
template, runs `make verify`, then commits and tags.

Pushing the tag is what publishes: CI re-runs the full gate on the tagged tree,
checks the tag matches the version in it, builds the zip with
`gnome-extensions pack`, and creates the GitHub release with that version's
changelog section as the notes.

`install.sh` installs the newest release by default, so a release is what users
get. `AI_USAGE_VERSION=main` overrides it.

## Commits

Present tense, and say why. The subject is what changed; the body is the reason
somebody will want two years from now. If a bug was found by something other than
a test, say what found it — that is usually the most useful sentence in the
message.

## Adding a provider or a theme

See [docs/adding-a-provider.md](docs/adding-a-provider.md) and
[src/themes/README.md](src/themes/README.md). Neither needs a change to the UI.
