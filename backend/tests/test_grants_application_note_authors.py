"""GF-22 pass 4: create/update application responses must resolve note
author names, the same way GET /applications/{id} already does.

`create_application` and `update_application` each generate a `GrantNote`
in the same request (an "Application created…" note on create; a
status-change note whenever `application_status` changes), then reloaded
the application and returned the raw ORM object directly. Only the
dedicated GET handler called `_notes_with_authors()` to resolve
`GrantNoteResponse.created_by_name` — so the note the POST/PUT request
itself just created always came back with a null author, visible only
after a follow-up GET. Fixed by building the response the same way GET
does: `GrantApplicationResponse.model_validate(application)` followed by
`_notes_with_authors()` to populate `grant_notes`.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

import app.api.v1.endpoints.grants as grants_module

pytestmark = pytest.mark.asyncio


def _service(fake_application):
    service = AsyncMock()
    service.create_application = AsyncMock(return_value=fake_application)
    service.update_application = AsyncMock(return_value=fake_application)
    service.get_application = AsyncMock(return_value=fake_application)
    return service


def _data():
    return SimpleNamespace(model_dump=lambda **_kwargs: {})


async def test_create_application_resolves_note_author_names():
    fake_application = SimpleNamespace(id="app-1", grant_notes=["raw-note"])
    resolved_payload = SimpleNamespace(grant_notes=None)
    current_user = SimpleNamespace(id="u1", organization_id="org-1")
    db = AsyncMock()

    with patch(
        "app.api.v1.endpoints.grants.GrantService",
        return_value=_service(fake_application),
    ), patch(
        "app.api.v1.endpoints.grants.GrantApplicationResponse"
    ) as mock_response_cls, patch(
        "app.api.v1.endpoints.grants._notes_with_authors",
        AsyncMock(return_value=["resolved-note"]),
    ) as mock_notes_with_authors:
        mock_response_cls.model_validate.return_value = resolved_payload
        result = await grants_module.create_application(
            data=_data(), db=db, current_user=current_user
        )

    mock_notes_with_authors.assert_awaited_once_with(db, ["raw-note"], "org-1")
    assert result.grant_notes == ["resolved-note"]


async def test_update_application_resolves_note_author_names():
    fake_application = SimpleNamespace(id="app-1", grant_notes=["raw-note"])
    resolved_payload = SimpleNamespace(grant_notes=None)
    current_user = SimpleNamespace(id="u1", organization_id="org-1")
    db = AsyncMock()

    with patch(
        "app.api.v1.endpoints.grants.GrantService",
        return_value=_service(fake_application),
    ), patch(
        "app.api.v1.endpoints.grants.GrantApplicationResponse"
    ) as mock_response_cls, patch(
        "app.api.v1.endpoints.grants._notes_with_authors",
        AsyncMock(return_value=["resolved-note"]),
    ) as mock_notes_with_authors:
        mock_response_cls.model_validate.return_value = resolved_payload
        result = await grants_module.update_application(
            application_id="app-1", data=_data(), db=db, current_user=current_user
        )

    mock_notes_with_authors.assert_awaited_once_with(db, ["raw-note"], "org-1")
    assert result.grant_notes == ["resolved-note"]
