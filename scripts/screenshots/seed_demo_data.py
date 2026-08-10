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
import json
import re
import sys
import urllib.error
import urllib.request
import uuid
from datetime import date, datetime, time, timedelta, timezone
from http.cookiejar import CookieJar
from time import monotonic, sleep
from typing import Any
from zoneinfo import ZoneInfo

from bootstrap_demo import DEMO_ADMIN_PASSWORD, DEMO_ADMIN_USERNAME


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
ADMIN_RESET_THROTTLE = Throttle(max_calls=5, window_seconds=300)

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
# A second member, used as the *examiner* on the peer-run skills test. It has to
# be someone other than the candidate: skills testing refuses a test whose
# examiner is also its candidate.
DEMO_PEER_EXAMINER_USERNAME = "cfrazier"
# The one skill sheet built from weighted `score` steps. Named so the test
# seeder can find it: it is the only template that can produce a scorecard with
# per-section point totals and a percentage.
SCORED_TEMPLATE_NAME = "Handline Advance — Weighted Evaluation"

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
SHIFT_CONFLICT = re.compile(r"conflicting shift", re.IGNORECASE)

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
        self.login_as(DEMO_ADMIN_USERNAME, DEMO_ADMIN_PASSWORD)

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


def _demo_pdf(title: str, subtitle: str) -> bytes:
    """A one-page PDF standing in for a real department document.

    The upload route sniffs the MIME type from the file's magic bytes rather
    than trusting the declared Content-Type, so this has to be a genuine PDF,
    not text with a .pdf name. reportlab is already a backend dependency; where
    it is missing the caller still gets a valid file, just a plain-text one —
    text/plain is on the allow-list too.
    """
    try:
        from io import BytesIO

        from reportlab.lib.pagesizes import LETTER
        from reportlab.pdfgen import canvas
    except ImportError:
        return f"{title}\n\n{subtitle}\n".encode()

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

FACILITIES = [
    ("Station 1 - Headquarters", "410 Grand Avenue", 1962, 24000, 4),
    ("Station 2 - Westside", "1820 Prairie Road", 1988, 11500, 2),
    ("Training & Administration Center", "22 Depot Street", 2004, 9200, 1),
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
            created.append(record)
        self._fill_in_the_administrator(created)
        return created

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

    def seed_facilities(self) -> list[dict]:
        existing = items(self.api.get("/facilities"), "facilities")
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
        codes = {level.get("code") for level in levels}
        blueprint = [
            (1, "Basic", "EVOC-1", "Emergency vehicle operation, non-transport."),
            (2, "Intermediate", "EVOC-2", "Engine and rescue apparatus."),
            (3, "Advanced", "EVOC-3", "Aerial and tiller-equipped apparatus."),
        ]
        for number, name, code, description in blueprint:
            if code in codes:
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
        fleet = [o for o in options if pick(o, "id")]
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
                    "notes": f"{name} on {pick(unit, 'unit_number', 'unitNumber')}.",
                }
                if station_id:
                    payload["station_id"] = station_id
                # The officer is drawn from the same per-day pool as the crew.
                # Setting shift_officer_id mints an assignment of its own, so an
                # officer picked independently could already be crewing another
                # apparatus that day and the API rejects the double-booking.
                if pool_cursor < len(day_pool):
                    payload["shift_officer_id"] = day_pool[pool_cursor]
                    pool_cursor += 1
                shift = self.api.post("/scheduling/shifts", payload)
                shifts.append(shift)

                # Most shifts are staffed one short so the Open Shifts tab has
                # vacancies to show. Every other day the first apparatus is
                # crewed to its minimum instead: the calendar tints a shift by
                # how well it is staffed, and a schedule that is uniformly short
                # renders as a wall of amber with no green to compare it to.
                full = index == 0 and offset % 2 == 0
                shift_id = pick(shift, "id")
                crew = day_pool[
                    pool_cursor : pool_cursor + staffing - (0 if full else 1)
                ]
                pool_cursor += len(crew)
                for slot, user_id in enumerate(crew):
                    try:
                        self.api.post(
                            f"/scheduling/shifts/{shift_id}/assignments",
                            {
                                "user_id": user_id,
                                "position": ("officer" if slot == 0 else "firefighter"),
                            },
                        )
                    except ApiError as exc:
                        # The night shift runs 19:00-07:00, so its crew is still
                        # on duty into the next date and the API refuses to
                        # double-book them. Rotating the pool reduces that but
                        # cannot eliminate it for every roster size, and the
                        # rule belongs to the app, not the seeder: a refusal on
                        # these grounds means the shift is simply short a member,
                        # which the Open Shifts tab is meant to show anyway.
                        if exc.code != 400 or not SHIFT_CONFLICT.search(exc.detail):
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
        return {
            "templates": templates,
            "patterns": patterns,
            "apparatus": fleet,
            "shifts": shifts,
        }

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
                # Same overlapping-shift refusal the create path tolerates: the
                # member is already on duty, so the shift stays a seat short.
                if exc.code != 400 or not SHIFT_CONFLICT.search(exc.detail):
                    raise
            used += 1
        return used

    # -- scheduling: logged calls ------------------------------------

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
        # Before the round-robin, not after: the spread hands every spare piece
        # to a different member, so a kit built afterwards has nothing left to
        # build from.
        kitted = self._kit_out_one_member(members, assignable)

        for index, item in enumerate(assignable):
            status = (item.get("status") or "").lower()
            item_id = pick(item, "id")
            if (status and status != "available") or item_id in kitted:
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

        return {"storage_areas": areas, "kits": kits, "allowances": allowances}

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

    def seed_equipment_checks(self) -> dict[str, Any]:
        """A template plus completed checks, which the reports page aggregates."""
        templates = items(self.api.get("/equipment-checks/templates"), "templates")
        if not templates:
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
            templates.append(
                self.api.post(
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
                                        "check_type": "presence",
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
            )

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
                                    "check_type": "presence",
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

        template = templates[0]
        template_id = pick(template, "id")
        if not template_id:
            return {"templates": templates, "checks": []}

        # Checks belong to a shift — there is no module-level collection to list
        # or post to, so both the idempotency check and the create go through
        # the shift the crew would actually have been working.
        shifts = items(self.api.get("/scheduling/shifts?limit=20"), "shifts")
        target_shifts = [s for s in shifts if pick(s, "id")][:3]
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
        if all(
            {"start_of_shift", "end_of_shift"} <= timings
            for timings in existing_by_shift.values()
        ):
            return {"templates": templates, "checks": checks}

        # The template response carries the ids the check has to reference, so
        # the submitted items are read back off it rather than reconstructed.
        detail = self.api.get(f"/equipment-checks/templates/{template_id}")
        submitted = []
        for compartment in items(detail, "compartments"):
            for item in items(compartment, "items"):
                submitted.append(
                    {
                        "template_item_id": pick(item, "id"),
                        "compartment_name": pick(compartment, "name"),
                        "item_name": pick(item, "name"),
                        "status": "pass",
                        "quantity_found": 1,
                        "required_quantity": 1,
                    }
                )
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
            end_items = [
                {
                    "template_item_id": pick(item, "id"),
                    "compartment_name": pick(compartment, "name"),
                    "item_name": pick(item, "name"),
                    "status": "pass",
                    "quantity_found": 1,
                    "required_quantity": 1,
                }
                for compartment in items(end_detail, "compartments")
                for item in items(compartment, "items")
            ]
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
        months = {str(pick(r, "shift_date", "shiftDate"))[:7] for r in existing}
        if wanted <= have and len(months) >= 2:
            return items(self.api.get("/training/shift-reports/all?limit=50"))

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
            if len(pairs) >= 5:
                break
            crew = items(
                self.api.get(f"/training/shift-reports/shift-crew/{pick(shift, 'id')}")
            )
            available = [
                c
                for c in crew
                if not c.get("has_existing_report")
                and str(c.get("user_id")) not in seen_trainees
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
        others = [r for r in queued if r not in mine]
        for report in mine[:1] + others[:1]:
            self.api.post(
                f"/training/shift-reports/{pick(report, 'id')}/review",
                {"review_status": "approved"},
            )
        for report in others[1:2]:
            self.api.post(
                f"/training/shift-reports/{pick(report, 'id')}/review",
                {
                    "review_status": "flagged",
                    "reviewer_notes": (
                        "Hours do not match the roster for this shift — please "
                        "confirm the relief time and resubmit."
                    ),
                },
            )
        return reports

    # -- notification rules ------------------------------------------

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
        signers = [m for m in members if m.get("username") != DEMO_ADMIN_USERNAME]
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
                [
                    (
                        "Phase 1 — Orientation",
                        [
                            ("Department Orientation", "hours", 8),
                            ("PPE Familiarization", "hours", 4),
                            ("Station Duties Checklist", "checklist", None),
                            ("Ride-Along Shifts", "shifts", 3),
                        ],
                    ),
                    (
                        "Phase 2 — Basic Skills",
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
                        "Phase 3 — Certification",
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
                        "Phase 1 — Classroom",
                        [
                            ("Pump Theory", "hours", 16),
                            ("Hydraulics Calculations", "hours", 8),
                        ],
                    ),
                    (
                        "Phase 2 — Behind the Wheel",
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
                        requirement["checklist_items"] = [
                            "Reviewed with company officer",
                            "Signed off in station logbook",
                        ]
                    phase["requirements"].append(requirement)
                payload["phases"].append(phase)
            programs.append(self.api.post("/training/programs/programs/build", payload))

        # Enrol the probationary members so the Enrollments tab and the
        # member-facing progression view have rows to render. Enrollments are
        # only listable per program — there is no collection-level GET.
        probationary = [
            pick(m, "id")
            for m in members
            if str(pick(m, "username") or "") in RECRUIT_USERNAMES
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
        return programs

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

    def seed_skills_testing(self) -> list[dict]:
        templates = items(
            self.api.get("/training/skills-testing/templates"), "templates"
        )
        self._repair_criterion_types(templates)
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

    def seed_training_records(
        self, members: list[dict], courses: list[dict]
    ) -> list[dict]:
        records = items(self.api.get("/training/records?limit=200"), "records")
        if records or not courses:
            self._attach_a_certificate(records)
            return records
        # Every member gets a spread of completed courses so My Training, the
        # compliance matrix and the hours reports all have something to show;
        # a few expirations land in the near future to populate the
        # expiring-certifications view.
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
                        completed + timedelta(days=365 + member_index * 3)
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

        for member_index, member in enumerate(members):
            user_id = pick(member, "id")
            username = member.get("username")
            if not user_id or username == DEMO_ADMIN_USERNAME:
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
                    if exc.code != 400 or not RSVP_CLOSED.search(exc.detail):
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

    def seed_skills_tests(
        self, templates: list[dict], members: list[dict]
    ) -> list[dict]:
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

        existing = items(self.api.get("/training/skills-testing/tests"), "tests")
        for test in existing:
            if pick(test, "template_id", "templateId") == template_id and pick(
                test, "completed_at", "completedAt"
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
                "notes": "Annual handline evaluation, weighted sheet.",
            },
        )
        test_id = pick(test, "id")
        if not test_id:
            return None

        # Deliberately short of full marks on two steps, so the section totals
        # differ from one another and the percentage is not a flat 100.
        awarded = {
            "Selects and stretches the correct line": 9,
            "Advances without kinks or snags": 8,
            "Bleeds the line and sets the pattern": 10,
            "Maintains control under flow": 15,
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
                score = awarded.get(label)
                criteria_results.append(
                    {
                        "criterion_id": f"criterion-{si}-{ci}",
                        "criterion_label": label,
                        "passed": True,
                        "score": score,
                        "notes": (
                            "Slight kink at the stairwell turn."
                            if label == "Advances without kinks or snags"
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
        for member in [m for m in members if m.get("username") != DEMO_ADMIN_USERNAME][
            :rounds
        ]:
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

    def seed_elections(self) -> list[dict]:
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
        return elections

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
            meeting_id = pick(meetings[index % len(meetings)], "id")
            if not meeting_id:
                continue
            self.api.patch(f"/elections/{election_id}", {"event_id": meeting_id})

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
            # Spread applicants across the board so the kanban shows movement
            # rather than a single stacked first column.
            for _ in range(index % len(self.PIPELINE_STAGES)):
                self.api.post(
                    f"/prospective-members/prospects/{pick(prospect, 'id')}/advance"
                )
        self._enable_public_status(pipelines)
        self._seed_election_packages(prospects)
        self._link_prospect_events(prospects)
        return {"pipelines": pipelines, "prospects": prospects}

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
                self.api.get(
                    f"/prospective-members/prospects/{prospect_id}/election-package"
                )
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
                    },
                )
            except ApiError as exc:
                if exc.code not in (400, 409):
                    raise
                self.blocked.append(f"election package: {exc}")

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

    def seed_storefront(self) -> dict[str, Any]:
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

        self._seed_store_settings()
        orders = self._seed_store_orders(products)
        return {"products": products, "windows": windows, "orders": orders}

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

    def _seed_store_orders(self, products: list[dict]) -> list[dict]:
        """Place an unpaid order for the demo administrator.

        The My Orders guide pictures an order awaiting payment, and orders are
        first-person — `POST /store/orders` records the *calling* user, so this
        has to be the account the screenshots are captured as.
        """
        existing = items(self.api.get("/store/orders/mine"), "orders")
        if existing:
            return existing
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
            return existing
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
        return items(self.api.get("/store/orders/mine"), "orders")

    # -- run ---------------------------------------------------------

    def run(self) -> int:
        print("Seeding demo data...")
        self.step("enable all modules", self.enable_all_modules)
        members = self.step("members", self.seed_members) or []
        self.step("member changes", lambda: self.seed_member_changes(members))
        facilities = self.step("facilities", self.seed_facilities) or []
        stations = self.step("stations", lambda: self.seed_locations(facilities)) or []
        apparatus = self.step("apparatus", lambda: self.seed_apparatus(stations)) or []
        evoc_levels = self.step("evoc levels", self.seed_evoc_levels) or []
        self.step(
            "apparatus operators",
            lambda: self.seed_apparatus_operators(apparatus, members, evoc_levels),
        )
        self.step("apparatus activity", lambda: self.seed_apparatus_activity(apparatus))
        events = self.step("events", self.seed_events) or []
        self.step(
            "guest check-in event",
            lambda: self.seed_guest_check_in_event(stations),
        )
        self.step(
            "event rsvps",
            lambda: self.seed_event_rsvps(self.base_url, events, members),
        )
        self.step(
            "scheduling",
            lambda: self.seed_scheduling(stations, apparatus, members),
        )
        self.step("shift calls", self.seed_shift_calls)
        training = self.step("training", self.seed_training) or {}
        self.step(
            "training records",
            lambda: self.seed_training_records(members, training.get("courses", [])),
        )
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
        self.step("event check-ins", lambda: self.seed_event_check_ins(events, members))
        self.step("documents", self.seed_documents)
        self.step("notification rules", self.seed_notification_rules)
        self.step("officers", lambda: self.seed_officers(members))
        self.step("messages", lambda: self.seed_messages(self.base_url, members))
        forms = self.step("forms", self.seed_forms) or []
        self.step(
            "form submissions",
            lambda: self.seed_form_submissions(self.base_url, forms, members),
        )
        self.step("event templates", self.seed_event_templates)
        self.step("elections", self.seed_elections)
        prospect_data = (
            self.step("prospective members", self.seed_prospective_members) or {}
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
        self.step("grants & fundraising", self.seed_grants)
        self.step("medical screening", lambda: self.seed_medical_screening(members))
        self.step("facility activity", lambda: self.seed_facility_activity(facilities))
        self.step("storefront", self.seed_storefront)
        finance = self.step("finance", self.seed_finance) or {}
        self.step("dues", lambda: self.seed_dues(finance.get("fiscal_year")))
        self.step("approval chains", self.seed_approval_chains)
        self.step("purchase requests", lambda: self.seed_purchase_requests(finance))
        self.step("expense reports", lambda: self.seed_expense_reports(finance))
        self.step("check requests", lambda: self.seed_check_requests(finance))
        self.step("equipment checks", self.seed_equipment_checks)
        self.step("shift reports", lambda: self.seed_shift_reports(members))
        # After the reports: finalizing auto-creates drafts for attendees, and
        # doing it first would put a second batch of drafts in the way of the
        # ones seed_shift_reports files deliberately.
        self.step("finalized shift", self.seed_finalized_shift)

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

    api = Api(args.base_url)
    api.login()
    return Seeder(api, args.base_url, bulk_prospects=args.bulk_prospects).run()


if __name__ == "__main__":
    sys.exit(main())
