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
from time import sleep
from typing import Any
from zoneinfo import ZoneInfo

from bootstrap_demo import DEMO_ADMIN_PASSWORD, DEMO_ADMIN_USERNAME

# Shared password given to the seeded member accounts so the seeder can act as
# them where the API has no admin-on-behalf-of route (event RSVPs). Demo-only.
DEMO_MEMBER_PASSWORD = "DemoMember!2026"

# Screenshots must not look stale, so dated records are generated relative to
# the run date rather than hard-coded.
# An RSVP the app refuses because the window has closed is the rule working, not
# a seeding error — matched on the message because the status code is a plain 400.
# The scheduling module refuses to double-book a member across overlapping
# shifts. That is the rule working, not a seeding error — matched on the message
# because the status code is a plain 400.
SHIFT_CONFLICT = re.compile(r"conflicting shift", re.IGNORECASE)

RSVP_CLOSED = re.compile(
    r"deadline has passed|already ended|no longer accepting", re.IGNORECASE
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

# `User.rank` stores the operational rank's *code*, not its display name — the
# settings page validates it against the configured codes and lists every
# mismatch as "active members with unrecognised ranks". Seeding display names
# put all 22 demo members in that warning box.
MEMBERS = [
    ("Dana", "Ruiz", "chief", "fire_chief"),
    ("Marcus", "Bell", "mbell", "deputy_chief"),
    ("Priya", "Raman", "praman", "assistant_chief"),
    ("Owen", "Kittredge", "okittredge", "captain"),
    ("Sofia", "Marchetti", "smarchetti", "captain"),
    ("Tobias", "Lindqvist", "tlindqvist", "lieutenant"),
    ("Amara", "Osei", "aosei", "lieutenant"),
    ("Henrik", "Vance", "hvance", "engineer"),
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
    ("Viktor", "Brennan", "vbrennan", "probationary"),
    ("Saoirse", "Nolan", "snolan", "probationary"),
    ("Emeka", "Adeyemi", "eadeyemi", "probationary"),
    ("Wren", "Halloway", "whalloway", "administrative"),
]

# The default rank set covers the operational ladder but not these two, and the
# demo roster needs both — a probationary member is the whole point of several
# training and eligibility screens.
EXTRA_RANKS = [
    ("probationary", "Probationary", 90, ["probationary", "firefighter"]),
    ("administrative", "Administrative", 95, ["other"]),
]

APPARATUS = [
    ("E-1", "Engine 1", 2021, "Pierce", "Enforcer", "engine"),
    ("E-2", "Engine 2", 2015, "Pierce", "Saber", "engine"),
    ("L-4", "Ladder 4", 2019, "Seagrave", "Aerialscope", "ladder"),
    ("M-3", "Medic 3", 2023, "Ford", "F-450 / Horton", "ambulance"),
    ("R-7", "Rescue 7", 2018, "Spartan", "Gladiator", "rescue"),
    ("B-5", "Brush 5", 2020, "Ford", "F-550", "brush"),
    ("U-1", "Utility 1", 2017, "Chevrolet", "Silverado 2500", "utility"),
]

FACILITIES = [
    ("Station 1 - Headquarters", "410 Grand Avenue", 1962, 24000, 4),
    ("Station 2 - Westside", "1820 Prairie Road", 1988, 11500, 2),
    ("Training & Administration Center", "22 Depot Street", 2004, 9200, 1),
]


class Seeder:
    def __init__(self, api: Api, base_url: str) -> None:
        self.api = api
        self.base_url = base_url
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

    def seed_ranks(self) -> None:
        """Add the ranks the demo roster uses that the defaults do not carry."""
        existing = {
            pick(r, "rank_code", "rankCode")
            for r in items(self.api.get("/operational-ranks"), "ranks")
        }
        for code, name, order, positions in EXTRA_RANKS:
            if code in existing:
                continue
            self.api.post(
                "/operational-ranks",
                {
                    "rank_code": code,
                    "display_name": name,
                    "sort_order": order,
                    "eligible_positions": positions,
                },
            )

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
        return created

    # -- membership: recorded changes --------------------------------

    def seed_member_changes(self, members: list[dict]) -> None:
        """Promote a couple of members so the audit history has real entries.

        The history page is a timeline of *changes*. Without any it fills with
        "Member profile viewed" rows — which the screenshot tooling itself
        generates on every capture run — and the guide's example of "Rank changed
        from X to Y" has nothing behind it.
        """
        promotions = [
            ("vbrennan", "firefighter"),
            ("snolan", "emt"),
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
                "seatingCapacity": 4,
                "minStaffing": 2,
                "currentMileage": 18_000 + year % 100 * 250,
                "inServiceDate": str(date(year, 5, 1)),
                "vin": f"1FD{unit.replace('-', ''):<4.4}{year}XX{index:07d}"[:17],
                "licensePlate": f"VA-{unit.replace('-', '')}",
                "licenseState": "VA",
            }
            if station_ids:
                payload["primaryStationId"] = station_ids[index % len(station_ids)]
            created.append(self.api.post("/apparatus", payload))
        return created

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
                ),
                ("Oil and filter change", "In-house", 210, 75),
                (
                    "Brake inspection and pad replacement",
                    "Commonwealth Truck",
                    1_180,
                    40,
                ),
                ("Aerial ladder annual certification", "Seagrave Service", 3_600, 200),
                ("Replace front tires", "Tidewater Tire", 1_950, None),
                ("Repair cab HVAC blower", "Commonwealth Truck", 640, None),
            ]
            for index, (description, vendor, cost, days_ago) in enumerate(work):
                unit = apparatus[index % len(apparatus)]
                payload = {
                    "apparatus_id": pick(unit, "id"),
                    "maintenance_type_id": pick(types[index % len(types)], "id"),
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
        return created

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
        for index, item in enumerate(assignable):
            status = (item.get("status") or "").lower()
            if status and status != "available":
                continue
            user_id = pick(members[index % len(members)], "id")
            item_id = pick(item, "id")
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
        for shift in target_shifts:
            checks.extend(
                items(
                    self.api.get(
                        f"/equipment-checks/shifts/{pick(shift, 'id')}/checks"
                    ),
                    "checks",
                )
            )
        if checks:
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
            check = self.api.post(
                f"/equipment-checks/shifts/{pick(shift, 'id')}/checks",
                {
                    "template_id": template_id,
                    "check_timing": "start_of_shift",
                    "items": shift_items,
                },
            )
            checks.append(check)
            # A check only counts toward the compliance report once completed.
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
        return {"templates": templates, "checks": checks}

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
            if str(m.get("rank") or "").lower().startswith("probation")
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

    def seed_skills_testing(self) -> list[dict]:
        templates = items(
            self.api.get("/training/skills-testing/templates"), "templates"
        )
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
                                {
                                    "label": label,
                                    "type": "checkbox",
                                    "required": True,
                                    "sort_order": criterion_order,
                                    "max_score": 1,
                                }
                                for criterion_order, label in enumerate(criteria)
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

    def seed_training_records(
        self, members: list[dict], courses: list[dict]
    ) -> list[dict]:
        records = items(self.api.get("/training/records?limit=200"), "records")
        if records or not courses:
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
            member_api = Api(base_url)
            try:
                member_api.login_as(username, DEMO_MEMBER_PASSWORD)
            except ApiError:
                # Members seeded before the demo password was set at creation
                # need one; the admin reset route is heavily rate limited, so
                # this path is slow by design and only runs once per member.
                self.api.post(
                    f"/users/{user_id}/reset-password",
                    {"new_password": DEMO_MEMBER_PASSWORD, "force_change": False},
                )
                member_api = Api(base_url)
                member_api.login_as(username, DEMO_MEMBER_PASSWORD)
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

    def seed_skills_tests(
        self, templates: list[dict], members: list[dict]
    ) -> list[dict]:
        tests = items(self.api.get("/training/skills-testing/tests"), "tests")
        if tests or not templates or not members:
            return tests
        for index, member in enumerate(members[:6]):
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
        self._seed_nominations(elections)
        return elections

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
        for index, (first, last, reason) in enumerate(self.PROSPECTS):
            email = f"{first.lower()}.{last.lower()}@example.org"
            if email in emails:
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
        return {"pipelines": pipelines, "prospects": prospects}

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
            for index, (description, vendor, cost, days_ago) in enumerate(
                [
                    (
                        "Replace bay door opener motor",
                        "Tidewater Door Service",
                        1_840,
                        45,
                    ),
                    ("Annual generator load bank test", "PowerGen Services", 950, 30),
                    ("HVAC filter replacement — dorm wing", "In-house", 120, 12),
                    ("Repair kitchen exhaust hood", "Chesapeake Mechanical", 640, None),
                    ("Reseal apparatus bay floor", "Atlantic Coatings", 3_200, None),
                ]
            ):
                facility = facilities[index % len(facilities)]
                payload = {
                    "facility_id": pick(facility, "id"),
                    "maintenance_type_id": pick(types[index % len(types)], "id"),
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
        self.step("ranks", self.seed_ranks)
        members = self.step("members", self.seed_members) or []
        self.step("member changes", lambda: self.seed_member_changes(members))
        facilities = self.step("facilities", self.seed_facilities) or []
        stations = self.step("stations", lambda: self.seed_locations(facilities)) or []
        apparatus = self.step("apparatus", lambda: self.seed_apparatus(stations)) or []
        self.step("evoc levels", self.seed_evoc_levels)
        self.step("apparatus activity", lambda: self.seed_apparatus_activity(apparatus))
        events = self.step("events", self.seed_events) or []
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
        self.step("messages", lambda: self.seed_messages(self.base_url, members))
        forms = self.step("forms", self.seed_forms) or []
        self.step(
            "form submissions",
            lambda: self.seed_form_submissions(self.base_url, forms, members),
        )
        self.step("event templates", self.seed_event_templates)
        self.step("elections", self.seed_elections)
        self.step("prospective members", self.seed_prospective_members)
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
    args = parser.parse_args()

    api = Api(args.base_url)
    api.login()
    return Seeder(api, args.base_url).run()


if __name__ == "__main__":
    sys.exit(main())
