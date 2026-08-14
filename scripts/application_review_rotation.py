#!/usr/bin/env python3
"""Open one application-review issue at a time on a scheduled rotation."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = ROOT / ".github" / "application-review-rotation.json"
MARKER_PREFIX = "<!-- application-review-rotation:"
FEATURE_ID_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
FEATURE_MARKER_PATTERN = re.compile(
    rf"{re.escape(MARKER_PREFIX)}([a-z0-9]+(?:-[a-z0-9]+)*) -->"
)


class GitHubApiError(RuntimeError):
    def __init__(self, status: int, method: str, path: str, detail: str) -> None:
        self.status = status
        super().__init__(f"GitHub API {method} {path} failed: {status} {detail}")


def load_config(path: Path) -> dict[str, Any]:
    config = json.loads(path.read_text(encoding="utf-8"))
    features = config.get("features")
    if not isinstance(features, list) or not features:
        raise ValueError("features must be a non-empty list")

    ids: set[str] = set()
    for index, feature in enumerate(features, start=1):
        if not isinstance(feature, dict):
            raise ValueError(f"feature {index} must be an object")
        for field in ("id", "name", "scope"):
            if not isinstance(feature.get(field), str) or not feature[field].strip():
                raise ValueError(f"feature {index} must have a non-empty {field}")
        if feature["id"] in ids:
            raise ValueError(f"duplicate feature id: {feature['id']}")
        if not FEATURE_ID_PATTERN.fullmatch(feature["id"]):
            raise ValueError(
                f"feature {index} id must contain lowercase letters, numbers, and single hyphens"
            )
        ids.add(feature["id"])

    for field in ("label", "title_prefix"):
        if not isinstance(config.get(field), str) or not config[field].strip():
            raise ValueError(f"config must have a non-empty {field}")
    return config


class GitHubClient:
    def __init__(self, repository: str, token: str) -> None:
        self.base_url = f"https://api.github.com/repos/{repository}"
        self.headers = {
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "the-logbook-application-review-rotation",
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

    def ensure_label(self, label: str) -> None:
        encoded_label = urllib.parse.quote(label, safe="")
        try:
            self.request("GET", f"/labels/{encoded_label}")
        except GitHubApiError as error:
            if error.status != 404:
                raise
            self.request(
                "POST",
                "/labels",
                {
                    "name": label,
                    "color": "5319e7",
                    "description": "Tracks the application-wide review rotation",
                },
            )

    def issues(self, label: str) -> list[dict[str, Any]]:
        encoded_label = urllib.parse.quote(label, safe="")
        issues: list[dict[str, Any]] = []
        page = 1
        while True:
            batch = self.request(
                "GET",
                f"/issues?state=all&labels={encoded_label}&per_page=100&page={page}",
            )
            if not isinstance(batch, list):
                raise RuntimeError("GitHub issues response must be a list")
            issues.extend(batch)
            if len(batch) < 100:
                return issues
            page += 1

    def create_issue(self, title: str, body: str, label: str) -> dict[str, Any]:
        return self.request(
            "POST", "/issues", {"title": title, "body": body, "labels": [label]}
        )


def feature_marker(feature_id: str) -> str:
    return f"{MARKER_PREFIX}{feature_id} -->"


def issue_feature_id(issue: dict[str, Any]) -> str | None:
    body = issue.get("body") or ""
    match = FEATURE_MARKER_PATTERN.search(body)
    return match.group(1) if match else None


def issue_body(feature: dict[str, str], position: int, total: int) -> str:
    return f"""{feature_marker(feature['id'])}
## Review rotation {position} of {total}

**Timebox:** 15 minutes. If the review needs more time, record what remains and keep this issue open; the automation will not advance until it is closed.

**Scope:** {feature['scope']}

### Review checklist

- [ ] Trace the user journey through navigation, frontend state, API, service, model, migration, background work, and documentation where applicable.
- [ ] Check authentication, permissions, organization scoping, privacy, auditability, validation, concurrency, and failure recovery.
- [ ] Check loading, empty, error, offline, responsive, keyboard, and screen-reader behavior where applicable.
- [ ] Run or identify focused tests and compare behavior with existing audits and `docs/KNOWN_LIMITATIONS.md`.
- [ ] Record evidence with file/line references or reproduction steps; distinguish verified defects from hypotheses and enhancements.
- [ ] Give each finding impact, likelihood, reach, effort, acceptance criteria, and a regression-test recommendation.

### Completion gate

Summarize reviewed surfaces, commands run, findings, follow-up tickets, and any unreviewed scope before closing. Closing this issue allows the next scheduled 15-minute rotation to begin.
"""


def select_next_feature(
    config: dict[str, Any], issues: list[dict[str, Any]]
) -> tuple[str, dict[str, str] | None]:
    features = config["features"]
    valid_ids = {feature["id"] for feature in features}
    rotation_issues: list[tuple[dict[str, Any], str]] = []
    for issue in issues:
        if "pull_request" in issue:
            continue
        feature_id = issue_feature_id(issue)
        if feature_id is not None:
            rotation_issues.append((issue, feature_id))
    open_ids = {
        feature_id
        for issue, feature_id in rotation_issues
        if issue.get("state") == "open"
    }
    if open_ids:
        return "waiting", None

    completed_ids = {
        feature_id
        for issue, feature_id in rotation_issues
        if feature_id in valid_ids and issue.get("state") == "closed"
    }
    for feature in features:
        if feature["id"] not in completed_ids:
            return "create", feature
    return "complete", None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--validate", action="store_true")
    args = parser.parse_args()

    try:
        config = load_config(args.config)
    except (OSError, json.JSONDecodeError, ValueError) as error:
        print(f"Invalid review rotation config: {error}", file=sys.stderr)
        return 1

    if args.validate:
        print(f"Validated {len(config['features'])} application review rotations")
        return 0

    repository = os.environ.get("GITHUB_REPOSITORY")
    token = os.environ.get("GITHUB_TOKEN")
    if not repository or not token:
        print("GITHUB_REPOSITORY and GITHUB_TOKEN are required", file=sys.stderr)
        return 1

    client = GitHubClient(repository, token)
    client.ensure_label(config["label"])
    issues = client.issues(config["label"])
    state, feature = select_next_feature(config, issues)
    if state == "waiting":
        print("The current review issue remains open; the rotation will not advance")
        return 0
    if state == "complete":
        print("All application review rotations are complete")
        return 0

    assert feature is not None
    position = config["features"].index(feature) + 1
    issue = client.create_issue(
        f"{config['title_prefix']} {feature['name']}",
        issue_body(feature, position, len(config["features"])),
        config["label"],
    )
    print(f"Opened review rotation {position}: {issue['html_url']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
