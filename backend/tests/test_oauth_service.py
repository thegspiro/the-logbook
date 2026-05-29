"""
Unit tests for Google OAuth (DB-light).

Covers the security-critical, network-independent logic:
- is_configured() gating
- build_authorization_url() params + single-domain `hd` hint
- resolve_user() account-mapping policy (link-existing-only, domain allowlist,
  verified-email requirement, active check, subject-conflict guard)

The token exchange and ID-token signature verification call out to Google and
are intentionally not unit-tested here.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from urllib.parse import parse_qs, urlparse

import pytest

from app.core.config import settings
from app.services.oauth_service import GoogleOAuthService


@pytest.fixture(autouse=True)
def _google_settings(monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_ENABLED", True)
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", "cid.apps.googleusercontent.com")
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_SECRET", "secret")
    monkeypatch.setattr(
        settings,
        "GOOGLE_REDIRECT_URI",
        "https://app.example.org/api/v1/auth/oauth/google/callback",
    )
    monkeypatch.setattr(settings, "GOOGLE_ALLOWED_DOMAINS", "")


def _db_returning(user):
    """Build a mock AsyncSession whose scalar_one_or_none yields *user*.

    Two execute() calls happen in resolve_user: the org lookup and the user
    lookup. Returning the same object for org is harmless; we only assert on
    the user resolution outcome.
    """
    org_result = MagicMock()
    org_result.scalar_one_or_none.return_value = SimpleNamespace(id="org-1")
    user_result = MagicMock()
    user_result.scalar_one_or_none.return_value = user
    db = MagicMock()
    db.execute = AsyncMock(side_effect=[org_result, user_result])
    db.commit = AsyncMock()
    return db


def _user(**kw):
    defaults = dict(
        id="u1",
        username="alice",
        email="alice@dept.org",
        is_active=True,
        oauth_subject=None,
        oauth_provider=None,
        organization_id="org-1",
    )
    defaults.update(kw)
    return SimpleNamespace(**defaults)


# --- is_configured -------------------------------------------------------


def test_is_configured_true_when_complete():
    assert GoogleOAuthService.is_configured() is True


def test_is_configured_false_when_disabled(monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_ENABLED", False)
    assert GoogleOAuthService.is_configured() is False


def test_is_configured_false_without_redirect(monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_REDIRECT_URI", None)
    assert GoogleOAuthService.is_configured() is False


# --- build_authorization_url --------------------------------------------


def test_authorization_url_params():
    q = parse_qs(urlparse(GoogleOAuthService.build_authorization_url("xyz")).query)
    assert q["state"] == ["xyz"]
    assert q["scope"] == ["openid email profile"]
    assert q["response_type"] == ["code"]
    assert "hd" not in q  # no domain restriction configured


def test_authorization_url_single_domain_hint(monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_ALLOWED_DOMAINS", "dept.org")
    q = parse_qs(urlparse(GoogleOAuthService.build_authorization_url("s")).query)
    assert q["hd"] == ["dept.org"]


def test_authorization_url_no_hint_when_multiple_domains(monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_ALLOWED_DOMAINS", "a.org,b.org")
    q = parse_qs(urlparse(GoogleOAuthService.build_authorization_url("s")).query)
    assert "hd" not in q


# --- resolve_user --------------------------------------------------------


async def test_resolve_user_links_existing_active_user():
    user = _user()
    svc = GoogleOAuthService(_db_returning(user))
    resolved, reason = await svc.resolve_user(
        {"email": "alice@dept.org", "email_verified": True, "sub": "g-123"}
    )
    assert resolved is user
    assert reason is None
    # Subject bound on first login.
    assert user.oauth_subject == "g-123"
    assert user.oauth_provider == "google"


async def test_resolve_user_rejects_unverified_email():
    svc = GoogleOAuthService(_db_returning(_user()))
    resolved, reason = await svc.resolve_user(
        {"email": "alice@dept.org", "email_verified": False}
    )
    assert resolved is None
    assert reason == "unverified_email"


async def test_resolve_user_enforces_domain_allowlist(monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_ALLOWED_DOMAINS", "dept.org")
    svc = GoogleOAuthService(_db_returning(_user(email="x@gmail.com")))
    resolved, reason = await svc.resolve_user(
        {"email": "x@gmail.com", "email_verified": True, "sub": "s"}
    )
    assert resolved is None
    assert reason == "domain_not_allowed"


async def test_resolve_user_no_local_account():
    svc = GoogleOAuthService(_db_returning(None))
    resolved, reason = await svc.resolve_user(
        {"email": "ghost@dept.org", "email_verified": True, "sub": "s"}
    )
    assert resolved is None
    assert reason == "no_account"


async def test_resolve_user_inactive():
    svc = GoogleOAuthService(_db_returning(_user(is_active=False)))
    resolved, reason = await svc.resolve_user(
        {"email": "alice@dept.org", "email_verified": True, "sub": "s"}
    )
    assert resolved is None
    assert reason == "inactive"


async def test_resolve_user_subject_conflict():
    svc = GoogleOAuthService(_db_returning(_user(oauth_subject="OLD")))
    resolved, reason = await svc.resolve_user(
        {"email": "alice@dept.org", "email_verified": True, "sub": "NEW"}
    )
    assert resolved is None
    assert reason == "account_conflict"


# =========================================================================
# Microsoft / Azure AD
# =========================================================================

_TENANT = "11111111-2222-3333-4444-555555555555"


@pytest.fixture
def _ms_settings(monkeypatch):
    monkeypatch.setattr(settings, "AZURE_AD_ENABLED", True)
    monkeypatch.setattr(settings, "AZURE_AD_TENANT_ID", _TENANT)
    monkeypatch.setattr(settings, "AZURE_AD_CLIENT_ID", "ms-client-id")
    monkeypatch.setattr(settings, "AZURE_AD_CLIENT_SECRET", "ms-secret")
    monkeypatch.setattr(
        settings,
        "AZURE_AD_REDIRECT_URI",
        "https://app.example.org/api/v1/auth/oauth/microsoft/callback",
    )
    monkeypatch.setattr(settings, "AZURE_AD_ALLOWED_DOMAINS", "")


def test_ms_is_configured_true_when_complete(_ms_settings):
    assert MicrosoftOAuthService.is_configured() is True


def test_ms_is_configured_false_without_tenant(_ms_settings, monkeypatch):
    monkeypatch.setattr(settings, "AZURE_AD_TENANT_ID", None)
    assert MicrosoftOAuthService.is_configured() is False


def test_ms_authorization_url_is_tenant_scoped(_ms_settings):
    url = MicrosoftOAuthService.build_authorization_url("st")
    assert url.startswith(f"https://login.microsoftonline.com/{_TENANT}/")
    q = parse_qs(urlparse(url).query)
    assert q["state"] == ["st"]
    assert q["scope"] == ["openid email profile"]
    assert q["response_mode"] == ["query"]


async def test_ms_resolve_user_uses_email_claim(_ms_settings):
    user = _user()
    svc = MicrosoftOAuthService(_db_returning(user))
    resolved, reason = await svc.resolve_user(
        {"email": "alice@dept.org", "sub": "ms-1"}
    )
    assert resolved is user
    assert reason is None
    assert user.oauth_provider == "microsoft"
    assert user.oauth_subject == "ms-1"


async def test_ms_resolve_user_falls_back_to_preferred_username(_ms_settings):
    user = _user()
    svc = MicrosoftOAuthService(_db_returning(user))
    resolved, reason = await svc.resolve_user(
        {"preferred_username": "alice@dept.org", "sub": "ms-1"}
    )
    assert resolved is user
    assert reason is None


async def test_ms_resolve_user_requires_some_email(_ms_settings):
    svc = MicrosoftOAuthService(_db_returning(_user()))
    resolved, reason = await svc.resolve_user({"sub": "ms-1"})
    assert resolved is None
    assert reason == "no_email"


async def test_ms_resolve_user_enforces_domain_allowlist(_ms_settings, monkeypatch):
    monkeypatch.setattr(settings, "AZURE_AD_ALLOWED_DOMAINS", "dept.org")
    svc = MicrosoftOAuthService(_db_returning(_user(email="x@outlook.com")))
    resolved, reason = await svc.resolve_user({"email": "x@outlook.com", "sub": "ms-1"})
    assert resolved is None
    assert reason == "domain_not_allowed"


async def test_ms_resolve_user_conflicts_with_other_provider(_ms_settings):
    # A user already linked to Google cannot sign in via Microsoft.
    user = _user(oauth_provider="google", oauth_subject="g-sub")
    svc = MicrosoftOAuthService(_db_returning(user))
    resolved, reason = await svc.resolve_user(
        {"email": "alice@dept.org", "sub": "ms-1"}
    )
    assert resolved is None
    assert reason == "account_conflict"


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
