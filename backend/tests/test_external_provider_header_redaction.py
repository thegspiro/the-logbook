"""
Security-review finding (training extended, 2026-09-10): TRX4-7.

``ExternalProviderConfig.additional_headers`` is an admin-defined,
arbitrary-keyed header map — the schema comment on
``ExternalTrainingProviderResponse`` already states "api_key, api_secret,
client_secret are never returned for security," but that convention only
covered the fixed credential fields. A custom header some LMS integrations
require outside those fields (e.g. a bespoke ``X-Api-Key``) could carry a
real credential and was returned verbatim by every route serializing
``ExternalTrainingProviderResponse`` (``GET /providers``,
``GET /providers/{id}``, the create/update responses) to any
``training.manage`` caller and to frontend JavaScript.

Caught by a Codex review round on PR #2460: TRX4-5 made the provider
*list* uncacheable, which stops the browser from retaining a stale copy
past the cache window, but does not stop the value being delivered in the
first place — a response-shape fix, not a caching one.

Fixed by redacting every ``additional_headers`` value (keys kept, so the
admin UI can still show which headers are configured) whenever an
``ExternalTrainingProviderResponse`` is built — via a ``field_validator``
on its own ``config`` field, scoped to the response schema only so the
create/update payloads still round-trip real values for storage.

**Second-order bug the redaction fix itself introduced, caught by a
further Codex review round on the same PR:** a load → edit → save UI round
-trips the redaction marker for any header the caller didn't touch.
``update_provider`` replaced the whole stored ``config`` with whatever the
client submitted, so PATCHing a form populated from a GET response would
silently overwrite the real header value with the literal ``'••••••••'``
string, destroying it. Fixed the same way ``OrganizationService.
update_settings`` already handles the identical shape for email/file
-storage/auth secrets: when a submitted header value equals
``REDACTED_SECRET``, keep the value the row already had for that key
instead of persisting the marker.
"""

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.api.v1.endpoints.external_training import update_provider
from app.schemas.training import (
    ExternalProviderConfig,
    ExternalTrainingProviderResponse,
    ExternalTrainingProviderUpdate,
)
from app.utils.email_providers import REDACTED_SECRET


def _response(**config_overrides):
    return ExternalTrainingProviderResponse(
        id=uuid.uuid4(),
        organization_id=uuid.uuid4(),
        name="Vector Solutions",
        provider_type="vector_solutions",
        active=True,
        connection_verified=True,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
        config={"additional_headers": config_overrides} if config_overrides else None,
    )


def test_additional_header_values_are_redacted():
    resp = _response(
        **{"X-Api-Key": "sk_live_super_secret", "Accept": "application/json"}
    )

    assert resp.config is not None
    assert resp.config.additional_headers == {
        "X-Api-Key": REDACTED_SECRET,
        "Accept": REDACTED_SECRET,
    }


def test_header_keys_are_preserved_so_the_admin_ui_can_show_what_is_configured():
    resp = _response(**{"X-Custom-Auth": "token"})

    assert set(resp.config.additional_headers.keys()) == {"X-Custom-Auth"}


def test_no_config_or_no_headers_does_not_raise():
    resp = ExternalTrainingProviderResponse(
        id=uuid.uuid4(),
        organization_id=uuid.uuid4(),
        name="No Config Provider",
        provider_type="vector_solutions",
        active=True,
        connection_verified=True,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
        config=None,
    )
    assert resp.config is None

    resp2 = ExternalTrainingProviderResponse(
        id=uuid.uuid4(),
        organization_id=uuid.uuid4(),
        name="Empty Headers Provider",
        provider_type="vector_solutions",
        active=True,
        connection_verified=True,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
        config={"site_id": "abc123"},
    )
    assert resp2.config.additional_headers is None


def test_serialized_json_never_contains_the_real_header_value():
    resp = _response(**{"X-Api-Key": "sk_live_super_secret"})

    dumped = resp.model_dump_json()

    assert "sk_live_super_secret" not in dumped
    assert REDACTED_SECRET in dumped


def _scalar_result(value):
    result = MagicMock()
    result.scalar_one_or_none.return_value = value
    return result


def _user():
    return SimpleNamespace(
        id="user-1",
        organization_id="org-1",
        username="tester",
    )


async def test_update_preserves_unchanged_header_and_applies_a_real_new_one():
    """Simulates the load -> edit -> save round trip: the client sends back
    the redacted marker for a header it never touched, and a real new value
    for one it did edit."""
    provider = MagicMock()
    provider.config = {
        "additional_headers": {
            "X-Api-Key": "the-real-secret-value",
            "Accept": "application/json",
        }
    }
    db = MagicMock()
    db.execute = AsyncMock(return_value=_scalar_result(provider))
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    payload = ExternalTrainingProviderUpdate(
        config=ExternalProviderConfig(
            additional_headers={
                "X-Api-Key": REDACTED_SECRET,  # untouched in the UI
                "Accept": "application/xml",  # actually edited
            }
        )
    )

    with patch(
        "app.api.v1.endpoints.external_training.apply_updates"
    ) as mock_apply_updates:
        await update_provider(
            provider_id=uuid.uuid4(),
            provider_update=payload,
            db=db,
            current_user=_user(),
        )

    applied_config = mock_apply_updates.call_args.args[1]["config"]
    assert applied_config["additional_headers"] == {
        "X-Api-Key": "the-real-secret-value",  # preserved, not clobbered
        "Accept": "application/xml",  # the real edit went through
    }


async def test_update_with_no_prior_config_drops_a_redacted_only_submission():
    """A brand-new provider (no stored config yet) has nothing to preserve;
    a submitted marker resolves to None rather than persisting the literal
    placeholder string."""
    provider = MagicMock()
    provider.config = None
    db = MagicMock()
    db.execute = AsyncMock(return_value=_scalar_result(provider))
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    payload = ExternalTrainingProviderUpdate(
        config=ExternalProviderConfig(additional_headers={"X-Api-Key": REDACTED_SECRET})
    )

    with patch(
        "app.api.v1.endpoints.external_training.apply_updates"
    ) as mock_apply_updates:
        await update_provider(
            provider_id=uuid.uuid4(),
            provider_update=payload,
            db=db,
            current_user=_user(),
        )

    applied_config = mock_apply_updates.call_args.args[1]["config"]
    assert applied_config["additional_headers"] == {"X-Api-Key": None}
