#!/bin/sh
# Check that a commit's Alembic chain still has one head once merged with main.
#
# Usage: sh scripts/check-migration-heads.sh [commit]   (default: HEAD)
#
# CI validates each pull request's chain on its own, against main as it was
# when that run started. Two branches that each add a migration on the same
# parent are therefore both green, and whichever merges second forks main:
# `alembic upgrade head` then fails with "Multiple head revisions" for every
# deployment. This script runs the same validator against the merge of the
# commit and the freshly fetched main, so the fork is reported before the push
# rather than after the second merge. .husky/pre-push runs it on every push.
#
# It is an early warning, not the gate. A branch can still race another one
# that merges between this check and its own merge; only a merge queue (or
# "require branches to be up to date") closes that window.
#
# Environment:
#   MIGRATION_HEADS_BASE  ref to merge against (default: origin/main)
#
# Exit status: 0 when the merged chain is valid, or when the check cannot run
# (no python3, git older than 2.38, base unreachable) — CI still runs the
# validator, so an environment that cannot check here must not block a push.
# 1 when the merged chain is invalid.

set -eu

commit=${1:-HEAD}
base=${MIGRATION_HEADS_BASE:-origin/main}
versions=backend/alembic/versions
validator=backend/scripts/validate_migrations.py

say() {
    printf 'migration-heads: %s\n' "$*" >&2
}

top=$(git rev-parse --show-toplevel)
cd "$top"

if ! command -v python3 >/dev/null 2>&1; then
    say "python3 not found; skipping (CI still validates the chain)"
    exit 0
fi

commit_sha=$(git rev-parse --verify --quiet "$commit^{commit}") || {
    say "cannot resolve '$commit' to a commit"
    exit 1
}

# An explicit refspec, because a single-branch clone's default refspec would
# leave refs/remotes/<remote>/<branch> stale and update only FETCH_HEAD.
remote=${base%%/*}
branch=${base#*/}
if [ "$remote" != "$base" ] && git remote | grep -qx "$remote"; then
    if ! git fetch --quiet "$remote" "+refs/heads/$branch:refs/remotes/$remote/$branch"; then
        say "could not fetch $base; checking against the last fetched copy"
    fi
fi

base_sha=$(git rev-parse --verify --quiet "$base^{commit}") || {
    say "cannot resolve $base; skipping (CI still validates the chain)"
    exit 0
}

merge_base=$(git merge-base "$base_sha" "$commit_sha") || {
    say "$base and $commit share no history; skipping"
    exit 0
}

# A fork needs a migration on both sides. When this commit adds none, merging
# it cannot create one, and the fetch above is the only cost paid.
if [ -z "$(git diff --name-only "$merge_base" "$commit_sha" -- "$versions")" ]; then
    exit 0
fi

# merge-tree computes the merge without touching the working tree or index, so
# the check is safe to run mid-push with uncommitted changes present. Exit 1
# means conflicts (the tree is still written); anything higher means this git
# does not support --write-tree.
merge_status=0
merge_out=$(git merge-tree --write-tree --name-only --no-messages "$base_sha" "$commit_sha" 2>/dev/null) || merge_status=$?
if [ "$merge_status" -gt 1 ]; then
    say "git 2.38 or newer is needed for 'git merge-tree --write-tree'; skipping"
    exit 0
fi

tree=$(printf '%s\n' "$merge_out" | sed -n 1p)
if [ "$merge_status" -eq 1 ]; then
    conflicted=$(printf '%s\n' "$merge_out" | sed 1d | grep "^$versions/" || true)
    if [ -n "$conflicted" ]; then
        say "these migration files conflict with $base:"
        printf '%s\n' "$conflicted" | sed 's/^/  /' >&2
        say "merge $base into your branch and resolve them before pushing"
        exit 1
    fi
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
trap 'exit 1' INT TERM

git archive "$tree" -- "$versions" "$validator" | tar -xf - -C "$tmp"

# -I keeps the merged tree's directory off sys.path; the validator imports
# only the standard library.
if python3 -I "$tmp/$validator" --strict >"$tmp/report" 2>&1; then
    exit 0
fi

cat "$tmp/report" >&2
say "the migration chain is invalid once this commit is merged with $base."
say "If $base gained a migration since you branched, run:"
say "    git merge $base"
say "then set your migration's down_revision to the head printed above."
say "Re-point only a migration that has not reached $base; once both"
say "forks are on $base, add a merge revision instead (alembic merge)."
say "See docs/rules/migrations.md#parallel-branches-and-a-single-head"
exit 1
