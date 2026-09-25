"""
The Email settings screen shows administrators which address emailed links are
built from. The value is the deployment's FRONTEND_URL, which
resolve_frontend_url may have replaced with a public ALLOWED_ORIGINS entry;
until this endpoint that substitution was reported only in the startup log.
"""

from types import SimpleNamespace
from unittest.mock import patch

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
