#!/usr/bin/env python3
"""
Bootstrap a demo organization for documentation screenshots.

Runs the onboarding API end to end against a freshly-migrated backend, then
leaves behind an organization plus an administrator account that the capture
harness (``capture.mjs``) logs in as.

The onboarding flow is session-based: ``POST /onboarding/start`` mints a
session id and CSRF token that every subsequent step must echo back as
``X-Session-ID`` / ``X-CSRF-Token`` headers.  The session data steps
(``/onboarding/session/*``) stage configuration; ``/onboarding/complete``
materializes it.

Usage:
    python scripts/screenshots/bootstrap_demo.py [--base-url http://127.0.0.1:3001]
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

DEMO_ORG = "Oakville Fire Department"
DEMO_ADMIN_USERNAME = os.environ.get("SCREENSHOT_ADMIN_USERNAME", "chief")
DEMO_ADMIN_EMAIL = "chief@oakvillefd.example.org"


def admin_password() -> str:
    password = os.environ.get("SCREENSHOT_ADMIN_PASSWORD")
    if not password:
        raise SystemExit(
            "SCREENSHOT_ADMIN_PASSWORD must be set to a unique demo password"
        )
    return password


def require_safe_base_url(base_url: str, allow_remote: bool = False) -> None:
    """Refuse to provision credentials on a network-reachable host by accident."""
    hostname = urllib.parse.urlparse(base_url).hostname
    try:
        is_loopback = hostname == "localhost" or (
            hostname is not None and ipaddress.ip_address(hostname).is_loopback
        )
    except ValueError:
        is_loopback = False
    if not is_loopback and not allow_remote:
        raise SystemExit(
            f"Refusing non-loopback base URL {base_url!r}; "
            "pass --allow-remote only for an intentionally isolated demo"
        )


class Client:
    def __init__(self, base_url: str) -> None:
        self.api = base_url.rstrip("/") + "/api/v1"
        self.session_id = ""
        self.csrf_token = ""

    def request(self, method: str, path: str, payload: dict | None = None) -> dict:
        url = f"{self.api}{path}"
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if self.session_id:
            req.add_header("X-Session-ID", self.session_id)
        if self.csrf_token:
            req.add_header("X-CSRF-Token", self.csrf_token)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = resp.read().decode()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode()
            raise SystemExit(f"{method} {path} -> {exc.code}: {detail}") from exc
        return json.loads(body) if body else {}


def bootstrap(base_url: str, allow_remote: bool = False) -> None:
    require_safe_base_url(base_url, allow_remote)
    password = admin_password()
    client = Client(base_url)

    status = client.request("GET", "/onboarding/status")
    if not status.get("needs_onboarding"):
        print(f"Onboarding already complete for '{status.get('organization_name')}'.")
        return

    session = client.request("POST", "/onboarding/start")
    client.session_id = session["session_id"]
    client.csrf_token = session["csrf_token"]
    print(f"Onboarding session started ({client.session_id[:12]}...)")

    client.request(
        "POST",
        "/onboarding/session/organization",
        {
            "name": DEMO_ORG,
            "slug": "oakville-fd",
            "organization_type": "fire_department",
            "timezone": "America/New_York",
            "identifier_type": "fdid",
            "fdid": "51234",
            "phone": "(703) 555-0142",
            "email": "info@oakvillefd.example.org",
            "mailing_address": {
                "line1": "410 Grand Avenue",
                "city": "Oakville",
                "state": "VA",
                "zip_code": "22046",
                "country": "USA",
            },
            "physical_address_same": True,
        },
    )
    print(f"Organization staged: {DEMO_ORG}")

    # The roles step is deliberately skipped: /onboarding/system-owner assigns
    # the IT Manager position, which already carries full system access, and
    # organization creation seeds the standard system roles.  Posting a custom
    # role set here would only replace those defaults with a narrower list, and
    # screenshots need every module reachable.
    client.request(
        "POST",
        "/onboarding/system-owner",
        {
            "username": DEMO_ADMIN_USERNAME,
            "email": DEMO_ADMIN_EMAIL,
            "password": password,
            "password_confirm": password,
            "first_name": "Dana",
            "last_name": "Ruiz",
            "membership_number": "001",
        },
    )
    print(f"Administrator created: {DEMO_ADMIN_USERNAME}")

    client.request(
        "POST",
        "/onboarding/complete",
        {"notes": "Documentation screenshot demo environment"},
    )

    final = client.request("GET", "/onboarding/status")
    if final.get("needs_onboarding"):
        raise SystemExit(
            "Onboarding did not complete; status still reports needs_onboarding"
        )
    print(f"Onboarding complete for '{final.get('organization_name')}'.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:3001")
    parser.add_argument(
        "--allow-remote",
        action="store_true",
        help="allow an explicitly chosen non-loopback demo backend",
    )
    args = parser.parse_args()
    bootstrap(args.base_url, args.allow_remote)
    return 0


if __name__ == "__main__":
    sys.exit(main())
