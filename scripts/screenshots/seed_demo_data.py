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
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from http.cookiejar import CookieJar
from typing import Any

from bootstrap_demo import DEMO_ADMIN_PASSWORD, DEMO_ADMIN_USERNAME

# Screenshots must not look stale, so dated records are generated relative to
# the run date rather than hard-coded.
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
        try:
            with self.opener.open(req, timeout=120) as resp:
                body = resp.read().decode()
        except urllib.error.HTTPError as exc:
            raise ApiError(method, path, exc.code, exc.read().decode()[:600]) from exc
        return json.loads(body) if body else None

    def get(self, path: str) -> Any:
        return self.call("GET", path)

    def post(self, path: str, payload: Any = None) -> Any:
        return self.call("POST", path, payload if payload is not None else {})

    def patch(self, path: str, payload: Any) -> Any:
        return self.call("PATCH", path, payload)

    def put(self, path: str, payload: Any) -> Any:
        return self.call("PUT", path, payload)

    def login(self) -> None:
        self.call(
            "POST",
            "/auth/login",
            {"username": DEMO_ADMIN_USERNAME, "password": DEMO_ADMIN_PASSWORD},
        )


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


# ── Seed steps ────────────────────────────────────────────────────────

MEMBERS = [
    ("Dana", "Ruiz", "chief", "Chief"),
    ("Marcus", "Bell", "mbell", "Deputy Chief"),
    ("Priya", "Raman", "praman", "Assistant Chief"),
    ("Owen", "Kittredge", "okittredge", "Captain"),
    ("Sofia", "Marchetti", "smarchetti", "Captain"),
    ("Tobias", "Lindqvist", "tlindqvist", "Lieutenant"),
    ("Amara", "Osei", "aosei", "Lieutenant"),
    ("Henrik", "Vance", "hvance", "Lieutenant"),
    ("Nadia", "Belhaj", "nbelhaj", "Firefighter"),
    ("Callum", "Frazier", "cfrazier", "Firefighter"),
    ("Ingrid", "Solberg", "isolberg", "Firefighter"),
    ("Rafael", "Duarte", "rduarte", "Firefighter"),
    ("Yuki", "Tanaka", "ytanaka", "Firefighter"),
    ("Delia", "Okonkwo", "dokonkwo", "Firefighter/EMT"),
    ("Bram", "Hollis", "bhollis", "Firefighter/EMT"),
    ("Esme", "Caldwell", "ecaldwell", "Firefighter/EMT"),
    ("Jonah", "Whitfield", "jwhitfield", "Paramedic"),
    ("Lila", "Nakamura", "lnakamura", "Paramedic"),
    ("Viktor", "Brennan", "vbrennan", "Probationary"),
    ("Saoirse", "Nolan", "snolan", "Probationary"),
    ("Emeka", "Adeyemi", "eadeyemi", "Probationary"),
    ("Wren", "Halloway", "whalloway", "Administrative"),
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
    def __init__(self, api: Api) -> None:
        self.api = api
        self.failures: list[str] = []
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
                },
            )
            created.append(record)
        return created

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

    # -- events ------------------------------------------------------

    def seed_events(self) -> list[dict]:
        existing = items(self.api.get("/events?limit=100"), "events")
        titles = {e.get("title") for e in existing}
        planned = [
            ("Monthly Business Meeting", "business_meeting", 3, 2),
            ("Q3 Ladder Operations Drill", "training", 6, 3),
            ("Pump Operations Refresher", "training", 10, 2),
            ("Live Fire Evolutions", "training", 17, 4),
            ("Station 2 Open House", "public_education", 24, 5),
            ("Officer Development Session", "training", 31, 2),
            ("Annual Awards Banquet", "social", 45, 4),
        ]
        created = list(existing)
        for title, event_type, days_out, hours in planned:
            if title in titles:
                continue
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
                        "rsvp_deadline": iso(start - timedelta(days=1)),
                        "is_mandatory": event_type == "business_meeting",
                        "send_reminders": True,
                        "is_draft": False,
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
            ("Pump Operations", "PUMP", "skills_practice", 24, "Fire Suppression", 24),
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
        return folders

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

    # -- run ---------------------------------------------------------

    def run(self) -> int:
        print("Seeding demo data...")
        self.step("enable all modules", self.enable_all_modules)
        members = self.step("members", self.seed_members) or []
        facilities = self.step("facilities", self.seed_facilities) or []
        stations = self.step("stations", lambda: self.seed_locations(facilities)) or []
        self.step("apparatus", lambda: self.seed_apparatus(stations))
        self.step("events", self.seed_events)
        self.step("training", self.seed_training)
        self.step("inventory", lambda: self.seed_inventory(stations))
        self.step("documents", self.seed_documents)
        self.step("finance", self.seed_finance)

        print(f"\nMembers on file: {len(members)}")
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
    return Seeder(api).run()


if __name__ == "__main__":
    sys.exit(main())
