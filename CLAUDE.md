# CLAUDE.md

GNOME Shell extension showing Claude Code usage in the top bar. Ubuntu 24.04 /
GNOME 46 is the reference target.

## Commands

```bash
make setup        # npm install + activate .githooks (run once after cloning)
make lint         # eslint, GJS style guide, --max-warnings=0
make test         # vitest, unit tests only
make coverage     # vitest + the 100% threshold
make integration  # runs the real helper under gjs against a fixture HOME
make verify       # what pre-push and CI run: lint + coverage + integration + schema + metadata
make install      # copy to ~/.local/share/gnome-shell/extensions/ and compile schemas
make smoke        # enable/disable 10x, check the shell logged nothing new
```

Reload the shell after `make install`: X11 <kbd>Alt+F2</kbd> → `r`; Wayland needs a
re-login. Watch it with `journalctl -f -o cat /usr/bin/gnome-shell`.

## Architecture

Two processes, one JSON contract.

```
extension.js (inside gnome-shell)  ──spawns──▶  helper/main.js (gjs -m)
      ▲                                               │
      └──────────── snapshot JSON on stdout ──────────┘
```

**Nothing heavy runs inside gnome-shell.** No HTTP, no JSON parsing of the ~100 MB
of transcripts, no credential handling. The shell side is a view layer: it spawns
the helper asynchronously, normalizes what comes back, and draws it. Blocking the
shell's main loop freezes the entire desktop, so this split is not negotiable.

`src/lib/snapshot.js` defines the contract and is the trust boundary: whatever
arrives on the pipe goes through `normalizeSnapshot()` before anything touches it.

## Rules that are not style preferences

1. **Never write to `~/.claude/`.** The extension reads Claude Code's OAuth token
   and never refreshes it. Anthropic rotates the refresh token on use, so
   refreshing on a timer races Claude Code and the loser gets `invalid_grant` —
   signing the user out of their editor because a status icon wanted a fresher
   number. The cost is that an expired token freezes the percentages, and that is
   reported explicitly as `StatusCode.TOKEN_EXPIRED` rather than hidden.

2. **Never log or serialize a token.** Every error string goes through
   `redactError()` from `src/lib/redact.js` before it reaches a log, a status
   `reason`, or the cache. There are tests asserting this; do not weaken them.

3. **The helper emits codes, the shell emits prose.** The helper has no gettext
   domain. It returns `{code, since, params}`; `src/lib/status.js` turns that into
   sentences. Never put a user-facing English string in `src/helper/`.

4. **Logic is pure, GI access is an injected adapter.** `ledger.js` receives a
   `readChunk`, `limits.js` receives an `http`. This is why the coverage gate is
   achievable — and why it must stay that way when adding code.

5. **Every limit is rendered generically.** The UI iterates `account.limits`; it
   never looks for "the session one". A limit Anthropic turns on server-side must
   appear with no code change. Read only the `limits[]` array from the API, never
   the legacy `five_hour` / `seven_day` top-level keys.

## Testing and the gates

- `tests/unit/**` runs under **Node/vitest**, at **100% of lines, branches,
  functions and statements, per file**. The threshold is real: a new module with
  no test fails `make verify` and blocks the push.
- Files that import `gi://` or `resource:///org/gnome/shell/` cannot load in Node
  and are listed in `vitest.config.js` `coverage.exclude`, each with a reason.
  **That list is closed.** If new code needs to go on it, the logic is in the
  wrong file — extract it to a pure module beside it.
- `tests/integration/` runs the real helper under **gjs**, which is where
  GJS-versus-Node differences surface. Keep it.
- Hooks live in `.githooks/` (activated by `make setup`, no husky). `pre-commit`
  is lint + unit; `pre-push` is `make verify`. CI runs the same `make verify` —
  that is the gate that `--no-verify` cannot skip.

## GNOME specifics worth not rediscovering

- **`disable()` must undo everything `enable()` did**: destroy the indicator,
  `GLib.Source.remove()` every stored timeout id, disconnect signals, cancel the
  `Gio.Cancellable` and any `FileMonitor`, unload stylesheets, null the fields.
  This is the single most common reason extensions are rejected upstream.
- Nothing in the constructor, nothing at module import time.
- `console.log/warn/error` only — `log()` and `logError()` are lint errors.
- **`structuredClone` does not exist in GJS 1.80** (GNOME 46). Verified, not
  assumed. Spread or build objects explicitly.
- **Progress bars must carry the `slider` style class**:
  `new BarLevel.BarLevel({style_class: 'ai-usage-bar slider'})`. Yaru declares
  `-barlevel-*` only under `.slider`, so a bare `BarLevel` renders colourless. With
  the class it inherits Ubuntu's accent automatically across all ten Yaru accent
  variants and both light and dark, plus the overdrive red for the danger zone via
  `overdrive-start`. Never hardcode a colour.
- No `session-modes` in `metadata.json`: the extension should disable itself on
  the lock screen, which stops polling for free.
- **Read a Soup response's code as `message.statusCode`, never `get_status()`.**
  The getter marshals into the `Soup.Status` enum, which has 54 members and is
  missing 429 (and 425, 426, 428, 431, 451). On a rate limit it throws
  `429 is not a valid value for enumeration Status`, which turned the one response
  that most needs handling into a generic network error with no backoff. There is
  an eslint rule for it.

## Facts already verified on the target machine

Do not re-derive these; they cost real time to establish.

- Limits come from `GET https://api.anthropic.com/api/oauth/usage` with headers
  `Authorization: Bearer <token>` **and** `anthropic-beta: oauth-2025-04-20`.
  There is no `claude usage` CLI command.
- Per-day and per-model tokens exist only in `~/.claude/projects/**/*.jsonl`;
  the API returns `seven_day_breakdown: null`.
- **Transcripts write each assistant message several times as it streams** —
  measured 2507 lines for 1240 real messages. Without dedup by
  `message.id|requestId` every total is inflated ~2x.
- **The repeats are not identical: `output_tokens` grows across them** (a real key
  reads `[1, 1, 282]`), so the *last* occurrence is the complete one. The ledger
  therefore stores one record per message and lets a later occurrence overwrite
  it — accumulating into day/model buckets would make the earlier, partial value
  uncorrectable. Keeping the first occurrence undercounts output by ~15%.
- Verify token totals against `npx ccusage@latest daily`, an independent
  implementation. On frozen days the numbers must match **exactly**; that
  cross-check is what caught the bug above.
- Transcript offsets are **byte** offsets. A transcript with any non-ASCII
  character makes character indices diverge from byte indices, so the newline scan
  runs on the `Uint8Array` before decoding.
- Account identity (`emailAddress`, `organizationName`) is in `~/.claude.json`
  under `oauthAccount` — a sibling of the config dir, not inside it.
- `Intl` compact notation, `RelativeTimeFormat` and `DateTimeFormat` produce
  byte-identical output in Node 22 and GJS 1.80, which is why unit tests in Node
  are trustworthy for formatting.

## Conventions

- 4-space indent, single quotes, semicolons, ES modules everywhere.
- SPDX header on every file; GPL-3.0-or-later.
- JSDoc on exported functions — the lint config requires complete tags once a
  block exists.
- Comments explain *why*, especially where the non-obvious choice was deliberate.
  Do not add comments restating what the next line does.
