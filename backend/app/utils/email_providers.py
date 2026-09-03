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

from pydantic import EmailStr, TypeAdapter, ValidationError

_EMAIL_ADAPTER = TypeAdapter(EmailStr)


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

# How a Microsoft 365 configuration authenticates to smtp.office365.com.
# "app_password" is Basic auth, which Exchange Online is retiring; "oauth" is
# the client credentials flow (app.utils.microsoft_oauth).
MICROSOFT_AUTH_METHODS = ("app_password", "oauth")


def microsoft_auth_method(email_config: Mapping[str, Any]) -> str:
    """The Microsoft auth method a stored or submitted section asks for.

    Absent means App Password. Every Microsoft row written before OAuth
    existed carries no method and authenticates with a password, so the
    default has to reproduce that behaviour exactly — reading absence as
    OAuth would take those departments off the air on upgrade (CLAUDE.md
    pitfall 19).
    """
    method = email_config.get("microsoft_auth_method")
    return method if method in MICROSOFT_AUTH_METHODS else "app_password"


def uses_microsoft_oauth(email_config: Mapping[str, Any]) -> bool:
    return (
        email_config.get("platform") == "microsoft"
        and microsoft_auth_method(email_config) == "oauth"
    )


REDACTED_SECRET = "••••••••"


def normalize_app_password(value: Any) -> Optional[str]:
    """An App Password with its display spaces removed, or None if empty.

    Google shows the password as four groups separated by spaces and accepts
    it either way; strip them so a pasted value cannot fail login. A value
    that is only spaces normalizes to nothing, and every presence check must
    see that rather than the raw truthy string.
    """
    if not isinstance(value, str):
        return None
    return value.replace(" ", "") or None


def connection_identity(platform: Any, values: Mapping[str, Any]) -> tuple:
    """The server a stored secret authenticates to, per platform.

    A Gmail / Microsoft App Password logs in as the From address to a fixed
    host; a self-hosted password logs in as ``smtp_user`` to whatever host,
    port and encryption were saved; a Cloudflare token belongs to an account.
    A saved secret is reused only for the identity it was saved with.
    """
    if uses_microsoft_oauth(values):
        # The client secret authenticates one app registration in one
        # directory. Carrying it to a different tenant or client ID would
        # present a credential to an application it was never issued for.
        return (
            platform,
            "oauth",
            values.get("from_email") or None,
            values.get("microsoft_tenant_id") or None,
            values.get("microsoft_client_id") or None,
        )
    if platform in PROVIDER_SMTP_PRESETS:
        return (platform, values.get("from_email") or None)
    if platform == "cloudflare":
        return (platform, values.get("cloudflare_account_id") or None)
    # A stored row may omit the port; the schema and the sender both read
    # that as 587, so the identity must too or an unchanged form never
    # matches what it was saved from.
    port = values.get("smtp_port")
    try:
        port = int(port) if port is not None else 587
    except (TypeError, ValueError):
        port = 587
    return (
        platform,
        values.get("smtp_host") or None,
        port,
        values.get("smtp_user") or None,
        values.get("smtp_encryption") or "tls",
    )


# Secret fields that authenticate to the connection identity. When the
# identity changes on a write, any of these not freshly submitted is cleared
# rather than carried forward to the new server or account.
EMAIL_SECRET_FIELDS = (
    "google_app_password",
    "microsoft_app_password",
    "microsoft_client_secret",
    "smtp_password",
    "cloudflare_api_token",
)


def is_valid_email(value: Any) -> bool:
    if not isinstance(value, str) or not value:
        return False
    try:
        _EMAIL_ADAPTER.validate_python(value)
    except ValidationError:
        return False
    return True


REQUIRED_FIELD_LABELS = {
    "from_email": "a valid account email address",
    "google_app_password": "a Google App Password",
    "microsoft_app_password": "a Microsoft 365 App Password",
    "microsoft_tenant_id": "the Microsoft 365 directory (tenant) ID",
    "microsoft_client_id": "the Microsoft 365 application (client) ID",
    "microsoft_client_secret": "the Microsoft 365 client secret",
    "smtp_host": "an SMTP host",
    "smtp_password": "the SMTP password",
}


def missing_for_enabled(email_config: Mapping[str, Any]) -> Optional[str]:
    """Name the field an *enabled* configuration cannot send without, or None.

    Applied on write only, by every path that stores the section. Reads
    rebuild stored rows through the schema, and a row saved before the App
    Password became the only Gmail / Microsoft path is enabled with no
    password; failing the read would lock that organization out of the
    screen where they fix it. Callers resolve redaction markers first, so a
    marker echoed for a never-set field arrives here as nothing.
    """
    if not email_config.get("enabled"):
        return None
    platform = email_config.get("platform")
    preset = PROVIDER_SMTP_PRESETS.get(platform) if isinstance(platform, str) else None
    if preset is not None:
        # The address doubles as the SMTP login, so a malformed one fails
        # authentication rather than just delivery.
        if not is_valid_email(email_config.get("from_email")):
            return "from_email"
        if uses_microsoft_oauth(email_config):
            for field in (
                "microsoft_tenant_id",
                "microsoft_client_id",
                "microsoft_client_secret",
            ):
                if not email_config.get(field):
                    return field
            return None
        if normalize_app_password(email_config.get(preset.password_field)) is None:
            return preset.password_field
        return None
    if platform == "selfhosted":
        if not email_config.get("smtp_host"):
            return "smtp_host"
        if not is_valid_email(email_config.get("from_email")):
            return "from_email"
        # A username with no password is a credential that was not restored
        # (the server changed under a redacted marker); an anonymous relay
        # with no username is still a complete configuration.
        if email_config.get("smtp_user") and not email_config.get("smtp_password"):
            return "smtp_password"
    return None


def required_field_message(platform: Any, field: str) -> str:
    return (
        f"Enabling {platform} email requires {REQUIRED_FIELD_LABELS[field]}. "
        "Enter it, or leave email disabled."
    )


def resolve_smtp_settings(email_config: Mapping[str, Any]) -> dict[str, Any]:
    """Return the SMTP connection tuple for an ``email_service`` section.

    For a preset platform the host, port and encryption come from the
    provider, the login is the sending address and the password is the App
    Password. Everything else reads the ``smtp_*`` keys as entered.

    The result always has the keys ``host``, ``port``, ``user``, ``password``
    ``encryption`` and ``oauth``; a missing value is ``None`` so the caller
    decides how to report it. ``oauth`` is set only for Microsoft 365 on the
    client credentials flow, where the password is replaced by a token the
    caller obtains from ``app.utils.microsoft_oauth``.
    """
    platform = email_config.get("platform")
    preset = PROVIDER_SMTP_PRESETS.get(platform) if isinstance(platform, str) else None
    if preset is not None:
        # An App Password is issued per account, so the account that logs in
        # is the account the mail is sent from — one field on the form covers
        # both. A Gmail App Password is displayed with spaces; Google accepts
        # it either way, but strip them so a pasted value cannot fail login.
        password = normalize_app_password(email_config.get(preset.password_field))
        oauth = None
        if uses_microsoft_oauth(email_config):
            # The mailbox still identifies itself as the From address; what
            # changes is that the credential is a bearer token obtained from
            # the app registration rather than a password.
            password = None
            oauth = {
                "provider": "microsoft",
                "tenant_id": email_config.get("microsoft_tenant_id") or None,
                "client_id": email_config.get("microsoft_client_id") or None,
                "client_secret": email_config.get("microsoft_client_secret") or None,
            }
        return {
            "host": preset.host,
            "port": preset.port,
            "user": email_config.get("from_email") or None,
            "password": password,
            "encryption": preset.encryption,
            "oauth": oauth,
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
        "oauth": None,
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
