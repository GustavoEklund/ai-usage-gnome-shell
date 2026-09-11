#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Enables and disables the installed extension repeatedly, then reports anything
# the shell logged while doing it. This is the check for the one thing unit tests
# cannot see: that disable() really does undo everything enable() did. A leaked
# timer or an undestroyed actor shows up here as a warning, and nowhere else.
#
# Run it against an installed build: make install && make smoke
set -euo pipefail

UUID="ai-usage-gnome-shell@GustavoEklund.github.io"
ROUNDS="${ROUNDS:-10}"

command -v gnome-extensions >/dev/null || { echo "smoke: gnome-extensions not found" >&2; exit 1; }

if ! gnome-extensions info "$UUID" >/dev/null 2>&1; then
  echo "smoke: $UUID is not installed, or GNOME Shell has not rescanned yet." >&2
  echo "       Run 'make install', then restart the shell (X11: Alt+F2, r)." >&2
  exit 1
fi

SINCE="$(date '+%Y-%m-%d %H:%M:%S')"
echo "smoke: cycling $ROUNDS times"

for _ in $(seq "$ROUNDS"); do
  gnome-extensions enable "$UUID"
  sleep 0.4
  gnome-extensions disable "$UUID"
  sleep 0.2
done

gnome-extensions enable "$UUID"
sleep 1

# Read only what gnome-shell itself wrote. Filtering the whole user journal by
# name matches the D-Bus activation records for the `gnome-extensions` commands
# this script runs, whose command line contains the uuid — noise that looks
# exactly like a failure.
echo "smoke: what the shell logged"
LOG="$(journalctl --user --since "$SINCE" _COMM=gnome-shell -o cat 2>/dev/null \
       | grep -iE "ai-usage|ai_usage|JS ERROR|St-WARNING|Clutter-WARNING|GLib-GObject" \
       || true)"

if [[ -n "$LOG" ]]; then
  echo "$LOG"
  echo
  echo "smoke: the shell logged something about this extension (see above)." >&2
  exit 1
fi

echo "smoke: ok (nothing logged over $ROUNDS enable/disable cycles)"
