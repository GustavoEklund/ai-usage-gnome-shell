#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
#
# Runs the real helper under gjs against a fixture configuration directory and
# compares the result with a golden snapshot.
#
# The unit tests run under Node, which is fast and gives per-file coverage but is
# not the runtime that ships. This is the counterpart: the same modules, loaded by
# gjs, reading a real disk through Gio. It is what catches things like
# structuredClone being absent, or a byte offset that only misbehaves once a real
# TextDecoder is involved.
#
# No network at all: the fixture has no usable credentials, so the provider never
# reaches the HTTP adapter, and --no-update-check keeps the release check from
# firing. A test that talks to GitHub is a test that fails when GitHub does.
set -euo pipefail

cd "$(dirname "$0")/../.."

command -v gjs >/dev/null || { echo "integration: gjs is not installed" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

CONFIG="$WORK/.claude"
mkdir -p "$CONFIG/projects/demo"

# An expired token: exercises the frozen-percentages path, and guarantees the
# helper makes no network request.
cat > "$CONFIG/.credentials.json" <<'JSON'
{"claudeAiOauth":{"accessToken":"fixture-token-not-real","expiresAt":1600000000000,
 "subscriptionType":"team","rateLimitTier":"default_claude_max_5x"}}
JSON

cat > "$WORK/.claude.json" <<'JSON'
{"oauthAccount":{"emailAddress":"fixture@example.com","organizationName":"Fixture Org"}}
JSON

cp tests/fixtures/transcript.jsonl "$CONFIG/projects/demo/session.jsonl"

# Pinned clock and pinned zone: the week, and therefore the whole snapshot, must
# not depend on the day the test runs or the machine it runs on.
NOW="2026-09-11T16:32:00Z"
export TZ=UTC

ACTUAL="$WORK/actual.json"
gjs -m src/helper/main.js \
  --config-dir="$CONFIG" \
  --cache-dir="$WORK/cache" \
  --now="$NOW" \
  --no-update-check \
  --pretty > "$ACTUAL"

# The snapshot carries a wall clock and the fixture's temporary paths; normalise
# both so the comparison is about the data, not about where it ran.
node tests/integration/normalize.js "$ACTUAL" "$CONFIG" > "$WORK/normalized.json"

if [[ "${ACCEPT_GOLDEN:-}" == "1" ]]; then
  cp "$WORK/normalized.json" tests/fixtures/golden-snapshot.json
  echo "integration: golden snapshot refreshed"
fi

if ! diff -u tests/fixtures/golden-snapshot.json "$WORK/normalized.json"; then
  echo "integration: the helper's output no longer matches the golden snapshot." >&2
  echo "If the change is intended, refresh it with: make integration-accept" >&2
  exit 1
fi

# Second run must read nothing new and produce the same answer: this is the
# incremental scan, which is the whole reason a refresh is cheap.
gjs -m src/helper/main.js \
  --config-dir="$CONFIG" --cache-dir="$WORK/cache" --now="$NOW" \
  --no-update-check --pretty > "$WORK/second.json"
node tests/integration/normalize.js "$WORK/second.json" "$CONFIG" > "$WORK/second-normalized.json"

if ! diff -q "$WORK/normalized.json" "$WORK/second-normalized.json" >/dev/null; then
  echo "integration: a second run disagreed with the first (incremental scan bug)." >&2
  diff -u "$WORK/normalized.json" "$WORK/second-normalized.json" >&2 || true
  exit 1
fi

# The cache must never hold a credential.
if grep -q 'fixture-token-not-real' "$WORK/cache/state.json"; then
  echo "integration: the cache contains the access token." >&2
  exit 1
fi

echo "integration: ok (golden snapshot, incremental rerun, no token in cache)"
