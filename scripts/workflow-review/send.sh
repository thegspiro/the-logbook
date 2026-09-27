#!/bin/sh
# Run a script from stdin in the workflow-review driver and print the result.
#
#   echo 'await wr.go("/members"); return wr.text("h1")' | scripts/workflow-review/send.sh
#   scripts/workflow-review/send.sh < step.js
set -eu
ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
STATE_DIR=${WR_STATE_DIR:-"$ROOT/.workflow-review"}
PORT=${WR_DRIVER_PORT:-9555}
TOKEN_FILE="$STATE_DIR/driver.token"
[ -f "$TOKEN_FILE" ] || { echo "driver is not running (no $TOKEN_FILE)" >&2; exit 1; }
# The token goes in a header file rather than on the command line, so it
# never shows up in the process list.
HEADERS=$(mktemp)
trap 'rm -f "$HEADERS"' EXIT
printf 'X-WR-Token: %s\n' "$(cat "$TOKEN_FILE")" >"$HEADERS"
curl -sS --max-time "${WR_TIMEOUT:-300}" -X POST -H @"$HEADERS" \
  --data-binary @- "http://127.0.0.1:$PORT/"
echo
