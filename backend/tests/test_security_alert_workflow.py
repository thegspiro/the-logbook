"""SEC2-28-7: security alerts are actionable and exports are monitored.

Covers the backend half of the owner's "build UI + backend fixes" decision:

- acknowledge / resolve are org-scoped, attributed once, and audited;
- ``GET /security/alerts`` filters by workflow state and reports the totals;
- a failed sign-in against a known account attributes the brute-force alert
  to that account's department (it used to be stored org-less, invisible to
  every department);
- ``SecurityMonitoringMiddleware`` sizes an export from the bytes it sent,
  not a ``Content-Length`` header ``StreamingResponse`` never sets, matches
  parameterized export routes, and records each export without its query
  string or content;
- ``GET /security/download-activity`` lists only the caller's department's exports.
"""

import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text
from starlette.requests import Request

from app.api.v1.endpoints import security_monitoring as sm_ep
from app.core.constants import AUDIT_EVENT_DATA_EXPORT
from app.models.audit import AuditLog
from app.models.security_alert import AlertType, SecurityAlertRecord, ThreatLevel
from app.schemas.security_alert import SecurityAlertResolveRequest
from app.services.security_monitoring import AlertType as SvcAlertType
from app.services.security_monitoring import SecurityAlert, SecurityMonitoringService
from app.services.security_monitoring import ThreatLevel as SvcThreatLevel


def _request() -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/",
            "headers": [],
            "client": ("203.0.113.20", 1234),
            "query_string": b"",
        }
    )


async def _org(db, label: str) -> str:
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": label, "slug": f"{label.lower()}-{org_id[:8]}"},
    )
    return org_id


async def _user(db, org_id: str) -> SimpleNamespace:
    user_id = str(uuid.uuid4())
    username = f"officer-{user_id[:8]}"
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) VALUES "
            "(:id, :org, :un, 'Alert', 'Officer', :em, 'x', 'active')"
        ),
        {"id": user_id, "org": org_id, "un": username, "em": f"{username}@test.com"},
    )
    return SimpleNamespace(id=user_id, organization_id=org_id, username=username)


def _alert(org_id: str | None, **overrides) -> SecurityAlertRecord:
    values = dict(
        id=str(uuid.uuid4()),
        alert_type=AlertType.BRUTE_FORCE,
        threat_level=ThreatLevel.HIGH,
        timestamp=datetime.now(timezone.utc),
        description="Brute force attack detected from 198.51.100.4",
        source_ip="198.51.100.4",
        organization_id=org_id,
        details={"failed_attempts": 10},
        acknowledged=False,
        resolved=False,
    )
    values.update(overrides)
    return SecurityAlertRecord(**values)


@pytest.fixture
async def two_orgs(db_session):
    org_a = await _org(db_session, "AlertsA")
    org_b = await _org(db_session, "AlertsB")
    officer_a = await _user(db_session, org_a)
    officer_b = await _user(db_session, org_b)
    await db_session.flush()
    return SimpleNamespace(
        org_a=org_a, org_b=org_b, officer_a=officer_a, officer_b=officer_b
    )


@pytest.mark.integration
class TestAcknowledgeAndResolve:
    async def test_acknowledge_records_who_and_audits_it(self, db_session, two_orgs):
        record = _alert(two_orgs.org_a)
        db_session.add(record)
        await db_session.flush()

        out = await sm_ep.acknowledge_alert(
            record.id, _request(), db=db_session, current_user=two_orgs.officer_a
        )
        assert out == {"status": "acknowledged", "alert_id": record.id}
        await db_session.refresh(record)
        assert record.acknowledged is True
        assert record.acknowledged_by == two_orgs.officer_a.username
        assert record.acknowledged_at is not None

        entry = (
            await db_session.execute(
                select(AuditLog).where(
                    AuditLog.event_type == "security_alert_acknowledged",
                    AuditLog.organization_id == two_orgs.org_a,
                )
            )
        ).scalar_one()
        assert entry.event_data["alert_id"] == record.id

    async def test_second_acknowledge_is_a_conflict_and_keeps_the_first_officer(
        self, db_session, two_orgs
    ):
        record = _alert(two_orgs.org_a)
        db_session.add(record)
        await db_session.flush()
        await sm_ep.acknowledge_alert(
            record.id, _request(), db=db_session, current_user=two_orgs.officer_a
        )
        second = await _user(db_session, two_orgs.org_a)

        with pytest.raises(HTTPException) as exc:
            await sm_ep.acknowledge_alert(
                record.id, _request(), db=db_session, current_user=second
            )
        assert exc.value.status_code == 409
        await db_session.refresh(record)
        assert record.acknowledged_by == two_orgs.officer_a.username

    async def test_another_departments_alert_is_not_found(self, db_session, two_orgs):
        record = _alert(two_orgs.org_b)
        db_session.add(record)
        await db_session.flush()

        for action in (sm_ep.acknowledge_alert, sm_ep.resolve_alert):
            kwargs = {"db": db_session, "current_user": two_orgs.officer_a}
            if action is sm_ep.resolve_alert:
                kwargs["body"] = SecurityAlertResolveRequest()
            with pytest.raises(HTTPException) as exc:
                await action(record.id, _request(), **kwargs)
            assert exc.value.status_code == 404
        await db_session.refresh(record)
        assert record.acknowledged is False
        assert record.resolved is False

    async def test_resolve_keeps_the_note_acknowledges_and_refuses_a_rewrite(
        self, db_session, two_orgs
    ):
        record = _alert(two_orgs.org_a)
        db_session.add(record)
        await db_session.flush()

        await sm_ep.resolve_alert(
            record.id,
            _request(),
            body=SecurityAlertResolveRequest(note="  Known pen-test window.  "),
            db=db_session,
            current_user=two_orgs.officer_a,
        )
        await db_session.refresh(record)
        assert record.resolved is True
        assert record.resolution_note == "Known pen-test window."
        # Resolving an unacknowledged alert acknowledges it in the same step.
        assert record.acknowledged is True
        assert record.acknowledged_by == two_orgs.officer_a.username
        assert record.resolved_by == two_orgs.officer_a.username

        entry = (
            await db_session.execute(
                select(AuditLog).where(
                    AuditLog.event_type == "security_alert_resolved",
                    AuditLog.organization_id == two_orgs.org_a,
                )
            )
        ).scalar_one()
        assert entry.event_data["resolution_note"] == "Known pen-test window."

        with pytest.raises(HTTPException) as exc:
            await sm_ep.resolve_alert(
                record.id,
                _request(),
                body=SecurityAlertResolveRequest(note="overwrite"),
                db=db_session,
                current_user=two_orgs.officer_a,
            )
        assert exc.value.status_code == 409
        await db_session.refresh(record)
        assert record.resolution_note == "Known pen-test window."


@pytest.mark.integration
class TestAlertListing:
    async def test_state_filter_and_counts_are_org_scoped(self, db_session, two_orgs):
        open_alert = _alert(two_orgs.org_a)
        acked = _alert(two_orgs.org_a, acknowledged=True, acknowledged_by="x")
        resolved = _alert(two_orgs.org_a, acknowledged=True, resolved=True)
        foreign = _alert(two_orgs.org_b)
        platform = _alert(None)
        db_session.add_all([open_alert, acked, resolved, foreign, platform])
        await db_session.flush()

        out = await sm_ep.get_security_alerts(
            _request(),
            limit=50,
            threat_level=None,
            alert_type=None,
            state="open",
            db=db_session,
            current_user=two_orgs.officer_a,
        )
        assert {a["id"] for a in out["alerts"]} == {open_alert.id, acked.id}
        assert out["counts"] == {
            "open": 2,
            "unacknowledged": 1,
            "acknowledged": 1,
            "resolved": 1,
        }

        unacked = await sm_ep.get_security_alerts(
            _request(),
            limit=50,
            threat_level=None,
            alert_type=None,
            state="unacknowledged",
            db=db_session,
            current_user=two_orgs.officer_a,
        )
        assert [a["id"] for a in unacked["alerts"]] == [open_alert.id]

    async def test_an_unknown_state_is_refused(self, db_session, two_orgs):
        with pytest.raises(HTTPException) as exc:
            await sm_ep.get_security_alerts(
                _request(),
                limit=50,
                threat_level=None,
                alert_type=None,
                state="snoozed",
                db=db_session,
                current_user=two_orgs.officer_a,
            )
        assert exc.value.status_code == 400


@pytest.mark.integration
class TestAlertAttribution:
    async def test_an_alert_naming_its_department_is_stored_against_it(
        self, db_session, two_orgs
    ):
        svc = SecurityMonitoringService()
        alert = SecurityAlert(
            id=str(uuid.uuid4()),
            alert_type=SvcAlertType.BRUTE_FORCE,
            threat_level=SvcThreatLevel.HIGH,
            timestamp=datetime.now(timezone.utc),
            description="Brute force attack detected from 198.51.100.9",
            source_ip="198.51.100.9",
            organization_id=two_orgs.org_b,
        )
        await svc._add_alert(db_session, alert)
        stored = await db_session.get(SecurityAlertRecord, alert.id)
        assert stored is not None
        assert stored.organization_id == two_orgs.org_b

    async def test_with_several_departments_an_anonymous_alert_stays_platform_level(
        self, db_session, two_orgs
    ):
        svc = SecurityMonitoringService()
        alert = SecurityAlert(
            id=str(uuid.uuid4()),
            alert_type=SvcAlertType.BRUTE_FORCE,
            threat_level=SvcThreatLevel.HIGH,
            timestamp=datetime.now(timezone.utc),
            description="Brute force attack detected from 198.51.100.10",
            source_ip="198.51.100.10",
        )
        await svc._add_alert(db_session, alert)
        stored = await db_session.get(SecurityAlertRecord, alert.id)
        assert stored is not None
        assert stored.organization_id is None


@pytest.mark.unit
class TestSingleDepartmentFallback:
    async def test_the_only_department_owns_an_anonymous_alert(self):
        svc = SecurityMonitoringService()
        result = MagicMock()
        result.scalars.return_value.all.return_value = ["only-org"]
        db = MagicMock()
        db.execute = AsyncMock(return_value=result)
        alert = SimpleNamespace(organization_id=None, user_id=None)
        assert await svc._resolve_alert_organization(db, alert) == "only-org"

    async def test_two_departments_leave_it_unattributed(self):
        svc = SecurityMonitoringService()
        result = MagicMock()
        result.scalars.return_value.all.return_value = ["org-1", "org-2"]
        db = MagicMock()
        db.execute = AsyncMock(return_value=result)
        alert = SimpleNamespace(organization_id=None, user_id=None)
        assert await svc._resolve_alert_organization(db, alert) is None


@pytest.mark.unit
class TestLoginAttributesBruteForce:
    async def test_a_failed_sign_in_against_a_known_account_names_its_department(
        self,
    ):
        from app.api.v1.endpoints import auth as auth_ep
        from app.schemas.auth import UserLogin
        from app.services.auth_service import AuthFailure, AuthService

        failure = AuthFailure(
            "invalid_password", user_id="user-9", organization_id="org-9"
        )

        async def refuse(service, **_kwargs):
            service.last_auth_failure = failure
            return None, "Incorrect username or password"

        db = MagicMock()
        db.commit = AsyncMock()
        detect = AsyncMock(return_value=None)
        request = MagicMock()
        request.headers = {"user-agent": "pytest"}
        credentials = UserLogin(username="someone", password="wrong-pass")
        with (
            patch.object(AuthService, "authenticate_user", new=refuse),
            patch.object(auth_ep.security_monitor, "detect_brute_force", new=detect),
            patch.object(auth_ep, "record_auth_failure", new=AsyncMock()),
            patch.object(auth_ep, "log_audit_event", new=AsyncMock()),
            patch.object(auth_ep, "get_client_ip", return_value="203.0.113.7"),
            pytest.raises(HTTPException),
        ):
            await auth_ep.login(credentials=credentials, request=request, db=db)

        detect.assert_awaited_once_with(
            db,
            ip="203.0.113.7",
            user_id="user-9",
            organization_id="org-9",
            success=False,
        )


async def _drive_middleware(monkeypatch, path, *, status=200, chunks=(b"",)):
    from app.core.security_middleware import SecurityMonitoringMiddleware

    detect = AsyncMock(return_value=None)
    audit = AsyncMock()
    monkeypatch.setattr(
        "app.services.security_monitoring.security_monitor",
        SimpleNamespace(
            detect_session_hijack=AsyncMock(return_value=None),
            detect_data_exfiltration=detect,
        ),
    )
    monkeypatch.setattr("app.core.audit.log_audit_event", audit)
    fake_db = AsyncMock()

    @asynccontextmanager
    async def fake_session_factory():
        yield fake_db

    monkeypatch.setattr("app.core.database.async_session_factory", fake_session_factory)

    async def inner_app(scope, receive, send):
        req = Request(scope)
        req.state.authenticated_user = SimpleNamespace(id="user-77")
        # StreamingResponse's shape: no content-length header, body in chunks.
        await send(
            {
                "type": "http.response.start",
                "status": status,
                "headers": [(b"content-type", b"text/csv")],
            }
        )
        for index, chunk in enumerate(chunks):
            await send(
                {
                    "type": "http.response.body",
                    "body": chunk,
                    "more_body": index < len(chunks) - 1,
                }
            )

    scope = {
        "type": "http",
        "method": "GET",
        "path": path,
        "headers": [(b"cookie", b"access_token=tok")],
        "client": ("203.0.113.9", 12345),
        "query_string": b"search=Jane+Doe",
    }

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(_message):
        return None

    await SecurityMonitoringMiddleware(inner_app)(scope, receive, send)
    return detect, audit, fake_db


@pytest.mark.unit
class TestExportMonitoring:
    async def test_a_streamed_export_is_sized_from_the_bytes_sent(self, monkeypatch):
        detect, audit, fake_db = await _drive_middleware(
            monkeypatch,
            "/api/v1/admin-hours/entries/export",
            chunks=(b"a" * 1000, b"b" * 2345),
        )
        detect.assert_awaited_once()
        assert detect.await_args.kwargs["data_size_bytes"] == 3345
        assert detect.await_args.kwargs["user_id"] == "user-77"

        audit.assert_awaited_once()
        kwargs = audit.await_args.kwargs
        assert kwargs["event_type"] == AUDIT_EVENT_DATA_EXPORT
        # The route and the size — never the query string (it names a member
        # here) and never the content.
        assert kwargs["event_data"] == {
            "endpoint": "/api/v1/admin-hours/entries/export",
            "method": "GET",
            "bytes": 3345,
        }
        assert "Jane" not in repr(kwargs)
        fake_db.commit.assert_awaited()

    async def test_a_parameterized_export_route_is_monitored(self, monkeypatch):
        detect, audit, _ = await _drive_middleware(
            monkeypatch,
            "/api/v1/training/programs/programs/prog-1/export",
            chunks=(b"x" * 10,),
        )
        detect.assert_awaited_once()
        audit.assert_awaited_once()

    async def test_a_refused_export_is_not_recorded_as_an_export(self, monkeypatch):
        detect, audit, _ = await _drive_middleware(
            monkeypatch, "/api/v1/errors/export", status=403, chunks=(b"denied",)
        )
        detect.assert_not_awaited()
        audit.assert_not_awaited()

    async def test_an_ordinary_route_is_not_recorded(self, monkeypatch):
        detect, audit, _ = await _drive_middleware(
            monkeypatch, "/api/v1/users", chunks=(b"[]",)
        )
        detect.assert_not_awaited()
        audit.assert_not_awaited()


@pytest.mark.integration
class TestExportListing:
    async def test_lists_only_this_departments_exports(self, db_session, two_orgs):
        from app.core.audit import log_audit_event

        for officer in (two_orgs.officer_a, two_orgs.officer_b):
            await log_audit_event(
                db=db_session,
                event_type=AUDIT_EVENT_DATA_EXPORT,
                event_category="security",
                severity="info",
                event_data={
                    "endpoint": "/api/v1/inventory/items/export",
                    "method": "GET",
                    "bytes": 512,
                },
                user_id=officer.id,
                ip_address="203.0.113.5",
            )
        await db_session.flush()

        out = await sm_ep.list_monitored_exports(
            limit=50, db=db_session, current_user=two_orgs.officer_a
        )
        assert len(out["exports"]) == 1
        row = out["exports"][0]
        assert row["user_id"] == two_orgs.officer_a.id
        assert row["endpoint"] == "/api/v1/inventory/items/export"
        assert row["bytes"] == 512
