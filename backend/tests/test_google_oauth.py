"""Delegated Gmail send tokens (``app.utils.google_oauth``).

The key is a real RSA key, so google-auth parses and signs with it exactly as
it would in production; only the HTTP call to the token endpoint is replaced.
"""

import json
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from google.auth.exceptions import RefreshError, TransportError

from app.utils import google_oauth
from app.utils.google_oauth import (
    GMAIL_SEND_SCOPE,
    GOOGLE_TOKEN_TIMEOUT_SECONDS,
    GoogleOAuthError,
    acquire_gmail_send_token,
    parse_service_account_key,
    service_account_client_id,
)

pytestmark = pytest.mark.unit

SENDER = "notifications@example.org"


def _private_key_pem() -> str:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()


PRIVATE_KEY = _private_key_pem()


def key_info(**overrides) -> dict:
    info = {
        "type": "service_account",
        "project_id": "dept-mail",
        "private_key_id": "abc123",
        "private_key": PRIVATE_KEY,
        "client_email": "mailer@dept-mail.iam.gserviceaccount.com",
        "client_id": "112233445566778899",
        "token_uri": "https://oauth2.googleapis.com/token",
    }
    info.update(overrides)
    return info


@pytest.fixture(autouse=True)
def _empty_cache():
    google_oauth.forget_cached_credentials()
    yield
    google_oauth.forget_cached_credentials()


def _refresh_setting_token(token: str):
    def refresh(self, request):
        self.token = token
        # google-auth stores expiry as naive UTC and compares it that way.
        self.expiry = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(
            hours=1
        )

    return refresh


class TestParseKey:
    def test_accepts_json_text_and_dict(self):
        assert parse_service_account_key(json.dumps(key_info()))["client_id"]
        assert parse_service_account_key(key_info())["client_id"]

    @pytest.mark.parametrize(
        ("value", "fragment"),
        [
            (None, "required"),
            ("", "required"),
            ("{not json", "not valid JSON"),
            (json.dumps({"type": "authorized_user"}), "type service_account"),
            (json.dumps(["a"]), "type service_account"),
        ],
    )
    def test_rejects_what_cannot_sign(self, value, fragment):
        with pytest.raises(GoogleOAuthError, match=fragment):
            parse_service_account_key(value)

    def test_names_the_missing_field(self):
        info = key_info()
        del info["private_key"]
        with pytest.raises(GoogleOAuthError, match="private_key"):
            parse_service_account_key(json.dumps(info))

    def test_client_id_for_the_admin_console(self):
        assert service_account_client_id(json.dumps(key_info())) == (
            "112233445566778899"
        )
        assert service_account_client_id("garbage") is None


class TestAcquireToken:
    def test_requests_gmail_send_for_the_sender(self):
        with patch(
            "google.oauth2.service_account.Credentials.refresh",
            _refresh_setting_token("tok-1"),
        ):
            assert acquire_gmail_send_token(json.dumps(key_info()), SENDER) == "tok-1"

        entry = next(iter(google_oauth._cache.values()))
        assert entry.credentials._subject == SENDER
        assert entry.credentials._scopes == [GMAIL_SEND_SCOPE]

    def test_reuses_an_unexpired_token(self):
        refresh = MagicMock(side_effect=_refresh_setting_token("tok-1"))
        with patch(
            "google.oauth2.service_account.Credentials.refresh",
            lambda self, request: refresh(self, request),
        ):
            acquire_gmail_send_token(key_info(), SENDER)
            acquire_gmail_send_token(key_info(), SENDER)

        assert refresh.call_count == 1

    def test_separate_credentials_per_sender(self):
        with patch(
            "google.oauth2.service_account.Credentials.refresh",
            _refresh_setting_token("tok"),
        ):
            acquire_gmail_send_token(key_info(), SENDER)
            acquire_gmail_send_token(key_info(), "chief@example.org")

        assert len(google_oauth._cache) == 2

    def test_cache_is_bounded(self):
        with (
            patch.object(google_oauth, "_MAX_CACHED_CREDENTIALS", 2),
            patch(
                "google.oauth2.service_account.Credentials.refresh",
                _refresh_setting_token("tok"),
            ),
        ):
            for n in range(4):
                acquire_gmail_send_token(key_info(), f"user{n}@example.org")

        assert len(google_oauth._cache) == 2

    def test_missing_delegation_names_client_id_and_scope(self):
        error = RefreshError(
            "unauthorized_client: Client is unauthorized to retrieve access "
            "tokens using this method",
            {"error": "unauthorized_client"},
        )
        with patch(
            "google.oauth2.service_account.Credentials.refresh", side_effect=error
        ):
            with pytest.raises(GoogleOAuthError) as caught:
                acquire_gmail_send_token(key_info(), SENDER)

        assert "112233445566778899" in str(caught.value)
        assert GMAIL_SEND_SCOPE in str(caught.value)

    def test_refused_account_points_at_the_from_address(self):
        error = RefreshError("invalid_grant: Invalid email or User ID", {})
        with patch(
            "google.oauth2.service_account.Credentials.refresh", side_effect=error
        ):
            with pytest.raises(GoogleOAuthError, match="active user"):
                acquire_gmail_send_token(key_info(), SENDER)

    def test_unreachable_google_is_reported_as_network(self):
        with patch(
            "google.oauth2.service_account.Credentials.refresh",
            side_effect=TransportError("timed out"),
        ):
            with pytest.raises(GoogleOAuthError, match="oauth2.googleapis.com"):
                acquire_gmail_send_token(key_info(), SENDER)

    def test_unreadable_private_key_does_not_echo_it(self):
        info = key_info(
            private_key="-----BEGIN PRIVATE KEY-----\nSECRETBITS\n"
            "-----END PRIVATE KEY-----\n"
        )
        with pytest.raises(GoogleOAuthError) as caught:
            acquire_gmail_send_token(info, SENDER)

        assert "SECRETBITS" not in str(caught.value)

    def test_from_address_is_required(self):
        with pytest.raises(GoogleOAuthError, match="From address"):
            acquire_gmail_send_token(key_info(), "")


class TestTimedRequest:
    def test_every_token_request_carries_the_bounded_timeout(self):
        timed = google_oauth._TimedRequest()
        timed._request = MagicMock()

        timed(url="https://oauth2.googleapis.com/token", method="POST", body=b"x")

        assert timed._request.call_args.kwargs["timeout"] == (
            GOOGLE_TOKEN_TIMEOUT_SECONDS
        )
