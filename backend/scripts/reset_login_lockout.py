#!/usr/bin/env python3
"""
Diagnose and recover a login account that "won't accept the password".

The login endpoint returns the same generic "Incorrect username or password"
for several distinct causes, so a working password can look rejected. This
script shows the true state and pinpoints the cause:

  * account lockout (5 failed attempts -> 30 min; correct password still 401s)
  * inactive/suspended account status
  * MFA enabled (password alone is not enough)
  * organization scoping: authenticate_user resolves the org with
    `SELECT ... FROM organizations LIMIT 1` (no ORDER BY). If more than one org
    exists it may scope to the wrong one and never find the user -> 401.
  * a genuinely wrong password (use --verify-password to check definitively)

Run inside the backend container so it uses the app's DB configuration:

    # Full diagnosis (no changes):
    docker exec -it intranet-backend python scripts/reset_login_lockout.py gabrielspiro

    # Check whether a specific password matches the stored hash (no login, no
    # rate limit, no lockout — pure hash comparison):
    docker exec -it intranet-backend python scripts/reset_login_lockout.py gabrielspiro --verify-password 'Guess!123'

    # Clear a lockout:
    docker exec -it intranet-backend python scripts/reset_login_lockout.py gabrielspiro --unlock

    # Set a known password (also unlocks + clears must-change-password):
    docker exec -it intranet-backend python scripts/reset_login_lockout.py gabrielspiro --set-password 'NewP@ssw0rd!2026'

The identifier matches either username or email.
"""

import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import datetime, timezone  # noqa: E402

from sqlalchemy import or_, select  # noqa: E402

from app.core.database import (  # noqa: E402
    async_session_factory,
    database_manager,
)
from app.core.security import hash_password, verify_password  # noqa: E402
from app.models.user import Organization, User  # noqa: E402


def _fmt(value) -> str:
    return "—" if value is None else str(value)


async def _run(
    identifier: str, unlock: bool, new_password: str | None, verify_pw: str | None
) -> int:
    async with async_session_factory() as db:
        # Replicate exactly what authenticate_user() uses to scope the login.
        scoped_org = (
            await db.execute(select(Organization).limit(1))
        ).scalar_one_or_none()
        all_orgs = (await db.execute(select(Organization))).scalars().all()

        print("Login-scoped organization (authenticate_user's SELECT ... LIMIT 1):")
        if scoped_org is not None:
            print(f"  {scoped_org.id}  ({scoped_org.name})")
        else:
            print("  <none> — no organization rows exist!")
        if len(all_orgs) > 1:
            print(
                f"  !! {len(all_orgs)} organizations exist. Login scoping has no "
                "ORDER BY, so it may pick the wrong one and reject valid users:"
            )
            for o in all_orgs:
                print(f"       - {o.id}  ({o.name})")
        print()

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
            print(f"Multiple users match '{identifier}' ({len(users)}):")
            for u in users:
                print(f"  - id={u.id} org={u.organization_id} status={u.status}")
            print("Refusing to guess — pass an exact username.")
            return 1

        user = users[0]
        now = datetime.now(timezone.utc)
        locked_until = user.locked_until
        if locked_until and locked_until.tzinfo is None:
            locked_until = locked_until.replace(tzinfo=timezone.utc)
        is_locked = bool(locked_until and locked_until > now)
        scoped_id = str(scoped_org.id) if scoped_org else None
        org_matches = scoped_id is not None and str(user.organization_id) == scoped_id

        print("Account state")
        print("-------------")
        print(f"  username             : {user.username}")
        print(f"  email                : {user.email}")
        print(f"  organization_id      : {user.organization_id}")
        print(f"  login can find user  : {org_matches}  (user org == login-scoped org)")
        print(f"  status               : {getattr(user, 'status', '—')}")
        print(f"  is_active            : {user.is_active}")
        print(f"  oauth_provider       : {_fmt(getattr(user, 'oauth_provider', None))}")
        print(f"  mfa_enabled          : {_fmt(getattr(user, 'mfa_enabled', None))}")
        print(f"  failed_login_attempts: {_fmt(user.failed_login_attempts)}")
        print(f"  locked_until         : {_fmt(user.locked_until)}")
        print(f"  currently locked     : {is_locked}")
        print(f"  must_change_password : {_fmt(user.must_change_password)}")
        print(f"  password_changed_at  : {_fmt(user.password_changed_at)}")
        print(f"  has password set     : {bool(user.password_hash)}")

        # --- interpretation ---
        print("\nDiagnosis")
        print("---------")
        if not org_matches:
            print(
                "  >> Login is scoped to a different organization than this user's, "
                "so authenticate_user will never find them and returns the generic "
                '"Incorrect username or password". This is the likely cause.'
            )
        if is_locked:
            mins = (locked_until - now).total_seconds() / 60
            print(
                f"  >> Account is LOCKED for ~{mins:.0f} more minute(s); the correct "
                "password is rejected until then. Use --unlock."
            )
        if not user.is_active:
            print(f"  >> Account status is {user.status} (not active) — login 403s.")
        if getattr(user, "mfa_enabled", False):
            print("  >> MFA is enabled — password alone won't complete login.")
        if not user.password_hash:
            print(
                "  >> No password hash set (OAuth-only account?) — local login fails."
            )
        if org_matches and not is_locked and user.is_active and user.password_hash:
            print(
                "  >> No lock/scope/status problem found. If login still fails, the "
                "submitted password does not match the stored hash — confirm with "
                "--verify-password, or reset it with --set-password."
            )

        if verify_pw is not None:
            matches, _ = verify_password(verify_pw, user.password_hash or "")
            print(
                f"\nPassword check: the provided password "
                f"{'MATCHES' if matches else 'does NOT match'} the stored hash."
            )

        changed = False
        if new_password:
            user.password_hash = hash_password(new_password)
            user.password_changed_at = now
            user.must_change_password = False
            user.failed_login_attempts = 0
            user.locked_until = None
            changed = True
            print("\n>> Password reset. Lockout + must-change-password cleared.")
        elif unlock:
            user.failed_login_attempts = 0
            user.locked_until = None
            changed = True
            print("\n>> Lockout cleared (failed attempts reset, unlocked).")

        if changed:
            await db.commit()
            print("   Changes committed.")
            if not org_matches:
                print(
                    "   NOTE: the org-scoping mismatch above is NOT fixed by this — "
                    "login may still fail until the extra organization is resolved."
                )

        return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Diagnose/recover a login account that won't accept its password."
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
    parser.add_argument(
        "--verify-password",
        dest="verify_password",
        metavar="PASSWORD",
        help="Check whether this password matches the stored hash (no changes)",
    )
    args = parser.parse_args()

    async def _main() -> int:
        # Standalone script: initialize the DB engine (the app normally does
        # this during startup) before using async_session_factory().
        await database_manager.connect()
        try:
            return await _run(
                args.identifier, args.unlock, args.new_password, args.verify_password
            )
        finally:
            await database_manager.disconnect()

    return asyncio.run(_main())


if __name__ == "__main__":
    raise SystemExit(main())
