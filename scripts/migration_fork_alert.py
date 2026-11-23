#!/usr/bin/env python3
"""Report a forked Alembic chain on main as one GitHub issue, and close it after.

The Migration Chain job in ci.yml goes red on main the moment a merge forks
the chain, and nobody sees a red run on main: on 2026-11-14, -15 and -20 main
sat forked while further pull requests merged. The owner decided on
2026-11-16 not to require branches to be up to date before merging (see
docs/rules/migrations.md), so a fork can still land. This script makes it
visible instead: the migration-fork-alert workflow runs it on every push to
main.

    python3 scripts/migration_fork_alert.py

It runs backend/scripts/validate_migrations.py --strict and reads the heads
from the validator's own report, so there is one definition of a head.

* More than one head: open an issue naming the heads and the exact
  ``alembic merge`` command, or update the one already open, and exit 1.
* One head: close any open fork issue, and exit with the validator's status
  (another chain error is the Migration Chain job's to report, not a fork).

Safe to run twice (CLAUDE.md pitfall #36). The issue is found by the marker in
its body, under the label, so a second push while the fork is open updates the
same issue rather than opening another. The workflow serializes its runs, which
is what stops two pushes racing past the lookup; were two issues ever open, the
oldest is kept and the rest closed as duplicates of it.

It deliberately does not open a merge-revision pull request. A pull request
opened with the workflow's GITHUB_TOKEN does not trigger CI, and an automatic
merge revision would be one more writer racing the sessions that already answer
a fork with their own, which is how 2026-11-14's fork drew three merges.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable, Protocol, Sequence

ROOT = Path(__file__).resolve().parents[1]
VALIDATOR = ROOT / "backend" / "scripts" / "validate_migrations.py"

LABEL = "migration-fork"
MARKER = "<!-- migration-fork-alert -->"
HEADS_MARKER_PATTERN = re.compile(r"<!-- migration-fork-heads: ([^>]*) -->")
TITLE = "main's Alembic chain is forked"

# The validator prints one line per head:  "  head -> <revision>  (<file>)".
HEAD_LINE = re.compile(r"^\s*head -> (\S+)\s+\((.+)\)\s*$")
# A revision id is interpolated into a shell command in the issue body, so only
# the characters Alembic ids are made of are accepted.
REVISION_ID = re.compile(r"^[A-Za-z0-9_]+$")


class GitHubApiError(RuntimeError):
    def __init__(self, status: int, method: str, path: str, detail: str) -> None:
        self.status = status
        super().__init__(f"GitHub API {method} {path} failed: {status} {detail}")


def parse_heads(report: str) -> list[tuple[str, str]]:
    """Return (revision, file) for every head the validator's report lists."""
    heads = []
    for line in report.splitlines():
        match = HEAD_LINE.match(line)
        if not match:
            continue
        revision, filename = match.group(1), match.group(2)
        if not REVISION_ID.fullmatch(revision):
            raise ValueError(f"unexpected revision id in the report: {revision!r}")
        heads.append((revision, filename))
    return sorted(set(heads))


def merge_command(heads: Sequence[tuple[str, str]]) -> str:
    revisions = " ".join(revision for revision, _ in heads)
    return f'cd backend && alembic merge -m "merge heads" {revisions}'


def heads_key(heads: Sequence[tuple[str, str]]) -> str:
    return ",".join(revision for revision, _ in heads)


def issue_body(heads: Sequence[tuple[str, str]], sha: str, run_url: str) -> str:
    listed = "\n".join(f"- `{revision}` — `{filename}`" for revision, filename in heads)
    return f"""{MARKER}
<!-- migration-fork-heads: {heads_key(heads)} -->
`main` has **{len(heads)} Alembic heads** as of {sha}, so `alembic upgrade head`
fails with "Multiple head revisions" on every deployment and every branch that
merges `main`.

Heads:

{listed}

The fix is **one** merge revision, on a new branch off `main`:

```sh
{merge_command(heads)}
```

Before writing it, follow "One merge revision per fork" in
`docs/rules/migrations.md`: fetch `main` and check it is still forked, and
look for an open pull request that already merges these heads. Two merges of
the same pair are two new heads.

This issue was opened by the migration-fork-alert workflow ([run]({run_url})).
It is updated while the fork stays open and closed automatically once `main`
has one head again.
"""


class IssueClient(Protocol):
    """The part of the GitHub API this script uses; tests supply a fake."""

    def ensure_label(self) -> None:
        """Create the label if the repository does not have it."""

    def open_issues(self) -> list[dict[str, Any]]:
        """Every open issue carrying the label."""
        return []

    def create_issue(self, body: str) -> dict[str, Any]:
        """Open the issue and return it."""
        return {}

    def update_issue(self, number: int, fields: dict[str, Any]) -> dict[str, Any]:
        """Change the issue's fields and return it."""
        return {}

    def comment(self, number: int, body: str) -> None:
        """Add a comment to the issue."""


class GitHubClient:
    def __init__(self, repository: str, token: str) -> None:
        self.base_url = f"https://api.github.com/repos/{repository}"
        self.headers = {
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "the-logbook-migration-fork-alert",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    def request(
        self, method: str, path: str, payload: dict[str, Any] | None = None
    ) -> Any:
        data = json.dumps(payload).encode() if payload is not None else None
        request = urllib.request.Request(
            f"{self.base_url}{path}", data=data, headers=self.headers, method=method
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")
            raise GitHubApiError(error.code, method, path, detail) from error

    def ensure_label(self) -> None:
        try:
            self.request("GET", f"/labels/{urllib.parse.quote(LABEL, safe='')}")
        except GitHubApiError as error:
            if error.status != 404:
                raise
            self.request(
                "POST",
                "/labels",
                {
                    "name": LABEL,
                    "color": "b60205",
                    "description": "main's Alembic chain has more than one head",
                },
            )

    def open_issues(self) -> list[dict[str, Any]]:
        issues: list[dict[str, Any]] = []
        page = 1
        while True:
            batch = self.request(
                "GET",
                f"/issues?state=open&labels={urllib.parse.quote(LABEL, safe='')}"
                f"&per_page=100&page={page}",
            )
            if not isinstance(batch, list):
                raise RuntimeError("GitHub issues response must be a list")
            issues.extend(batch)
            if len(batch) < 100:
                return issues
            page += 1

    def create_issue(self, body: str) -> dict[str, Any]:
        return self.request(
            "POST", "/issues", {"title": TITLE, "body": body, "labels": [LABEL]}
        )

    def update_issue(self, number: int, fields: dict[str, Any]) -> dict[str, Any]:
        return self.request("PATCH", f"/issues/{number}", fields)

    def comment(self, number: int, body: str) -> None:
        self.request("POST", f"/issues/{number}/comments", {"body": body})


def alert_issues(client: IssueClient) -> list[dict[str, Any]]:
    """Open issues this script owns, oldest first. Pull requests are excluded."""
    owned = [
        issue
        for issue in client.open_issues()
        if "pull_request" not in issue and MARKER in (issue.get("body") or "")
    ]
    return sorted(owned, key=lambda issue: issue["number"])


def report_fork(
    client: IssueClient, heads: Sequence[tuple[str, str]], sha: str, run_url: str
) -> int:
    """Open or update the one fork issue. Returns its number."""
    body = issue_body(heads, sha, run_url)
    issues = alert_issues(client)
    if not issues:
        client.ensure_label()
        created = client.create_issue(body)
        return int(created["number"])

    keep, *duplicates = issues
    number = int(keep["number"])
    previous = HEADS_MARKER_PATTERN.search(keep.get("body") or "")
    client.update_issue(number, {"body": body})
    # The body is rewritten every push; a comment is added only when the set of
    # heads changes, so watchers are told about a new fork, not every merge.
    if previous is None or previous.group(1) != heads_key(heads):
        client.comment(
            number,
            f"The heads changed as of {sha}: now "
            + ", ".join(f"`{revision}`" for revision, _ in heads)
            + f". Merge command:\n\n```sh\n{merge_command(heads)}\n```",
        )
    for duplicate in duplicates:
        client.comment(int(duplicate["number"]), f"Duplicate of #{number}.")
        client.update_issue(
            int(duplicate["number"]), {"state": "closed", "state_reason": "not_planned"}
        )
    return number


def resolve_fork(
    client: IssueClient, heads: Sequence[tuple[str, str]], sha: str
) -> list[int]:
    """Close every open fork issue. Returns the numbers closed."""
    closed = []
    head = heads[0][0] if heads else "unknown"
    for issue in alert_issues(client):
        number = int(issue["number"])
        client.comment(
            number, f"`main` has one Alembic head again as of {sha}: `{head}`."
        )
        client.update_issue(number, {"state": "closed", "state_reason": "completed"})
        closed.append(number)
    return closed


def run_validator(path: Path = VALIDATOR) -> tuple[int, str]:
    result = subprocess.run(
        [sys.executable, str(path), "--strict"],
        capture_output=True,
        text=True,
        check=False,
        cwd=str(path.parent.parent),
    )
    return result.returncode, (result.stdout or "") + (result.stderr or "")


def main(
    environ: dict[str, str] | None = None,
    client_factory: Callable[[str, str], IssueClient] = GitHubClient,
    validator: Callable[[], tuple[int, str]] = run_validator,
) -> int:
    env = os.environ if environ is None else environ
    status, report = validator()
    print(report)
    heads = parse_heads(report)
    if not heads:
        # The validator did not get as far as listing heads (it crashed, or
        # found no migrations). Nothing is known about a fork, so no issue is
        # touched; the failure is the Migration Chain job's to report.
        print("migration-fork-alert: the report lists no heads", file=sys.stderr)
        return 1

    repository = env.get("GITHUB_REPOSITORY")
    token = env.get("GITHUB_TOKEN")
    if not repository or not token:
        print("GITHUB_REPOSITORY and GITHUB_TOKEN are required", file=sys.stderr)
        return 1
    sha = env.get("GITHUB_SHA", "the latest push")
    server = env.get("GITHUB_SERVER_URL", "https://github.com")
    run_id = env.get("GITHUB_RUN_ID", "")
    run_url = f"{server}/{repository}/actions/runs/{run_id}"
    client = client_factory(repository, token)

    if len(heads) > 1:
        number = report_fork(client, heads, sha, run_url)
        print(
            f"migration-fork-alert: main has {len(heads)} heads; see issue #{number}",
            file=sys.stderr,
        )
        return 1

    closed = resolve_fork(client, heads, sha)
    if closed:
        print(f"migration-fork-alert: closed {closed}", file=sys.stderr)
    return status


if __name__ == "__main__":
    sys.exit(main())
