"""
SMTP presets for hosted email platforms.

Gmail and Microsoft 365 are ordinary SMTP submission services once the
account has an App Password. The organization settings form therefore
collects just the account address and that password; the host, port and
encryption are fixed by the provider and resolved here, at send time and at
test time, from one table. The two callers (``EmailService._get_smtp_config``
and ``email_test_helper``) used to disagree — the helper knew the Gmail host,
the sender did not, so a Gmail department passed its connection test and then
failed every real send.
"""

from dataclasses import dataclass
from typing import Any, Mapping, Optional


@dataclass(frozen=True)
class SmtpPreset:
    host: str
    port: int
    encryption: str
    # Key in the ``email_service`` settings section holding the App Password.
    password_field: str


PROVIDER_SMTP_PRESETS: dict[str, SmtpPreset] = {
    "gmail": SmtpPreset(
        host="smtp.gmail.com",
        port=587,
        encryption="tls",
        password_field="google_app_password",
    ),
    "microsoft": SmtpPreset(
        host="smtp.office365.com",
        port=587,
        encryption="tls",
        password_field="microsoft_app_password",
    ),
}

EMAIL_PLATFORMS = ("gmail", "microsoft", "selfhosted", "cloudflare", "other")


def resolve_smtp_settings(email_config: Mapping[str, Any]) -> dict[str, Any]:
    """Return the SMTP connection tuple for an ``email_service`` section.

    For a preset platform the host, port and encryption come from the
    provider, the login is the sending address and the password is the App
    Password. Everything else reads the ``smtp_*`` keys as entered.

    The result always has the keys ``host``, ``port``, ``user``, ``password``
    and ``encryption``; a missing value is ``None`` so the caller decides how
    to report it.
    """
    platform = email_config.get("platform")
    preset = PROVIDER_SMTP_PRESETS.get(platform) if isinstance(platform, str) else None
    if preset is not None:
        # An App Password is issued per account, so the account that logs in
        # is the account the mail is sent from — one field on the form covers
        # both. A Gmail App Password is displayed with spaces; Google accepts
        # it either way, but strip them so a pasted value cannot fail login.
        password: Optional[str] = email_config.get(preset.password_field) or None
        if password is not None:
            password = password.replace(" ", "")
        return {
            "host": preset.host,
            "port": preset.port,
            "user": email_config.get("from_email") or None,
            "password": password,
            "encryption": preset.encryption,
        }

    port = email_config.get("smtp_port", 587)
    try:
        port = int(port)
    except (TypeError, ValueError):
        port = 587
    return {
        "host": email_config.get("smtp_host") or None,
        "port": port,
        "user": email_config.get("smtp_user") or None,
        "password": email_config.get("smtp_password") or None,
        "encryption": email_config.get("smtp_encryption") or "tls",
    }


def normalize_stored_platform(email_config: Mapping[str, Any]) -> dict[str, Any]:
    """Map a stored ``platform`` outside ``EMAIL_PLATFORMS`` onto a known one.

    ``EmailServiceSettings.platform`` was a free string until 2026-09-03, so a
    row may carry a label such as ``sendgrid`` alongside ``smtp_*`` fields.
    The sender always treated a non-preset platform as SMTP, and still does;
    only the settings schema now validates. Reads reconstruct every stored
    section through that schema, so an unknown value has to be settled here
    or ``GET /settings`` (and the read-back after any unrelated settings
    write) raises for that organization.
    """
    platform = email_config.get("platform")
    if platform in EMAIL_PLATFORMS:
        return dict(email_config)
    normalized = dict(email_config)
    normalized["platform"] = "selfhosted" if email_config.get("smtp_host") else "other"
    return normalized
