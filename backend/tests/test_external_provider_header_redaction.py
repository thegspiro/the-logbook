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
"""

import uuid
from datetime import datetime, timezone

from app.schemas.training import ExternalTrainingProviderResponse

REDACTED = "••••••••"


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
        "X-Api-Key": REDACTED,
        "Accept": REDACTED,
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
    assert REDACTED in dumped
