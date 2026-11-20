#!/usr/bin/env python3
"""Decide which of CI's expensive job groups a change can affect.

The `changes` job in .github/workflows/ci.yml runs this first and every
area-gated job reads its outputs. Before it existed a pull request that
touched only prose started all 22 jobs and used about 340 runner-minutes, and
on a personal account's shared runner pool that queue, not any test, was what
left pull requests waiting for hours in November 2026.

WHAT MAY BE SKIPPED, AND WHAT MAY NOT
-------------------------------------
Only the suites that cannot see the other side of the repository are gated:

  backend   mypy, the security scan, and the database-backed integration and
            contract suites
  frontend  ESLint and the production build, the Playwright suites and the
            PWA smoke test
  docker    the image build, which packages both

The lint jobs, the migration chain, the docs link check, the backend unit
suite and the Vitest suite run on every change and are deliberately not
gated. They read across the tree: backend unit tests parse frontend sources
to hold the two in agreement, Vitest reads backend/, wiki/ and root Markdown,
and both read prose files. A path rule that tried to say which change can
break which of those tests would be wrong the day somebody added another.

FAILING OPEN
------------
Every doubt resolves to "run everything": an event that is not a pull
request, a checkout that is not the merge commit GitHub builds for one, a git
failure, an empty diff, and any path this file does not recognize. A new
top-level directory therefore runs the full suite until it is classified
here, which costs runner time rather than coverage.

MariaDB runs only when everything runs because of the event (a push to main,
a merge queue commit or a manual run), by owner decision on 2026-11-19: pull
requests test MySQL 8.0, the documented production engine.

Usage:  python3 scripts/ci_changed_areas.py --event pull_request
Writes key=value lines to $GITHUB_OUTPUT when set, and always to stdout.
"""

import argparse
import json
import os
import subprocess
import sys

FLAGS = ("backend", "frontend", "docker")

MYSQL = {"name": "MySQL 8.0", "image": "mysql:8.0", "slug": "mysql-8-0"}
MARIADB = {
    "name": "MariaDB 10.11",
    "image": "mariadb:10.11",
    "slug": "mariadb-10-11",
}

FRONTEND_ROOT_FILES = {"package.json", "package-lock.json"}

# Paths no gated job reads. Root-level Markdown is matched separately, since a
# .md file inside backend/ or frontend/ belongs to that area.
PROSE_PREFIXES = ("docs/", "wiki/", ".claude/")
PROSE_ROOT_FILES = {"LICENSE"}


def area_of(path):
    """Return "backend", "frontend", "prose", or None for an unknown path."""
    if path.startswith("backend/"):
        return "backend"
    if path.startswith("frontend/") or path in FRONTEND_ROOT_FILES:
        return "frontend"
    if path.startswith(PROSE_PREFIXES) or path in PROSE_ROOT_FILES:
        return "prose"
    if "/" not in path and path.endswith(".md"):
        return "prose"
    return None


def classify(paths):
    """Map changed paths to the gated job groups that must run."""
    areas = {area_of(path) for path in paths}
    if not paths or None in areas:
        return dict.fromkeys(FLAGS, True)
    backend = "backend" in areas
    frontend = "frontend" in areas
    return {
        "backend": backend,
        "frontend": frontend,
        "docker": backend or frontend,
    }


def changed_paths(run=subprocess.run):
    """Paths a pull request changes, or None when that cannot be established.

    actions/checkout gives a pull_request run the merge commit of the branch
    into its base, whose first parent is the base. The diff against that
    parent is therefore what merging would change, without fetching the
    branch's history.
    """
    try:
        parents = run(
            ["git", "rev-list", "--parents", "-n", "1", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.split()
        if len(parents) != 3:
            return None
        # --no-renames lists a moved file under both names, so a file moved
        # out of an area still counts as a change to it.
        diff = run(
            ["git", "diff", "--name-only", "--no-renames", "-z", "HEAD^1", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
    except (OSError, subprocess.CalledProcessError):
        return None
    return [path for path in diff.split("\0") if path]


def decide(event, paths):
    """Return (outputs, reason) for an event and its changed paths."""
    everything = dict.fromkeys(FLAGS, True)
    if event != "pull_request":
        flags, engines = everything, [MYSQL, MARIADB]
        reason = f"event is {event!r}: run everything, on both engines"
    elif paths is None:
        flags, engines = everything, [MYSQL]
        reason = "could not establish the changed paths: run everything"
    else:
        flags, engines = classify(paths), [MYSQL]
        unknown = sorted(path for path in paths if area_of(path) is None)
        if not paths:
            reason = "the diff is empty: run everything"
        elif unknown:
            reason = f"unclassified path {unknown[0]!r}: run everything"
        else:
            reason = f"classified {len(paths)} changed path(s)"
    outputs = {flag: "true" if flags[flag] else "false" for flag in FLAGS}
    outputs["db_matrix"] = json.dumps(engines, separators=(",", ":"))
    return outputs, reason


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--event", required=True, help="The triggering event, github.event_name."
    )
    args = parser.parse_args()

    paths = changed_paths() if args.event == "pull_request" else None
    outputs, reason = decide(args.event, paths)

    print(reason)
    lines = [f"{key}={value}" for key, value in outputs.items()]
    print("\n".join(lines))
    target = os.environ.get("GITHUB_OUTPUT")
    if target:
        with open(target, "a", encoding="utf-8") as handle:
            handle.write("\n".join(lines) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
