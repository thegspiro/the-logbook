"""The organization-level switch for member NFC ID cards.

Pitfall #19: a config switch must have a reader before it has a UI. This is
that reader, and the direction it fails in is the whole point — a department
that has not turned cards on must not have a live credential surface, so an
absent or half-configured row reads as "off".
"""

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from app.utils.nfc_integration import (
    NFC_INTEGRATION_TYPE,
    nfc_id_cards_enabled,
    require_nfc_id_cards,
)


def _db(row):
    db = MagicMock()
    db.execute = AsyncMock(return_value=MagicMock(first=MagicMock(return_value=row)))
    return db


class TestSwitchReader:
    async def test_a_connected_integration_is_on(self):
        assert await nfc_id_cards_enabled(_db((True, "connected")), "org-1") is True

    async def test_a_missing_row_is_off(self):
        """A fresh install that never opened the integrations screen has not
        turned anything on; reading absence as "on" would hand every such
        department a credential surface nobody asked for."""
        assert await nfc_id_cards_enabled(_db(None), "org-1") is False

    async def test_a_disabled_row_is_off(self):
        assert await nfc_id_cards_enabled(_db((False, "available")), "org-1") is False

    async def test_an_enabled_but_disconnected_row_is_off(self):
        """Both halves have to agree. Disconnecting sets status back to
        'available'; trusting `enabled` alone would keep the cards working
        after somebody turned the integration off."""
        assert await nfc_id_cards_enabled(_db((True, "available")), "org-1") is False

    async def test_an_errored_integration_is_off(self):
        assert await nfc_id_cards_enabled(_db((True, "error")), "org-1") is False


class TestRequireGate:
    async def test_it_raises_403_when_cards_are_off(self):
        with pytest.raises(HTTPException) as excinfo:
            await require_nfc_id_cards(_db(None), "org-1")
        assert excinfo.value.status_code == 403
        # The message has to say where to turn it on, or an officer reads a
        # bare 403 as a permission problem and goes looking for the wrong fix.
        assert "Integrations" in excinfo.value.detail

    async def test_it_passes_when_cards_are_on(self):
        await require_nfc_id_cards(_db((True, "connected")), "org-1")


def test_the_integration_type_is_in_the_catalog():
    """A switch nobody can reach in the UI cannot be turned on."""
    from app.api.v1.endpoints.integrations import INTEGRATION_CATALOG

    entry = next(
        (
            item
            for item in INTEGRATION_CATALOG
            if item["integration_type"] == NFC_INTEGRATION_TYPE
        ),
        None,
    )
    assert entry is not None
    # "coming_soon" is refused by the connect endpoint, so the catalog entry
    # has to be available for the switch to be operable at all.
    assert entry["status"] == "available"
