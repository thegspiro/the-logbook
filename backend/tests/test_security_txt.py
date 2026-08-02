"""Tests for the RFC 9116 security.txt endpoint (ISO/IEC 29147 alignment)."""

from datetime import datetime, timezone

from app.api.public.security_txt import build_security_txt
from app.core.config import settings


class TestBuildSecurityTxt:
    def test_default_contact_is_project_advisory_intake(self, monkeypatch):
        monkeypatch.setattr(settings, "SECURITY_TXT_CONTACT", None)
        body = build_security_txt()
        assert (
            "Contact: https://github.com/thegspiro/the-logbook"
            "/security/advisories/new" in body
        )

    def test_bare_email_contact_gets_mailto_prefix(self, monkeypatch):
        monkeypatch.setattr(settings, "SECURITY_TXT_CONTACT", "security@example.org")
        body = build_security_txt()
        assert "Contact: mailto:security@example.org" in body

    def test_mailto_and_url_contacts_used_verbatim(self, monkeypatch):
        monkeypatch.setattr(settings, "SECURITY_TXT_CONTACT", "mailto:sec@example.org")
        assert "Contact: mailto:sec@example.org" in build_security_txt()
        monkeypatch.setattr(
            settings, "SECURITY_TXT_CONTACT", "https://example.org/report"
        )
        assert "Contact: https://example.org/report" in build_security_txt()

    def test_expires_is_future_iso8601(self):
        body = build_security_txt()
        expires_line = next(
            line for line in body.splitlines() if line.startswith("Expires: ")
        )
        expires = datetime.strptime(
            expires_line.removeprefix("Expires: "), "%Y-%m-%dT%H:%M:%SZ"
        ).replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        assert expires > now
        # RFC 9116 recommends an Expires value less than a year out
        assert (expires - now).days < 365

    def test_policy_and_language_fields_present(self):
        body = build_security_txt()
        assert f"Policy: {settings.SECURITY_TXT_POLICY_URL}" in body
        assert "Preferred-Languages: en" in body
        assert body.endswith("\n")
