#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 Gustavo Eklund
#
# One-line installer:
#
#   curl -fsSL https://raw.githubusercontent.com/GustavoEklund/ai-usage-gnome-shell/main/install.sh | bash
#
# Piping a script into a shell is a trust decision. If you would rather not, the
# README has the two-step version: download this file, read it, then run it.
set -euo pipefail

UUID="ai-usage-gnome-shell@GustavoEklund.github.io"
REPO="GustavoEklund/ai-usage-gnome-shell"
REF="${AI_USAGE_VERSION:-main}"
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

uninstall() {
  gnome-extensions disable "$UUID" 2>/dev/null || true
  rm -rf "$DEST"
  say "Removed $DEST"
  say "Restart GNOME Shell to finish removing it."
  exit 0
}

[[ "${1:-}" == "--uninstall" ]] && uninstall

# --- checks -----------------------------------------------------------------

for tool in curl tar gjs glib-compile-schemas; do
  command -v "$tool" >/dev/null || die "$tool is required but not installed."
done

command -v gnome-shell >/dev/null || die "GNOME Shell was not found."
VERSION="$(gnome-shell --version | grep -oE '[0-9]+' | head -1)"
[[ "$VERSION" -ge 45 ]] || die "GNOME Shell 45 or newer is required (found $VERSION)."

# The helper talks HTTPS through libsoup. A GNOME desktop normally has this because
# gnome-shell itself uses it, but checking here turns a silent "couldn't read usage"
# in the menu into an install-time message that names the package to install.
gjs -c 'imports.gi.versions.Soup = "3.0"; imports.gi.Soup;' >/dev/null 2>&1 \
  || die "The libsoup 3 GObject bindings are missing. On Debian or Ubuntu: sudo apt install gir1.2-soup-3.0"

# --- fetch ------------------------------------------------------------------

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

say "Downloading $REPO@$REF"
curl -fsSL "https://github.com/$REPO/archive/$REF.tar.gz" \
  | tar -xz -C "$WORK" --strip-components=1

[[ -f "$WORK/src/metadata.json" ]] || die "The download did not contain the extension."

# --- install ----------------------------------------------------------------

say "Installing to $DEST"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -r "$WORK/src/." "$DEST/"
glib-compile-schemas "$DEST/schemas"

gnome-extensions enable "$UUID" 2>/dev/null || true

say "Installed."
echo
if [[ "${XDG_SESSION_TYPE:-}" == "wayland" ]]; then
  echo "  Log out and back in to load it (Wayland cannot restart the shell in place)."
else
  echo "  Press Alt+F2, type r, press Enter to restart GNOME Shell."
fi
echo "  Then enable it if it is not already on:"
echo "      gnome-extensions enable $UUID"
echo
echo "  It reads Claude Code's credentials and never modifies them."
echo "  Uninstall with: bash install.sh --uninstall"
