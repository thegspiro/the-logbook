"""
Seed 50 test users with varied ranks, positions, and membership types.

Usage:
    cd backend
    python scripts/seed_test_users.py

All users share the password: TestPassword1!@#
Email pattern: admin.thelogbook+{username}@gmail.com
"""

import asyncio
import os
import sys
from datetime import date, datetime, timezone

# Add backend to path so we can import app modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.core.utils import generate_uuid

# ---------------------------------------------------------------------------
# Password hashing — we use argon2 directly to avoid pulling in the full
# app.core.security module (which requires env vars for encryption keys).
# ---------------------------------------------------------------------------
from argon2 import PasswordHasher

_hasher = PasswordHasher(
    time_cost=3,
    memory_cost=65536,
    parallelism=4,
    hash_len=32,
    salt_len=16,
)

SHARED_PASSWORD = "TestPassword1!@#"
SHARED_HASH = _hasher.hash(SHARED_PASSWORD)

# ---------------------------------------------------------------------------
# 50 test users
# ---------------------------------------------------------------------------
# fmt: off
TEST_USERS = [
    # (username, first_name, last_name, rank, station, membership_type, status, position_slugs)
    # --- Leadership ---
    ("jthompson",   "James",     "Thompson",   "fire_chief",      "Headquarters", "active",        "active",       ["fire_chief", "president"]),
    ("mgarcia",     "Maria",     "Garcia",     "deputy_chief",    "Headquarters", "active",        "active",       ["deputy_chief", "vice_president"]),
    ("rwilliams",   "Robert",    "Williams",   "assistant_chief", "Headquarters", "active",        "active",       ["assistant_chief", "board_of_directors"]),
    # --- Captains ---
    ("sjohnson",    "Sarah",     "Johnson",    "captain",         "Headquarters", "active",        "active",       ["captain", "treasurer"]),
    ("dlee",        "David",     "Lee",        "captain",         "Headquarters", "active",        "active",       ["captain", "training_officer"]),
    ("jmartinez",   "Jennifer",  "Martinez",   "captain",         "Headquarters", "active",        "active",       ["captain", "secretary"]),
    # --- Lieutenants ---
    ("mbrown",      "Michael",   "Brown",      "lieutenant",      "Headquarters", "active",        "active",       ["lieutenant", "safety_officer"]),
    ("awilson",     "Amanda",    "Wilson",     "lieutenant",      "Headquarters", "active",        "active",       ["lieutenant", "scheduling_officer"]),
    ("cdavis",      "Christopher","Davis",     "lieutenant",      "Headquarters", "active",        "active",       ["lieutenant", "apparatus_officer"]),
    # --- EMTs with officer/committee positions ---
    ("krodriguez",  "Karen",     "Rodriguez",  "emt",             "Headquarters", "active",        "active",       ["emt", "member", "quartermaster"]),
    ("banderson",   "Brian",     "Anderson",   "emt",             "Headquarters", "active",        "active",       ["emt", "member", "communications_officer"]),
    ("ltaylor",     "Lisa",      "Taylor",     "emt",             "Headquarters", "active",        "active",       ["emt", "member", "historian"]),
    ("jwhite",      "Jason",     "White",      "emt",             "Headquarters", "active",        "active",       ["emt", "member", "public_outreach"]),
    ("nharris",     "Nicole",    "Harris",     "emt",             "Headquarters", "active",        "active",       ["emt", "member", "membership_committee_chair"]),
    ("tmartin",     "Thomas",    "Martin",     "emt",             "Headquarters", "active",        "active",       ["emt", "member", "fundraising_chair"]),
    ("rjackson",    "Rachel",    "Jackson",    "emt",             "Headquarters", "active",        "active",       ["emt", "member", "facilities_manager"]),
    ("dthomas",     "Daniel",    "Thomas",     "emt",             "Headquarters", "active",        "active",       ["emt", "member", "meeting_hall_coordinator"]),
    ("elewis",      "Emily",     "Lewis",      "emt",             "Headquarters", "active",        "active",       ["emt", "member", "assistant_secretary"]),
    # --- EMTs (rank and file, active) ---
    ("mrobinson",   "Matthew",   "Robinson",   "emt",             "Headquarters", "active",        "active",       ["emt", "member"]),
    ("aclark",      "Ashley",    "Clark",      "emt",             "Headquarters", "active",        "active",       ["emt", "member"]),
    ("jwalker",     "Joshua",    "Walker",     "emt",             "Headquarters", "active",        "active",       ["emt", "member"]),
    ("shernandez",  "Stephanie", "Hernandez",  "emt",             "Headquarters", "active",        "active",       ["emt", "member", "it_manager"]),
    # --- Probationary ---
    ("ayoung",      "Andrew",    "Young",      "emt",             "Headquarters", "probationary",  "probationary", ["emt", "member"]),
    ("kking",       "Kimberly",  "King",       "emt",             "Headquarters", "probationary",  "probationary", ["emt", "member"]),
    ("jwright",     "Justin",    "Wright",     "emt",             "Headquarters", "probationary",  "probationary", ["emt", "member"]),
    ("mlopez",      "Michelle",  "Lopez",      "emt",             "Headquarters", "probationary",  "probationary", ["emt", "member"]),
    ("rhill",       "Ryan",      "Hill",       "emt",             "Headquarters", "probationary",  "probationary", ["emt", "member"]),
    # --- Life members ---
    ("sscott",      "Samantha",  "Scott",      "captain",         "Headquarters", "life",          "active",       ["captain", "member", "board_of_directors"]),
    ("jgreen",      "Jonathan",  "Green",      "lieutenant",      "Headquarters", "life",          "active",       ["lieutenant", "member"]),
    ("ladams",      "Laura",     "Adams",      "emt",             "Headquarters", "life",          "active",       ["emt", "member"]),
    # --- Retired ---
    ("dbaker",      "Derek",     "Baker",      "fire_chief",      "Headquarters", "retired",       "retired",      ["member"]),
    ("pnelson",     "Patricia",  "Nelson",     "deputy_chief",    "Headquarters", "retired",       "retired",      ["member"]),
    ("scarter",     "Steven",    "Carter",     "captain",         "Headquarters", "retired",       "retired",      ["member"]),
    ("jmitchell",   "Jessica",   "Mitchell",   "lieutenant",      "Headquarters", "retired",       "retired",      ["member"]),
    ("cperez",      "Carlos",    "Perez",      "emt",             "Headquarters", "retired",       "retired",      ["member"]),
    # --- Honorary ---
    ("troberts",    "Tiffany",   "Roberts",    "emt",             "Headquarters", "honorary",      "active",       ["member"]),
    ("aturner",     "Anthony",   "Turner",     "emt",             "Headquarters", "honorary",      "active",       ["member"]),
    # --- Administrative ---
    ("mphillips",   "Megan",     "Phillips",   "emt",             "Headquarters", "administrative","active",       ["member"]),
    ("jcampbell",   "Jacob",     "Campbell",   "emt",             "Headquarters", "administrative","active",       ["member"]),
    # --- On leave ---
    ("sparker",     "Sophia",    "Parker",     "emt",             "Headquarters", "active",        "leave",        ["emt", "member"]),
    ("wevans",      "William",   "Evans",      "emt",             "Headquarters", "active",        "leave",        ["emt", "member"]),
    # --- Inactive ---
    ("hedwards",    "Hannah",    "Edwards",    "emt",             "Headquarters", "active",        "inactive",     ["emt", "member"]),
    ("bcollins",    "Brandon",   "Collins",    "emt",             "Headquarters", "active",        "inactive",     ["emt", "member"]),
    # --- More active EMTs ---
    ("jstewart",    "Julia",     "Stewart",    "lieutenant",      "Headquarters", "active",        "active",       ["lieutenant", "member"]),
    ("nsanchez",    "Nathan",    "Sanchez",    "emt",             "Headquarters", "active",        "active",       ["emt", "member"]),
    ("amorris",     "Allison",   "Morris",     "emt",             "Headquarters", "active",        "active",       ["emt", "member"]),
    ("mrogers",     "Marcus",    "Rogers",     "emt",             "Headquarters", "active",        "active",       ["emt", "member"]),
    ("kreed",       "Katherine", "Reed",       "emt",             "Headquarters", "active",        "active",       ["emt", "member"]),
    ("jcook",       "Jesse",     "Cook",       "emt",             "Headquarters", "active",        "active",       ["emt", "member"]),
    ("dmorgan",     "Diana",     "Morgan",     "emt",             "Headquarters", "active",        "active",       ["emt", "member"]),
]
# fmt: on

# Hire dates spread across years to give variety
HIRE_DATES = [
    date(2005, 3, 15), date(2007, 6, 1), date(2008, 1, 10), date(2010, 9, 20),
    date(2011, 4, 5), date(2012, 7, 12), date(2013, 2, 28), date(2013, 11, 3),
    date(2014, 5, 17), date(2014, 8, 22), date(2015, 1, 6), date(2015, 3, 30),
    date(2015, 10, 14), date(2016, 2, 8), date(2016, 6, 25), date(2016, 9, 11),
    date(2017, 1, 19), date(2017, 4, 7), date(2017, 7, 23), date(2017, 11, 30),
    date(2018, 3, 5), date(2018, 6, 18), date(2019, 1, 14), date(2019, 4, 28),
    date(2019, 8, 9), date(2019, 11, 22), date(2020, 2, 3), date(2020, 5, 16),
    date(2020, 9, 1), date(2020, 12, 7), date(2000, 6, 1), date(2001, 3, 15),
    date(2003, 8, 20), date(2004, 11, 10), date(2006, 2, 14), date(2009, 7, 4),
    date(2010, 12, 1), date(2021, 1, 11), date(2021, 4, 25), date(2021, 8, 13),
    date(2021, 11, 6), date(2022, 2, 18), date(2022, 5, 30), date(2022, 9, 15),
    date(2023, 1, 7), date(2023, 4, 20), date(2023, 7, 8), date(2023, 10, 29),
    date(2024, 1, 15), date(2024, 6, 3),
]


async def get_or_create_org(session: AsyncSession) -> str:
    """Return the first organization's ID, or create a demo org."""
    result = await session.execute(
        text("SELECT id FROM organizations LIMIT 1")
    )
    row = result.first()
    if row:
        return row[0]

    org_id = generate_uuid()
    await session.execute(
        text(
            "INSERT INTO organizations (id, name, slug, organization_type, active) "
            "VALUES (:id, :name, :slug, :org_type, 1)"
        ),
        {
            "id": org_id,
            "name": "Demo Fire Department",
            "slug": "demo-fd",
            "org_type": "fire_department",
        },
    )
    print(f"  Created demo organization: {org_id}")
    return org_id


async def get_or_create_positions(
    session: AsyncSession, org_id: str
) -> dict[str, str]:
    """Return a dict of slug -> position_id for the org. Create defaults if missing."""
    result = await session.execute(
        text("SELECT id, slug FROM positions WHERE organization_id = :oid"),
        {"oid": org_id},
    )
    pos_map: dict[str, str] = {row[1]: row[0] for row in result.fetchall()}

    # All positions from DEFAULT_POSITIONS in permissions.py
    defaults = [
        # Operational ranks
        ("Fire Chief", "fire_chief", 95),
        ("Deputy Chief", "deputy_chief", 90),
        ("Assistant Chief", "assistant_chief", 85),
        ("Captain", "captain", 70),
        ("Lieutenant", "lieutenant", 60),
        ("EMT", "emt", 40),
        ("Member", "member", 10),
        # Administrative / elected positions
        ("IT Manager", "it_manager", 92),
        ("President", "president", 80),
        ("Vice President", "vice_president", 75),
        ("Treasurer", "treasurer", 65),
        ("Secretary", "secretary", 55),
        ("Assistant Secretary", "assistant_secretary", 50),
        ("Board of Directors", "board_of_directors", 45),
        # Appointed officer positions
        ("Training Officer", "training_officer", 58),
        ("Safety Officer", "safety_officer", 57),
        ("Quartermaster", "quartermaster", 52),
        ("Communications Officer / PIO", "communications_officer", 48),
        ("Apparatus Officer", "apparatus_officer", 47),
        ("Facilities Manager", "facilities_manager", 46),
        ("Scheduling Officer", "scheduling_officer", 44),
        ("Meeting Hall Coordinator", "meeting_hall_coordinator", 43),
        # Committee chairs
        ("Membership Committee Chair", "membership_committee_chair", 42),
        ("Fundraising Chair", "fundraising_chair", 41),
        # Community
        ("Public Outreach", "public_outreach", 38),
        ("Historian", "historian", 35),
    ]

    for name, slug, priority in defaults:
        if slug not in pos_map:
            pid = generate_uuid()
            await session.execute(
                text(
                    "INSERT INTO positions (id, organization_id, name, slug, "
                    "is_system, priority) "
                    "VALUES (:id, :oid, :name, :slug, 1, :priority)"
                ),
                {
                    "id": pid,
                    "oid": org_id,
                    "name": name,
                    "slug": slug,
                    "priority": priority,
                },
            )
            pos_map[slug] = pid
            print(f"  Created position: {name}")

    return pos_map


async def seed_users(session: AsyncSession, org_id: str) -> None:
    """Insert 50 test users and assign their positions."""
    pos_map = await get_or_create_positions(session, org_id)
    now = datetime.now(timezone.utc)

    created = 0
    skipped = 0

    for i, (
        username, first, last, rank, station,
        membership, status, position_slugs
    ) in enumerate(TEST_USERS):
        # Check if user already exists
        exists = await session.execute(
            text(
                "SELECT id FROM users "
                "WHERE organization_id = :oid AND username = :uname"
            ),
            {"oid": org_id, "uname": username},
        )
        if exists.first():
            skipped += 1
            continue

        user_id = generate_uuid()
        email = f"admin.thelogbook+{username}@gmail.com"
        hire = HIRE_DATES[i] if i < len(HIRE_DATES) else date(2024, 1, 1)
        membership_number = f"{i + 1:03d}"

        await session.execute(
            text(
                "INSERT INTO users "
                "(id, organization_id, username, email, password_hash, "
                "first_name, last_name, `rank`, station, membership_type, "
                "status, hire_date, membership_number, email_verified, "
                "must_change_password, mfa_enabled, emergency_contacts) "
                "VALUES "
                "(:id, :oid, :username, :email, :pw, "
                ":first, :last, :rank, :station, :mtype, "
                ":status, :hire, :mnum, 1, 0, 0, '[]')"
            ),
            {
                "id": user_id,
                "oid": org_id,
                "username": username,
                "email": email,
                "pw": SHARED_HASH,
                "first": first,
                "last": last,
                "rank": rank,
                "station": station,
                "mtype": membership,
                "status": status,
                "hire": hire,
                "mnum": membership_number,
            },
        )

        # Assign positions
        for slug in position_slugs:
            pid = pos_map.get(slug)
            if pid:
                await session.execute(
                    text(
                        "INSERT INTO user_positions (user_id, position_id) "
                        "VALUES (:uid, :pid)"
                    ),
                    {"uid": user_id, "pid": pid},
                )

        created += 1

    print(f"  Created {created} users, skipped {skipped} (already exist)")


async def main() -> None:
    # Build the database URL from env vars (same as the app)
    db_user = os.getenv("DB_USER", "intranet_user")
    db_pass = os.getenv("DB_PASSWORD", "intranet_pass")
    db_host = os.getenv("DB_HOST", "localhost")
    db_port = os.getenv("DB_PORT", "3306")
    db_name = os.getenv("DB_NAME", "intranet_db")

    url = (
        f"mysql+aiomysql://{db_user}:{db_pass}@{db_host}:{db_port}/{db_name}"
    )

    engine = create_async_engine(url, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    print("Seeding 50 test users...")
    print(f"  Shared password: {SHARED_PASSWORD}")
    print(f"  Email pattern:   admin.thelogbook+<username>@gmail.com\n")

    async with async_session() as session:
        async with session.begin():
            org_id = await get_or_create_org(session)
            print(f"  Using organization: {org_id}\n")
            await seed_users(session, org_id)

    await engine.dispose()
    print("\nDone!")


if __name__ == "__main__":
    asyncio.run(main())
