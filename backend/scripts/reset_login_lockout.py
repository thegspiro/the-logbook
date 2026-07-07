#!/usr/bin/env python3
"""
Diagnose and recover a locked-out / inaccessible login account.

The backend locks an account for 30 minutes after 5 failed login attempts and,
by design (anti-enumeration), returns the same generic "Incorrect username or
password" message even when the password is correct. That makes a lockout look
identical to a wrong password. This script shows the true account state and can
clear the lockout and/or set a known password so you can get back in.

Run inside the backend container so it uses the app's DB configuration:

    # Diagnose only (no changes):
    docker exec -it intranet-backend python scripts/reset_login_lockout.py gabrielspiro

    # Clear the lockout (reset failed attempts + unlock):
    docker exec -it intranet-backend python scripts/reset_login_lockout.py gabrielspiro --unlock

    # Set a known password (also unlocks and clears must-change-password):
    docker exec -it intranet-backend python scripts/reset_login_lockout.py gabrielspiro --set-password 'NewP@ssw0rd!2026'

The username argument matches either the username or the email address.
"""

import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import datetime, timezone  # noqa: E402

from sqlalchemy import or_, select  # noqa: E402

from app.core.database import async_session_factory  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.models.user import User  # noqa: E402


def _fmt(value) -> str:
    return "—" if value is None else str(value)


async def _run(identifier: str, unlock: bool, new_password: str | None) -> int:
    async with async_session_factory() as db:
        result = await db.execute(
            select(User).where(
                or_(User.username == identifier, User.email == identifier),
                User.deleted_at.is_(None),
            )
        )
        users = result.scalars().all()

        if not users:
            print(f"No active user found matching '{identifier}'.")
            return 1
        if len(users) > 1:
            print(
                f"Multiple users match '{identifier}' "
                f"({len(users)}). Refusing to guess — pass an exact username."
            )
            return 1

        user = users[0]
        now = datetime.now(timezone.utc)
        locked_until = user.locked_until
        if locked_until and locked_until.tzinfo is None:
            locked_until = locked_until.replace(tzinfo=timezone.utc)
        is_locked = bool(locked_until and locked_until > now)

        print("Account state")
        print("-------------")
        print(f"  username             : {user.username}")
        print(f"  email                : {user.email}")
        print(f"  status               : {getattr(user, 'status', '—')}")
        print(f"  failed_login_attempts: {_fmt(user.failed_login_attempts)}")
        print(f"  locked_until         : {_fmt(user.locked_until)}")
        print(f"  currently locked     : {is_locked}")
        print(f"  must_change_password : {_fmt(user.must_change_password)}")
        print(f"  password_changed_at  : {_fmt(user.password_changed_at)}")
        print(f"  has password set     : {bool(user.password_hash)}")

        if is_locked and not (unlock or new_password):
            remaining = (locked_until - now).total_seconds() / 60
            print(
                f"\n>> Account is LOCKED for ~{remaining:.0f} more minute(s). "
                "The correct password will be rejected until then.\n"
                "   Re-run with --unlock to clear it now."
            )

        changed = False
        if new_password:
            # hash_password enforces complexity; a ValueError here means the
            # password does not meet policy (surfaced to the operator).
            user.password_hash = hash_password(new_password)
            user.password_changed_at = now
            user.must_change_password = False
            user.failed_login_attempts = 0
            user.locked_until = None
            changed = True
            print("\n>> Password reset. Lockout cleared; must-change-password cleared.")
        elif unlock:
            user.failed_login_attempts = 0
            user.locked_until = None
            changed = True
            print("\n>> Lockout cleared (failed attempts reset, unlocked).")

        if changed:
            await db.commit()
            print("   Changes committed. You can log in now.")
        else:
            print("\n(No changes made — diagnostic only.)")

        return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Diagnose/recover a locked-out login account."
    )
    parser.add_argument("identifier", help="Username or email of the account")
    parser.add_argument(
        "--unlock",
        action="store_true",
        help="Clear the lockout (reset failed attempts, remove locked_until)",
    )
    parser.add_argument(
        "--set-password",
        dest="new_password",
        metavar="PASSWORD",
        help="Set a new password (also unlocks and clears must-change-password)",
    )
    args = parser.parse_args()
    return asyncio.run(_run(args.identifier, args.unlock, args.new_password))


if __name__ == "__main__":
    raise SystemExit(main())
