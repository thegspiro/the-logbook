#!/usr/bin/env python3
"""
Seed Script — Generate 100 test members with training records.

Usage:
    python scripts/seed_test_data.py

Environment variables (or edit the defaults below):
    BASE_URL        — Backend API base URL (default: http://localhost:8000)
    ADMIN_USERNAME  — Admin account username
    ADMIN_PASSWORD  — Admin account password

The script will:
  1. Log in as the admin user
  2. Create 100 members with realistic fire-department data
  3. Create training courses (if none exist)
  4. Create 3-8 training records per member (varied types, statuses, dates)
"""

import os
import sys
import json
import random
import string
import hashlib
from datetime import date, timedelta
from typing import Optional

try:
    import requests
except ImportError:
    sys.exit("ERROR: 'requests' package not found. Install with: pip install requests")

# ─── Configuration ────────────────────────────────────────────────────
BASE_URL = os.environ.get("BASE_URL", "http://localhost:8000").rstrip("/")
API = f"{BASE_URL}/api/v1"
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")

# ─── Constants ────────────────────────────────────────────────────────
RANKS = [
    ("fire_chief", 1),
    ("deputy_chief", 2),
    ("assistant_chief", 3),
    ("captain", 6),
    ("lieutenant", 10),
    ("engineer", 15),
    ("firefighter", 63),
]
STATIONS = ["Station 1", "Station 2", "Station 3", "Station 4"]
STATES = ["CA", "TX", "FL", "NY", "IL", "OH", "PA", "GA", "NC", "MI"]
CITIES = [
    "Springfield", "Fairview", "Greenville", "Madison", "Franklin",
    "Clinton", "Arlington", "Georgetown", "Salem", "Bristol",
]
STREETS = [
    "Main St", "Oak Ave", "Maple Dr", "Cedar Ln", "Elm St",
    "Pine Rd", "Birch Ct", "Walnut Way", "Ash Blvd", "Park Ave",
]

FIRST_NAMES_M = [
    "James", "Robert", "Michael", "William", "David", "Richard", "Joseph",
    "Thomas", "Christopher", "Charles", "Daniel", "Matthew", "Anthony",
    "Mark", "Steven", "Paul", "Andrew", "Joshua", "Kenneth", "Kevin",
    "Brian", "George", "Timothy", "Ronald", "Edward", "Jason", "Jeffrey",
    "Ryan", "Jacob", "Nicholas", "Gary", "Eric", "Jonathan", "Stephen",
    "Larry", "Justin", "Scott", "Brandon", "Benjamin", "Samuel",
]
FIRST_NAMES_F = [
    "Mary", "Patricia", "Jennifer", "Linda", "Barbara", "Elizabeth",
    "Susan", "Jessica", "Sarah", "Karen", "Lisa", "Nancy", "Betty",
    "Margaret", "Sandra", "Ashley", "Dorothy", "Kimberly", "Emily",
    "Donna", "Michelle", "Carol", "Amanda", "Melissa", "Deborah",
    "Stephanie", "Rebecca", "Sharon", "Laura", "Cynthia", "Kathleen",
    "Amy", "Angela", "Shirley", "Anna", "Brenda", "Pamela", "Emma",
    "Nicole", "Helen",
]
LAST_NAMES = [
    "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller",
    "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez",
    "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
    "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark",
    "Ramirez", "Lewis", "Robinson", "Walker", "Young", "Allen", "King",
    "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores", "Green",
    "Adams", "Nelson", "Baker", "Hall", "Rivera", "Campbell", "Mitchell",
    "Carter", "Roberts",
]
RELATIONSHIPS = ["Spouse", "Parent", "Sibling", "Partner", "Friend"]
EC_FIRST_NAMES = FIRST_NAMES_M + FIRST_NAMES_F

TRAINING_COURSES = [
    {"name": "Firefighter I", "code": "FF-I", "training_type": "certification", "duration_hours": 160, "expiration_months": 36},
    {"name": "Firefighter II", "code": "FF-II", "training_type": "certification", "duration_hours": 120, "expiration_months": 36},
    {"name": "Hazmat Awareness", "code": "HAZMAT-A", "training_type": "certification", "duration_hours": 24, "expiration_months": 12},
    {"name": "Hazmat Operations", "code": "HAZMAT-O", "training_type": "certification", "duration_hours": 40, "expiration_months": 24},
    {"name": "EMT-Basic", "code": "EMT-B", "training_type": "certification", "duration_hours": 150, "expiration_months": 24},
    {"name": "CPR/AED", "code": "CPR", "training_type": "certification", "duration_hours": 4, "expiration_months": 24},
    {"name": "Driver/Operator — Pumper", "code": "DO-P", "training_type": "certification", "duration_hours": 60, "expiration_months": 36},
    {"name": "Driver/Operator — Aerial", "code": "DO-A", "training_type": "certification", "duration_hours": 40, "expiration_months": 36},
    {"name": "Incident Command System 100", "code": "ICS-100", "training_type": "certification", "duration_hours": 3, "expiration_months": None},
    {"name": "Incident Command System 200", "code": "ICS-200", "training_type": "certification", "duration_hours": 4, "expiration_months": None},
    {"name": "NIMS 700", "code": "NIMS-700", "training_type": "certification", "duration_hours": 3, "expiration_months": None},
    {"name": "NIMS 800", "code": "NIMS-800", "training_type": "certification", "duration_hours": 3, "expiration_months": None},
    {"name": "Annual Live Fire Drill", "code": "LF-ANN", "training_type": "skills_practice", "duration_hours": 8, "expiration_months": 12},
    {"name": "Ladder Operations Refresher", "code": "LAD-REF", "training_type": "refresher", "duration_hours": 4, "expiration_months": 12},
    {"name": "SCBA Confidence Course", "code": "SCBA-CC", "training_type": "skills_practice", "duration_hours": 4, "expiration_months": 12},
    {"name": "Forcible Entry Techniques", "code": "FE-101", "training_type": "skills_practice", "duration_hours": 4, "expiration_months": None},
    {"name": "Wildland Firefighting S-130", "code": "S-130", "training_type": "certification", "duration_hours": 32, "expiration_months": 36},
    {"name": "Rope Rescue Technician", "code": "RRT", "training_type": "specialty", "duration_hours": 40, "expiration_months": 24},
    {"name": "Confined Space Rescue", "code": "CSR", "training_type": "specialty", "duration_hours": 40, "expiration_months": 24},
    {"name": "Water Rescue Awareness", "code": "WRA", "training_type": "certification", "duration_hours": 16, "expiration_months": 24},
    {"name": "Fire Inspector I", "code": "FI-I", "training_type": "certification", "duration_hours": 80, "expiration_months": 36},
    {"name": "Bloodborne Pathogens", "code": "BBP", "training_type": "refresher", "duration_hours": 2, "expiration_months": 12},
    {"name": "Apparatus Checkout Procedures", "code": "ACP", "training_type": "orientation", "duration_hours": 2, "expiration_months": None},
    {"name": "Map & District Familiarization", "code": "MAP-FAM", "training_type": "orientation", "duration_hours": 4, "expiration_months": None},
    {"name": "Quarterly EMS Continuing Ed", "code": "EMS-CE", "training_type": "continuing_education", "duration_hours": 6, "expiration_months": None},
]

INSTRUCTORS = [
    "Chief Williams", "Capt. Rodriguez", "Lt. Chen", "Eng. Patel",
    "Capt. O'Brien", "Lt. Jackson", "Chief Martinez", "Capt. Thompson",
]
LOCATIONS = [
    "Training Academy", "Station 1 Bay", "Station 2 Classroom",
    "County Fire Training Center", "Regional Burn Building",
    "Station 3 Yard", "Online / Virtual",
]
ISSUING_AGENCIES = [
    "NFPA", "Pro Board", "IFSAC", "NREMT", "State Fire Marshal",
    "American Heart Association", "FEMA / EMI", "State EMS Office",
]

# ─── Helpers ──────────────────────────────────────────────────────────
session = requests.Session()
session.headers.update({"Content-Type": "application/json"})

created_users: list[dict] = []
course_ids: dict[str, str] = {}


def login():
    """Authenticate and store the access token."""
    resp = session.post(f"{API}/auth/login", json={
        "username": ADMIN_USERNAME,
        "password": ADMIN_PASSWORD,
    })
    if resp.status_code != 200:
        print(f"Login failed ({resp.status_code}): {resp.text}")
        sys.exit(1)
    token = resp.json()["access_token"]
    session.headers["Authorization"] = f"Bearer {token}"
    print(f"  Logged in as {ADMIN_USERNAME}")


def rand_phone():
    return f"555-{random.randint(100,999)}-{random.randint(1000,9999)}"


def rand_date(start_year: int, end_year: int) -> str:
    start = date(start_year, 1, 1)
    end = date(end_year, 12, 28)
    delta = (end - start).days
    d = start + timedelta(days=random.randint(0, max(delta, 1)))
    return d.isoformat()


def unique_username(first: str, last: str, idx: int) -> str:
    """Generate a unique username from name + index."""
    base = f"{first[0].lower()}{last.lower()}"
    # Strip non-alpha
    base = "".join(c for c in base if c.isalpha())
    return f"{base}{idx}"


def pick_rank() -> str:
    """Weighted random rank selection."""
    population = []
    for rank, weight in RANKS:
        population.extend([rank] * weight)
    return random.choice(population)


# ─── Core Logic ───────────────────────────────────────────────────────

def create_courses():
    """Create training courses if the org has none."""
    resp = session.get(f"{API}/training/courses")
    if resp.status_code == 200:
        existing = resp.json()
        if isinstance(existing, list) and len(existing) > 0:
            print(f"  {len(existing)} courses already exist — using them")
            for c in existing:
                course_ids[c["name"]] = c["id"]
            return
    elif resp.status_code != 200:
        print(f"  Warning: could not list courses ({resp.status_code}), will create fresh")

    print(f"  Creating {len(TRAINING_COURSES)} training courses...")
    for tc in TRAINING_COURSES:
        payload = {
            "name": tc["name"],
            "code": tc["code"],
            "training_type": tc["training_type"],
            "duration_hours": tc["duration_hours"],
            "credit_hours": tc["duration_hours"],
            "active": True,
        }
        if tc["expiration_months"]:
            payload["expiration_months"] = tc["expiration_months"]
        resp = session.post(f"{API}/training/courses", json=payload)
        if resp.status_code in (200, 201):
            data = resp.json()
            course_ids[tc["name"]] = data["id"]
        else:
            print(f"    WARN: Could not create course '{tc['name']}' ({resp.status_code}): {resp.text[:120]}")


def create_member(idx: int) -> Optional[dict]:
    """Create a single member and return the response data."""
    if random.random() < 0.5:
        first = random.choice(FIRST_NAMES_M)
    else:
        first = random.choice(FIRST_NAMES_F)
    last = random.choice(LAST_NAMES)
    username = unique_username(first, last, idx)
    email = f"{username}@testdept.example.com"
    badge = f"{random.randint(1000, 9999)}"
    rank = pick_rank()
    station = random.choice(STATIONS)
    hire_year = random.randint(2005, 2025)
    hire_date = rand_date(hire_year, min(hire_year, 2025))
    city = random.choice(CITIES)
    state = random.choice(STATES)

    ec_first = random.choice(EC_FIRST_NAMES)
    ec_last = last if random.random() < 0.6 else random.choice(LAST_NAMES)

    payload = {
        "username": username,
        "email": email,
        "first_name": first,
        "last_name": last,
        "membership_number": badge,
        "mobile": rand_phone(),
        "hire_date": hire_date,
        "rank": rank,
        "station": station,
        "address_street": f"{random.randint(100,9999)} {random.choice(STREETS)}",
        "address_city": city,
        "address_state": state,
        "address_zip": f"{random.randint(10000,99999)}",
        "emergency_contacts": [
            {
                "name": f"{ec_first} {ec_last}",
                "relationship": random.choice(RELATIONSHIPS),
                "phone": rand_phone(),
                "is_primary": True,
            }
        ],
        "send_welcome_email": False,
    }

    resp = session.post(f"{API}/users", json=payload)
    if resp.status_code in (200, 201):
        data = resp.json()
        user_id = data.get("id") or data.get("user", {}).get("id")
        return {"id": user_id, "name": f"{first} {last}", "rank": rank, "hire_date": hire_date}
    else:
        # Membership number collision — retry with different number
        if resp.status_code == 409 or "already" in resp.text.lower():
            payload["membership_number"] = f"{random.randint(10000,99999)}"
            payload["username"] = f"{username}x"
            payload["email"] = f"{username}x@testdept.example.com"
            resp2 = session.post(f"{API}/users", json=payload)
            if resp2.status_code in (200, 201):
                data = resp2.json()
                user_id = data.get("id") or data.get("user", {}).get("id")
                return {"id": user_id, "name": f"{first} {last}", "rank": rank, "hire_date": hire_date}
        print(f"    WARN: Failed to create member #{idx} ({resp.status_code}): {resp.text[:120]}")
        return None


def create_training_records(user: dict):
    """Create 3-8 training records for a member."""
    hire_date = date.fromisoformat(user["hire_date"])
    num_records = random.randint(3, 8)

    # Pick a random subset of courses
    available = list(TRAINING_COURSES)
    random.shuffle(available)
    courses = available[:num_records]

    for tc in courses:
        # Completion date between hire date and today
        days_since_hire = (date.today() - hire_date).days
        if days_since_hire < 30:
            days_since_hire = 365  # new hire, fabricate some history
        completion = hire_date + timedelta(days=random.randint(30, max(days_since_hire, 60)))
        if completion > date.today():
            completion = date.today() - timedelta(days=random.randint(1, 90))

        # 85% completed, 8% scheduled, 5% failed, 2% in-progress
        roll = random.random()
        if roll < 0.85:
            status = "completed"
            passed = True
            score = round(random.uniform(75, 100), 1) if random.random() < 0.6 else None
        elif roll < 0.93:
            status = "scheduled"
            passed = None
            score = None
            # Scheduled in the future
            completion = date.today() + timedelta(days=random.randint(7, 90))
        elif roll < 0.98:
            status = "failed"
            passed = False
            score = round(random.uniform(40, 69), 1)
        else:
            status = "in_progress"
            passed = None
            score = None

        hours = tc["duration_hours"]
        if status in ("completed", "failed"):
            hours_done = hours
        elif status == "in_progress":
            hours_done = round(hours * random.uniform(0.2, 0.7), 1)
        else:
            hours_done = 0

        # Expiration
        expiration = None
        if status == "completed" and tc.get("expiration_months"):
            expiration = (completion + timedelta(days=tc["expiration_months"] * 30)).isoformat()

        payload = {
            "user_id": user["id"],
            "course_name": tc["name"],
            "course_code": tc["code"],
            "training_type": tc["training_type"],
            "hours_completed": hours_done,
            "credit_hours": hours_done if status == "completed" else 0,
            "status": status,
            "instructor": random.choice(INSTRUCTORS),
            "location": random.choice(LOCATIONS),
        }
        if status in ("completed", "failed"):
            payload["completion_date"] = completion.isoformat()
        if status == "scheduled":
            payload["scheduled_date"] = completion.isoformat()
        if passed is not None:
            payload["passed"] = passed
        if score is not None:
            payload["score"] = score
            payload["passing_score"] = 70.0
        if expiration:
            payload["expiration_date"] = expiration
        if status == "completed" and random.random() < 0.5:
            payload["certification_number"] = (
                f"{tc['code']}-{completion.year}-{random.randint(1000,9999)}"
            )
            payload["issuing_agency"] = random.choice(ISSUING_AGENCIES)

        # Attach to course if it was created
        if tc["name"] in course_ids:
            payload["course_id"] = course_ids[tc["name"]]

        resp = session.post(f"{API}/training/records", json=payload)
        if resp.status_code not in (200, 201):
            print(f"    WARN: Training record for {user['name']} / {tc['name']} failed ({resp.status_code}): {resp.text[:100]}")


# ─── Main ─────────────────────────────────────────────────────────────
def main():
    if not ADMIN_USERNAME or not ADMIN_PASSWORD:
        print("=" * 60)
        print("  Test Data Seed Script")
        print("=" * 60)
        print()
        print("Please provide admin credentials to authenticate with the API.\n")
        global ADMIN_USERNAME, ADMIN_PASSWORD
        ADMIN_USERNAME = input("  Admin username: ").strip()
        ADMIN_PASSWORD = input("  Admin password: ").strip()
        if not ADMIN_USERNAME or not ADMIN_PASSWORD:
            sys.exit("ERROR: Credentials are required.")

    print()
    print("=" * 60)
    print(f"  Seeding test data against {BASE_URL}")
    print("=" * 60)

    # Step 1: Login
    print("\n[1/3] Authenticating...")
    login()

    # Step 2: Courses
    print("\n[2/3] Setting up training courses...")
    create_courses()
    print(f"  {len(course_ids)} courses available")

    # Step 3: Members + Training Records
    print("\n[3/3] Creating 100 members with training records...")
    success = 0
    total_records = 0
    for i in range(1, 101):
        user = create_member(i)
        if user:
            created_users.append(user)
            create_training_records(user)
            success += 1
            # Count approximate records
            total_records += random.randint(3, 8)  # rough estimate
            if i % 10 == 0:
                print(f"  ... {i}/100 members processed ({success} created)")
        else:
            print(f"  ... #{i} skipped")

    # Summary
    print()
    print("=" * 60)
    print(f"  Done!")
    print(f"  Members created:  {success}/100")
    print(f"  Courses available: {len(course_ids)}")
    print(f"  Training records:  ~{total_records} (3-8 per member)")
    print("=" * 60)

    # Rank breakdown
    from collections import Counter
    rank_counts = Counter(u["rank"] for u in created_users)
    print("\n  Rank distribution:")
    for rank, count in sorted(rank_counts.items(), key=lambda x: -x[1]):
        label = rank.replace("_", " ").title()
        print(f"    {label:.<30} {count}")

    print()


if __name__ == "__main__":
    main()
