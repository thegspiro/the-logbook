"""Microsoft 365: the warning before the client secret expires.

An administrator records the date Entra ID shows beside the secret. The
Integrations card says when it is within a month, and the administrators'
morning email warns once at 30 days, once at 7 and once on the day.
"""

import copy
from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from pydantic import ValidationError

from app.api.v1.endpoints.integrations import _integration_to_dict
from app.models.integration import Integration
from app.schemas.integration import Microsoft365Config
from app.services.email_service import EmailService
from app.services.google_workspace_attention_digest import (
    LAST_DIGEST_KEY,
    SECRET_WARNED_KEY,
    SETTINGS_KEY,
    send_google_workspace_attention_digest,
)
from app.services.integration_services.microsoft_365_service import (
    client_secret_days_left,
    client_secret_warning_level,
)
from app.utils.org_timezone import org_today
from tests.test_google_workspace_attention import _with_permissions
from tests.test_google_workspace_provisioning import _org
from tests.test_microsoft_365_provisioning import CLIENT, TENANT, _connect_microsoft


def _config(**fields):
    return Microsoft365Config(
        tenant_id=TENANT,
        client_id=CLIENT,
        client_secret="s3cret",
        domain="firedept.org",
        **fields,
    )


@pytest.mark.unit
class TestTheRecordedDate:
    def test_it_is_optional(self):
        assert _config().client_secret_expires_on == ""
        assert _config(client_secret_expires_on="  ").client_secret_expires_on == ""

    def test_a_date_is_kept_in_iso_form(self):
        config = _config(client_secret_expires_on=" 2027-06-30 ")
        assert config.client_secret_expires_on == "2027-06-30"

    @pytest.mark.parametrize("value", ["30/06/2027", "next june", "2027-02-30"])
    def test_anything_but_a_date_is_refused(self, value):
        with pytest.raises(ValidationError, match="client_secret_expires_on"):
            _config(client_secret_expires_on=value)


@pytest.mark.unit
class TestDaysLeft:
    def test_counted_from_today(self):
        today = date(2027, 6, 1)
        config = {"client_secret_expires_on": "2027-06-30"}
        assert client_secret_days_left(config, today) == 29
        assert client_secret_days_left(config, date(2027, 7, 2)) == -2

    @pytest.mark.parametrize("config", [{}, {"client_secret_expires_on": ""}, None])
    def test_unknown_without_a_date(self, config):
        assert client_secret_days_left(config, date(2027, 6, 1)) is None

    def test_an_unreadable_stored_date_is_unknown_not_an_error(self):
        config = {"client_secret_expires_on": "garbage"}
        assert client_secret_days_left(config, date(2027, 6, 1)) is None

    @pytest.mark.parametrize(
        ("days", "level"),
        [(None, None), (31, None), (30, 30), (8, 30), (7, 7), (1, 7), (0, 0), (-5, 0)],
    )
    def test_the_warning_thresholds(self, days, level):
        assert client_secret_warning_level(days) == level


def _integration(integration_type: str, **config) -> Integration:
    return Integration(
        id="int-1",
        organization_id="org-1",
        integration_type=integration_type,
        name="x",
        status="connected",
        enabled=True,
        config=config,
    )


@pytest.mark.unit
class TestTheIntegrationCard:
    def test_microsoft_reports_days_left_and_whether_to_warn(self):
        soon = (datetime.now(timezone.utc).date() + timedelta(days=5)).isoformat()
        later = (datetime.now(timezone.utc).date() + timedelta(days=90)).isoformat()

        near = _integration_to_dict(
            _integration("microsoft-365", client_secret_expires_on=soon)
        )
        assert near["credential_days_left"] == 5
        assert near["credential_expiring"] is True

        far = _integration_to_dict(
            _integration("microsoft-365", client_secret_expires_on=later)
        )
        assert far["credential_days_left"] == 90
        assert far["credential_expiring"] is False

    def test_nothing_is_reported_without_a_date_or_for_another_type(self):
        for integration in (
            _integration("microsoft-365"),
            _integration("google-workspace", client_secret_expires_on="2027-01-01"),
        ):
            result = _integration_to_dict(integration)
            assert result["credential_days_left"] is None
            assert result["credential_expiring"] is False


@pytest.fixture
def send_email():
    mock = AsyncMock(return_value=(1, 0))
    with patch.object(EmailService, "send_email", mock):
        yield mock


async def _department(db_session, days: int):
    org = await _org(db_session)
    expires = (org_today(org) + timedelta(days=days)).isoformat()
    integration = await _connect_microsoft(
        db_session, org, client_secret_expires_on=expires
    )
    admin = await _with_permissions(db_session, org, "admin.access")
    await db_session.commit()
    return org, integration, admin


def _next_morning(org) -> None:
    """Forget today's send, as the next day's run would."""
    settings = copy.deepcopy(org.settings)
    settings[SETTINGS_KEY].pop(LAST_DIGEST_KEY, None)
    org.settings = settings


def _set_expiry(integration, org, days: int) -> None:
    config = dict(integration.config)
    config["client_secret_expires_on"] = (
        org_today(org) + timedelta(days=days)
    ).isoformat()
    integration.config = config


@pytest.mark.integration
class TestTheMorningEmail:
    async def test_nothing_is_sent_more_than_a_month_ahead(
        self, db_session, send_email
    ):
        org, _, _ = await _department(db_session, days=45)

        assert await send_google_workspace_attention_digest(db_session, org) == 0
        send_email.assert_not_awaited()

    async def test_a_month_ahead_it_warns_once(self, db_session, send_email):
        org, _, admin = await _department(db_session, days=30)

        assert await send_google_workspace_attention_digest(db_session, org) == 1
        kwargs = send_email.await_args.kwargs
        assert kwargs["to_emails"] == [admin]
        assert kwargs["subject"] == "Microsoft 365 client secret needs replacing"
        assert "expires on" in kwargs["html_body"]
        assert "in 30 day(s)" in kwargs["html_body"]
        assert org.settings[SETTINGS_KEY][SECRET_WARNED_KEY].endswith(":30")

        _next_morning(org)
        assert await send_google_workspace_attention_digest(db_session, org) == 0
        assert send_email.await_count == 1

    async def test_it_warns_again_a_week_ahead_and_on_the_day(
        self, db_session, send_email
    ):
        org, integration, _ = await _department(db_session, days=30)
        await send_google_workspace_attention_digest(db_session, org)

        _set_expiry(integration, org, 6)
        _next_morning(org)
        await db_session.commit()
        assert await send_google_workspace_attention_digest(db_session, org) == 1
        assert "in 6 day(s)" in send_email.await_args.kwargs["html_body"]

        _set_expiry(integration, org, 0)
        _next_morning(org)
        await db_session.commit()
        assert await send_google_workspace_attention_digest(db_session, org) == 1
        assert "expired on" in send_email.await_args.kwargs["html_body"]

        _next_morning(org)
        assert await send_google_workspace_attention_digest(db_session, org) == 0
        assert send_email.await_count == 3

    async def test_a_new_expiry_date_starts_the_warnings_again(
        self, db_session, send_email
    ):
        org, integration, _ = await _department(db_session, days=20)
        await send_google_workspace_attention_digest(db_session, org)

        _set_expiry(integration, org, 25)
        _next_morning(org)
        await db_session.commit()
        assert await send_google_workspace_attention_digest(db_session, org) == 1

    async def test_no_date_means_no_warning(self, db_session, send_email):
        org = await _org(db_session)
        await _connect_microsoft(db_session, org)
        await _with_permissions(db_session, org, "admin.access")
        await db_session.commit()

        assert await send_google_workspace_attention_digest(db_session, org) == 0
        send_email.assert_not_awaited()

    async def test_nothing_is_recorded_when_no_email_went_out(
        self, db_session, send_email
    ):
        send_email.return_value = (0, 1)
        org, _, _ = await _department(db_session, days=10)

        assert await send_google_workspace_attention_digest(db_session, org) == 0
        assert SECRET_WARNED_KEY not in org.settings.get(SETTINGS_KEY, {})
