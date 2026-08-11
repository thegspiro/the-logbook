#!/usr/bin/env python3
"""
Seed the skills-testing module with a template library and test records.

Creates the ten skill sheets in ``skill_sheet_library`` (published, so they can
actually be selected when starting a test) and then a spread of test records
covering every state the UI has a distinct rendering for:

    draft · in progress · completed & validated (pass) ·
    completed & validated (fail on a critical step) · practice run ·
    voided · pending an officer's validation

The last of those needs a *non-officer* examiner — an officer's own completion
validates in the same step, so an officer can never leave a test pending. Pass
``--examiner-username`` / ``--examiner-password`` for a plain member account to
seed it; without them the script says so and skips that one state rather than
leaving you to wonder why the validation queue is empty.

Everything goes through the public API as a logged-in administrator, so the
result is exactly what the application itself would produce — the seeder cannot
drift away from the schema or skip a service-layer rule.

Idempotent at the collection level: templates are matched by name and tests are
skipped entirely if any already exist, so it is safe to re-run.

Usage:
    python scripts/seed_skills_testing.py \\
        --base-url http://127.0.0.1:3001 \\
        --username admin --password '...'

    # …plus the pending-validation record:
    python scripts/seed_skills_testing.py --username admin --password '...' \\
        --examiner-username jdoe --examiner-password '...'

Credentials may also come from LOGBOOK_BASE_URL / LOGBOOK_USERNAME /
LOGBOOK_PASSWORD in the environment.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from http.cookiejar import CookieJar
from pathlib import Path
from time import sleep
from typing import Any

# The blueprints live in the backend package, not here: the API serves them as
# a starter library, so the application is their home and this is one consumer.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.data.skill_sheet_library import (  # noqa: E402  (path set up above)
    C_STATEMENT,
    SKILL_SHEETS,
    build_template_payload,
    criterion_id,
    criterion_result,
    section_id,
)


class ApiError(RuntimeError):
    def __init__(self, method: str, path: str, code: int, detail: str) -> None:
        super().__init__(f"{method} {path} -> {code}: {detail}")
        self.code = code
        self.detail = detail


class Api:
    """Cookie-authenticated JSON client. Stdlib only, so it runs anywhere."""

    def __init__(self, base_url: str) -> None:
        self.api = base_url.rstrip("/") + "/api/v1"
        self.jar = CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar)
        )

    def _csrf(self) -> str | None:
        for cookie in self.jar:
            if cookie.name == "csrf_token":
                return cookie.value
        return None

    def call(self, method: str, path: str, payload: Any = None) -> Any:
        url = f"{self.api}{path}"
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        # Double-submit CSRF: state-changing calls echo the cookie as a header.
        if method != "GET":
            token = self._csrf()
            if token:
                req.add_header("X-CSRF-Token", token)
        # A seeding run drives writes in a burst and trips the rate limiter.
        # That limiter is doing its job, so back off rather than widen it.
        for attempt in range(6):
            try:
                with self.opener.open(req, timeout=120) as resp:
                    return json.loads(resp.read().decode() or "null")
            except urllib.error.HTTPError as exc:
                if exc.code == 429 and attempt < 5:
                    retry_after = exc.headers.get("Retry-After")
                    sleep(int(retry_after) if retry_after else 5 * (attempt + 1))
                    continue
                raise ApiError(
                    method, path, exc.code, exc.read().decode()[:600]
                ) from exc
        return None

    def get(self, path: str) -> Any:
        return self.call("GET", path)

    def post(self, path: str, payload: Any = None) -> Any:
        return self.call("POST", path, payload if payload is not None else {})

    def put(self, path: str, payload: Any) -> Any:
        return self.call("PUT", path, payload)

    def login_as(self, username: str, password: str) -> None:
        self.call("POST", "/auth/login", {"username": username, "password": password})


def items(result: Any, *keys: str) -> list[dict]:
    """Unwrap a list response, whether it is bare or wrapped in a key."""
    if isinstance(result, list):
        return result
    if isinstance(result, dict):
        for key in keys:
            value = result.get(key)
            if isinstance(value, list):
                return value
    return []


def pick(record: Any, *names: str) -> Any:
    """Read a field that may arrive snake_case or camelCase."""
    if not isinstance(record, dict):
        return None
    for name in names:
        if name in record:
            return record[name]
    return None


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------
#
# Section and criterion identity is positional and generated client-side, so a
# seeder writing results through the API has to reproduce the same ids exactly
# — see section_id()/criterion_id(). Everything below builds results against
# those ids rather than against labels, which is what the examiner screen does.


def build_section_results(
    sheet: dict[str, Any],
    *,
    fail_at: tuple[int, int] | None = None,
    stop_after_section: int | None = None,
) -> list[dict[str, Any]]:
    """Score a whole sheet.

    ``fail_at`` marks one ``(section, criterion)`` position as failed, which is
    how the "critical failure" record is produced — a sheet with
    ``require_all_critical`` fails on it whatever the percentage says.

    ``stop_after_section`` truncates the results, which is what a genuinely
    in-progress test looks like: earlier sections scored, later ones absent.
    """
    sections: list[dict[str, Any]] = []
    for si, section in enumerate(sheet["sections"]):
        if stop_after_section is not None and si > stop_after_section:
            break
        criteria_results = []
        for ci, criterion in enumerate(section["criteria"]):
            passing = fail_at != (si, ci)
            criteria_results.append(
                {
                    "criterion_id": criterion_id(si, ci),
                    "criterion_label": criterion["label"],
                    **criterion_result(criterion, passing),
                }
            )
        sections.append(
            {
                "section_id": section_id(si),
                "section_name": section["name"],
                "criteria_results": criteria_results,
                # Older clients wrote a per-section percentage, and it is still
                # the only score a sheet with no point-carrying criteria can
                # have (build_score_breakdown falls back to averaging these).
                "section_score": 100.0 if fail_at is None else 80.0,
                "section_passed": fail_at is None,
            }
        )
    return sections


def first_critical(sheet: dict[str, Any]) -> tuple[int, int] | None:
    """Position of the first critical, scorable step — the one to fail."""
    for si, section in enumerate(sheet["sections"]):
        for ci, criterion in enumerate(section["criteria"]):
            if criterion.get("required") and criterion.get("type") != C_STATEMENT:
                return (si, ci)
    return None


# ---------------------------------------------------------------------------
# Seeding
# ---------------------------------------------------------------------------


class Seeder:
    def __init__(self, api: Api) -> None:
        self.api = api

    def seed_templates(self) -> dict[str, dict]:
        """Create and publish every sheet in the library. Returns name -> row."""
        existing = items(
            self.api.get("/training/skills-testing/templates"), "templates"
        )
        by_name = {t.get("name"): t for t in existing if t.get("name")}

        created = 0
        for sheet in SKILL_SHEETS:
            name = sheet["name"]
            if name in by_name:
                continue
            template = self.api.post(
                "/training/skills-testing/templates",
                build_template_payload(sheet),
            )
            template_id = pick(template, "id")
            # A draft template cannot be selected when starting a test, so the
            # Start Test page shows nothing until at least one is published.
            self.api.post(f"/training/skills-testing/templates/{template_id}/publish")
            by_name[name] = template
            created += 1

        print(f"  templates: {created} created, {len(by_name)} total")
        return by_name

    def candidates(self, limit: int) -> list[dict]:
        """Members who can be tested, from the start-test picker's own source."""
        people = items(
            self.api.get("/training/skills-testing/candidates"), "candidates"
        )
        return people[:limit]

    def start_test(
        self,
        template: dict,
        candidate: dict,
        *,
        practice: bool = False,
        notes: str | None = None,
    ) -> dict:
        return self.api.post(
            "/training/skills-testing/tests",
            {
                "template_id": pick(template, "id"),
                "candidate_id": pick(candidate, "id"),
                "is_practice": practice,
                "notes": notes,
            },
        )

    def score_and_complete(
        self,
        test: dict,
        sheet: dict[str, Any],
        *,
        fail_at: tuple[int, int] | None = None,
    ) -> dict:
        test_id = pick(test, "id")
        self.api.put(
            f"/training/skills-testing/tests/{test_id}",
            {
                "status": "in_progress",
                "section_results": build_section_results(sheet, fail_at=fail_at),
                "elapsed_seconds": 480,
            },
        )
        return self.api.post(f"/training/skills-testing/tests/{test_id}/complete")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base-url",
        default=os.environ.get("LOGBOOK_BASE_URL", "http://127.0.0.1:3001"),
    )
    parser.add_argument("--username", default=os.environ.get("LOGBOOK_USERNAME", ""))
    parser.add_argument("--password", default=os.environ.get("LOGBOOK_PASSWORD", ""))
    parser.add_argument(
        "--examiner-username",
        default=os.environ.get("LOGBOOK_EXAMINER_USERNAME", ""),
        help=(
            "A non-officer member account used as examiner for the "
            "pending-validation record. Omit to skip that one state."
        ),
    )
    parser.add_argument(
        "--examiner-password",
        default=os.environ.get("LOGBOOK_EXAMINER_PASSWORD", ""),
    )
    parser.add_argument(
        "--templates-only",
        action="store_true",
        help="Seed the template library and stop — no test records.",
    )
    return parser.parse_args()


def seed_pending_validation(
    base_url: str,
    username: str,
    password: str,
    template: dict,
    sheet: dict[str, Any],
    candidate: dict,
) -> None:
    """The one record an administrator cannot create for themselves.

    An officer's completion validates in the same step, so a test can only be
    left pending by a member running it as examiner. Seeded through that
    member's own session for exactly that reason.
    """
    peer = Api(base_url)
    peer.login_as(username, password)
    test = peer.post(
        "/training/skills-testing/tests",
        {
            "template_id": pick(template, "id"),
            "candidate_id": pick(candidate, "id"),
            "is_practice": False,
            "notes": "Peer-run evaluation during the quarterly skills night.",
        },
    )
    test_id = pick(test, "id")
    peer.put(
        f"/training/skills-testing/tests/{test_id}",
        {
            "status": "in_progress",
            "section_results": build_section_results(sheet),
            "elapsed_seconds": 512,
        },
    )
    peer.post(f"/training/skills-testing/tests/{test_id}/complete")


def main() -> int:
    args = parse_args()
    if not args.username or not args.password:
        print(
            "ERROR: administrator credentials required "
            "(--username/--password or LOGBOOK_USERNAME/LOGBOOK_PASSWORD)",
            file=sys.stderr,
        )
        return 2

    api = Api(args.base_url)
    try:
        api.login_as(args.username, args.password)
    except ApiError as exc:
        print(f"ERROR: login failed — {exc}", file=sys.stderr)
        return 1

    seeder = Seeder(api)
    print("Seeding skills testing…")
    templates = seeder.seed_templates()

    if args.templates_only:
        print("Done (templates only).")
        return 0

    existing_tests = items(api.get("/training/skills-testing/tests"), "tests")
    if existing_tests:
        print(
            f"  tests: {len(existing_tests)} already present — skipping. "
            "Delete them first to reseed."
        )
        return 0

    people = seeder.candidates(limit=6)
    if len(people) < 2:
        print(
            "ERROR: need at least 2 members to seed tests "
            f"(found {len(people)}). Seed members first.",
            file=sys.stderr,
        )
        return 1

    # Rotate through candidates and sheets so the records list does not read as
    # six runs of the same evolution against the same person.
    plan = [
        ("Patient Assessment / Management — Medical", "validated_pass"),
        ("SCBA Donning — Timed Evolution", "validated_fail"),
        ("Pump Operations — Draft and Relay Supply", "in_progress"),
        ('1¾" Handline — Advance and Flow', "draft"),
        ("Primary Search — Limited Visibility", "practice"),
        ("Hazmat — Level A Suit Donning and Doffing", "voided"),
    ]
    sheets = {sheet["name"]: sheet for sheet in SKILL_SHEETS}

    seeded: list[str] = []
    for index, (sheet_name, state) in enumerate(plan):
        template = templates.get(sheet_name)
        sheet = sheets[sheet_name]
        if not template:
            continue
        candidate = people[index % len(people)]

        if state == "draft":
            seeder.start_test(
                template, candidate, notes="Scheduled for Thursday drill night."
            )
        elif state == "in_progress":
            test = seeder.start_test(template, candidate)
            api.put(
                f"/training/skills-testing/tests/{pick(test, 'id')}",
                {
                    "status": "in_progress",
                    "section_results": build_section_results(
                        sheet, stop_after_section=0
                    ),
                },
            )
        elif state == "validated_pass":
            seeder.score_and_complete(seeder.start_test(template, candidate), sheet)
        elif state == "validated_fail":
            seeder.score_and_complete(
                seeder.start_test(template, candidate),
                sheet,
                fail_at=first_critical(sheet),
            )
        elif state == "practice":
            seeder.score_and_complete(
                seeder.start_test(template, candidate, practice=True), sheet
            )
        elif state == "voided":
            test = seeder.score_and_complete(
                seeder.start_test(template, candidate), sheet
            )
            api.post(
                f"/training/skills-testing/tests/{pick(test, 'id')}/void",
                {
                    "reason": (
                        "Wrong candidate selected at the start of the "
                        "evolution; retested the same evening."
                    )
                },
            )
        seeded.append(state)

    print(f"  tests: {len(seeded)} created ({', '.join(seeded)})")

    if args.examiner_username and args.examiner_password:
        pending_sheet = sheets["Bleeding Control and Shock Management"]
        pending_template = templates.get(pending_sheet["name"])
        if pending_template:
            # The examiner cannot also be the candidate — skills testing
            # refuses that — so pick someone other than the peer examiner.
            candidate = next(
                (
                    person
                    for person in people
                    if str(pick(person, "name")).lower()
                    != args.examiner_username.lower()
                ),
                people[0],
            )
            seed_pending_validation(
                args.base_url,
                args.examiner_username,
                args.examiner_password,
                pending_template,
                pending_sheet,
                candidate,
            )
            print("  tests: 1 created (pending_validation)")
    else:
        print(
            "  tests: pending_validation SKIPPED — pass "
            "--examiner-username/--examiner-password for a non-officer "
            "member to seed the officer review queue."
        )

    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
