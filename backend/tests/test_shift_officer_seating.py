"""
A designated shift officer must be seated on the crew board.

`_sync_officer_assignment` decided whether the board had an "officer" seat by
reading `BasicApparatus.positions` alone. The response builder resolves the
same list differently — apparatus positions when the rig has them, the shift's
own otherwise (`_enrich_shift_dict`, `apparatus_positions`) — and the panel
renders from that.

The two disagreed on exactly the departments that run the full Apparatus
module, which deliberately does not model riding positions. There
`apparatus.positions` is empty, so the sync returned before seating anybody
while the board rendered happily from the shift's own positions: the panel
named a Shift Officer who held no seat, appeared on no roster, and was not
counted toward staffing.

Mocked session — no DB — so it runs in the sandbox.
"""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.models.training import AssignmentStatus, ShiftPosition
from app.services.scheduling_service import SchedulingService


@pytest.fixture
def mock_db():
    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.execute = AsyncMock()
    return db


@pytest.fixture
def service(mock_db):
    return SchedulingService(mock_db)


def _scalars(rows):
    result = MagicMock()
    result.scalar_one_or_none.return_value = rows[0] if rows else None
    result.scalars.return_value.all.return_value = rows
    return result


def _shift(positions):
    shift = MagicMock()
    shift.id = str(uuid4())
    shift.apparatus_id = str(uuid4())
    shift.positions = positions
    return shift


def _apparatus(positions):
    rig = MagicMock()
    rig.positions = positions
    return rig


async def _seat(service, mock_db, shift, apparatus, existing=None):
    """Run the sync with a stubbed apparatus lookup and roster."""
    service._get_apparatus_map = AsyncMock(
        return_value={shift.apparatus_id: apparatus} if apparatus else {}
    )
    # 1st execute: the officer's own assignment. 2nd: whoever else holds the
    # officer seat and must be displaced.
    mock_db.execute.side_effect = [
        _scalars([existing] if existing else []),
        _scalars([]),
    ]
    officer_id = str(uuid4())
    await service._sync_officer_assignment(shift, officer_id, uuid4())
    return officer_id


class TestOfficerSeating:
    async def test_seats_from_the_shifts_own_positions(self, service, mock_db):
        """The regression: no riding positions on the rig, but seats on the shift."""
        shift = _shift([{"position": "officer", "required": True}])

        officer_id = await _seat(service, mock_db, shift, _apparatus([]))

        assert mock_db.add.call_count == 1
        created = mock_db.add.call_args.args[0]
        assert created.user_id == officer_id
        assert created.position == ShiftPosition.OFFICER
        assert created.assignment_status == AssignmentStatus.ASSIGNED

    async def test_apparatus_positions_still_win(self, service, mock_db):
        """The rig's own riding positions take precedence, as before the fix."""
        shift = _shift([{"position": "firefighter", "required": True}])

        await _seat(service, mock_db, shift, _apparatus(["officer", "driver"]))

        assert mock_db.add.call_count == 1

    async def test_no_officer_seat_anywhere_seats_nobody(self, service, mock_db):
        """A rig with no officer seat is not given one by the shift officer."""
        shift = _shift([{"position": "firefighter", "required": True}])

        await _seat(service, mock_db, shift, _apparatus([]))

        mock_db.add.assert_not_called()

    async def test_shift_without_positions_seats_nobody(self, service, mock_db):
        """No seats resolved from either source means there is no board to seat on."""
        shift = _shift(None)

        await _seat(service, mock_db, shift, _apparatus([]))

        mock_db.add.assert_not_called()

    async def test_existing_assignment_is_promoted_not_duplicated(
        self, service, mock_db
    ):
        """An officer already crewing the shift moves seats rather than doubling up."""
        shift = _shift([{"position": "officer", "required": True}])
        existing = MagicMock()
        existing.position = ShiftPosition.FIREFIGHTER

        await _seat(service, mock_db, shift, _apparatus([]), existing=existing)

        mock_db.add.assert_not_called()
        assert existing.position == ShiftPosition.OFFICER
