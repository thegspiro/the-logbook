"""Regression test for FIN-29.

``preview_approval_chain`` raised its own ``HTTPException(404, ...)`` from
*inside* the same ``try`` block as the service call — and that block's
``except Exception`` has no ``except HTTPException`` ahead of it, so the 404
it raised for a genuine no-match result was itself caught and replaced with a
500. This became reachable the moment FIN-27's route reorder let requests
actually land on this handler at all (previously every call was shadowed by
``get_approval_chain(chain_id="preview")``, which 404'd for an unrelated
reason). Caught by Codex review on PR #2398.

These call the endpoint function directly, matching the convention in
``test_dues_payment_guards.py`` for this same module: fast, no database, and
exercises the handler's own control flow (including the ``try``/``except``
structure the bug lived in) rather than only the service it wraps.
"""

from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import finance as finance_ep

pytestmark = [pytest.mark.unit]


def _user() -> SimpleNamespace:
    return SimpleNamespace(organization_id="org-1")


async def test_no_matching_chain_raises_404_not_500() -> None:
    service = AsyncMock()
    service.preview_approval_chain = AsyncMock(return_value=None)

    with patch.object(finance_ep, "FinanceService", return_value=service):
        with pytest.raises(HTTPException) as exc_info:
            await finance_ep.preview_approval_chain(
                entity_type="expense_report",
                amount=Decimal("100.00"),
                category_id=None,
                db=AsyncMock(),
                current_user=_user(),
            )

    assert exc_info.value.status_code == 404


async def test_a_matching_chain_is_returned() -> None:
    chain = SimpleNamespace(id="chain-1")
    service = AsyncMock()
    service.preview_approval_chain = AsyncMock(return_value=chain)

    with patch.object(finance_ep, "FinanceService", return_value=service):
        result = await finance_ep.preview_approval_chain(
            entity_type="expense_report",
            amount=Decimal("100.00"),
            category_id=None,
            db=AsyncMock(),
            current_user=_user(),
        )

    assert result is chain


async def test_an_invalid_entity_type_still_raises_400() -> None:
    service = AsyncMock()
    service.preview_approval_chain = AsyncMock(
        side_effect=ValueError("Invalid entity type: bogus")
    )

    with patch.object(finance_ep, "FinanceService", return_value=service):
        with pytest.raises(HTTPException) as exc_info:
            await finance_ep.preview_approval_chain(
                entity_type="bogus",
                amount=Decimal("100.00"),
                category_id=None,
                db=AsyncMock(),
                current_user=_user(),
            )

    assert exc_info.value.status_code == 400
