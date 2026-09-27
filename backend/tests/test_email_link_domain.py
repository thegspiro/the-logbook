"""
The Email settings screen shows administrators which address emailed links are
built from. The value is the deployment's FRONTEND_URL, which
resolve_frontend_url may have replaced with a public ALLOWED_ORIGINS entry;
until this endpoint that substitution was reported only in the startup log.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.api.v1.endpoints import organizations
from app.core.config import Settings
from app.schemas.organization import EmailLinkDomainResponse, EmailLinkDomainSource

pytestmark = pytest.mark.unit

PATH = "/settings/email/link-domain"


class TestDescribeFrontendUrl:
    def test_an_explicit_public_url_is_reported_as_set(self):
        described = Settings(
            FRONTEND_URL="https://logbook.yourdept.org",
            ALLOWED_ORIGINS="https://other.example.org",
        ).describe_frontend_url()
        assert described["effective_url"] == "https://logbook.yourdept.org"
        assert described["configured_url"] == "https://logbook.yourdept.org"
        assert described["source"] == "frontend_url"
        assert described["is_loopback"] is False
        assert described["is_https"] is True

    def test_a_substituted_origin_keeps_what_was_configured(self):
        described = Settings(
            FRONTEND_URL="http://localhost:3000",
            ALLOWED_ORIGINS="http://localhost:3000,https://logbook.yourdept.org",
        ).describe_frontend_url()
        assert described["effective_url"] == "https://logbook.yourdept.org"
        assert described["configured_url"] == "http://localhost:3000"
        assert described["source"] == "allowed_origins"
        assert described["is_loopback"] is False

    def test_a_loopback_url_with_no_public_origin_is_reported_unresolved(self):
        described = Settings(
            FRONTEND_URL="http://localhost:3000",
            ALLOWED_ORIGINS="http://localhost:3000",
        ).describe_frontend_url()
        assert described["effective_url"] == "http://localhost:3000"
        assert described["source"] == "unresolved_loopback"
        assert described["is_loopback"] is True
        assert described["is_https"] is False

    def test_a_plain_http_public_url_is_not_https(self):
        described = Settings(
            FRONTEND_URL="http://192.0.2.10:3000"
        ).describe_frontend_url()
        assert described["source"] == "frontend_url"
        assert described["is_https"] is False
        assert described["is_loopback"] is False

    @pytest.mark.parametrize("enabled", [True, False])
    def test_reports_whether_the_deployment_sends_mail(self, enabled):
        described = Settings(
            FRONTEND_URL="https://logbook.yourdept.org", EMAIL_ENABLED=enabled
        ).describe_frontend_url()
        assert described["email_enabled"] is enabled

    def test_every_source_is_a_valid_response_value(self):
        for kwargs in (
            {"FRONTEND_URL": "https://logbook.yourdept.org"},
            {
                "FRONTEND_URL": "http://localhost:3000",
                "ALLOWED_ORIGINS": "https://logbook.yourdept.org",
            },
            {
                "FRONTEND_URL": "http://localhost:3000",
                "ALLOWED_ORIGINS": "http://localhost:3000",
            },
        ):
            EmailLinkDomainResponse(**Settings(**kwargs).describe_frontend_url())


class TestLinkDomainEndpoint:
    async def test_returns_the_running_deployments_value(self):
        configured = Settings(
            FRONTEND_URL="http://localhost:3000",
            ALLOWED_ORIGINS="https://logbook.yourdept.org",
        )
        with patch.object(organizations, "app_settings", configured):
            response = await organizations.get_email_link_domain(
                current_user=SimpleNamespace(organization_id="org-1")
            )
        assert response.effective_url == "https://logbook.yourdept.org"
        assert response.configured_url == "http://localhost:3000"
        assert response.source is EmailLinkDomainSource.ALLOWED_ORIGINS

    def test_is_gated_like_the_rest_of_the_email_settings(self):
        def permissions(path: str, method: str) -> list[list[str]]:
            for route in organizations.router.routes:
                if getattr(route, "path", None) == path and method in getattr(
                    route, "methods", ()
                ):
                    return [
                        dependency.call.required_permissions
                        for dependency in route.dependant.dependencies
                        if hasattr(dependency.call, "required_permissions")
                    ]
            pytest.fail(f"{method} {path} not found")

        assert permissions(PATH, "GET") == permissions("/settings/email", "PATCH")
        assert permissions(PATH, "GET") == [
            ["settings.manage", "organization.update_settings"]
        ]


def _served(**overrides) -> Settings:
    """A deployment reachable at logbook.yourdept.org, with FRONTEND_URL unset."""
    base = dict(
        FRONTEND_URL="http://localhost:3000",
        ALLOWED_ORIGINS="https://logbook.yourdept.org",
    )
    base.update(overrides)
    return Settings(**base)


class TestLinkDomainAllowedHosts:
    def test_derived_from_allowed_origins_without_loopback(self):
        assert _served(
            ALLOWED_ORIGINS="http://localhost:3000,https://logbook.yourdept.org"
        ).link_domain_allowed_hosts() == ["logbook.yourdept.org"]

    def test_explicit_trusted_hosts_win(self):
        assert _served(
            TRUSTED_HOSTS="*.yourdept.org,intranet.yourdept.org"
        ).link_domain_allowed_hosts() == ["*.yourdept.org", "intranet.yourdept.org"]

    def test_a_disabled_host_check_falls_back_to_public_origins_not_anything(self):
        settings = _served(
            ALLOWED_ORIGINS="*,https://logbook.yourdept.org,http://127.0.0.1:3000"
        )
        assert settings.get_trusted_hosts() == ["*"]
        assert settings.link_domain_allowed_hosts() == ["logbook.yourdept.org"]


class TestValidateLinkDomain:
    @pytest.mark.parametrize(
        ("url", "expected"),
        [
            ("https://logbook.yourdept.org", "https://logbook.yourdept.org"),
            ("https://Logbook.YourDept.org/", "https://logbook.yourdept.org"),
            ("  http://logbook.yourdept.org:8443 ", "http://logbook.yourdept.org:8443"),
        ],
    )
    def test_accepts_an_origin_this_server_serves(self, url, expected):
        assert _served().validate_link_domain(url) == expected

    def test_a_wildcard_trusted_host_accepts_a_subdomain(self):
        settings = _served(TRUSTED_HOSTS="*.yourdept.org")
        assert (
            settings.validate_link_domain("https://ems.yourdept.org")
            == "https://ems.yourdept.org"
        )

    @pytest.mark.parametrize(
        ("url", "message"),
        [
            ("https://evil.example.com", "not an address this server accepts"),
            ("https://logbook.yourdept.org.evil.com", "not an address"),
            ("https://logbook.yourdept.org/login", "without a path"),
            ("https://logbook.yourdept.org?next=x", "without a path"),
            ("https://logbook.yourdept.org#x", "without a path"),
            ("https://user:pw@logbook.yourdept.org", "user name or password"),
            ("http://localhost:3000", "only works on the server itself"),
            ("ftp://logbook.yourdept.org", "full address"),
            ("logbook.yourdept.org", "full address"),
            ("https://logbook.yourdept.org:notaport", "full address"),
            ("", "full address"),
        ],
    )
    def test_refuses_anything_else(self, url, message):
        with pytest.raises(ValueError, match=message):
            _served().validate_link_domain(url)

    def test_a_wildcard_does_not_match_its_bare_parent_or_a_suffix_lookalike(self):
        settings = _served(TRUSTED_HOSTS="*.yourdept.org")
        for url in ("https://yourdept.org", "https://evilyourdept.org"):
            with pytest.raises(ValueError, match="not an address"):
                settings.validate_link_domain(url)


class TestApplyLinkDomainOverride:
    def test_override_replaces_and_clearing_restores_the_deployment_value(self):
        settings = _served()
        settings.apply_link_domain_override("https://intranet.yourdept.org")
        assert settings.FRONTEND_URL == "https://intranet.yourdept.org"
        described = settings.describe_frontend_url()
        assert described["source"] == "override"
        assert described["override_url"] == "https://intranet.yourdept.org"
        assert described["deployment_url"] == "https://logbook.yourdept.org"

        settings.apply_link_domain_override(None)
        assert settings.FRONTEND_URL == "https://logbook.yourdept.org"
        described = settings.describe_frontend_url()
        assert described["source"] == "allowed_origins"
        assert described["override_url"] is None

    def test_a_second_override_still_remembers_the_original_deployment_value(self):
        settings = _served()
        settings.apply_link_domain_override("https://a.yourdept.org")
        settings.apply_link_domain_override("https://b.yourdept.org")
        settings.apply_link_domain_override(None)
        assert settings.FRONTEND_URL == "https://logbook.yourdept.org"

    def test_every_source_including_override_is_a_valid_response(self):
        settings = _served()
        settings.apply_link_domain_override("https://logbook.yourdept.org")
        EmailLinkDomainResponse(**settings.describe_frontend_url())


def _route_permissions(path: str, method: str) -> list[list[str]]:
    for route in organizations.router.routes:
        if getattr(route, "path", None) == path and method in getattr(
            route, "methods", ()
        ):
            return [
                dependency.call.required_permissions
                for dependency in route.dependant.dependencies
                if hasattr(dependency.call, "required_permissions")
            ]
    pytest.fail(f"{method} {path} not found")


class TestLinkDomainWriteGate:
    @pytest.mark.parametrize("method", ["PUT", "DELETE"])
    def test_changing_it_needs_the_system_owner_permission(self, method):
        assert _route_permissions(PATH, method) == [["system.manage_link_domain"]]

    def test_no_default_position_holds_it_except_through_the_wildcard(self):
        from app.core.permissions import DEFAULT_POSITIONS

        holders = {
            slug
            for slug, position in DEFAULT_POSITIONS.items()
            if "system.manage_link_domain" in position.get("permissions", [])
            or "system.*" in position.get("permissions", [])
        }
        assert holders == set()
        assert "*" in DEFAULT_POSITIONS["it_manager"]["permissions"]


@pytest.mark.integration
class TestSavedLinkDomain:
    """Persists on the organization the deployment serves, and reaches settings."""

    @pytest.fixture
    async def primary_org(self, db_session):
        import uuid
        from datetime import datetime, timezone

        from app.models.user import Organization

        org = Organization(
            id=str(uuid.uuid4()),
            name="Link Domain Test Department",
            slug=f"link-domain-{uuid.uuid4().hex[:8]}",
            created_at=datetime(2000, 1, 1, tzinfo=timezone.utc),
        )
        db_session.add(org)
        await db_session.flush()
        return org

    @pytest.fixture
    def served(self):
        from app.services import email_link_domain_service

        settings = _served()
        with patch.object(email_link_domain_service, "settings", settings):
            yield settings

    async def test_set_persists_applies_and_reloads(
        self, db_session, primary_org, served
    ):
        from app.services.email_link_domain_service import (
            load_into_settings,
            set_link_domain,
        )

        previous, new = await set_link_domain(
            db_session, primary_org.id, "https://logbook.yourdept.org/", "user-1"
        )
        assert (previous, new) == (
            "https://logbook.yourdept.org",
            "https://logbook.yourdept.org",
        )
        await db_session.refresh(primary_org)
        stored = primary_org.settings["email_link_domain"]
        assert stored["url"] == "https://logbook.yourdept.org"
        assert stored["updated_by"] == "user-1"

        served.apply_link_domain_override(None)
        assert await load_into_settings(db_session) == "https://logbook.yourdept.org"
        assert served.describe_frontend_url()["source"] == "override"

    async def test_a_saved_host_the_server_no_longer_serves_is_ignored(
        self, db_session, primary_org, served
    ):
        from app.services.email_link_domain_service import load_into_settings

        primary_org.settings = {
            "email_link_domain": {"url": "https://old-name.example.org"}
        }
        await db_session.flush()
        assert await load_into_settings(db_session) is None
        assert served.FRONTEND_URL == "https://logbook.yourdept.org"
        assert served.describe_frontend_url()["source"] == "allowed_origins"

    async def test_clear_removes_it(self, db_session, primary_org, served):
        from app.services.email_link_domain_service import (
            clear_link_domain,
            set_link_domain,
        )

        await set_link_domain(
            db_session, primary_org.id, "https://logbook.yourdept.org", "user-1"
        )
        await clear_link_domain(db_session, primary_org.id)
        await db_session.refresh(primary_org)
        assert "email_link_domain" not in (primary_org.settings or {})
        assert served.describe_frontend_url()["override_url"] is None

    async def test_only_the_primary_organization_may_set_it(
        self, db_session, primary_org, served
    ):
        from app.services.email_link_domain_service import set_link_domain

        with pytest.raises(PermissionError):
            await set_link_domain(
                db_session, "not-the-primary", "https://logbook.yourdept.org", "u"
            )

    async def test_the_generic_settings_writer_cannot_set_it(
        self, db_session, primary_org
    ):
        from app.services.organization_service import OrganizationService

        await OrganizationService(db_session).update_organization_settings(
            primary_org.id,
            {"email_link_domain": {"url": "https://evil.example.com"}},
        )
        await db_session.refresh(primary_org)
        assert "email_link_domain" not in (primary_org.settings or {})


class TestLinkDomainEndpoints:
    @staticmethod
    def _user():
        return SimpleNamespace(id="user-1", organization_id="org-1", username="it")

    async def test_an_address_the_server_does_not_serve_is_a_400(self):
        from fastapi import HTTPException

        from app.schemas.organization import EmailLinkDomainUpdate

        with (
            patch(
                "app.services.email_link_domain_service.set_link_domain",
                AsyncMock(side_effect=ValueError("evil.example.com is not served")),
            ),
            patch(
                "app.core.link_domain_sync.publish_link_domain_invalidation",
                AsyncMock(),
            ) as publish,
        ):
            with pytest.raises(HTTPException) as exc:
                await organizations.set_email_link_domain(
                    EmailLinkDomainUpdate(url="https://evil.example.com"),
                    db=AsyncMock(),
                    current_user=self._user(),
                )
        assert exc.value.status_code == 400
        assert "not served" in exc.value.detail
        publish.assert_not_awaited()

    async def test_a_saved_change_is_published_and_audited(self):
        from app.schemas.organization import EmailLinkDomainUpdate

        configured = _served()
        configured.apply_link_domain_override("https://logbook.yourdept.org")
        with (
            patch.object(organizations, "app_settings", configured),
            patch(
                "app.services.email_link_domain_service.set_link_domain",
                AsyncMock(
                    return_value=(
                        "http://old.yourdept.org",
                        "https://logbook.yourdept.org",
                    )
                ),
            ),
            patch(
                "app.core.link_domain_sync.publish_link_domain_invalidation",
                AsyncMock(),
            ) as publish,
            patch.object(organizations, "log_audit_event", AsyncMock()) as audit,
        ):
            response = await organizations.set_email_link_domain(
                EmailLinkDomainUpdate(url="https://logbook.yourdept.org"),
                db=AsyncMock(),
                current_user=self._user(),
            )
        publish.assert_awaited_once()
        event = audit.await_args.kwargs
        assert event["event_type"] == "email_link_domain_changed"
        assert event["event_data"] == {
            "action": "set",
            "previous_url": "http://old.yourdept.org",
            "new_url": "https://logbook.yourdept.org",
        }
        assert response.source is EmailLinkDomainSource.OVERRIDE

    async def test_another_organization_is_refused_with_403(self):
        from fastapi import HTTPException

        with patch(
            "app.services.email_link_domain_service.clear_link_domain",
            AsyncMock(side_effect=PermissionError("only the primary")),
        ):
            with pytest.raises(HTTPException) as exc:
                await organizations.clear_email_link_domain(
                    db=AsyncMock(), current_user=self._user()
                )
        assert exc.value.status_code == 403


class TestLinkDomainListener:
    async def test_an_announcement_triggers_a_re_read(self):
        import asyncio

        from app.core import link_domain_sync

        listener = link_domain_sync.LinkDomainListener()
        waits = iter([True, asyncio.CancelledError()])

        async def wait(_timeout):
            outcome = next(waits)
            if isinstance(outcome, BaseException):
                raise outcome
            return outcome

        with (
            patch.object(listener, "_wait_for_message", wait),
            patch.object(
                link_domain_sync, "refresh_link_domain", AsyncMock()
            ) as refresh,
        ):
            with pytest.raises(asyncio.CancelledError):
                await listener._listen()
        refresh.assert_awaited_once()

    async def test_without_an_announcement_it_still_re_reads_on_schedule(self):
        import asyncio

        from app.core import link_domain_sync

        listener = link_domain_sync.LinkDomainListener()
        waits = iter([False, asyncio.CancelledError()])

        async def wait(_timeout):
            outcome = next(waits)
            if isinstance(outcome, BaseException):
                raise outcome
            return outcome

        with (
            patch.object(listener, "_wait_for_message", wait),
            patch.object(link_domain_sync, "LINK_DOMAIN_REFRESH_SECONDS", 0.0),
            patch.object(
                link_domain_sync, "refresh_link_domain", AsyncMock()
            ) as refresh,
        ):
            with pytest.raises(asyncio.CancelledError):
                await listener._listen()
        refresh.assert_awaited_once()

    async def test_publishing_without_redis_is_a_quiet_no_op(self):
        from app.core import link_domain_sync

        with patch.object(
            link_domain_sync, "cache_manager", SimpleNamespace(is_connected=False)
        ):
            await link_domain_sync.publish_link_domain_invalidation()
