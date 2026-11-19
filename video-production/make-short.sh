#!/bin/sh
# Render one short: narration -> screen capture -> overlays -> 9:16 and 16:9 MP4.
#
# Usage: video-production/make-short.sh <short> [--check]
#   <short>    a folder under video-production/shorts/, e.g. 8a-rsvp
#   --check    also transcribe the vertical render, to confirm the narration
#
# Environment:
#   VOICE                     Piper voice from voices.txt (default en_US-ljspeech-high)
#   PLAYWRIGHT_CHROMIUM_PATH  a Chromium to use instead of Playwright's own download
#   PLAYWRIGHT_BASE_URL       a running frontend (default http://localhost:3000,
#                             started for you if nothing is listening)
#
# Output: video-production/build/<short>/render/<short>-{vertical,horizontal}.mp4
set -eu

HERE=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
REPO=$(dirname -- "$HERE")
PIPER_REVISION=e9ab671f2a0e50a701b34361136ba3e6a3a9eb0c

die() {
    printf 'make-short: %s\n' "$*" >&2
    exit 1
}

SHORT=${1:-}
CHECK=${2:-}
case $SHORT in
    '' | -*) die "usage: $0 <short> [--check]" ;;
    *[!a-z0-9-]*) die "short names are lowercase letters, digits and hyphens: $SHORT" ;;
esac
case $CHECK in
    '' | --check) ;;
    *) die "unknown option: $CHECK" ;;
esac

SHORT_DIR="$HERE/shorts/$SHORT"
BUILD="$HERE/build/$SHORT"
[ -f "$SHORT_DIR/shots.json" ] || die "no shots.json in $SHORT_DIR"
[ -f "$SHORT_DIR/capture.spec.ts" ] || die "no capture.spec.ts in $SHORT_DIR"

for tool in ffmpeg python3 node npx curl; do
    command -v "$tool" >/dev/null 2>&1 || die "$tool is required"
done
if command -v sha256sum >/dev/null 2>&1; then
    sha256() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
    sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
    die "sha256sum or shasum is required"
fi

# --- Python environment (narration and the transcription check) -----------
VENV="$HERE/build/.venv"
STAMP="$VENV/.requirements.sha256"
WANT=$(sha256 "$HERE/requirements.txt")
if [ ! -x "$VENV/bin/python" ] || [ "$(cat "$STAMP" 2>/dev/null || true)" != "$WANT" ]; then
    printf '==> Installing Python requirements into %s\n' "$VENV"
    python3 -m venv "$VENV"
    "$VENV/bin/python" -m pip install --quiet --upgrade pip
    "$VENV/bin/python" -m pip install --quiet -r "$HERE/requirements.txt"
    printf '%s\n' "$WANT" >"$STAMP"
fi
PY="$VENV/bin/python"

# --- Voice ----------------------------------------------------------------
VOICE=${VOICE:-en_US-ljspeech-high}
ENTRY=$(grep -v '^#' "$HERE/voices.txt" | awk -v v="$VOICE" '$1 == v { print $2, $3, $4 }')
[ -n "$ENTRY" ] || die "voice $VOICE is not in voices.txt"
# shellcheck disable=SC2086  # deliberate split into the three fields
set -- $ENTRY
VOICE_PATH=$1
VOICE_SHA=$2
CONFIG_SHA=$3
VOICES="$HERE/build/voices"
mkdir -p "$VOICES"
fetch() {
    file=$1
    expected=$2
    dest="$VOICES/$file"
    if [ ! -f "$dest" ] || [ "$(sha256 "$dest")" != "$expected" ]; then
        printf '==> Downloading %s\n' "$file"
        curl -fsSL -o "$dest.part" \
            "https://huggingface.co/rhasspy/piper-voices/resolve/$PIPER_REVISION/$VOICE_PATH/$file"
        actual=$(sha256 "$dest.part")
        if [ "$actual" != "$expected" ]; then
            rm -f "$dest.part"
            die "$file failed its checksum (got $actual)"
        fi
        mv "$dest.part" "$dest"
    fi
}
fetch "$VOICE.onnx" "$VOICE_SHA"
fetch "$VOICE.onnx.json" "$CONFIG_SHA"

# --- Stages ---------------------------------------------------------------
mkdir -p "$BUILD"

printf '==> Narration\n'
"$PY" -I "$HERE/lib/narrate.py" "$SHORT_DIR" "$BUILD" "$VOICES/$VOICE.onnx"

printf '==> Screen capture\n'
(cd "$REPO/frontend" && npx --no-install playwright test \
    --config "$HERE/playwright.config.ts" "shorts/$SHORT/capture.spec.ts")

printf '==> Overlays\n'
node "$HERE/lib/overlays.cjs" "$SHORT_DIR" "$BUILD"

printf '==> Compositing\n'
"$PY" -I "$HERE/lib/compose.py" "$SHORT_DIR" "$BUILD" v "$BUILD/render/$SHORT-vertical.mp4"
"$PY" -I "$HERE/lib/compose.py" "$SHORT_DIR" "$BUILD" h "$BUILD/render/$SHORT-horizontal.mp4"

if [ "$CHECK" = --check ]; then
    printf '==> Transcript of the vertical render\n'
    "$PY" -I "$HERE/lib/transcribe.py" "$BUILD/render/$SHORT-vertical.mp4"
fi

printf '==> Done: %s\n' "$BUILD/render"
