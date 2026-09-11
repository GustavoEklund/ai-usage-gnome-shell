# AI Usage

A GNOME Shell extension that keeps your Claude Code usage in the top bar, so you
find out how much of your plan is left *before* you plan the afternoon rather than
after you run out.

```
🤖 27% · 3h27m
```

Click it for the whole picture: every limit on the account with its reset time,
tokens per day for the current week, and tokens per model.

It is built to look like it shipped with Ubuntu — not one colour is written down
anywhere in this project. The bars inherit the shell theme's, which means they
follow your accent colour through all ten Yaru variants and both light and dark,
automatically.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/GustavoEklund/ai-usage-gnome-shell/main/install.sh | bash
```

Then restart GNOME Shell: press <kbd>Alt</kbd>+<kbd>F2</kbd>, type `r`, press
<kbd>Enter</kbd>. On Wayland, log out and back in instead.

Piping a script into a shell is a trust decision, and you are right to hesitate.
The two-step version reads the same:

```bash
curl -fsSLO https://raw.githubusercontent.com/GustavoEklund/ai-usage-gnome-shell/main/install.sh
less install.sh          # it is about 60 lines
bash install.sh
```

Uninstall with `bash install.sh --uninstall`.

**Requirements:** GNOME Shell 45 or newer, `gjs`, and Claude Code signed in.
Verified on Ubuntu 24.04 (GNOME 46); 47 and 48 should work but are not yet tested.

## What it shows

| Section | Where it comes from |
|---|---|
| Session, weekly and per-model percentages, with reset times | Anthropic's usage API, using the token Claude Code already stored |
| Tokens per day, Sunday to Saturday | the session transcripts in `~/.claude/projects` |
| Tokens per model this week | the same transcripts |

Limits are rendered generically. When Anthropic turns on a new one server-side it
appears in the menu on its own, with no update to this extension.

Token counts are the full total — input, output, cache writes and cache reads —
the same figure `ccusage` and Claude Code's own `/usage` report. Cache reads
dominate it (around 97% in practice), so each row also shows the breakdown.

## It never touches your credentials

The extension reads the token Claude Code saved. It never writes to `~/.claude`,
and it never refreshes the token.

That is a deliberate limitation, not an oversight. Anthropic rotates the refresh
token when it is used, so an extension refreshing on a timer races Claude Code
doing the same — and the loser of that race gets signed out of their editor. No
status icon is worth that.

The cost is that when the token expires the percentages freeze. So the menu says
so, in as many words, and tells you how to fix it:

> **Usage percentages are frozen**
> Claude Code's sign-in token expired 2 hr. ago. This extension only ever reads
> that token, never refreshes it, so the percentages are the last ones it could
> fetch. Token counts come from local files and are still current.
> *Using Claude Code refreshes the token, and the percentages catch up on their
> own. To refresh it without starting a session, run the command below.*
> `claude auth status`  [Copy]

The extension also watches the credentials file, so the moment Claude Code signs
in or refreshes, the panel catches up without waiting for the next poll.

## How it is built

Two processes. The extension inside `gnome-shell` is a view layer; a separate
helper does the work.

```
extension.js (inside gnome-shell)  ──spawns──▶  helper/main.js (gjs -m)
      ▲                                               │
      └──────────── snapshot JSON on stdout ──────────┘
```

Nothing heavy runs in the shell's process: no HTTP, no credential handling, and no
parsing of the ~100 MB of transcripts. Blocking that main loop freezes the whole
desktop.

You can run the helper yourself to see exactly what the extension sees:

```bash
gjs -m src/helper/main.js --pretty
```

## Adding a provider

Claude is the only provider today, but nothing above is Claude-specific. A
provider is a directory exporting `discoverAccounts` and `fetchAccount`, plus one
line in the registry — see [docs/adding-a-provider.md](docs/adding-a-provider.md).

## Another distribution, another look

Nothing needs porting to work: with the default `auto` style the extension takes
its colours from whatever shell theme is installed. If you want a different look
anyway, [src/themes/README.md](src/themes/README.md) documents every style class
and how to add a variant.

## Development

```bash
make setup     # dependencies, and activate the versioned git hooks
make verify    # lint + 100% coverage + integration + schema + metadata
make install   # install from the working tree
```

The pure modules are held at 100% coverage per file, and the exclusion list in
`vitest.config.js` is closed: if new code cannot be tested in Node, the logic is in
the wrong file. Details in [CLAUDE.md](CLAUDE.md).

## Licence

GPL-3.0-or-later.

The robot icon is original work, released under the same licence. The Claude mark
in the provider row is Anthropic's trademark, reproduced nominatively — to name
the service the numbers come from — and is not covered by this project's licence,
nor does its use imply any endorsement or affiliation.
