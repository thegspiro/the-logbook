#!/bin/bash
# Run the repository's completion gate when a turn ends, and refuse the stop
# while it is red.
#
# CLAUDE.md's "Completion Gate" is the rule that a task is not finished while
# `tsc --noEmit`, `flake8`, `black --check` or `eslint` reports anything — and
# until now it was a rule an agent had to remember. Pitfall #16 records what
# that is worth on its own: the `window.confirm` ban held across 58 call sites
# on review discipline alone and then regressed anyway, "because unlike every
# other invariant in this document it had no machine check behind it". A hook
# cannot forget, so the gate stops depending on anyone recalling it at the one
# moment they are least likely to.
#
# It blocks rather than warns because a warning at the end of a turn is read
# after the turn is over, which is the same as not being read.
set -uo pipefail

INPUT=$(cat 2>/dev/null || true)

# A blocked stop re-enters the model, which stops again. Claude Code sets
# stop_hook_active on that second stop; without this the pair would loop until
# the gate happened to go green.
if [ "$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)" = "true" ]; then
  exit 0
fi

REPO="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$REPO" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

# ── What changed ─────────────────────────────────────────────────────────────
# The working tree plus everything this branch adds over its base, so the gate
# still covers work that has already been committed — the common case, since a
# turn usually ends after a commit.
# "Not yet published" is the boundary, not the branch point: a clone whose
# origin/main is stale reports its whole recent history as this branch's diff
# (396 files, when this was written), which would run a full frontend
# typecheck and lint at the end of every docs-only turn. Commits that already
# exist on a remote have been through CI; what this session still owns is
# exactly what it has not pushed.
BASE_COMMIT=""
OLDEST_UNPUSHED=$(git rev-list HEAD --not --remotes 2>/dev/null | tail -n 1)
if [ -n "$OLDEST_UNPUSHED" ]; then
  BASE_COMMIT=$(git rev-parse --verify --quiet "${OLDEST_UNPUSHED}^" 2>/dev/null) || BASE_COMMIT=""
fi

changed_files() {
  git status --porcelain=v1 2>/dev/null | awk '{ print $NF }'
  if [ -n "$BASE_COMMIT" ]; then
    git diff --name-only "$BASE_COMMIT" HEAD 2>/dev/null
  elif [ -n "$OLDEST_UNPUSHED" ]; then
    # Unpushed root commit: nothing to diff against, so take its own tree.
    git show --pretty=format: --name-only HEAD 2>/dev/null
  fi
}

CHANGED=$(changed_files | sort -u)
[ -n "$CHANGED" ] || exit 0

TS_FILES=$(printf '%s\n' "$CHANGED" | grep -E '^frontend/.*\.(ts|tsx)$' || true)
PY_FILES=$(printf '%s\n' "$CHANGED" | grep -E '^backend/.*\.py$' || true)
[ -n "$TS_FILES$PY_FILES" ] || exit 0

# ── Skip a tree already proven green ─────────────────────────────────────────
# The frontend half is a whole-project typecheck plus a whole-project lint, so
# re-running it for a turn that changed nothing since the last pass is pure
# latency. Keyed on HEAD plus the exact working-tree state, so any edit at all
# invalidates it.
# The signature hashes file CONTENT, not just `git status`. Two different
# edits to the same file produce identical porcelain output ("?? file" or
# " M file"), so a status-only key would treat a second, broken edit as the
# tree that already passed and skip the gate on it.
STATE_DIR="$(git rev-parse --git-dir)/claude"
STATE_FILE="$STATE_DIR/completion-gate.ok"
SIG=$( {
    git rev-parse HEAD 2>/dev/null
    git status --porcelain 2>/dev/null
    printf '%s\n' "$TS_FILES" "$PY_FILES" | while IFS= read -r f; do
      [ -n "$f" ] && [ -f "$REPO/$f" ] && sha1sum "$REPO/$f"
    done
  } | sha1sum | cut -d' ' -f1 )
if [ -f "$STATE_FILE" ] && [ "$(cat "$STATE_FILE" 2>/dev/null)" = "$SIG" ]; then
  exit 0
fi

FAILURES=""
SKIPPED=""

# Cap each tool's output: the reason field is read by the model, and a
# thousand-line tsc dump crowds out the rest of the turn's context.
record_failure() {
  FAILURES="${FAILURES}
=== $1 ===
$(printf '%s\n' "$2" | tail -n 40)
"
}

run_check() {
  local name="$1"; shift
  local out
  if ! out=$("$@" 2>&1); then
    record_failure "$name" "$out"
  fi
}

if [ -n "$TS_FILES" ]; then
  if [ -d "$REPO/frontend/node_modules" ] && command -v npm >/dev/null 2>&1; then
    # npm run typecheck, not a bare tsc: the wrapper resolves the aliased
    # TypeScript 7 the project builds with, while `tsc` on PATH is the 5.9.3
    # typescript-eslint pins. See CLAUDE.md § "Two TypeScript installs".
    run_check "frontend typecheck (npm run typecheck)" \
      npm --prefix "$REPO/frontend" run --silent typecheck

    # eslint over the changed files rather than the whole project. `npm run
    # lint` takes minutes on this codebase, which at the end of every turn is
    # a tax nobody would accept; CI still lints the full tree. --max-warnings
    # 10 is the repo's own budget, and applying it to a subset only makes the
    # gate stricter than CI, never looser.
    REL_TS=""
    while IFS= read -r f; do
      [ -n "$f" ] && [ -f "$REPO/$f" ] && REL_TS="$REL_TS${f#frontend/}
"
    done <<< "$TS_FILES"
    if [ -n "$REL_TS" ]; then
      # shellcheck disable=SC2086  # deliberate word-splitting into an argv list
      if ! OUT=$( cd "$REPO/frontend" && npx --no-install eslint --max-warnings 10 $REL_TS 2>&1 ); then
        record_failure "frontend eslint (changed files)" "$OUT"
      fi
    fi
  else
    SKIPPED="${SKIPPED}frontend checks (frontend/node_modules or npm missing); "
  fi
fi

if [ -n "$PY_FILES" ]; then
  # Relative to backend/ so .flake8 and pyproject.toml are the ones that apply.
  REL_PY=$(printf '%s\n' "$PY_FILES" | sed 's|^backend/||')
  EXISTING_PY=""
  while IFS= read -r f; do
    [ -n "$f" ] && [ -f "$REPO/backend/$f" ] && EXISTING_PY="$EXISTING_PY$f
"
  done <<< "$REL_PY"

  if [ -n "$EXISTING_PY" ]; then
    if command -v python3 >/dev/null 2>&1; then
      # Command substitution rather than a temp file: two sessions running the
      # gate at once would otherwise race on the same path.
      # shellcheck disable=SC2086  # deliberate word-splitting into an argv list
      if ! OUT=$( cd "$REPO/backend" && python3 -m flake8 $EXISTING_PY 2>&1 ); then
        record_failure "backend flake8" "$OUT"
      fi
      # shellcheck disable=SC2086
      if ! OUT=$( cd "$REPO/backend" && python3 -m black --check $EXISTING_PY 2>&1 ); then
        record_failure "backend black --check" "$OUT"
      fi
    else
      SKIPPED="${SKIPPED}backend checks (python3 missing); "
    fi
  fi
fi

# A skipped check must never read as a clean gate — CLAUDE.md is explicit that
# an unavailable tool is reported, not silently passed. It does not block,
# though: a missing interpreter is not something the model can fix by working
# longer, and blocking on it would strand the session.
NOTE=""
[ -n "$SKIPPED" ] && NOTE="Completion gate incomplete - skipped: ${SKIPPED%%; }"

# Exactly one JSON object reaches stdout. Emitting the skip notice separately
# from the block decision would put two objects on the stream and neither
# would parse.
if [ -n "$FAILURES" ]; then
  jq -n --arg r "The completion gate is red. CLAUDE.md requires every error to be fixed at its root cause before a task is complete - no # noqa, no @ts-ignore, no cast to any, no deleted test. Fix these, including any that predate this turn, then finish.
$FAILURES" --arg m "$NOTE" \
    '{decision: "block", reason: $r} + (if $m == "" then {} else {systemMessage: $m} end)'
  exit 0
fi

if [ -n "$NOTE" ]; then
  # No marker written: a gate that did not fully run has not proven anything,
  # so the next turn must try again rather than inherit a pass.
  jq -n --arg m "$NOTE" '{systemMessage: $m}'
  exit 0
fi

mkdir -p "$STATE_DIR" 2>/dev/null && printf '%s' "$SIG" > "$STATE_FILE" 2>/dev/null
exit 0
