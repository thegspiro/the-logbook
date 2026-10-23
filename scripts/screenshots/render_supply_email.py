#!/usr/bin/env python3
"""Write the weekly Supplies to Replace email, as the demo would send it, to disk.

The email is built inside a scheduled task rather than from an editable
template, so no screen in the application previews it. This runs the task
against the demo database with the mail transport replaced by a function that
keeps each message's HTML, and nothing is sent. ``email-shots.mjs`` then
photographs the files at phone width.

Run from the repository root with the demo database selected, as the backend
is: ``DB_NAME=logbook_screens python scripts/screenshots/render_supply_email.py
<output-dir>``.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))


async def render(out_dir: Path) -> int:
    from app.core.database import database_manager
    from app.services import email_service, scheduled_tasks

    kept: list[str] = []

    async def keep(self, to_emails, subject, html_body, *args, **kwargs):
        kept.append(html_body)
        return len(to_emails), []

    email_service.EmailService.send_email = keep

    await database_manager.connect()
    session = database_manager.session_factory()
    try:
        await scheduled_tasks.run_supply_expiration_alerts(session)
    finally:
        await session.close()
        await database_manager.disconnect()

    if not kept:
        print("the task built no email: nothing is expiring or short", file=sys.stderr)
        return 1
    out_dir.mkdir(parents=True, exist_ok=True)
    for index, body in enumerate(kept):
        (out_dir / f"supplies-to-replace-{index}.html").write_text(
            body, encoding="utf-8"
        )
    print(f"wrote {len(kept)} message(s) to {out_dir}")
    return 0


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    return asyncio.run(render(Path(sys.argv[1])))


if __name__ == "__main__":
    sys.exit(main())
