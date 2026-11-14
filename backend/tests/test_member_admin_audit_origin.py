"""Every audit row the member endpoints write says where the change came from.

Most rows ``users.py`` wrote for an administrator's action on a member (an
unlock, a password, MFA or passkey reset, a role change, a delete) recorded who
acted but left the IP and browser columns empty, so the trail could not tell an
officer at the station from a stolen session elsewhere (W02 second pass). Only
four rows passed ``get_client_ip``.

The sweep makes the next audit call in that file carry the origin too; the
database test proves the columns are actually filled.
"""

import ast
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

from app.api.v1.endpoints import users as users_ep
from app.core.config import settings
from app.core.constants import AUDIT_EVENT_ACCOUNT_UNLOCKED
from app.models.audit import AuditLog
from app.models.user import User
from tests.fake_request import FAKE_IP, FAKE_USER_AGENT, fake_request
from tests.test_sign_in_audit import _seed

_USERS_ENDPOINTS = Path(users_ep.__file__)


def _audit_calls_without_origin() -> list[str]:
    tree = ast.parse(_USERS_ENDPOINTS.read_text())
    missing = []
    for fn in tree.body:
        if not isinstance(fn, ast.AsyncFunctionDef):
            continue
        for node in ast.walk(fn):
            if not (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "log_audit_event"
            ):
                continue
            spreads_origin = any(
                kw.arg is None
                and isinstance(kw.value, ast.Call)
                and isinstance(kw.value.func, ast.Name)
                and kw.value.func.id == "_request_origin"
                for kw in node.keywords
            )
            if not spreads_origin:
                missing.append(f"{fn.name} (line {node.lineno})")
    return missing


@pytest.mark.unit
class TestEveryMemberAuditRowCarriesTheOrigin:
    def test_each_audit_call_spreads_the_request_origin(self) -> None:
        assert _audit_calls_without_origin() == []

    def test_the_origin_is_the_callers_address_and_browser(self) -> None:
        assert users_ep._request_origin(fake_request()) == {
            "ip_address": FAKE_IP,
            "user_agent": FAKE_USER_AGENT,
        }


@pytest.mark.integration
class TestAnUnlockRecordsWhereItCameFrom:
    async def test_the_unlock_row_has_the_ip_and_browser(self, db_session) -> None:
        until = datetime.now(timezone.utc) + timedelta(minutes=10)
        org_id, user_id, _ = await _seed(
            db_session, locked_until=until, attempts=settings.MAX_LOGIN_ATTEMPTS
        )
        # Unsaved: the endpoint reads only these three attributes from it.
        officer = User(id=str(uuid.uuid4()), organization_id=org_id, username="officer")
        with patch.object(users_ep, "_enforce_account_reset_ceiling", new=AsyncMock()):
            await users_ep.admin_unlock_account(
                user_id=uuid.UUID(user_id),
                db=db_session,
                current_user=officer,
                request=fake_request(),
            )

        row = (
            await db_session.execute(
                select(AuditLog).where(
                    AuditLog.event_type == AUDIT_EVENT_ACCOUNT_UNLOCKED,
                    AuditLog.event_data["target_user_id"].as_string() == user_id,
                )
            )
        ).scalar_one()
        assert row.ip_address == FAKE_IP
        assert row.user_agent == FAKE_USER_AGENT
