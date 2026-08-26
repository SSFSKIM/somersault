#!/usr/bin/env bash
# test/fixtures/browser-recorder.sh — bl5 T-LINKOPEN task 4's $BROWSER stand-in for the pty e2e.
# `linkOpen.ts`'s `openUrl()` resolves `$BROWSER` before falling back to `open`/`xdg-open` and spawns it as
# `spawn(command, [url], { stdio: ["ignore","ignore","ignore"], detached: true })` — this script IS that
# `command`, receiving the clicked URL as `$1` exactly as a real browser binary would. It writes the URL
# VERBATIM (no trailing newline) to `$LINKOPEN_RECORDER_OUT`, so a driving script can assert on the exact
# bytes a real click produced rather than merely "something got spawned".
set -euo pipefail
: "${LINKOPEN_RECORDER_OUT:?LINKOPEN_RECORDER_OUT must be set in the environment that launches ccx}"
printf '%s' "$1" > "$LINKOPEN_RECORDER_OUT"
