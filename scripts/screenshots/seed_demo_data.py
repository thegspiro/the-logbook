#!/usr/bin/env python3
"""
Populate the demo organization with realistic data for documentation screenshots.

Runs after ``bootstrap_demo.py``.  Every record is created through the public
API as the demo administrator, so the resulting database is exactly what the
application itself would produce — no direct SQL, no fixtures that can drift
away from the schema.

The seeder is idempotent at the collection level: each step first lists what
already exists and skips creation when the demo records are present, so it can
be re-run against a warm environment without duplicating rows.

Usage:
    python scripts/screenshots/seed_demo_data.py [--base-url http://127.0.0.1:3001]
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import re
import struct
import sys
import time as time_module
import urllib.error
import urllib.request
import uuid
from datetime import date, datetime, time, timedelta, timezone
from http.cookiejar import CookieJar
from time import monotonic, sleep
from typing import Any
from zoneinfo import ZoneInfo

from bootstrap_demo import (
    DEMO_ADMIN_USERNAME,
    admin_password,
    require_safe_base_url,
)


class Throttle:
    """Keep a rate-limited route *below* its ceiling instead of tripping it.

    The generic 429 backoff in ``Api.call`` recovers from a limiter that has
    already fired, which is the wrong trade for the routes that punish it. The
    admin password-reset route allows 5 requests per 5 minutes and answers the
    sixth with a **15-minute lockout** — so a seeder that sprints into the limit
    pays 15 minutes per remaining account, and a run that needs eight sessions
    spends over an hour asleep. Spacing the calls one window-slot apart costs
    about a minute each and never triggers the lockout at all.

    Not a substitute for the 429 handling: another client sharing this IP can
    still trip the limiter, and that path stays.
    """

    def __init__(self, max_calls: int, window_seconds: float, margin: float = 2.0):
        self.max_calls = max_calls
        self.window = window_seconds
        self.margin = margin
        self._calls: list[float] = []

    def wait(self) -> None:
        now = monotonic()
        self._calls = [t for t in self._calls if now - t < self.window]
        if len(self._calls) >= self.max_calls:
            # Sleep until the oldest call in the window ages out of it.
            delay = self.window - (now - self._calls[0]) + self.margin
            if delay > 0:
                print(f"    pacing: waiting {delay:.0f}s to stay under the limit")
                sleep(delay)
            now = monotonic()
            self._calls = [t for t in self._calls if now - t < self.window]
        self._calls.append(monotonic())


# `_rate_limit_admin_reset` in app/api/v1/endpoints/users.py: 5 per 300s.
#
# Overridable because the pacing only earns its cost when the ceiling is
# actually there. A local demo stack seeded with `RATE_LIMIT_ENABLED=false`
# has no admin-reset limiter to stay under, and a roster of twenty members
# then spends the better part of an hour asleep waiting for a window that
# does not exist. Set `SEED_ADMIN_RESET_WINDOW_SECONDS=0` in that case.
#
# Default unchanged: against any stack with the limiter on — which is every
# real one, and the CI stack — the 300s window is what avoids the 15-minute
# lockout, and guessing wrong there costs far more than the pacing does.
ADMIN_RESET_WINDOW_SECONDS = float(
    os.environ.get("SEED_ADMIN_RESET_WINDOW_SECONDS", "300")
)
ADMIN_RESET_THROTTLE = Throttle(max_calls=5, window_seconds=ADMIN_RESET_WINDOW_SECONDS)

# Shared password given to the seeded member accounts so the seeder can act as
# them where the API has no admin-on-behalf-of route (event RSVPs). Demo-only.
DEMO_MEMBER_PASSWORD = "DemoMember!2026"

# The two ordinary members the screenshot harness signs in as. Both are plain
# firefighters in MEMBERS below — no officer position, no training.manage —
# which is the point: a placeholder describing what a *member* sees cannot be
# filled from the administrator's session, because several routes render an
# entirely different page for the two.
#
# DEMO_MEMBER_USERNAME is the one `auth: "member"` shots use, so it is the
# account whose own records have to be worth picturing. Keep it in step with
# DEMO_MEMBER_CREDENTIALS in manifest.mjs.
DEMO_MEMBER_USERNAME = "nbelhaj"

# The visitor the guest sign-in seeds. Matched on email rather than name so a
# re-run recognises its own guest instead of adding another every time.
GUEST_EMAIL = "rosa.delgado@example.com"
# A second member, used as the *examiner* on the peer-run skills test. Two
# constraints, and the second one is easy to miss:
#
#   * Not the candidate — skills testing refuses a test whose examiner is also
#     its candidate.
#   * Not an officer. An examiner holding `training.manage` validates their own
#     result in the same step, so the test lands signed off and the validation
#     queue stays empty — which is the one thing this member exists to prevent.
#
# `cfrazier` was a lieutenant, and lieutenant carries training.manage by rank
# default, so every "pending validation" seed silently produced a validated
# test and three screenshots timed out waiting for a queue that was never
# non-empty. `rduarte` is a firefighter, which does not.
DEMO_PEER_EXAMINER_USERNAME = "rduarte"

# The one member enrolled in TOTP, so the login page's authentication-code step
# and the members admin page's Reset MFA action have something to picture.
#
# Enrolling an account has a cost the rest of this file has to respect: once
# MFA is on, `login_as` no longer yields a session — it stops at the code step,
# and every call the returned Api makes answers 401. Several steps below sign
# in as *every* non-administrator member, so the account cannot be one they
# reach. `password_login_members` is the filter they all go through; adding the
# 2FA member to any bare `members` loop that logs in will break that step.
#
# It must also not be DEMO_ADMIN_USERNAME, DEMO_MEMBER_USERNAME or
# DEMO_PEER_EXAMINER_USERNAME — each of those is signed into by name elsewhere.
# `_assert_two_factor_account_is_unused` checks that at seed time.
TWO_FACTOR_USERNAME = "whalloway"


def password_login_members(members: list[dict]) -> list[dict]:
    """Members a step may sign in as with a password.

    Excludes the administrator (who has their own credentials) and the TOTP
    account (whose password sign-in stops at the code step).
    """
    excluded = {DEMO_ADMIN_USERNAME, TWO_FACTOR_USERNAME}
    return [m for m in members if m.get("username") not in excluded]


# Ranks whose default permissions include training.manage. Mirrors
# app/core/permissions.py's rank defaults; kept here as a literal because the
# seeder talks to the API over HTTP and does not import the backend.
OFFICER_RANKS = frozenset(
    {"lieutenant", "captain", "deputy_chief", "assistant_chief", "fire_chief"}
)

# The one skill sheet built from weighted `score` steps. Named so the test
# seeder can find it: it is the only template that can produce a scorecard with
# per-section point totals and a percentage.
SCORED_TEMPLATE_NAME = "Handline Advance — Weighted Evaluation"

# The statement the membership coordinator writes for the ballot. Shared so the
# election package panel and the ballot item that carries it to voters say the
# same thing — the guide's whole point about a package being what the ballot is
# built from.
SUPPORTING_STATEMENT = (
    "Completed all six pipeline stages with no skipped steps. Two interview "
    "panels recommended approval; background and medical returned clear. Has "
    "attended eleven drills as a guest since March."
)

# The candidate on the one failed test. Not the demo member, whose passed test
# the scorecard screenshots are built around.
FAILED_TEST_CANDIDATE_USERNAME = "cfrazier"

# How many active applicants `--bulk-prospects` tops the pipeline up to.
# Comfortably past the board's 200-card ceiling, so the truncation notice reads
# as a real overflow rather than an off-by-one, while staying small enough to
# seed in well under a minute.
BULK_PROSPECT_TARGET = 247

# Screenshots must not look stale, so dated records are generated relative to
# the run date rather than hard-coded.
# An RSVP the app refuses because the window has closed is the rule working, not
# a seeding error — matched on the message because the status code is a plain 400.
# The scheduling module refuses to double-book a member across overlapping
# shifts. That is the rule working, not a seeding error — matched on the message
# because the status code is a plain 400.
# A phase whose own name repeats the number the progress view already puts
# in front of it — "Phase 1 — Orientation" rendering as "Phase 1: Phase 1 —
# Orientation".
PHASE_NUMBER_PREFIX = re.compile(r"^\s*Phase\s+\d+\s*[—–-]\s*")

SHIFT_CONFLICT = re.compile(r"conflicting shift", re.IGNORECASE)

# LB-SCHED-001: the member holds no EVOC certification high enough to drive
# this rig. Matched on the error code rather than the sentence, which names the
# level and the apparatus and so differs per refusal.
DRIVER_NOT_QUALIFIED = re.compile(r"LB-SCHED-001")


def is_expected_seat_refusal(exc: "ApiError") -> bool:
    """Whether a refused shift assignment is the application working correctly.

    Two refusals are ordinary and must not fail the seed:

    * **A conflicting shift.** The night shift runs 19:00-07:00, so its crew is
      still on duty into the next date and the API declines to double-book
      them. Rotating the pool reduces this but cannot eliminate it for every
      roster size.
    * **Driver not EVOC-qualified.** ``_require_evoc_on_apparatus`` puts a
      minimum EVOC level on the heavier rigs precisely so this check fires, and
      operators are certified for only the first four rigs — so a driver seat
      landing on an uncertified member is the demonstration working, not a
      seeding error.

    Both leave the shift a seat short, which is what the Open Shifts tab exists
    to show. Treating the second as fatal aborted the whole scheduling step: a
    single EVOC refusal left the demo with 2 shifts and no scheduling
    apparatus, which silently blocked the close-out fixture, the batch report
    trainee, the shift reminder inbox and every guide-03 capture downstream of
    them.
    """
    return exc.code == 400 and bool(
        SHIFT_CONFLICT.search(exc.detail) or DRIVER_NOT_QUALIFIED.search(exc.detail)
    )


RSVP_CLOSED = re.compile(
    r"deadline has passed|already ended|no longer accepting" r"|does not require RSVP",
    re.IGNORECASE,
)

# The demo organization's timezone, which the UI renders in. Clock times in the
# seed data are local to it and converted on the way out.
ORG_TIMEZONE = ZoneInfo("America/New_York")

# Named because the seeder has to find this one again on a later run to keep it
# current — see seed_events.
IN_PROGRESS_EVENT_TITLE = "Company Drill — In Progress"

TODAY = date.today()
NOW = datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat()


def totp_now(secret: str, digits: int = 6, period: int = 30) -> str:
    """The current TOTP code for a base32 *secret* (RFC 6238, SHA-1).

    Hand-rolled rather than imported: this script is stdlib-only so the README's
    plain `python scripts/screenshots/seed_demo_data.py` works without the
    backend's virtualenv, and pyotp — which the backend does depend on — is not
    installed system-wide.
    """
    # Base32 secrets are conventionally unpadded; b32decode insists on padding.
    padded = secret.upper() + "=" * (-len(secret) % 8)
    key = base64.b32decode(padded)
    counter = int(time_module.time()) // period
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    # Dynamic truncation: the low nibble of the last byte picks the offset.
    offset = digest[-1] & 0x0F
    code = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(code % (10**digits)).zfill(digits)


class ApiError(RuntimeError):
    def __init__(self, method: str, path: str, code: int, detail: str) -> None:
        super().__init__(f"{method} {path} -> {code}: {detail}")
        self.code = code
        self.detail = detail


class Api:
    """Cookie-authenticated JSON client for the demo administrator."""

    def __init__(self, base_url: str) -> None:
        self.api = base_url.rstrip("/") + "/api/v1"
        # The public tree is a sibling of /api/v1, not a path under it. Kept so
        # a seeder step can exercise an unauthenticated flow the way a visitor
        # meets it, rather than reaching for the admin equivalent.
        self.public_api = base_url.rstrip("/") + "/api/public/v1"
        self.jar = CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar)
        )

    def _csrf(self) -> str | None:
        for cookie in self.jar:
            if cookie.name == "csrf_token":
                return cookie.value
        return None

    def call(
        self,
        method: str,
        path: str,
        payload: Any = None,
        *,
        body: bytes | None = None,
        content_type: str = "application/json",
    ) -> Any:
        url = f"{self.api}{path}"
        data = (
            body
            if body is not None
            else json.dumps(payload).encode() if payload is not None else None
        )
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Content-Type", content_type)
        # Double-submit CSRF: state-changing calls echo the cookie as a header.
        if method != "GET":
            token = self._csrf()
            if token:
                req.add_header("X-CSRF-Token", token)
        # Seeding drives hundreds of writes in a burst, which trips the API's
        # rate limiter on the auth and admin routes. That limiter is doing its
        # job, so back off and retry rather than asking for it to be widened.
        for attempt in range(6):
            try:
                with self.opener.open(req, timeout=120) as resp:
                    return json.loads(resp.read().decode() or "null")
            except urllib.error.HTTPError as exc:
                if exc.code == 429 and attempt < 5:
                    # Honour Retry-After where the server sends one: the admin
                    # password-reset limiter is 5 per 5 minutes, so a fixed
                    # few-second backoff would never clear it.
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

    def post_public(self, path: str, payload: Any) -> Any:
        """POST to /api/public/v1, signed out — no cookie, no CSRF header."""
        request = urllib.request.Request(
            f"{self.public_api}{path}",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                body = response.read()
            return json.loads(body) if body else None
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace")
            raise ApiError("POST", path, exc.code, detail) from exc

    def patch(self, path: str, payload: Any) -> Any:
        return self.call("PATCH", path, payload)

    def put(self, path: str, payload: Any) -> Any:
        return self.call("PUT", path, payload)

    def delete(self, path: str) -> Any:
        return self.call("DELETE", path)

    def post_file(
        self,
        path: str,
        fields: dict[str, str],
        filename: str,
        file_bytes: bytes,
        mime_type: str,
        field_name: str = "file",
    ) -> Any:
        """POST multipart/form-data — the shape file uploads require.

        Hand-built rather than pulled from a library: the seeder is otherwise
        stdlib-only so it runs against any checkout, and `urllib` has no
        multipart encoder.
        """
        boundary = "----logbookseed" + uuid.uuid4().hex
        parts: list[bytes] = []
        for name, value in fields.items():
            parts.append(
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'
                f"{value}\r\n".encode()
            )
        parts.append(
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{field_name}"; '
            f'filename="{filename}"\r\n'
            f"Content-Type: {mime_type}\r\n\r\n".encode()
        )
        parts.append(file_bytes)
        parts.append(f"\r\n--{boundary}--\r\n".encode())
        return self.call(
            "POST",
            path,
            body=b"".join(parts),
            content_type=f"multipart/form-data; boundary={boundary}",
        )

    def login(self) -> None:
        self.login_as(DEMO_ADMIN_USERNAME, admin_password())

    def login_as(self, username: str, password: str) -> None:
        self.call("POST", "/auth/login", {"username": username, "password": password})


def items(result: Any, *keys: str) -> list[dict]:
    """Unwrap a list response, which may be bare or wrapped in a container key."""
    if isinstance(result, list):
        return result
    if isinstance(result, dict):
        for key in (*keys, "items", "results", "data"):
            value = result.get(key)
            if isinstance(value, list):
                return value
    return []


def pick(record: dict, *names: str) -> Any:
    for name in names:
        if name in record:
            return record[name]
    return None


# The criterion types the scorer and the examiner screen understand. Mirrors
# CRITERION_TYPES in app/schemas/skills_testing.py; the API rejects anything
# else, and this seeder used to write "checkbox", which was stored happily and
# then scored as nothing.
CRITERION_TYPES = ("pass_fail", "score", "checklist", "time_limit", "statement")


def criterion_payload(entry: Any, sort_order: int) -> dict:
    """One criterion from a blueprint entry.

    A bare string is the common case — a required pass/fail step, as on a paper
    skill sheet. A dict supplies its own type and scoring so one template can
    mix weighted `score` steps with sections that carry no points at all.
    """
    if isinstance(entry, str):
        entry = {"label": entry}
    criterion = {
        "type": "pass_fail",
        "required": True,
        "sort_order": sort_order,
        **entry,
    }
    return criterion


def _minimal_pdf(title: str, subtitle: str) -> bytes:
    """A valid single-page PDF, assembled by hand.

    Enough of the format for a magic-byte sniffer to accept it and for a reader
    to render the two lines: catalog, pages, one page, a Helvetica font and a
    content stream, with a cross-reference table whose offsets are measured off
    the bytes actually written.
    """

    def _escape(text: str) -> str:
        return text.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")

    stream = (
        "BT /F1 18 Tf 72 696 Td (" + _escape(title) + ") Tj ET\n"
        "BT /F1 11 Tf 72 672 Td (" + _escape(subtitle) + ") Tj ET\n"
        "BT /F1 11 Tf 72 640 Td (Oakville Fire Department) Tj ET\n"
    ).encode("latin-1", "replace")

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length "
        + str(len(stream)).encode()
        + b" >>\nstream\n"
        + stream
        + b"endstream",
    ]

    out = bytearray(b"%PDF-1.4\n")
    offsets: list[int] = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"

    xref_at = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_at}\n%%EOF\n"
    ).encode()
    return bytes(out)


def _demo_pdf(title: str, subtitle: str) -> bytes:
    """A one-page PDF standing in for a real department document.

    The upload routes sniff the MIME type from the file's magic bytes rather
    than trusting the declared Content-Type, so this has to be a genuine PDF,
    not text with a .pdf name. reportlab is a backend dependency and the seeder
    is usually run on the system interpreter without it, so the fallback is a
    hand-built one-page PDF rather than plain text — the prospect-document route
    allows PDF, Word and images only, and rejected the text file outright.
    """
    try:
        from io import BytesIO

        from reportlab.lib.pagesizes import LETTER
        from reportlab.pdfgen import canvas
    except ImportError:
        return _minimal_pdf(title, subtitle)

    buffer = BytesIO()
    page = canvas.Canvas(buffer, pagesize=LETTER)
    width, height = LETTER
    page.setFont("Helvetica-Bold", 18)
    page.drawString(72, height - 96, title)
    page.setFont("Helvetica", 11)
    page.drawString(72, height - 120, subtitle)
    page.drawString(72, height - 152, "Oakville Fire Department")
    page.setFont("Helvetica-Oblique", 9)
    page.drawString(72, 72, "Demonstration document generated for the training guides.")
    page.showPage()
    page.save()
    return buffer.getvalue()


# ── Seed steps ────────────────────────────────────────────────────────

# `User.rank` holds a rank **code**, not a display name. Settings > Ranks
# validates every active member's rank against the configured codes
# (`DEFAULT_RANKS` in app/services/operational_rank_service.py) and banners
# every mismatch as "N active members with unrecognised ranks" — so seeding
# "Lieutenant" rather than "lieutenant", or inventing a rank the organization
# does not have ("Paramedic", "Firefighter/EMT"), leaves the demo department
# permanently displaying a warning about its own seed data. The codes below are
# the eight an organization is created with.
MEMBERS = [
    ("Dana", "Ruiz", "chief", "fire_chief"),
    ("Marcus", "Bell", "mbell", "deputy_chief"),
    ("Priya", "Raman", "praman", "assistant_chief"),
    ("Owen", "Kittredge", "okittredge", "captain"),
    ("Sofia", "Marchetti", "smarchetti", "captain"),
    ("Tobias", "Lindqvist", "tlindqvist", "lieutenant"),
    ("Amara", "Osei", "aosei", "lieutenant"),
    ("Henrik", "Vance", "hvance", "lieutenant"),
    ("Nadia", "Belhaj", "nbelhaj", "firefighter"),
    ("Callum", "Frazier", "cfrazier", "firefighter"),
    ("Ingrid", "Solberg", "isolberg", "firefighter"),
    ("Rafael", "Duarte", "rduarte", "firefighter"),
    ("Yuki", "Tanaka", "ytanaka", "firefighter"),
    ("Delia", "Okonkwo", "dokonkwo", "emt"),
    ("Bram", "Hollis", "bhollis", "emt"),
    ("Esme", "Caldwell", "ecaldwell", "emt"),
    ("Jonah", "Whitfield", "jwhitfield", "emt"),
    ("Lila", "Nakamura", "lnakamura", "emt"),
    # The three recruits start at EMT so the seeded promotions below are real
    # rank changes with an audit trail, not no-ops.
    ("Viktor", "Brennan", "vbrennan", "emt"),
    ("Saoirse", "Nolan", "snolan", "emt"),
    ("Emeka", "Adeyemi", "eadeyemi", "emt"),
    ("Wren", "Halloway", "whalloway", "engineer"),
]

# The recruits the training programs enrol. Named explicitly rather than
# derived from rank: rank is now a configured department code, and no
# organization is created with a "probationary" one — deriving recruit status
# from it silently enrolled nobody the moment the ranks were corrected.
RECRUIT_USERNAMES = {"vbrennan", "snolan", "eadeyemi"}

# Members whose `membership_type` is administrative rather than active.
#
# Every seeded member used to be `active`, which made the whole
# administrative/operational distinction invisible: the conversion modal offers
# "Administrative — Non-operational support role" as one of two choices, and
# election ballot items can restrict `eligible_voter_types`, but with one
# membership type on file a restriction either skips nobody or skips everybody.
# `14-elections.md` documents a send that reports how many were skipped and why,
# and it could not be photographed at all.
#
# Two, and deliberately two nobody photographs: no shot in `manifest.mjs`
# mentions either name, so giving them a different membership type cannot
# silently change an image that is already verified. Flipping existing members
# rather than adding new ones also keeps "Members on file" at 22, which several
# captured images state outright.
ADMINISTRATIVE_USERNAMES = {"jwhitfield", "bhollis"}

# Riding positions in the order a crew fills them. Sliced to a shift's minimum
# staffing, so a four-person engine asks for an officer, a driver and two
# firefighters while a two-person brush truck asks for an officer and a driver.
SHIFT_POSITIONS = ["officer", "driver", "firefighter", "firefighter", "ems"]

# Identifies the close-out wizard's fixture shift across re-runs.
#
# Matched on exactly, so it is a marker rather than prose — edit it and the next
# seeder run creates a second fixture beside the first instead of reusing it.
# Identifies the validated scorecard fixture among the several tests seeded on
# the same weighted template. Changing this text orphans the existing one: the
# seeder will build a second rather than find the first.
SCORECARD_TEST_NOTE = "Annual handline evaluation, weighted sheet."

PRIVACY_REVISIONS = [
    (
        """\
Oakville Fire Department operates this member intranet to run department
operations. The department is the data controller for everything in it.

What we keep: membership records, training and certification history, shift and
attendance records, and the emergency contact details you give us.

Who sees it: access follows your role.

Questions about your record go to the department secretary, not to the software
vendor.""",
        "Replaced the platform boilerplate with the department's own wording.",
    ),
    (
        """\
Oakville Fire Department operates this member intranet to run department
operations. The department is the data controller for everything in it.

What we keep: membership records, training and certification history, shift and
attendance records, and the emergency contact details you give us.

How long: personnel records for the length of membership plus seven years, per
the department's retention schedule and the Virginia Public Records Act.

Who sees it: access follows your role. Medical and screening records are held
separately and reached only by the members named in the department's HIPAA
policy.

Questions about your record go to the department secretary, not to the software
vendor. The department decides what is collected, who may read it, and when it
is destroyed.""",
        "Added the retention schedule and the separate handling of medical "
        "records, per counsel's note of 21 August.",
    ),
    (
        """\
Oakville Fire Department operates this member intranet to run department
operations. The department is the data controller for everything in it.

What we keep: membership records, training and certification history, shift and
attendance records, and the emergency contact details you give us.

How long: personnel records for the length of membership plus seven years, per
the department's retention schedule and the Virginia Public Records Act.

Who sees it: access follows your role. Medical and screening records are held
separately and reached only by the members named in the department's HIPAA
policy.

Leaving the department: your record is retained under the schedule above rather
than deleted, because it is a department record and in places a statutory one.
Ask the secretary for a copy of what is held about you at any time.

Questions about your record go to the department secretary, not to the software
vendor. The department decides what is collected, who may read it, and when it
is destroyed.""",
        "Answered the question members kept asking at orientation: what happens "
        "to your record after you leave. Adopted at the 19 August business "
        "meeting.",
    ),
]

SECRETARY_DRAFT_NOTE = (
    "Second pass after the officers' meeting: added the account-suspension "
    "and equipment-return clauses the bylaws already require."
)

SECRETARY_DRAFT_BODY = """\
DRAFT — not yet adopted. Second pass, incorporating the officers' comments.

Using this system: your account is issued by Oakville Fire Department and
belongs to the department. Use it for department business.

Your account is suspended when your membership is suspended, and closed when
your membership ends. Department property issued to you — turnout gear, radios,
keys, station fobs — is returned at the same time, per Article VII of the
bylaws.

What you post: minutes, reports and messages entered here are department
records. Write them as such.

Questions go to the department secretary."""

TERMS_DRAFT_BODY = """\
DRAFT — not yet adopted.

This system is department property provided for department business. Your
access exists because of your standing as a member and changes or ends with it.

You are responsible for what happens under your account. Do not share your
sign-in. Report a lost device to a duty officer the same day.

Records created here — training entries, shift reports, incident notes — are
department records, not personal ones. Treat this as a department system rather
than a private one."""

CLOSEOUT_SHIFT_NOTE = (
    "Close-out wizard fixture — 24-hour tour, four crew, count-only captures."
)

# One future shift is left crewed by its officer alone.
#
# Every other shift is staffed to its minimum or one short, which is what a real
# schedule looks like — but it means the crew board never shows more than a
# single open row, and the bulk "Fill All Open" action only appears once two or
# more slots are unfilled. Both were unreachable in the demo, so the guide's
# crew-board screenshot had nothing to photograph.
#
# ``(day offset from today, index into the fleet)``. Day 4 puts it far enough
# ahead to be unambiguously future on any run; fleet index 2 is the Weekend Duty
# Crew template, whose minimum staffing of four leaves three rows open beside
# the officer's filled one.
PART_STAFFED_SHIFT = (4, 2)

# The requirement each programme makes members finish before the rest of its
# phase. Chosen among the requirements the seeded members have *not* finished,
# so the lock has siblings left to hold back.
PROGRAM_GATE_REQUIREMENTS = {
    "Probationary Firefighter Pipeline": (
        "Hose Deployment",
        # A knowledge test is only completable by an explicitly recorded exam
        # result, so this gate survives the hour auto-credit that quietly
        # finished Hose Deployment for the seeded members — a gate already
        # satisfied locks nothing, and the member-facing "Locked until you
        # finish …" line disappeared with it.
        "Firefighter I Written Exam",
    ),
}

# The one enrollment left past its deadline, so Expired and the reopen dialog
# are reachable. Deliberately not one of the four recruits: their enrollments
# are what the progression screenshots are built around.
EXPIRED_ENROLLMENT_PROGRAM = "Recruit School Pipeline"
EXPIRED_ENROLLMENT_USERNAME = "bhollis"
EXPIRED_ENROLLMENT_DAYS_OVER = 23

# Steps behind a checklist requirement, keyed on the requirement name.
CHECKLIST_ITEMS = {
    # The last three are officer-recorded (member_visible False): the member
    # view folds them into a "+N more steps your officer records" line, which
    # is the subject of a guide-02 screenshot and renders only when at least
    # one step is hidden.
    "Station Duties Checklist": [
        "Tour the apparatus bay and name every rig",
        "Meet the duty officer and shift crew",
        "Locate the SCBA fill station and spare bottles",
        "Walk the station's evacuation route",
        "Log in to The Logbook and set a photo",
        {"text": "SCBA fit test on file", "member_visible": False},
        {"text": "Turnout gear issued and sized", "member_visible": False},
        {"text": "Emergency contacts recorded", "member_visible": False},
    ],
    "Officer Sign-Off": [
        "Company officer has observed a full shift",
        "Training officer has reviewed the progression",
        "Chief's final sign-off recorded",
    ],
}

APPARATUS = [
    ("E-1", "Engine 1", 2021, "Pierce", "Enforcer", "engine"),
    ("E-2", "Engine 2", 2015, "Pierce", "Saber", "engine"),
    ("L-4", "Ladder 4", 2019, "Seagrave", "Aerialscope", "ladder"),
    ("M-3", "Medic 3", 2023, "Ford", "F-450 / Horton", "ambulance"),
    ("R-7", "Rescue 7", 2018, "Spartan", "Gladiator", "rescue"),
    ("B-5", "Brush 5", 2020, "Ford", "F-550", "brush"),
    ("U-1", "Utility 1", 2017, "Chevrolet", "Silverado 2500", "utility"),
]

# Pump/tank/ladder/GVWR/fuel/seats per rig type. Without these every
# apparatus form and detail page is a column of blank spec fields — the
# screenshot reads as a half-filled record rather than as a fleet.
# Values are ordinary for the class: a 1500 GPM engine on a 750-gallon tank,
# a 95-foot tower, a medic with no pump at all.
APPARATUS_SPECS = {
    "engine": {
        "pumpCapacityGpm": 1500,
        "tankCapacityGallons": 750,
        "gvwr": 46000,
        "fuelCapacityGallons": 65,
        "seatingCapacity": 6,
        "minStaffing": 3,
    },
    "ladder": {
        "pumpCapacityGpm": 1500,
        "tankCapacityGallons": 300,
        "ladderLengthFeet": 95,
        "gvwr": 68000,
        "fuelCapacityGallons": 80,
        "seatingCapacity": 6,
        "minStaffing": 4,
    },
    "ambulance": {
        "gvwr": 16500,
        "fuelCapacityGallons": 40,
        "seatingCapacity": 4,
        "minStaffing": 2,
    },
    "rescue": {
        "gvwr": 52000,
        "fuelCapacityGallons": 70,
        "seatingCapacity": 6,
        "minStaffing": 3,
    },
    "brush": {
        "pumpCapacityGpm": 250,
        "tankCapacityGallons": 300,
        "gvwr": 19500,
        "fuelCapacityGallons": 40,
        "seatingCapacity": 3,
        "minStaffing": 2,
    },
    "utility": {
        "gvwr": 9600,
        "fuelCapacityGallons": 36,
        "seatingCapacity": 5,
        "minStaffing": 1,
    },
}

# The department's own shift-report vocabulary. All of it was NULL, which is
# indistinguishable from a configured department at a glance — the report form
# falls back to the frontend's built-in samples — right up to the point where
# something reads the *per-apparatus* mappings. The "+ Add" control under Tasks
# Performed pre-fills a task name from `apparatus_type_tasks`; unset, it appends
# a blank row on every rig.
#
# The rating labels are the department's, not the code's: a five-point scale
# ending in "Exemplary" rather than "Excellent", which is the point of the
# setting existing at all.
RATING_SCALE_LABELS = {
    "1": "Unsatisfactory",
    "2": "Developing",
    "3": "Competent",
    "4": "Proficient",
    "5": "Exemplary",
}

SHIFT_REVIEW_CALL_TYPES = [
    "Structure Fire",
    "Vehicle Fire",
    "Brush/Wildland",
    "EMS/Medical",
    "Motor Vehicle Accident",
    "Hazmat",
    "Rescue/Extrication",
    "Alarm Investigation",
    "Public Assist",
    "Mutual Aid",
]

SHIFT_REVIEW_SKILLS = [
    "SCBA donning/doffing",
    "Hose deployment",
    "Ladder operations",
    "Search and rescue",
    "Ventilation",
    "Pump operations",
    "Patient assessment",
    "Radio communications",
    "Scene size-up",
    "Apparatus check-off",
]

SHIFT_REVIEW_TASKS = [
    "Apparatus check",
    "Station duties",
    "Hose testing",
    "Equipment inventory",
    "Public education",
]

# Per rig class, so an engine crew is not asked about aerial placement and a
# medic crew is not asked about pump pressures.
# Keyed by the apparatus-type *code* ("ladder"), which is what
# ApparatusRef.type_slug now resolves for shifts and templates alike. It
# briefly matched nothing while the slug was the lowercased display name
# ("ladder/aerial") — fixed on the backend rather than by renaming these keys,
# since every UI-configured department already keys on the code.
APPARATUS_TYPE_SKILLS = {
    "engine": [
        "Pump operations",
        "Hose deployment",
        "Hydrant connection",
        "Nozzle technique",
        "SCBA donning/doffing",
    ],
    "ladder": [
        "Aerial placement",
        "Ground ladder throw",
        "Ventilation",
        "Search and rescue",
        "Forcible entry",
    ],
    "ambulance": [
        "Patient assessment",
        "Vitals monitoring",
        "CPR/AED",
        "Stretcher operations",
        "Radio communications",
    ],
}

APPARATUS_TYPE_TASKS = {
    "engine": [
        "Pump test",
        "Hose load inventory",
        "Hydrant survey",
        "Foam level check",
    ],
    "ladder": [
        "Aerial inspection",
        "Ground ladder inventory",
        "Saw and fan service",
        "Rope and rigging check",
    ],
    "ambulance": [
        "Narcotics count",
        "Oxygen level check",
        "Cot and stair-chair service",
        "Airway kit inventory",
    ],
}

FACILITIES = [
    ("Station 1 - Headquarters", "410 Grand Avenue", 1962, 24000, 4),
    ("Station 2 - Westside", "1820 Prairie Road", 1988, 11500, 2),
    ("Training & Administration Center", "22 Depot Street", 2004, 9200, 1),
]

# Rooms nested inside rooms, at headquarters.
#
# Three guide-06 captures (06-24 nested tree, 06-25 "Located Inside", 06-26 the
# delete-with-sub-rooms confirmation) and guide 19's rooms marker all photograph
# this tree, and it needs three levels to show anything: a container reporting
# how many rooms it holds, a sub-room that is itself a container, and a leaf.
#
# It was built by hand during the 2026-08-17 capture run and never written
# down, so it lived only in whichever database that session happened to be
# using. Dropping that database destroyed it, and the three shots -- which the
# currency log described as re-shooting rather than going stale -- failed with
# a 20s locator timeout on a room nothing had created.
#
# ``(name, room_type, floor, capacity, parent name or None)``. Order matters:
# a parent has to exist before the row naming it.
HQ_ROOMS = [
    ("Volunteer Office", "office", 1, 8, None),
    ("Quartermaster's Storage", "storage", 1, 2, "Volunteer Office"),
    ("Locker Cage", "storage", 1, None, "Quartermaster's Storage"),
    ("Records Closet", "storage", 1, None, "Volunteer Office"),
]


class Seeder:
    def __init__(self, api: Api, base_url: str, bulk_prospects: int = 0) -> None:
        self.api = api
        self.base_url = base_url
        self.bulk_prospects = bulk_prospects
        self.failures: list[str] = []
        self.blocked: list[str] = []
        self.created: dict[str, list[dict]] = {}

    def step(self, label: str, fn) -> Any:
        try:
            result = fn()
        except ApiError as exc:
            self.failures.append(f"{label}: {exc}")
            print(f"  ! {label}: {exc}")
            return None
        print(f"  + {label}")
        return result

    # -- organization ------------------------------------------------

    def enable_all_modules(self) -> None:
        # Screenshots cover every guide, including modules that ship disabled
        # (grants, elections, storefront, …), so the demo org turns them all on.
        self.api.patch(
            "/organization/modules",
            {
                "training": True,
                "inventory": True,
                "scheduling": True,
                "apparatus": True,
                "communications": True,
                "elections": True,
                "minutes": True,
                "reports": True,
                "notifications": True,
                "mobile": True,
                "forms": True,
                "integrations": True,
                "facilities": True,
                "incidents": True,
                "hr_payroll": True,
                "grants": True,
                "storefront": True,
                "prospective_members": True,
                "public_info": True,
            },
        )

    # -- people ------------------------------------------------------

    def seed_members(self) -> list[dict]:
        existing = items(self.api.get("/users?limit=200"), "users")
        by_username = {u.get("username"): u for u in existing}
        created = list(existing)
        for index, (first, last, username, rank) in enumerate(MEMBERS):
            if username in by_username:
                # An earlier run stored display names ("Firefighter/EMT") where
                # the code belongs; bring those in line rather than leaving the
                # roster in the settings page's mismatch warning.
                current = by_username[username]
                if pick(current, "rank") != rank and pick(current, "id"):
                    self.api.patch(
                        f"/users/{pick(current, 'id')}/profile", {"rank": rank}
                    )
                    current["rank"] = rank
                # Same reason as the rank repair above: a member created before
                # ADMINISTRATIVE_USERNAMES existed keeps `active`, and the
                # seeder never revisits a user it did not create.
                wanted_type = (
                    "administrative" if username in ADMINISTRATIVE_USERNAMES else None
                )
                if (
                    wanted_type
                    and pick(current, "membership_type") != wanted_type
                    and pick(current, "id")
                ):
                    # `/users/{id}/profile` is the wrong route for this and
                    # says nothing about it: `UserUpdate` has no
                    # `membership_type` field, so the PATCH is accepted and the
                    # value dropped. The tier change has its own endpoint,
                    # which also validates against the configured tiers.
                    try:
                        self.api.patch(
                            f"/users/{pick(current, 'id')}/membership-type",
                            {
                                "membership_type": wanted_type,
                                "reason": ("Moved to non-operational support role."),
                            },
                        )
                        current["membership_type"] = wanted_type
                    except ApiError as exc:
                        self.blocked.append(f"membership type: {exc}")
                continue
            record = self.api.post(
                "/users",
                {
                    "username": username,
                    "email": f"{username}@oakvillefd.example.org",
                    "first_name": first,
                    "last_name": last,
                    "membership_number": f"{index + 1:03d}",
                    "phone": f"(703) 555-{2000 + index:04d}",
                    "mobile": f"(703) 555-{3000 + index:04d}",
                    "rank": rank,
                    "hire_date": str(TODAY - timedelta(days=365 * (2 + index % 12))),
                    "address_street": f"{100 + index * 7} Sycamore Lane",
                    "address_city": "Oakville",
                    "address_state": "VA",
                    "address_zip": "22046",
                    "emergency_contacts": [
                        {
                            "name": f"{first} {last} Sr.",
                            "relationship": "Parent",
                            "phone": f"(703) 555-{4000 + index:04d}",
                            "is_primary": True,
                        }
                    ],
                    "send_welcome_email": False,
                    # Set here rather than through the admin reset endpoint so a
                    # fresh seed never has to wait out that route's 5-per-5-minute
                    # limiter. See seed_event_rsvps for why members need a login.
                    "password": DEMO_MEMBER_PASSWORD,
                },
            )
            if username in ADMINISTRATIVE_USERNAMES and pick(record, "id"):
                try:
                    self.api.patch(
                        f"/users/{pick(record, 'id')}/membership-type",
                        {
                            "membership_type": "administrative",
                            "reason": "Moved to non-operational support role.",
                        },
                    )
                    record["membership_type"] = "administrative"
                except ApiError as exc:
                    self.blocked.append(f"membership type: {exc}")
            created.append(record)
        self._fill_in_the_administrator(created)
        self._enable_two_factor_for_one_member(created)
        return created

    # Accounts something else signs into by name. Enrolling any of them in TOTP
    # breaks that caller, because a password sign-in on an MFA account stops at
    # the code step and returns no session.
    PASSWORD_LOGIN_ACCOUNTS = frozenset(
        {
            DEMO_ADMIN_USERNAME,
            DEMO_MEMBER_USERNAME,
            DEMO_PEER_EXAMINER_USERNAME,
        }
    )

    def _assert_two_factor_account_is_unused(self) -> None:
        """Fail loudly if the TOTP account is one somebody signs into.

        The first choice here was DEMO_PEER_EXAMINER_USERNAME, picked after
        checking only the two accounts *captures* sign in as. The seeder signs
        in as far more than that, and the result was three steps failing with
        401s a long way from the cause.
        """
        if TWO_FACTOR_USERNAME in self.PASSWORD_LOGIN_ACCOUNTS:
            raise SystemExit(
                f"TWO_FACTOR_USERNAME is {TWO_FACTOR_USERNAME!r}, which is also "
                "signed into by password elsewhere in this file. Enrolling it "
                "in TOTP breaks that caller — choose an account no step signs "
                "in as."
            )

    def _enable_two_factor_for_one_member(self, members: list[dict]) -> None:
        """Enrol one member in TOTP.

        With nobody enrolled, two things cannot be pictured: the login page's
        authentication-code step, and the **Reset MFA** action on the members
        admin page, which only renders for a user who has it on.
        """
        self._assert_two_factor_account_is_unused()
        target = next(
            (m for m in members if pick(m, "username") == TWO_FACTOR_USERNAME),
            None,
        )
        user_id = pick(target or {}, "id")
        if not user_id:
            return

        # Read the flag as the administrator, not through the member's own
        # /auth/mfa/status: once MFA is on, a password sign-in stops short of a
        # session and every call it makes answers 401 — so the check that is
        # supposed to make this step idempotent is the first thing that breaks.
        # It has to be /users/with-roles specifically; the plain /users list
        # does not carry mfa_enabled.
        enrolled = any(
            pick(row, "username") == TWO_FACTOR_USERNAME and pick(row, "mfa_enabled")
            for row in items(self.api.get("/users/with-roles"), "users")
        )
        if enrolled:
            return

        # `member_session`, not a bare `login_as`: `POST /users` flags every
        # account it creates must_change_password, and `/auth/mfa/setup` is not
        # one of the paths that gate exempts
        # (`_MUST_CHANGE_PW_ALLOWED_SUFFIXES` in `app/api/dependencies.py`). A
        # bare sign-in therefore succeeds and the enrolment request that
        # follows answers 403, leaving nobody enrolled and
        # `00-23-login-two-factor` timing out on a code step that never
        # appears. Clearing the flag re-sets the same DEMO_MEMBER_PASSWORD, so
        # the credentials the manifest signs in with are unchanged.
        try:
            session = self.member_session(self.base_url, user_id, TWO_FACTOR_USERNAME)
        except ApiError as exc:
            self.blocked.append(f"two-factor: sign in as member: {exc}")
            return

        try:
            secret = session.post("/auth/mfa/setup")["secret"]
            # Enrolment is only complete once a real code is verified — there
            # is no endpoint that flips the flag directly, by design.
            session.post(
                "/auth/mfa/verify-setup",
                {"code": totp_now(secret)},
            )
        except ApiError as exc:
            self.blocked.append(f"two-factor: enrol {TWO_FACTOR_USERNAME}: {exc}")

    def _fill_in_the_administrator(self, members: list[dict]) -> None:
        """Give the demo administrator the contact details everyone else has.

        `bootstrap_demo.py` creates this account, not `seed_members`, so it is
        the one member on the roster with no phone, no address and no emergency
        contact. Every screenshot taken as the administrator — Account
        Settings first among them — was therefore a page of empty inputs.
        """
        admin = next(
            (m for m in members if pick(m, "username") == DEMO_ADMIN_USERNAME), None
        )
        admin_id = pick(admin or {}, "id")
        if not admin_id:
            return
        # Read through /with-roles, not the roster row. The member list gates
        # contact details behind the organization's contact-info-visibility
        # setting, so `phone` there is None whether or not one is on file — a
        # guard keyed on it would re-write the record on every run and stamp
        # over anything edited by hand.
        try:
            current = self.api.get(f"/users/{admin_id}/with-roles")
        except ApiError:
            return
        if pick(current, "phone"):
            return
        self.api.patch(
            f"/users/{admin_id}/profile",
            {
                "phone": "(703) 555-0100",
                "mobile": "(703) 555-0101",
                "address_street": "1 Firehouse Square",
                "address_city": "Oakville",
                "address_state": "VA",
                "address_zip": "22046",
                "station": "Station 1 - Headquarters",
                "emergency_contacts": [
                    {
                        "name": "Marisol Ruiz",
                        "relationship": "Spouse",
                        "phone": "(703) 555-0102",
                        "is_primary": True,
                    }
                ],
            },
        )

    # -- membership: recorded changes --------------------------------

    def seed_member_changes(self, members: list[dict]) -> None:
        """Promote a couple of members so the audit history has real entries.

        The history page is a timeline of *changes*. Without any it fills with
        "Member profile viewed" rows — which the screenshot tooling itself
        generates on every capture run — and the guide's example of "Rank changed
        from X to Y" has nothing behind it.
        """
        # Rank codes, matching MEMBERS — a promotion to a display name would
        # re-introduce the unrecognised-rank warning one member at a time.
        promotions = [
            ("vbrennan", "firefighter"),
            ("snolan", "firefighter"),
            ("cfrazier", "lieutenant"),
        ]
        by_username = {m.get("username"): m for m in members}
        for username, new_rank in promotions:
            member = by_username.get(username)
            user_id = pick(member or {}, "id")
            if not user_id or (member or {}).get("rank") == new_rank:
                continue
            self.api.patch(f"/users/{user_id}/profile", {"rank": new_rank})

    # -- facilities & apparatus --------------------------------------

    def _adopt_headquarters_facility(self, existing: list[dict]) -> list[dict]:
        """Rename onboarding's auto-created headquarters into Station 1.

        Creating the organization also creates a facility named after it
        (`OnboardingService._create_headquarters_facility`), and the stations
        step is documented as adding the stations *beyond* headquarters. This
        seeder's FACILITIES list names its own "Station 1 - Headquarters", so
        without this the demo department owns two headquarters and a facility
        named after the department itself — a row no real department has, which
        fronted the facility list in two captures.

        Adopting the record rather than deleting it is also what a real
        administrator does with it, so the seeded state stays a picture of the
        product rather than of the seeder.
        """
        hq_name, hq_address, hq_year, hq_sqft, hq_bays = FACILITIES[0]
        if any(f.get("name") == hq_name for f in existing):
            return existing

        org_name = (self.api.get("/organization/profile") or {}).get("name")
        if not org_name:
            return existing

        stray = next((f for f in existing if f.get("name") == org_name), None)
        if not stray:
            return existing

        facility_id = pick(stray, "id")
        if not facility_id:
            return existing

        renamed = self.api.patch(
            f"/facilities/{facility_id}",
            {
                "name": hq_name,
                "address_line1": hq_address,
                "city": "Oakville",
                "state": "VA",
                "zip_code": "22046",
                "year_built": hq_year,
                "square_footage": hq_sqft,
                "num_bays": hq_bays,
                "num_floors": 2,
                "sleeping_quarters": 8 if hq_bays > 2 else 4,
                "description": (
                    f"{hq_name} houses front-line apparatus and crew quarters."
                ),
            },
        )
        self._rename_paired_location(org_name, hq_name, hq_address)
        return [renamed if f is stray else f for f in existing]

    def _rename_paired_location(
        self, org_name: str, hq_name: str, hq_address: str
    ) -> None:
        """Rename the Location onboarding created alongside the facility.

        ``_create_facility_with_location`` mints both records, and renaming the
        facility alone leaves the Location still called after the department.
        That one is the more visible of the two: Locations are what the events
        picker, the room-display codes and ``/locations/qr-codes`` list, so the
        stray fronted the Check-In QR Codes directory as
        "Oakville Fire Department #101" above the three real stations.
        """
        for location in items(self.api.get("/locations"), "locations"):
            if location.get("name") != org_name:
                continue
            location_id = pick(location, "id")
            if not location_id:
                continue
            self.api.patch(
                f"/locations/{location_id}",
                {"name": hq_name, "address": hq_address},
            )
            return

    def seed_facilities(self) -> list[dict]:
        existing = items(self.api.get("/facilities"), "facilities")
        existing = self._adopt_headquarters_facility(existing)
        names = {f.get("name") for f in existing}
        created = list(existing)
        for name, address, year, sqft, bays in FACILITIES:
            if name in names:
                continue
            created.append(
                self.api.post(
                    "/facilities",
                    {
                        "name": name,
                        "address_line1": address,
                        "city": "Oakville",
                        "state": "VA",
                        "zip_code": "22046",
                        "year_built": year,
                        "square_footage": sqft,
                        "num_bays": bays,
                        "num_floors": 2,
                        "is_owned": True,
                        "sleeping_quarters": 8 if bays > 2 else 4,
                        "phone": "(703) 555-0142",
                        "description": f"{name} houses front-line apparatus and crew quarters.",
                    },
                )
            )
        return created

    def seed_rooms(self, facilities: list[dict]) -> list[dict]:
        """Build the nested room tree at headquarters.

        Hung off the first facility in FACILITIES rather than "whichever the
        API returns first": the captures open the facility by that name, and a
        tree that moved between runs would point three shots at an empty Rooms
        section without failing anything.
        """
        hq_name = FACILITIES[0][0]
        hq = next((f for f in facilities if f.get("name") == hq_name), None)
        if not hq:
            self.blocked.append(
                f"rooms: no facility named {hq_name!r} to hang the tree on"
            )
            return []

        facility_id = pick(hq, "id")
        existing = items(
            self.api.get(f"/facilities/rooms?facility_id={facility_id}"), "rooms"
        )
        by_name = {r.get("name"): r for r in existing}

        created: list[dict] = []
        for name, room_type, floor, capacity, parent_name in HQ_ROOMS:
            if name in by_name:
                continue
            parent = by_name.get(parent_name) if parent_name else None
            if parent_name and not parent:
                # The parent failed to create, so this row would silently land
                # at the top level and flatten the tree the shots are of.
                self.blocked.append(
                    f"rooms: {name!r} needs {parent_name!r}, which is not there"
                )
                continue
            payload = {
                "facility_id": facility_id,
                "name": name,
                "floor": floor,
                "room_type": room_type,
                # Cold Zone renders as a badge on every row, which is what the
                # tree capture shows beside the sub-room counts.
                "zone_classification": "cold",
            }
            if capacity is not None:
                payload["capacity"] = capacity
            if parent:
                payload["parent_room_id"] = pick(parent, "id")
            room = self.api.post("/facilities/rooms", payload)
            by_name[name] = room
            created.append(room)
        return created

    def seed_locations(self, facilities: list[dict]) -> list[dict]:
        # Stations are Locations, not Facilities: apparatus.primary_station_id
        # is a FK to `locations`, so a facility id there fails the constraint.
        existing = items(self.api.get("/locations"), "locations")
        names = {loc.get("name") for loc in existing}
        created = list(existing)
        by_name = {f.get("name"): f for f in facilities}
        for name, address, _year, _sqft, bays in FACILITIES:
            if name in names:
                continue
            facility = by_name.get(name) or {}
            payload = {
                "name": name,
                "description": f"Apparatus bays and crew quarters at {name}.",
                "address": address,
                "city": "Oakville",
                "state": "VA",
                "zip": "22046",
                "capacity": bays * 6,
                "is_active": True,
            }
            if facility.get("id"):
                payload["facility_id"] = facility["id"]
            created.append(self.api.post("/locations", payload))

        # The Storage Areas page treats a location as a room only when it has a
        # room number or a facility-room link, and its area list is keyed on
        # the selected room. Stations seeded without one left the page stuck on
        # "Select a facility and room above" with an empty, disabled dropdown —
        # no storage area was reachable at all.
        for index, location in enumerate(created):
            location_id = pick(location, "id")
            if not location_id or pick(location, "room_number", "roomNumber"):
                continue
            room_number = f"{101 + index}"
            self.api.patch(f"/locations/{location_id}", {"room_number": room_number})
            location["room_number"] = room_number
        return created

    def seed_apparatus(self, stations: list[dict]) -> list[dict]:
        types = items(self.api.get("/apparatus/types"), "types")
        statuses = items(self.api.get("/apparatus/statuses"), "statuses")
        if not types or not statuses:
            raise ApiError("GET", "/apparatus/types", 0, "no seeded types/statuses")

        def type_id(slug: str) -> str:
            for t in types:
                value = str(pick(t, "code", "slug", "name") or "").lower()
                if slug in value:
                    return pick(t, "id")
            return pick(types[0], "id")

        in_service = next(
            (
                s
                for s in statuses
                if "in_service" in str(pick(s, "code", "slug", "name") or "").lower()
                or "in service" in str(pick(s, "name") or "").lower()
            ),
            statuses[0],
        )
        station_ids = [pick(s, "id") for s in stations if pick(s, "id")]

        existing = items(self.api.get("/apparatus"), "apparatus")
        units = {pick(a, "unitNumber", "unit_number") for a in existing}
        created = list(existing)
        for index, (unit, name, year, make, model, slug) in enumerate(APPARATUS):
            if unit in units:
                continue
            payload = {
                "unitNumber": unit,
                "name": name,
                "apparatusTypeId": type_id(slug),
                "statusId": pick(in_service, "id"),
                "year": year,
                "make": make,
                "model": model,
                "fuelType": "diesel" if slug != "utility" else "gasoline",
                "currentMileage": 18_000 + year % 100 * 250,
                "inServiceDate": str(date(year, 5, 1)),
                "vin": f"1FD{unit.replace('-', ''):<4.4}{year}XX{index:07d}"[:17],
                "licensePlate": f"VA-{unit.replace('-', '')}",
                "licenseState": "VA",
            }
            if station_ids:
                payload["primaryStationId"] = station_ids[index % len(station_ids)]
            payload.update(
                APPARATUS_SPECS.get(slug, {"seatingCapacity": 4, "minStaffing": 2})
            )
            created.append(self.api.post("/apparatus", payload))

        self._fill_apparatus_specs(created)
        return created

    def _fill_apparatus_specs(self, apparatus: list[dict]) -> None:
        """Backfill specs onto rigs seeded before APPARATUS_SPECS existed.

        Keyed on the spec being absent rather than on "did we create it this
        run", so a demo database carrying the older blank-spec fleet is
        repaired in place instead of needing a wipe.
        """
        by_unit = {unit: slug for unit, _name, _y, _mk, _md, slug in APPARATUS}
        for rig in apparatus:
            rig_id = pick(rig, "id")
            unit = pick(rig, "unitNumber", "unit_number")
            specs = APPARATUS_SPECS.get(by_unit.get(unit, ""))
            if not rig_id or not specs:
                continue
            if pick(rig, "gvwr") or pick(
                rig, "fuelCapacityGallons", "fuel_capacity_gallons"
            ):
                continue
            self.api.patch(f"/apparatus/{rig_id}", specs)

    # -- apparatus: maintenance, fuel, equipment ---------------------

    def seed_evoc_levels(self) -> list[dict]:
        """Driver/operator certification tiers.

        The apparatus form hides its "Required EVOC Level" dropdown entirely
        when no levels are defined, and scheduling has nothing to validate a
        driver against.
        """
        levels = items(self.api.get("/apparatus/evoc-levels"), "levels")
        # A new organization is seeded with four levels (EVOC1..EVOC4) by the
        # product itself, so this step normally has nothing to do. Returning
        # them is not merely an optimisation: the blueprint below would collide
        # with what is already there, and `by_level` is keyed on level_number,
        # so inventing a parallel set is wrong even where it succeeds.
        if levels:
            return levels
        codes = {level.get("code") for level in levels}
        # The backend enforces uniqueness on level_number, not code, so guarding
        # on code alone let a differently-coded level of the same number through
        # to a 400 that failed the whole step -- which left `by_level` empty and
        # no apparatus with a required EVOC level, so the driver-eligibility
        # feature sat inert and 03-52 had nothing to photograph.
        numbers = {pick(level, "level_number", "levelNumber") for level in levels}
        blueprint = [
            (1, "Basic", "EVOC-1", "Emergency vehicle operation, non-transport."),
            (2, "Intermediate", "EVOC-2", "Engine and rescue apparatus."),
            (3, "Advanced", "EVOC-3", "Aerial and tiller-equipped apparatus."),
        ]
        for number, name, code, description in blueprint:
            if code in codes or number in numbers:
                continue
            levels.append(
                self.api.post(
                    "/apparatus/evoc-levels",
                    {
                        "level_number": number,
                        "name": name,
                        "code": code,
                        "description": description,
                        "sort_order": number,
                    },
                )
            )
        return levels

    def seed_apparatus_operators(
        self, apparatus: list[dict], members: list[dict], levels: list[dict]
    ) -> list[dict]:
        """Certified drivers on each rig.

        Without these the Operators tab on every apparatus is empty, the EVOC
        dropdown has nothing to picture, and the driver-eligibility check in
        scheduling never fires — it needs an ApparatusOperator row carrying an
        EVOC level before it can compare one against an apparatus requirement.

        Levels are spread rather than uniform: an engine crewed only by
        EVOC-3 drivers cannot demonstrate the warning a department actually
        sees, which is a member qualified for one rig being put on another.
        """
        if not apparatus or not members:
            return []

        existing = items(self.api.get("/apparatus/operators"), "operators")
        # Keyed on the pairs already present, not on "are there any rows" — a
        # partial run must be able to add the rigs it did not reach.
        seeded = {
            (pick(row, "apparatus_id", "apparatusId"), pick(row, "user_id", "userId"))
            for row in existing
        }
        by_level = {
            pick(level, "level_number", "levelNumber"): level for level in levels
        }
        today = date.today()

        created: list[dict] = []
        for index, rig in enumerate(apparatus[:4]):
            rig_id = pick(rig, "id")
            if not rig_id:
                continue
            for offset in range(3):
                member = members[(index * 3 + offset) % len(members)]
                user_id = pick(member, "id")
                if not user_id or (rig_id, user_id) in seeded:
                    continue
                level = by_level.get((offset % 3) + 1)
                payload = {
                    "apparatus_id": rig_id,
                    "user_id": user_id,
                    "is_certified": True,
                    "certification_date": str(
                        today - timedelta(days=180 + offset * 30)
                    ),
                    # A year out, so nothing in the fleet reads as expired on
                    # a screenshot taken months from now.
                    "certification_expiration": str(today + timedelta(days=365)),
                    "license_type_required": "CDL Class B",
                    "license_verified": True,
                    "license_verified_date": str(today - timedelta(days=180)),
                    "is_active": True,
                }
                if level:
                    payload["evoc_level_id"] = pick(level, "id")
                created.append(self.api.post("/apparatus/operators", payload))
                seeded.add((rig_id, user_id))

        self._require_evoc_on_apparatus(apparatus, by_level)
        return created

    def _require_evoc_on_apparatus(self, apparatus: list[dict], by_level: dict) -> None:
        """Give the heavier rigs a minimum EVOC level to drive them.

        Without a requirement on the apparatus the driver-eligibility check
        returns "eligible" for everybody and never fires — the whole feature is
        inert, and the apparatus form hides the value it is supposed to show.
        Scaled by rig: an aerial asks more of a driver than a utility does.
        """
        wanted = {
            "engine": 2,
            "pumper": 2,
            "ladder": 3,
            "truck": 3,
            "aerial": 3,
            "tower": 3,
            "rescue": 2,
            "tanker": 2,
            "ambulance": 1,
            "brush": 1,
        }
        for rig in apparatus:
            rig_id = pick(rig, "id")
            if not rig_id:
                continue
            detail = self.api.get(f"/apparatus/{rig_id}")
            if pick(detail, "required_evoc_level_id", "requiredEvocLevelId"):
                continue
            haystack = " ".join(
                str(pick(detail, key) or "")
                for key in ("unit_number", "unitNumber", "name", "make", "model")
            ).lower()
            number = next(
                (value for word, value in wanted.items() if word in haystack), None
            )
            level = by_level.get(number) if number else None
            if not level:
                continue
            # PATCH, not PUT: the apparatus update route is registered as a
            # partial update and a PUT gets a bare 405.
            self.api.patch(
                f"/apparatus/{rig_id}",
                {"required_evoc_level_id": pick(level, "id")},
            )

    def seed_apparatus_activity(self, apparatus: list[dict]) -> dict[str, list[dict]]:
        if not apparatus:
            return {}

        types = items(self.api.get("/apparatus/maintenance-types"), "types")
        type_names = {t.get("name") for t in types}
        for name, code, category in [
            ("Preventive Maintenance", "PM", "preventive"),
            ("Annual Pump Test", "PUMP", "certification"),
            ("Repair", "REPAIR", "repair"),
            ("Tire Replacement", "TIRE", "repair"),
        ]:
            if name in type_names:
                continue
            types.append(
                self.api.post(
                    "/apparatus/maintenance-types",
                    {
                        "name": name,
                        "code": code,
                        "category": category,
                        "description": f"{name} performed on department apparatus.",
                    },
                )
            )
        if not types:
            return {}

        maintenance = items(self.api.get("/apparatus/maintenance"), "maintenance")
        if not maintenance:
            work = [
                (
                    "Annual pump service and flow test",
                    "Atlantic Fire Apparatus",
                    2_450,
                    120,
                    "Annual Pump Test",
                ),
                ("Oil and filter change", "In-house", 210, 75, "Oil Change"),
                (
                    "Brake inspection and pad replacement",
                    "Commonwealth Truck",
                    1_180,
                    40,
                    "Brake Inspection",
                ),
                (
                    "Aerial ladder annual certification",
                    "Seagrave Service",
                    3_600,
                    200,
                    "Aerial Device Test",
                ),
                (
                    "Replace front tires",
                    "Tidewater Tire",
                    1_950,
                    None,
                    "Tire Replacement",
                ),
                (
                    "Repair cab HVAC blower",
                    "Commonwealth Truck",
                    640,
                    None,
                    "General Repair",
                ),
            ]
            # Named, not indexed. The type list is department-configurable and
            # arrives alphabetically, so `types[index % len(types)]` filed an
            # oil change under "Aerial Device Test" — plausible-looking data
            # that contradicts the record it labels.
            by_name = {pick(t, "name"): pick(t, "id") for t in types}

            def type_id(*preferred: str) -> str | None:
                for name in (*preferred, "General Repair", "Repair"):
                    if by_name.get(name):
                        return by_name[name]
                return pick(types[0], "id") if types else None

            for index, (description, vendor, cost, days_ago, kind) in enumerate(work):
                unit = apparatus[index % len(apparatus)]
                payload = {
                    "apparatus_id": pick(unit, "id"),
                    "maintenance_type_id": type_id(kind),
                    "description": description,
                    "vendor": vendor,
                    "cost": cost,
                    "mileage_at_service": 18_000 + index * 900,
                }
                if days_ago is None:
                    # Leave a couple open so the tab shows scheduled work
                    # alongside the completed history.
                    payload["is_completed"] = False
                    payload["scheduled_date"] = str(TODAY + timedelta(days=10 + index))
                    payload["due_date"] = str(TODAY + timedelta(days=30))
                else:
                    payload["is_completed"] = True
                    payload["completed_date"] = str(TODAY - timedelta(days=days_ago))
                    payload["work_performed"] = description
                    payload["next_due_date"] = str(
                        TODAY + timedelta(days=365 - days_ago)
                    )
                maintenance.append(self.api.post("/apparatus/maintenance", payload))
        else:
            self._repair_maintenance_types(
                "/apparatus/maintenance",
                maintenance,
                types,
                {
                    "Annual pump service and flow test": "Annual Pump Test",
                    "Oil and filter change": "Oil Change",
                    "Brake inspection and pad replacement": "Brake Inspection",
                    "Aerial ladder annual certification": "Aerial Device Test",
                    "Replace front tires": "Tire Replacement",
                    "Repair cab HVAC blower": "General Repair",
                },
            )

        fuel = items(self.api.get("/apparatus/fuel-logs"), "fuel_logs")
        if not fuel:
            # Several fills per unit, mileage climbing, so the tab can compute
            # and chart MPG rather than showing a single row.
            for unit_index, unit in enumerate(apparatus[:4]):
                unit_id = pick(unit, "id")
                fuel_type = pick(unit, "fuelType", "fuel_type") or "diesel"
                mileage = 17_000 + unit_index * 1_200
                for fill in range(6):
                    mileage += 320 + fill * 25
                    gallons = 28 + fill
                    price = 3.85 + fill * 0.04
                    fuel.append(
                        self.api.post(
                            "/apparatus/fuel-logs",
                            {
                                "apparatus_id": unit_id,
                                "fuel_date": str(
                                    TODAY - timedelta(days=(6 - fill) * 14)
                                ),
                                "fuel_type": fuel_type,
                                "gallons": gallons,
                                "price_per_gallon": round(price, 2),
                                "total_cost": round(gallons * price, 2),
                                "mileage_at_fill": mileage,
                                "is_full_tank": True,
                                "station_name": "Oakville Municipal Fuel Depot",
                            },
                        )
                    )

        equipment = items(self.api.get("/apparatus/equipment"), "equipment")
        if not equipment:
            carried = [
                ('1 3/4" Attack Line', "Crosslay 1", 2, True),
                ('2 1/2" Supply Line', "Rear hose bed", 1, True),
                ("24' Extension Ladder", "Driver side", 1, True),
                ("Thermal Imaging Camera", "Cab console", 1, False),
                ("Hydraulic Rescue Tool", "Compartment 3", 1, True),
                ("Portable Foam Eductor", "Compartment 2", 1, False),
            ]
            for index, (name, location, quantity, required) in enumerate(carried):
                unit = apparatus[index % len(apparatus)]
                equipment.append(
                    self.api.post(
                        "/apparatus/equipment",
                        {
                            "apparatus_id": pick(unit, "id"),
                            "name": name,
                            "description": f"{name} carried on {pick(unit, 'name')}.",
                            "quantity": quantity,
                            "location_on_apparatus": location,
                            "is_mounted": required,
                            "is_required": required,
                            "is_present": True,
                        },
                    )
                )
        return {"maintenance": maintenance, "fuel": fuel, "equipment": equipment}

    # -- events ------------------------------------------------------

    def seed_events(self) -> list[dict]:
        existing = items(self.api.get("/events?limit=100"), "events")
        titles = {e.get("title") for e in existing}
        planned = [
            # Negative offsets are deliberate: attendance reports, the check-in
            # monitor and the analytics charts all read events that have already
            # happened, and a calendar of nothing but future dates leaves them
            # empty. The in-progress drill is what the check-in monitor pictures.
            ("Winter Drill Series", "training", -21, 3),
            ("Quarterly Business Meeting", "business_meeting", -14, 2),
            ("Hose Testing Day", "training", -7, 4),
            (IN_PROGRESS_EVENT_TITLE, "training", 0, 4),
            ("Monthly Business Meeting", "business_meeting", 3, 2),
            ("Q3 Ladder Operations Drill", "training", 6, 3),
            ("Pump Operations Refresher", "training", 10, 2),
            ("Live Fire Evolutions", "training", 17, 4),
            ("Station 2 Open House", "public_education", 24, 5),
            ("Officer Development Session", "training", 31, 2),
            ("Annual Awards Banquet", "social", 45, 4),
        ]
        created = list(existing)
        by_title = {e.get("title"): e for e in existing}

        # The in-progress drill is the one piece of demo data that goes stale on
        # its own: it is what the check-in monitor pictures, and by the next run
        # it has ended. Slide it forward instead of skipping it, so repeated
        # seeding keeps the monitor showing a live check-in window.
        drill = by_title.get(IN_PROGRESS_EVENT_TITLE)
        if drill and pick(drill, "id"):
            ends = str(pick(drill, "end_datetime", "endDatetime") or "")
            if ends and ends < iso(NOW):
                start = (NOW - timedelta(hours=2)).replace(
                    minute=0, second=0, microsecond=0
                )
                self.api.patch(
                    f"/events/{pick(drill, 'id')}",
                    {
                        "start_datetime": iso(start),
                        "end_datetime": iso(start + timedelta(hours=4)),
                    },
                )

        for title, event_type, days_out, hours in planned:
            if title in titles:
                continue
            if days_out == 0:
                start = (NOW - timedelta(hours=2)).replace(
                    minute=0, second=0, microsecond=0
                )
            else:
                start = (NOW + timedelta(days=days_out)).replace(
                    hour=19, minute=0, second=0, microsecond=0
                )
            created.append(
                self.api.post(
                    "/events",
                    {
                        "title": title,
                        "description": f"{title} for all Oakville Fire Department personnel.",
                        "event_type": event_type,
                        "location": "Station 1 - Headquarters",
                        "start_datetime": iso(start),
                        "end_datetime": iso(start + timedelta(hours=hours)),
                        "requires_rsvp": True,
                        "rsvp_deadline": iso(
                            start - timedelta(days=1)
                            if days_out > 0
                            else start - timedelta(hours=1)
                        ),
                        "is_mandatory": event_type == "business_meeting",
                        "send_reminders": True,
                        "is_draft": False,
                    },
                )
            )

        created.extend(self._seed_recurring_series(titles))
        return created

    RECURRING_SERIES_TITLE = "Monthly Officers Meeting"

    def _seed_recurring_series(self, titles: set) -> list[dict]:
        """One genuine recurring series.

        Every event the seeder made was a one-off, so `is_recurring` was False
        across the whole calendar. That leaves the guide's recurrence sections
        unillustratable — the delete dialog's single-versus-series choice, the
        More menu's "Cancel Entire Series", the series badge on a card — and,
        worse, means nothing exercised the recurrence expansion at all.

        Monthly by weekday rather than a fixed date, because that is the
        pattern a department actually uses for a standing meeting and the one
        with the most arithmetic behind it.
        """
        if self.RECURRING_SERIES_TITLE in titles:
            return []
        start = datetime.combine(
            TODAY - timedelta(days=TODAY.day - 1), time(19, 0)
        ).replace(tzinfo=timezone.utc)
        try:
            return items(
                self.api.post(
                    "/events/recurring",
                    {
                        "title": self.RECURRING_SERIES_TITLE,
                        "description": (
                            "Standing officers meeting — second Tuesday of "
                            "each month, Station 1 conference room."
                        ),
                        "event_type": "business_meeting",
                        "location": "Station 1 - Headquarters",
                        "start_datetime": iso(start),
                        "end_datetime": iso(start + timedelta(hours=2)),
                        "recurrence_pattern": "monthly_weekday",
                        "recurrence_weekday": 1,
                        "recurrence_week_ordinal": 2,
                        "recurrence_end_date": iso(start + timedelta(days=365)),
                        "is_mandatory": True,
                        "send_reminders": True,
                    },
                ),
                "events",
            )
        except ApiError as exc:
            self.blocked.append(f"recurring series: {exc}")
            return []

    GUEST_EVENT_TITLE = "Volunteer Interest Night"

    def seed_guest_check_in_event(self, locations: list[dict]) -> dict | None:
        """An open house with guest check-in on, live right now.

        The room display lists only events inside their check-in window, so
        this one is slid forward on every run the way the in-progress drill is
        — an open house that ended yesterday shows the kiosk an empty screen
        and the guest sign-in page a 404.

        It is pinned to a location by `location_id`, not by the free-text
        `location` field the other events use: the display is reached by the
        *location's* code, and an event carrying only a location name is not
        attached to any location the kiosk can be opened from.
        """
        # The training centre by preference. One of the seeded locations carries
        # the department's own name, and a kiosk headed "Oakville Fire
        # Department — Oakville Fire Department" reads as a bug rather than as a
        # room.
        with_codes = [
            loc
            for loc in locations
            if pick(loc, "display_code", "displayCode") and pick(loc, "id")
        ]
        room = next(
            (loc for loc in with_codes if "Training" in str(pick(loc, "name"))),
            with_codes[0] if with_codes else None,
        )
        if not room:
            self.blocked.append("guest check-in: no location has a display code")
            return None

        start = (NOW - timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
        window = {
            "start_datetime": iso(start),
            "end_datetime": iso(start + timedelta(hours=4)),
        }
        guest_settings = {
            "allow_guest_check_in": True,
            "guest_check_in_creates_prospect": True,
            # `location_id` only, deliberately no free-text `location`. The
            # kiosk and the guest sign-in page both read the linked location's
            # own name, so the string adds nothing — and the event form opens in
            # "Other (off-site)" mode whenever it finds one, which clears the
            # link on the next save. Picking a location in the app sets the id
            # and leaves the string empty; the seeder matches that.
            "location_id": pick(room, "id"),
            "location": None,
        }

        existing = next(
            (
                e
                for e in items(self.api.get("/events?limit=100"), "events")
                if e.get("title") == self.GUEST_EVENT_TITLE
            ),
            None,
        )
        if existing and pick(existing, "id"):
            ends = str(pick(existing, "end_datetime", "endDatetime") or "")
            updates = dict(guest_settings)
            if ends and ends < iso(NOW):
                updates.update(window)
            self.api.patch(f"/events/{pick(existing, 'id')}", updates)
            self._sign_a_guest_in(
                pick(existing, "id"), pick(room, "display_code", "displayCode")
            )
            return existing

        created = self.api.post(
            "/events",
            {
                "title": self.GUEST_EVENT_TITLE,
                "description": (
                    "An open evening for anyone thinking about joining. Tour the "
                    "station, meet the crew, and ask whatever you like — no "
                    "commitment, and no application to fill in on the night."
                ),
                "event_type": "public_education",
                "requires_rsvp": False,
                "is_mandatory": False,
                "send_reminders": False,
                "is_draft": False,
                **window,
                **guest_settings,
            },
        )
        self._sign_a_guest_in(
            pick(created, "id"), pick(room, "display_code", "displayCode")
        )
        return created

    def _sign_a_guest_in(self, event_id: str, display_code: str) -> None:
        """Put one visitor through the public sign-in, as a visitor would.

        Signed in through `/api/public/v1/...` with no session rather than
        written through the admin external-attendee endpoint, because the
        prospect record and its "Attended: <event>" referral source are made by
        the guest path and by nothing else — an attendee added by an officer
        gets no pipeline card, so the screenshot of one would be staged.
        """
        if not (event_id and display_code):
            return
        attendees = items(
            self.api.get(f"/events/{event_id}/external-attendees"), "attendees"
        )
        if any(pick(a, "email") == GUEST_EMAIL for a in attendees):
            return
        try:
            self.api.post_public(
                f"/display/{display_code}/events/{event_id}/guest-check-in",
                {
                    "first_name": "Rosa",
                    "last_name": "Delgado",
                    "email": GUEST_EMAIL,
                    "phone": "(703) 555-0184",
                    "interest_reason": (
                        "My neighbour is on the department and said to come "
                        "and have a look. I work days but I'm free evenings."
                    ),
                },
            )
        except ApiError as exc:
            self.blocked.append(f"guest sign-in: {exc}")

    # -- scheduling --------------------------------------------------

    SHIFT_TEMPLATES = [
        ("Day Shift", "07:00", "19:00", 12, "#F59E0B", 3),
        ("Night Shift", "19:00", "07:00", 12, "#4338CA", 3),
        ("Weekend Duty Crew", "08:00", "20:00", 12, "#059669", 4),
        ("Medic Duty", "06:00", "18:00", 12, "#2563EB", 2),
    ]

    def seed_platoons(self, members: list[dict]) -> None:
        """Turn platoon scheduling on and deal the roster into A/B/C.

        Left off, two guides picture something that isn't there: Platoon
        Management renders a "platoon scheduling is turned off" banner over a
        single Unassigned column, and Scheduling Settings shows six sections
        instead of seven, because the Platoons section is hidden while the
        feature is off. Both are captioned as showing the opposite.

        The department the demo data describes runs an A/B/C rotation — it
        seeds the "A/B/C Platoon Rotation" shift pattern already — so the
        toggle being off was an omission rather than a choice.
        """
        settings = self.api.get("/scheduling/settings") or {}
        if not settings.get("platoons_enabled"):
            self.api.put(
                "/scheduling/settings",
                {"platoons_enabled": True},
            )

        # PlatoonOverviewResponse keys the roster as `groups`, each carrying
        # `platoon` and `member_count`. Reading a `platoons` key instead makes
        # this guard silently vacuous — it always sees zero and re-deals the
        # whole roster on every run, which is the opposite of idempotent.
        overview = self.api.get("/scheduling/platoons/overview") or {}
        already = sum(
            group.get("member_count") or 0
            for group in (overview.get("groups") or [])
            if (group.get("platoon") or "").strip()
        )
        if already:
            return

        # Deal round-robin so every platoon has a mix of ranks rather than one
        # column of officers and two of firefighters.
        assignable = [pick(m, "id") for m in members if pick(m, "id")]
        for index, platoon in enumerate(("A", "B", "C")):
            batch = assignable[index::3]
            if batch:
                self.api.post(
                    "/scheduling/platoons/bulk-assign",
                    {"user_ids": batch, "platoon": platoon},
                )

    def seed_scheduling(
        self, stations: list[dict], apparatus: list[dict], members: list[dict]
    ) -> dict[str, list[dict]]:
        templates = items(self.api.get("/scheduling/templates"), "templates")
        names = {t.get("name") for t in templates}
        for index, (name, start, end, hours, color, staffing) in enumerate(
            self.SHIFT_TEMPLATES
        ):
            if name in names:
                continue
            payload = {
                "name": name,
                "description": f"{name} — {start} to {end}.",
                "start_time_of_day": start,
                "end_time_of_day": end,
                "duration_hours": hours,
                "color": color,
                "min_staffing": staffing,
                "is_default": index == 0,
                "open_to_all_members": True,
            }
            if apparatus:
                payload["apparatus_id"] = pick(apparatus[index % len(apparatus)], "id")
            templates.append(self.api.post("/scheduling/templates", payload))

        patterns = items(self.api.get("/scheduling/patterns"), "patterns")
        pattern_names = {p.get("name") for p in patterns}
        for name, pattern_type, days_on, days_off in [
            ("A/B/C Platoon Rotation", "platoon", 1, 2),
            ("Weekend Duty Rotation", "weekly", 2, 5),
        ]:
            if name in pattern_names:
                continue
            payload = {
                "name": name,
                "description": f"{name} covering all front-line apparatus.",
                "pattern_type": pattern_type,
                "days_on": days_on,
                "days_off": days_off,
                "rotation_days": days_on + days_off,
                "start_date": str(TODAY - timedelta(days=TODAY.weekday())),
                "end_date": str(TODAY + timedelta(days=180)),
            }
            if templates:
                payload["template_id"] = pick(templates[0], "id")
            patterns.append(self.api.post("/scheduling/patterns", payload))

        # Ask the same endpoint the shift form asks. /apparatus-options resolves
        # the department's fleet with a documented priority — full Apparatus
        # module records first, the lightweight basic_apparatus table second,
        # hardcoded type defaults last — so seeding through it produces the ids a
        # real user's shift would carry.
        #
        # This used to mirror the fleet into basic_apparatus instead, because
        # passing a full-Apparatus id to create_shift failed the in-org check
        # with "Apparatus not found". That was the SCH-6 half of the polymorphic
        # apparatus-reference bug, fixed 2026-08-08 (see
        # app/utils/apparatus_ref.py). The mirror is no longer needed and was
        # actively harmful: it created a second copy of every front-line rig, so
        # the demo department had E-1 twice under different ids, and equipment
        # checks recorded against the basic copy left the apparatus-compliance
        # dashboard reading "Never checked" for every unit.
        options = items(
            self.api.get("/scheduling/apparatus-options"), "options", "apparatus"
        )
        # In blueprint order, not endpoint order. The endpoint lists the fleet
        # alphabetically, which puts Brush 5 ahead of the engines and ladder —
        # and everything below stripes shifts onto fleet[:3], so a fresh
        # database quietly rostered the brush truck instead of Ladder 4. The
        # long-lived demo database never showed this because its front-line
        # rigs were created before B-5 existed in the blueprint and the
        # endpoint happened to return them first. The batch shift-report
        # fixture (and its screenshots) depend on Ladder 4 carrying shifts.
        unit_order = {unit: index for index, (unit, *_rest) in enumerate(APPARATUS)}
        fleet = sorted(
            (o for o in options if pick(o, "id")),
            key=lambda o: unit_order.get(
                pick(o, "unit_number", "unitNumber"), len(unit_order)
            ),
        )
        if not fleet:
            # Only reachable when the department has neither inventory — the
            # endpoint then serves hardcoded type defaults, which carry no id
            # and cannot be assigned to a shift.
            self.blocked.append(
                "scheduling: /scheduling/apparatus-options returned no "
                "identifiable apparatus, so shifts were seeded without one"
            )

        shifts = items(self.api.get("/scheduling/shifts?limit=200"), "shifts")
        # Shifts are keyed by (date, apparatus) so a re-run recognises its own
        # rows; the API has no natural unique name to match on.
        existing_by_key = {
            (s.get("shift_date"), s.get("apparatus_id") or s.get("apparatusId")): s
            for s in shifts
        }
        existing_keys = set(existing_by_key)
        station_id = pick(stations[0], "id") if stations else None
        member_ids = [pick(m, "id") for m in members if pick(m, "id")]
        admin_id = next(
            (
                pick(m, "id")
                for m in members
                if pick(m, "username") == DEMO_ADMIN_USERNAME
            ),
            None,
        )
        # Which of today's shifts to put the administrator on. The demo's only
        # equipment-check template targets the "engine" apparatus type, and a
        # checklist resolves by type — so crewing them onto the brush truck
        # produces a shift with no checklist, which is exactly the empty screen
        # this is meant to avoid. Prefer an engine; fall back to the first unit
        # so a fleet without one still gets an assignment.
        admin_slot = next(
            (
                i
                for i, unit in enumerate(fleet[:3])
                if (pick(unit, "apparatus_type", "apparatusType") or "").lower()
                == "engine"
            ),
            0,
        )

        # Two weeks either side of today: the calendar, "my shifts", and the
        # open-shifts list each need past and future rows to look real.
        for offset in range(-10, 12):
            shift_date = str(TODAY + timedelta(days=offset))
            # The API rejects a member assigned to two overlapping shifts, so
            # crews are drawn from a single per-day pool that each apparatus
            # consumes from in turn.
            #
            # The rotation strides by a whole day's worth of people rather than
            # by one. The night shift runs 19:00-07:00, so its crew is still on
            # duty into the following date; advancing the pool by a single
            # member left consecutive days overlapping almost entirely and the
            # API rejected the second day's assignments as conflicts.
            per_day = sum(staffing for *_, staffing in self.SHIFT_TEMPLATES[:3])
            rotation = (offset * per_day) % max(1, len(member_ids))
            day_pool = member_ids[rotation:] + member_ids[:rotation]
            pool_cursor = 0
            for index, unit in enumerate(fleet[:3]):
                apparatus_id = pick(unit, "id")
                name, start, end, hours, color, staffing = self.SHIFT_TEMPLATES[
                    index % len(self.SHIFT_TEMPLATES)
                ]
                if (shift_date, apparatus_id) in existing_keys:
                    # A shift that should read fully staffed may predate that
                    # rule — top it up rather than leaving the calendar in the
                    # uniform amber a short-staffed run produces.
                    if index == 0 and offset % 2 == 0:
                        pool_cursor += self._top_up_crew(
                            existing_by_key[(shift_date, apparatus_id)],
                            staffing,
                            day_pool[pool_cursor:],
                        )
                    continue
                # shift_date is a date, but start_time/end_time are full
                # timestamps — a bare "07:00" is rejected. A shift whose end
                # time is earlier than its start crosses midnight, so its end
                # lands on the following day.
                #
                # The clock times above are *local* to the department, and the
                # UI renders in the organization's timezone. Building them as
                # UTC put a "07:00" day shift on screen as 3:00 AM, which reads
                # as nonsense on a fire department roster.
                start_at = datetime.combine(
                    TODAY + timedelta(days=offset),
                    time.fromisoformat(start),
                    tzinfo=ORG_TIMEZONE,
                ).astimezone(timezone.utc)
                end_at = datetime.combine(
                    TODAY + timedelta(days=offset + (1 if end <= start else 0)),
                    time.fromisoformat(end),
                    tzinfo=ORG_TIMEZONE,
                ).astimezone(timezone.utc)
                payload = {
                    "shift_date": shift_date,
                    "start_time": iso(start_at),
                    "end_time": iso(end_at),
                    "apparatus_id": apparatus_id,
                    "color": color,
                    "min_staffing": staffing,
                    # Riding positions, one slot per crew member. Without these
                    # the shift panel's crew board never renders: it is gated on
                    # apparatus_positions, which falls back to the shift's own
                    # positions because the full Apparatus module deliberately
                    # does not model riding assignments. Every seeded shift had
                    # NULL positions, so the open-slot rows, the per-slot Assign
                    # and the bulk "Fill All Open" action were unreachable.
                    "positions": SHIFT_POSITIONS[:staffing],
                    "notes": f"{name} on {pick(unit, 'unit_number', 'unitNumber')}.",
                }
                if station_id:
                    payload["station_id"] = station_id
                # The officer is drawn from the same per-day pool as the crew.
                # Setting shift_officer_id mints an assignment of its own, so an
                # officer picked independently could already be crewing another
                # apparatus that day and the API rejects the double-booking.
                officer_seated = pool_cursor < len(day_pool)
                if officer_seated:
                    payload["shift_officer_id"] = day_pool[pool_cursor]
                    pool_cursor += 1
                shift = self.api.post("/scheduling/shifts", payload)
                shifts.append(shift)

                # Most shifts are staffed one short so the Open Shifts tab has
                # vacancies to show. Every other day the first apparatus is
                # crewed to its minimum instead: the calendar tints a shift by
                # how well it is staffed, and a schedule that is uniformly short
                # renders as a wall of amber with no green to compare it to.
                #
                # The officer takes one of those seats — count them, or every
                # shift comes out one body over its own position list and the
                # readiness tile reads "4 assigned / 3 positions".
                full = index == 0 and offset % 2 == 0
                shift_id = pick(shift, "id")
                # The seats this rig actually has, minus the one the shift
                # officer already holds. Crewing everybody as "firefighter"
                # left the Driver/Operator seat open on every board in the
                # department while the surplus firefighters piled up under
                # "Additional Crew" — a rig that is fully crewed on paper and
                # short a driver on screen.
                seats = SHIFT_POSITIONS[:staffing]
                if officer_seated and "officer" in seats:
                    seats = [seat for seat in seats if seat != "officer"]
                if (offset, index) == PART_STAFFED_SHIFT and officer_seated:
                    # The one board with several rows open — see
                    # PART_STAFFED_SHIFT. Only meaningful with an officer
                    # already seated: with nobody aboard at all the board is an
                    # empty state, not a part-staffed shift.
                    seats = []
                elif not full:
                    seats = seats[:-1]
                crew = day_pool[pool_cursor : pool_cursor + len(seats)]
                pool_cursor += len(crew)
                for slot, user_id in enumerate(crew):
                    try:
                        self.api.post(
                            f"/scheduling/shifts/{shift_id}/assignments",
                            {"user_id": user_id, "position": seats[slot]},
                        )
                    except ApiError as exc:
                        # A double-booking or an EVOC refusal is the app's own
                        # rule, not a seeder fault: the shift is simply short a
                        # member, which the Open Shifts tab is meant to show
                        # anyway. See is_expected_seat_refusal.
                        if not is_expected_seat_refusal(exc):
                            raise

                # Put the demo administrator on today's first shift. Several
                # member-facing screens — "My Shifts" and, in particular, "My
                # Equipment Checklists" — are scoped to the signed-in user's own
                # assignments, and the screenshot pipeline signs in as the
                # administrator. Without this they capture an empty state that
                # reads as though the feature does nothing.
                if offset == 0 and index == admin_slot and admin_id:
                    try:
                        self.api.post(
                            f"/scheduling/shifts/{shift_id}/assignments",
                            {"user_id": admin_id, "position": "officer"},
                        )
                    except ApiError as exc:
                        # Already assigned on a re-run, or the API declined the
                        # slot — neither is worth failing the whole seed over.
                        if exc.code not in (400, 409):
                            raise
        self._seat_shift_officers(shifts)
        self._align_crew_to_seats(shifts)
        self._thin_part_staffed_shift(fleet[:3])
        self._seed_shift_attendance(shifts)
        return {
            "templates": templates,
            "patterns": patterns,
            "apparatus": fleet,
            "shifts": shifts,
        }

    def _thin_part_staffed_shift(self, fleet: list[dict]) -> None:
        """Empty every seat but the officer's on the one part-staffed shift.

        The create path above declines to crew this shift in the first place,
        but a shift that already exists is skipped entirely on a re-run — so on
        every database except a brand new one the board would stay one row short
        and the guide's crew-board screenshot would have nothing to picture. The
        repair is here, against the API, for the same reason
        ``_align_crew_to_seats`` is: an existing demo database should be brought
        into line rather than needing a wipe.

        The shift officer keeps their seat. A board with nobody on it is an
        empty state, not the part-staffed one this is for.
        """
        offset, index = PART_STAFFED_SHIFT
        if index >= len(fleet):
            return
        apparatus_id = pick(fleet[index], "id")
        day = str(TODAY + timedelta(days=offset))
        target = next(
            (
                shift
                for shift in items(
                    self.api.get("/scheduling/shifts?limit=200"), "shifts"
                )
                if str(pick(shift, "shift_date", "shiftDate") or "") == day
                and pick(shift, "apparatus_id", "apparatusId") == apparatus_id
            ),
            None,
        )
        if not target:
            return
        shift_id = pick(target, "id")
        officer_id = pick(target, "shift_officer_id", "shiftOfficerId")
        if not officer_id:
            return
        for row in items(
            self.api.get(f"/scheduling/shifts/{shift_id}/assignments"), "assignments"
        ):
            if pick(row, "user_id", "userId") == officer_id:
                continue
            self.api.delete(f"/scheduling/assignments/{pick(row, 'id')}")

    def _seat_shift_officers(self, shifts: list[dict]) -> None:
        """Put each shift's designated officer onto its crew board.

        Seating happens in the application, on the transition from one officer
        to another — so shifts created before that path learned to fall back to
        the shift's own riding positions still name a Shift Officer who holds no
        seat and appears on no roster. Re-setting the officer (clear, then set)
        replays the transition and lets the fixed code do the seating, rather
        than the seeder minting an assignment the product would not have.

        Keyed on the officer being absent from the roster, so a database whose
        boards are already correct is left alone.
        """
        for shift in shifts:
            shift_id = pick(shift, "id")
            officer_id = pick(shift, "shift_officer_id", "shiftOfficerId")
            if not shift_id or not officer_id:
                continue
            crew = items(
                self.api.get(f"/scheduling/shifts/{shift_id}/assignments"),
                "assignments",
            )
            if any(pick(row, "user_id", "userId") == officer_id for row in crew):
                continue
            try:
                self.api.patch(
                    f"/scheduling/shifts/{shift_id}", {"shift_officer_id": None}
                )
                self.api.patch(
                    f"/scheduling/shifts/{shift_id}", {"shift_officer_id": officer_id}
                )
            except ApiError as exc:
                # A double-booking refusal means the officer is already crewing
                # another rig that day; the board is then correct to leave the
                # seat open, and the header names who is in charge regardless.
                if exc.code not in (400, 409):
                    raise
                self.blocked.append(f"shift officer seat: {exc}")

    def _align_crew_to_seats(self, shifts: list[dict]) -> None:
        """Match each shift's roster to the seats its crew board renders.

        The board seats members by position name, so a crew assigned entirely
        as "firefighter" leaves the Driver/Operator seat open on every rig in
        the department while the surplus firefighters stack up under
        "Additional Crew" — a shift that is fully crewed by headcount and short
        a driver on screen. A database seeded before the officer took a seat is
        also one body over its own seat count, which the readiness tile reports
        as "4 assigned / 3 positions".

        Both are repaired here rather than only in the create path, so an
        existing demo database is brought into line instead of needing a wipe:
        members already sitting in a seat stay put, the rest are moved into
        whatever is still open.

        Anyone still left over is dropped, but on a past shift only when they
        have no attendance record — a past roster is what actually worked the
        shift, and the hours hang off those assignments. A past assignment with
        no check-in is one this seeder invented; a real one is left alone, extra
        body and all, because rigs do run over.
        """
        for shift in shifts:
            shift_id = pick(shift, "id")
            day = str(pick(shift, "shift_date", "shiftDate") or "")
            slots = pick(shift, "positions") or []
            if not shift_id or not slots:
                continue
            is_past = day <= str(TODAY)
            seats = [str(pick(slot, "position") or "") for slot in slots]
            crew = [
                row
                for row in items(
                    self.api.get(f"/scheduling/shifts/{shift_id}/assignments"),
                    "assignments",
                )
                if pick(row, "assignment_status", "assignmentStatus")
                in ("assigned", "confirmed")
            ]

            # Everyone already in a seat keeps it; each seat is claimed once,
            # so a third firefighter on a two-firefighter rig counts as unseated
            # rather than as filling a seat somebody else holds.
            unclaimed = list(seats)
            unseated = []
            for row in crew:
                position = str(pick(row, "position") or "")
                if position in unclaimed:
                    unclaimed.remove(position)
                else:
                    unseated.append(row)
            if not unseated:
                continue

            worked = set()
            if is_past:
                worked = {
                    str(pick(row, "user_id", "userId"))
                    for row in items(
                        self.api.get(f"/scheduling/shifts/{shift_id}/attendance"),
                        "attendance",
                    )
                    if pick(row, "checked_in_at", "checkedInAt")
                }

            for row in unseated:
                if unclaimed:
                    self.api.patch(
                        f"/scheduling/assignments/{pick(row, 'id')}",
                        {"position": unclaimed.pop(0)},
                    )
                elif str(pick(row, "user_id", "userId")) not in worked:
                    self.api.delete(f"/scheduling/assignments/{pick(row, 'id')}")

    def _seed_shift_attendance(self, shifts: list[dict]) -> None:
        """Check the crew of past shifts in and out again.

        Nobody had ever worked a seeded shift, so "Hours Worked This Month" on
        the scheduling page read 0 beside a calendar of 120 shifts, and every
        attendance and completion screen was empty. The rows the seeder did
        leave behind carried NULL times and no duration, which is worse than
        none: the API computes duration from the two timestamps, so a row
        without them contributes nothing while still counting as attendance.

        Only shifts that have already ended are touched. Checking somebody out
        of a shift still in progress would be a lie, and the in-progress state
        is what several other screenshots are about.
        """
        now = datetime.now(timezone.utc)
        for shift in shifts:
            shift_id = pick(shift, "id")
            day = str(pick(shift, "shift_date", "shiftDate") or "")
            if not shift_id or not day or day >= str(TODAY):
                continue
            existing = items(
                self.api.get(f"/scheduling/shifts/{shift_id}/attendance"),
                "attendance",
            )
            # Keyed on a *usable* row, not any row: the pre-existing rows have
            # no timestamps and would otherwise mask the gap forever.
            if any(pick(row, "checked_in_at", "checkedInAt") for row in existing):
                continue
            start = pick(shift, "start_time", "startTime")
            end = pick(shift, "end_time", "endTime")
            if not start or not end:
                continue
            started = datetime.fromisoformat(str(start).replace("Z", "+00:00"))
            ended = datetime.fromisoformat(str(end).replace("Z", "+00:00"))
            if ended > now:
                continue
            crew = items(
                self.api.get(f"/scheduling/shifts/{shift_id}/assignments"),
                "assignments",
            )
            for index, assignment in enumerate(crew):
                user_id = pick(assignment, "user_id", "userId")
                if not user_id:
                    continue
                # A few minutes either side of the scheduled times, so the
                # durations are not all identical to the minute.
                checked_in = started + timedelta(minutes=index * 3)
                checked_out = ended - timedelta(minutes=(index % 3) * 5)
                try:
                    self.api.post(
                        f"/scheduling/shifts/{shift_id}/attendance",
                        {
                            "user_id": user_id,
                            "checked_in_at": iso(checked_in),
                            "checked_out_at": iso(checked_out),
                        },
                    )
                except ApiError as exc:
                    if exc.code not in (400, 409):
                        raise
                    self.blocked.append(f"shift attendance: {exc}")

    def _top_up_crew(self, shift: dict, target: int, pool: list[str]) -> int:
        """Add crew to an already-seeded shift until it meets `target`.

        Returns how many members were consumed from `pool`, so the caller can
        advance its cursor and avoid double-booking the same person elsewhere
        in the day.
        """
        shift_id = pick(shift, "id")
        if not shift_id:
            return 0
        assigned = items(
            self.api.get(f"/scheduling/shifts/{shift_id}/assignments"), "assignments"
        )
        taken = {pick(a, "user_id", "userId") for a in assigned}
        used = 0
        for user_id in pool:
            if len(assigned) + used >= target:
                break
            if user_id in taken:
                continue
            try:
                self.api.post(
                    f"/scheduling/shifts/{shift_id}/assignments",
                    {"user_id": user_id, "position": "firefighter"},
                )
            except ApiError as exc:
                # Same refusals the create path tolerates: the member is
                # already on duty, or is not cleared to drive this rig, so the
                # shift stays a seat short.
                if not is_expected_seat_refusal(exc):
                    raise
            used += 1
        return used

    # -- scheduling: logged calls ------------------------------------

    #: One line per entry: category name, hours, and what the member was doing.
    #: Spread across every seeded category so the Summary's "where the hours
    #: came from" ranking has something to rank, and sized so Administrative
    #: Work — the one category that requires approval — carries the longest
    #: sessions.
    ADMIN_HOURS_ENTRIES = [
        (
            "Community Outreach",
            3.0,
            "Open house at Station 1 — tours and car seat checks.",
        ),
        (
            "Community Outreach",
            2.5,
            "Fire prevention week visit to Oakville Elementary.",
        ),
        ("Fundraising", 4.0, "Pancake breakfast — setup, service and clean-up."),
        ("Fundraising", 2.0, "Boot drive at the Route 7 intersection."),
        (
            "Administrative Work",
            5.5,
            "Quarterly NFIRS reconciliation and report filing.",
        ),
        (
            "Administrative Work",
            3.0,
            "Grant application narrative for the SCBA replacement.",
        ),
        ("Station Maintenance", 4.0, "Bay floor resealing and apparatus bay lighting."),
        ("Station Maintenance", 2.0, "Generator load test and fuel top-off."),
        ("Meetings & Governance", 2.0, "Monthly business meeting."),
        ("Meetings & Governance", 1.5, "Officers' meeting — staffing and budget."),
        ("Volunteer Hours", 6.0, "County parade detail with Engine 1 and Ladder 4."),
        ("Volunteer Hours", 3.5, "Standby coverage for the Founders Day 5K."),
    ]

    #: How many of the generated entries stay pending. The Summary card reports
    #: approved and needs-review separately, so a fixture with none of the
    #: latter shows one of its three numbers permanently at zero.
    ADMIN_HOURS_PENDING = 3

    #: Riding order for the rescue, and the one entry that is deliberately not
    #: a configured position. Values are lowercased by the API's validator, so
    #: these are written the way they will be stored.
    RESCUE_CREW_POSITIONS = [
        "officer",
        "driver",
        "firefighter",
        "rescue specialist",
    ]

    def seed_apparatus_crew_positions(self) -> None:
        """Riding positions on the rescue, one of them a legacy free-text seat.

        Crew seats are a rank-backed picker now, and every apparatus had
        `crew_positions` null — so the form showed "No crew seats configured"
        and there was nothing to photograph on the screen the release note is
        about.

        "rescue specialist" is not one of the configured codes, which is the
        point: a department that typed seat names before the picker existed
        still has those values, and the form has to keep them readable rather
        than silently dropping them. The form marks such a seat "(legacy
        position)" and offers it as an option only for the seat that already
        holds it.
        """
        rescue = next(
            (
                a
                for a in items(self.api.get("/apparatus?limit=50"), "apparatus")
                if str(pick(a, "unit_number", "unitNumber") or "").upper() == "R-7"
            ),
            None,
        )
        if not rescue:
            self.blocked.append("apparatus crew positions: no R-7 in the fleet")
            return
        if [
            str(p).lower()
            for p in (pick(rescue, "crew_positions", "crewPositions") or [])
        ] == self.RESCUE_CREW_POSITIONS:
            return
        self.api.patch(
            f"/apparatus/{pick(rescue, 'id')}",
            {"crew_positions": self.RESCUE_CREW_POSITIONS},
        )

    def seed_admin_hours_entries(self) -> list[dict]:
        """A calendar year of logged administrative hours, mostly approved.

        Every Admin Hours screen reads the same collection, and the demo
        database had none at all: the Summary tab reported 0hrs against three
        cards and "No completed entries match this reporting period" under a
        heading promising a ranking. The categories were seeded; nothing had
        ever been logged against them.

        Entries are raised by the members themselves rather than by the
        administrator, because ``POST /admin-hours/entries`` credits the
        caller — an administrator-created set would credit one account with the
        department's whole year. They are then reviewed by the administrator,
        which is also the only way to reach an approved state: a manual entry
        always lands pending on purpose, since its times are client-supplied
        and auto-approval would let a member self-credit backdated time.
        """
        categories = {
            str(pick(c, "name")): str(pick(c, "id"))
            for c in items(self.api.get("/admin-hours/categories"), "categories")
        }
        if not categories:
            self.blocked.append("admin hours: no categories to log against")
            return []
        members = [
            m
            for m in items(self.api.get("/users?limit=200"), "users")
            if pick(m, "username") not in (DEMO_ADMIN_USERNAME, TWO_FACTOR_USERNAME)
            and pick(m, "id")
        ]
        if not members:
            self.blocked.append("admin hours: no members to log entries for")
            return []

        # Matched on the description, which is unique per line and is what the
        # entry carries back. Guarding on a total instead let a run that
        # created every entry but failed the review pass skip straight past the
        # approvals on the next run, leaving twelve pending entries and an
        # Approved card reading zero -- which is exactly what happened.
        logged = {
            str(pick(e, "description") or "")
            for e in items(self.api.get("/admin-hours/entries?limit=200"), "entries")
        }

        created: list[dict] = []
        for index, (name, hours, description) in enumerate(self.ADMIN_HOURS_ENTRIES):
            category_id = categories.get(name)
            if not category_id or description in logged:
                continue
            member = members[index % len(members)]
            session = self.member_session(
                self.base_url, str(pick(member, "id")), str(pick(member, "username"))
            )
            # Walked backwards through the year in three-week steps, all inside
            # the current calendar year so the Summary's "This calendar year"
            # preset — the one the guide's marker names — has every entry in
            # range. Started mid-morning, which keeps a 6-hour session inside
            # the same day in the organization's timezone.
            day = TODAY - timedelta(days=21 * index + 4)
            if day.year != TODAY.year:
                day = date(TODAY.year, 1, 1) + timedelta(days=index)
            start = datetime.combine(day, time(hour=9), tzinfo=ORG_TIMEZONE)
            finish = start + timedelta(hours=hours)
            try:
                entry = session.post(
                    "/admin-hours/entries",
                    {
                        "category_id": category_id,
                        "clock_in_at": iso(start.astimezone(timezone.utc)),
                        "clock_out_at": iso(finish.astimezone(timezone.utc)),
                        "description": description,
                    },
                )
            except ApiError as exc:
                self.blocked.append(f"admin hours: entry refused ({exc})")
                continue
            created.append(entry)

        # Read back rather than reusing `created`, so the approvals happen on a
        # re-run against entries an earlier run left pending. Newest first, so
        # the few that stay pending are the recent ones -- which is what a real
        # review queue looks like.
        pending = sorted(
            (
                e
                for e in items(
                    self.api.get("/admin-hours/entries?limit=200"), "entries"
                )
                if str(pick(e, "status")) == "pending"
            ),
            key=lambda e: str(pick(e, "clock_in_at", "clockInAt") or ""),
            reverse=True,
        )
        for entry in pending[self.ADMIN_HOURS_PENDING :]:
            entry_id = pick(entry, "id")
            if not entry_id:
                continue
            try:
                self.api.post(
                    f"/admin-hours/entries/{entry_id}/review",
                    # `action`, not `status`: the review schema takes a verb
                    # ("approve"/"reject"), unlike the scheduling reviews next
                    # to it in this file, which take the resulting state.
                    {"action": "approve"},
                )
            except ApiError as exc:
                self.blocked.append(f"admin hours: review refused ({exc})")
                break
        return created

    def seed_shift_calls(self) -> list[dict]:
        """Runs logged against past shifts.

        The Calls / Runs panel on a shift reads as "No calls logged for this
        shift" without these, and the shift-report hour totals are computed from
        them, so several downstream figures stay at zero too.
        """
        shifts = items(self.api.get("/scheduling/shifts?limit=100"), "shifts")
        past = [
            s
            for s in shifts
            if pick(s, "id")
            and str(pick(s, "shift_date", "shiftDate") or "") < str(TODAY)
        ]
        if not past:
            return []

        existing = items(
            self.api.get(f"/scheduling/shifts/{pick(past[0], 'id')}/calls"), "calls"
        )
        if existing:
            return existing

        runs = [
            ("Structure Fire", "Working fire, second alarm struck.", 3),
            ("EMS — Chest Pain", "ALS transport to Oakville General.", 1),
            ("Motor Vehicle Collision", "Two vehicles, one extrication.", 2),
            ("Automatic Fire Alarm", "Burnt food, no incident.", 1),
            ("Odor Investigation", "Natural gas odor, utility notified.", 1),
        ]
        created = []
        for index, shift in enumerate(past[:5]):
            incident_type, notes, hours = runs[index % len(runs)]
            dispatched = datetime.combine(
                date.fromisoformat(str(pick(shift, "shift_date", "shiftDate"))),
                time(hour=9 + index),
                tzinfo=ORG_TIMEZONE,
            ).astimezone(timezone.utc)
            created.append(
                self.api.post(
                    f"/scheduling/shifts/{pick(shift, 'id')}/calls",
                    {
                        "incident_number": f"2026-{1200 + index:04d}",
                        "incident_type": incident_type,
                        "dispatched_at": iso(dispatched),
                        "on_scene_at": iso(dispatched + timedelta(minutes=6)),
                        "cleared_at": iso(dispatched + timedelta(hours=hours)),
                        "notes": notes,
                    },
                )
            )
        return created

    # -- training ----------------------------------------------------

    def seed_training(self) -> dict[str, list[dict]]:
        categories = items(self.api.get("/training/categories"), "categories")
        existing = {c.get("name") for c in categories}
        for name, code, color in [
            ("Fire Suppression", "FIRE", "#DC2626"),
            ("Emergency Medical", "EMS", "#2563EB"),
            ("Technical Rescue", "RESCUE", "#EA580C"),
            ("Hazardous Materials", "HAZMAT", "#CA8A04"),
            ("Officer Development", "OFFICER", "#7C3AED"),
            # Its own category rather than a fold into Fire Suppression: the
            # ISO/FSRS assessment scores driver/operator hours against NFPA
            # 1002 separately, and a department that files pump training as
            # fire training reads as having done none of it.
            ("Driver/Operator", "DRIVER", "#0891B2"),
        ]:
            if name in existing:
                continue
            categories.append(
                self.api.post(
                    "/training/categories",
                    {
                        "name": name,
                        "code": code,
                        "color": color,
                        "description": f"{name} training and continuing education.",
                    },
                )
            )
        category_ids = {c.get("name"): pick(c, "id") for c in categories}

        courses = items(self.api.get("/training/courses"), "courses")
        course_names = {c.get("name") for c in courses}
        for name, code, training_type, hours, category, expires in [
            ("Firefighter I", "FF1", "certification", 160, "Fire Suppression", 60),
            ("Firefighter II", "FF2", "certification", 80, "Fire Suppression", 60),
            ("Pump Operations", "PUMP", "skills_practice", 24, "Driver/Operator", 24),
            (
                "Aerial Operations",
                "AERIAL",
                "skills_practice",
                24,
                "Fire Suppression",
                24,
            ),
            ("EMT-Basic Refresher", "EMTR", "refresher", 24, "Emergency Medical", 24),
            ("CPR / BLS Provider", "BLS", "certification", 4, "Emergency Medical", 24),
            ("Vehicle Extrication", "EXTRIC", "specialty", 16, "Technical Rescue", 36),
            ("Hazmat Awareness", "HMAW", "certification", 8, "Hazardous Materials", 36),
            (
                "Company Officer I",
                "CO1",
                "certification",
                40,
                "Officer Development",
                None,
            ),
            ("New Member Orientation", "ORIENT", "orientation", 8, None, None),
        ]:
            if name in course_names:
                continue
            payload = {
                "name": name,
                "code": code,
                "training_type": training_type,
                "duration_hours": hours,
                "credit_hours": hours,
                "description": f"{name} — department-delivered course.",
                "instructor": "Capt. Owen Kittredge",
                "max_participants": 20,
            }
            if expires:
                payload["expiration_months"] = expires
            if category and category_ids.get(category):
                payload["category_ids"] = [category_ids[category]]
            courses.append(self.api.post("/training/courses", payload))

        requirements = items(self.api.get("/training/requirements"), "requirements")
        requirement_names = {r.get("name") for r in requirements}
        for name, req_type, frequency, extra in [
            (
                "Annual Minimum Training Hours",
                "hours",
                "annual",
                {"required_hours": 24},
            ),
            (
                "Quarterly Live Fire Drill",
                "shifts",
                "quarterly",
                {"required_shifts": 1},
            ),
            ("CPR Certification Current", "certification", "biannual", {}),
            ("Monthly Company Drill", "hours", "monthly", {"required_hours": 2}),
        ]:
            if name in requirement_names:
                continue
            requirements.append(
                self.api.post(
                    "/training/requirements",
                    {
                        "name": name,
                        "description": f"{name} for all operational personnel.",
                        "requirement_type": req_type,
                        "frequency": frequency,
                        "applies_to_all": True,
                        "source": "department",
                        **extra,
                    },
                )
            )
        return {
            "categories": categories,
            "courses": courses,
            "requirements": requirements,
        }

    RECRUIT_COURSE_NAME = "Recruit School"
    RECRUIT_COHORT_NAME = "Recruit School — Fall Class"

    # (catalog course name, section, day offset, start time, minutes)
    RECRUIT_SYLLABUS = [
        ("Firefighter I", "Orientation & Safety", 0, "18:30", 180),
        ("SCBA Confidence Course", "Orientation & Safety", 1, "18:30", 180),
        ("Hazmat Awareness", "Fireground Skills", 3, "18:30", 240),
        ("Aerial Operations", "Fireground Skills", 7, "09:00", 480),
        ("CPR / BLS Provider", "Medical", 10, "18:30", 240),
        ("EMT-Basic Refresher", "Medical", 14, "18:30", 180),
    ]

    def seed_course_cohort(self, members: list[dict]) -> dict:
        """A recruit school: a multi-class course and one dated cohort of it.

        Nothing in the demo had ever exercised this. The cohorts list was
        empty, so the syllabus builder, the cohort wizard's preview step and
        the cohort detail page's class timeline could none of them be opened
        against real data — and a feature with no rows is a feature nobody has
        run end to end.
        """
        courses = items(self.api.get("/training/courses?limit=100"), "courses")
        by_name = {c.get("name"): pick(c, "id") for c in courses}

        parent_id = by_name.get(self.RECRUIT_COURSE_NAME)
        if not parent_id:
            parent = self.api.post(
                "/training/courses",
                {
                    "name": self.RECRUIT_COURSE_NAME,
                    "code": "RS-100",
                    "training_type": "certification",
                    "credit_hours": 40,
                    "description": (
                        "Six-class entry course for probationary members, run "
                        "twice a year."
                    ),
                },
            )
            parent_id = pick(parent, "id")

        # Keyed on the classes already on the syllabus rather than "does the
        # course exist", so a partial run fills in the rest.
        existing = items(
            self.api.get(f"/training/courses/{parent_id}/classes"), "classes"
        )
        placed = {
            (pick(row, "day_offset", "dayOffset"), pick(row, "title"))
            for row in existing
        }
        for course_name, section, day, start, minutes in self.RECRUIT_SYLLABUS:
            class_course_id = by_name.get(course_name)
            if not class_course_id or (day, course_name) in placed:
                continue
            try:
                existing.append(
                    self.api.post(
                        f"/training/courses/{parent_id}/classes",
                        {
                            "class_course_id": class_course_id,
                            "section_name": section,
                            "title": course_name,
                            "day_offset": day,
                            "start_time": start,
                            "duration_minutes": minutes,
                            # Explicit, not inherited: a class row left blank
                            # takes the catalog course's hours, so a 3-hour
                            # evening session on the Firefighter I course
                            # showed "160 credits" and the syllabus totalled
                            # 220 hours over 15 days.
                            "credit_hours": round(minutes / 60, 1),
                            "location": "Training & Administration Center",
                        },
                    )
                )
            except ApiError as exc:
                self.blocked.append(f"syllabus class {course_name}: {exc}")

        cohorts = items(self.api.get("/training/cohorts"), "cohorts")
        if any(c.get("name") == self.RECRUIT_COHORT_NAME for c in cohorts):
            return {"course_id": parent_id, "classes": existing, "cohorts": cohorts}

        # The recruits, so the roster is people rather than a count. Started
        # three weeks back: the first classes have happened, which is what the
        # timeline's signed-up/attended columns need.
        roster = [
            pick(m, "id")
            for m in members
            if pick(m, "username") in RECRUIT_USERNAMES and pick(m, "id")
        ]
        try:
            # Started eight days back, so the first four classes have run and
            # the last two are still to come. A cohort entirely in the past
            # has nothing upcoming to reschedule or sign up for; one entirely
            # in the future has no attendance to show.
            cohort = self.api.post(
                "/training/cohorts",
                {
                    "course_id": parent_id,
                    "name": self.RECRUIT_COHORT_NAME,
                    "code": "RS-2026-F",
                    "start_date": str(TODAY - timedelta(days=8)),
                    "location": "Training & Administration Center",
                    "member_user_ids": roster,
                    "generate_program": True,
                },
            )
            cohorts.append(cohort)
            self._fill_cohort_classes(pick(cohort, "id"), roster)
        except ApiError as exc:
            self.blocked.append(f"cohort: {exc}")
        return {"course_id": parent_id, "classes": existing, "cohorts": cohorts}

    def _fill_cohort_classes(self, cohort_id: str | None, roster: list[str]) -> None:
        """Give the cohort's classes events and sign the roster up.

        Creating a cohort does not create calendar events for classes whose
        date has already passed, which leaves the detail page reading "No
        event" on every row under a red "Create N missing events" button — the
        repair prompt, not the normal state. Running the regenerate endpoint is
        exactly what that button does.
        """
        if not cohort_id:
            return
        try:
            self.api.post(f"/training/cohorts/{cohort_id}/regenerate", {})
        except ApiError as exc:
            self.blocked.append(f"cohort events: {exc}")
            return

        detail = self.api.get(f"/training/cohorts/{cohort_id}")
        for row in items(detail, "classes"):
            event_id = pick(row, "event_id", "eventId")
            if not event_id:
                continue
            for user_id in roster:
                try:
                    self.api.post(
                        f"/events/{event_id}/rsvp",
                        {"user_id": user_id, "status": "going"},
                    )
                except ApiError as exc:
                    if exc.code not in (400, 409):
                        raise

    # -- inventory ---------------------------------------------------

    INVENTORY_CATEGORIES = [
        ("Structural PPE", "ppe", True, True),
        ("SCBA & Air Supply", "equipment", True, True),
        ("Uniforms", "uniform", True, False),
        ("Hand Tools", "tool", False, False),
        ("Portable Radios", "electronics", True, True),
    ]

    INVENTORY_ITEMS = [
        ("Bunker Coat", "Structural PPE", "Globe", "GX-7", 2150.00, "individual"),
        ("Bunker Pants", "Structural PPE", "Globe", "GX-7", 1875.00, "individual"),
        ("Structural Helmet", "Structural PPE", "Cairns", "1044", 495.00, "individual"),
        ("Firefighting Gloves", "Structural PPE", "Shelby", "5227", 89.00, "pool"),
        ("SCBA Pack", "SCBA & Air Supply", "MSA", "G1", 6800.00, "individual"),
        (
            "SCBA Spare Cylinder",
            "SCBA & Air Supply",
            "MSA",
            "45-min Carbon",
            1200.00,
            "pool",
        ),
        ("Gas Meter", "SCBA & Air Supply", "MSA", "Altair 5X", 2400.00, "individual"),
        ("Job Shirt", "Uniforms", "5.11 Tactical", "Job Shirt", 72.00, "pool"),
        ("Class B Uniform Shirt", "Uniforms", "Elbeco", "Textrop2", 58.00, "pool"),
        ("Halligan Bar", "Hand Tools", "Pro Bar", "30 in", 320.00, "individual"),
        ("Flathead Axe", "Hand Tools", "Council Tool", "6 lb", 145.00, "individual"),
        (
            "Portable Radio",
            "Portable Radios",
            "Motorola",
            "APX 6000",
            4300.00,
            "individual",
        ),
        # Appended, not inserted: asset tags are derived from this list's index,
        # so anything added in the middle renumbers every item after it. These
        # three exist so there is individually-tracked gear left over once every
        # member has been issued a piece — without them nobody can hold more
        # than one, and the screens that list a member's kit picture a list of
        # one.
        (
            "Wildland Brush Coat",
            "Structural PPE",
            "Lion",
            "Wildland",
            410.00,
            "individual",
        ),
        (
            "Rescue Harness",
            "Structural PPE",
            "Sterling",
            "Class II",
            265.00,
            "individual",
        ),
        (
            "Thermal Imaging Camera",
            "SCBA & Air Supply",
            "Seek",
            "Attack PRO",
            3100.00,
            "individual",
        ),
    ]

    def seed_inventory(self, stations: list[dict]) -> dict[str, list[dict]]:
        categories = items(self.api.get("/inventory/categories"), "categories")
        existing = {c.get("name") for c in categories}
        for (
            name,
            item_type,
            requires_assignment,
            requires_serial,
        ) in self.INVENTORY_CATEGORIES:
            if name in existing:
                continue
            categories.append(
                self.api.post(
                    "/inventory/categories",
                    {
                        "name": name,
                        "description": f"{name} tracked per member and per apparatus.",
                        "item_type": item_type,
                        "requires_assignment": requires_assignment,
                        "requires_serial_number": requires_serial,
                        "requires_maintenance": item_type in ("ppe", "equipment"),
                        "low_stock_threshold": 4,
                    },
                )
            )
        category_ids = {c.get("name"): pick(c, "id") for c in categories}
        location_id = pick(stations[0], "id") if stations else None

        existing_items = items(self.api.get("/inventory/items?limit=200"), "items")
        names = {i.get("name") for i in existing_items}
        for index, (name, category, manufacturer, model, price, tracking) in enumerate(
            self.INVENTORY_ITEMS
        ):
            if name in names:
                continue
            payload = {
                "name": name,
                "description": f"{manufacturer} {model} {name.lower()}.",
                "manufacturer": manufacturer,
                "model_number": model,
                "purchase_price": price,
                "replacement_cost": price,
                "purchase_date": str(TODAY - timedelta(days=400 + index * 30)),
                "vendor": "Atlantic Fire Equipment",
                "condition": "good",
                "status": "available",
                "tracking_type": tracking,
                "quantity": 1 if tracking == "individual" else 12,
                "station": "Station 1 - Headquarters",
                # Categories flagged `requires_maintenance` reject items with no
                # inspection cadence, so every seeded item carries one.
                "inspection_interval_days": 365,
            }
            if category_ids.get(category):
                payload["category_id"] = category_ids[category]
            # Serial/asset tags go on every item, not just individually-tracked
            # ones: categories flagged `requires_serial_number` reject a pool
            # item without one.
            payload["serial_number"] = f"{model.replace(' ', '')}-{index:04d}"
            payload["asset_tag"] = f"OFD-{1000 + index}"
            if location_id:
                payload["location_id"] = location_id
            existing_items.append(self.api.post("/inventory/items", payload))
        return {"categories": categories, "items": existing_items}

    # -- inventory: kits, storage, allowances, assignments -----------

    def _seed_size_preferences(self, members: list[dict]) -> None:
        """Record sizes for the roster.

        Quartermaster screens read these — the kit-issue flow picks a coat
        variant from a member's jacket size, and the sizes modal is otherwise
        a grid of empty dropdowns with nothing to picture.
        """
        # A spread wide enough that the size/colour variant screens have more
        # than one bucket to fill, cycled across the roster. The size and style
        # fields are dropdowns keyed on lowercase codes (STANDARD_SIZES,
        # GARMENT_STYLES) — a display label like "L" or "Regular" is stored
        # happily by the API and then renders as an unselected "--".
        blueprint = [
            {
                "shirt_size": "l",
                "shirt_style": "long_sleeve",
                "pant_waist": "34",
                "pant_inseam": "32",
                "jacket_size": "l",
                "boot_size": "10",
                "boot_width": "D",
                "glove_size": "l",
                "hat_size": "7 1/4",
            },
            {
                "shirt_size": "m",
                "shirt_style": "short_sleeve",
                "pant_waist": "32",
                "pant_inseam": "34",
                "jacket_size": "m",
                "boot_size": "9",
                "boot_width": "EE",
                "glove_size": "m",
                "hat_size": "7",
            },
            {
                "shirt_size": "xl",
                "shirt_style": "polo",
                "pant_waist": "38",
                "pant_inseam": "30",
                "jacket_size": "xl",
                "boot_size": "12",
                "boot_width": "D",
                "glove_size": "xl",
                "hat_size": "7 5/8",
            },
            {
                "shirt_size": "s",
                "shirt_style": "quarter_zip",
                "pant_waist": "30",
                "pant_inseam": "30",
                "jacket_size": "s",
                "boot_size": "7",
                "boot_width": "B",
                "glove_size": "s",
                "hat_size": "6 7/8",
            },
        ]
        for index, member in enumerate(members):
            user_id = pick(member, "id")
            if not user_id:
                continue
            try:
                existing = self.api.get(
                    f"/inventory/members/{user_id}/size-preferences"
                )
            except ApiError as exc:
                # No record yet is the normal first-run case, not a failure.
                if exc.code != 404:
                    raise
                existing = None
            if existing and pick(existing, "shirt_size", "shirtSize"):
                continue
            self.api.call(
                "PUT",
                f"/inventory/members/{user_id}/size-preferences",
                blueprint[index % len(blueprint)],
            )

    def _seed_item_maintenance(
        self, category_ids: dict[str, Any], members: list[dict]
    ) -> None:
        """Service history for the items whose category tracks it.

        The item detail page only offers its Inspections tab for a category
        with `requires_maintenance`, and that tab is empty without records —
        so the guide's maintenance timeline had nothing behind it.
        """
        tracked = {
            category_ids.get("Structural PPE"),
            category_ids.get("SCBA & Air Supply"),
        }
        tracked.discard(None)
        if not tracked:
            return
        performer = next((pick(m, "id") for m in members if pick(m, "id")), None)
        blueprint = [
            ("routine_inspection", 150, "Annual NFPA 1851 routine inspection.", None),
            ("advanced_cleaning", 95, "Advanced cleaning after a working fire.", 85.00),
            ("repair", 40, "Replaced a torn wristlet and re-taped the seam.", 140.00),
        ]
        for item in items(self.api.get("/inventory/items?limit=500"), "items"):
            item_id = pick(item, "id")
            if not item_id or pick(item, "category_id", "categoryId") not in tracked:
                continue
            if items(
                self.api.get(f"/inventory/items/{item_id}/maintenance"), "records"
            ):
                continue
            for kind, days_ago, description, cost in blueprint:
                completed = TODAY - timedelta(days=days_ago)
                payload = {
                    "item_id": item_id,
                    "maintenance_type": kind,
                    "scheduled_date": str(completed - timedelta(days=3)),
                    "completed_date": str(completed),
                    "next_due_date": str(completed + timedelta(days=365)),
                    "description": description,
                    "condition_after": "good",
                    "passed": True,
                    "is_completed": True,
                }
                if cost is not None:
                    payload["cost"] = cost
                if performer:
                    payload["performed_by"] = performer
                self.api.post("/inventory/maintenance", payload)

    def _file_items_into_areas(
        self,
        areas: list[dict],
        category_ids: dict[str, Any],
    ) -> None:
        """Put each item on a shelf.

        Storage areas ship empty, so the page's item counts all read 0 and the
        inline items panel — the thing the guide describes — cannot be opened
        at all. Items are filed by category, falling back to the quartermaster
        shelving.

        Items are re-read here rather than threaded in from `seed_inventory`:
        a create response carries no `category_id`, so routing off that list
        put every item under the fallback area.
        """
        by_name = {a.get("name"): pick(a, "id") for a in areas}
        default_area = by_name.get("Quartermaster Shelving")
        routing = {
            category_ids.get("Structural PPE"): by_name.get("Turnout Gear Racks"),
            category_ids.get("SCBA & Air Supply"): by_name.get("SCBA Cabinet"),
            category_ids.get("Uniforms"): by_name.get("Uniform Bins"),
        }
        for item in items(self.api.get("/inventory/items?limit=500"), "items"):
            item_id = pick(item, "id")
            if not item_id:
                continue
            area_id = routing.get(pick(item, "category_id", "categoryId"))
            area_id = area_id or default_area
            if not area_id:
                continue
            if pick(item, "storage_area_id", "storageAreaId") == area_id:
                continue
            self.api.patch(f"/inventory/items/{item_id}", {"storage_area_id": area_id})

    def seed_inventory_operations(
        self,
        categories: list[dict],
        inventory_items: list[dict],
        stations: list[dict],
        members: list[dict],
    ) -> dict[str, list[dict]]:
        category_ids = {c.get("name"): pick(c, "id") for c in categories}
        items_by_name = {i.get("name"): i for i in inventory_items}

        self._seed_size_preferences(members)
        self._seed_item_maintenance(category_ids, members)

        areas = items(self.api.get("/inventory/storage-areas"), "storage_areas")
        area_names = {a.get("name") for a in areas}
        location_id = pick(stations[0], "id") if stations else None
        for order, (name, label, storage_type) in enumerate(
            [
                ("Turnout Gear Racks", "TG-01", "rack"),
                ("SCBA Cabinet", "SCBA-01", "cabinet"),
                ("Quartermaster Shelving", "QM-01", "shelf"),
                ("Uniform Bins", "UNI-01", "bin"),
            ]
        ):
            if name in area_names:
                continue
            payload = {
                "name": name,
                "label": label,
                "description": f"{name} in the Station 1 quartermaster room.",
                "storage_type": storage_type,
                "sort_order": order,
            }
            if location_id:
                payload["location_id"] = location_id
            areas.append(self.api.post("/inventory/storage-areas", payload))

        self._file_items_into_areas(areas, category_ids)

        kits = items(self.api.get("/inventory/kits"), "kits")
        kit_names = {k.get("name") for k in kits}
        for name, description, line_items in [
            (
                "New Recruit PPE Kit",
                "Issued to every probationary member on day one.",
                [
                    ("Bunker Coat", "Structural PPE", 1),
                    ("Bunker Pants", "Structural PPE", 1),
                    ("Structural Helmet", "Structural PPE", 1),
                    ("Firefighting Gloves", "Structural PPE", 2),
                ],
            ),
            (
                "Duty Uniform Kit",
                "Standard duty uniform issue.",
                [
                    ("Job Shirt", "Uniforms", 2),
                    ("Class B Uniform Shirt", "Uniforms", 3),
                ],
            ),
        ]:
            if name in kit_names:
                continue
            kits.append(
                self.api.post(
                    "/inventory/kits",
                    {
                        "name": name,
                        "description": description,
                        "line_items": [
                            {
                                "item_name": item_name,
                                "quantity": quantity,
                                "size_selectable": True,
                                **(
                                    {"item_id": pick(items_by_name[item_name], "id")}
                                    if item_name in items_by_name
                                    else {}
                                ),
                                **(
                                    {"category_id": category_ids[category]}
                                    if category_ids.get(category)
                                    else {}
                                ),
                            }
                            for item_name, category, quantity in line_items
                        ],
                    },
                )
            )

        allowances = items(self.api.get("/inventory/allowances"), "allowances")
        if not allowances:
            for category, quantity, period in [
                ("Structural PPE", 1, "career"),
                ("Uniforms", 3, "annual"),
                ("Portable Radios", 1, "career"),
            ]:
                category_id = category_ids.get(category)
                if not category_id:
                    continue
                allowances.append(
                    self.api.post(
                        "/inventory/allowances",
                        {
                            "category_id": category_id,
                            "max_quantity": quantity,
                            "period_type": period,
                        },
                    )
                )

        # Assign individually-tracked gear so "My Equipment", the member
        # inventory tab, and the item detail page all show a holder.
        assignable = [
            i
            for i in inventory_items
            if (i.get("tracking_type") or i.get("trackingType")) == "individual"
        ]
        # Held back from the round-robin below, which otherwise assigns every
        # available individual item and leaves the checkout workflow with
        # nothing to draw on — both checkout screens then picture an empty
        # state. Checkout is the temporary loan, so the reserved items are the
        # shared diagnostic tools rather than personal turnout gear.
        checked_out = self._check_out_shared_tools(members, assignable)
        # Before the round-robin, not after: the spread hands every spare piece
        # to a different member, so a kit built afterwards has nothing left to
        # build from.
        kitted = self._kit_out_one_member(members, assignable)

        for index, item in enumerate(assignable):
            status = (item.get("status") or "").lower()
            item_id = pick(item, "id")
            if (status and status != "available") or item_id in kitted:
                continue
            if item_id in checked_out:
                continue
            user_id = pick(members[index % len(members)], "id")
            if not user_id or not item_id:
                continue
            self.api.post(
                f"/inventory/items/{item_id}/assign",
                {
                    "item_id": item_id,
                    "user_id": user_id,
                    "assignment_type": "permanent",
                    "assignment_reason": "Initial issue",
                },
            )

        self._issue_against_allowance(members, category_ids, inventory_items)

        self._wear_out_one_members_gear()

        return {"storage_areas": areas, "kits": kits, "allowances": allowances}

    # One due back, one already late: the checkouts page splits Active from
    # Overdue into two tabs, and a single on-time loan leaves the second one
    # empty. The overdue item goes to the demo member so "My Equipment" shows
    # the late badge from the member's own side too.
    CHECKOUT_PLAN = (
        ("Thermal Imaging Camera", 6, "Loaned for the district's night drill."),
        ("Gas Meter", -3, "Carried on the CO investigation; not yet returned."),
    )

    def _check_out_shared_tools(
        self, members: list[dict], assignable: list[dict]
    ) -> set[str]:
        """Loan two shared tools, and report which items were consumed.

        Returns the item ids so the caller's round-robin skips them — an item
        that is checked out is no longer ``available``, and assigning it on top
        of the loan would either fail or silently contradict it.
        """
        member_ids = [pick(m, "id") for m in members if pick(m, "id")]
        if not member_ids:
            return set()

        active = self.api.get("/inventory/checkout/active")
        overdue = self.api.get("/inventory/checkout/overdue")
        if items(active, "checkouts") or items(overdue, "checkouts"):
            # Already loaned on a previous run. Return the ids anyway so the
            # round-robin still skips them.
            return {
                pick(c, "item_id")
                for c in items(active, "checkouts") + items(overdue, "checkouts")
                if pick(c, "item_id")
            }

        member_id = pick(
            next(
                (m for m in members if pick(m, "username") == DEMO_MEMBER_USERNAME),
                {},
            ),
            "id",
        )
        reserved: set[str] = set()
        for index, (name, due_in_days, reason) in enumerate(self.CHECKOUT_PLAN):
            item = next(
                (
                    i
                    for i in assignable
                    if pick(i, "name") == name
                    and (pick(i, "status") or "").lower() == "available"
                    and pick(i, "id") not in reserved
                ),
                None,
            )
            item_id = pick(item, "id") if item else None
            if not item_id:
                continue
            # The late loan is the demo member's; the on-time one goes to
            # somebody else so the page shows two different borrowers.
            borrower = (
                member_id
                if due_in_days < 0 and member_id
                else member_ids[index % len(member_ids)]
            )
            try:
                self.api.post(
                    "/inventory/checkout",
                    {
                        "item_id": item_id,
                        "user_id": borrower,
                        "expected_return_at": (
                            NOW + timedelta(days=due_in_days)
                        ).isoformat(),
                        "checkout_reason": reason,
                    },
                )
            except ApiError as exc:
                self.blocked.append(f"check out {name}: {exc}")
                continue
            reserved.add(item_id)
        return reserved

    # The Uniforms allowance seeded above is 3 a year. Spending two of them
    # leaves one, which is the only interesting number: a member at 0 remaining
    # is blocked whatever the quantity, and a member at 3 is never blocked, so
    # neither shows the quantity mattering.
    ALLOWANCE_SPEND_CATEGORY = "Uniforms"
    ALLOWANCE_SPEND_ITEMS = ("Job Shirt", "Class B Uniform Shirt")

    def _issue_against_allowance(
        self,
        members: list[dict],
        category_ids: dict[str, str | None],
        inventory_items: list[dict],
    ) -> None:
        """Spend part of the demo member's uniform allowance.

        Without this every member sits at their full allowance, so the issue
        dialog can only ever show the unremarkable "3 of 3 remaining" — the
        over-allowance warning and its override are unreachable, and the pool
        items page has no issuance history to show either.
        """
        category_id = category_ids.get(self.ALLOWANCE_SPEND_CATEGORY)
        member_id = pick(
            next(
                (m for m in members if pick(m, "username") == DEMO_MEMBER_USERNAME),
                {},
            ),
            "id",
        )
        if not category_id or not member_id:
            return

        # Idempotent on the state rather than on a marker: re-running must not
        # spend a third unit and take the member to 0 remaining.
        check = self.api.get(f"/inventory/allowances/check/{member_id}/{category_id}")
        if (check.get("issued_this_period") or 0) > 0:
            return

        by_name = {pick(i, "name"): i for i in inventory_items}
        for name in self.ALLOWANCE_SPEND_ITEMS:
            item = by_name.get(name)
            item_id = pick(item, "id") if item else None
            if not item_id:
                continue
            try:
                self.api.post(
                    f"/inventory/items/{item_id}/issue",
                    {
                        "user_id": member_id,
                        "quantity": 1,
                        "issue_reason": "Annual uniform issue",
                    },
                )
            except ApiError as exc:
                self.blocked.append(f"issue {name} against allowance: {exc}")
                return

    WORN_GEAR_CATEGORY = "Structural PPE"

    def _wear_out_one_members_gear(self) -> None:
        """Retire one member's structural gear so it needs replacing.

        Every assigned item is seeded `good`, which makes the Impact Planner's
        replacement-aware analysis invisible: it separates a member holding a
        *serviceable* item from one whose holdings are all worn or past their
        NFPA retirement, and with nothing worn in the data the second case never
        appears.

        It has to be **every** item that member holds in the category, not one
        of them. The rule is `has_any and serviceable == 0`, so wearing out a
        single coat on a member who also holds good pants still reads as "has
        item" — which is exactly what the first attempt at this produced.
        """
        # Re-fetched rather than reusing the assignment list, which was read
        # before the assignments were made and still says "available".
        categories = items(
            self.api.get("/inventory/categories?limit=100"), "categories"
        )
        category_id = next(
            (
                pick(c, "id")
                for c in categories
                if pick(c, "name") == self.WORN_GEAR_CATEGORY
            ),
            None,
        )
        if not category_id:
            return
        current = items(self.api.get("/inventory/items?limit=200"), "items")
        in_category = [
            i for i in current if pick(i, "category_id", "categoryId") == category_id
        ]
        # Idempotent: a second run must not retire a second member's gear.
        if any((pick(i, "condition") or "").lower() == "poor" for i in in_category):
            return

        by_holder: dict[str, list[dict]] = {}
        for item in in_category:
            holder = pick(item, "assigned_to_user_id", "assignedToUserId")
            if holder:
                by_holder.setdefault(str(holder), []).append(item)
        if not by_holder:
            return

        # The member holding the fewest pieces, so the smallest edit produces
        # the badge and the rest of the roster keeps its serviceable gear.
        _, gear = min(by_holder.items(), key=lambda kv: len(kv[1]))
        for item in gear:
            item_id = pick(item, "id")
            if not item_id:
                continue
            try:
                self.api.patch(
                    f"/inventory/items/{item_id}",
                    {
                        "condition": "poor",
                        "notes": "End of service life — due for replacement.",
                    },
                )
            except ApiError as exc:
                self.blocked.append(f"worn gear: {exc}")
                return

    def _kit_out_one_member(
        self, members: list[dict], assignable: list[dict], target: int = 3
    ) -> set[str]:
        """Give one member a full set rather than a single piece of gear.

        Spreading one item per member leaves nobody holding two, and every
        multi-item screen then pictures a list of one: the batch return with a
        condition per item, the item count on a member's row, the equipment
        list on their profile. A firefighter issued exactly one thing is not
        the realistic case either.
        """
        member = next(
            (m for m in members if pick(m, "username") == DEMO_MEMBER_USERNAME), None
        )
        user_id = pick(member or {}, "id")
        if not user_id:
            return set()

        held = items(self.api.get(f"/inventory/items?assigned_to={user_id}"), "items")
        available = [
            i
            for i in assignable
            if (pick(i, "status") or "").lower() == "available" and pick(i, "id")
        ]
        taken: set[str] = set()
        shortfall = max(0, target - len(held))
        for item in available[:shortfall]:
            item_id = pick(item, "id")
            self.api.post(
                f"/inventory/items/{item_id}/assign",
                {
                    "item_id": item_id,
                    "user_id": user_id,
                    "assignment_type": "permanent",
                    "assignment_reason": "Initial issue",
                },
            )
            taken.add(item_id)

        # A database seeded before this step exists has every piece of gear
        # already spread one-per-member, so there is nothing "available" left
        # and the kit would never appear. Keyed on the state that matters — is
        # anyone holding a set — rather than on whether the item table is
        # empty, which is the guard that has silently frozen this seeder's
        # additions before. Gear moves between members in a real department;
        # taking a piece back to build the demo kit is a normal operation.
        shortfall -= len(taken)
        if shortfall <= 0:
            return taken
        for item in items(self.api.get("/inventory/items?limit=200"), "items"):
            if shortfall <= 0:
                break
            item_id = pick(item, "id")
            holder = pick(item, "assigned_to_user_id", "assignedToUserId")
            if (
                not item_id
                or not holder
                or holder == user_id
                or pick(item, "tracking_type", "trackingType") != "individual"
            ):
                continue
            self.api.post(f"/inventory/items/{item_id}/unassign", {"item_id": item_id})
            self.api.post(
                f"/inventory/items/{item_id}/assign",
                {
                    "item_id": item_id,
                    "user_id": user_id,
                    "assignment_type": "permanent",
                    "assignment_reason": "Initial issue",
                },
            )
            taken.add(item_id)
            shortfall -= 1
        return taken

    # -- inventory: equipment requests --------------------------------

    # (item name, request type, member's reason, review note, fulfil?)
    # A review note of None leaves the request pending.
    EQUIPMENT_REQUESTS = [
        (
            "Nitrile Gloves — Large",
            "issuance",
            "Box in the medic bag is down to two pairs.",
            "Approved — issue from quartermaster stock.",
            True,
        ),
        (
            "Portable Radio",
            "checkout",
            "Mine failed its battery check on Tuesday.",
            "Approved — collect from the quartermaster.",
            False,
        ),
        (
            "Structural Helmet",
            "issuance",
            "Shell is cracked at the brim after the Third Street fire.",
            None,
            False,
        ),
    ]

    def seed_equipment_requests(self, base_url: str) -> dict[str, Any]:
        """One request in each state the Equipment Requests page can show.

        A request is raised by the member who wants the kit, so these are
        created over a second session signed in as the demo member — the admin
        cannot raise one on somebody's behalf, and a request the admin raised
        for themselves would never show the reviewer/requester split the page
        is built around.

        Three states, because each one renders differently: **pending** carries
        the Approve and Deny actions, **approved** carries **Fulfill**, and
        **fulfilled** is terminal and carries a link through to the issuance it
        created.
        """
        existing = items(self.api.get("/inventory/requests"), "requests")
        if existing:
            return {"requests": existing}

        catalog = items(self.api.get("/inventory/items?limit=200"), "items")

        def by_name(name: str) -> dict | None:
            return next((i for i in catalog if pick(i, "name") == name), None)

        member_api = Api(base_url)
        member_api.login_as(DEMO_MEMBER_USERNAME, DEMO_MEMBER_PASSWORD)

        created = []
        for name, request_type, reason, review, fulfill in self.EQUIPMENT_REQUESTS:
            item = by_name(name)
            if item is None:
                continue
            payload = {
                "item_name": name,
                "item_id": pick(item, "id"),
                "quantity": 1,
                "request_type": request_type,
                "priority": "normal",
                "reason": reason,
            }
            request = member_api.post("/inventory/requests", payload)
            request_id = pick(request, "id")
            if review:
                self.api.put(
                    f"/inventory/requests/{request_id}/review",
                    {"status": "approved", "review_notes": review},
                )
            if fulfill:
                # Fulfilling routes by the item's tracking type — a pool item
                # becomes an issuance, an individual one a checkout — and the
                # request then carries a reference to whichever it made.
                self.api.put(
                    f"/inventory/requests/{request_id}/fulfill", {"quantity": 1}
                )
            created.append(request)
        return {"requests": created}

    # -- inventory: variants and reorder requests --------------------

    def seed_inventory_variants(
        self, categories: list[dict], stations: list[dict]
    ) -> dict[str, list[dict]]:
        """Sized/coloured stock, which the variant-group pages render.

        `create-variants` expands a base product into one item per size and
        colour and groups them, which is how the guides picture the page — a
        bare variant group with no member items still reads as empty.
        """
        groups = items(self.api.get("/inventory/variant-groups"), "variant_groups")
        existing = {g.get("name") for g in groups}
        category_ids = {c.get("name"): pick(c, "id") for c in categories}
        location_id = pick(stations[0], "id") if stations else None

        for base_name, category, sizes, colors, style, price in [
            (
                "Structural Coat",
                "Structural PPE",
                ["s", "m", "l", "xl", "xxl"],
                None,
                None,
                895.00,
            ),
            (
                "Department Polo",
                "Uniforms",
                ["s", "m", "l", "xl"],
                ["Navy", "White"],
                "polo",
                32.00,
            ),
        ]:
            if base_name in existing:
                continue
            payload = {
                "base_name": base_name,
                "sizes": sizes,
                "quantity_per_variant": 6,
                "purchase_price": price,
                "replacement_cost": price,
                "tracking_type": "pool",
                "create_variant_group": True,
                "station": "Station 1 - Headquarters",
                "notes": f"{base_name} stock held by the quartermaster.",
            }
            if colors:
                payload["colors"] = colors
            if style:
                payload["styles"] = [style]
            if category_ids.get(category):
                payload["category_id"] = category_ids[category]
            if location_id:
                payload["location_id"] = location_id
            self.api.post("/inventory/items/create-variants", payload)
        groups = items(self.api.get("/inventory/variant-groups"), "variant_groups")

        requests = items(
            self.api.get("/inventory/reorder-requests"), "reorder_requests"
        )
        if not requests:
            for item_name, quantity, vendor, cost, urgency in [
                ("Firefighting Gloves", 12, "Atlantic Fire Equipment", 89.00, "normal"),
                ("SCBA Spare Cylinder", 4, "MSA Direct", 1_200.00, "high"),
                ("Class B Uniform Shirt", 20, "Elbeco Supply", 58.00, "low"),
                ("Portable Radio", 2, "Motorola Solutions", 4_300.00, "critical"),
            ]:
                requests.append(
                    self.api.post(
                        "/inventory/reorder-requests",
                        {
                            "item_name": item_name,
                            "quantity_requested": quantity,
                            "vendor": vendor,
                            "estimated_unit_cost": cost,
                            "urgency": urgency,
                            "expected_delivery_date": str(TODAY + timedelta(days=21)),
                            "notes": f"Restock {item_name.lower()} for the coming year.",
                        },
                    )
                )
        return {"variant_groups": groups, "reorder_requests": requests}

    # -- supply tracking: catalog links, lots aboard, restock reports --

    # Consumables a medic unit carries, as dated stock. Deliberately separate
    # from INVENTORY_ITEMS: those are individually-tracked gear and pool
    # uniforms, and none of them expires. The supply screens have nothing to
    # show without stock that goes out of date.
    #
    # name, unit of measure, unit price
    SUPPLY_ITEMS = [
        ("Naloxone 4mg Nasal", "Box", 42.00),
        ("Epinephrine 1:1000", "Box", 28.00),
        ("Gauze 4x4 Sterile", "Box", 6.50),
        ("Nitrile Gloves — Large", "Box", 11.00),
        ("Normal Saline 1000mL", "Bag", 3.75),
    ]

    # lot number, days until expiry (negative = already expired), quantity
    SUPPLY_LOTS = {
        # Two in-date lots, because one bracket holding units from both is the
        # whole reason `check_item_deployed_lots` exists.
        "Naloxone 4mg Nasal": [("NLX-2405", 24, 6), ("NLX-2411", 213, 8)],
        "Epinephrine 1:1000": [("EPI-3382", 61, 10)],
        "Gauze 4x4 Sterile": [("GZ-9910", 402, 60)],
        # One already expired. It has to be on the shelf, struck through and
        # refused by the swap — an expired lot that is simply absent proves
        # nothing about the guard.
        "Nitrile Gloves — Large": [("GLV-7741", -12, 20), ("GLV-8106", 300, 24)],
        "Normal Saline 1000mL": [("NS-5520", 148, 18)],
    }

    # compartment -> [(position name, catalog item or None, target quantity)]
    #
    # The None entries are load-bearing. A template where every position is
    # linked cannot picture the toolbar's coverage count or the bulk-match
    # dialog, both of which exist for the holes — and plenty of real checklist
    # lines are not stock and never will be.
    MEDIC_COMPARTMENTS = [
        (
            "Drug Bag",
            [
                ("Naloxone 4mg Nasal", "Naloxone 4mg Nasal", 2),
                ("Epinephrine 1:1000", "Epinephrine 1:1000", 2),
                ("Controlled substance seal intact", None, None),
            ],
        ),
        (
            "Trauma Bag",
            [
                ("Gauze 4x4 Sterile", "Gauze 4x4 Sterile", 24),
                ("Nitrile Gloves — Large", "Nitrile Gloves — Large", 4),
                ("Trauma shears", None, None),
            ],
        ),
        (
            "IV Compartment",
            [
                ("Normal Saline 1000mL", "Normal Saline 1000mL", 6),
                ("Sharps container below fill line", None, None),
            ],
        ),
    ]

    def seed_supply_tracking(self, apparatus: list[dict]) -> dict[str, Any]:
        """Dated shelf stock, linked positions, and lots actually on a truck.

        Everything the supply screens show is derived from three things that
        have to exist together: a catalog item with dated lots, a checklist
        position pointing at it, and deployed-lot rows saying what is aboard.
        Miss any one and the pages render truthfully and picture nothing —
        which is the failure mode `SCREENSHOT_CURRENCY.md` documents at length.

        The end state is deliberately mixed, because each filter on the supply
        worklist needs a row and a screenshot of one uniform state teaches
        nothing:

        - one position carrying **two lots with two dates**, so the "soonest
          aboard" rule is visible rather than asserted;
        - one position **short of par** (18 of 24) that still carries an
          expiry, which is also the only thing that makes the Set All to Par
          warning fire;
        - one **restock report** raised by an ordinary member, so the row names
          a real person rather than the administrator who seeded it;
        - one **expired** lot on the shelf, struck through and refused by the
          swap;
        - several positions left **unlinked**, so coverage is not 100%.
        """
        medic = next(
            (
                a
                for a in apparatus
                if str(pick(a, "unit_number", "unitNumber") or "") == "M-3"
            ),
            None,
        )
        if not medic:
            return {"skipped": "no M-3 apparatus"}

        catalog = self._seed_supply_catalog(self._supply_category())
        if not catalog:
            return {"skipped": "no supply catalog"}

        template = self._medic_supply_template(medic)
        if not template:
            return {"skipped": "no medic template"}

        positions = self._link_supply_positions(template, catalog)
        if not positions:
            return {"skipped": "no linked positions"}

        self._deploy_lots(positions, catalog)
        self._report_one_used(positions, str(pick(medic, "id")))
        return {
            "template_id": pick(template, "id"),
            "apparatus_id": pick(medic, "id"),
            "linked_positions": len(positions),
        }

    def _supply_category(self) -> str | None:
        """A consumable category, created if the department has none."""
        categories = items(self.api.get("/inventory/categories"), "categories")
        existing = next(
            (c for c in categories if c.get("name") == "Medical Supplies"), None
        )
        if existing:
            return pick(existing, "id")
        created = self.api.post(
            "/inventory/categories",
            {
                "name": "Medical Supplies",
                "description": "Dated consumables carried on the medic unit.",
                "item_type": "consumable",
                "requires_assignment": False,
                # A consumable has no serial. Flagging this category
                # `requires_serial_number` would reject every lot-stocked item
                # the supply screens are built on.
                "requires_serial_number": False,
                "requires_maintenance": False,
                "low_stock_threshold": 4,
            },
        )
        return pick(created, "id")

    def _seed_supply_catalog(self, category_id: str | None) -> dict[str, dict]:
        """Catalog rows for the consumables, each with dated shelf stock."""
        existing = {
            i.get("name"): i
            for i in items(self.api.get("/inventory/items?limit=200"), "items")
        }
        catalog: dict[str, dict] = {}
        for index, (name, unit, price) in enumerate(self.SUPPLY_ITEMS):
            item = existing.get(name)
            if item is None:
                payload = {
                    "name": name,
                    "description": f"{name} — carried on the medic unit.",
                    "unit_of_measure": unit,
                    "purchase_price": price,
                    "replacement_cost": price,
                    "condition": "good",
                    "status": "available",
                    "tracking_type": "pool",
                    # Not the real count. On-hand for a lot-stocked item comes
                    # from its in-date lots; `quantity` is only the fallback
                    # for items with none. It is deliberately a value no lot
                    # total shares (the smallest seeded lot is 6), so a
                    # screenshot of the two-ledger Qty column cannot be read as
                    # the two agreeing by luck. Zero would say that more
                    # plainly but `create_item` rejects it — a pool item must
                    # carry a quantity of at least 1.
                    "quantity": 1,
                    "asset_tag": f"SUP-{2000 + index}",
                }
                if category_id:
                    payload["category_id"] = category_id
                item = self.api.post("/inventory/items", payload)
            catalog[name] = item
            self._seed_lots_for(name, pick(item, "id"))
        return catalog

    def _seed_lots_for(self, name: str, item_id: str | None) -> None:
        if not item_id:
            return
        have = {
            pick(lot, "lot_number", "lotNumber")
            for lot in items(self.api.get(f"/inventory/items/{item_id}/lots"), "lots")
        }
        for lot_number, days, quantity in self.SUPPLY_LOTS.get(name, []):
            if lot_number in have:
                continue
            self.api.post(
                f"/inventory/items/{item_id}/lots",
                {
                    "lot_number": lot_number,
                    "expiration_date": str(TODAY + timedelta(days=days)),
                    "quantity": quantity,
                    "received_date": str(TODAY - timedelta(days=30)),
                },
            )

    def _medic_supply_template(self, medic: dict) -> dict | None:
        """A counted, catalog-linked checklist for the medic unit.

        Assigned to the apparatus itself rather than to the `ambulance` *type*,
        so it cannot collide with the per-type close-out template
        `seed_equipment_checks` creates — the check-create endpoint refuses a
        second check against a template already used on a shift.
        """
        name = "Medic 3 Supply Check"
        existing = next(
            (
                t
                for t in items(self.api.get("/equipment-checks/templates"), "templates")
                if pick(t, "name") == name
            ),
            None,
        )
        if existing:
            return self.api.get(f"/equipment-checks/templates/{pick(existing, 'id')}")
        created = self.api.post(
            "/equipment-checks/templates",
            {
                "name": name,
                "description": "Dated consumables and counted stock on the medic.",
                "check_timing": "start_of_shift",
                "apparatus_id": pick(medic, "id"),
                "is_active": True,
                "compartments": [
                    {
                        "name": compartment,
                        "sort_order": order,
                        "items": [
                            {
                                "name": position,
                                "sort_order": position_order,
                                # A counted position is what the on-truck count,
                                # the lots sheet and the par warning all hang
                                # off. A pass/fail line has no number to be
                                # short of, which is why the unlinked entries
                                # are that type.
                                "check_type": "quantity" if target else "pass_fail",
                                "is_required": True,
                                "required_quantity": target,
                                "expected_quantity": target,
                                "has_expiration": bool(catalog_name),
                                "expiration_warning_days": 30,
                            }
                            for position_order, (
                                position,
                                catalog_name,
                                target,
                            ) in enumerate(contents)
                        ],
                    }
                    for order, (compartment, contents) in enumerate(
                        self.MEDIC_COMPARTMENTS
                    )
                ],
            },
        )
        return self.api.get(f"/equipment-checks/templates/{pick(created, 'id')}")

    def _link_supply_positions(
        self, template: dict, catalog: dict[str, dict]
    ) -> dict[str, str]:
        """Point each counted position at its catalog item.

        Returns position name -> template item id, for the linked ones only.
        The link is what every supply feature reads: an unlinked position has no
        expiration tracking, no lots, no ready stock and no restock reporting.
        """
        linked: dict[str, str] = {}
        for compartment in items(template, "compartments"):
            for item in items(compartment, "items"):
                position = str(pick(item, "name") or "")
                item_id = pick(item, "id")
                # The seeded positions are named after their catalog item, so
                # the lookup is the name itself — the unlinked scaffolding lines
                # ("Trauma shears") are simply absent from the catalog.
                if not item_id or position not in catalog:
                    continue
                linked[position] = str(item_id)
                if pick(item, "inventory_item_id", "inventoryItemId"):
                    continue
                self.api.put(
                    f"/equipment-checks/items/{item_id}",
                    {"inventory_item_id": pick(catalog[position], "id")},
                )
        return linked

    def _deploy_lots(self, positions: dict[str, str], catalog: dict[str, dict]) -> None:
        """Swap shelf lots onto the truck, so positions carry dated stock.

        Naloxone takes **both** its lots. That is the case the deployed-lot
        table was added for: one bracket, two expiration dates, and a position
        whose real exposure is the earlier of them. Going through the swap
        endpoint rather than writing rows directly also exercises the decrement
        on the shelf lot, so the ready-stock figures stay honest.

        Each position is counted to zero first and then filled to its par. A
        position nobody has counted reports its **target** as the units aboard
        — a NULL count means "not counted since this was defined", not "empty"
        — and the first swap turns that assumption into a real undated lot row
        before adding the swapped units on top. Skipping the zero left every
        truck holding roughly double its par behind a phantom lot with no
        number and no date, which is both wrong and the one thing these screens
        exist to rule out.
        """
        targets = {
            position: target
            for _, contents in self.MEDIC_COMPARTMENTS
            for position, _catalog_name, target in contents
            if target
        }
        for position, item_id in positions.items():
            aboard = self.api.get(f"/equipment-checks/items/{item_id}/deployed-lots")
            if items(aboard, "lots"):
                continue
            catalog_item = catalog.get(position)
            target = targets.get(position)
            if not catalog_item or not target:
                continue
            self.api.put(f"/equipment-checks/items/{item_id}/quantity", {"quantity": 0})
            lots = items(
                self.api.get(f"/inventory/items/{pick(catalog_item, 'id')}/lots"),
                "lots",
            )
            # Soonest-expiring first, and never an expired one: the swap refuses
            # those, and a seeder that asks for one is testing the guard rather
            # than building a picture.
            usable = sorted(
                (
                    lot
                    for lot in lots
                    if str(pick(lot, "expiration_date", "expirationDate") or "")
                    > str(TODAY)
                    and int(pick(lot, "quantity") or 0) > 0
                ),
                key=lambda lot: str(
                    pick(lot, "expiration_date", "expirationDate") or ""
                ),
            )
            if not usable:
                continue
            take = usable[:2] if position == "Naloxone 4mg Nasal" else usable[:1]
            # Fill to par, split evenly across the lots taken. Par rather than a
            # fixed two so the truck starts the story at full: the positions
            # that end up short are the ones `_leave_one_short` and
            # `_report_one_used` make short, and a screenshot where everything
            # is under par cannot tell a shortfall from the starting state.
            share, extra = divmod(target, len(take))
            for index, lot in enumerate(take):
                # Clamped to the shelf lot rather than redistributed: every
                # seeded lot comfortably covers its share, and a seeder that
                # quietly rebalances would hide the day one stops.
                quantity = min(
                    share + (1 if index < extra else 0),
                    int(pick(lot, "quantity") or 0),
                )
                if quantity < 1:
                    continue
                try:
                    self.api.post(
                        f"/equipment-checks/items/{item_id}/swap",
                        {
                            "inventory_lot_id": pick(lot, "id"),
                            "quantity": quantity,
                        },
                    )
                except ApiError as exc:
                    # A lot drawn to nothing between the read and the swap, or
                    # one that expired in between. Neither is worth failing the
                    # whole seed over — the remaining positions still build.
                    if exc.code != 400:
                        raise
                    self.blocked.append(
                        f"supply: {position} refused lot "
                        f"{pick(lot, 'lot_number', 'lotNumber')}"
                    )

    def _leave_one_short(self, positions: dict[str, str]) -> None:
        """Record 18 of 24 gauze.

        Two screens need a truck that is short. The supply worklist needs a row
        that is under par rather than merely expiring, and **Set All to Par**
        needs something whose count it would raise — its warning is suppressed
        on a compartment already full, so a fully stocked demo department cannot
        picture the guard at all.
        """
        item_id = positions.get("Gauze 4x4 Sterile")
        if not item_id:
            return
        self.api.put(f"/equipment-checks/items/{item_id}/quantity", {"quantity": 18})

    def _report_one_used(self, positions: dict[str, str], apparatus_id: str) -> None:
        """Raise a restock report as an ordinary member, not as the chief.

        Reported by the member on purpose. The worklist row names its reporter,
        and one where every report is signed by the administrator who seeded the
        database pictures the opposite of the point: this is crew work, open to
        `equipment_check.submit`, and the member's session is what demonstrates
        that rather than asserting it.
        """
        item_id = positions.get("Normal Saline 1000mL")
        if not item_id:
            return
        # Restock state is not on the deployed-lots payload; the apparatus view
        # is where a position reports it.
        inventory = self.api.get(
            f"/equipment-checks/apparatus/{apparatus_id}/inventory"
        )
        for compartment in items(inventory, "compartments"):
            for position in items(compartment, "items"):
                if str(pick(position, "template_item_id", "templateItemId")) == item_id:
                    if pick(position, "restock_needed", "restockNeeded"):
                        return

        session = None
        member = next(
            (
                m
                for m in items(self.api.get("/users?limit=200"), "users")
                if pick(m, "username") == DEMO_MEMBER_USERNAME
            ),
            None,
        )
        if member:
            try:
                session = self.member_session(
                    self.base_url, str(pick(member, "id")), DEMO_MEMBER_USERNAME
                )
            except ApiError:
                session = None
        # Falls back to the administrator rather than skipping: a worklist with
        # no report at all pictures less than one signed by the wrong person.
        caller = session or self.api
        try:
            caller.post(
                f"/equipment-checks/items/{item_id}/used",
                {
                    "quantity_used": 2,
                    "note": "Used two bags on the 0300 call — bracket is down to four.",
                },
            )
        except ApiError as exc:
            if exc.code not in (400, 403, 409):
                raise
            self.blocked.append(
                f"supply: restock report refused ({exc.code}) for Normal Saline"
            )

    def _repair_check_types(self) -> None:
        """Rewrite checklist items this seeder stored under a type nothing reads.

        Earlier runs wrote ``"check_type": "presence"``. The column is a free
        `String(30)`, and the API used to accept anything that fit — but the
        types the check form recognises spell it ``present``, and an
        unrecognised value falls through the form's switch to the pass/fail
        branch. Every seeded item therefore rendered **Pass / Fail** buttons
        under a guide that describes Present / Missing, and nothing anywhere
        reported a problem.

        The API now validates ``check_type`` against the set the template
        builder offers, so no new row can be written this way from any client.
        This stays for the long-lived demo databases that still hold the old
        rows: re-seeding does not touch a template that already exists by name,
        so nothing else would ever correct them.
        """
        for template in items(self.api.get("/equipment-checks/templates"), "templates"):
            template_id = pick(template, "id")
            if not template_id:
                continue
            detail = self.api.get(f"/equipment-checks/templates/{template_id}")
            for compartment in items(detail, "compartments"):
                for item in items(compartment, "items"):
                    if pick(item, "check_type", "checkType") != "presence":
                        continue
                    self.api.put(
                        f"/equipment-checks/items/{pick(item, 'id')}",
                        {"check_type": "present"},
                    )

    # -- events: check-ins -------------------------------------------

    def seed_event_check_ins(
        self, events: list[dict], members: list[dict]
    ) -> list[dict]:
        """Check members in to an event that has already started.

        The check-in monitoring page is a live attendance view, so it needs an
        event whose window is open — a future event shows nothing however many
        members have RSVP'd.
        """
        started = [
            e
            for e in events
            if str(pick(e, "start_datetime", "startDatetime") or "") < iso(NOW)
        ]
        if not started:
            return []
        # The drill is the only started event whose check-in window is still
        # open, so name it rather than trusting list order.
        drill = next(
            (e for e in started if e.get("title") == IN_PROGRESS_EVENT_TITLE),
            started[-1],
        )
        event_id = pick(drill, "id")

        # Re-read: seed_events may have slid this event's window forward on
        # this very run, and `events` still carries the pre-patch times.
        current = self.api.get(f"/events/{event_id}")
        started_at = str(pick(current, "start_datetime", "startDatetime") or "")

        # A check-in stamped before the event started belongs to a previous
        # window. Left in place it makes the monitor report an average check-in
        # of twenty-odd hours "before event start". `checked_in_at` is
        # write-once — the override route will not move a stamp that is already
        # set — so the whole RSVP has to go and be rebuilt by the loop below,
        # which is also what created it (the drill's RSVP deadline has passed,
        # so seed_event_rsvps skips it).
        if started_at:
            for rsvp in items(self.api.get(f"/events/{event_id}/rsvps"), "rsvps"):
                stamp = str(pick(rsvp, "checked_in_at", "checkedInAt") or "")
                user_id = pick(rsvp, "user_id", "userId")
                if stamp and user_id and stamp < started_at:
                    self.api.delete(f"/events/{event_id}/rsvps/{user_id}")

        checked_in = []
        for member in members[:9]:
            user_id = pick(member, "id")
            if not user_id:
                continue
            try:
                checked_in.append(
                    self.api.post(f"/events/{event_id}/check-in", {"user_id": user_id})
                )
            except ApiError as exc:
                # A member who never RSVP'd may be refused; that is the app's
                # rule, not a seeding failure.
                if exc.code not in (400, 409):
                    raise
        return checked_in

    # -- finance: purchase requests against budgets ------------------

    def seed_purchase_requests(self, finance: dict) -> list[dict]:
        """Spend against the budgets, which is what a budget's detail shows.

        A budget page lists the requests charged to it; without any, the
        transactions panel is empty however well-funded the budget is.
        """
        fiscal_year = finance.get("fiscal_year") or {}
        budgets = finance.get("budgets") or []
        fiscal_year_id = pick(fiscal_year, "id")
        if not fiscal_year_id or not budgets:
            return []

        requests = items(
            self.api.get("/finance/purchase-requests"), "purchase_requests"
        )
        if requests:
            return requests

        planned = [
            ("Thermal Imaging Camera", "Atlantic Fire Equipment", 8_400, "high"),
            (
                "Engine 1 annual pump service",
                "Atlantic Fire Apparatus",
                2_450,
                "medium",
            ),
            ("Bunker gear replacement — 4 sets", "Globe Turnout Gear", 16_600, "high"),
            ("Officer development course fees", "VA Fire Chiefs Assoc.", 3_200, "low"),
            ("Portable radio batteries", "Motorola Solutions", 1_180, "medium"),
            ("Station 2 bay door repair", "Tidewater Door Service", 1_840, "urgent"),
        ]
        for index, (title, vendor, amount, priority) in enumerate(planned):
            budget = budgets[index % len(budgets)]
            request = self.api.post(
                "/finance/purchase-requests",
                {
                    "fiscal_year_id": fiscal_year_id,
                    "budget_id": pick(budget, "id"),
                    "title": title,
                    "description": f"{title} — requested by the duty officer.",
                    "vendor": vendor,
                    "estimated_amount": amount,
                    "priority": priority,
                },
            )
            requests.append(request)
            # Leave the last two as drafts so the list shows both states.
            if index < len(planned) - 2:
                request_id = pick(request, "id")
                try:
                    self.api.post(f"/finance/purchase-requests/{request_id}/submit")
                except ApiError as exc:
                    # No approval chain configured for the amount is a
                    # configuration fact, not a seeding failure.
                    if exc.code != 400:
                        raise
        return requests

    #: (entity, chain name, [(order, step name, approver position)]). Two steps
    #: on the money-spending documents so the approval timeline shows a chain
    #: rather than a single box.
    APPROVAL_CHAINS = [
        (
            "purchase_request",
            "Purchase Request Approval",
            [
                (1, "Company officer review", "Captain"),
                (2, "Chief approval", "Fire Chief"),
            ],
        ),
        (
            "expense_report",
            "Expense Reimbursement Approval",
            [(1, "Treasurer review", "Treasurer"), (2, "Chief approval", "Fire Chief")],
        ),
        (
            "check_request",
            "Check Request Approval",
            [(1, "Treasurer review", "Treasurer"), (2, "Chief approval", "Fire Chief")],
        ),
    ]

    def seed_approval_chains(self) -> list[dict]:
        """Approval routing, without which nothing has a chain to picture.

        A submitted request whose amount matches no chain shows "No approval
        steps configured", which is what the detail pages rendered before this.
        """
        chains = items(self.api.get("/finance/approval-chains"), "approval_chains")
        names = {c.get("name") for c in chains}
        for applies_to, name, steps in self.APPROVAL_CHAINS:
            if name in names:
                continue
            chains.append(
                self.api.post(
                    "/finance/approval-chains",
                    {
                        "name": name,
                        "description": f"Default routing for every {applies_to.replace('_', ' ')}.",
                        "applies_to": applies_to,
                        "is_default": True,
                        "steps": [
                            {
                                "step_order": order,
                                "name": step_name,
                                "step_type": "approval",
                                "approver_type": "position",
                                "approver_value": position,
                                "required": True,
                            }
                            for order, step_name, position in steps
                        ],
                    },
                )
            )
        return chains

    def seed_expense_reports(self, finance: dict) -> list[dict]:
        """Reimbursement claims, which the expense report detail pictures."""
        fiscal_year_id = pick(finance.get("fiscal_year") or {}, "id")
        budgets = finance.get("budgets") or []
        if not fiscal_year_id:
            return []
        reports = items(self.api.get("/finance/expense-reports"), "expense_reports")
        if reports:
            return reports

        planned = [
            (
                "FDIC Conference Expenses",
                "Travel and registration for the annual conference.",
                [
                    ("Conference registration", 425.00, "conference", "FDIC"),
                    ("Hotel — 3 nights", 402.00, "travel", "Marriott Indianapolis"),
                    ("Mileage reimbursement", 152.00, "mileage", None),
                ],
            ),
            (
                "Station 2 supply run",
                "Consumables purchased ahead of the open house.",
                [
                    ("Cleaning supplies", 86.40, "equipment_purchase", "Costco"),
                    ("Coffee and refreshments", 54.20, "meals", "Sam's Club"),
                ],
            ),
        ]
        for index, (title, description, lines) in enumerate(planned):
            budget_id = pick(budgets[index % len(budgets)], "id") if budgets else None
            report = self.api.post(
                "/finance/expense-reports",
                {
                    "fiscal_year_id": fiscal_year_id,
                    "title": title,
                    "description": description,
                    "line_items": [
                        {
                            "budget_id": budget_id,
                            "description": line_description,
                            "amount": amount,
                            "date_incurred": iso(NOW - timedelta(days=20 - offset)),
                            "expense_type": expense_type,
                            **({"merchant": merchant} if merchant else {}),
                        }
                        for offset, (
                            line_description,
                            amount,
                            expense_type,
                            merchant,
                        ) in enumerate(lines)
                    ],
                },
            )
            reports.append(report)
            # Submit the first so the detail page shows an approval chain
            # rather than a draft with nothing to approve.
            if index == 0:
                try:
                    self.api.post(
                        f"/finance/expense-reports/{pick(report, 'id')}/submit"
                    )
                except ApiError as exc:
                    if exc.code != 400:
                        raise
                    self.blocked.append(f"expense report submit: {exc}")
        return reports

    def seed_check_requests(self, finance: dict) -> list[dict]:
        """Direct-payment requests, which the check request detail pictures."""
        fiscal_year_id = pick(finance.get("fiscal_year") or {}, "id")
        budgets = finance.get("budgets") or []
        if not fiscal_year_id:
            return []
        requests = items(self.api.get("/finance/check-requests"), "check_requests")
        if requests:
            return requests

        planned = [
            ("ABC Fire Equipment", 2_340.00, "Nozzle and hose replacement"),
            ("Oakville Utilities", 1_186.45, "Station 1 quarterly electricity"),
            ("Tidewater Door Service", 1_840.00, "Station 2 bay door repair"),
        ]
        for index, (payee, amount, purpose) in enumerate(planned):
            budget_id = pick(budgets[index % len(budgets)], "id") if budgets else None
            request = self.api.post(
                "/finance/check-requests",
                {
                    "fiscal_year_id": fiscal_year_id,
                    **({"budget_id": budget_id} if budget_id else {}),
                    "payee_name": payee,
                    "payee_address": "1200 Commerce Way, Oakville, VA 22046",
                    "amount": amount,
                    "memo": purpose,
                    "purpose": purpose,
                },
            )
            requests.append(request)
            if index == 0:
                try:
                    self.api.post(
                        f"/finance/check-requests/{pick(request, 'id')}/submit"
                    )
                except ApiError as exc:
                    if exc.code != 400:
                        raise
                    self.blocked.append(f"check request submit: {exc}")
        return requests

    # -- scheduling: equipment check templates and completed checks --

    def _add_section_header(self, template_id: str | None) -> None:
        """Put one section header on the engine checklist.

        Headers are a documented grouping device — a bold caption inside a
        compartment, with no pass/fail control and no effect on the score — and
        no seeded template had one, so the feature was undocumentable and the
        renderer untested against real data.

        Written as a top-up rather than folded into the create payload above:
        the template is created once and every existing demo database already
        has it, so a header only in the create branch would never appear.
        """
        if not template_id:
            return
        template = self.api.get(f"/equipment-checks/templates/{template_id}")
        cab = next(
            (c for c in items(template, "compartments") if pick(c, "name") == "Cab"),
            None,
        )
        if not cab:
            return
        existing = items(cab, "items")
        # Keyed on check_type, not the `is_header` column. That column is a
        # compartment-level flag; on an item it is write-only — the item
        # response schema does not carry it and the check form switches on
        # `checkType === "header"`.
        if any(pick(i, "check_type", "checkType") == "header" for i in existing):
            return
        header = self.api.post(
            f"/equipment-checks/compartments/{pick(cab, 'id')}/items",
            {
                "name": "Safety Equipment",
                "check_type": "header",
                "is_required": False,
                # Appended, then moved: sort_order is stored verbatim and the
                # three existing items already hold 0, 1 and 2, so there is no
                # gap to insert into without renumbering them anyway.
                "sort_order": len(existing),
            },
        )
        self.api.put(
            f"/equipment-checks/compartments/{pick(cab, 'id')}/items/reorder",
            {"ordered_ids": [pick(header, "id")] + [pick(i, "id") for i in existing]},
        )

    # Genuinely optional kit: carried on some engines, not required to be.
    OPTIONAL_CHECK_ITEMS = [
        "Chock blocks (if carried)",
        "Spare SCBA mask (if carried)",
        "Traffic cones (if carried)",
    ]

    def _add_optional_compartment(self, template_id: str | None) -> None:
        """Give the engine checklist some items that are not required.

        Every checkable item on every seeded template was `is_required`, and
        the submit button is disabled until all required items are answered —
        so `checkedItems < totalItems` was unreachable and the "submit an
        incomplete check?" confirmation could never appear. Section headers do
        not help: the form filters them out of `checkableItems` entirely, so a
        template of nine required items and one header is still 9 of 9.

        A separate compartment rather than optional items mixed into an
        existing one, because the per-compartment "Pass All" answers every item
        it contains — with the optional kit in its own section a crew (or a
        screenshot) can leave exactly that section blank.
        """
        if not template_id:
            return
        template = self.api.get(f"/equipment-checks/templates/{template_id}")
        compartments = items(template, "compartments")
        if any(pick(c, "name") == "As-Carried Kit" for c in compartments):
            return
        created = self.api.post(
            f"/equipment-checks/templates/{template_id}/compartments",
            {"name": "As-Carried Kit", "sort_order": len(compartments)},
        )
        compartment_id = pick(created, "id")
        if not compartment_id:
            return
        for order, name in enumerate(self.OPTIONAL_CHECK_ITEMS):
            self.api.post(
                f"/equipment-checks/compartments/{compartment_id}/items",
                {
                    "name": name,
                    "check_type": "present",
                    "is_required": False,
                    "expected_quantity": 1,
                    "sort_order": order,
                },
            )

    @staticmethod
    def _checkable_rows(detail: dict) -> list[dict]:
        """The submittable rows of a template, in the order the form shows them.

        `header` and `text` rows are layout, not questions: the server refuses
        a submission that answers one ("Items do not belong to template", a 400
        that names the id and nothing else), and it excludes them from the item
        map by check type rather than by position. Three call sites built this
        list independently and only one of them filtered — and only `header` —
        so adding the section header to the demo template took every seeded
        check with it, leaving the fleet grid, the compliance view and the
        phone captures with nothing completed to show.
        """
        rows = []
        for compartment in items(detail, "compartments"):
            for item in items(compartment, "items"):
                if pick(item, "check_type", "checkType") in ("header", "text"):
                    continue
                rows.append(
                    {
                        "template_item_id": pick(item, "id"),
                        "compartment_name": pick(compartment, "name"),
                        "item_name": pick(item, "name"),
                        "status": "pass",
                        "quantity_found": 1,
                        "required_quantity": 1,
                    }
                )
        return rows

    def seed_equipment_checks(self) -> dict[str, Any]:
        """A template plus completed checks, which the reports page aggregates."""
        self._repair_check_types()
        templates = items(self.api.get("/equipment-checks/templates"), "templates")
        # By name, not `templates[0]`. Any other step that creates a template
        # first — `seed_supply_tracking` creates the medic's — would otherwise
        # both suppress this one and become the template every seeded check is
        # submitted against, silently rewriting what the equipment-check
        # screenshots picture.
        engine_daily = next(
            (t for t in templates if pick(t, "name") == "Engine Daily Check"), None
        )
        if engine_daily is None:
            compartments = [
                (
                    "Cab",
                    ["Portable radio", "Thermal imaging camera", "Map book"],
                ),
                (
                    "Compartment 1 — Driver Front",
                    ["Hydraulic rescue tool", "Spare cylinder", "Hand light"],
                ),
                (
                    "Hose Bed",
                    ['1 3/4" attack line', '2 1/2" supply line', "Nozzle"],
                ),
            ]
            engine_daily = self.api.post(
                "/equipment-checks/templates",
                {
                    "name": "Engine Daily Check",
                    "description": "Start-of-shift inventory for engine companies.",
                    "check_timing": "start_of_shift",
                    "apparatus_type": "engine",
                    "is_active": True,
                    "compartments": [
                        {
                            "name": name,
                            "sort_order": order,
                            "items": [
                                {
                                    "name": item,
                                    "sort_order": item_order,
                                    "check_type": "present",
                                    "is_required": True,
                                    "expected_quantity": 1,
                                }
                                for item_order, item in enumerate(contents)
                            ],
                        }
                        for order, (name, contents) in enumerate(compartments)
                    ],
                },
            )
            templates.append(engine_daily)

        self._add_section_header(pick(engine_daily, "id"))
        self._add_optional_compartment(pick(engine_daily, "id"))

        def close_out_template_for(apparatus_type: str) -> dict:
            """Get or create the end-of-shift template for an apparatus type.

            Two reasons this is per-type rather than one shared template.
            `_resolve_templates` matches a template to a shift only by
            `apparatus_id` or `apparatus_type` — there is no "applies to every
            apparatus" form — so a single Engine template leaves the ladder and
            brush shifts with no checklist at all, and the pre-finalization
            modal then omits its equipment row entirely rather than showing the
            green tick or red cross the guides describe. And the check create
            endpoint rejects a second check against a template already used on
            that shift, whatever the timing, so the close-out cannot reuse the
            morning template.
            """
            existing = next(
                (
                    t
                    for t in templates
                    if pick(t, "check_timing", "checkTiming") == "end_of_shift"
                    and pick(t, "apparatus_type", "apparatusType") == apparatus_type
                ),
                None,
            )
            if existing is not None:
                return existing
            created = self.api.post(
                "/equipment-checks/templates",
                {
                    "name": f"{apparatus_type.replace('_', ' ').title()} Close-Out",
                    "description": (
                        "End-of-shift verification before the crew is relieved."
                    ),
                    "check_timing": "end_of_shift",
                    "apparatus_type": apparatus_type,
                    "is_active": True,
                    "compartments": [
                        {
                            "name": "Cab",
                            "sort_order": 0,
                            "items": [
                                {
                                    "name": item,
                                    "sort_order": order,
                                    "check_type": "present",
                                    "is_required": True,
                                    "expected_quantity": 1,
                                }
                                for order, item in enumerate(
                                    ["Portable radio", "Thermal imaging camera"]
                                )
                            ],
                        }
                    ],
                },
            )
            templates.append(created)
            return created

        def apparatus_type_of(shift: dict) -> str | None:
            """The shift's apparatus type, which neither shift payload carries.

            The list and the detail response both stop at the apparatus id and
            name, so the type — the only thing a template matches on — has to
            come from the apparatus record itself.
            """
            detail = self.api.get(f"/scheduling/shifts/{pick(shift, 'id')}")
            apparatus_id = pick(detail, "apparatus_id", "apparatusId")
            if not apparatus_id:
                return None
            try:
                apparatus = self.api.get(f"/apparatus/{apparatus_id}")
            except ApiError:
                return None
            # `apparatusType` is the joined type *record*, not the slug a
            # template matches on — its `code` is what `_resolve_templates`
            # compares against.
            type_record = pick(apparatus, "apparatus_type", "apparatusType")
            if isinstance(type_record, dict):
                return pick(type_record, "code", "default_type", "defaultType")
            return type_record if isinstance(type_record, str) else None

        template = engine_daily
        template_id = pick(template, "id")
        if not template_id:
            return {"templates": templates, "checks": []}

        # Checks belong to a shift — there is no module-level collection to list
        # or post to, so both the idempotency check and the create go through
        # the shift the crew would actually have been working.
        #
        # Engine shifts only: the template is type-scoped to engines and the
        # API rightly refuses it anywhere else ("Template is not applicable to
        # this shift"). Taking the first three shifts regardless of apparatus
        # happened to work while the demo database returned engines first, and
        # crashed the whole step the first time a fresh seed ordered a medic
        # or ladder shift into the front of the list.
        shifts = items(self.api.get("/scheduling/shifts?limit=20"), "shifts")
        target_shifts = [
            s for s in shifts if pick(s, "id") and apparatus_type_of(s) == "engine"
        ][:3]
        if not target_shifts:
            return {"templates": templates, "checks": []}
        checks = []
        existing_by_shift: dict[str, set] = {}
        for shift in target_shifts:
            found = items(
                self.api.get(f"/equipment-checks/shifts/{pick(shift, 'id')}/checks"),
                "checks",
            )
            checks.extend(found)
            existing_by_shift[str(pick(shift, "id"))] = {
                pick(c, "check_timing", "checkTiming") for c in found
            }
        # Keyed on the *timings* present, not on whether any check exists. A
        # bare truthiness guard meant a database seeded before end-of-shift
        # checks were added here never grew them, and the pre-finalization
        # checklist's equipment row stayed absent through every re-seed.
        # Before the early return below, not after it: on a database that has
        # already been seeded this function returns here, so anything appended
        # to the end never runs again.
        self._seed_member_checklist_states(template_id)

        if all(
            {"start_of_shift", "end_of_shift"} <= timings
            for timings in existing_by_shift.values()
        ):
            return {"templates": templates, "checks": checks}

        # The template response carries the ids the check has to reference, so
        # the submitted items are read back off it rather than reconstructed.
        detail = self.api.get(f"/equipment-checks/templates/{template_id}")
        submitted = self._checkable_rows(detail)
        if not submitted:
            return {"templates": templates, "checks": checks}

        # One deficiency across the set, so the compliance view has something
        # other than a wall of green to show — but only one, so it does not read
        # as a fleet-wide failure. This previously mutated the shared item list
        # before the loop, which applied the deficiency to *every* check and left
        # the compliance dashboard reporting a 0% pass rate.
        def items_for(index: int) -> list[dict]:
            rows = [dict(row) for row in submitted]
            if index == len(target_shifts) - 1:
                rows[-1]["status"] = "fail"
                rows[-1]["quantity_found"] = 0
            return rows

        for shift_index, shift in enumerate(target_shifts):
            # This used to swallow a 500 and record a blocker: submitting a check
            # for any shift with an apparatus assigned failed the FK constraint
            # on `shift_equipment_checks.apparatus_id`. Fixed 2026-08-08 by
            # resolving the shift's polymorphic apparatus reference (see
            # app/utils/apparatus_ref.py), so the failure is no longer expected
            # and is deliberately left to raise — a silent skip here is how the
            # equipment-check screenshots went unfilled for two days without
            # anyone noticing the feature was broken.
            shift_items = items_for(shift_index)
            already = existing_by_shift.get(str(pick(shift, "id")), set())
            if "start_of_shift" not in already:
                check = self.api.post(
                    f"/equipment-checks/shifts/{pick(shift, 'id')}/checks",
                    {
                        "template_id": template_id,
                        "check_timing": "start_of_shift",
                        "items": shift_items,
                    },
                )
                checks.append(check)
                # A check only counts toward the compliance report once
                # completed.
                check_id = pick(check, "id")
                if check_id:
                    try:
                        self.api.put(
                            f"/equipment-checks/checks/{check_id}/complete",
                            {"items": shift_items},
                        )
                    except ApiError as exc:
                        if exc.code not in (400, 409):
                            raise
            if "end_of_shift" in already:
                continue

            # An end-of-shift check as well as the start-of-shift one. The
            # pre-finalization checklist's equipment row — the green tick or the
            # red cross the guides describe — is rendered only when the shift
            # has end-of-shift checks to report on; with none, the row is absent
            # altogether and the modal says nothing about equipment either way.
            shift_type = apparatus_type_of(shift)
            if not shift_type:
                continue
            end_template_id = pick(close_out_template_for(shift_type), "id")
            if not end_template_id:
                continue
            end_detail = self.api.get(f"/equipment-checks/templates/{end_template_id}")
            end_items = self._checkable_rows(end_detail)
            end_check = self.api.post(
                f"/equipment-checks/shifts/{pick(shift, 'id')}/checks",
                {
                    "template_id": end_template_id,
                    "check_timing": "end_of_shift",
                    "items": end_items,
                },
            )
            checks.append(end_check)
            end_id = pick(end_check, "id")
            # The last one is left outstanding on purpose: the red "checks
            # incomplete" state has to be reachable too, and a department where
            # every check is always complete cannot picture it.
            if end_id and shift_index < len(target_shifts) - 1:
                try:
                    self.api.put(
                        f"/equipment-checks/checks/{end_id}/complete",
                        {"items": end_items},
                    )
                except ApiError as exc:
                    if exc.code not in (400, 409):
                        raise
        return {"templates": templates, "checks": checks}

    def _seed_member_checklist_states(self, template_id: str | None) -> None:
        """Leave the demo member one finished check and one part-answered.

        "My Equipment Checklists" is built from the member's own upcoming shift
        assignments, and offers **Resume** only for a check whose status is
        `in_progress` or `incomplete` with fewer items answered than it has.
        Every seeded check was submitted and then completed, so every row read
        either Not Started or done, and the Resume path could not be shown.

        Submitted **as the member**, not as the admin running the seeder:
        `complete_incomplete_check` only lets the original checker finish a
        check unless the caller holds `equipment_check.manage`, so a check
        started by the chief would give the member a Resume button that refuses
        them.

        A check is left incomplete simply by not calling `/complete` on it —
        the status falls out of `completed < total` server-side.
        """
        if not template_id:
            return
        member = Api(self.base_url)
        member.login_as(DEMO_MEMBER_USERNAME, DEMO_MEMBER_PASSWORD)

        shifts = [
            s
            for s in items(member.get("/scheduling/my-shifts?limit=50"), "shifts")
            if pick(s, "id")
            and str(pick(s, "shift_date", "shiftDate") or "") >= str(TODAY)
        ]
        shifts.sort(key=lambda s: str(pick(s, "shift_date", "shiftDate") or ""))

        # Idempotent on the state, not on the shift: once one part-answered
        # check exists there is nothing to add, and re-running must not keep
        # minting a fresh completed check on the next free shift each time.
        existing = items(member.get("/equipment-checks/my-checklists"), "checklists")
        if any(
            str(pick(c, "status") or "") in {"in_progress", "incomplete"}
            for c in existing
        ):
            return

        untouched = [
            s
            for s in shifts
            if not items(
                member.get(f"/equipment-checks/shifts/{pick(s, 'id')}/checks"),
                "checks",
            )
        ]
        if len(untouched) < 2:
            return

        detail = self.api.get(f"/equipment-checks/templates/{template_id}")
        rows = self._checkable_rows(detail)
        if not rows:
            return

        # The optional As-Carried Kit left unanswered, which is what a crew
        # interrupted mid-check actually leaves behind. The server derives
        # `incomplete` from completed < total, so simply not calling /complete
        # afterwards is the whole trick — and submitting every item lands the
        # other check as `pass` with no follow-up needed (completing an already
        # complete check is refused).
        # The quantity keys are dropped, not zeroed: the server rewrites any
        # item whose quantity_found is below required_quantity to `fail`, so
        # sending 0 turned these into answered-and-failed and the check came
        # back complete — the opposite of what is wanted.
        part_rows = [
            (
                {
                    key: value
                    for key, value in row.items()
                    if key not in {"quantity_found", "required_quantity"}
                }
                | {"status": "not_checked"}
                if row["compartment_name"] == "As-Carried Kit"
                else row
            )
            for row in rows
        ]

        # Tried against each free shift in turn rather than the first two: this
        # template is engine-only, and a shift on any other apparatus is
        # refused with "Template is not applicable to this shift".
        wanted = [rows, part_rows]
        for shift in untouched:
            if not wanted:
                break
            try:
                member.post(
                    f"/equipment-checks/shifts/{pick(shift, 'id')}/checks",
                    {
                        "template_id": template_id,
                        "check_timing": "start_of_shift",
                        "items": wanted[0],
                    },
                )
            except ApiError as exc:
                if exc.code == 400:
                    continue
                self.blocked.append(f"member checklist states: {exc}")
                return
            wanted.pop(0)
        if wanted:
            self.blocked.append(
                "member checklist states: no engine shift free for a "
                "part-answered check"
            )

    # -- scheduling: count-only call tracking ------------------------

    # The unit the close-out wizard captures are shot against.
    #
    # Deliberately NOT an Engine. `03-45-finalize-checklist` reaches for the
    # newest un-finalized `/^Engine/` shift, and equipment-check templates
    # resolve by apparatus type, so putting this fixture on an engine would let
    # the two shots race for the same shift and quietly swap which screen each
    # one photographed.
    CLOSEOUT_UNIT_HINT = "Medic"

    # A full 24-hour tour, four crew. Both numbers are load-bearing for the
    # screenshots, not decoration: the wizard's step 1 shows *combined* hours
    # summed across the crew, and the guide's whole point is that ~96 hours on a
    # 24-hour shift is not a bug. A 12-hour shift with two people reads as 24
    # and teaches nothing.
    CLOSEOUT_CREW_SIZE = 4
    CLOSEOUT_DAYS_AGO = 4

    def seed_call_tracking_closeout(self, members: list[dict]) -> dict | None:
        """A past 24-hour shift set up for the close-out wizard captures.

        Six screenshot markers in guide 03 need a state no other seeded shift
        provides, and they need it *simultaneously* — the wizard shows the whole
        crew on one screen, so the interesting rows cannot be spread across
        different shifts the way most fixtures are.

        What this builds, and why each part is required by a specific shot:

        * **A 24-hour tour with four crew.** Step 1 reports *combined* hours,
          summed across everyone, which lands near 96. The guide teaches that
          this is not the shift's length, and a fixture that produced a
          plausible-looking 24 would make the caption read as a mistake.
        * **One member with no check-out.** Step 1 flags them. Without one the
          `missing_checkout` styling is never photographed.
        * **One assigned member with no attendance row at all.** They are listed
          with empty times to fill in. This is the regression the close-out
          review found — such members used to be invisible, so the shot is the
          evidence that they are not.
        * **The department's call types**, so step 2 has named rows rather than
          the built-in fallback. Written explicitly so a future change to
          ``DEFAULT_CALL_TYPES`` cannot silently re-shoot a different list.

        **The mode is deliberately left at ``detailed``.** Flipping the whole
        demo department to ``count_only`` here would replace the finalize
        checklist everywhere and break `03-45-finalize-checklist`, which
        photographs precisely the screen that mode removes. Each capture that
        needs count-only sets it in its own ``prepare`` step and each capture
        that needs the checklist sets it back — the same self-healing pattern
        capture.mjs already uses for ``navigationLayout``, and for the same
        reason: a shot must not depend on what ran before it.
        """
        self._seed_call_types()
        return self._seed_closeout_shift(members)

    def _seed_call_types(self) -> None:
        """Give the org an explicit call-type list.

        ``get_call_tracking_settings`` degrades to a built-in list when the org
        has none, so step 2 of the wizard would render either way — but it would
        render whatever that default happens to be on the day. Writing the list
        pins the screenshot to something this file controls.

        Sent with ``mode`` set to the value already in effect. The payload
        replaces the whole ``call_tracking`` object, so omitting the mode would
        reset a department that had deliberately enabled count-only.
        """
        settings = self.api.get("/scheduling/settings") or {}
        tracking = settings.get("call_tracking") or {}
        if tracking.get("call_types"):
            return
        try:
            self.api.put(
                "/scheduling/settings",
                {
                    "call_tracking": {
                        "mode": tracking.get("mode") or "detailed",
                        "call_types": [
                            {"slug": "fire", "label": "Fire"},
                            {"slug": "ems", "label": "EMS"},
                            {"slug": "mva", "label": "Motor Vehicle Accident"},
                            {"slug": "rescue", "label": "Rescue"},
                            {"slug": "hazmat", "label": "Hazmat"},
                            {"slug": "service", "label": "Service Call"},
                            {"slug": "alarm", "label": "Alarm / Good Intent"},
                            {"slug": "mutual_aid", "label": "Mutual Aid"},
                            {"slug": "other", "label": "Other"},
                        ],
                    }
                },
            )
        except ApiError as exc:
            self.blocked.append(f"call types: {exc}")

    def _seed_closeout_shift(self, members: list[dict]) -> dict | None:
        """Create (or find) the 24-hour four-person shift and stage its crew."""
        unit = self._closeout_apparatus()
        if not unit:
            self.blocked.append(
                "close-out fixture: no non-engine apparatus to hang it on"
            )
            return None
        # Before the early return, not after it: on a database that already has
        # the fixture this function stops here, and the template the wizard's
        # outstanding-checks warning depends on would never be created.
        self._ensure_closeout_check_template(unit)

        existing = self._find_closeout_shift()
        if existing:
            return existing

        shift_day = TODAY - timedelta(days=self.CLOSEOUT_DAYS_AGO)
        start_at = datetime.combine(
            shift_day, time(hour=7), tzinfo=ORG_TIMEZONE
        ).astimezone(timezone.utc)
        # +1 day, 07:00 → a true 24-hour tour rather than 23 or 25. The wizard's
        # combined-hours figure is read off this directly.
        end_at = datetime.combine(
            shift_day + timedelta(days=1), time(hour=7), tzinfo=ORG_TIMEZONE
        ).astimezone(timezone.utc)

        payload = {
            "shift_date": str(shift_day),
            "start_time": iso(start_at),
            "end_time": iso(end_at),
            "apparatus_id": pick(unit, "id"),
            "min_staffing": self.CLOSEOUT_CREW_SIZE,
            "positions": SHIFT_POSITIONS[: self.CLOSEOUT_CREW_SIZE],
            "notes": CLOSEOUT_SHIFT_NOTE,
        }
        try:
            shift = self.api.post("/scheduling/shifts", payload)
        except ApiError as exc:
            self.blocked.append(f"close-out fixture: create shift: {exc}")
            return None

        shift_id = pick(shift, "id")
        crew = self._crew_the_closeout_shift(shift_id, members)
        if crew:
            self._stage_closeout_attendance(shift_id, crew, start_at, end_at)
        return shift

    def _ensure_closeout_check_template(self, unit: dict) -> None:
        """An end-of-shift template for the fixture's own apparatus.

        The wizard's outstanding-checks warning — the override box and the
        reason it demands — renders only when the shift has an end-of-shift
        checklist nobody has completed. The general equipment-check seed builds
        close-out templates by apparatus *type*, and only for the types it
        happens to iterate; the fixture hangs on the Medic, which had none.

        Written against the apparatus rather than its type, and that is not
        interchangeable here. `_resolve_templates` falls back to type-level
        templates **only when the unit has no apparatus-specific ones**, and
        the Medic already carries `Medic 3 Supply Check`. A type-level
        `ambulance` close-out is therefore created successfully, listed in the
        template library, and never resolved for the one shift it exists for —
        a fixture that looks correct in every place except the screen it was
        built for.
        """
        apparatus_id = str(pick(unit, "id") or "")
        if not apparatus_id:
            self.blocked.append("close-out fixture: apparatus carries no id")
            return
        templates = items(self.api.get("/equipment-checks/templates"), "templates")
        if any(
            pick(t, "check_timing", "checkTiming") == "end_of_shift"
            and str(pick(t, "apparatus_id", "apparatusId") or "") == apparatus_id
            for t in templates
        ):
            return
        label = str(pick(unit, "name") or "Unit")
        self.api.post(
            "/equipment-checks/templates",
            {
                "name": f"{label} Close-Out",
                "description": (
                    "End-of-shift verification before the crew is relieved."
                ),
                "check_timing": "end_of_shift",
                "apparatus_id": apparatus_id,
                "is_active": True,
                "compartments": [
                    {
                        "name": "Patient Compartment",
                        "sort_order": 0,
                        "items": [
                            {
                                "name": name,
                                "sort_order": order,
                                "check_type": "present",
                                "is_required": True,
                                "expected_quantity": 1,
                            }
                            for order, name in enumerate(
                                [
                                    "Monitor / defibrillator",
                                    "Drug bag seal",
                                    "Stretcher",
                                ]
                            )
                        ],
                    }
                ],
            },
        )

    def _find_closeout_shift(self) -> dict | None:
        """The fixture from a previous run, if it is still usable.

        Matched on the note rather than on date or apparatus: the seeder is
        re-run against a database it has already populated, and a shift matched
        by shape alone would collide with the ordinary schedule.
        """
        shifts = items(self.api.get("/scheduling/shifts?limit=200"), "shifts")
        for shift in shifts:
            if str(pick(shift, "notes") or "").strip() != CLOSEOUT_SHIFT_NOTE:
                continue
            # A finalized fixture is spent — the wizard will not open on it, and
            # reopening here would fight seed_finalized_shift for the same row.
            if pick(shift, "is_finalized", "isFinalized"):
                self.blocked.append(
                    "close-out fixture: the seeded shift is already finalized; "
                    "reopen it or clear the demo database before re-capturing"
                )
                return None
            return shift
        return None

    def _closeout_apparatus(self) -> dict | None:
        """Pick a unit that no engine-specific shot is competing for.

        Reads ``/scheduling/apparatus-options``, the same endpoint the rest of
        the scheduling seed assigns shifts from. ``/scheduling/apparatus`` is a
        different resource — the scheduling module's own ``basic_apparatus``
        table — which this demo never populates, so it answered ``[]`` and the
        fixture reported "no non-engine apparatus to hang it on" against a
        seven-unit fleet that plainly included the Medic the hint asks for.
        """
        fleet = items(
            self.api.get("/scheduling/apparatus-options"), "options", "apparatus"
        )
        preferred = [
            unit
            for unit in fleet
            if self.CLOSEOUT_UNIT_HINT.lower() in str(pick(unit, "name") or "").lower()
        ]
        non_engine = [
            unit
            for unit in fleet
            if not str(pick(unit, "name") or "").lower().startswith("engine")
        ]
        for candidate in (preferred, non_engine, fleet):
            if candidate:
                return candidate[0]
        return None

    def _crew_the_closeout_shift(
        self, shift_id: str | None, members: list[dict]
    ) -> list[str]:
        """Seat four members, skipping anyone already on duty that day."""
        if not shift_id:
            return []
        seated: list[str] = []
        seats = SHIFT_POSITIONS[: self.CLOSEOUT_CREW_SIZE]
        for user_id in (pick(m, "id") for m in members):
            if not user_id or len(seated) >= self.CLOSEOUT_CREW_SIZE:
                continue
            try:
                self.api.post(
                    f"/scheduling/shifts/{shift_id}/assignments",
                    {"user_id": user_id, "position": seats[len(seated)]},
                )
            except ApiError as exc:
                # Already rostered elsewhere that day, or not cleared to
                # drive this rig. The ordinary schedule books most of the
                # department, so this is the common case rather than an error
                # — move to the next member.
                if not is_expected_seat_refusal(exc):
                    raise
                continue
            seated.append(user_id)
        if len(seated) < self.CLOSEOUT_CREW_SIZE:
            self.blocked.append(
                f"close-out fixture: seated {len(seated)} of "
                f"{self.CLOSEOUT_CREW_SIZE} — the combined-hours figure the "
                "guide captions will not read as ~96"
            )
        return seated

    def _stage_closeout_attendance(
        self,
        shift_id: str,
        crew: list[str],
        start_at: datetime,
        end_at: datetime,
    ) -> None:
        """Check the crew in, leaving two rows deliberately incomplete.

        The last member gets **no attendance row at all**, and the one before
        them gets a check-in with **no check-out**. Both are states the wizard
        renders specially and neither occurs anywhere else in the demo data,
        because `_seed_shift_attendance` checks every past crew fully in and
        out — which is right for every other shift and useless for this one.
        """
        # Left with no row on purpose; the wizard lists them with empty times.
        never_checked_in = crew[-1] if len(crew) >= 2 else None
        # Checked in, never out.
        no_checkout = crew[-2] if len(crew) >= 3 else None

        for index, user_id in enumerate(crew):
            if user_id == never_checked_in:
                continue
            body: dict[str, Any] = {
                "user_id": user_id,
                # Staggered so the durations are not identical to the minute,
                # which reads as generated data in a screenshot.
                "checked_in_at": iso(start_at + timedelta(minutes=index * 4)),
            }
            if user_id != no_checkout:
                body["checked_out_at"] = iso(
                    end_at - timedelta(minutes=(index % 3) * 6)
                )
            try:
                self.api.post(f"/scheduling/shifts/{shift_id}/attendance", body)
            except ApiError as exc:
                if exc.code not in (400, 409):
                    raise
                self.blocked.append(f"close-out fixture attendance: {exc}")

    # -- shift finalization ------------------------------------------

    def seed_finalized_shift(self) -> dict | None:
        """Close out one past shift, and leave the rest open.

        Finalizing is a one-way door in the UI (a finalized shift hides its
        Finalize button and locks attendance), so the two states the guides
        picture — the pre-finalization checklist and the finalized badge —
        cannot come from the same shift. One is closed here; the other 70-odd
        past shifts stay open for the checklist shot.

        The oldest past shift is the one chosen. A closed shift stops offering
        the roster edits and the Finalize control, so taking the most recent
        one would quietly strip those from every other shift-detail screenshot,
        which all reach for the newest shift they can find.
        """
        shifts = items(self.api.get("/scheduling/shifts?limit=200"), "shifts")
        if any(pick(s, "is_finalized", "isFinalized") for s in shifts):
            return next(s for s in shifts if pick(s, "is_finalized", "isFinalized"))

        past = sorted(
            (
                s
                for s in shifts
                if pick(s, "id")
                and str(pick(s, "shift_date", "shiftDate") or "") < str(TODAY)
                and not pick(s, "is_cancelled", "isCancelled")
            ),
            key=lambda s: str(pick(s, "shift_date", "shiftDate")),
        )
        for shift in past:
            crew = items(
                self.api.get(f"/scheduling/shifts/{pick(shift, 'id')}/assignments"),
                "assignments",
            )
            if not crew:
                continue
            try:
                return self.api.post(
                    f"/scheduling/shifts/{pick(shift, 'id')}/finalize",
                    {
                        "override_incomplete_checks": True,
                        "pass_down_notes": (
                            "Engine 1 due for a pump service — booked for "
                            "Thursday. Hydrant at Oak and 3rd still out of "
                            "service, city notified."
                        ),
                    },
                )
            except ApiError as exc:
                self.blocked.append(f"finalize shift: {exc}")
                return None
        self.blocked.append("finalize shift: no crewed past shift to close out")
        return None

    # -- shift completion reports ------------------------------------

    def _name_on_run_log(
        self,
        shift_id: str,
        shift_date: str,
        trainee_id: str,
        count: int = 1,
    ) -> list[dict]:
        """Make the shift's run log name this trainee, and return their calls.

        A report's call count is not taken from the create payload — the
        service derives it by counting the calls whose `responding_members`
        includes the trainee. Runs seeded without a crew therefore leave every
        report reading "0 calls" and the analytics card at a total of zero.
        """
        calls = items(self.api.get(f"/scheduling/shifts/{shift_id}/calls"), "calls")
        mine = [
            c
            for c in calls
            if trainee_id in [str(m) for m in (c.get("responding_members") or [])]
        ]
        if len(mine) >= count:
            return mine
        # Tops up to `count` rather than returning at the first match, so a
        # re-run can widen a log it previously seeded one call into.
        spare = [c for c in calls if c not in mine][: count - len(mine)]
        if spare:
            for call in spare:
                riders = [str(m) for m in (call.get("responding_members") or [])]
                self.api.patch(
                    f"/scheduling/calls/{pick(call, 'id')}",
                    {"responding_members": sorted(set(riders + [trainee_id]))},
                )
            return mine + spare
        runs = [
            ("EMS — Fall Victim", "Lift assist, no transport."),
            ("Automatic Fire Alarm", "Steam from a shower, no incident."),
            ("Motor Vehicle Collision", "Two vehicles, no extrication."),
        ]
        logged = list(mine)
        for offset in range(count - len(mine)):
            incident_type, notes = runs[offset % len(runs)]
            dispatched = datetime.combine(
                date.fromisoformat(shift_date),
                time(hour=10 + offset * 3),
                tzinfo=ORG_TIMEZONE,
            ).astimezone(timezone.utc)
            logged.append(
                self.api.post(
                    f"/scheduling/shifts/{shift_id}/calls",
                    {
                        "incident_type": incident_type,
                        "dispatched_at": iso(dispatched),
                        "on_scene_at": iso(dispatched + timedelta(minutes=5)),
                        "cleared_at": iso(dispatched + timedelta(hours=1)),
                        "notes": notes,
                        "responding_members": [trainee_id],
                    },
                )
            )
        return logged

    def seed_scheduling_requests(self) -> None:
        """A pending swap and a pending time-off request for the Requests tab.

        The tab renders both tables, and the long-lived demo database showed
        rows in them only as leftovers of old manual runs — nothing seeded
        either, so a fresh database rendered two empty states under a caption
        describing populated tables.
        """
        swaps = items(
            self.api.get("/scheduling/swap-requests"), "requests", "swap_requests"
        )
        time_off = items(self.api.get("/scheduling/time-off"), "requests", "time_off")
        member = Api(self.base_url)
        member.login_as(DEMO_MEMBER_USERNAME, DEMO_MEMBER_PASSWORD)
        if not swaps:
            upcoming = [
                s
                for s in items(member.get("/scheduling/my-shifts?limit=50"), "shifts")
                if pick(s, "id")
                and str(pick(s, "shift_date", "shiftDate") or "") > str(TODAY)
            ]
            upcoming.sort(key=lambda s: str(pick(s, "shift_date", "shiftDate") or ""))
            if upcoming:
                # The furthest-out assignment, so the member's first upcoming
                # card — the one the swap-dialog screenshot opens — keeps its
                # plain Swap button rather than a pending-swap state.
                member.post(
                    "/scheduling/swap-requests",
                    {
                        "offering_shift_id": pick(upcoming[-1], "id"),
                        "reason": (
                            "Family commitment that evening — happy to take "
                            "any weekday shift in trade."
                        ),
                    },
                )
            else:
                self.blocked.append(
                    "scheduling requests: member has no upcoming shift to offer"
                )
        if not time_off:
            member.post(
                "/scheduling/time-off",
                {
                    "start_date": str(TODAY + timedelta(days=18)),
                    "end_date": str(TODAY + timedelta(days=21)),
                    "reason": "Out of town for a family wedding.",
                },
            )

        # The dashboard's Next 7 Days list shows only its first handful of
        # rows, chronologically. The rotation can park the demo member's next
        # shift days out, which pushes every "Yours" row below the cut — and
        # 03-60 pictures that pill. Seat them on one of the window's first
        # shifts when nothing already does.
        mine = items(member.get("/scheduling/my-shifts?limit=50"), "shifts")
        soon = str(TODAY + timedelta(days=1))
        if not any(
            str(TODAY) <= str(pick(s, "shift_date", "shiftDate") or "") <= soon
            for s in mine
        ):
            member_id = next(
                (
                    str(pick(m, "id"))
                    for m in items(self.api.get("/users?limit=100"), "users")
                    if pick(m, "username") == DEMO_MEMBER_USERNAME
                ),
                "",
            )
            shifts = items(self.api.get("/scheduling/shifts?limit=200"), "shifts")
            near = sorted(
                (
                    s
                    for s in shifts
                    if pick(s, "id")
                    and str(TODAY)
                    <= str(pick(s, "shift_date", "shiftDate") or "")
                    <= soon
                ),
                key=lambda s: str(pick(s, "start_time", "startTime") or ""),
            )
            for shift in near:
                try:
                    self.api.post(
                        f"/scheduling/shifts/{pick(shift, 'id')}/assignments",
                        {"user_id": member_id, "position": "firefighter"},
                    )
                    break
                except ApiError as exc:
                    if exc.code not in (400, 409):
                        raise
            else:
                self.blocked.append(
                    "scheduling requests: no near-term seat for the demo member"
                )

        self._seed_own_swap_request()
        self._seed_time_off_history()

    def _seed_own_swap_request(self) -> None:
        """A pending swap raised by the administrator itself.

        Separation of duties is a rule about people, not permissions: the
        requester cannot review their own swap even holding
        ``scheduling.manage``. Photographing that refusal needs the capturing
        account to be the requester, so the Requests tab has to hold one row
        the administrator raised alongside one somebody else raised — the two
        rows then differ visibly (the administrator's own carries the cancel
        control instead of a reviewable state) and pressing Approve on it
        returns the server's refusal.
        """
        me = self.api.get("/auth/me") or {}
        admin_id = str(pick(me, "id") or pick(me.get("user") or {}, "id") or "")
        mine = [
            r
            for r in items(
                self.api.get("/scheduling/swap-requests?limit=100"),
                "requests",
                "swap_requests",
            )
            if str(pick(r, "requesting_user_id", "requestingUserId") or "") == admin_id
        ]
        if mine:
            return
        upcoming = sorted(
            (
                s
                for s in items(self.api.get("/scheduling/my-shifts?limit=50"), "shifts")
                if pick(s, "id")
                and str(pick(s, "shift_date", "shiftDate") or "") > str(TODAY)
            ),
            key=lambda s: str(pick(s, "shift_date", "shiftDate") or ""),
        )
        if not upcoming:
            self.blocked.append(
                "scheduling requests: administrator has no upcoming shift to offer"
            )
            return
        self.api.post(
            "/scheduling/swap-requests",
            {
                "offering_shift_id": pick(upcoming[-1], "id"),
                "reason": (
                    "Chiefs' association meeting runs long that night — "
                    "looking for cover on the back half."
                ),
            },
        )

    #: Time-off history is dated before this, and every seeded shift falls on
    #: or after it. Approving time-off cancels any shift assignment inside its
    #: range, so a history that overlapped the roster would silently unseat
    #: members from shifts other guides photograph. Keeping the history behind
    #: the roster is what makes approvals safe to seed at all.
    TIME_OFF_HISTORY_END = TODAY - timedelta(days=14)

    #: Twenty is the Requests tab's page size (``REQUESTS_PAGE_SIZE`` in
    #: ``RequestsTab.tsx``). The Load more control renders only while fewer
    #: rows are loaded than the reported total, so a history shorter than this
    #: leaves nothing to photograph.
    TIME_OFF_HISTORY_MIN = 26

    TIME_OFF_HISTORY = [
        ("Two days for my brother's wedding out of state.", "approved", ""),
        (
            "Annual family holiday — booked before the rotation went out.",
            "approved",
            "",
        ),
        (
            "Elective surgery with a short recovery; cleared to return after.",
            "approved",
            "Get the return-to-duty note to the training office.",
        ),
        (
            "Deer season opener with my father, same week every year.",
            "denied",
            "Three others already off that week — coverage would drop below "
            "minimum staffing.",
        ),
        ("Moving house, need the truck and a day either side.", "approved", ""),
        (
            "College graduation for my daughter.",
            "approved",
            "Enjoy it — congratulations to her.",
        ),
        (
            "Cruise with my wife for our anniversary.",
            "approved",
            "",
        ),
        (
            "Long weekend for a wedding I am standing up in.",
            "denied",
            "Holiday weekend and we are already one short. Resubmit if "
            "somebody picks up the Saturday.",
        ),
        ("Jury duty summons — county court, unknown length.", "approved", ""),
        (
            "Father-in-law's funeral, travelling to Ohio.",
            "approved",
            "Take whatever else you need.",
        ),
        ("Kids' school break, taking them camping.", "approved", ""),
        (
            "Fishing trip that has been on the calendar since January.",
            "denied",
            "Same week as the county-wide drill. Any other week is fine.",
        ),
        ("Certification course at the state academy.", "approved", ""),
    ]

    def _seed_time_off_history(self) -> None:
        """A year of resolved time-off requests behind the two pending ones.

        The Requests tab pages at twenty rows, and the control that fetches the
        next page appears only when there is one — so the guide's pagination
        marker cannot be filled from a department with two requests in it. A
        real department accumulates this history in months; the demo database
        was simply new.

        Requests are dated behind the roster (see ``TIME_OFF_HISTORY_END``) and
        raised by members other than the demo member, whose notification inbox
        several shots photograph in a known state.
        """
        existing = self.api.get("/scheduling/time-off?limit=100") or {}
        if int(pick(existing, "total") or 0) >= self.TIME_OFF_HISTORY_MIN:
            return
        members = [
            m
            for m in items(self.api.get("/users?limit=200"), "users")
            if pick(m, "username")
            not in (
                DEMO_ADMIN_USERNAME,
                DEMO_MEMBER_USERNAME,
                TWO_FACTOR_USERNAME,
            )
            and pick(m, "id")
        ]
        if not members:
            self.blocked.append("time-off history: no members to raise requests")
            return
        start = self.TIME_OFF_HISTORY_END
        raised = 0
        for index in range(self.TIME_OFF_HISTORY_MIN):
            reason, verdict, note = self.TIME_OFF_HISTORY[
                index % len(self.TIME_OFF_HISTORY)
            ]
            member = members[index % len(members)]
            session = self.member_session(
                self.base_url, str(pick(member, "id")), str(pick(member, "username"))
            )
            # Ten summer weeks, which is both when leave requests actually
            # pile up and recent enough that the card's year-less "Jun 14 -
            # Jun 16" reads as this year rather than next.
            first = start - timedelta(days=3 * index + 3)
            last = first + timedelta(days=index % 4)
            try:
                created = session.post(
                    "/scheduling/time-off",
                    {
                        "start_date": str(first),
                        "end_date": str(last),
                        "reason": reason,
                    },
                )
            except ApiError as exc:
                self.blocked.append(f"time-off history: create refused ({exc})")
                return
            request_id = pick(created or {}, "id")
            if not request_id:
                continue
            raised += 1
            try:
                self.api.post(
                    f"/scheduling/time-off/{request_id}/review",
                    {
                        "status": verdict,
                        **({"reviewer_notes": note} if note else {}),
                    },
                )
            except ApiError as exc:
                self.blocked.append(f"time-off history: review refused ({exc})")
                return
        if raised < self.TIME_OFF_HISTORY_MIN:
            self.blocked.append(
                f"time-off history: {raised} of {self.TIME_OFF_HISTORY_MIN} raised"
            )

    def seed_shift_reports(self, members: list[dict]) -> list[dict]:
        """Filed, draft, pending-review and flagged shift completion reports.

        Every view of the Shift Reports tab reads the same collection, so
        without these the tab shows one empty state for all six views and
        `officer-analytics` returns zeros for the summary cards. The four
        review states have to be reached by different routes: `save_as_draft`
        on create is the only way to make a draft, `pending_review` is where a
        create lands once review is required, and `approved` and `flagged` both
        come from the review endpoint — which is also what writes the reviewer
        note the flagged card displays.

        `report_review_required` is switched on first because the Review Queue
        and Flagged buttons are rendered only under that flag — with review off
        a report can still *be* flagged (the review endpoint does not consult
        the flag) but no view in the tab lists it.
        """
        self.api.put(
            "/training/module-config/config",
            {
                "report_review_required": True,
                # Off by default, and the two Export buttons on a member's own
                # training overview render only under it — the guide documents
                # them, so the demo department is one that has turned member
                # self-export on.
                "allow_member_report_export": True,
                # The department's own shift-report vocabulary. Every one of
                # these was NULL, so the report form ran entirely on the
                # frontend's built-in samples — which look identical to a
                # configured department until you notice that the per-apparatus
                # mappings are what the "+ Add" task pre-fill reads. With
                # `apparatus_type_tasks` unset it appends a blank row on every
                # rig, and the guide's whole "Task Defaults Pre-Population"
                # section describes something that cannot happen.
                "rating_scale_labels": RATING_SCALE_LABELS,
                "shift_review_call_types": SHIFT_REVIEW_CALL_TYPES,
                "shift_review_default_skills": SHIFT_REVIEW_SKILLS,
                "shift_review_default_tasks": SHIFT_REVIEW_TASKS,
                "apparatus_type_skills": APPARATUS_TYPE_SKILLS,
                "apparatus_type_tasks": APPARATUS_TYPE_TASKS,
            },
        )

        # Checked against the *states* present, not merely "are there any". A
        # run that dies partway leaves a handful of approved reports behind,
        # and a bare truthiness guard then treats that wreckage as done — which
        # is how the Review Queue and Flagged views stayed empty through a
        # re-seed that reported success.
        existing = items(self.api.get("/training/shift-reports/all?limit=50"))

        demo_member_id = str(
            pick(
                next(
                    (m for m in members if pick(m, "username") == DEMO_MEMBER_USERNAME),
                    {},
                ),
                "id",
            )
        )
        recruit_ids = {
            str(pick(m, "id"))
            for m in members
            if pick(m, "username") in RECRUIT_USERNAMES
        }

        # The demo member's own report is approved on every run, not only on
        # the run that files it. A trainee sees only approved reports, so a
        # report of theirs left pending or flagged empties My Reports — and the
        # early return below would otherwise carry that state forward untouched.
        for report in existing:
            if str(pick(report, "trainee_id", "traineeId")) != demo_member_id:
                continue
            if pick(report, "review_status", "reviewStatus") in ("approved", "draft"):
                continue
            self.api.post(
                f"/training/shift-reports/{pick(report, 'id')}/review",
                {"review_status": "approved"},
            )

        # Reports filed before their shift's run log named the trainee stored a
        # zero that no later edit to the log rewrites, so repair them here
        # rather than only getting it right on a virgin database — this is the
        # path a re-seed of a long-lived demo container actually takes.
        for report in existing:
            shift_id = pick(report, "shift_id", "shiftId")
            if not shift_id or pick(report, "calls_responded", "callsResponded"):
                continue
            mine = self._name_on_run_log(
                str(shift_id),
                str(pick(report, "shift_date", "shiftDate")),
                str(pick(report, "trainee_id", "traineeId")),
            )
            if mine:
                self.api.put(
                    f"/training/shift-reports/{pick(report, 'id')}",
                    {
                        "calls_responded": len(mine),
                        "call_types": sorted(
                            {
                                c.get("incident_type")
                                for c in mine
                                if c.get("incident_type")
                            }
                        ),
                    },
                )

        # Two calendar months, not just the four review states: the analytics
        # card draws its monthly trend only when there is more than one month
        # to plot, so a set of reports all filed against the same week renders
        # the summary cards and the trainee table and then simply omits the
        # section the guide describes underneath them.
        wanted = {"approved", "pending_review", "flagged", "draft"}
        have = {pick(r, "review_status", "reviewStatus") for r in existing}
        pending = sum(
            1
            for r in existing
            if pick(r, "review_status", "reviewStatus") == "pending_review"
        )
        # `pending >= 4`, not just each state present once: the Review Queue's
        # batch bar is photographed with several rows selected, and a guard
        # that only asks whether each state name appears somewhere left the
        # queue near-empty on a database seeded before the count mattered —
        # the same lesson _flag_review_queue's docstring records for Flagged.
        #
        # `months` is deliberately NOT part of the condition. The schedule
        # spans two weeks around today, so mid-month every report lands in one
        # calendar month, the two-month analytics spread is unreachable, and a
        # guard demanding it re-filed another batch of reports on every single
        # run until the roster ran out of unreported trainees.
        if wanted <= have and pending >= 4:
            # The review states still get topped up on the way out. This return
            # is about not re-filing reports.
            self._ensure_demo_member_report(existing, demo_member_id)
            reports = items(self.api.get("/training/shift-reports/all?limit=50"))
            self._flag_review_queue(reports, demo_member_id)
            return reports

        shifts = items(self.api.get("/scheduling/shifts?limit=200"), "shifts")
        past = sorted(
            (
                s
                for s in shifts
                if pick(s, "id")
                and str(pick(s, "shift_date", "shiftDate") or "") < str(TODAY)
            ),
            key=lambda s: str(pick(s, "shift_date", "shiftDate")),
            reverse=True,
        )
        if not past:
            self.blocked.append("shift reports: no past shift to file against")
            return []

        # One ladder shift with an evaluable program trainee is reserved: the
        # batch-report-form screenshots need a crew member whose Evaluate
        # panel can still be opened, and this loop files newest-first — which
        # is exactly where the trainee-carrying ladder shifts sit. Without the
        # reservation, a re-seed quietly consumes the last evaluable trainee
        # and the two batch-form shots fail on a crew of "Already reported".
        reserved_shift_id = None
        for shift in past:
            if "Ladder" not in str(pick(shift, "apparatus_name", "apparatusName")):
                continue
            crew = items(
                self.api.get(f"/training/shift-reports/shift-crew/{pick(shift, 'id')}")
            )
            if any(
                c.get("program_name") and not c.get("has_existing_report") for c in crew
            ):
                reserved_shift_id = pick(shift, "id")
                break

        # A report can only be filed about someone who was actually on the
        # shift — the create rejects anyone else with "Trainee has no
        # attendance or assignment record for this shift" — so the trainees
        # come from each shift's crew rather than from the roster at large.
        # `shift-crew` also reports who already has a report, which is what
        # keeps a re-run off the (shift, trainee) unique constraint; that
        # violation surfaces as a 500, not a conflict.
        pairs: list[tuple[dict, str]] = []
        seen_trainees = {
            str(pick(r, "trainee_id", "traineeId"))
            for r in existing
            if pick(r, "trainee_id", "traineeId")
        }
        # Walked newest-then-oldest alternately rather than straight down the
        # list, so the reports land in more than one calendar month and the
        # analytics card has a trend to plot. Straight iteration files all five
        # against the same fortnight, which is the shape the schedule happens
        # to have at its most recent end.
        interleaved: list[dict] = []
        head, tail = 0, len(past) - 1
        while head <= tail:
            interleaved.append(past[head])
            if head != tail:
                interleaved.append(past[tail])
            head, tail = head + 1, tail - 1

        for shift in interleaved[:30]:
            # Nine, not five. Approvals take two, the flagged queue takes two
            # and the draft one, so a five-report seed left the Review Queue
            # near-empty — and its batch bar needs several pending rows.
            if len(pairs) >= 9:
                break
            if pick(shift, "id") == reserved_shift_id:
                continue
            crew = items(
                self.api.get(f"/training/shift-reports/shift-crew/{pick(shift, 'id')}")
            )
            available = [
                c
                for c in crew
                if not c.get("has_existing_report")
                and str(c.get("user_id")) not in seen_trainees
                # Never a recruit: the batch-report screenshots need a program
                # trainee whose Evaluate control is still live on the ladder
                # fixture shift, and a report filed about them anywhere on
                # this loop's walk could land exactly there.
                and str(c.get("user_id")) not in recruit_ids
            ]
            if not available:
                continue
            # The member account the `auth: "member"` shots sign in as has to
            # be among the trainees, or their My Reports view stays empty for
            # the one session that can picture it.
            chosen = next(
                (c for c in available if str(c.get("user_id")) == demo_member_id),
                available[0],
            )
            seen_trainees.add(str(chosen.get("user_id")))
            pairs.append((shift, str(chosen.get("user_id"))))

        # The demo member's report must not be the draft either: the last
        # pair files with save_as_draft, and a draft is invisible in My
        # Reports — the same trap as the positional flag below, one state
        # over. Swap them off the tail rather than dropping the pair.
        if len(pairs) > 1 and pairs[-1][1] == demo_member_id:
            pairs[-1], pairs[-2] = pairs[-2], pairs[-1]

        # Wired before the reports are filed, not after: the create derives the
        # call count from the run log, and nothing re-derives it later. The
        # count varies so the reports list does not show the same figure in
        # every row, which reads as a placeholder rather than as data.
        for index, (shift, trainee_id) in enumerate(pairs):
            self._name_on_run_log(
                str(pick(shift, "id")),
                str(pick(shift, "shift_date", "shiftDate")),
                trainee_id,
                count=1 + (index % 3),
            )
        if not pairs and not existing:
            self.blocked.append("shift reports: no crewed past shift to file against")
            return []

        skills = [
            ("Pump operations", 4, "Set the pump and held pressure without prompting."),
            ("Hose deployment", 3, "Crosslay stretch was clean; kinks on the reload."),
            ("Hydrant connection", 4, "Wrapped and dressed the hydrant unassisted."),
            ("SCBA donning", 5, "Under sixty seconds, mask seal checked."),
            ("Ladder throw", 3, "Needs a second set on the 24' extension."),
        ]
        tasks = [
            ("Apparatus check", "Completed the start-of-shift engine inventory."),
            ("Hose testing", 'Assisted with annual service test on 2 1/2" line.'),
            ("Station duties", "Bay wash-down and SCBA cylinder swap."),
        ]
        narratives = [
            "Strong shift. Took the nozzle on the room-and-contents fire and "
            "held the line without being told twice.",
            "Steady progress on pump operations. Still talks through the "
            "steps out loud, which is fine at this stage.",
            "Good instincts on the medical call — got a full set of vitals "
            "before the medic unit arrived.",
            "Quiet shift, mostly station duties. Used the downtime to work "
            "the ladder evolutions.",
            "Handled the extrication assignment well; watch tool placement "
            "on the B-post next time.",
        ]

        created: list[dict] = []
        for index, (shift, trainee_id) in enumerate(pairs):
            shift_date = str(pick(shift, "shift_date", "shiftDate"))
            payload = {
                "shift_id": pick(shift, "id"),
                "shift_date": shift_date,
                "trainee_id": trainee_id,
                "hours_on_shift": [12.0, 10.5, 8.0, 12.0, 6.0][index % 5],
                "calls_responded": [3, 1, 2, 0, 4][index % 5],
                "call_types": [
                    ["Structure Fire", "EMS"],
                    ["EMS"],
                    ["Motor Vehicle Collision", "Automatic Fire Alarm"],
                    [],
                    ["EMS", "Odor Investigation"],
                ][index % 5],
                "performance_rating": [4, 3, 4, 3, 5][index % 5],
                "areas_of_strength": [
                    "Aggressive but controlled on the nozzle.",
                    "Asks good questions and writes things down.",
                    "Excellent patient rapport.",
                    "Reliable on apparatus checks.",
                    "Fastest SCBA donning on the crew.",
                ][index % 5],
                "areas_for_improvement": [
                    "Slow to mask up before entry.",
                    "Pump discharge pressures still need a cheat sheet.",
                    "Radio traffic is too long — keep it to the point.",
                    "Needs more reps on ladders.",
                    "Watch tool placement during extrication.",
                ][index % 5],
                "officer_narrative": narratives[index % len(narratives)],
                "skills_observed": [
                    {
                        "skill_name": name,
                        "demonstrated": True,
                        "score": score,
                        "notes": note,
                    }
                    for name, score, note in skills[: 3 + (index % 3)]
                ],
                "tasks_performed": [
                    {"task": task, "description": description}
                    for task, description in tasks[: 2 + (index % 2)]
                ],
            }
            # The last trainee's report stays a draft so the Drafts view has
            # something to picture; the rest submit into the review queue.
            if index == len(pairs) - 1:
                payload["save_as_draft"] = True
            created.append(self.api.post("/training/shift-reports", payload))

        # With review required every non-draft create lands in `pending_review`,
        # so the other two states are set afterwards, across the reports an
        # earlier run left behind as well as the new ones.
        #
        # The demo member is picked out by name rather than by position. Their
        # report has to be approved — My Reports shows a trainee only their
        # approved reports — and it must never be the one flagged, which is
        # what a positional `queued[3]` did as soon as a second run changed the
        # ordering: it flagged the member's only report and emptied the one
        # view a member's session can picture.
        reports = existing + created
        queued = [
            r for r in reports if pick(r, "review_status", "reviewStatus") != "draft"
        ]
        mine = [
            r
            for r in queued
            if str(pick(r, "trainee_id", "traineeId")) == demo_member_id
        ]
        # Only reports still pending: `others[0]` once landed on an
        # already-flagged report and quietly re-reviewed it to approved,
        # shrinking the Flagged queue the 03-62 capture counts on.
        others = [
            r
            for r in queued
            if r not in mine
            and pick(r, "review_status", "reviewStatus") == "pending_review"
        ]
        for report in mine[:1] + others[:1]:
            self.api.post(
                f"/training/shift-reports/{pick(report, 'id')}/review",
                {"review_status": "approved"},
            )
        self._flag_review_queue(reports, demo_member_id)
        return reports

    def _ensure_demo_member_report(
        self, existing: list[dict], demo_member_id: str
    ) -> None:
        """File and approve one report for the demo member if none exists.

        My Reports and the My Shift Progress stats card render only from the
        member's own *approved* reports, and the filing loop's states-present
        early return can leave the one member the `auth: "member"` shots sign
        in as with nothing — the states were all satisfied by other people's
        reports before a shift of hers came up.
        """
        if not demo_member_id:
            return
        mine = [
            r
            for r in existing
            if str(pick(r, "trainee_id", "traineeId")) == demo_member_id
            and pick(r, "review_status", "reviewStatus") != "draft"
        ]
        if any(pick(r, "review_status", "reviewStatus") == "approved" for r in mine):
            return
        if mine:
            self.api.post(
                f"/training/shift-reports/{pick(mine[0], 'id')}/review",
                {"review_status": "approved"},
            )
            return
        shifts = items(self.api.get("/scheduling/shifts?limit=200"), "shifts")
        past = sorted(
            (
                s
                for s in shifts
                if pick(s, "id")
                and str(pick(s, "shift_date", "shiftDate") or "") < str(TODAY)
            ),
            key=lambda s: str(pick(s, "shift_date", "shiftDate")),
            reverse=True,
        )
        for shift in past:
            crew = items(
                self.api.get(f"/training/shift-reports/shift-crew/{pick(shift, 'id')}")
            )
            me = next(
                (
                    c
                    for c in crew
                    if str(c.get("user_id")) == demo_member_id
                    and not c.get("has_existing_report")
                ),
                None,
            )
            if me is None:
                continue
            shift_date = str(pick(shift, "shift_date", "shiftDate"))
            self._name_on_run_log(
                str(pick(shift, "id")), shift_date, demo_member_id, count=2
            )
            report = self.api.post(
                "/training/shift-reports",
                {
                    "shift_id": pick(shift, "id"),
                    "shift_date": shift_date,
                    "trainee_id": demo_member_id,
                    "hours_on_shift": 12.0,
                    "calls_responded": 2,
                    "call_types": ["EMS", "Automatic Fire Alarm"],
                    "performance_rating": 4,
                    "areas_of_strength": "Excellent patient rapport.",
                    "areas_for_improvement": (
                        "Radio traffic is too long — keep it to the point."
                    ),
                    "officer_narrative": (
                        "Good instincts on the medical call — got a full set "
                        "of vitals before the medic unit arrived."
                    ),
                    "skills_observed": [
                        {
                            "skill_name": "Pump operations",
                            "demonstrated": True,
                            "score": 4,
                            "notes": "Set the pump and held pressure unprompted.",
                        },
                        {
                            "skill_name": "SCBA donning",
                            "demonstrated": True,
                            "score": 5,
                            "notes": "Under sixty seconds, mask seal checked.",
                        },
                    ],
                    "tasks_performed": [
                        {
                            "task": "Apparatus check",
                            "description": (
                                "Completed the start-of-shift engine inventory."
                            ),
                        }
                    ],
                },
            )
            self.api.post(
                f"/training/shift-reports/{pick(report, 'id')}/review",
                {"review_status": "approved"},
            )
            return
        self.blocked.append(
            "shift reports: no past shift crews the demo member, so their "
            "My Reports view stays empty"
        )

    #: Two flagged reports, not one. The Flagged view is a queue, and a queue of
    #: one pictures neither the batch-review bar — which renders only above a
    #: single report — nor the fact that reviewers write a different reason on
    #: each.
    FLAG_NOTES = (
        (
            "Hours do not match the roster for this shift — please confirm "
            "the relief time and resubmit."
        ),
        (
            "No narrative for the pump evolution. Add what was attempted and "
            "what needed prompting, then resubmit."
        ),
    )

    def _flag_review_queue(self, reports: list[dict], demo_member_id: str) -> None:
        """Top the Flagged view up to FLAG_NOTES.

        Never the demo member's own report: a trainee sees only their approved
        reports, so flagging theirs empties the one view a member's session can
        picture. Never the first of the others either — that one is approved,
        so the queue keeps an example of each outcome.

        Keyed on how many are already flagged, so a re-run fills the queue up
        rather than flagging two more reports every time.
        """
        queued = [
            r
            for r in reports
            if pick(r, "review_status", "reviewStatus") != "draft"
            and str(pick(r, "trainee_id", "traineeId")) != demo_member_id
        ]
        flagged = [
            r for r in queued if pick(r, "review_status", "reviewStatus") == "flagged"
        ]
        candidates = [r for r in queued[1:] if r not in flagged]
        for report, note in zip(candidates, self.FLAG_NOTES[len(flagged) :]):
            self.api.post(
                f"/training/shift-reports/{pick(report, 'id')}/review",
                {"review_status": "flagged", "reviewer_notes": note},
            )

    def seed_batch_report_trainee(self) -> None:
        """Crew a program trainee onto the first past Ladder 4 shift.

        The batch shift-report form renders its per-member Evaluate control
        only for crew enrolled in a training program, and `03-63` /
        `03-64` open exactly that: the first ladder shift in the picker,
        expanded on its trainee. The crew rotation deals members by pool
        order with no reason to put a recruit on the ladder, so on a fresh
        database the fixture simply wasn't there — the form opened, listed a
        crew, and offered nothing to expand.

        Runs after `seed_shift_reports`, whose pair-picker also skips
        recruits, so no report can exist about the trainee on this shift and
        the Evaluate control stays live across re-runs.
        """
        shifts = items(self.api.get("/scheduling/shifts?limit=200"), "shifts")
        ladders = sorted(
            (
                s
                for s in shifts
                if pick(s, "id")
                and str(pick(s, "shift_date", "shiftDate") or "") < str(TODAY)
                and str(pick(s, "apparatus_unit_number", "apparatusUnitNumber"))
                == "L-4"
            ),
            key=lambda s: str(pick(s, "shift_date", "shiftDate")),
        )
        if not ladders:
            self.blocked.append("batch report trainee: no past Ladder 4 shift")
            return
        target = ladders[0]
        shift_id = pick(target, "id")

        crew = items(self.api.get(f"/training/shift-reports/shift-crew/{shift_id}"))
        members = items(self.api.get("/users?limit=100"), "users")
        recruit_ids = {
            str(pick(m, "id")): pick(m, "username")
            for m in members
            if pick(m, "username") in RECRUIT_USERNAMES
        }
        if any(str(c.get("user_id")) in recruit_ids for c in crew):
            return
        for user_id in recruit_ids:
            try:
                self.api.post(
                    f"/scheduling/shifts/{shift_id}/assignments",
                    {"user_id": user_id, "position": "firefighter"},
                )
                return
            except ApiError as exc:
                # A double-booking refusal means this recruit was on another
                # rig that day — the next one usually was not.
                if exc.code not in (400, 409):
                    raise
        self.blocked.append(
            "batch report trainee: every recruit was refused on the ladder shift"
        )

    # -- notification rules ------------------------------------------

    def seed_shift_reminder_notification(self) -> None:
        """Put a start-of-shift reminder in the administrator's inbox.

        The reminder is written by the `shift_reminders` scheduled task, which
        looks only `lookahead_hours` (default 2) ahead. On a long-lived
        deployment it fires as each shift's window opens; a freshly seeded
        database captured minutes later has no reminder unless a shift happens
        to start within two hours of the capture. `03-97` pictures the
        expanded reminder card, so: widen the window far enough to cover the
        next seeded shift, run the task once, and put the setting back —
        the notification persists, and `03-39` pictures the 2-hour default.

        The task itself refuses to re-notify a shift it has already covered,
        so a re-run adds at most the newly seeded shifts' reminders.
        """
        logs = self.api.get("/notifications/my?limit=100")
        rows = (logs.get("logs") if isinstance(logs, dict) else logs) or []
        if any(
            "Shift Reminder" in str(r.get("subject") or r.get("title") or "")
            for r in rows
        ):
            return

        # The reminder goes to each *crewed* member, and the rotation only
        # puts the administrator on today's first shift — already started by
        # the time this runs, and past shifts are outside every window. Crew
        # the administrator onto the earliest upcoming shift the task has not
        # already covered (`start_reminder_sent` in the shift's activities is
        # permanent — a run that fires while the admin is on none of the
        # window's shifts burns them all), then size the window to reach it.
        me = self.api.get("/auth/me")
        admin_id = str(pick(me, "id") or pick(me.get("user") or {}, "id"))
        shifts = items(self.api.get("/scheduling/shifts?limit=200"), "shifts")
        now = datetime.now(timezone.utc)
        candidates = sorted(
            (
                s
                for s in shifts
                if pick(s, "id")
                and not (pick(s, "activities") or {}).get("start_reminder_sent")
                and str(pick(s, "start_time", "startTime") or "")
                > now.strftime("%Y-%m-%dT%H:%M:%S")
            ),
            key=lambda s: str(pick(s, "start_time", "startTime")),
        )
        if not candidates:
            self.blocked.append(
                "shift reminder inbox: no upcoming shift the reminder task "
                "has not already covered"
            )
            return
        target = candidates[0]
        try:
            self.api.post(
                f"/scheduling/shifts/{pick(target, 'id')}/assignments",
                {"user_id": admin_id, "position": "officer"},
            )
        except ApiError as exc:
            # Already aboard (or the seat is taken) still means the reminder
            # will name them if they hold any assignment on the shift.
            if exc.code not in (400, 409):
                raise

        starts = str(pick(target, "start_time", "startTime"))
        start_dt = datetime.fromisoformat(starts.replace("Z", "+00:00"))
        if start_dt.tzinfo is None:
            start_dt = start_dt.replace(tzinfo=timezone.utc)
        hours_out = max(2, int((start_dt - now).total_seconds() // 3600) + 2)
        widened = {
            "enabled": True,
            "lookahead_hours": hours_out,
            "send_email": False,
        }
        self.api.patch("/organization/settings", {"shift_reminders": widened})
        try:
            self.api.post("/scheduled/run-task?task=shift_reminders", {})
        finally:
            self.api.patch(
                "/organization/settings",
                {"shift_reminders": {**widened, "lookahead_hours": 2}},
            )

    def seed_notification_rules(self) -> list[dict]:
        """Automations for the notification rules list.

        Rules are opt-in — a fresh department has none — so the rules tab shows
        its empty state until some exist. Channel and category follow the
        trigger, matching what the create dialog fills in for itself.
        """
        rules = items(self.api.get("/notifications/rules"), "rules")
        names = {r.get("name") for r in rules}
        blueprint = [
            (
                "Drill reminder — 24 hours out",
                "event_reminder",
                "events",
                "email",
                "Reminds everyone RSVP'd to a drill the day before.",
                True,
            ),
            (
                "Certification expiring in 60 days",
                "training_expiry",
                "training",
                "email",
                "Warns the member and the training officer well before a "
                "certification lapses.",
                True,
            ),
            (
                "Shift roster changed",
                "schedule_change",
                "scheduling",
                "in_app",
                "Tells the affected crew when a shift is edited or reassigned.",
                True,
            ),
            (
                "Apparatus maintenance due",
                "maintenance_due",
                "maintenance",
                "in_app",
                "Flags the apparatus officer when a unit reaches its service "
                "interval.",
                True,
            ),
            (
                "New member welcome",
                "new_member",
                "members",
                "email",
                "Sends onboarding instructions the day an account is created.",
                False,
            ),
        ]
        for name, trigger, category, channel, description, enabled in blueprint:
            if name in names:
                continue
            rules.append(
                self.api.post(
                    "/notifications/rules",
                    {
                        "name": name,
                        "description": description,
                        "trigger": trigger,
                        "category": category,
                        "channel": channel,
                        "enabled": enabled,
                    },
                )
            )
        return rules

    # -- department messages -----------------------------------------

    def seed_officers(self, members: list[dict]) -> None:
        """Fill the department's offices.

        Email templates sign messages with the officeholder's name, and the
        Officers tab is otherwise a column of "Vacant / No holder" rows with
        nothing to picture. One office is given an override so the tab shows
        both kinds of entry — a linked member, and a linked member whose
        signature title differs from the default.
        """
        by_username = {m.get("username"): m for m in members}
        assignments = [
            ("chief", "chief", None),
            ("deputy_chief", "mbell", None),
            ("assistant_chief", "praman", None),
            ("safety_officer", "hvance", None),
            # Linked member, department-specific signature title.
            ("training_officer", "okittredge", "Training & Safety Officer"),
            ("president", "smarchetti", None),
            ("secretary", "aosei", None),
            ("treasurer", "tlindqvist", None),
            ("quartermaster", "whalloway", None),
        ]
        directory = items(self.api.get("/officers"), "offices")
        filled = {
            o.get("office_key") for o in directory if pick(o, "user_id", "userId")
        }
        known = {o.get("office_key") for o in directory}
        for office_key, username, title in assignments:
            if office_key in filled or office_key not in known:
                continue
            member = by_username.get(username)
            user_id = pick(member, "id") if member else None
            if not user_id:
                continue
            payload: dict[str, Any] = {"user_id": user_id}
            if title:
                payload["title"] = title
            self.api.call("PUT", f"/officers/{office_key}", payload)

    def seed_messages(self, base_url: str, members: list[dict]) -> list[dict]:
        """Post department announcements and have some members acknowledge.

        The acknowledgment report is a "who has and has not read this" list, so
        it only says anything if the department is split — every member
        acknowledging is as blank a picture as none of them doing so. Two
        thirds acknowledge here; the rest stay outstanding.
        """
        existing = items(self.api.get("/messages?include_inactive=true"), "messages")
        titles = {m.get("title") for m in existing}
        blueprint = [
            (
                "SCBA Flow Test — Mandatory Read",
                "Annual SCBA flow testing runs the first two weeks of next "
                "month. Every interior-qualified member must sign up for a "
                "slot and bring their assigned mask. Acknowledge below so the "
                "safety officer can track coverage.",
                "important",
                True,
                True,
            ),
            (
                "Station 2 Bay Doors Out of Service",
                "The centre bay door at Station 2 is awaiting a part. Use the "
                "north bay for apparatus movements until further notice.",
                "urgent",
                False,
                True,
            ),
            (
                "Uniform Order Window Closes Friday",
                "The quartermaster submits the bulk uniform order Friday at "
                "17:00. Anything not in the storefront cart by then waits for "
                "the next cycle.",
                "normal",
                False,
                False,
            ),
        ]

        created = list(existing)
        for title, body, priority, requires_ack, pinned in blueprint:
            if title in titles:
                continue
            created.append(
                self.api.post(
                    "/messages",
                    {
                        "title": title,
                        "body": body,
                        "priority": priority,
                        "target_type": "all",
                        "is_pinned": pinned,
                        "requires_acknowledgment": requires_ack,
                    },
                )
            )

        ack_ids = [
            pick(m, "id")
            for m in created
            if pick(m, "requires_acknowledgment", "requiresAcknowledgment")
            and pick(m, "id")
        ]
        if not ack_ids:
            return created

        # Acknowledging is a first-person action — there is no "acknowledge on
        # behalf of" route — so each member signs in, exactly as they do for
        # RSVPs. Two thirds of the roster, leaving the rest outstanding.
        signers = password_login_members(members)
        for member in signers[: (len(signers) * 2) // 3]:
            username = member.get("username")
            if not username:
                continue
            member_api = Api(base_url)
            try:
                member_api.login_as(username, DEMO_MEMBER_PASSWORD)
            except ApiError:
                continue
            for message_id in ack_ids:
                try:
                    member_api.post(f"/messages/{message_id}/acknowledge")
                except ApiError as exc:
                    # Already acknowledged on an earlier run.
                    if exc.code not in (400, 409):
                        raise
        return created

    # -- documents ---------------------------------------------------

    def seed_legal_documents(self) -> list[dict]:
        """One published notice and one draft, so the two states differ on screen.

        Guide 19's Legal Documents captures turn on the difference between a
        document a department has adopted and one still being written: the
        landing view shows a published status and a "Last updated" line against
        one card and a draft against the other. With nothing seeded the screen
        renders both cards on the platform default, which is a true screen and
        the wrong one — it shows the feature unused.

        Privacy is published and Terms is left as a draft rather than the other
        way round, because the published-page capture (`19-03-privacy-header`)
        reads /privacy: a department that has adopted its own wording is what
        that shot should show.
        """
        overview = self.api.get("/legal-documents") or {}
        documents = overview.get("documents") or []
        by_type = {str(pick(d, "document_type", "documentType")): d for d in documents}

        def has_revision(document_type: str) -> bool:
            doc = by_type.get(document_type) or {}
            return bool((doc.get("history") or []) or (doc.get("drafts") or []))

        created: list[dict] = []

        # Two published revisions, not one: the revision-history captures need a
        # superseded entry to show, and a document with a single revision has no
        # history worth photographing. Each is created only if its own change
        # note is missing, so re-running adds neither.
        # Read off the overview: there is no per-document revisions endpoint,
        # and the overview already carries both `history` and `drafts` for each
        # document, which is every revision this needs to recognise.
        privacy = by_type.get("privacy_policy") or {}
        published_notes = {
            str(pick(r, "change_note", "changeNote") or "")
            for r in (privacy.get("history") or []) + (privacy.get("drafts") or [])
        }
        for body, note in PRIVACY_REVISIONS:
            if note in published_notes:
                continue
            revision = self.api.post(
                "/legal-documents/revisions",
                {
                    "document_type": "privacy_policy",
                    "body": body,
                    "change_note": note,
                    "effective_date": str(TODAY),
                },
            )
            revision_id = pick(revision, "id")
            if revision_id:
                self.api.post(f"/legal-documents/revisions/{revision_id}/publish", {})
            created.append(revision)

        if not has_revision("terms_of_service"):
            # Deliberately left unpublished: the draft state is half the shot.
            created.append(
                self.api.post(
                    "/legal-documents/revisions",
                    {
                        "document_type": "terms_of_service",
                        "body": TERMS_DRAFT_BODY,
                        "change_note": (
                            "First pass at department terms. Awaiting the "
                            "chief's review before publishing."
                        ),
                    },
                )
            )

        self._ensure_legal_proposer()
        self._seed_secretary_draft()
        return created

    #: The demo account that may draft a revision but not publish one. The
    #: Secretary role is the department office that actually holds
    #: `legal.propose` without `legal.publish` or `settings.manage`, which is
    #: the middle rung of the guide's three-way table and the one no other demo
    #: account can photograph.
    LEGAL_PROPOSER_USERNAME = "okittredge"
    LEGAL_PROPOSER_ROLE = "Secretary"

    def _seed_secretary_draft(self) -> None:
        """A draft written by the propose-only account, not by the publisher.

        Who *wrote* a draft decides what its card offers: the page allows
        editing to the author or to anyone who can publish, and offers Publish
        only to the latter. A draft the administrator wrote therefore shows the
        secretary no controls at all, which pictures nothing — the guide's
        claim is about a secretary looking at their own proposal and finding
        Edit and Discard but no way to publish it.

        On Terms rather than Privacy: Privacy's card is photographed elsewhere
        in its published, no-proposals state, and a pending proposal would
        change what that capture shows.
        """
        session = self.member_session(
            self.base_url,
            next(
                (
                    str(pick(u, "id"))
                    for u in items(self.api.get("/users?limit=200"), "users")
                    if pick(u, "username") == self.LEGAL_PROPOSER_USERNAME
                ),
                "",
            ),
            self.LEGAL_PROPOSER_USERNAME,
        )
        overview = session.get("/legal-documents") or {}
        terms = next(
            (
                d
                for d in (overview.get("documents") or [])
                if str(pick(d, "document_type", "documentType")) == "terms_of_service"
            ),
            {},
        )
        notes = {
            str(pick(r, "change_note", "changeNote") or "")
            for r in (terms.get("drafts") or [])
        }
        if SECRETARY_DRAFT_NOTE in notes:
            return
        session.post(
            "/legal-documents/revisions",
            {
                "document_type": "terms_of_service",
                "body": SECRETARY_DRAFT_BODY,
                "change_note": SECRETARY_DRAFT_NOTE,
                "effective_date": str(TODAY + timedelta(days=7)),
            },
        )

    def _ensure_legal_proposer(self) -> None:
        """Guarantee the propose-only account this screen's captures need.

        The role reached this member as a side effect of seeding the closed
        election's ballot attestations. That worked, and is exactly the kind of
        dependency that goes quiet when the other step's fixture guard
        short-circuits: the capture then signs in successfully, lands on a
        screen it no longer has, and times out with nothing pointing at why.
        The step that owns the screen asserts its own account.
        """
        user_id = next(
            (
                str(pick(u, "id"))
                for u in items(self.api.get("/users?limit=200"), "users")
                if pick(u, "username") == self.LEGAL_PROPOSER_USERNAME
            ),
            "",
        )
        if not user_id:
            self.blocked.append(
                f"legal documents: {self.LEGAL_PROPOSER_USERNAME} is not on the roster"
            )
            return
        roles = self.api.get("/roles")
        role_id = next(
            (
                str(pick(r, "id"))
                for r in (roles if isinstance(roles, list) else items(roles, "roles"))
                if pick(r, "name") == self.LEGAL_PROPOSER_ROLE
            ),
            "",
        )
        if not role_id:
            self.blocked.append(
                f"legal documents: no {self.LEGAL_PROPOSER_ROLE} role to grant"
            )
            return
        try:
            self.api.post(f"/users/{user_id}/roles/{role_id}", {})
        except ApiError as exc:
            # Already held is the common case on a re-run.
            if exc.code not in (400, 409):
                raise

    def seed_documents(self) -> list[dict]:
        folders = items(self.api.get("/documents/folders"), "folders")
        existing = {f.get("name") for f in folders}
        for name, icon, color, description in [
            (
                "Standard Operating Guidelines",
                "book",
                "#DC2626",
                "Department SOGs by division.",
            ),
            (
                "Policies & Bylaws",
                "shield",
                "#2563EB",
                "Governance documents and bylaws.",
            ),
            (
                "Training Materials",
                "graduation-cap",
                "#7C3AED",
                "Lesson plans and handouts.",
            ),
            ("Meeting Minutes", "file-text", "#059669", "Approved minutes by year."),
            (
                "Forms & Templates",
                "clipboard",
                "#CA8A04",
                "Blank forms for member use.",
            ),
        ]:
            if name in existing:
                continue
            folders.append(
                self.api.post(
                    "/documents/folders",
                    {
                        "name": name,
                        "description": description,
                        "icon": icon,
                        "color": color,
                    },
                )
            )
        self._seed_document_files(folders)
        return folders

    #: (folder name, document name, description) for the library contents. The
    #: documents page and every folder card count what is in them, so a library
    #: of empty folders is what the guides would otherwise picture.
    DOCUMENT_FILES = [
        (
            "Standard Operating Guidelines",
            "SOG 101 — Structure Fire Response",
            "First-due assignments and initial tactics.",
        ),
        (
            "Standard Operating Guidelines",
            "SOG 204 — Vehicle Extrication",
            "Stabilisation, tool assignments and patient packaging.",
        ),
        (
            "Policies & Bylaws",
            "Department Bylaws (Revised 2026)",
            "Adopted at the March business meeting.",
        ),
        (
            "Policies & Bylaws",
            "Member Conduct Policy",
            "Expectations, reporting and the disciplinary process.",
        ),
        (
            "Training Materials",
            "Ladder Company Operations — Lesson Plan",
            "Four-hour block with skills sheet.",
        ),
        (
            "Meeting Minutes",
            "Business Meeting Minutes — July 2026",
            "Approved as read.",
        ),
        (
            "Forms & Templates",
            "Turnout Gear Sizing Sheet",
            "Blank sizing sheet for new members.",
        ),
    ]

    def _seed_document_files(self, folders: list[dict]) -> None:
        existing = {
            d.get("name") for d in items(self.api.get("/documents"), "documents")
        }
        by_name = {f.get("name"): pick(f, "id") for f in folders}
        for folder_name, name, description in self.DOCUMENT_FILES:
            if name in existing:
                continue
            folder_id = by_name.get(folder_name)
            if not folder_id:
                continue
            fields = {"name": name, "description": description}
            fields["folder_id"] = str(folder_id)
            self.api.post_file(
                "/documents/upload",
                fields,
                f"{name}.pdf",
                _demo_pdf(name, description),
                "application/pdf",
            )

    # -- finance -----------------------------------------------------

    BUDGET_CATEGORIES = [
        ("Apparatus Maintenance", "6100 - Vehicle Maintenance", 48_000),
        ("Personal Protective Equipment", "6200 - PPE", 36_000),
        ("Training & Certification", "6300 - Training", 22_000),
        ("Station Utilities", "6400 - Utilities", 31_000),
        ("Fuel", "6500 - Fuel", 18_000),
        ("Communications", "6600 - Communications", 14_000),
    ]

    def seed_finance(self) -> dict[str, Any]:
        years = items(self.api.get("/finance/fiscal-years"), "fiscal_years")
        name = f"FY{TODAY.year}"
        fiscal_year = next((y for y in years if y.get("name") == name), None)
        if fiscal_year is None:
            fiscal_year = self.api.post(
                "/finance/fiscal-years",
                {
                    "name": name,
                    "start_date": str(date(TODAY.year, 1, 1)),
                    "end_date": str(date(TODAY.year, 12, 31)),
                },
            )
            self.api.post(f"/finance/fiscal-years/{pick(fiscal_year, 'id')}/activate")

        categories = items(self.api.get("/finance/budget-categories"), "categories")
        existing = {c.get("name") for c in categories}
        for order, (category_name, qb_account, _amount) in enumerate(
            self.BUDGET_CATEGORIES
        ):
            if category_name in existing:
                continue
            categories.append(
                self.api.post(
                    "/finance/budget-categories",
                    {
                        "name": category_name,
                        "description": f"{category_name} operating budget line.",
                        "sort_order": order,
                        "qb_account_name": qb_account,
                    },
                )
            )
        category_ids = {c.get("name"): pick(c, "id") for c in categories}

        budgets = items(self.api.get("/finance/budgets"), "budgets")
        budgeted = {b.get("category_id") or b.get("categoryId") for b in budgets}
        for category_name, _qb, amount in self.BUDGET_CATEGORIES:
            category_id = category_ids.get(category_name)
            if not category_id or category_id in budgeted:
                continue
            budgets.append(
                self.api.post(
                    "/finance/budgets",
                    {
                        "fiscal_year_id": pick(fiscal_year, "id"),
                        "category_id": category_id,
                        "amount_budgeted": amount,
                        "notes": f"Approved {name} allocation for {category_name.lower()}.",
                    },
                )
            )
        return {
            "fiscal_year": fiscal_year,
            "categories": categories,
            "budgets": budgets,
        }

    # -- training programs (pipelines) -------------------------------

    def seed_training_programs(self, members: list[dict]) -> list[dict]:
        programs = items(self.api.get("/training/programs/programs"), "programs")
        names = {p.get("name") for p in programs}
        blueprint = [
            (
                "Probationary Firefighter Pipeline",
                "PROB-FF",
                "Firefighter",
                # Phase names carry no "Phase N —" prefix of their own: the
                # progress view numbers them itself, so a phase called
                # "Phase 1 — Orientation" renders as "Phase 1: Phase 1 —
                # Orientation" in its heading and again under "Current phase".
                [
                    (
                        "Orientation",
                        [
                            ("Department Orientation", "hours", 8),
                            ("PPE Familiarization", "hours", 4),
                            ("Station Duties Checklist", "checklist", None),
                            ("Ride-Along Shifts", "shifts", 3),
                        ],
                    ),
                    (
                        "Basic Skills",
                        [
                            ("Hose Deployment", "hours", 12),
                            ("Ladder Evolutions", "hours", 12),
                            ("SCBA Confidence", "hours", 8),
                            ("Search & Rescue Drills", "hours", 8),
                            ("Duty Shifts", "shifts", 12),
                            ("Emergency Calls", "calls", 20),
                        ],
                    ),
                    (
                        "Certification",
                        [
                            ("Firefighter I Written Exam", "knowledge_test", None),
                            ("Practical Skills Evaluation", "skills_evaluation", None),
                            ("Officer Sign-Off", "checklist", None),
                        ],
                    ),
                ],
            ),
            (
                "Driver / Operator Pipeline",
                "DRV-OP",
                "Driver",
                [
                    (
                        "Classroom",
                        [
                            ("Pump Theory", "hours", 16),
                            ("Hydraulics Calculations", "hours", 8),
                        ],
                    ),
                    (
                        "Behind the Wheel",
                        [
                            ("Supervised Driving Hours", "hours", 20),
                            ("Pump Panel Evolutions", "shifts", 6),
                        ],
                    ),
                ],
            ),
        ]

        for name, code, position, phases in blueprint:
            if name in names:
                continue
            payload = {
                "program": {
                    "name": name,
                    "code": code,
                    "description": (
                        f"{name} — phased progression with officer sign-off "
                        "before advancement."
                    ),
                    "target_position": position,
                    "structure_type": "phases",
                    "time_limit_days": 365,
                },
                "phases": [],
            }
            for number, (phase_name, requirements) in enumerate(phases, start=1):
                phase = {
                    "phase_number": number,
                    "name": phase_name,
                    "description": f"{phase_name} of the {name.lower()}.",
                    # The last phase gates on an officer, which is what the
                    # guides picture on the "Advance to next phase" control.
                    "requires_manual_advancement": number == len(phases),
                    "requirements": [],
                    "milestones": [
                        {
                            "name": f"{phase_name} complete",
                            "completion_percentage_threshold": 100,
                            "notification_message": (
                                f"{phase_name} is finished — ready for review."
                            ),
                        }
                    ],
                }
                for order, (req_name, req_type, amount) in enumerate(requirements):
                    requirement: dict[str, Any] = {
                        "name": req_name,
                        "requirement_type": req_type,
                        "frequency": "one_time",
                        "is_required": True,
                        "sort_order": order,
                    }
                    if req_type == "hours":
                        requirement["required_hours"] = amount
                    elif req_type == "shifts":
                        requirement["required_shifts"] = amount
                    elif req_type == "calls":
                        requirement["required_calls"] = amount
                    elif req_type == "knowledge_test":
                        requirement["passing_score"] = 70
                        requirement["max_attempts"] = 3
                    elif req_type == "checklist":
                        # A real list, not a pair. The whole point of the
                        # checklist type is that the member can read what is
                        # being asked of them, and "2 items" pictures the
                        # feature without demonstrating it.
                        requirement["checklist_items"] = CHECKLIST_ITEMS.get(
                            req_name,
                            [
                                "Reviewed with company officer",
                                "Signed off in station logbook",
                            ],
                        )
                    phase["requirements"].append(requirement)
                payload["phases"].append(phase)
            programs.append(self.api.post("/training/programs/programs/build", payload))

        # Enrol the probationary members so the Enrollments tab and the
        # member-facing progression view have rows to render. Enrollments are
        # only listable per program — there is no collection-level GET.
        # The demo member account is enrolled alongside the recruits: the
        # member-facing progression view is only reachable as the member whose
        # enrollment it is, and with nobody but the recruits enrolled there was
        # nothing for `auth: "member"` shots to open.
        probationary = [
            pick(m, "id")
            for m in members
            if str(pick(m, "username") or "")
            in (RECRUIT_USERNAMES | {DEMO_MEMBER_USERNAME})
        ]
        for program in programs:
            program_id = pick(program, "id")
            if not program_id:
                continue
            enrolled = {
                e.get("user_id") or e.get("userId")
                for e in items(
                    self.api.get(
                        f"/training/programs/programs/{program_id}/enrollments"
                    ),
                    "enrollments",
                )
            }
            for user_id in probationary:
                if not user_id or user_id in enrolled:
                    continue
                self.api.post(
                    "/training/programs/enrollments",
                    {"program_id": program_id, "user_id": user_id},
                )
        self._strip_phase_number_prefixes(programs)
        self._flag_gating_requirements(programs)
        self._backfill_checklist_items(programs)
        self._expire_one_enrollment(programs, members)
        self._advance_pipeline_progress(programs)
        self._complete_one_enrollment(programs)
        return programs

    COMPLETED_PIPELINE_NAME = "Driver / Operator Pipeline"

    def _complete_one_enrollment(self, programs: list[dict]) -> None:
        """Finish one of the demo member's programs, so Completed is reachable.

        Every enrollment was active or expired, so the "Program Completed!"
        banner on the dashboard, and the completed state of an enrollment
        generally, had no data behind them.

        The Driver / Operator pipeline is the one finished: it is the shortest
        of the member's three, and leaving the Probationary Firefighter one
        part-done keeps the in-progress enrollment the progress screenshots are
        built around.

        Requirements are marked complete one by one and the enrollment
        auto-completes when the rollup reaches 100% — there is no "complete this
        enrollment" endpoint, and setting the status directly would skip the
        rollup and the completion notification.
        """
        # Listed per programme: there is no GET on /programs/enrollments — that
        # path is POST-only and answers 405.
        everyone: list[dict] = []
        target = None
        for program in programs:
            program_id = pick(program, "id")
            if not program_id:
                continue
            rows = items(
                self.api.get(f"/training/programs/programs/{program_id}/enrollments"),
                "enrollments",
            )
            everyone.extend(rows)
            if pick(program, "name") == self.COMPLETED_PIPELINE_NAME:
                target = next(
                    (e for e in rows if pick(e, "status") == "active"), target
                )

        # Idempotent on the state: once one enrollment is completed there is
        # nothing to do, and re-running must not finish a second programme.
        if not target or any(pick(e, "status") == "completed" for e in everyone):
            return

        detail = self.api.get(f"/training/programs/enrollments/{pick(target, 'id')}")
        for row in items(detail, "requirement_progress"):
            if pick(row, "status") in ("completed", "verified", "waived"):
                continue
            row_id = pick(row, "id")
            if not row_id:
                continue
            try:
                self.api.patch(
                    f"/training/programs/progress/{row_id}",
                    {"status": "completed"},
                )
            except ApiError as exc:
                self.blocked.append(f"complete enrollment: {exc}")
                return

    def _expire_one_enrollment(self, programs: list[dict], members: list[dict]) -> None:
        """Leave one enrollment past its deadline, so Expired is reachable.

        Every seeded enrollment ran to 2027, so the expiry status, the Expired
        filter and the reopen dialog had nothing to render — the officer's
        Enrollments tab could only ever be shown in one state.

        The member is one of the department's EMTs rather than one of the four
        recruits, whose enrollments the progression shots are built around, and
        the programme is Recruit School for the same reason. Enrolling with a
        past target date is enough: the status is written the first time anyone
        opens the enrollment, which is what the GET below does.
        """
        program = next(
            (
                p
                for p in programs
                if str(pick(p, "name") or "") == EXPIRED_ENROLLMENT_PROGRAM
            ),
            None,
        )
        if not program:
            return
        program_id = pick(program, "id")
        enrollments = items(
            self.api.get(f"/training/programs/programs/{program_id}/enrollments"),
            "enrollments",
        )
        if any(str(pick(e, "status") or "") == "expired" for e in enrollments):
            return
        member = next(
            (
                m
                for m in members
                if str(pick(m, "username") or "") == EXPIRED_ENROLLMENT_USERNAME
            ),
            None,
        )
        user_id = pick(member or {}, "id")
        if not user_id:
            return
        enrolled = {pick(e, "user_id") for e in enrollments}
        if user_id not in enrolled:
            self.api.post(
                "/training/programs/enrollments",
                {
                    "program_id": program_id,
                    "user_id": user_id,
                    "target_completion_date": str(
                        date.today() - timedelta(days=EXPIRED_ENROLLMENT_DAYS_OVER)
                    ),
                },
            )
            enrollments = items(
                self.api.get(f"/training/programs/programs/{program_id}/enrollments"),
                "enrollments",
            )
        for enrollment in enrollments:
            if pick(enrollment, "user_id") == user_id:
                # Reading it is what writes the status.
                self.api.get(f"/training/programs/enrollments/{pick(enrollment, 'id')}")
                break

    def _flag_gating_requirements(self, programs: list[dict]) -> None:
        """Mark one requirement per programme as the one to do first.

        Requirement prerequisites lock the rest of a phase until the gate is
        finished, and nothing seeded one — so every pipeline showed the officer
        a row of "Any order" chips and every member an unlocked list, with the
        whole feature invisible.

        The gate is a requirement whose siblings are *not* already finished for
        the seeded members, so the lock has something to act on: locking behind
        work that is already done shows nothing either.
        """
        for program in programs:
            program_id = pick(program, "id")
            gate_names = PROGRAM_GATE_REQUIREMENTS.get(str(pick(program, "name") or ""))
            if not program_id or not gate_names:
                continue
            links = items(
                self.api.get(f"/training/programs/programs/{program_id}/requirements"),
                "requirements",
            )
            for gate_name in gate_names:
                for link in links:
                    requirement = pick(link, "requirement") or {}
                    if str(pick(requirement, "name") or "") != gate_name:
                        continue
                    if pick(link, "is_prerequisite"):
                        break
                    self.api.patch(
                        f"/training/programs/programs/{program_id}"
                        f"/requirements/{pick(link, 'id')}",
                        {"is_prerequisite": True},
                    )
                    break

    def _backfill_checklist_items(self, programs: list[dict]) -> None:
        """Bring existing checklist requirements up to the blueprint's items.

        The create path only runs once per program (skip-by-name), so a
        database seeded before the blueprint gained officer-only steps keeps
        its old list forever — the recurring blueprint-backfill trap. Replaces
        the list wholesale when the texts or visibilities differ; safe in the
        demo, where no member has checklist ticks recorded.
        """
        for program in programs:
            program_id = pick(program, "id")
            if not program_id:
                continue
            links = items(
                self.api.get(f"/training/programs/programs/{program_id}/requirements"),
                "requirements",
            )
            for link in links:
                requirement = pick(link, "requirement") or {}
                name = str(pick(requirement, "name") or "")
                blueprint = CHECKLIST_ITEMS.get(name)
                if not blueprint:
                    continue
                requirement_id = pick(link, "requirement_id") or pick(requirement, "id")
                detail = self.api.get(
                    f"/training/programs/requirements/{requirement_id}"
                )
                current = [
                    (
                        str(i.get("text") or ""),
                        bool(i.get("member_visible", True)),
                    )
                    for i in pick(detail, "checklist_items") or []
                ]
                wanted = [
                    (
                        (i if isinstance(i, str) else str(i.get("text") or "")),
                        (True if isinstance(i, str) else i.get("member_visible", True)),
                    )
                    for i in blueprint
                ]
                if current == wanted:
                    continue
                self.api.patch(
                    f"/training/programs/requirements/{requirement_id}",
                    {
                        "checklist_items": [
                            {"text": text, "member_visible": visible}
                            for text, visible in wanted
                        ]
                    },
                )

    def _strip_phase_number_prefixes(self, programs: list[dict]) -> None:
        """Drop a "Phase N — " prefix a phase carries in its own name.

        The progress view numbers phases itself, so a phase named
        "Phase 1 — Orientation" renders as "Phase 1: Phase 1 — Orientation" in
        its heading and again under "Current phase". Fixed in the blueprint
        above for new databases and repaired here for existing ones, which the
        create path skips.
        """
        for program in programs:
            program_id = pick(program, "id")
            if not program_id:
                continue
            phases = items(
                self.api.get(f"/training/programs/programs/{program_id}/phases"),
                "phases",
            )
            for phase in phases:
                name = str(pick(phase, "name") or "")
                stripped = PHASE_NUMBER_PREFIX.sub("", name)
                if stripped == name or not stripped:
                    continue
                self.api.patch(
                    f"/training/programs/programs/{program_id}"
                    f"/phases/{pick(phase, 'id')}",
                    {"name": stripped},
                )

    def _advance_pipeline_progress(self, programs: list[dict]) -> None:
        """Move every enrollment partway through its programme.

        A fresh enrollment is 0% with every phase "not started", and that is
        what all of them stayed at: the guides describe a progress view with a
        "You are here" marker on a live phase, a filled progress bar, phases
        ticked off behind it and requirements in flight ahead — none of which an
        untouched enrollment can show. The officer-side progress detail is the
        same screen from the other side, with its Complete / In Progress /
        Verify controls acting on rows that all read the same.

        Roughly the first third of each member's requirements are completed and
        the next two set in progress, so a programme shows finished work,
        current work and work not yet begun at once. Completed rows go through
        the officer's own PATCH, which is what stamps `verified_by` and
        recalculates the enrollment's overall percentage — writing the rows
        directly would leave the percentage at zero and the screens unchanged.

        Keyed on the enrollment already having progress, so a re-run leaves a
        demo database that has been clicked through by hand alone.
        """
        for program in programs:
            program_id = pick(program, "id")
            if not program_id:
                continue
            enrollments = items(
                self.api.get(f"/training/programs/programs/{program_id}/enrollments"),
                "enrollments",
            )
            for enrollment in enrollments:
                enrollment_id = pick(enrollment, "id")
                if not enrollment_id:
                    continue
                detail = self.api.get(f"/training/programs/enrollments/{enrollment_id}")
                rows = items(detail, "requirement_progress")
                if not rows:
                    continue
                # Keyed on a *completed* requirement, not on any row having
                # moved. An enrollment part-way through a previous run has rows
                # at in_progress, and a guard that counted those as progress
                # skipped the enrollment for ever after — leaving it at 0%,
                # which is the state this step exists to get past.
                if any(pick(row, "status") == "completed" for row in rows):
                    continue
                # Only the requirements the member has actually reached. A
                # requirement in a phase behind a gate is refused by the API,
                # which is the phase gate working — driving it from a slice of
                # the row order instead completed one requirement in six and
                # left the rest silently rejected.
                locked = {
                    str(rid) for rid in (pick(detail, "locked_requirements") or [])
                }
                open_rows = [
                    row
                    for row in rows
                    if str(pick(row, "requirement_id", "requirementId")) not in locked
                ]
                if not open_rows:
                    continue
                done = max(1, len(open_rows) * 2 // 3)
                for index, row in enumerate(open_rows):
                    progress_id = pick(row, "id")
                    if not progress_id:
                        continue
                    requirement = pick(row, "requirement") or {}
                    # A checklist is never completed here. Its steps are the
                    # record, and marking the status complete without ticking
                    # them reads "Completed · 0 / 3 steps · Verified" — a tick
                    # and a zero in the same line. Left in progress, which is
                    # what the checklist screens are for anyway.
                    is_checklist = (
                        pick(requirement, "requirement_type", "requirementType")
                        == "checklist"
                    )
                    # Complete the *count* as well as the status. Setting the
                    # status alone leaves a requirement reading "Completed ·
                    # 0 / 12 shifts · Verified", a tick and a zero side by side.
                    target = next(
                        (
                            requirement.get(key)
                            for key in (
                                "required_shifts",
                                "required_hours",
                                "required_calls",
                            )
                            if requirement.get(key)
                        ),
                        None,
                    )
                    complete = index < done and not is_checklist
                    # A knowledge test is completed by *recording a score*, not
                    # by setting a status: the score fills in the "Last score"
                    # line and spends one of the requirement's attempts, and a
                    # pass completes it by itself. Setting the status instead
                    # leaves "Attempts: 0 / 3" beside a finished test.
                    is_test = (
                        pick(requirement, "requirement_type", "requirementType")
                        == "knowledge_test"
                    )
                    payload: dict[str, Any]
                    if complete and is_test:
                        payload = {"test_score": 86}
                    else:
                        payload = (
                            {"status": "completed"}
                            if complete
                            else {"status": "in_progress"}
                        )
                        if complete and target:
                            payload["progress_value"] = target
                    try:
                        self.api.patch(
                            f"/training/programs/progress/{progress_id}", payload
                        )
                    except ApiError as exc:
                        if exc.code not in (400, 403):
                            raise
                        # Recorded rather than swallowed: a refusal here means
                        # the reason is something other than the phase gate,
                        # and a step that quietly does nothing is worse than no
                        # step at all.
                        self.blocked.append(f"pipeline progress: {exc}")

    # -- advanced training (Training Admin > Advanced / Compliance) ----

    def seed_training_enhancements(
        self, members: list[dict], courses: list[dict]
    ) -> None:
        """Populate the Advanced and Compliance tabs of the training hub.

        Every one of these tables ships empty, so the tabs render their
        "nothing configured yet" cards. The guides describe populated
        screens — a pathway with its renewal tasks, an instructor roster
        with expiry states, a Kirkpatrick score breakdown — none of which
        an empty state can stand in for.
        """
        by_name = {course.get("name"): course for course in courses}

        def course_id(name: str) -> str | None:
            course = by_name.get(name)
            return course.get("id") if course else None

        self._seed_recertification_pathways()
        self._seed_competency_matrices()
        self._seed_instructor_qualifications(members, course_id)
        self._seed_effectiveness_evaluations(members, course_id)
        self._seed_multi_agency_exercises()
        self._seed_compliance_attestations()

    def _seed_recertification_pathways(self) -> None:
        existing = {
            p.get("name")
            for p in items(self.api.get("/training/recertification/pathways"))
        }
        blueprint = [
            {
                "name": "EMT-Basic Recertification",
                "description": (
                    "Virginia OEMS two-year cycle. Category hours are tracked "
                    "separately so a member cannot satisfy the whole total with "
                    "one topic."
                ),
                "renewal_type": "hours",
                "required_hours": 40,
                "renewal_window_days": 120,
                "grace_period_days": 30,
                "new_expiration_months": 24,
            },
            {
                "name": "Firefighter I Skills Refresh",
                "description": (
                    "Annual refresh of the FF-I skill set. Requires the "
                    "practical evaluation in addition to classroom hours."
                ),
                "renewal_type": "combination",
                "required_hours": 16,
                "requires_assessment": True,
                "renewal_window_days": 90,
                "grace_period_days": 14,
                "new_expiration_months": 12,
            },
            {
                "name": "Driver/Operator (Pumper) Recertification",
                "description": (
                    "Three-year pump operator cycle. No grace period — an "
                    "expired D/O comes off the driver list the same day."
                ),
                "renewal_type": "courses",
                "required_courses": ["Pump Operations"],
                "renewal_window_days": 60,
                "grace_period_days": 0,
                "new_expiration_months": 36,
            },
        ]
        for pathway in blueprint:
            if pathway["name"] in existing:
                continue
            self.api.post("/training/recertification/pathways", pathway)

    def _seed_competency_matrices(self) -> None:
        existing = {
            m.get("name") for m in items(self.api.get("/training/competency/matrices"))
        }
        blueprint = [
            {
                "name": "Interior Firefighter Readiness",
                "position": "Firefighter",
                "description": (
                    "Core competencies expected of any member cleared to work "
                    "inside a structure."
                ),
                "skill_requirements": [
                    {
                        "name": "SCBA donning and emergency procedures",
                        "level": "expert",
                    },
                    {"name": "Hoseline advancement", "level": "proficient"},
                    {"name": "Forcible entry", "level": "competent"},
                    {"name": "Search and rescue", "level": "proficient"},
                    {"name": "Ladder operations", "level": "competent"},
                ],
            },
            {
                "name": "Driver/Operator — Engine",
                "position": "Driver/Operator",
                "description": (
                    "Competencies required before a member is cleared to pump "
                    "at a working incident."
                ),
                "skill_requirements": [
                    {"name": "Pump panel operation", "level": "expert"},
                    {"name": "Hydrant connection and supply", "level": "proficient"},
                    {"name": "Drafting", "level": "competent"},
                    {"name": "Apparatus positioning", "level": "proficient"},
                ],
            },
            {
                "name": "Company Officer",
                "position": "Officer",
                "description": (
                    "Command and supervision competencies reviewed at each "
                    "officer evaluation."
                ),
                "skill_requirements": [
                    {"name": "Initial size-up and report", "level": "expert"},
                    {"name": "Incident command transfer", "level": "proficient"},
                    {"name": "Accountability", "level": "expert"},
                    {"name": "Post-incident review", "level": "competent"},
                ],
            },
        ]
        for matrix in blueprint:
            if matrix["name"] in existing:
                continue
            self.api.post("/training/competency/matrices", matrix)

    def _seed_instructor_qualifications(self, members: list[dict], course_id) -> None:
        existing = {
            (q.get("user_id"), q.get("qualification_type"), q.get("course_id"))
            for q in items(self.api.get("/training/instructors/qualifications"))
        }
        # A mix of expiry states so the roster shows a current, a
        # nearing-expiry and an already-expired badge rather than one colour.
        blueprint = [
            ("lead_instructor", "Firefighter I", "Fire Instructor III", 365 * 2),
            ("instructor", "Pump Operations", "Fire Instructor II", 45),
            ("instructor", "Hazmat Awareness", "Fire Instructor I", 365),
            ("evaluator", "EMT-Basic Refresher", "EMS Evaluator", -30),
            ("mentor", "New Member Orientation", None, 365 * 3),
        ]
        candidates = [m for m in members if pick(m, "id")]
        for index, (kind, course, level, expires_in) in enumerate(blueprint):
            if index >= len(candidates):
                break
            payload = {
                "user_id": pick(candidates[index], "id"),
                "qualification_type": kind,
                "issuing_agency": "Virginia Department of Fire Programs",
                "certification_number": f"VA-INST-{40800 + index * 17}",
                "issued_date": str(TODAY - timedelta(days=900)),
                "expiration_date": str(TODAY + timedelta(days=expires_in)),
            }
            cid = course_id(course)
            if cid:
                payload["course_id"] = cid
            if level:
                payload["certification_level"] = level
            if (payload["user_id"], kind, cid) in existing:
                continue
            self.api.post("/training/instructors/qualifications", payload)

    def _seed_effectiveness_evaluations(self, members: list[dict], course_id) -> None:
        existing = {
            (e.get("course_id"), e.get("evaluation_level"))
            for e in items(self.api.get("/training/effectiveness/evaluations"))
        }
        # One evaluation at each Kirkpatrick level, so the summary has a bar
        # for every level instead of a single populated column.
        blueprint = [
            ("Firefighter I", "reaction", {"overall_rating": 4.6}),
            (
                "Firefighter I",
                "learning",
                {"pre_assessment_score": 58, "post_assessment_score": 92},
            ),
            ("Pump Operations", "behavior", {"behavior_rating": 4.2}),
            (
                "Pump Operations",
                "results",
                {
                    "results_notes": (
                        "Average time to water dropped from 3:10 to 2:24 across "
                        "the quarter following the drill series."
                    )
                },
            ),
            ("Hazmat Awareness", "reaction", {"overall_rating": 3.8}),
            (
                "EMT-Basic Refresher",
                "learning",
                {"pre_assessment_score": 71, "post_assessment_score": 88},
            ),
        ]
        candidates = [m for m in members if pick(m, "id")]
        if not candidates:
            return
        for index, (course, level, extra) in enumerate(blueprint):
            cid = course_id(course)
            if not cid or (cid, level) in existing:
                continue
            self.api.post(
                "/training/effectiveness/evaluations",
                {
                    "user_id": pick(candidates[index % len(candidates)], "id"),
                    "course_id": cid,
                    "evaluation_level": level,
                    **extra,
                },
            )

    def _seed_multi_agency_exercises(self) -> None:
        existing = {
            e.get("exercise_name")
            for e in items(self.api.get("/training/multi-agency"))
        }
        blueprint = [
            {
                "exercise_name": "Regional High-Rise Standpipe Drill",
                "exercise_type": "mutual_aid_drill",
                "description": (
                    "Joint standpipe and stairwell operations in the Broad "
                    "Street tower, run with the two neighbouring departments "
                    "that would be dispatched on the box."
                ),
                "participating_organizations": [
                    {
                        "name": "Falls Church Volunteer Fire Department",
                        "role": "host",
                        "participant_count": 14,
                    },
                    {
                        "name": "Arlington County Fire Department",
                        "role": "participant",
                        "participant_count": 9,
                    },
                    {
                        "name": "City of Fairfax Fire Department",
                        "role": "participant",
                        "participant_count": 6,
                    },
                ],
                "lead_agency": "Falls Church Volunteer Fire Department",
                "total_participants": 29,
                "nims_compliant": True,
                "exercise_date": str(TODAY - timedelta(days=24)),
            },
            {
                "exercise_name": "Northern Virginia Mass Casualty Tabletop",
                "exercise_type": "tabletop",
                "description": (
                    "Tabletop walkthrough of a multi-patient incident on the "
                    "I-66 corridor, focused on triage and transport control."
                ),
                "participating_organizations": [
                    {
                        "name": "Fairfax County Fire and Rescue",
                        "role": "host",
                        "participant_count": 12,
                    },
                    {
                        "name": "Falls Church Volunteer Fire Department",
                        "role": "participant",
                        "participant_count": 8,
                    },
                    {
                        "name": "Virginia Department of Emergency Management",
                        "role": "observer",
                        "participant_count": 2,
                    },
                ],
                "lead_agency": "Fairfax County Fire and Rescue",
                "total_participants": 22,
                "nims_compliant": True,
                "exercise_date": str(TODAY + timedelta(days=18)),
            },
        ]
        for exercise in blueprint:
            if exercise["exercise_name"] in existing:
                continue
            self.api.post("/training/multi-agency", exercise)

    def _seed_compliance_attestations(self) -> None:
        existing = {
            (a.get("period_year"), a.get("period_quarter"))
            for a in items(self.api.get("/compliance/attestations"))
        }
        for quarter, percentage, note in [
            (
                1,
                84.0,
                "Two members short on drill hours; both scheduled for makeup.",
            ),
            (
                2,
                91.5,
                "All operational personnel current. SCBA fit tests re-run in May.",
            ),
        ]:
            if (TODAY.year, quarter) in existing:
                continue
            self.api.post(
                "/compliance/attestations",
                {
                    "period_type": "quarterly",
                    "period_year": TODAY.year,
                    "period_quarter": quarter,
                    "compliance_percentage": percentage,
                    "notes": note,
                    "areas_reviewed": [
                        "Training hours",
                        "Certification currency",
                        "SCBA fit testing",
                        "Driver/operator qualifications",
                    ],
                },
            )

    # -- skills testing ----------------------------------------------

    def _repair_maintenance_types(
        self, path: str, records: list[dict], types: list[dict], intended: dict
    ) -> None:
        """Re-file records this seeder stamped with an arbitrary type.

        Earlier runs picked `types[index % len(types)]`, which walks an
        alphabetical list of department-configurable types — so an oil change
        was filed under "Aerial Device Test" and an HVAC filter change under
        "Backflow Preventer Test". A long-lived demo database keeps those rows
        because the create step only runs when the table is empty.
        """
        by_name = {pick(t, "name"): pick(t, "id") for t in types}
        for record in records:
            record_id = pick(record, "id")
            wanted = intended.get(pick(record, "description"))
            target = by_name.get(wanted) if wanted else None
            current = pick(record, "maintenance_type_id", "maintenanceTypeId")
            if not record_id or not target or current == target:
                continue
            self.api.patch(f"{path}/{record_id}", {"maintenance_type_id": target})

    def _hydrated_templates(self, templates: list[dict]) -> list[dict]:
        """Re-fetch each template so its `sections` are actually present.

        The list endpoint returns `section_count` and `criteria_count` and no
        `sections` at all. Both passes below walk `template["sections"]`, so
        handed the list response they iterate nothing and report success —
        `_repair_criterion_types` had been a silent no-op since it was written,
        which is why the "checkbox" criteria it exists to rewrite were still on
        file. Fetch the detail first, or neither pass does anything.
        """
        hydrated = []
        for template in templates:
            template_id = pick(template, "id")
            if not template_id:
                continue
            try:
                hydrated.append(
                    self.api.get(f"/training/skills-testing/templates/{template_id}")
                )
            except ApiError as exc:
                self.blocked.append(f"hydrate skill template: {exc}")
        return hydrated

    def _repair_criterion_types(self, templates: list[dict]) -> None:
        """Rewrite criteria this seeder stored under a type the scorer ignores.

        Earlier runs wrote `"type": "checkbox"`, which the API accepted and the
        scorer counted for nothing. New criteria are rejected now, but a
        long-lived demo database still holds the old ones, and re-seeding does
        not touch a template that already exists by name.
        """
        for template in templates:
            template_id = pick(template, "id")
            sections = pick(template, "sections") or []
            if not template_id or not isinstance(sections, list):
                continue
            repaired = False
            for section in sections:
                if not isinstance(section, dict):
                    continue
                for criterion in section.get("criteria") or []:
                    if (
                        isinstance(criterion, dict)
                        and criterion.get("type") not in CRITERION_TYPES
                    ):
                        criterion["type"] = "pass_fail"
                        repaired = True
            if repaired:
                self.api.put(
                    f"/training/skills-testing/templates/{template_id}",
                    {"sections": sections},
                )

    def _backfill_missing_criteria(self, templates: list[dict], blueprint) -> None:
        """Add criteria the blueprint has gained since a template was created.

        `seed_skills_testing` skips a template that already exists by name, so
        anything added to the blueprint afterwards never reaches a demo database
        seeded before the change. That is how the sheets ended up with **no
        statement criteria at all** while the blueprint declared two, leaving
        `09-skills-testing.md`'s read-aloud placeholder with nothing to
        photograph.

        Matches on the criterion's label within its section, and appends what is
        missing. It never edits or removes an existing criterion — a sheet an
        examiner has already scored against keeps the steps it was scored with.
        """
        by_name = {t.get("name"): t for t in templates}
        for name, _category, sections in blueprint:
            template = by_name.get(name)
            if not template:
                continue
            template_id = pick(template, "id")
            live_sections = pick(template, "sections") or []
            if not template_id or not isinstance(live_sections, list):
                continue

            wanted = {section_name: entries for section_name, entries in sections}
            appended = False
            for live_section in live_sections:
                if not isinstance(live_section, dict):
                    continue
                entries = wanted.get(live_section.get("name"))
                if not entries:
                    continue
                criteria = live_section.setdefault("criteria", [])
                have = {c.get("label") for c in criteria if isinstance(c, dict)}
                for order, entry in enumerate(entries):
                    payload = criterion_payload(entry, order)
                    if payload["label"] in have:
                        continue
                    payload["sort_order"] = len(criteria)
                    criteria.append(payload)
                    appended = True

            if appended:
                self.api.put(
                    f"/training/skills-testing/templates/{template_id}",
                    {"sections": live_sections},
                )

    def seed_skills_testing(self) -> list[dict]:
        templates = items(
            self.api.get("/training/skills-testing/templates"), "templates"
        )
        self._repair_criterion_types(self._hydrated_templates(templates))
        names = {t.get("name") for t in templates}
        blueprint = [
            (
                "Patient Assessment / Management — Medical",
                "Emergency Medical",
                [
                    (
                        "Scene Size-Up",
                        [
                            "Takes or verbalizes standard precautions",
                            "Determines the scene is safe",
                            "Determines the mechanism of injury / nature of illness",
                            "Determines the number of patients",
                            "Requests additional EMS assistance if necessary",
                        ],
                    ),
                    (
                        "Primary Survey",
                        [
                            "Verbalizes general impression of the patient",
                            "Determines responsiveness / level of consciousness",
                            "Determines chief complaint / apparent life threats",
                            "Assesses airway and breathing",
                            "Assesses circulation",
                        ],
                    ),
                    (
                        "History Taking",
                        [
                            "Obtains history of the present illness",
                            "Obtains past medical history",
                            "Performs a focused physical examination",
                        ],
                    ),
                ],
            ),
            (
                "SCBA Donning — Timed Evolution",
                "Fire Suppression",
                [
                    (
                        "Preparation",
                        [
                            "Inspects cylinder pressure before donning",
                            "Checks harness and straps for damage",
                        ],
                    ),
                    (
                        "Donning",
                        [
                            "Dons the pack without assistance",
                            "Seals the facepiece and checks for leaks",
                            "Activates the PASS device",
                        ],
                    ),
                ],
            ),
            (
                # A weighted sheet, deliberately unlike the two above. The
                # percentage is computed from ``score`` criteria alone, so a
                # department whose sheets are pure pass/fail can never produce
                # a scorecard with per-section point totals — and the guide
                # documents exactly that breakdown, including a section that
                # contributes nothing to the total.
                SCORED_TEMPLATE_NAME,
                "Fire Suppression",
                [
                    (
                        "Safety Briefing",
                        [
                            {
                                "label": (
                                    "Examiner reads the evolution brief to the "
                                    "candidate before the clock starts."
                                ),
                                "type": "statement",
                                "statement_text": (
                                    'You are the nozzle firefighter on a 1¾" '
                                    "line. Advance to the second floor and "
                                    "report conditions."
                                ),
                                "required": False,
                            },
                            {
                                "label": "Full PPE worn, including hood and gloves",
                                "type": "pass_fail",
                            },
                        ],
                    ),
                    (
                        "Hose Advance",
                        [
                            {
                                # The counterpart to the briefing above, and the
                                # reason `starts_timer` exists: this one is read
                                # mid-evolution, so the examiner's tap on
                                # "Start clock & read" is what puts it inside
                                # the time limit.
                                "label": (
                                    "Examiner reads the change of conditions "
                                    "once the candidate is on the line."
                                ),
                                "type": "statement",
                                "statement_text": (
                                    "Conditions have changed — you have heavy "
                                    "smoke to the floor and heat banking down "
                                    "the stairwell."
                                ),
                                "starts_timer": True,
                                "required": False,
                            },
                            {
                                "label": "Selects and stretches the correct line",
                                "type": "score",
                                "max_score": 10,
                                "passing_score": 7,
                                # Points, not a critical gate: a weighted
                                # step contributes its number, and only
                                # critical steps can fail a sheet outright.
                                "required": False,
                            },
                            {
                                "label": "Advances without kinks or snags",
                                "type": "score",
                                "max_score": 10,
                                "passing_score": 7,
                                # Points, not a critical gate: a weighted
                                # step contributes its number, and only
                                # critical steps can fail a sheet outright.
                                "required": False,
                            },
                        ],
                    ),
                    (
                        "Nozzle Operation",
                        [
                            {
                                "label": "Bleeds the line and sets the pattern",
                                "type": "score",
                                "max_score": 10,
                                "passing_score": 7,
                                # Points, not a critical gate: a weighted
                                # step contributes its number, and only
                                # critical steps can fail a sheet outright.
                                "required": False,
                            },
                            {
                                "label": "Maintains control under flow",
                                "type": "score",
                                "max_score": 20,
                                "passing_score": 14,
                                # Points, not a critical gate: a weighted
                                # step contributes its number, and only
                                # critical steps can fail a sheet outright.
                                "required": False,
                            },
                        ],
                    ),
                ],
            ),
        ]

        for name, category, sections in blueprint:
            if name in names:
                continue
            template = self.api.post(
                "/training/skills-testing/templates",
                {
                    "name": name,
                    "description": f"{name} skill sheet, NREMT-style scoring.",
                    "category": category,
                    "passing_percentage": 70,
                    "require_all_critical": True,
                    # The list endpoint hides anything other than
                    # "all_members" from non-officer viewers; "organization"
                    # is not one of the accepted values and made every
                    # template invisible.
                    "visibility": "all_members",
                    "sections": [
                        {
                            "name": section_name,
                            "sort_order": order,
                            "criteria": [
                                criterion_payload(entry, criterion_order)
                                for criterion_order, entry in enumerate(criteria)
                            ],
                        }
                        for order, (section_name, criteria) in enumerate(sections)
                    ],
                },
            )
            # A draft template cannot be selected when starting a test, so the
            # "New Test" page shows nothing until at least one is published.
            self.api.post(
                f"/training/skills-testing/templates/{pick(template, 'id')}/publish"
            )
            templates.append(template)

        self._backfill_missing_criteria(self._hydrated_templates(templates), blueprint)
        return templates

    # -- training records --------------------------------------------

    def _attach_a_certificate(self, records: list[dict]) -> None:
        """Put one certificate on one training record.

        The Attachments panel is documented with a file in it, and nothing
        else in the seeder uploads one — so the panel was an empty state on
        every record in the demo database. Keyed on whether any record already
        carries an attachment rather than on the record count, which is what
        would let a re-seed skip this forever.
        """
        for record in records[:20]:
            if pick(record, "attachments"):
                return
        target = next((r for r in records if pick(r, "id")), None)
        if not target:
            return
        try:
            self.api.post_file(
                f"/training/records/{pick(target, 'id')}/attachments",
                {},
                "completion-certificate.pdf",
                _demo_pdf(
                    "Certificate of Completion",
                    "Oakville Fire Department — course completion record.",
                ),
                "application/pdf",
            )
        except ApiError as exc:
            self.blocked.append(f"training attachment: {exc}")

    def seed_training_submission(self) -> None:
        """A self-reported training submission awaiting officer review.

        The Review Submissions queue reads /training/submissions/pending, and
        nothing seeded one — the queue rendered its empty state under a
        caption describing pending rows. Submitted as the demo member so the
        submitter and the reviewing officer differ; the org default
        (require_approval on, no auto-approve threshold) routes it to
        pending review.
        """
        if items(self.api.get("/training/submissions/pending")):
            return
        member = Api(self.base_url)
        member.login_as(DEMO_MEMBER_USERNAME, DEMO_MEMBER_PASSWORD)
        member.post(
            "/training/submissions",
            {
                "course_name": "ICS-200: Basic Incident Command",
                "training_type": "continuing_education",
                "description": (
                    "Completed the FEMA independent-study course online; "
                    "certificate is in my training file."
                ),
                "completion_date": str(TODAY - timedelta(days=3)),
                "hours_completed": 4.0,
                "instructor": "FEMA Emergency Management Institute",
            },
        )

    def seed_training_records(
        self, members: list[dict], courses: list[dict]
    ) -> list[dict]:
        records = items(self.api.get("/training/records?limit=200"), "records")
        if records or not courses:
            self._attach_a_certificate(records)
            return records
        # Every member gets a spread of completed courses so My Training, the
        # compliance matrix and the hours reports all have something to show.
        #
        # A handful also expire soon, which is what fills the Expiring
        # Certifications view. The general spread cannot do that on its own:
        # its expiry works out to TODAY + 365 - 45*offset - 2*member_index,
        # whose minimum across the whole loop is TODAY + 233 — so for a
        # 22-member department nothing ever landed inside the 90-day window and
        # that view was permanently empty, against a comment claiming otherwise.
        #
        # NEAR_EXPIRY_DAYS is therefore explicit rather than derived, and spans
        # both bands the view counts separately: Critical (<= 30 days) and
        # Warning (31-90).
        NEAR_EXPIRY_DAYS = [12, 26, 45, 78]
        for member_index, member in enumerate(members):
            user_id = pick(member, "id")
            if not user_id:
                continue
            for offset in range(3):
                course = courses[(member_index + offset) % len(courses)]
                completed = TODAY - timedelta(days=45 * offset + member_index * 5)
                hours = pick(course, "duration_hours", "durationHours") or 8
                payload = {
                    "user_id": user_id,
                    "course_id": pick(course, "id"),
                    "course_name": course.get("name") or "Department Training",
                    "course_code": course.get("code"),
                    "training_type": course.get("training_type")
                    or course.get("trainingType")
                    or "continuing_education",
                    "hours_completed": hours,
                    "credit_hours": hours,
                    "completion_date": str(completed),
                    "expiration_date": str(
                        # One record per member, for the first few members,
                        # expires inside the 90-day window the view filters on.
                        TODAY + timedelta(days=NEAR_EXPIRY_DAYS[member_index])
                        if offset == 0 and member_index < len(NEAR_EXPIRY_DAYS)
                        else completed + timedelta(days=365 + member_index * 3)
                    ),
                    "status": "completed",
                    "passed": True,
                    "instructor": "Capt. Owen Kittredge",
                    "location": "Training & Administration Center",
                    "rank_at_completion": member.get("rank"),
                }
                records.append(self.api.post("/training/records", payload))
        return records

    # -- event RSVPs --------------------------------------------------

    def member_session(self, base_url: str, user_id: str, username: str) -> Api:
        """A signed-in session for an ordinary member, usable for API calls.

        Signing in is not enough on its own. An account an administrator
        created carries a must-change-password flag, and while the login
        succeeds, every authenticated call afterwards is refused with a 403
        until the flag clears — so the session looks established and then
        refuses the very next request.

        The flag is read from ``/auth/me`` rather than probed for with a 403,
        because ``/auth/me`` is one of the handful of paths deliberately exempt
        from that gate (``_MUST_CHANGE_PW_ALLOWED_SUFFIXES`` in
        ``app/api/dependencies.py``) — precisely so a blocked user can still
        discover their own state. Probing it would always come back clean.
        """

        def clear_forced_change() -> Api:
            # Every member reaches this, not just the ones seeded before the
            # demo password existed: `POST /users` sets must_change_password
            # unconditionally, so the password supplied at creation is correct
            # and still flagged. Paced rather than raced — see ADMIN_RESET_THROTTLE.
            ADMIN_RESET_THROTTLE.wait()
            self.api.post(
                f"/users/{user_id}/reset-password",
                {"new_password": DEMO_MEMBER_PASSWORD, "force_change": False},
            )
            fresh = Api(base_url)
            fresh.login_as(username, DEMO_MEMBER_PASSWORD)
            return fresh

        session = Api(base_url)
        try:
            session.login_as(username, DEMO_MEMBER_PASSWORD)
        except ApiError:
            # Members seeded before the demo password was set at creation
            # need one.
            return clear_forced_change()

        me = session.get("/auth/me") or {}
        if pick(me, "must_change_password", "mustChangePassword"):
            return clear_forced_change()
        return session

    def seed_event_rsvps(
        self, base_url: str, events: list[dict], members: list[dict]
    ) -> None:
        # There is no admin "RSVP on behalf of" endpoint — `POST /events/{id}/rsvp`
        # always records the *calling* user, and the override route only edits an
        # RSVP that already exists. So each member answers for themselves, which
        # means giving the demo accounts a password and signing in as each one.
        # These are local demo fixtures in a throwaway database, never real
        # accounts.
        # Events created without an explicit allowed_rsvp_statuses list accept
        # only going / not_going, so "maybe" is deliberately absent here.
        statuses = ["going", "going", "going", "going", "not_going"]

        # Skip the clearly-finished events up front; the per-call handler
        # below catches the rest, since the list response omits rsvp_deadline.
        def still_open(event: dict) -> bool:
            # Not every event collects RSVPs — the guest sign-in event is an
            # open house, and answering for it is refused outright. Only an
            # explicit False excludes an event, so a list response that omits
            # the field does not silently drop every event on the floor.
            if pick(event, "requires_rsvp", "requiresRsvp") is False:
                return False
            ends = str(pick(event, "end_datetime", "endDatetime") or "")
            deadline = str(pick(event, "rsvp_deadline", "rsvpDeadline") or "")
            now = iso(NOW)
            return ends > now and (not deadline or deadline > now)

        event_ids = [pick(e, "id") for e in events if pick(e, "id") and still_open(e)]
        if not event_ids:
            return

        for member_index, member in enumerate(password_login_members(members)):
            user_id = pick(member, "id")
            username = member.get("username")
            if not user_id:
                continue

            member_api = self.member_session(base_url, user_id, username)
            for event_index, event_id in enumerate(event_ids):
                try:
                    member_api.post(
                        f"/events/{event_id}/rsvp",
                        {
                            "status": statuses[
                                (event_index + member_index) % len(statuses)
                            ],
                            "notes": "Confirmed with the duty officer.",
                        },
                    )
                except ApiError as exc:
                    # The list response omits rsvp_deadline, so the filter above
                    # cannot always tell whether answering is still allowed. Let
                    # the app be the authority: a refusal on those grounds is the
                    # rule working, not a seeding failure.
                    if exc.code == 400 and RSVP_CLOSED.search(exc.detail):
                        continue
                    # Same reasoning for a cohort class: its event belongs to a
                    # pipeline phase, and a member still in an earlier phase is
                    # refused with a 409 phase gate. That is the feature.
                    if exc.code == 409 and "phase_gate" in exc.detail:
                        continue
                    raise

    # -- skills tests --------------------------------------------------

    def _cancel_one_test(self, tests: list[dict]) -> None:
        """Close out one unfinished test, so the records tab shows all three.

        Cancelling is not voiding: a cancelled test was never scored, so there
        is no result to withdraw. It is the state an evaluation reaches when the
        candidate withdrew or the weather stopped the drill, and the records tab
        renders it differently from both an unfinished test and a passed one.
        """
        statuses = {pick(t, "status") for t in tests}
        if "cancelled" in statuses:
            return
        candidate = next(
            (t for t in tests if pick(t, "status") == "draft" and pick(t, "id")),
            None,
        )
        if not candidate:
            return
        try:
            self.api.post(
                f"/training/skills-testing/tests/{pick(candidate, 'id')}/cancel",
                {
                    "reason": (
                        "Called out to a working fire partway through — "
                        "rescheduled for the next drill night."
                    )
                },
            )
        except ApiError as exc:
            self.blocked.append(f"cancel skills test: {exc}")

    #: One practice attempt is documentary — the member's results list is
    #: captioned as showing official attempts *and* a practice one, so the
    #: badge needs an example. More than one is litter.
    PRACTICE_TESTS_KEPT = 1

    def _prune_practice_tests(self) -> None:
        """Drop practice tests the capture runs left behind.

        Scoring a test is not a read: `09-16`/`09-18` drive the real scoring
        screen, and each run files another practice attempt against the demo
        member. They sort newest-first, so after a dozen runs the member's
        results panel is a wall of identical "Practice · Passed 100%" rows and
        the official attempts its caption promises are pushed out of frame.

        Only practice records are touched, and only through the route that
        refuses anything else — an official result may carry a certification,
        which is why the API voids those rather than deleting them.
        """
        practice = [
            test
            for test in items(
                self.api.get(
                    "/training/skills-testing/tests" "?limit=200&include_practice=true"
                ),
                "tests",
            )
            if pick(test, "is_practice", "isPractice")
        ]
        if len(practice) <= self.PRACTICE_TESTS_KEPT:
            return
        practice.sort(
            key=lambda t: str(pick(t, "created_at", "createdAt") or ""), reverse=True
        )
        for test in practice[self.PRACTICE_TESTS_KEPT :]:
            try:
                self.api.delete(f"/training/skills-testing/tests/{pick(test, 'id')}")
            except ApiError as exc:
                self.blocked.append(f"practice test cleanup: {exc}")
                return

    def seed_skills_tests(
        self, templates: list[dict], members: list[dict]
    ) -> list[dict]:
        self._prune_practice_tests()
        tests = items(self.api.get("/training/skills-testing/tests"), "tests")
        if tests:
            # Keyed on the *statuses* present, not on "are there any". The
            # records tab is documented as showing three kinds of row at a
            # glance — unfinished, completed, cancelled — and a database seeded
            # before this step existed has only the first two.
            self._cancel_one_test(tests)
            return tests
        if not templates or not members:
            return tests

        # The seeder posts as the demo administrator, so that account is the
        # examiner on every test it creates. Skills testing refuses a test where
        # the examiner is also the candidate — separation of duties, since a
        # passing test credits a training requirement — and the administrator is
        # in the member list like anyone else. Without this filter the step
        # raised on whichever iteration reached them and no skills tests were
        # seeded at all, leaving the skills-testing guide's screenshots to be
        # captured against an empty module.
        examiner_id = next(
            (
                pick(m, "id")
                for m in members
                if pick(m, "username") == DEMO_ADMIN_USERNAME
            ),
            None,
        )
        candidates = [m for m in members if pick(m, "id") != examiner_id]

        for index, member in enumerate(candidates[:6]):
            candidate_id = pick(member, "id")
            template_id = pick(templates[index % len(templates)], "id")
            if not candidate_id or not template_id:
                continue
            tests.append(
                self.api.post(
                    "/training/skills-testing/tests",
                    {
                        "template_id": template_id,
                        "candidate_id": candidate_id,
                        "notes": "Scheduled during the quarterly skills night.",
                    },
                )
            )
        return tests

    def seed_scored_test(
        self, templates: list[dict], members: list[dict]
    ) -> dict | None:
        """One completed test on the weighted sheet, scored below full marks.

        The percentage is computed from ``score`` criteria alone, so the two
        NREMT-style sheets above — pass/fail throughout — can only ever produce
        a scorecard reading "no percentage could be calculated", with every
        section marked as not counting. This is the one test that exercises the
        breakdown the guide documents: per-section point totals, a section that
        contributes none, and an overall percentage.
        """
        scored_template = next(
            (t for t in templates if pick(t, "name") == SCORED_TEMPLATE_NAME), None
        )
        if not scored_template or not members:
            return None
        template_id = pick(scored_template, "id")

        # Identified by the state that makes it this fixture, not by "any
        # completed test on the weighted template": five seeded tests share that
        # template — the pending-validation pair, the failed one, an in-progress
        # one and this — so the looser guard returned whichever the API listed
        # first and the scorecard fixture was never rebuilt, silently keeping
        # whatever numbers an older run had left.
        #
        # Deliberately not matched on SCORECARD_TEST_NOTE, which would read
        # better: the list response has no `notes` field, so that guard can
        # never match and the seeder builds one more validated result on every
        # run. It did, twice, before this was caught. The note stays on the
        # record for whoever opens it; the guard uses what the list actually
        # carries.
        #
        # A validated result cannot be deleted, only voided, so a rebuilt
        # fixture leaves its predecessor behind — hence the voided check.
        existing = items(
            self.api.get("/training/skills-testing/tests?limit=200"), "tests"
        )
        candidate_name = None
        for member in members:
            if pick(member, "username") == DEMO_MEMBER_USERNAME:
                candidate_name = (
                    f"{pick(member, 'first_name', 'firstName') or ''} "
                    f"{pick(member, 'last_name', 'lastName') or ''}"
                ).strip()
                break
        for test in existing:
            if (
                pick(test, "template_id", "templateId") == template_id
                and pick(test, "completed_at", "completedAt")
                and pick(test, "validated_at", "validatedAt")
                and not pick(test, "voided_at", "voidedAt")
                and pick(test, "result") == "pass"
                and (
                    not candidate_name
                    or pick(test, "candidate_name", "candidateName") == candidate_name
                )
            ):
                return test

        examiner_id = next(
            (
                pick(m, "id")
                for m in members
                if pick(m, "username") == DEMO_ADMIN_USERNAME
            ),
            None,
        )
        candidate = next(
            (
                m
                for m in members
                if pick(m, "username") == DEMO_MEMBER_USERNAME
                and pick(m, "id") != examiner_id
            ),
            None,
        )
        if not candidate or not template_id:
            return None

        test = self.api.post(
            "/training/skills-testing/tests",
            {
                "template_id": template_id,
                "candidate_id": pick(candidate, "id"),
                "notes": SCORECARD_TEST_NOTE,
            },
        )
        test_id = pick(test, "id")
        if not test_id:
            return None

        # Deliberately short of full marks on two steps, so the section totals
        # differ from one another and the percentage is not a flat 100.
        #
        # One of them is also marked *failed* while the test still passes
        # overall. That combination is the whole of the "a failed step deducts
        # points without failing the test" rule, and it is what the scorecard
        # print captures teach: 9 + 5 + 10 + 15 = 39 of 50, which is 78% and
        # clears the 70% mark with a failed row visible in the breakdown.
        # Keep the arithmetic above the pass mark if these numbers are edited —
        # dropping under it turns the fixture into a second failed test, which
        # `seed_failed_test` already provides and which teaches the opposite.
        awarded = {
            "Selects and stretches the correct line": 9,
            "Advances without kinks or snags": 5,
            "Bleeds the line and sets the pattern": 10,
            "Maintains control under flow": 15,
        }
        FAILED_STEP = "Advances without kinks or snags"

        detail = self.api.get(f"/training/skills-testing/tests/{test_id}")
        section_results = []
        for si, section in enumerate(detail.get("template_sections") or []):
            if not isinstance(section, dict):
                continue
            criteria_results = []
            for ci, criterion in enumerate(section.get("criteria") or []):
                if (
                    not isinstance(criterion, dict)
                    or criterion.get("type") == "statement"
                ):
                    continue
                label = criterion.get("label", "")
                score = awarded.get(label)
                criteria_results.append(
                    {
                        "criterion_id": f"criterion-{si}-{ci}",
                        "criterion_label": label,
                        "passed": label != FAILED_STEP,
                        "score": score,
                        "notes": (
                            "Kinked at the stairwell turn and had to be reset."
                            if label == FAILED_STEP
                            else None
                        ),
                    }
                )
            section_results.append(
                {
                    "section_id": f"section-{si}",
                    "section_name": section.get("name", f"Section {si + 1}"),
                    "criteria_results": criteria_results,
                }
            )

        self.api.put(
            f"/training/skills-testing/tests/{test_id}",
            {
                "status": "in_progress",
                "section_results": section_results,
                "elapsed_seconds": 214,
            },
        )
        return self.api.post(f"/training/skills-testing/tests/{test_id}/complete")

    def seed_failed_test(
        self, templates: list[dict], members: list[dict]
    ) -> dict | None:
        """One completed test that did not pass, on the weighted sheet.

        Every seeded test passed, so the result screen could only ever be
        photographed green — and the guide's whole Result Determination section
        is about the other outcome. This one fails both ways at once, which is
        the case worth showing: the percentage lands under the passing mark
        *and* a critical step was marked failed, so an examiner can see which of
        the two sank it.
        """
        scored_template = next(
            (t for t in templates if pick(t, "name") == SCORED_TEMPLATE_NAME), None
        )
        if not scored_template or not members:
            return None
        template_id = pick(scored_template, "id")

        existing = items(
            self.api.get("/training/skills-testing/tests?limit=100"), "tests"
        )
        for test in existing:
            if pick(test, "result") == "fail":
                return test

        examiner_id = next(
            (
                pick(m, "id")
                for m in members
                if pick(m, "username") == DEMO_ADMIN_USERNAME
            ),
            None,
        )
        candidate = next(
            (
                m
                for m in members
                if pick(m, "username") == FAILED_TEST_CANDIDATE_USERNAME
                and pick(m, "id") != examiner_id
            ),
            None,
        )
        if not candidate or not template_id:
            return None

        test = self.api.post(
            "/training/skills-testing/tests",
            {
                "template_id": template_id,
                "candidate_id": pick(candidate, "id"),
                "notes": "First attempt. Re-test scheduled.",
            },
        )
        test_id = pick(test, "id")
        if not test_id:
            return None

        # Under the passing mark on points, and the critical step failed — the
        # two independent ways to fail, so the screen names both.
        awarded = {
            "Selects and stretches the correct line": 5,
            "Advances without kinks or snags": 4,
            "Bleeds the line and sets the pattern": 6,
            "Maintains control under flow": 9,
        }
        failed_labels = {"Full PPE worn, including hood and gloves"}
        notes = {
            "Advances without kinks or snags": (
                "Line kinked twice on the stairwell; lost time clearing it."
            ),
            "Full PPE worn, including hood and gloves": (
                "Hood not deployed before entry."
            ),
        }

        detail = self.api.get(f"/training/skills-testing/tests/{test_id}")
        section_results = []
        for si, section in enumerate(detail.get("template_sections") or []):
            if not isinstance(section, dict):
                continue
            criteria_results = []
            for ci, criterion in enumerate(section.get("criteria") or []):
                if (
                    not isinstance(criterion, dict)
                    or criterion.get("type") == "statement"
                ):
                    continue
                label = criterion.get("label", "")
                criteria_results.append(
                    {
                        "criterion_id": f"criterion-{si}-{ci}",
                        "criterion_label": label,
                        "passed": label not in failed_labels,
                        "score": awarded.get(label),
                        "notes": notes.get(label),
                    }
                )
            section_results.append(
                {
                    "section_id": f"section-{si}",
                    "section_name": section.get("name", f"Section {si + 1}"),
                    "criteria_results": criteria_results,
                }
            )

        self.api.put(
            f"/training/skills-testing/tests/{test_id}",
            {
                "status": "in_progress",
                "section_results": section_results,
                "elapsed_seconds": 337,
            },
        )
        return self.api.post(f"/training/skills-testing/tests/{test_id}/complete")

    def _snapshot_is_current(self, test: dict, template: dict) -> bool:
        """Does a test's snapshotted sheet still hold every criterion the
        template does?

        Compared by criterion label per section, which is what the backfill
        matches on. Extra criteria in the snapshot are fine — a template can
        lose a step without invalidating a test already scored against it.
        """
        detail = self.api.get(f"/training/skills-testing/tests/{pick(test, 'id')}")
        snapshot = {
            section.get("name"): {
                criterion.get("label") for criterion in section.get("criteria") or []
            }
            for section in detail.get("template_sections") or []
        }
        live = self.api.get(
            f"/training/skills-testing/templates/{pick(template, 'id')}"
        )
        for section in live.get("sections") or []:
            have = snapshot.get(section.get("name"))
            if have is None:
                return False
            for criterion in section.get("criteria") or []:
                if criterion.get("label") not in have:
                    return False
        return True

    def seed_in_progress_test(
        self, templates: list[dict], members: list[dict]
    ) -> dict | None:
        """One test stopped partway through, on the weighted sheet.

        The scoring screen only reads as documented when the sheet is partly
        filled: the section chips show complete against outstanding, the header
        counts scored against total, and a scored criterion sits above an
        unscored one. Every other test the seeder makes is either untouched or
        finished, and neither shows any of that.
        """
        scored_template = next(
            (t for t in templates if pick(t, "name") == SCORED_TEMPLATE_NAME), None
        )
        if not scored_template or not members:
            return None
        template_id = pick(scored_template, "id")

        existing = items(self.api.get("/training/skills-testing/tests"), "tests")
        for test in existing:
            if (
                pick(test, "template_id", "templateId") == template_id
                and pick(test, "status") == "in_progress"
            ):
                # A test snapshots the sheet it started with — deliberately, so
                # a candidate is scored against what they were shown. That also
                # means a test left over from before the template gained a
                # criterion never shows it, and the screenshot of that criterion
                # cannot be taken. Cancel a stale one and let a fresh test be
                # made below; nobody is mid-evaluation in a demo database.
                if self._snapshot_is_current(test, scored_template):
                    return test
                try:
                    self.api.post(
                        f"/training/skills-testing/tests/{pick(test, 'id')}/cancel",
                        {"reason": "Superseded by an updated skill sheet."},
                    )
                except ApiError as exc:
                    self.blocked.append(f"cancel stale in-progress test: {exc}")
                    return test
                break

        examiner_id = next(
            (
                pick(m, "id")
                for m in members
                if pick(m, "username") == DEMO_ADMIN_USERNAME
            ),
            None,
        )
        candidate = next(
            (
                m
                for m in members
                if pick(m, "id") != examiner_id
                and pick(m, "username") != DEMO_MEMBER_USERNAME
            ),
            None,
        )
        if not candidate or not template_id:
            return None

        test = self.api.post(
            "/training/skills-testing/tests",
            {
                "template_id": template_id,
                "candidate_id": pick(candidate, "id"),
                "notes": "Paused at the nozzle section — hydrant crew held up.",
            },
        )
        test_id = pick(test, "id")
        if not test_id:
            return None

        detail = self.api.get(f"/training/skills-testing/tests/{test_id}")
        sections = detail.get("template_sections") or []

        # Everything up to the last section is filled; the last is left with one
        # step scored and one blank. That is what puts a complete chip, an
        # active chip and an outstanding count on the same screen.
        last_index = len(sections) - 1
        section_results = []
        for si, section in enumerate(sections):
            if not isinstance(section, dict):
                continue
            criteria = [
                (ci, c)
                for ci, c in enumerate(section.get("criteria") or [])
                if isinstance(c, dict) and c.get("type") != "statement"
            ]
            if si == last_index:
                criteria = criteria[:1]
            criteria_results = [
                {
                    "criterion_id": f"criterion-{si}-{ci}",
                    "criterion_label": criterion.get("label", ""),
                    "passed": True,
                    "score": criterion.get("max_score"),
                    "notes": None,
                }
                for ci, criterion in criteria
            ]
            section_results.append(
                {
                    "section_id": f"section-{si}",
                    "section_name": section.get("name", f"Section {si + 1}"),
                    "criteria_results": criteria_results,
                }
            )

        return self.api.put(
            f"/training/skills-testing/tests/{test_id}",
            {
                "status": "in_progress",
                "section_results": section_results,
                "elapsed_seconds": 148,
            },
        )

    def seed_pending_validation_test(
        self, base_url: str, templates: list[dict], members: list[dict]
    ) -> dict | None:
        """One official result sitting in the officer's review queue.

        This is the state the whole validation feature is about, and nothing
        else in the seeder can produce it: the seeder acts as the administrator,
        and an officer's own completion validates in the same step, so every
        test it creates lands already signed off. The queue, the badge on the
        summary dashboard, and the candidate's "awaiting validation" row all
        need a test run by somebody *without* ``training.manage``.

        So this signs in as an ordinary member, has them examine a second
        member, scores the sheet and submits it. The result is complete and
        scored but unvalidated, which is exactly what an officer sees.
        """
        pending = items(
            self.api.get("/training/skills-testing/tests?pending_validation=true"),
            "tests",
        )
        if pending:
            return pending[0]

        by_username = {m.get("username"): m for m in members}
        candidate = by_username.get(DEMO_MEMBER_USERNAME)
        examiner = by_username.get(DEMO_PEER_EXAMINER_USERNAME)
        published = [t for t in templates if pick(t, "status") == "published"]
        if not candidate or not examiner or not published:
            return None

        # The examiner must not hold training.manage, or their submission
        # validates itself and this step quietly produces the opposite of what
        # it exists for: the step reports success and three screenshots fail
        # much later waiting on a queue that was never non-empty.
        #
        # Read the rank back from the API rather than from `members`. That list
        # is snapshotted before `seed_member_changes` applies promotions, so it
        # still holds pre-promotion ranks — and promoting this account is
        # precisely the case this guard is here to catch.
        examiner_id = pick(examiner, "id")
        # /with-roles, because there is no bare GET /users/{id} route — that
        # path 404s, the ApiError fails this step on every run, and the queue
        # goes back to being empty.
        live = self.api.get(f"/users/{examiner_id}/with-roles") if examiner_id else {}
        live_rank = pick(live or {}, "rank") or pick(examiner, "rank") or ""
        if live_rank in OFFICER_RANKS:
            # ApiError rather than a bare RuntimeError: `step()` catches only
            # ApiError, so anything else aborts the whole run and every later
            # step — inventory, documents, elections, finance — never executes.
            # This must be loud, not fatal.
            raise ApiError(
                "GUARD",
                "seed_pending_validation_test",
                0,
                f"peer examiner {DEMO_PEER_EXAMINER_USERNAME!r} holds rank "
                f"{live_rank!r}, which grants training.manage — their own "
                "completion would self-validate, leaving the validation queue "
                "empty. Pick a non-officer.",
            )

        peer = self.member_session(
            base_url,
            pick(examiner, "id"),
            DEMO_PEER_EXAMINER_USERNAME,
        )

        test = peer.post(
            "/training/skills-testing/tests",
            {
                "template_id": pick(published[0], "id"),
                "candidate_id": pick(candidate, "id"),
                "notes": "Run at the Saturday drill; sending up for sign-off.",
            },
        )
        test_id = pick(test, "id")
        if not test_id:
            return None

        # The sections come back on the test rather than being fetched from the
        # template, because a test is scored against the snapshot frozen at its
        # creation — which is what the scorer and the emailed scorecard both
        # read. Building results from the live template would drift the moment
        # anyone edited it.
        detail = peer.get(f"/training/skills-testing/tests/{test_id}")
        sections = detail.get("template_sections") or []

        # Criterion identity is positional — `section-{si}` / `criterion-{si}-{ci}`
        # is the convention the API, the scorer and the scorecard renderer all
        # share. Statement criteria are skipped for the same reason the scorer
        # skips them: they carry prose, not a score.
        section_results = []
        for si, section in enumerate(sections):
            if not isinstance(section, dict):
                continue
            criteria_results = []
            for ci, criterion in enumerate(section.get("criteria") or []):
                if (
                    not isinstance(criterion, dict)
                    or criterion.get("type") == "statement"
                ):
                    continue
                # One deliberate miss, so the scorecard shows a mixed result
                # rather than a uniform wall of passes. It is a non-critical
                # criterion, so the test still passes overall.
                missed = si == 1 and ci == 2 and not criterion.get("required")
                criteria_results.append(
                    {
                        "criterion_id": f"criterion-{si}-{ci}",
                        "criterion_label": criterion.get("label", ""),
                        "passed": not missed,
                        "score": 0 if missed else criterion.get("max_score", 1),
                        "notes": "Prompted once before continuing." if missed else None,
                    }
                )
            section_results.append(
                {
                    "section_id": f"section-{si}",
                    "section_name": section.get("name", f"Section {si + 1}"),
                    "criteria_results": criteria_results,
                }
            )

        peer.put(
            f"/training/skills-testing/tests/{test_id}",
            {
                "status": "in_progress",
                "section_results": section_results,
                # A plausible stopwatch reading. Wall clock is only a fallback,
                # and a seeded test would otherwise record the seconds between
                # two API calls.
                "elapsed_seconds": 372,
            },
        )
        return peer.post(f"/training/skills-testing/tests/{test_id}/complete")

    def seed_skill_test_result_mix(
        self,
        base_url: str,
        templates: list[dict],
        members: list[dict],
    ) -> dict | None:
        """Give the demo member a failed official test and a practice one.

        Every seeded skill test passed and none was practice, so the member's
        Skills Tests list on My Training was 51 identical PASS rows — it could
        not show what a failure looks like, and the Practice badge existed only
        in the code. Both states are what the list is *for*: a practice attempt
        never counts, and a failure is the case a member most needs to find.

        A test fails on a **required** criterion, not on any miss: the existing
        seeding deliberately drops one non-required criterion and still passes
        overall, which is why that test cannot be reused for this.
        """
        published = [t for t in templates if pick(t, "status") == "published"]
        candidate = next(
            (m for m in members if m.get("username") == DEMO_MEMBER_USERNAME), None
        )
        examiner = next(
            (m for m in members if m.get("username") == DEMO_PEER_EXAMINER_USERNAME),
            None,
        )
        if not published or not candidate or not examiner:
            return None

        existing = items(
            self.api.get("/training/skills-testing/tests?include_practice=true"),
            "tests",
        )
        candidate_id = pick(candidate, "id")
        mine = [t for t in existing if pick(t, "candidate_id") == candidate_id]
        # Idempotent on the two states, not on a count: a re-run must not keep
        # adding failures to the member's record.
        needs_practice = not any(pick(t, "is_practice") for t in mine)
        needs_failure = not any(
            pick(t, "result") == "fail" and not pick(t, "is_practice") for t in mine
        )
        if not needs_practice and not needs_failure:
            return None

        peer = self.member_session(
            base_url, pick(examiner, "id"), DEMO_PEER_EXAMINER_USERNAME
        )
        template_id = pick(published[0], "id")

        created = None
        for is_practice, should_fail, note in (
            (True, False, "Practice run before the formal attempt."),
            (False, True, "Missed a required step; rebooked for a retest."),
        ):
            if is_practice and not needs_practice:
                continue
            if not is_practice and not needs_failure:
                continue
            created = self._score_skill_test(
                peer, template_id, candidate_id, is_practice, should_fail, note
            )
        return created

    def _score_skill_test(
        self,
        peer: Api,
        template_id: str,
        candidate_id: str,
        is_practice: bool,
        should_fail: bool,
        note: str,
    ) -> dict | None:
        """Create, score and complete one skill test."""
        test = peer.post(
            "/training/skills-testing/tests",
            {
                "template_id": template_id,
                "candidate_id": candidate_id,
                "is_practice": is_practice,
                "notes": note,
            },
        )
        test_id = pick(test, "id")
        if not test_id:
            return None

        # Scored against the snapshot frozen on the test, not the live template.
        detail = peer.get(f"/training/skills-testing/tests/{test_id}")
        sections = detail.get("template_sections") or []
        failed_one = False
        section_results = []
        for si, section in enumerate(sections):
            if not isinstance(section, dict):
                continue
            criteria_results = []
            for ci, criterion in enumerate(section.get("criteria") or []):
                if (
                    not isinstance(criterion, dict)
                    or criterion.get("type") == "statement"
                ):
                    continue
                # The first *required* criterion is the one dropped, because a
                # miss on an optional one leaves the test passing overall.
                miss = (
                    should_fail and not failed_one and bool(criterion.get("required"))
                )
                if miss:
                    failed_one = True
                criteria_results.append(
                    {
                        "criterion_id": f"criterion-{si}-{ci}",
                        "criterion_label": criterion.get("label", ""),
                        "passed": not miss,
                        "score": 0 if miss else criterion.get("max_score", 1),
                        "notes": "Not demonstrated to standard." if miss else None,
                    }
                )
            section_results.append(
                {
                    "section_id": f"section-{si}",
                    "section_name": section.get("name", f"Section {si + 1}"),
                    "criteria_results": criteria_results,
                }
            )

        peer.put(
            f"/training/skills-testing/tests/{test_id}",
            {
                "status": "in_progress",
                "section_results": section_results,
                "elapsed_seconds": 291 if is_practice else 358,
            },
        )
        return peer.post(f"/training/skills-testing/tests/{test_id}/complete")

    def seed_test_viewer(self, members: list[dict]) -> dict | None:
        """One named viewer on one test, so the Viewers panel is not empty.

        A grant is per test rather than per template, so there is no way to
        produce this by configuring a template — it has to be attached to a
        specific evaluation.
        """
        # Fetched here rather than taken from the caller: the completed test
        # this needs is created by the step above, so a list captured earlier
        # holds only the drafts.
        tests = items(self.api.get("/training/skills-testing/tests"), "tests")

        # A completed, non-practice test specifically. The panel only renders on
        # the review view of a finished official test, so granting on a draft
        # produces a row in the database that no screen ever shows.
        target = next(
            (
                t
                for t in tests
                if pick(t, "id")
                and pick(t, "status") == "completed"
                and not pick(t, "is_practice")
            ),
            None,
        )
        if not target:
            return None

        test_id = pick(target, "id")
        existing = items(
            self.api.get(f"/training/skills-testing/tests/{test_id}/viewers"),
            "viewers",
        )
        if existing:
            return existing[0]

        # Anyone but the two people already party to the test: the API rejects
        # granting to the candidate, and the examiner always sees what they
        # recorded, so either would be a no-op.
        excluded = {pick(target, "candidate_id"), pick(target, "examiner_id")}
        viewer = next(
            (
                m
                for m in members
                if pick(m, "id") not in excluded
                and m.get("username") != DEMO_ADMIN_USERNAME
                and m.get("username") != TWO_FACTOR_USERNAME
            ),
            None,
        )
        if not viewer:
            return None

        # user_id is the whole payload — the grant carries no note of its own.
        return self.api.post(
            f"/training/skills-testing/tests/{test_id}/viewers",
            {"user_id": pick(viewer, "id")},
        )

    # -- dues ---------------------------------------------------------

    def seed_dues(self, fiscal_year: dict | None) -> list[dict]:
        schedules = items(self.api.get("/finance/dues-schedules"), "schedules")
        name = f"{TODAY.year} Annual Member Dues"
        if not any(s.get("name") == name for s in schedules):
            payload = {
                "name": name,
                "amount": 120,
                "frequency": "annual",
                "due_date": str(date(TODAY.year, 3, 1)),
                "grace_period_days": 30,
                "late_fee_amount": 15,
                "notes": "Billed annually; waivers handled case by case.",
            }
            if fiscal_year and pick(fiscal_year, "id"):
                payload["fiscal_year_id"] = pick(fiscal_year, "id")
            schedule = self.api.post("/finance/dues-schedules", payload)
            schedules.append(schedule)
            # Generating turns the schedule into one dues row per member,
            # which is what the Dues Management table lists.
            self.api.post(f"/finance/dues-schedules/{pick(schedule, 'id')}/generate")
        return schedules

    # -- forms -------------------------------------------------------

    def seed_forms(self) -> list[dict]:
        forms = items(self.api.get("/forms"), "forms")
        names = {f.get("name") for f in forms}
        blueprint = [
            (
                "Incident Near-Miss Report",
                "safety",
                [
                    ("Date of incident", "date", True, None),
                    ("Apparatus involved", "text", False, None),
                    ("What happened?", "textarea", True, None),
                    (
                        "Severity",
                        "select",
                        True,
                        ["Minor", "Moderate", "Serious", "Critical"],
                    ),
                    ("Suggested corrective action", "textarea", False, None),
                ],
            ),
            (
                "Turnout Gear Sizing",
                "operations",
                [
                    ("Full name", "text", True, None),
                    ("Coat size", "select", True, ["S", "M", "L", "XL", "XXL"]),
                    ("Pant inseam (in)", "number", True, None),
                    ("Boot size", "text", True, None),
                    ("Notes for the quartermaster", "textarea", False, None),
                ],
            ),
            (
                "Community Event Request",
                "other",
                [
                    ("Organization name", "text", True, None),
                    ("Contact email", "email", True, None),
                    ("Requested date", "date", True, None),
                    (
                        "Type of appearance",
                        "select",
                        True,
                        ["Station tour", "Truck visit", "Fire safety talk", "Standby"],
                    ),
                    ("Expected attendance", "number", False, None),
                ],
            ),
        ]

        for name, category, fields in blueprint:
            if name in names:
                continue
            forms.append(
                self.api.post(
                    "/forms",
                    {
                        "name": name,
                        "description": f"{name} — submitted by members online.",
                        "category": category,
                        "is_public": name.startswith("Community"),
                        "require_authentication": not name.startswith("Community"),
                        "notify_on_submission": True,
                        "fields": [
                            {
                                "label": label,
                                "field_type": field_type,
                                "required": required,
                                "sort_order": order,
                                **(
                                    {
                                        "options": [
                                            {"value": option.lower(), "label": option}
                                            for option in options
                                        ]
                                    }
                                    if options
                                    else {}
                                ),
                            }
                            for order, (
                                label,
                                field_type,
                                required,
                                options,
                            ) in enumerate(fields)
                        ],
                    },
                )
            )

        # Publish the public one. `/f/{public_slug}` serves published forms with
        # public access only, so a draft renders as "not found" — which is the
        # page the public-form screenshots would otherwise capture, and the page
        # a reader following the guide would hit if they copied the link before
        # publishing.
        for form in forms:
            if not form.get("is_public") or form.get("status") == "published":
                continue
            form_id = pick(form, "id")
            if not form_id:
                continue
            published = self.api.post(f"/forms/{form_id}/publish")
            form.update(
                {
                    "status": pick(published, "status") or "published",
                    "public_slug": pick(published, "public_slug")
                    or form.get("public_slug"),
                }
            )
        return forms

    # -- forms: responses --------------------------------------------

    #: Sample answers per field type. Each form is submitted several times and
    #: the index rotates through these, so the submissions table shows varied
    #: rows rather than the same answer repeated.
    FORM_ANSWERS: dict[str, list[Any]] = {
        "text": ["Engine 1", "Ladder 4", "Rescue 2", "Medic 3"],
        "textarea": [
            "Crew reported the issue at shift change; no injuries.",
            "Noticed during the weekly check, corrected on the spot.",
            "Escalated to the safety officer for review.",
            "Documented for the next company officer meeting.",
        ],
        "number": [12, 32, 8, 45],
        "email": [
            "outreach@oakvillecivic.example.org",
            "pto@oakvilleschools.example.org",
            "events@oakvillelibrary.example.org",
            "info@oakvillechamber.example.org",
        ],
    }

    #: Answers keyed on a word in the field's label, checked before the
    #: type-based pool above. A generic text answer is a unit designation, which
    #: reads as nonsense under "Organization name" on the community event form —
    #: the expanded submission row shows the label beside the value, so a
    #: mismatch is plainly visible in the guides.
    FORM_ANSWERS_BY_LABEL: list[tuple[tuple[str, ...], list[Any]]] = [
        (
            ("organization", "company", "agency"),
            [
                "Oakville Civic Association",
                "Oakville Elementary PTO",
                "Oakville Public Library",
                "Oakville Chamber of Commerce",
            ],
        ),
        (
            ("full name", "contact name", "your name"),
            ["Priya Raman", "Henrik Vance", "Amara Osei", "Delia Okonkwo"],
        ),
        (
            ("apparatus", "unit", "vehicle"),
            ["Engine 1", "Ladder 4", "Rescue 2", "Medic 3"],
        ),
        (
            ("boot",),
            ["10 W", "11 M", "9 W", "12 M"],
        ),
    ]

    def seed_form_submissions(
        self, base_url: str, forms: list[dict], members: list[dict]
    ) -> list[dict]:
        """Answer each form a few times, as different members.

        The submissions table and the results view are both empty until a form
        has responses, and a form only accepts them once it is published — the
        create call leaves it in draft.

        A submission records the *calling* user, so four rows submitted by the
        admin would all name the same person. Each round signs in as a
        different member, the same way the RSVP seeder does.
        """
        rounds = 4
        submitters: list[Api] = []
        for member in password_login_members(members)[:rounds]:
            member_api = Api(base_url)
            try:
                member_api.login_as(member["username"], DEMO_MEMBER_PASSWORD)
            except ApiError:
                continue
            submitters.append(member_api)
        if not submitters:
            submitters = [self.api]

        submissions: list[dict] = []
        for form in forms:
            form_id = pick(form, "id")
            if not form_id:
                continue
            detail = self.api.get(f"/forms/{form_id}")
            if str(pick(detail, "status") or "").lower() != "published":
                detail = self.api.post(f"/forms/{form_id}/publish")
            if items(self.api.get(f"/forms/{form_id}/submissions"), "submissions"):
                continue
            fields = items(detail, "fields")
            for round_index in range(rounds):
                data = {}
                for field in fields:
                    field_id = pick(field, "id")
                    if not field_id:
                        continue
                    value = self._form_answer(field, round_index)
                    if value is not None:
                        data[str(field_id)] = value
                if data:
                    submitter = submitters[round_index % len(submitters)]
                    submissions.append(
                        submitter.post(f"/forms/{form_id}/submit", {"data": data})
                    )
        return submissions

    def _form_answer(self, field: dict, round_index: int) -> Any:
        field_type = str(pick(field, "field_type", "fieldType") or "text").lower()
        if field_type == "date":
            return (NOW - timedelta(days=3 + round_index * 5)).strftime("%Y-%m-%d")
        if field_type in ("select", "radio", "dropdown"):
            options = items(field, "options")
            if not options:
                return None
            option = options[round_index % len(options)]
            # An option is either {value,label} or a bare string depending on
            # how the field was defined; submissions store the value.
            return pick(option, "value") if isinstance(option, dict) else str(option)
        if field_type in ("checkbox", "multiselect"):
            options = items(field, "options")
            if not options:
                return None
            option = options[round_index % len(options)]
            return [pick(option, "value") if isinstance(option, dict) else str(option)]
        label = str(pick(field, "label") or "").lower()
        for keywords, labelled_pool in self.FORM_ANSWERS_BY_LABEL:
            if any(keyword in label for keyword in keywords):
                return labelled_pool[round_index % len(labelled_pool)]
        pool = self.FORM_ANSWERS.get(field_type)
        if pool is None:
            pool = self.FORM_ANSWERS["text"]
        return pool[round_index % len(pool)]

    # -- elections ---------------------------------------------------

    def seed_meetings(self, members: list[dict]) -> None:
        """Meetings for the redesigned Minutes page, with action items.

        The Minutes page was rebuilt onto ``/meetings`` — first-class meeting
        records with attendees, motions and action items — while this seeder
        only populated the older ``/minutes-records`` model, so the page
        rendered "No Meeting Minutes" over a real minutes record. One approved
        business meeting with open action items and one draft awaiting
        approval populate the stats row, the list, and the Action Items page.
        """
        # Guarded per title, not per collection: a run that dies between the
        # two creates must add the missing one on the next pass, not decide
        # the step is done because one row exists.
        existing_titles = {
            str(pick(m, "title"))
            for m in items(self.api.get("/meetings?limit=20"), "meetings")
        }
        member_ids = [str(pick(m, "id")) for m in members if pick(m, "id")]
        if "July Business Meeting" not in existing_titles:
            approved = self.api.post(
                "/meetings",
                {
                    "title": "July Business Meeting",
                    "meeting_type": "business",
                    "meeting_date": str(TODAY - timedelta(days=32)),
                    "start_time": "19:00:00",
                    "end_time": "20:30:00",
                    "location": "Station 1 — Training Room",
                    "called_by": "President",
                    "agenda": (
                        "Old business; equipment purchases; fall open-house "
                        "planning; new-member vote."
                    ),
                    "notes": (
                        "Quorum met with 18 members present. Treasurer's report "
                        "accepted as read. Discussion of the aerial ladder "
                        "service quote deferred to the equipment committee."
                    ),
                    "motions": (
                        "Motion to purchase four SCBA spare cylinders (Osei/"
                        "Duarte) — carried 16-2. Motion to adopt the revised "
                        "duty-crew policy (Ruiz/Nakamura) — carried unanimously."
                    ),
                    "attendees": [
                        {"user_id": user_id, "present": True}
                        for user_id in member_ids[:8]
                    ],
                    "action_items": [
                        {
                            "description": (
                                "Collect two more quotes for the aerial ladder "
                                "annual service."
                            ),
                            "assigned_to": member_ids[0] if member_ids else None,
                            "due_date": str(TODAY + timedelta(days=14)),
                            "priority": 2,
                        },
                        {
                            "description": (
                                "Book the school gym for the fall open house."
                            ),
                            "assigned_to": (
                                member_ids[1] if len(member_ids) > 1 else None
                            ),
                            "due_date": str(TODAY + timedelta(days=30)),
                            "priority": 1,
                        },
                    ],
                },
            )
            self.api.post(f"/meetings/{pick(approved, 'id')}/approve")
        if "Officer Meeting — Budget Review" not in existing_titles:
            self.api.post(
                "/meetings",
                {
                    "title": "Officer Meeting — Budget Review",
                    "meeting_type": "board",
                    "meeting_date": str(TODAY - timedelta(days=4)),
                    "start_time": "18:30:00",
                    "location": "Station 1 — Office",
                    "called_by": "Chief",
                    "agenda": "Mid-year budget review; apparatus fund status.",
                    "notes": (
                        "Draft — secretary to circulate for correction before "
                        "approval at the next business meeting."
                    ),
                    "attendees": [
                        {"user_id": user_id, "present": True}
                        for user_id in member_ids[:4]
                    ],
                },
            )

    def seed_event_request(self) -> None:
        """A pending public event request, so the Requests tab has a row.

        Submitted through the same public endpoint the request form uses; the
        admin tab otherwise renders "No event requests yet" under a caption
        describing a queue.

        Public intake is opt-in as of 2026-08-17 (EV-5) and defaults to off, so
        this turns it on first — exactly what an administrator does under
        **Events -> Settings -> Request pipeline -> Accept Public Requests**.
        Without it the post fails with a 404 that reads "Organization not
        found", because a closed department is deliberately indistinguishable
        from one that does not exist; that is correct behaviour and a very
        confusing seeder failure, since the organization plainly does exist.
        """
        if items(self.api.get("/event-requests?limit=5"), "requests"):
            return
        # Left on afterwards rather than restored: the demo department is
        # meant to look like one that accepts outreach, and guide 04 pictures
        # the setting itself.
        self.api.patch(
            "/events/settings",
            {"request_pipeline": {"accept_public_requests": True}},
        )
        org_id = pick(self.api.get("/auth/me"), "organization_id")
        self.api.post(
            f"/event-requests/public?organization_id={org_id}",
            {
                "contact_name": "Dana Whitmore",
                "contact_email": "dana.whitmore@oakvilleschools.example.org",
                "contact_phone": "555-0173",
                "organization_name": "Oakville Elementary PTA",
                "outreach_type": "station_tour",
                "description": (
                    "Our second-grade classes are studying community helpers "
                    "and would love a station tour and truck demonstration "
                    "for about 45 students."
                ),
                "date_flexibility": "general_timeframe",
                "timeframe_description": "Any weekday morning in the next month",
                "expected_attendees": 45,
            },
        )

    MINUTES_TITLE = "July Business Meeting"

    def seed_minutes(self) -> list[dict]:
        """One approved set of minutes, linked to the meeting it records.

        `/minutes-records` was empty, so the whole module — the list, the
        detail page, its Linked Elections card, the approval trail — had
        nothing to render. The record is carried through submit and approve
        rather than left in draft: a draft shows the editing affordances and
        none of the workflow ones, and the guides describe both.
        """
        # The list item omits `event_id`, and the closed election needs it, so
        # a re-run re-reads the detail rather than trusting the summary.
        existing = items(self.api.get("/minutes-records"), "minutes", "records")
        if existing:
            return [self.api.get(f"/minutes-records/{pick(existing[0], 'id')}")]

        events = items(self.api.get("/events?limit=100"), "events")
        meeting = next(
            (
                e
                for e in events
                if (pick(e, "title") or "") == "Monthly Business Meeting"
                and not pick(e, "is_cancelled", "isCancelled")
            ),
            None,
        )
        payload: dict[str, Any] = {
            "title": self.MINUTES_TITLE,
            "meeting_type": "business",
            "meeting_date": iso(NOW - timedelta(days=2)),
            "location": "Station 1 — Training Room",
            "called_by": "Chief Dana Ruiz",
            "quorum_met": True,
            "sections": [
                {
                    "key": "call_to_order",
                    "order": 0,
                    "title": "Call to Order",
                    "content": (
                        "Called to order at 19:04 by Chief Ruiz. Quorum "
                        "confirmed by the Secretary."
                    ),
                },
                {
                    "key": "old_business",
                    "order": 1,
                    "title": "Old Business",
                    "content": (
                        "Engine 2's pump test scheduling was carried over from "
                        "June; the vendor has confirmed the last week of the "
                        "month."
                    ),
                },
                {
                    "key": "new_business",
                    "order": 2,
                    "title": "New Business",
                    "content": (
                        "Special election held to fill the Assistant Chief "
                        "vacancy. Paper ballots counted in the room and "
                        "attested by two officers."
                    ),
                },
            ],
        }
        if meeting:
            payload["event_id"] = pick(meeting, "id")
        minutes = self.api.post("/minutes-records", payload)
        minutes_id = pick(minutes, "id")
        if minutes_id:
            for step in ("submit", "approve"):
                try:
                    minutes = self.api.post(f"/minutes-records/{minutes_id}/{step}")
                except ApiError as exc:
                    self.blocked.append(f"minutes {step}: {exc}")
                    break
        return [minutes]

    def seed_elections(self, minutes: list[dict] | None = None) -> list[dict]:
        elections = items(self.api.get("/elections"), "elections")
        titles = {e.get("title") for e in elections}
        start = NOW + timedelta(days=14)
        blueprint = [
            (
                "Annual Officer Elections",
                ["Fire Chief", "Deputy Chief", "Captain"],
                start,
            ),
            (
                "Bylaw Amendment Vote",
                ["Article VII Amendment"],
                start + timedelta(days=30),
            ),
        ]
        for title, positions, opens in blueprint:
            if title in titles:
                continue
            elections.append(
                self.api.post(
                    "/elections",
                    {
                        "title": title,
                        "description": (
                            f"{title} — conducted at the monthly business meeting."
                        ),
                        "election_type": "position" if len(positions) > 1 else "issue",
                        "positions": positions,
                        "ballot_items": [
                            {
                                "id": f"item-{index + 1}",
                                "type": (
                                    "officer_election"
                                    if len(positions) > 1
                                    else "general_vote"
                                ),
                                "title": position,
                                "description": f"Vote for {position}.",
                                "position": position,
                                "vote_type": (
                                    "candidate_selection"
                                    if len(positions) > 1
                                    else "approval"
                                ),
                                "voting_method": "simple_majority",
                            }
                            for index, position in enumerate(positions)
                        ],
                        "start_date": iso(opens),
                        "end_date": iso(opens + timedelta(days=2)),
                        "anonymous_voting": True,
                        "allow_write_ins": True,
                        "results_visible_immediately": False,
                        "voting_method": "simple_majority",
                        "victory_condition": "most_votes",
                        "quorum_type": "percentage",
                        "quorum_value": 50,
                    },
                )
            )
        self._link_elections_to_meetings(elections)
        self._seed_nominations(elections)
        self._seed_closed_election(elections, minutes or [])
        self._seed_open_election(elections)
        self._seed_restricted_election(elections)
        self._seed_membership_vote_election(elections)
        self._seed_runoff_chain(elections)
        self._seed_saved_ballot_template()
        self._seed_post_nomination_election(elections)
        return elections

    # Named and sized to match the worked example in the elections guide: four
    # items, so the picker's "4 items · replaces current ballot" line has
    # something to say beyond "1 item".
    SAVED_BALLOT_TEMPLATE_NAME = "Annual officer election"
    SAVED_BALLOT_TEMPLATE_ITEMS = (
        ("Fire Chief", "operational"),
        ("Deputy Chief", "operational"),
        ("Captain", "operational"),
        ("Secretary", "all"),
    )

    def _seed_saved_ballot_template(self) -> None:
        """A reusable ballot snapshot, so the template picker is not empty.

        The picker's "Your saved ballots" section only renders when the
        organization has at least one — without this the guide's two template
        screenshots have nothing to photograph but the built-in item grid.
        """
        existing = self.api.get("/elections/templates/saved-ballots")
        rows = existing if isinstance(existing, list) else items(existing, "templates")
        if any(r.get("name") == self.SAVED_BALLOT_TEMPLATE_NAME for r in rows):
            return
        try:
            self.api.post(
                "/elections/templates/saved-ballots",
                {
                    "name": self.SAVED_BALLOT_TEMPLATE_NAME,
                    "description": (
                        "Last year's officer ballot, kept so the questions do "
                        "not have to be retyped."
                    ),
                    "ballot_items": [
                        {
                            "id": f"saved-item-{index + 1}",
                            "type": "officer_election",
                            "title": position,
                            "description": f"Vote for {position}.",
                            "position": position,
                            "eligible_voter_types": [eligibility],
                            "vote_type": "candidate_selection",
                            "voting_method": "simple_majority",
                        }
                        for index, (position, eligibility) in enumerate(
                            self.SAVED_BALLOT_TEMPLATE_ITEMS
                        )
                    ],
                },
            )
        except ApiError as exc:
            self.blocked.append(f"saved ballot template: {exc}")

    RUNOFF_ELECTION_TITLE = "Fire Chief Election — 2027 Term"

    # Three candidates so round one splits and nobody clears half.
    RUNOFF_ELECTION_CANDIDATES = [
        ("Amara Osei", "Twenty years in, eight as Deputy Chief."),
        ("Jonah Whitfield", "Ran the station's rebuild of the duty roster."),
        ("Esme Caldwell", "Fire prevention officer; wrote the inspection program."),
    ]

    def _seed_runoff_chain(self, elections: list[dict]) -> None:
        """An election that took three rounds to produce a chief.

        There is no endpoint that creates a runoff. `_check_and_create_runoff`
        fires on close, when an election with `enable_runoffs` finishes without
        a winner, so a chain has to be *played out* rather than constructed:
        each round is opened, tallied on paper, attested and closed, and
        closing it is what mints the next round.

        Victory condition is `majority` — strictly more than half — because
        under the default `most_votes` a plurality wins and no runoff is ever
        needed. Round one splits 8/6/5 of 19 (10 required), round two ties 9/9
        of 18, and round three settles it 11/7.
        """
        if any(pick(e, "title") == self.RUNOFF_ELECTION_TITLE for e in elections):
            return

        members = items(self.api.get("/users?limit=100"), "users")
        by_name = {
            f"{pick(m, 'first_name', 'firstName')} "
            f"{pick(m, 'last_name', 'lastName')}": pick(m, "id")
            for m in members
        }

        election = self.api.post(
            "/elections",
            {
                "title": self.RUNOFF_ELECTION_TITLE,
                "description": (
                    "Election for Fire Chief. No candidate reached a majority "
                    "in the first two rounds."
                ),
                "election_type": "position",
                "positions": ["Fire Chief"],
                "ballot_items": [
                    {
                        "id": "item-chief",
                        "type": "officer_election",
                        "title": "Fire Chief",
                        "description": "Vote for Fire Chief.",
                        "position": "Fire Chief",
                        "vote_type": "candidate_selection",
                        "voting_method": "simple_majority",
                    }
                ],
                "start_date": iso(NOW - timedelta(days=6)),
                "end_date": iso(NOW + timedelta(days=1)),
                "anonymous_voting": True,
                "allow_write_ins": False,
                "results_visible_immediately": True,
                "voting_method": "simple_majority",
                "victory_condition": "majority",
                "enable_runoffs": True,
                "runoff_type": "top_two",
                "max_runoff_rounds": 3,
                "quorum_type": "none",
            },
        )
        election_id = pick(election, "id")
        if not election_id:
            return

        for name, statement in self.RUNOFF_ELECTION_CANDIDATES:
            self.api.post(
                f"/elections/{election_id}/candidates",
                {
                    "election_id": election_id,
                    "name": name,
                    "position": "Fire Chief",
                    "user_id": by_name.get(name),
                    "statement": statement,
                },
            )

        # (tally for this round, note) — the last round has a majority, which
        # is what stops the chain.
        rounds = [
            ([8, 6, 5], "First ballot, September business meeting. No majority."),
            ([9, 9], "Second ballot, same meeting. Tied — a third was called."),
            ([11, 7], "Third ballot. Chief elected."),
        ]

        current_id = election_id
        try:
            for counts, note in rounds:
                if current_id is None:
                    break
                self._play_paper_round(current_id, counts, note)
                current_id = self._next_runoff_id(current_id)
        except ApiError as exc:
            self.blocked.append(f"runoff chain: {exc}")
            return
        elections.append(self.api.get(f"/elections/{election_id}"))

    def _play_paper_round(self, election_id: str, counts: list[int], note: str) -> None:
        """Open a round, record a paper tally against it, attest, and close."""
        detail = self.api.get(f"/elections/{election_id}")
        if str(pick(detail, "status") or "").lower() == "draft":
            self.api.post(f"/elections/{election_id}/open")

        candidates = items(
            self.api.get(f"/elections/{election_id}/candidates"), "candidates"
        )
        entries = [
            {"candidate_id": pick(c, "id"), "count": n}
            for c, n in zip(candidates, counts)
        ]
        if not entries:
            return
        self.api.post(
            f"/elections/{election_id}/manual-ballots",
            {"entries": entries, "notes": note},
        )
        batches = items(
            self.api.get(f"/elections/{election_id}/manual-ballots"), "batches"
        )
        batch_id = pick(batches[0], "batch_id", "id") if batches else None
        if batch_id:
            self._attest_ballot_batch(election_id, batch_id)
        self.api.post(f"/elections/{election_id}/close")

    def _next_runoff_id(self, parent_id: str) -> str | None:
        """The runoff that closing `parent_id` just created, if any.

        The list representation does not carry parent_election_id, so each
        candidate has to be fetched — the same reason RunoffChain.tsx walks the
        list one detail call at a time.
        """
        for entry in items(self.api.get("/elections?limit=50"), "elections"):
            entry_id = pick(entry, "id")
            if not entry_id or entry_id == parent_id:
                continue
            detail = self.api.get(f"/elections/{entry_id}")
            if pick(detail, "parent_election_id", "parentElectionId") == parent_id:
                return entry_id
        return None

    OPEN_ELECTION_TITLE = "Line Officer Election — 2027 Term"

    # Two candidates and a separate yes/no question, so one ballot shows both
    # controls a voter meets: a candidate choice and an approval vote.
    OPEN_ELECTION_CANDIDATES = [
        (
            "Dana Ruiz",
            "Nine years on Engine 1, acting officer since 2025.",
        ),
        (
            "Emeka Adeyemi",
            "Rescue technician and lead instructor for vehicle extrication.",
        ),
    ]

    MEMBERSHIP_ELECTION_TITLE = "Membership Vote — August Business Meeting"

    def _seed_membership_vote_election(self, elections: list[dict]) -> None:
        """A draft election carrying an applicant's membership approval.

        Every other seeded ballot is position races and a bylaw amendment, so
        the item type the prospective-member pipeline exists to produce could
        not be pictured at all — and `14-elections.md` documents it.

        Draft on purpose. An open election refuses ballot edits outright
        ("Only end_date can be updated while voting is active"), which is right
        — a cast vote references an item id — but it also means the item has to
        be in place before voting starts, exactly as the guide's workflow says:
        the coordinator marks the package ready, the secretary adds it to the
        election, and only then does the election open.
        """
        if any(pick(e, "title") == self.MEMBERSHIP_ELECTION_TITLE for e in elections):
            return
        try:
            self.api.post(
                "/elections",
                {
                    "title": self.MEMBERSHIP_ELECTION_TITLE,
                    "description": (
                        "Membership approval carried to the floor at the "
                        "August business meeting."
                    ),
                    "election_type": "general",
                    "ballot_items": [
                        {
                            "id": "item-membership-okafor",
                            "type": "membership_approval",
                            "title": "Membership Approval — Sam Okafor",
                            "description": SUPPORTING_STATEMENT,
                            "vote_type": "approval",
                        }
                    ],
                    "start_date": iso(NOW + timedelta(days=2)),
                    "end_date": iso(NOW + timedelta(days=9)),
                    "anonymous_voting": True,
                    "allow_write_ins": False,
                    "results_visible_immediately": False,
                    "voting_method": "simple_majority",
                    "victory_condition": "majority",
                    "quorum_type": "none",
                },
            )
        except ApiError as exc:
            self.blocked.append(f"membership vote election: {exc}")

    RESTRICTED_ELECTION_TITLE = "Operations Committee Seat — Restricted Ballot"

    def _seed_restricted_election(self, elections: list[dict]) -> None:
        """An open election whose ballot is closed to administrative members.

        `14-elections.md` documents a send that reports how many ballots went
        out and names the members it skipped. Producing a *partial* skip needs
        two membership types on file and an item that admits only one of them —
        `ADMINISTRATIVE_USERNAMES` supplies the first, this supplies the second.
        Sending skips exactly those two, with the reason the service generates:
        "Requires voter type(s): operational; member has: administrative".

        The restriction is set at creation because an open election refuses
        ballot edits — "Only end_date can be updated while voting is active" —
        which is correct, since a cast vote references an item id.
        """
        if any(pick(e, "title") == self.RESTRICTED_ELECTION_TITLE for e in elections):
            return
        try:
            election = self.api.post(
                "/elections",
                {
                    "title": self.RESTRICTED_ELECTION_TITLE,
                    "description": (
                        "Seat on the operations committee. Operational members "
                        "only; administrative members do not vote on it."
                    ),
                    "election_type": "issue",
                    "ballot_items": [
                        {
                            "id": "item-ops-committee",
                            "type": "general_vote",
                            "title": "Operations Committee Seat",
                            "description": (
                                "Shall the committee seat be filled by "
                                "appointment for the remainder of the term?"
                            ),
                            "vote_type": "approval",
                            "eligible_voter_types": ["operational"],
                        }
                    ],
                    "start_date": iso(NOW - timedelta(hours=2)),
                    "end_date": iso(NOW + timedelta(days=4)),
                    "anonymous_voting": True,
                    "allow_write_ins": False,
                    "results_visible_immediately": False,
                    "voting_method": "simple_majority",
                    "victory_condition": "majority",
                    "quorum_type": "none",
                },
            )
        except ApiError as exc:
            self.blocked.append(f"restricted election: {exc}")
            return
        election_id = pick(election, "id")
        if not election_id:
            return
        try:
            self.api.post(f"/elections/{election_id}/open")
        except ApiError as exc:
            self.blocked.append(f"open restricted election: {exc}")
        elections.append(self.api.get(f"/elections/{election_id}"))

    def _seed_open_election(self, elections: list[dict]) -> None:
        """An election actually taking votes, so the member ballot can be shown.

        The other three seeded elections are a draft, one taking nominations
        and one closed — between them they cover everything except the screen
        a rank-and-file member actually uses. Without one in ``open`` status
        the voting page can only ever be photographed empty.

        Deliberately left with no votes recorded: the shot wanted is an
        unmarked ballot, and any member who has already voted is shown the
        receipt instead.
        """
        if any(pick(e, "title") == self.OPEN_ELECTION_TITLE for e in elections):
            return

        members = items(self.api.get("/users?limit=100"), "users")
        by_name = {
            f"{pick(m, 'first_name', 'firstName')} "
            f"{pick(m, 'last_name', 'lastName')}": pick(m, "id")
            for m in members
        }

        election = self.api.post(
            "/elections",
            {
                "title": self.OPEN_ELECTION_TITLE,
                "description": (
                    "Annual election for line officer positions, plus one "
                    "bylaw amendment carried over from the August meeting."
                ),
                "election_type": "position",
                "positions": ["Captain"],
                "ballot_items": [
                    {
                        "id": "item-captain",
                        "type": "officer_election",
                        "title": "Captain",
                        "description": (
                            "Vote for one candidate for Captain, two-year term "
                            "beginning January 2027."
                        ),
                        "position": "Captain",
                        "vote_type": "candidate_selection",
                        "voting_method": "simple_majority",
                    },
                    {
                        "id": "item-bylaw",
                        "type": "general_vote",
                        "title": "Bylaw Amendment — Article IV, Meeting Quorum",
                        "description": (
                            "Shall Article IV be amended to reduce the quorum "
                            "for a business meeting from 40% to 30% of active "
                            "members?"
                        ),
                        "vote_type": "approval",
                    },
                ],
                "start_date": iso(NOW - timedelta(days=1)),
                "end_date": iso(NOW + timedelta(days=5)),
                "anonymous_voting": True,
                "allow_write_ins": True,
                "results_visible_immediately": False,
                "voting_method": "simple_majority",
                "victory_condition": "most_votes",
                "quorum_type": "percentage",
                "quorum_value": 50,
            },
        )
        election_id = pick(election, "id")
        if not election_id:
            return

        for name, statement in self.OPEN_ELECTION_CANDIDATES:
            self.api.post(
                f"/elections/{election_id}/candidates",
                {
                    "election_id": election_id,
                    "name": name,
                    "position": "Captain",
                    "user_id": by_name.get(name),
                    "statement": statement,
                },
            )

        try:
            self.api.post(f"/elections/{election_id}/open")
        except ApiError as exc:
            self.blocked.append(f"open election: {exc}")
            return
        elections.append(self.api.get(f"/elections/{election_id}"))

    # Who attests the paper tally. Neither may be a candidate, and neither may
    # be the officer who recorded the batch — the API enforces both.
    ELECTION_ATTESTERS = [("okittredge", "Secretary"), ("smarchetti", "Vice President")]

    CLOSED_ELECTION_TITLE = "Assistant Chief Special Election"

    def _seed_closed_election(self, elections: list[dict], minutes: list[dict]) -> None:
        """A finished election, so results and forensics have something to show.

        The other two seeded elections are a draft and one taking nominations,
        which between them cover the front half of the lifecycle and leave
        every results-side screen — the tally, turnout, the certified result,
        the integrity report — permanently empty.

        Votes are recorded as a **paper batch** rather than cast one at a time.
        Casting electronically needs a separate authenticated session per
        voter, and a volunteer department voting in the room on paper is the
        commoner case anyway. It also gives the Paper Batches panel a batch.

        Order matters and the API enforces it: a batch can only be recorded
        while voting is open, attestations can only be added while voting is
        open, and an unattested batch does not count in results. Recording,
        attesting and closing therefore all happen before the election is
        closed — not after.
        """
        if any(pick(e, "title") == self.CLOSED_ELECTION_TITLE for e in elections):
            return

        members = items(self.api.get("/users?limit=100"), "users")
        by_name = {
            f"{pick(m, 'first_name', 'firstName')} "
            f"{pick(m, 'last_name', 'lastName')}": pick(m, "id")
            for m in members
        }

        opened = NOW - timedelta(days=2)
        # Set at creation, not patched afterwards: a closed election accepts no
        # field update except `results_visible_immediately`. The event is what
        # links this election to the meeting *and* to the minutes recording it
        # — both sides key on the event, so one id does both jobs.
        event_id = pick(minutes[0], "event_id", "eventId") if minutes else None
        election = self.api.post(
            "/elections",
            {
                **({"event_id": event_id} if event_id else {}),
                "title": self.CLOSED_ELECTION_TITLE,
                "description": (
                    "Special election to fill the Assistant Chief vacancy — "
                    "conducted at the July business meeting."
                ),
                "election_type": "position",
                "positions": ["Assistant Chief"],
                "ballot_items": [
                    {
                        "id": "item-1",
                        "type": "officer_election",
                        "title": "Assistant Chief",
                        "description": "Vote for Assistant Chief.",
                        "position": "Assistant Chief",
                        "vote_type": "candidate_selection",
                        "voting_method": "simple_majority",
                    }
                ],
                # The open call refuses an election whose end date has already
                # passed, so the window has to still be live at the moment it
                # opens. It is closed by hand a few lines below.
                "start_date": iso(opened),
                "end_date": iso(NOW + timedelta(days=1)),
                "anonymous_voting": True,
                "allow_write_ins": True,
                "results_visible_immediately": True,
                "voting_method": "simple_majority",
                "victory_condition": "most_votes",
                "quorum_type": "percentage",
                "quorum_value": 50,
            },
        )
        election_id = pick(election, "id")
        if not election_id:
            return

        candidates = []
        for name, statement in self.CLOSED_ELECTION_CANDIDATES:
            candidates.append(
                self.api.post(
                    f"/elections/{election_id}/candidates",
                    {
                        "election_id": election_id,
                        "name": name,
                        "position": "Assistant Chief",
                        "user_id": by_name.get(name),
                        "statement": statement,
                    },
                )
            )
        if len(candidates) < 2:
            return

        try:
            self.api.post(f"/elections/{election_id}/open")
            self.api.post(
                f"/elections/{election_id}/manual-ballots",
                {
                    # Under the eligible-voter count, or the plausibility check
                    # rejects the batch — 22 members are eligible.
                    "entries": [
                        {"candidate_id": pick(candidates[0], "id"), "count": 12},
                        {"candidate_id": pick(candidates[1], "id"), "count": 7},
                    ],
                    "notes": (
                        "In-room paper tally, July business meeting. Counted by "
                        "the Secretary, witnessed by the Chief."
                    ),
                },
            )
            batches = items(
                self.api.get(f"/elections/{election_id}/manual-ballots"), "batches"
            )
            batch_id = pick(batches[0], "batch_id", "id") if batches else None
            if batch_id:
                self._attest_ballot_batch(election_id, batch_id)
            self.api.post(f"/elections/{election_id}/close")
        except ApiError as exc:
            self.blocked.append(f"closed election: {exc}")
            return
        elections.append(self.api.get(f"/elections/{election_id}"))

    # Two candidates, so the result is a margin rather than a coronation.
    CLOSED_ELECTION_CANDIDATES = [
        (
            "Priya Raman",
            "Twelve years on Engine 1, six of them as a company officer.",
        ),
        (
            "Marcus Bell",
            "Training officer since 2022; wrote the current recruit syllabus.",
        ),
    ]

    def _attest_ballot_batch(self, election_id: str, batch_id: str) -> None:
        """Have two officers attest a paper batch so its votes count.

        Until the required attestations are in, the batch sits `pending` and
        results read zero — which is the control working, and a useless screen
        to document. The roster ships every member with only the base `Member`
        role, so the two attesters are granted the corporate offices a
        volunteer department actually elects; `elections.manage` rides on
        those, not on operational rank.
        """
        roles = self.api.get("/roles")
        role_ids = {
            pick(r, "name"): pick(r, "id")
            for r in (roles if isinstance(roles, list) else items(roles, "roles"))
        }
        users = items(self.api.get("/users?limit=100"), "users")
        user_ids = {pick(u, "username"): pick(u, "id") for u in users}

        for username, role_name in self.ELECTION_ATTESTERS:
            user_id = user_ids.get(username)
            role_id = role_ids.get(role_name)
            if not user_id or not role_id:
                continue
            try:
                self.api.post(f"/users/{user_id}/roles/{role_id}", {})
            except ApiError as exc:
                # Already held is fine; anything else is worth surfacing.
                if exc.code not in (400, 409):
                    raise
            officer = Api(self.base_url)
            officer.login_as(username, DEMO_MEMBER_PASSWORD)
            try:
                officer.post(
                    f"/elections/{election_id}/manual-ballots/{batch_id}/attest",
                    {},
                )
            except ApiError as exc:
                self.blocked.append(f"ballot attestation ({username}): {exc}")

    def _link_elections_to_meetings(self, elections: list[dict]) -> None:
        """Attach each election to the meeting it is conducted at.

        An election carries an optional `event_id`, and the event detail page
        renders a "Linked Elections" card only when something points at it.
        Unlinked, that card never appears — and the elections are described as
        being held at the monthly business meeting anyway.
        """
        events = items(self.api.get("/events?limit=100"), "events")
        meetings = [
            e
            for e in events
            if "meeting" in (e.get("title") or "").lower()
            and not (e.get("is_cancelled") or e.get("isCancelled"))
        ]
        if not meetings:
            return
        for index, election in enumerate(elections):
            election_id = pick(election, "id")
            if not election_id or pick(election, "event_id", "eventId"):
                continue
            # Only a draft or nominating election accepts an event_id: an open
            # one takes end_date and nothing else, a closed one takes
            # results_visible_immediately and nothing else. An allowlist rather
            # than a denylist, because the denylist that named closed and
            # cancelled still walked into the open election added later.
            #
            # It matters on a re-run: the list representation omits event_id, so
            # an already-linked election looks unlinked here and we would try to
            # link it again — failing the whole elections step, and with it every
            # election seeded after this call.
            if str(pick(election, "status") or "").lower() not in {
                "draft",
                "nominations",
            }:
                continue
            meeting_id = pick(meetings[index % len(meetings)], "id")
            if not meeting_id:
                continue
            self.api.patch(f"/elections/{election_id}", {"event_id": meeting_id})

    POST_NOMINATION_ELECTION = "Lieutenant Election — 2027 Term"

    def _seed_post_nomination_election(self, elections: list[dict]) -> None:
        """An election past its nomination phase that still holds a pending one.

        This is the only state in which the candidate-list permission rule is
        visible, and nothing else seeded reaches it. `list_candidates` returns
        pending nominations to everyone *while* nominations are open — nominees
        have to see their own — and to holders of `elections.manage` at any
        time; to an ordinary member after nominations close it returns accepted
        candidates only. So demonstrating it needs a closed nomination phase
        with somebody still un-accepted, and every other seeded election either
        sits in nominations or has none pending.

        A separate election rather than advancing "Annual Officer Elections":
        four captures need one *in* the nomination phase, and moving it would
        empty them.
        """
        existing = next(
            (e for e in elections if e.get("title") == self.POST_NOMINATION_ELECTION),
            None,
        )
        if existing:
            return

        members = items(self.api.get("/users?limit=100"), "users")
        by_name = {
            f"{m.get('first_name') or m.get('firstName')} "
            f"{m.get('last_name') or m.get('lastName')}": pick(m, "id")
            for m in members
        }
        nominees = [
            (
                "Amara Osei",
                "Four years on Ladder 4 and the department's rope-rescue lead.",
            ),
            (
                "Sofia Marchetti",
                "Two years riding backwards, and I want the seat to keep the "
                "training calendar honest.",
            ),
        ]
        if not all(by_name.get(name) for name, _ in nominees):
            return

        election = self.api.post(
            "/elections",
            {
                "title": self.POST_NOMINATION_ELECTION,
                "description": (
                    "Line lieutenant seat. Nominations closed; one nominee has "
                    "not yet accepted."
                ),
                "election_type": "position",
                "positions": ["Lieutenant"],
                "start_date": iso(NOW - timedelta(days=1)),
                "end_date": iso(NOW + timedelta(days=6)),
                "voting_method": "simple_majority",
                "victory_condition": "most_votes",
                "anonymous_voting": True,
                "results_visible_immediately": False,
                "quorum_type": "none",
            },
        )
        election_id = pick(election, "id")
        if not election_id:
            return

        try:
            self.api.post(f"/elections/{election_id}/open-nominations")
        except ApiError as exc:
            self.blocked.append(f"post-nomination election: {exc}")
            return

        for name, statement in nominees:
            try:
                self.api.post(
                    f"/elections/{election_id}/nominations",
                    {
                        "position": "Lieutenant",
                        "nominee_user_id": by_name[name],
                        "statement": statement,
                    },
                )
            except ApiError as exc:
                if exc.code not in (400, 409):
                    raise
                self.blocked.append(f"nominate {name}: {exc}")

        # Accept exactly one. The other stays pending, which is the whole point
        # -- with both accepted the two accounts see an identical list.
        candidates = items(
            self.api.get(f"/elections/{election_id}/candidates"), "candidates"
        )
        first = next((c for c in candidates if pick(c, "name") == nominees[0][0]), None)
        if first:
            try:
                # PATCH as the manager rather than the /nominations/.../accept
                # route: that one is restricted to the nominee, deliberately,
                # so the seeder cannot use it without signing in as them.
                self.api.patch(
                    f"/elections/{election_id}/candidates/{pick(first, 'id')}",
                    {"accepted": True},
                )
            except ApiError as exc:
                self.blocked.append(f"accept nomination: {exc}")

        try:
            # Back to draft, then open for voting: close_nominations returns the
            # election to draft by design so the ballot can be finalized first.
            self.api.post(f"/elections/{election_id}/close-nominations")
            self.api.post(f"/elections/{election_id}/open")
        except ApiError as exc:
            self.blocked.append(f"open post-nomination election: {exc}")
            return

        elections.append(self.api.get(f"/elections/{election_id}"))

    def _seed_nominations(self, elections: list[dict]) -> None:
        """Nominate candidates for the officer election.

        The Nominations and Candidates tabs are both empty until somebody is
        put forward, and nominations are only accepted while the election is in
        its nomination phase — a draft election refuses them.
        """
        election = next(
            (
                e
                for e in elections
                if e.get("title") == "Annual Officer Elections" and pick(e, "id")
            ),
            None,
        )
        if not election:
            return
        election_id = pick(election, "id")
        if items(self.api.get(f"/elections/{election_id}/candidates"), "candidates"):
            return
        if str(pick(election, "status") or "").lower() == "draft":
            try:
                self.api.post(f"/elections/{election_id}/open-nominations")
            except ApiError as exc:
                if exc.code != 400:
                    raise
                self.blocked.append(f"open nominations: {exc}")
                return

        members = items(self.api.get("/users?limit=100"), "users")
        by_name = {
            f"{m.get('first_name') or m.get('firstName')} "
            f"{m.get('last_name') or m.get('lastName')}": pick(m, "id")
            for m in members
        }
        nominations = [
            (
                "Fire Chief",
                "Dana Ruiz",
                "Twenty-two years on the job, the last "
                "six as deputy. I want to finish the staffing plan we started.",
            ),
            (
                "Fire Chief",
                "Marcus Bell",
                "My focus is training depth — every "
                "seat on every rig covered by two qualified people.",
            ),
            (
                "Deputy Chief",
                "Priya Raman",
                "Operations first: response times, "
                "apparatus readiness, and a rebuilt duty roster.",
            ),
            (
                "Captain",
                "Callum Frazier",
                "I have run B-shift for four years "
                "and would like to keep doing it with a formal mandate.",
            ),
        ]
        for position, name, statement in nominations:
            user_id = by_name.get(name)
            if not user_id:
                continue
            try:
                self.api.post(
                    f"/elections/{election_id}/nominations",
                    {
                        "position": position,
                        "nominee_user_id": user_id,
                        "statement": statement,
                    },
                )
            except ApiError as exc:
                if exc.code not in (400, 409):
                    raise
                self.blocked.append(f"nominate {name}: {exc}")

    # -- prospective members -----------------------------------------

    PIPELINE_STAGES = [
        ("Application Received", "form_submission", True, False),
        ("Application Review", "manual_approval", False, False),
        ("Interview", "interview_requirement", False, False),
        ("Background & Medical", "document_upload", False, False),
        ("Membership Vote", "election_vote", False, False),
        ("Onboarding", "checklist", False, True),
    ]

    def _backfill_pipeline_stages(self, pipeline_id: str | None) -> None:
        """Give an existing pipeline its stages if it has none.

        The `steps` payload above only runs when the pipeline is *created*, and
        the guard above that skips creation once a pipeline of the same name
        exists. A database seeded before that payload was added therefore keeps
        a stage-less pipeline forever — and a pipeline with no stages has no
        board columns, so every prospect is unplaceable and four screenshots
        across guides 01 and 15 picture "No applicants" while seven active
        prospects sit in the database.

        Idempotent on the state: a pipeline that already has stages is left
        alone rather than having a second set appended.
        """
        if not pipeline_id:
            return
        try:
            existing = items(
                self.api.get(f"/prospective-members/pipelines/{pipeline_id}/steps"),
                "steps",
            )
        except ApiError as exc:
            self.blocked.append(f"pipeline stages: read: {exc}")
            return
        if existing:
            return

        for order, (name, step_type, first, final) in enumerate(self.PIPELINE_STAGES):
            try:
                self.api.post(
                    f"/prospective-members/pipelines/{pipeline_id}/steps",
                    {
                        "name": name,
                        "description": f"{name} stage.",
                        "step_type": step_type,
                        "is_first_step": first,
                        "is_final_step": final,
                        "sort_order": order,
                        "required": True,
                        "public_visible": True,
                    },
                )
            except ApiError as exc:
                self.blocked.append(f"pipeline stage {name}: {exc}")
                return

    def _has_unfinished_stage_behind(
        self, prospect_id: str, order: list[str | None]
    ) -> bool:
        """Does this applicant have a stage behind them that never completed?

        Repair detection, not seeding. `regress_prospect` used to move the
        pointer and nothing else — it left the vacated stage `in_progress` and
        left a `completed_at` stamp on the stage it returned to. The service is
        fixed, but a demo database that has been through a few capture runs
        still holds the rows, and the applicant drawer draws them: a green tick
        missing from a stage the applicant plainly finished, and "N of 6 stages
        completed" short by one.

        The rows are only reachable through advance and regress, so the repair
        is to walk the applicant back to the first stage and forward again —
        which is what the caller does when this returns True.
        """
        detail = self.api.get(f"/prospective-members/prospects/{prospect_id}")
        current_step_id = pick(detail, "current_step_id")
        try:
            current = order.index(current_step_id)
        except ValueError:
            return False

        for progress in detail.get("step_progress") or []:
            try:
                position = order.index(pick(progress, "step_id"))
            except ValueError:
                continue
            if position < current and progress.get("status") not in (
                "completed",
                "skipped",
            ):
                return True
        return False

    def _rewind_to_first_stage(
        self, prospect_id: str, order: list[str | None], current: int
    ) -> int:
        """Regress an applicant to the first stage; return where they ended up.

        Each regress now clears the stamp on the stage it reopens and puts the
        stage it vacates back to pending, so walking to the bottom leaves every
        row consistent. The caller then advances forward to the target stage,
        which re-completes each one properly on the way.
        """
        for _ in range(current):
            try:
                self.api.post(f"/prospective-members/prospects/{prospect_id}/regress")
            except ApiError as exc:
                self.blocked.append(f"rewind applicant: {exc}")
                break
            current -= 1
        return current

    def _spread_prospects_across_stages(self, pipeline_id: str | None) -> None:
        """Move applicants forward so the board shows a pipeline, not a pile.

        The advance loop beside `PROSPECTS` only runs for applicants this seed
        *creates*; ones already on file stay where they are. On a database that
        gained its stages late, that left every applicant bunched into one or
        two columns, and `15-02-board-truncated` — which needs a column with
        more applicants than fit — could not be captured at all.

        Advancing out of an `interview_requirement` stage legitimately refuses
        until an interview exists (409, "requires at least 1 interview(s)"), so
        this records one rather than skipping the stage: a skip is a different
        thing that shows on the applicant's progress track, and would misreport
        how these applicants got where they are.

        Idempotent on the state — it only moves applicants that are behind the
        position their index calls for, so a re-run is a no-op.
        """
        if not pipeline_id:
            return
        steps = items(
            self.api.get(f"/prospective-members/pipelines/{pipeline_id}/steps"),
            "steps",
        )
        if not steps:
            return
        order = [pick(s, "id") for s in steps]

        # Filtered to this pipeline. `order` holds only the selected pipeline's
        # step ids, so an applicant from another pipeline never matches it,
        # reads as index zero, and is then walked forward through *its own*
        # unrelated stages — recording interviews and undoing whatever scenario
        # seeded it there.
        prospects = items(
            self.api.get(
                f"/prospective-members/prospects?pipeline_id={pipeline_id}&limit=100"
            ),
            "prospects",
        )
        for index, prospect in enumerate(prospects):
            prospect_id = pick(prospect, "id")
            if not prospect_id:
                continue
            # One applicant per stage, wrapping — a spread the board can show.
            target = index % len(order)
            try:
                current = order.index(pick(prospect, "current_step_id"))
            except ValueError:
                current = 0

            if self._has_unfinished_stage_behind(prospect_id, order):
                current = self._rewind_to_first_stage(prospect_id, order, current)

            # Move *back* as well as forward. `15-09-bulk-action-result` runs a
            # real bulk advance during capture, and the manifest assumes a
            # re-seed restores the mixed page it needs — which only holds if
            # this can undo that. Advancing alone left every applicant parked at
            # the final stage after one capture run, permanently, and
            # `15-08-election-package` then pictured an applicant past the vote
            # under a caption about being at it.
            for _ in range(current - target):
                try:
                    self.api.post(
                        f"/prospective-members/prospects/{prospect_id}/regress"
                    )
                except ApiError as exc:
                    self.blocked.append(f"regress applicant: {exc}")
                    break

            for _ in range(target - current):
                if not self._advance_recording_interview(prospect_id, "spread"):
                    break

    def _advance_recording_interview(self, prospect_id: str, label: str) -> bool:
        """Advance one stage, recording an interview where the stage demands one.

        Advancing out of an `interview_requirement` stage legitimately refuses
        until an interview exists (409, "requires at least 1 interview(s)").
        Recording one and retrying — rather than skipping the stage — keeps the
        applicant's progress track honest about how they got where they are.

        Shared by the create-path advance loop and the spread: the fallback
        lived only in the spread, so a *fresh* database — where the create path
        actually runs — crashed the whole prospective-members step the first
        time a new applicant had to clear the Interview stage, and the
        applicants after that one were never created at all.
        """
        try:
            self.api.post(f"/prospective-members/prospects/{prospect_id}/advance")
            return True
        except ApiError as exc:
            if "interview" not in str(exc).lower():
                self.blocked.append(f"{label} applicant: {exc}")
                return False
            try:
                self.api.post(
                    f"/prospective-members/prospects/{prospect_id}/interviews",
                    {
                        "recommendation": "recommend",
                        "interviewer_role": "Membership Coordinator",
                        "notes": (
                            "Panel interview; candidate answered "
                            "scenario questions well."
                        ),
                    },
                )
                self.api.post(f"/prospective-members/prospects/{prospect_id}/advance")
                return True
            except ApiError as inner:
                self.blocked.append(f"{label} applicant: {inner}")
                return False

    PROSPECTS = [
        ("Alex", "Rivera", "Saw the station open house"),
        ("Jordan", "Fields", "Family member is a volunteer"),
        ("Sam", "Okafor", "Career change into the fire service"),
        ("Casey", "Lindgren", "Referred by a current member"),
        ("Morgan", "Tran", "Wants EMS experience before paramedic school"),
        ("Riley", "Bishop", "Lives two blocks from Station 2"),
    ]

    def seed_prospective_members(self) -> dict[str, list[dict]]:
        pipelines = items(self.api.get("/prospective-members/pipelines"), "pipelines")
        if not any(p.get("name") == "Volunteer Membership Pipeline" for p in pipelines):
            pipelines.append(
                self.api.post(
                    "/prospective-members/pipelines",
                    {
                        "name": "Volunteer Membership Pipeline",
                        "description": (
                            "Application through onboarding for volunteer members."
                        ),
                        "is_default": True,
                        "is_active": True,
                        "public_status_enabled": True,
                        "steps": [
                            {
                                "name": name,
                                "description": f"{name} stage.",
                                "step_type": step_type,
                                "is_first_step": first,
                                "is_final_step": final,
                                "sort_order": order,
                                "required": True,
                                "public_visible": True,
                            }
                            for order, (name, step_type, first, final) in enumerate(
                                self.PIPELINE_STAGES
                            )
                        ],
                    },
                )
            )
        pipeline_id = pick(pipelines[0], "id") if pipelines else None
        self._backfill_pipeline_stages(pipeline_id)

        prospects = items(
            self.api.get("/prospective-members/prospects?limit=100"), "prospects"
        )
        emails = {p.get("email") for p in prospects}

        def already_exists(email: str) -> bool:
            """Is this applicant on file?

            The first page is enough on an ordinary seed, but the list caps at
            200 and ``--bulk-prospects`` pushes the pipeline well past that —
            at which point the named applicants fall off the page and this
            re-created every one of them on each run. Falls back to a search
            when the page does not settle it.
            """
            if email in emails:
                return True
            if len(prospects) < 100:
                return False
            found = items(
                self.api.get(f"/prospective-members/prospects?limit=5&search={email}"),
                "prospects",
            )
            return any(p.get("email") == email for p in found)

        for index, (first, last, reason) in enumerate(self.PROSPECTS):
            email = f"{first.lower()}.{last.lower()}@example.org"
            if already_exists(email):
                continue
            payload = {
                "first_name": first,
                "last_name": last,
                "email": email,
                "phone": f"(703) 555-{5000 + index:04d}",
                "address_city": "Oakville",
                "address_state": "VA",
                "address_zip": "22046",
                "interest_reason": reason,
                "referral_source": "Open house" if index % 2 else "Word of mouth",
                "desired_membership_type": "active",
            }
            if pipeline_id:
                payload["pipeline_id"] = pipeline_id
            prospect = self.api.post("/prospective-members/prospects", payload)
            prospects.append(prospect)
        # Spreading is left entirely to `_spread_prospects_across_stages`
        # below. A blind advance loop here used to pre-position each new
        # applicant, and 409'd the whole step on a fresh database the moment
        # one crossed the interview stage — advancing out of an
        # `interview_requirement` stage refuses until an interview exists,
        # and only the spread helper records one.
        self._spread_prospects_across_stages(pipeline_id)
        self._enable_public_status(pipelines)
        self._seed_report_stage_groups(pipelines)
        self._seed_election_packages(prospects)
        self._link_prospect_events(prospects)
        self._upload_prospect_documents(prospects)
        return {"pipelines": pipelines, "prospects": prospects}

    # Consolidated reporting buckets, in pipeline order. Named by what the
    # stages have in common rather than by stage count, because the Pipeline
    # Overview report prints these names and "Group 1" tells a chief nothing.
    REPORT_STAGE_GROUPS = [
        ("Early Stages", ["Application Received", "Application Review"]),
        ("Assessment", ["Interview", "Background & Medical"]),
        ("Final Steps", ["Membership Vote", "Onboarding"]),
    ]

    def _seed_report_stage_groups(self, pipelines: list[dict]) -> None:
        """Group the pipeline's stages for the Pipeline Overview report.

        Without these the report lists every stage individually and the
        Report Stage Groups editor is an empty panel with one Add Group
        button — which documents neither what a group is nor that ungrouped
        stages still appear on their own.
        """
        for pipeline in pipelines:
            pipeline_id = pick(pipeline, "id")
            if not pipeline_id:
                continue
            detail = self.api.get(f"/prospective-members/pipelines/{pipeline_id}")
            if detail.get("report_stage_groups"):
                continue
            # The pipeline detail calls them "steps"; the editor and the report
            # call them stages. Same rows.
            by_name = {s.get("name"): s.get("id") for s in detail.get("steps", [])}
            groups = []
            for name, stage_names in self.REPORT_STAGE_GROUPS:
                step_ids = [by_name[s] for s in stage_names if s in by_name]
                if step_ids:
                    groups.append({"name": name, "step_ids": step_ids})
            if not groups:
                continue
            self.api.patch(
                f"/prospective-members/pipelines/{pipeline_id}/report-settings",
                {"report_stage_groups": groups},
            )

    # The paperwork an applicant hands in, by document type. Two of them, so
    # the drawer shows a list rather than one row that could be mistaken for
    # the whole feature.
    PROSPECT_DOCUMENTS = [
        ("application", "Membership Application", "Signed application form"),
        ("id", "Driver's License", "Photo identification on file"),
    ]

    def _upload_prospect_documents(self, prospects: list[dict]) -> None:
        """Put real files on an applicant's record.

        Nothing seeded any, so the drawer's documents area could only ever be
        photographed empty — and the guide describes downloading a file that
        has been uploaded. Only the furthest-along applicant carries them: an
        applicant at the first stage with their ID already on file would say
        the wrong thing about the pipeline.
        """
        # The list rows carry the stage's *name*, not its index, so order by
        # where that name sits in the pipeline this seeder built.
        stage_order = {
            stage[0]: index for index, stage in enumerate(self.PIPELINE_STAGES)
        }
        target = max(
            prospects,
            key=lambda p: stage_order.get(str(pick(p, "current_step_name") or ""), -1),
            default=None,
        )
        if not target:
            return
        prospect_id = pick(target, "id")
        if not prospect_id:
            return
        existing = {
            str(pick(doc, "document_type") or "")
            for doc in items(
                self.api.get(f"/prospective-members/prospects/{prospect_id}/documents"),
                "documents",
            )
        }
        for document_type, title, description in self.PROSPECT_DOCUMENTS:
            if document_type in existing:
                continue
            try:
                self.api.post_file(
                    f"/prospective-members/prospects/{prospect_id}/documents",
                    {"document_type": document_type},
                    f"{title}.pdf",
                    _demo_pdf(title, description),
                    "application/pdf",
                )
            except ApiError as exc:
                self.blocked.append(f"prospect document: {exc}")
                return

    def _link_prospect_events(self, prospects: list[dict]) -> None:
        """Attach an upcoming event to the prospects past the first stage.

        The Linked Events panel is on the detail drawer, above the action bar,
        so every drawer screenshot carries "No events linked yet" across it
        while nothing is linked. Linking is also the only way to picture what
        the panel is for: an applicant booked into the interview or orientation
        their stage is waiting on.
        """
        events = [
            event
            for event in items(self.api.get("/events"), "events")
            if str(pick(event, "start_datetime", "startDatetime") or "")
            > datetime.now(timezone.utc).isoformat()
        ]
        if not events:
            return

        for index, prospect in enumerate(prospects):
            prospect_id = pick(prospect, "id")
            if not prospect_id:
                continue
            # Keyed on this prospect's own links, so a re-run fills in the ones
            # a partial run missed rather than skipping the lot.
            existing = items(
                self.api.get(f"/prospective-members/prospects/{prospect_id}/events"),
                "events",
                "links",
            )
            if existing:
                continue
            event_id = pick(events[index % len(events)], "id")
            if not event_id:
                continue
            try:
                self.api.post(
                    f"/prospective-members/prospects/{prospect_id}/events",
                    {"event_id": event_id},
                )
            except ApiError as exc:
                if exc.code not in (400, 409):
                    raise
                self.blocked.append(f"prospect event link: {exc}")

    def _enable_public_status(self, pipelines: list[dict]) -> None:
        """Turn on the public application-status page.

        Set at creation, but a pipeline seeded before that flag existed still
        has it off, and the token link then refuses to render. Idempotent, so
        it also repairs an older demo database.
        """
        for pipeline in pipelines:
            pipeline_id = pick(pipeline, "id")
            if not pipeline_id:
                continue
            detail = self.api.get(f"/prospective-members/pipelines/{pipeline_id}")
            if pick(detail, "public_status_enabled", "publicStatusEnabled"):
                continue
            self.api.put(
                f"/prospective-members/pipelines/{pipeline_id}",
                {"public_status_enabled": True},
            )

    def _seed_election_packages(self, prospects: list[dict]) -> None:
        """Build the election package for whoever is at the membership vote.

        The drawer tells the reader the package "will be auto-generated when the
        applicant reaches this stage". Nothing does that —
        `create_election_package` has exactly one caller, the endpoint below —
        so an applicant advanced onto the stage sits there with an empty panel.
        Creating it here is what the coordinator would do by hand.
        """
        for prospect in prospects:
            prospect_id = pick(prospect, "id")
            if not prospect_id:
                continue
            # The stage lives on `current_step`, and only on the detail
            # response — the list omits it entirely.
            detail = self.api.get(f"/prospective-members/prospects/{prospect_id}")
            step = pick(detail, "current_step") or {}
            if str(pick(step, "step_type") or "").lower() != "election_vote":
                continue
            try:
                package = self.api.get(
                    f"/prospective-members/prospects/{prospect_id}/election-package"
                )
                # A package created before this seeder filled the statement in
                # keeps its empty box, and the ballot item built from it then
                # quotes a statement the package does not hold. Top it up
                # rather than skipping — the create path below never runs for a
                # prospect who already has a package.
                config = dict(pick(package, "package_config") or {})
                if not str(config.get("supporting_statement") or "").strip():
                    config["supporting_statement"] = SUPPORTING_STATEMENT
                    try:
                        self.api.put(
                            f"/prospective-members/prospects/{prospect_id}"
                            "/election-package",
                            {"package_config": config},
                        )
                    except ApiError as exc:
                        self.blocked.append(f"election package statement: {exc}")
                continue
            except ApiError as exc:
                if exc.code != 404:
                    raise
            try:
                self.api.post(
                    f"/prospective-members/prospects/{prospect_id}/election-package",
                    {
                        "prospect_id": prospect_id,
                        "coordinator_notes": (
                            "Application, interview notes and background check "
                            "attached for the membership vote."
                        ),
                        # The statement voters actually read on the ballot.
                        # It lives inside `package_config`, not as a column —
                        # sent top-level the API accepts the request and stores
                        # nothing, which is how this box stayed empty through
                        # two seeder runs that thought they had filled it.
                        "package_config": {
                            "supporting_statement": SUPPORTING_STATEMENT
                        },
                    },
                )
            except ApiError as exc:
                if exc.code not in (400, 409):
                    raise
                self.blocked.append(f"election package: {exc}")

    # Approve / Deny, under the 22-member eligible count so the paper batch
    # passes the plausibility check without an audited override.
    MEMBERSHIP_VOTE_TALLY = (18, 2)

    def seed_membership_vote_outcome(self) -> None:
        """Carry the August membership vote through to an Elected package.

        Guide 01 pictures the applicant drawer's ELECTION PACKAGE badge
        reading Elected, and `elected` is written in exactly one place —
        `_sync_package_statuses`, when an election whose ballot item carries
        the package's id closes. No package edit gets there; the vote has to
        actually happen. So this walks the product's own lifecycle:

        1. mark the package `ready` (the assign endpoint refuses anything
           else), with a `recommended_ballot_item` that keeps the title and
           statement `_seed_membership_vote_election` used — and opens the
           vote to all membership types, because the assign default of
           regular/life matches nobody in a roster of active/administrative
           members and an item with zero eligible voters rejects any tally;
        2. replace the hand-built ballot item with the assign endpoint's —
           the hand item carried no `prospect_package_id`, so closing an
           election around it would have synced nothing;
        3. open the election, record the floor vote as a paper batch, have
           two officers attest it, and close.

        Each stage checks where a previous run stopped, so a re-run against
        a database whose election is already closed does nothing.
        """
        elections = items(self.api.get("/elections?limit=100"), "elections")
        election_id = next(
            (
                pick(e, "id")
                for e in elections
                if pick(e, "title") == self.MEMBERSHIP_ELECTION_TITLE
            ),
            None,
        )
        if not election_id:
            self.blocked.append(
                "membership vote outcome: election not found "
                f"({self.MEMBERSHIP_ELECTION_TITLE!r})"
            )
            return

        packages = items(
            self.api.get("/prospective-members/election-packages"), "packages"
        )
        package = next((p for p in packages if pick(p, "status") != "withdrawn"), None)
        if not package:
            self.blocked.append("membership vote outcome: no election package")
            return
        prospect_id = pick(package, "prospect_id", "prospectId")
        pkg_status = pick(package, "status")
        if pkg_status == "elected":
            return

        election = self.api.get(f"/elections/{election_id}")
        election_status = str(pick(election, "status") or "").lower()
        if election_status == "closed":
            # The only way here is an election closed around the unlinked
            # hand item, and a closed election accepts no repair over the
            # API. Say so rather than half-working.
            self.blocked.append(
                "membership vote outcome: election closed but package is "
                f"'{pkg_status}' — its ballot item never carried the package id"
            )
            return

        snapshot = pick(package, "applicant_snapshot", "applicantSnapshot") or {}
        full_name = (
            f"{snapshot.get('first_name', '')} {snapshot.get('last_name', '')}"
        ).strip() or "the applicant"

        if pkg_status in ("draft", "pending"):
            config = dict(pick(package, "package_config", "packageConfig") or {})
            config["recommended_ballot_item"] = {
                "title": f"Membership Approval — {full_name}",
                "description": SUPPORTING_STATEMENT,
                "eligible_voter_types": ["all"],
                "require_attendance": False,
            }
            self.api.put(
                f"/prospective-members/prospects/{prospect_id}/election-package",
                {"status": "ready", "package_config": config},
            )
            pkg_status = "ready"

        try:
            if election_status == "draft":
                if pkg_status == "ready":
                    # Drop the unlinked hand item first, so the ballot does
                    # not put the same applicant to the floor twice.
                    remaining = [
                        item
                        for item in (pick(election, "ballot_items") or [])
                        if item.get("id") != "item-membership-okafor"
                    ]
                    self.api.patch(
                        f"/elections/{election_id}", {"ballot_items": remaining}
                    )
                    self.api.post(
                        f"/prospective-members/prospects/{prospect_id}"
                        "/election-package/assign",
                        {"election_id": election_id},
                    )
                self.api.post(f"/elections/{election_id}/open")
                election = self.api.get(f"/elections/{election_id}")

            item = next(
                (
                    i
                    for i in (pick(election, "ballot_items") or [])
                    if i.get("type") == "membership_approval"
                ),
                None,
            )
            if not item:
                self.blocked.append(
                    "membership vote outcome: no membership_approval item "
                    "on the opened election"
                )
                return
            # The votes-to-item join `_sync_package_statuses` uses: the
            # item's `position` key when set, its id otherwise.
            position = item.get("position") or item["id"]

            existing = items(
                self.api.get(f"/elections/{election_id}/candidates"), "candidates"
            )
            by_name = {
                pick(c, "name"): pick(c, "id")
                for c in existing
                if pick(c, "position") == position
            }
            candidate_ids = {}
            for name in ("Approve", "Deny"):
                candidate_ids[name] = by_name.get(name) or pick(
                    self.api.post(
                        f"/elections/{election_id}/candidates",
                        {
                            "election_id": election_id,
                            "name": name,
                            "position": position,
                        },
                    ),
                    "id",
                )

            batches = items(
                self.api.get(f"/elections/{election_id}/manual-ballots"),
                "batches",
            )
            if not batches:
                approve, deny = self.MEMBERSHIP_VOTE_TALLY
                self.api.post(
                    f"/elections/{election_id}/manual-ballots",
                    {
                        "entries": [
                            {
                                "candidate_id": candidate_ids["Approve"],
                                "count": approve,
                            },
                            {"candidate_id": candidate_ids["Deny"], "count": deny},
                        ],
                        "ballots_cast": approve + deny,
                        "notes": (
                            "In-room paper tally, August business meeting. "
                            "Counted by the Secretary, witnessed by the Chief."
                        ),
                    },
                )
                batches = items(
                    self.api.get(f"/elections/{election_id}/manual-ballots"),
                    "batches",
                )
            batch = batches[0] if batches else None
            batch_id = pick(batch, "batch_id", "id") if batch else None
            # Only a pending batch needs attestations; re-attesting a
            # confirmed one earns each officer a 400 and a blocked note.
            if batch_id and pick(batch, "status") == "pending":
                self._attest_ballot_batch(election_id, batch_id)
            self.api.post(f"/elections/{election_id}/close")
        except ApiError as exc:
            self.blocked.append(f"membership vote outcome: {exc}")
            return

        final = self.api.get(
            f"/prospective-members/prospects/{prospect_id}/election-package"
        )
        if pick(final, "status") != "elected":
            self.blocked.append(
                "membership vote outcome: election closed but package reads "
                f"'{pick(final, 'status')}' — vote-to-package sync did not run"
            )

    def seed_bulk_prospects(self, pipeline_id: str | None, target: int) -> int:
        """Pad the pipeline out past the board's card ceiling. Opt-in only.

        The kanban groups applicants into columns client-side, so it asks for
        ``KANBAN_PAGE_SIZE`` (200) applicants and says plainly when there are
        more than that — "Showing 200 of 247 applicants". Picturing that notice
        needs a pipeline genuinely larger than the ceiling, and a department
        with 200+ live applicants is not the demo data anyone else wants: it
        would bury the twelve named applicants the other prospective-member
        screenshots are composed around, and cost a few hundred requests on
        every ordinary seed.

        Hence the flag. It tops the pipeline up to ``target`` **active**
        applicants and returns how many it created.

        Most of the filler stays at intake, which is what a real pipeline
        mid-recruitment looks like, but a slice of it is advanced so the later
        columns are not empty. That matters for the picture: the board loads the
        *newest* 200 applicants, so filler created after the twelve named
        applicants pushes them out of the fetched page entirely — leaving three
        columns reading "No applicants" under a notice about having too many.
        Advancing every fourth one keeps the board legible without paying a
        request per stage per applicant.
        """
        if target <= 0:
            return 0

        existing = self.api.get("/prospective-members/prospects?limit=1&status=active")
        current = (
            existing.get("total", 0) if isinstance(existing, dict) else len(existing)
        )
        missing = target - current
        if missing <= 0:
            print(f"    pipeline already holds {current} active applicants")
            return 0

        print(f"    creating {missing} filler applicants ({current} -> {target})")
        created = 0
        created_ids: list[str] = []
        for index in range(missing):
            # Deterministic addresses so a re-run recognises its own filler and
            # tops up rather than duplicating it.
            email = f"applicant.{current + index:04d}@intake.example.org"
            payload = {
                "first_name": "Applicant",
                "last_name": f"{current + index:04d}",
                "email": email,
                "phone": f"(703) 555-{6000 + (current + index) % 4000:04d}",
                "address_city": "Oakville",
                "address_state": "VA",
                "address_zip": "22046",
                "interest_reason": "Applied through the open-house drive.",
                "referral_source": "Open house",
                "desired_membership_type": "active",
            }
            if pipeline_id:
                payload["pipeline_id"] = pipeline_id
            try:
                prospect = self.api.post("/prospective-members/prospects", payload)
                created += 1
            except ApiError as exc:
                # A duplicate-email refusal means this one already exists, which
                # is fine; anything else is worth stopping for rather than
                # grinding through several hundred identical failures.
                if exc.code not in (400, 409):
                    raise
                continue

            created_ids.append(pick(prospect, "id"))

            # Every fourth one moves down the board. Advancing past the final
            # stage is refused with a 409, so the count is bounded by the
            # pipeline length rather than relying on the API to absorb it.
            if index % 4:
                continue
            for _ in range(1 + (index // 4) % (len(self.PIPELINE_STAGES) - 1)):
                self.api.post(
                    f"/prospective-members/prospects/{pick(prospect, 'id')}/advance"
                )

        # Park the two most recently created at the *final* stage.
        #
        # The table lists newest first, so these land on page one — which is
        # what makes a select-all there a genuinely mixed batch: most advance,
        # these two cannot. That partial failure is the whole subject of the
        # bulk-action screenshot, and without it a bulk advance from page one
        # succeeds uniformly and pictures nothing.
        for prospect_id in created_ids[-2:]:
            if not prospect_id:
                continue
            for _ in range(len(self.PIPELINE_STAGES)):
                try:
                    self.api.post(
                        f"/prospective-members/prospects/{prospect_id}/advance"
                    )
                except ApiError as exc:
                    # 409 is the pipeline saying "already at the end", which is
                    # exactly where this is trying to get to.
                    if exc.code != 409:
                        raise
                    break
        return created

    # -- grants & fundraising ----------------------------------------

    def seed_grants(self) -> dict[str, list[dict]]:
        opportunities = items(self.api.get("/grants"), "opportunities")
        names = {o.get("name") for o in opportunities}
        for name, agency, category, low, high in [
            ("Assistance to Firefighters Grant", "FEMA", "equipment", 25_000, 750_000),
            ("SAFER Grant", "FEMA", "staffing", 50_000, 1_500_000),
            ("Fire Prevention & Safety Grant", "FEMA", "prevention", 10_000, 250_000),
            (
                "State Rescue Squad Assistance Fund",
                "Virginia OEMS",
                "vehicles",
                15_000,
                200_000,
            ),
        ]:
            if name in names:
                continue
            opportunities.append(
                self.api.post(
                    "/grants",
                    {
                        "name": name,
                        "agency": agency,
                        "category": category,
                        "description": f"{name}, administered by {agency}.",
                        "typicalAwardMin": low,
                        "typicalAwardMax": high,
                        "matchRequired": True,
                        "matchPercentage": 5,
                        "deadlineType": "recurring",
                        "deadlineDate": str(TODAY + timedelta(days=75)),
                        "eligibleUses": "Apparatus, PPE, training, and safety equipment.",
                    },
                )
            )

        applications = items(self.api.get("/grants/applications"), "applications")
        applied = {
            a.get("grantProgramName") or a.get("grant_program_name")
            for a in applications
        }
        for program, agency, status, requested, awarded in [
            ("Assistance to Firefighters Grant", "FEMA", "submitted", 180_000, None),
            ("Fire Prevention & Safety Grant", "FEMA", "awarded", 42_000, 42_000),
            (
                "State Rescue Squad Assistance Fund",
                "Virginia OEMS",
                "preparing",
                96_000,
                None,
            ),
        ]:
            if program in applied:
                continue
            payload = {
                "grantProgramName": program,
                "grantAgency": agency,
                "applicationStatus": status,
                "amountRequested": requested,
                "matchAmount": round(requested * 0.05, 2),
                "matchSource": "Department capital reserve",
                "applicationDeadline": str(TODAY + timedelta(days=45)),
                "projectDescription": (
                    f"{program} request supporting the department's capital plan."
                ),
                "priority": "high" if awarded else "medium",
            }
            if awarded:
                payload["amountAwarded"] = awarded
                payload["awardDate"] = str(TODAY - timedelta(days=30))
                payload["grantStartDate"] = str(TODAY - timedelta(days=25))
                payload["grantEndDate"] = str(TODAY + timedelta(days=340))
            applications.append(self.api.post("/grants/applications", payload))

        campaigns = items(self.api.get("/grants/campaigns"), "campaigns")
        campaign_names = {c.get("name") for c in campaigns}
        for name, campaign_type, goal in [
            (f"{TODAY.year} Equipment Fund", "equipment", 75_000),
            ("Memorial Scholarship Drive", "memorial", 15_000),
            ("Fill the Boot", "community", 20_000),
        ]:
            if name in campaign_names:
                continue
            campaigns.append(
                self.api.post(
                    "/grants/campaigns",
                    {
                        "name": name,
                        "description": f"{name} — community fundraising campaign.",
                        "campaignType": campaign_type,
                        "goalAmount": goal,
                        "startDate": str(date(TODAY.year, 1, 1)),
                        "endDate": str(date(TODAY.year, 12, 31)),
                        "publicPageEnabled": True,
                        "allowAnonymous": True,
                        "suggestedAmounts": [25, 50, 100, 250],
                    },
                )
            )
        campaign_ids = [pick(c, "id") for c in campaigns if pick(c, "id")]

        donors = items(self.api.get("/grants/donors"), "donors")
        donor_emails = {d.get("email") for d in donors}
        donor_blueprint = [
            ("Harriet", "Delacroix", "individual", None),
            ("Peter", "Novak", "individual", None),
            ("Ana", "Villanueva", "individual", None),
            ("Grace", "Oyelaran", "business", "Oyelaran Hardware"),
            ("Thomas", "Reid", "business", "Reid & Sons Contracting"),
            ("Miriam", "Stein", "foundation", "Stein Family Foundation"),
        ]
        for index, (first, last, donor_type, company) in enumerate(donor_blueprint):
            email = f"{first.lower()}.{last.lower()}@example.org"
            if email in donor_emails:
                continue
            payload = {
                "firstName": first,
                "lastName": last,
                "email": email,
                "phone": f"(703) 555-{6000 + index:04d}",
                "city": "Oakville",
                "state": "VA",
                "postalCode": "22046",
                "donorType": donor_type,
            }
            if company:
                payload["companyName"] = company
            donors.append(self.api.post("/grants/donors", payload))

        donations = items(self.api.get("/grants/donations"), "donations")
        if len(donations) < len(donors):
            for index, donor in enumerate(donors):
                donor_id = pick(donor, "id")
                if not donor_id:
                    continue
                payload = {
                    "amount": [50, 100, 250, 500, 1_000, 2_500][index % 6],
                    "donationDate": str(TODAY - timedelta(days=15 * (index + 1))),
                    "paymentMethod": ["check", "credit_card", "cash"][index % 3],
                    "paymentStatus": "completed",
                    "taxDeductible": True,
                    "donorId": donor_id,
                }
                if campaign_ids:
                    payload["campaignId"] = campaign_ids[index % len(campaign_ids)]
                donations.append(self.api.post("/grants/donations", payload))
        # Budget lines and compliance tasks are what the application detail
        # page's Budget and Compliance tabs render; an application without them
        # opens on an empty tab.
        for application in applications:
            app_id = pick(application, "id")
            if not app_id:
                continue
            if not items(
                self.api.get(f"/grants/applications/{app_id}/budget-items"),
                "budget_items",
            ):
                for order, (category, description, budgeted) in enumerate(
                    [
                        ("equipment", "Thermal imaging cameras (4)", 40_000),
                        ("equipment", "SCBA replacement packs (6)", 41_000),
                        ("training", "Instructor certification travel", 6_500),
                        ("supplies", "Replacement PPE consumables", 4_200),
                    ]
                ):
                    self.api.post(
                        f"/grants/applications/{app_id}/budget-items",
                        {
                            "applicationId": app_id,
                            "category": category,
                            "description": description,
                            "amountBudgeted": budgeted,
                            "federalShare": round(budgeted * 0.95, 2),
                            "localMatch": round(budgeted * 0.05, 2),
                            "sortOrder": order,
                        },
                    )
            # Compliance tasks are created under the application but listed at
            # the module-level collection; there is no per-application GET.
            existing_tasks = items(
                self.api.get(f"/grants/compliance-tasks?application_id={app_id}"),
                "compliance_tasks",
            )
            if not existing_tasks:
                for task_type, title, days_out, priority in [
                    ("progress_update", "Quarterly progress update", 30, "medium"),
                    ("financial_report", "Semi-annual financial report", 90, "high"),
                    (
                        "equipment_inventory",
                        "Equipment inventory certification",
                        150,
                        "medium",
                    ),
                    ("closeout_report", "Final closeout report", 300, "critical"),
                ]:
                    self.api.post(
                        f"/grants/applications/{app_id}/compliance-tasks",
                        {
                            "applicationId": app_id,
                            "taskType": task_type,
                            "title": title,
                            "description": f"{title} required by the awarding agency.",
                            "dueDate": str(TODAY + timedelta(days=days_out)),
                            "priority": priority,
                        },
                    )

        self._seed_grant_notes(applications)

        return {
            "opportunities": opportunities,
            "applications": applications,
            "campaigns": campaigns,
            "donors": donors,
            "donations": donations,
        }

    #: (note type, content, days before today). The Activity Log is a timeline,
    #: so a single note reads as a list of one — these give it a shape, and the
    #: types drive the per-entry icons the tab renders.
    GRANT_NOTES = [
        ("status_change", "Status changed to Preparing.", 62),
        ("contact_made", "Contacted the program officer to confirm scope.", 55),
        ("document_added", "Uploaded the department's audited financials.", 48),
        ("status_change", "Status changed to Submitted.", 40),
        ("milestone", "Application acknowledged by the awarding agency.", 33),
        ("financial", "Budget item added: training equipment, $10,000.", 21),
        ("status_change", "Status changed to Awarded.", 9),
    ]

    def _seed_grant_notes(self, applications: list[dict]) -> None:
        """Give one application a populated Activity Log.

        Only the first: the tab is pictured once in the guides, and writing a
        timeline onto every application would slow the seeder for no gain.
        """
        if not applications:
            return
        app_id = pick(applications[0], "id")
        if not app_id:
            return
        # The application already carries one auto-generated "created with
        # status" note, so a bare truthiness check on the list never lets the
        # timeline seed. Only a run that has already added these does.
        if (
            len(items(self.api.get(f"/grants/applications/{app_id}/notes"), "notes"))
            > 1
        ):
            return
        for index, (note_type, content, days_ago) in enumerate(self.GRANT_NOTES):
            # `created_at` is server-stamped at second granularity and the log
            # orders by it, so notes written inside the same second come back in
            # arbitrary order and the timeline reads as nonsense. One second
            # apart is enough to fix the ordering; the API has no way to
            # backdate a note, so they all still carry today's date.
            if index:
                sleep(1)
            self.api.post(
                f"/grants/applications/{app_id}/notes",
                {
                    "applicationId": app_id,
                    "noteType": note_type,
                    "content": content,
                    "metadata": {"seededDaysAgo": days_ago},
                },
            )

    # -- medical screening -------------------------------------------

    def seed_medical_screening(self, members: list[dict]) -> dict[str, list[dict]]:
        requirements = items(
            self.api.get("/medical-screening/requirements"), "requirements"
        )
        names = {r.get("name") for r in requirements}
        for name, screening_type, months, grace in [
            ("Annual NFPA 1582 Physical", "physical_exam", 12, 30),
            ("Return-to-Duty Medical Clearance", "medical_clearance", 12, 14),
            ("Annual Fitness Assessment", "fitness_assessment", 12, 30),
            ("Vision & Hearing Screening", "vision_hearing", 24, 30),
        ]:
            if name in names:
                continue
            payload = {
                "name": name,
                "screening_type": screening_type,
                "description": f"{name} required for all interior-qualified members.",
                "is_active": True,
                "grace_period_days": grace,
            }
            if months:
                payload["frequency_months"] = months
            requirements.append(
                self.api.post("/medical-screening/requirements", payload)
            )

        records = items(self.api.get("/medical-screening/records"), "records")
        if not records:
            # Mix current, expiring, and overdue so the compliance dashboard
            # shows all three states rather than a uniform green.
            for index, member in enumerate(members[:14]):
                user_id = pick(member, "id")
                requirement = requirements[index % len(requirements)]
                if not user_id or not pick(requirement, "id"):
                    continue
                completed = TODAY - timedelta(days=30 + index * 25)
                records.append(
                    self.api.post(
                        "/medical-screening/records",
                        {
                            "screening_type": pick(
                                requirement, "screening_type", "screeningType"
                            )
                            or "physical_exam",
                            "status": "completed",
                            "completed_date": str(completed),
                            "expiration_date": str(completed + timedelta(days=365)),
                            "provider_name": "Oakville Occupational Health",
                            "result_summary": "Cleared for full duty.",
                            "requirement_id": pick(requirement, "id"),
                            "user_id": user_id,
                        },
                    )
                )
        return {"requirements": requirements, "records": records}

    # -- facilities: maintenance & inspections -----------------------

    # name, description, membership types, priority, how many requirements
    COMPLIANCE_PROFILES = [
        (
            "Line Officers",
            "Officers carry the full requirement set and are held to it strictly.",
            ["active"],
            10,
            3,
        ),
        (
            "Probationary Members",
            "A probationary member is graded on the core set only, until release.",
            ["probationary"],
            5,
            1,
        ),
    ]

    def seed_compliance_profiles(self) -> dict[str, Any]:
        """Save a compliance configuration, then the profiles it unlocks.

        The Profiles tab refuses to build anything until a threshold
        configuration has been saved — "Save the compliance thresholds first
        before creating profiles" — and a department that has only ever *looked*
        at the Thresholds tab has not saved one: the numbers it shows before a
        first save are the code's defaults, not a stored row. So the tab renders
        that notice and nothing else, which is a truthful screen of an
        unconfigured department and a useless one for documenting profiles.
        """
        config = self.api.get("/compliance/config")
        if not config:
            config = self.api.post(
                "/compliance/config/initialize",
                {
                    "threshold_type": "percentage",
                    "compliant_threshold": 100,
                    "at_risk_threshold": 75,
                    "grace_period_days": 0,
                    "notify_on_non_compliant": False,
                    "reminder_days": [30, 14, 7],
                },
            )

        existing = {p.get("name") for p in items(config, "profiles")}
        # One id per *distinct name*. The department carries three separate
        # requirements all called "Aerial Operations" — one per program — and
        # the picker returns only id, name, type, source and frequency, so
        # nothing at any layer tells them apart. Three identical chips on a
        # profile read as a rendering bug when they are the honest answer, and
        # they teach nothing about what a profile is for.
        seen_names: set[str] = set()
        requirement_ids = []
        for requirement in items(
            self.api.get("/compliance/config/requirements"), "requirements"
        ):
            name = str(pick(requirement, "name") or "")
            if name in seen_names:
                continue
            seen_names.add(name)
            requirement_ids.append(pick(requirement, "id"))
        created = 0
        for name, description, types, priority, wanted in self.COMPLIANCE_PROFILES:
            if name in existing:
                continue
            self.api.post(
                "/compliance/config/profiles",
                {
                    "name": name,
                    "description": description,
                    "membership_types": types,
                    # Sliced from whatever the department actually has rather
                    # than named: requirement ids are per-install, and a profile
                    # naming one that does not exist is refused.
                    "required_requirement_ids": requirement_ids[:wanted],
                    "is_active": True,
                    "priority": priority,
                },
            )
            created += 1

        reports = self.api.get("/compliance/reports?limit=20")
        if not items(reports, "reports"):
            # One generated report, so Report History is a history rather than
            # its own empty state. Last month rather than this one: a report for
            # a month still in progress grades everyone against requirements
            # they still have time to meet, which is not what the screen is for.
            first_of_month = TODAY.replace(day=1)
            previous = first_of_month - timedelta(days=1)
            self.api.post(
                "/compliance/reports/generate",
                {
                    "report_type": "monthly",
                    "year": previous.year,
                    "month": previous.month,
                    # Never true here. Generating a report is safe to seed;
                    # mailing one to every officer in the demo department is not.
                    "send_email": False,
                },
            )
        return {"profiles_created": created}

    def seed_external_provider(self) -> dict[str, Any]:
        """Configure the department's LMS so Integrations is not an empty state.

        Only the *configuration* is seeded. `connection_verified`, `last_sync_at`
        and the import queue are written by a real sync against a real vendor
        API, and no create/update field sets them — so this department reads
        "Connection not verified" and "Last Sync: Never", which is what a
        department that has entered its credentials and not yet pressed Sync
        actually sees.
        """
        existing = items(self.api.get("/training/external/providers"), "providers")
        if existing:
            return {"providers": existing}

        # The API base URL is fetched server-side during a sync, so it goes
        # through an SSRF guard that resolves the hostname and rejects anything
        # private. A made-up host would fail to resolve and the create would
        # 400; the vendor's real API host is the one value that passes.
        categories = items(self.api.get("/training/categories"), "categories")
        default_category = next(
            (c for c in categories if pick(c, "name") == "Fire Suppression"),
            categories[0] if categories else None,
        )
        provider = self.api.post(
            "/training/external/providers",
            {
                "name": "Vector Solutions",
                "provider_type": "vector_solutions",
                "description": (
                    "Department LMS. Completed courses sync into each member's "
                    "training record and count toward their requirements."
                ),
                "api_base_url": "https://api.vectorsolutions.com/v1",
                "auth_type": "api_key",
                # Stored encrypted, and never sent anywhere: no sync is seeded.
                "api_key": "demo-key-not-a-real-credential",
                "auto_sync_enabled": True,
                "sync_interval_hours": 24,
                "default_category_id": (
                    pick(default_category, "id") if default_category else None
                ),
            },
        )
        return {"providers": [provider] if provider else []}

    def seed_facility_activity(self, facilities: list[dict]) -> dict[str, list[dict]]:
        maintenance = items(self.api.get("/facilities/maintenance"), "maintenance")
        inspections = items(self.api.get("/facilities/inspections"), "inspections")
        if not facilities:
            return {"maintenance": maintenance, "inspections": inspections}

        # Every maintenance record must name a type; the module ships none, so
        # the demo defines its own catalogue first.
        types = items(self.api.get("/facilities/maintenance-types"), "types")
        type_names = {t.get("name") for t in types}
        for name, category, interval, unit in [
            ("Preventive Maintenance", "preventive", 6, "months"),
            ("Repair", "repair", None, None),
            ("Safety Inspection", "safety", 12, "months"),
            ("Deep Cleaning", "cleaning", 3, "months"),
        ]:
            if name in type_names:
                continue
            payload = {
                "name": name,
                "category": category,
                "description": f"{name} performed on department facilities.",
            }
            if interval:
                payload["default_interval_value"] = interval
                payload["default_interval_unit"] = unit
            types.append(self.api.post("/facilities/maintenance-types", payload))

        if not maintenance:
            # Each record names the type it is actually an instance of. Taking
            # `types[index % len(types)]` walked an alphabetical list of ~39
            # department-configurable types and stamped whatever fell out, so
            # the maintenance list read "HVAC filter replacement — dorm wing"
            # under a "Backflow Preventer Test" badge. Falling back to General
            # Repair keeps a department that has trimmed its type list working.
            by_name = {pick(t, "name"): pick(t, "id") for t in types}

            def type_id(*preferred: str) -> str | None:
                for name in (*preferred, "General Repair", "Repair"):
                    if by_name.get(name):
                        return by_name[name]
                return pick(types[0], "id") if types else None

            for index, (description, vendor, cost, days_ago, kind) in enumerate(
                [
                    (
                        "Replace bay door opener motor",
                        "Tidewater Door Service",
                        1_840,
                        45,
                        "Bay Door Service",
                    ),
                    (
                        "Annual generator load bank test",
                        "PowerGen Services",
                        950,
                        30,
                        "Generator Annual Load Test",
                    ),
                    (
                        "HVAC filter replacement — dorm wing",
                        "In-house",
                        120,
                        12,
                        "HVAC Filter Change",
                    ),
                    (
                        "Repair kitchen exhaust hood",
                        "Chesapeake Mechanical",
                        640,
                        None,
                        "Exhaust Extraction System Inspection",
                    ),
                    (
                        "Reseal apparatus bay floor",
                        "Atlantic Coatings",
                        3_200,
                        None,
                        "General Repair",
                    ),
                ]
            ):
                facility = facilities[index % len(facilities)]
                payload = {
                    "facility_id": pick(facility, "id"),
                    "maintenance_type_id": type_id(kind),
                    "description": description,
                    "vendor": vendor,
                    "cost": cost,
                    "notes": f"{description} at {facility.get('name')}.",
                }
                if days_ago is None:
                    payload["is_completed"] = False
                    payload["due_date"] = str(TODAY + timedelta(days=21))
                    payload["scheduled_date"] = str(TODAY + timedelta(days=14))
                else:
                    payload["is_completed"] = True
                    payload["completed_date"] = str(TODAY - timedelta(days=days_ago))
                    payload["work_performed"] = description
                    payload["next_due_date"] = str(
                        TODAY + timedelta(days=365 - days_ago)
                    )
                maintenance.append(self.api.post("/facilities/maintenance", payload))
        else:
            self._repair_maintenance_types(
                "/facilities/maintenance",
                maintenance,
                types,
                {
                    "Replace bay door opener motor": "Bay Door Service",
                    "Annual generator load bank test": "Generator Annual Load Test",
                    "HVAC filter replacement — dorm wing": "HVAC Filter Change",
                    "Repair kitchen exhaust hood": (
                        "Exhaust Extraction System Inspection"
                    ),
                    "Reseal apparatus bay floor": "General Repair",
                },
            )

        if not inspections:
            for index, (title, kind, inspector, agency, passed, days_ago) in enumerate(
                [
                    (
                        "Annual Fire Marshal Inspection",
                        "fire",
                        "L. Ferreira",
                        "Oakville Fire Marshal",
                        True,
                        60,
                    ),
                    (
                        "Building Code Compliance Review",
                        "building_code",
                        "D. Whitmore",
                        "County Building Office",
                        True,
                        120,
                    ),
                    (
                        "Insurance Loss-Control Survey",
                        "insurance",
                        "R. Alvarez",
                        "Commonwealth Mutual",
                        False,
                        20,
                    ),
                    (
                        "ADA Accessibility Audit",
                        "ada",
                        "K. Berhane",
                        "Access Consultants LLC",
                        None,
                        None,
                    ),
                ]
            ):
                facility = facilities[index % len(facilities)]
                payload = {
                    "facility_id": pick(facility, "id"),
                    "title": title,
                    "inspection_type": kind,
                    "inspection_date": str(
                        TODAY - timedelta(days=days_ago if days_ago else 0)
                    ),
                    "inspector_name": inspector,
                    "inspector_organization": agency,
                    "inspector_agency": agency,
                    "next_inspection_date": str(TODAY + timedelta(days=300)),
                }
                if passed is not None:
                    payload["passed"] = passed
                if passed is False:
                    payload["findings"] = (
                        "Extinguisher in the dorm hallway is past its hydrostatic test date."
                    )
                    payload["corrective_actions"] = "Replace or recertify the unit."
                    payload["corrective_action_deadline"] = str(
                        TODAY + timedelta(days=30)
                    )
                inspections.append(self.api.post("/facilities/inspections", payload))
        return {"maintenance": maintenance, "inspections": inspections}

    # -- events: templates -------------------------------------------

    def seed_event_templates(self) -> list[dict]:
        templates = items(self.api.get("/events/templates"), "templates")
        names = {t.get("name") for t in templates}
        for name, event_type, minutes, mandatory in [
            ("Monthly Business Meeting", "business_meeting", 120, True),
            ("Weekly Company Drill", "training", 180, False),
            ("Station Open House", "public_education", 300, False),
            ("Officer Meeting", "business_meeting", 90, False),
        ]:
            if name in names:
                continue
            templates.append(
                self.api.post(
                    "/events/templates",
                    {
                        "name": name,
                        "description": f"Reusable settings for {name.lower()}s.",
                        "event_type": event_type,
                        "default_title": name,
                        "default_location": "Station 1 - Headquarters",
                        "default_duration_minutes": minutes,
                        "requires_rsvp": True,
                        "is_mandatory": mandatory,
                        "send_reminders": True,
                        "reminder_schedule": [168, 24],
                    },
                )
            )
        return templates

    # -- storefront ---------------------------------------------------

    def seed_storefront(self, members: list[dict] | None = None) -> dict[str, Any]:
        products = items(self.api.get("/store/products"), "products")
        names = {p.get("name") for p in products}
        blueprint = [
            (
                "Department Job Shirt",
                "SHIRT-JOB",
                "Apparel",
                48.00,
                ["S", "M", "L", "XL", "XXL"],
            ),
            ("Duty Polo", "SHIRT-POLO", "Apparel", 32.00, ["S", "M", "L", "XL", "XXL"]),
            (
                "Department Hoodie",
                "HOOD-01",
                "Apparel",
                54.00,
                ["S", "M", "L", "XL", "XXL"],
            ),
            ("Ball Cap", "CAP-01", "Headwear", 22.00, []),
            ("Challenge Coin", "COIN-01", "Accessories", 12.00, []),
            ("Travel Mug", "MUG-01", "Accessories", 18.00, []),
        ]
        for order, (name, sku, category, price, sizes) in enumerate(blueprint):
            if name in names:
                continue
            products.append(
                self.api.post(
                    "/store/products",
                    {
                        "name": name,
                        "sku": sku,
                        "category": category,
                        "description": f"{name} with department crest.",
                        "price": price,
                        "status": "active",
                        "sortOrder": order,
                        "personalizationEnabled": bool(sizes),
                        "personalizationLabel": "Name for embroidery",
                        "personalizationPrice": 6.00 if sizes else 0,
                        "requiresVariant": bool(sizes),
                        "variants": [
                            {
                                "label": size,
                                "sku": f"{sku}-{size}",
                                "priceDelta": 3.00 if size == "XXL" else 0,
                                "isActive": True,
                                "sortOrder": index,
                            }
                            for index, size in enumerate(sizes)
                        ],
                    },
                )
            )

        windows = items(self.api.get("/store/windows"), "windows")
        window_name = f"Fall {TODAY.year} Order Window"
        if not any(w.get("name") == window_name for w in windows):
            windows.append(
                self.api.post(
                    "/store/windows",
                    {
                        "name": window_name,
                        "description": (
                            "Place apparel orders for the fall vendor run."
                        ),
                        "opensAt": iso(NOW - timedelta(days=3)),
                        "closesAt": iso(NOW + timedelta(days=18)),
                        "autoOpen": True,
                        "autoClose": True,
                        "expectedDeliveryDate": str(TODAY + timedelta(days=60)),
                        "pickupInstructions": (
                            "Pick up at Station 1 during weeknight duty crew hours."
                        ),
                        "includeAllProducts": True,
                        "notifyOnOpen": True,
                        "offerings": [],
                    },
                )
            )

        self._open_store_window(windows, window_name)
        self._seed_store_settings()
        orders = self._seed_store_orders(products, members or [])
        return {"products": products, "windows": windows, "orders": orders}

    def _open_store_window(self, windows: list[dict], window_name: str) -> None:
        """Open the order window rather than waiting for autoOpen to notice it.

        A window created with ``autoOpen`` starts ``scheduled`` and is promoted
        by a background task, which on a fresh database has not run by the time
        the next line places an order. The order was refused with "There is no
        open order window" and reported as a store configuration fact, so the
        first seed of a new database produced no orders at all and the second
        one silently produced them — the window having opened in between.

        Opening it here makes one seeding run enough. ``notifyMembers`` is off:
        the announcement is a real email to every member and has nothing to do
        with what the guides picture.
        """
        window = next((w for w in windows if w.get("name") == window_name), None)
        if not window:
            return
        if str(pick(window, "status") or "").lower() == "open":
            return
        window_id = pick(window, "id")
        if not window_id:
            return
        try:
            self.api.post(
                f"/store/windows/{window_id}/open",
                {"notifyMembers": False},
            )
        except ApiError as exc:
            self.blocked.append(f"store window open: {exc}")

    def _seed_store_settings(self) -> None:
        """Configure how members pay.

        My Orders shows the payment buttons and handles only when the store has
        methods enabled and the corresponding handle set — with none configured
        an unpaid order shows a balance and no way to settle it.
        """
        settings = self.api.get("/store/settings") or {}
        if pick(settings, "venmo_handle", "venmoHandle"):
            return
        self.api.put(
            "/store/settings",
            {
                "isEnabled": True,
                "storeName": "Oakville Fire Department Store",
                "tagline": "Department apparel and accessories",
                "acceptedPaymentMethods": ["venmo", "cash_app", "zelle", "check"],
                "venmoHandle": "@OakvilleFD",
                "cashAppCashtag": "$OakvilleFD",
                "zelleHandle": "treasurer@oakvillefd.example.org",
                "zelleInstructions": (
                    "Put your order number in the Zelle memo so the treasurer "
                    "can match the payment."
                ),
                "checkPayableTo": "Oakville Fire Department",
                "allowPickup": True,
                "pickupLocation": "Station 1 - Headquarters",
            },
        )

    def _seed_store_orders(
        self, products: list[dict], members: list[dict]
    ) -> list[dict]:
        """Place an unpaid order for the demo administrator, plus two members'.

        The My Orders guide pictures an order awaiting payment, and orders are
        first-person — `POST /store/orders` records the *calling* user, so this
        has to be the account the screenshots are captured as.

        The member orders and the state spread run on every pass, not only when
        the administrator has none. Guarding the whole method on the
        administrator's own order meant a second seeding run — the ordinary
        case, since the seeder runs before every capture — skipped both, and
        Store Admin stayed a one-row list in a single state.
        """
        if not items(self.api.get("/store/orders/mine"), "orders"):
            self._place_admin_store_order(products)
        self._seed_member_store_orders(products, members)
        self._spread_store_order_states()
        return items(self.api.get("/store/orders/mine"), "orders")

    def _place_admin_store_order(self, products: list[dict]) -> None:
        """The administrator's own unpaid order, which My Orders pictures."""
        wanted = ("Department Job Shirt", "Ball Cap")
        lines = []
        for product in products:
            if product.get("name") not in wanted:
                continue
            variants = items(product, "variants")
            line = {"productId": pick(product, "id"), "quantity": 1}
            if variants:
                line["variantId"] = pick(variants[len(variants) // 2], "id")
                line["personalizationText"] = "D. RUIZ"
            lines.append(line)
        if not lines:
            return
        try:
            self.api.post(
                "/store/orders",
                {
                    "items": lines,
                    "paymentMethod": "venmo",
                    "fulfillmentMethod": "pickup",
                    "memberNotes": "Pick up on a weeknight duty shift.",
                },
            )
        except ApiError as exc:
            # No open window, or the window does not offer these products —
            # a store configuration fact, not a seeding failure.
            if exc.code != 400:
                raise
            self.blocked.append(f"store order: {exc}")

    def _seed_member_store_orders(
        self, products: list[dict], members: list[dict]
    ) -> None:
        """Two more orders, placed by members rather than the administrator.

        Orders are first-person -- ``POST /store/orders`` records the *calling*
        user and there is no admin "order on behalf of" route -- so a demo whose
        only order belongs to the administrator gives Store Admin a one-row list
        and nothing to filter. Guide 19 pictures the activity cards against a
        matching filtered list, which needs several orders in several states.

        Same mechanism as ``seed_event_rsvps``: sign in as each member. Local
        demo fixtures in a throwaway database, never real accounts.
        """
        existing = items(self.api.get("/store/orders"), "orders")
        if len(existing) >= 4:
            return

        line_products = [
            product
            for product in products
            if product.get("name") in ("Department Job Shirt", "Ball Cap")
        ]
        if not line_products:
            return

        # The administrator is excluded, not just skipped by luck of ordering:
        # member_session clears a forced password change with an admin reset,
        # and POST /users/{id}/reset-password refuses your own account -- "Use
        # the change-password endpoint to change your own password". The roster
        # is returned admin-first, so members[:3] reached it every time.
        orderers = [m for m in members if m.get("username") != DEMO_ADMIN_USERNAME][:3]
        for member in orderers:
            user_id = pick(member, "id")
            username = member.get("username")
            if not user_id or not username:
                continue
            try:
                session = self.member_session(self.base_url, user_id, username)
            except ApiError as exc:
                self.blocked.append(f"store order for {username}: {exc}")
                continue
            product = line_products[len(existing) % len(line_products)]
            variants = items(product, "variants")
            line = {"productId": pick(product, "id"), "quantity": 1}
            if variants:
                line["variantId"] = pick(variants[0], "id")
            try:
                session.post(
                    "/store/orders",
                    {
                        "items": [line],
                        "paymentMethod": "venmo",
                        "fulfillmentMethod": "pickup",
                    },
                )
            except ApiError as exc:
                if exc.code != 400:
                    raise
                self.blocked.append(f"store order for {username}: {exc}")

    def _spread_store_order_states(self) -> None:
        """Leave the order list sitting in more than one state.

        Store Admin's activity cards count orders by status and its list filters
        on the same values, so a demo where every order is `submitted` gives the
        cards one non-zero number and the filters nothing to distinguish. Guide
        19 asks for at least three states on one screen.

        Advanced through the real transition endpoint rather than written
        directly, so an order that cannot legally reach a status stays where it
        is instead of the demo asserting a state the product would refuse.
        Notification is off: these are back-dated fixtures and the member does
        not need an email per step.

        **The administrator's own order is left where it is.** It is the one
        `18-04-my-orders-unpaid` pictures — "an unpaid order with its balance
        and payment options" — and advancing it to `paid` emptied that shot of
        its subject while every gate stayed green.
        """
        mine = {
            pick(order, "id")
            for order in items(self.api.get("/store/orders/mine"), "orders")
        }
        orders = [
            order
            for order in items(self.api.get("/store/orders"), "orders")
            if pick(order, "id") not in mine
        ]
        if len(orders) < 2:
            return

        # Ordered by how far along they are, so the cards read as a pipeline
        # rather than as an arbitrary scatter.
        wanted = ["paid", "ordered", "ready_for_pickup"]
        for order, status in zip(orders, wanted):
            if str(pick(order, "status") or "") == status:
                continue
            order_id = pick(order, "id")
            if not order_id:
                continue
            try:
                self.api.post(
                    f"/store/orders/{order_id}/status",
                    {"status": status, "notifyMember": False},
                )
            except ApiError as exc:
                if exc.code != 400:
                    raise
                self.blocked.append(f"store order -> {status}: {exc}")

    # -- run ---------------------------------------------------------

    def run(self) -> int:
        print("Seeding demo data...")
        self.step("enable all modules", self.enable_all_modules)
        members = self.step("members", self.seed_members) or []
        self.step("member changes", lambda: self.seed_member_changes(members))
        facilities = self.step("facilities", self.seed_facilities) or []
        stations = self.step("stations", lambda: self.seed_locations(facilities)) or []
        self.step("rooms", lambda: self.seed_rooms(facilities))
        apparatus = self.step("apparatus", lambda: self.seed_apparatus(stations)) or []
        evoc_levels = self.step("evoc levels", self.seed_evoc_levels) or []
        self.step(
            "apparatus operators",
            lambda: self.seed_apparatus_operators(apparatus, members, evoc_levels),
        )
        self.step("apparatus activity", lambda: self.seed_apparatus_activity(apparatus))
        events = self.step("events", self.seed_events) or []
        self.step(
            "event rsvps",
            lambda: self.seed_event_rsvps(self.base_url, events, members),
        )
        self.step("platoons", lambda: self.seed_platoons(members))
        self.step(
            "scheduling",
            lambda: self.seed_scheduling(stations, apparatus, members),
        )
        self.step("shift calls", self.seed_shift_calls)
        self.step("admin hours entries", self.seed_admin_hours_entries)
        self.step("apparatus crew positions", self.seed_apparatus_crew_positions)
        self.step("scheduling requests", self.seed_scheduling_requests)
        training = self.step("training", self.seed_training) or {}
        self.step("course cohort", lambda: self.seed_course_cohort(members))
        self.step(
            "training records",
            lambda: self.seed_training_records(members, training.get("courses", [])),
        )
        self.step("training submission", self.seed_training_submission)
        self.step("training programs", lambda: self.seed_training_programs(members))
        self.step(
            "training enhancements",
            lambda: self.seed_training_enhancements(
                members, training.get("courses", [])
            ),
        )
        templates = self.step("skills testing", self.seed_skills_testing) or []
        self.step("skills tests", lambda: self.seed_skills_tests(templates, members))
        self.step(
            "skills test with points",
            lambda: self.seed_scored_test(templates, members),
        )
        self.step(
            "skills test that failed",
            lambda: self.seed_failed_test(templates, members),
        )
        self.step(
            "skills test in progress",
            lambda: self.seed_in_progress_test(templates, members),
        )
        self.step(
            "skills test awaiting validation",
            lambda: self.seed_pending_validation_test(
                self.base_url, templates, members
            ),
        )
        self.step("skills test viewer", lambda: self.seed_test_viewer(members))
        self.step(
            "skills test result mix",
            lambda: self.seed_skill_test_result_mix(self.base_url, templates, members),
        )
        inventory = self.step("inventory", lambda: self.seed_inventory(stations)) or {}
        self.step(
            "inventory operations",
            lambda: self.seed_inventory_operations(
                inventory.get("categories", []),
                inventory.get("items", []),
                stations,
                members,
            ),
        )
        self.step(
            "inventory variants",
            lambda: self.seed_inventory_variants(
                inventory.get("categories", []), stations
            ),
        )
        # After the variants: the requests name catalog items, and the gloves
        # one of them asks for is created by the variant pass.
        self.step(
            "equipment requests",
            lambda: self.seed_equipment_requests(self.base_url),
        )
        self.step("event check-ins", lambda: self.seed_event_check_ins(events, members))
        self.step("documents", self.seed_documents)
        self.step("legal documents", self.seed_legal_documents)
        self.step("notification rules", self.seed_notification_rules)
        # After scheduling (needs upcoming crewed shifts) — the reminder task
        # notifies each rostered member, the administrator among them.
        self.step("shift reminder inbox", self.seed_shift_reminder_notification)
        self.step("officers", lambda: self.seed_officers(members))
        self.step("messages", lambda: self.seed_messages(self.base_url, members))
        forms = self.step("forms", self.seed_forms) or []
        self.step(
            "form submissions",
            lambda: self.seed_form_submissions(self.base_url, forms, members),
        )
        self.step("event templates", self.seed_event_templates)
        # Minutes before elections: the closed election links itself to the
        # minutes record at creation, and it cannot be patched once closed.
        minutes = self.step("meeting minutes", self.seed_minutes) or []
        self.step("meetings", lambda: self.seed_meetings(members))
        self.step("event request", self.seed_event_request)
        self.step("elections", lambda: self.seed_elections(minutes))
        prospect_data = (
            self.step("prospective members", self.seed_prospective_members) or {}
        )
        # After the pipeline exists, deliberately: a guest sign-in creates a
        # prospect in the DEFAULT pipeline's first stage, and on a fresh
        # database this step used to run before any pipeline existed — the
        # guest prospect then had no stage, no kanban card, and the
        # guest-prospect screenshot had nothing to open.
        self.step(
            "guest check-in event",
            lambda: self.seed_guest_check_in_event(stations),
        )
        if self.bulk_prospects:
            pipelines = prospect_data.get("pipelines") or []
            self.step(
                "bulk applicants (kanban truncation)",
                lambda: self.seed_bulk_prospects(
                    pick(pipelines[0], "id") if pipelines else None,
                    self.bulk_prospects,
                ),
            )
        # After prospective members: the vote consumes the election package
        # that step creates.
        self.step("membership vote outcome", self.seed_membership_vote_outcome)
        self.step("grants & fundraising", self.seed_grants)
        self.step("medical screening", lambda: self.seed_medical_screening(members))
        self.step("compliance profiles", self.seed_compliance_profiles)
        self.step("external training provider", self.seed_external_provider)
        self.step("facility activity", lambda: self.seed_facility_activity(facilities))
        self.step("storefront", lambda: self.seed_storefront(members))
        finance = self.step("finance", self.seed_finance) or {}
        self.step("dues", lambda: self.seed_dues(finance.get("fiscal_year")))
        self.step("approval chains", self.seed_approval_chains)
        self.step("purchase requests", lambda: self.seed_purchase_requests(finance))
        self.step("expense reports", lambda: self.seed_expense_reports(finance))
        self.step("check requests", lambda: self.seed_check_requests(finance))
        self.step("equipment checks", self.seed_equipment_checks)
        # After the equipment checks, not before. This creates a template of its
        # own, and `seed_equipment_checks` needs to have claimed the Engine
        # Daily Check first — it selects by name now, but ordering that does not
        # depend on that fix is one less thing to get wrong later.
        self.step("supply tracking", lambda: self.seed_supply_tracking(apparatus))
        self.step("shift reports", lambda: self.seed_shift_reports(members))
        # After the reports: the pair-picker above skips recruits, so crewing
        # one onto the ladder now leaves their Evaluate control live.
        self.step("batch report trainee", self.seed_batch_report_trainee)
        self.step("scheduling requests", self.seed_scheduling_requests)
        # After the reports: finalizing auto-creates drafts for attendees, and
        # doing it first would put a second batch of drafts in the way of the
        # ones seed_shift_reports files deliberately.
        self.step("finalized shift", self.seed_finalized_shift)
        # After finalization: seed_finalized_shift closes the *oldest* crewed
        # past shift, and this fixture must not be the one it picks — the wizard
        # cannot open on a finalized shift.
        self.step(
            "close-out wizard fixture",
            lambda: self.seed_call_tracking_closeout(members),
        )

        print(f"\nMembers on file: {len(members)}")
        if self.blocked:
            print("\nBlocked (product bugs the seeder cannot work around):")
            for note in self.blocked:
                print(f"  - {note}")
        if self.failures:
            print("\nFailures:")
            for failure in self.failures:
                print(f"  - {failure}")
            return 1
        print("\nSeeding complete.")
        return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:3001")
    parser.add_argument(
        "--allow-remote",
        action="store_true",
        help="allow an explicitly chosen non-loopback demo backend",
    )
    parser.add_argument(
        "--bulk-prospects",
        nargs="?",
        type=int,
        const=BULK_PROSPECT_TARGET,
        default=0,
        metavar="N",
        help=(
            "Pad the membership pipeline out to N active applicants so the "
            "kanban board exceeds its card ceiling and renders the "
            f"'Showing 200 of N' notice. Defaults to {BULK_PROSPECT_TARGET} "
            "when the flag is given without a number. Off by default: it "
            "costs a few hundred requests and buries the named applicants the "
            "other prospective-member screenshots are built around."
        ),
    )
    args = parser.parse_args()

    require_safe_base_url(args.base_url, args.allow_remote)
    api = Api(args.base_url)
    api.login()
    return Seeder(api, args.base_url, bulk_prospects=args.bulk_prospects).run()


if __name__ == "__main__":
    sys.exit(main())
