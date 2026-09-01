"""
A member who may submit an equipment check must be able to open one.

EC-7 widened `GET /shifts/{id}/checklists` to accept `inventory.check_view` OR
`inventory.check_submit`, on the stated grounds that a member holds `.submit`
and the check-performing flow has to keep working. Its siblings were left
view-only — and the compartments and items on a template *are* the check form.

So a member saw "Engine Daily Check — 0/9 items — Start Check" on My Equipment
Checklists, clicked it, and got a 403. Every route into the form went the same
way: opening a due checklist, starting an ad-hoc one, and resuming a
part-finished one all call `GET /templates/{id}`, and the "Start a Check"
picker calls `GET /templates`. The member-facing page could list work it could
not begin.

Signature assertions — the defect was in the dependency, and reproducing it
end-to-end needs a member session against a live database.
"""

import inspect
import uuid
from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from sqlalchemy import text

from app.api.v1.endpoints import equipment_check
from app.models.training import (
    AssignmentStatus,
    Shift,
    ShiftAssignment,
    ShiftEquipmentCheck,
    ShiftPosition,
)
from app.services.equipment_check_service import EquipmentCheckService

# Every endpoint the member's own checklist page calls, and the permissions it
# has to accept for that page to function.
MEMBER_FLOW_ENDPOINTS = [
    "get_shift_checklists",
    "get_template",
    "list_templates",
]


def _permission_names(handler) -> set[str]:
    """The permission strings named in a handler's `require_permission` call."""
    source = inspect.getsource(handler)
    start = source.find("require_permission(")
    assert start != -1, f"{handler.__name__} has no require_permission dependency"
    end = source.find(")", start)
    return {
        part.strip().strip("\"'")
        for part in source[start + len("require_permission(") : end].split(",")
        if part.strip()
    }


@pytest.mark.parametrize("name", MEMBER_FLOW_ENDPOINTS)
def test_the_member_flow_accepts_submit(name):
    """`.submit` is the permission the default member position carries."""
    names = _permission_names(getattr(equipment_check, name))
    assert "inventory.check_submit" in names, (
        f"{name} does not accept inventory.check_submit — a member can be shown "
        "a checklist they are then refused"
    )


@pytest.mark.parametrize("name", MEMBER_FLOW_ENDPOINTS)
def test_the_member_flow_still_accepts_view(name):
    """Widening must not have narrowed: an officer holds `.view`, not `.submit`."""
    assert "inventory.check_view" in _permission_names(getattr(equipment_check, name))


def test_writes_are_not_widened():
    """Only the reads the form needs. Editing a template stays a manage right."""
    for name in ("update_template", "delete_template"):
        handler = getattr(equipment_check, name, None)
        if handler is None:
            continue
        assert "inventory.check_submit" not in _permission_names(
            handler
        ), f"{name} accepts inventory.check_submit — members can edit templates"


@pytest.mark.parametrize("name", ["get_template", "list_templates"])
def test_template_reads_accept_manage(name):
    """A manage-without-view role edits templates it must be able to fetch."""
    assert "inventory.check_manage" in _permission_names(
        getattr(equipment_check, name)
    ), f"{name} does not accept inventory.check_manage"


# ---------------------------------------------------------------------------
# DB-backed guards: what an assignment's status grants, and what a saved
# incomplete check keeps reachable.
# ---------------------------------------------------------------------------

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def org_and_member(db_session):
    """A minimal org with one member, created straight against the test DB."""
    org_id = _uid()
    user_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, :otype, :slug, :tz)"
        ),
        {
            "id": org_id,
            "name": "Test FD",
            "otype": "fire_department",
            "slug": f"test-{org_id[:8]}",
            "tz": "UTC",
        },
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, :ln, :em, :pw, 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"member-{user_id[:8]}",
            "fn": "Casey",
            "ln": "Member",
            "em": f"member-{user_id[:8]}@test.com",
            "pw": "hashed",
        },
    )
    await db_session.flush()
    return org_id, user_id


def _shift(org_id: str, days_ahead: int = 1) -> Shift:
    when = date.today() + timedelta(days=days_ahead)
    return Shift(
        id=_uid(),
        organization_id=org_id,
        shift_date=when,
        start_time=datetime.now(timezone.utc) + timedelta(days=days_ahead),
    )


def _assignment(
    org_id: str,
    shift_id: str,
    user_id: str,
    position: ShiftPosition,
    status: AssignmentStatus,
) -> ShiftAssignment:
    return ShiftAssignment(
        id=_uid(),
        organization_id=org_id,
        shift_id=shift_id,
        user_id=user_id,
        position=position,
        assignment_status=status,
    )


class TestCheckPositionEligibility:
    """Template visibility mirrors the submit guard: only ASSIGNED/CONFIRMED
    seats can submit a check, so only they grant position-scoped visibility.
    A declined or cancelled seat must not keep that view open indefinitely."""

    async def test_only_active_assignments_grant_positions(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        svc = EquipmentCheckService(db_session)

        cases = [
            (ShiftPosition.DRIVER, AssignmentStatus.ASSIGNED),
            (ShiftPosition.EMS, AssignmentStatus.CONFIRMED),
            (ShiftPosition.OFFICER, AssignmentStatus.DECLINED),
            (ShiftPosition.CAPTAIN, AssignmentStatus.CANCELLED),
            (ShiftPosition.LIEUTENANT, AssignmentStatus.NO_SHOW),
        ]
        for position, status in cases:
            shift = _shift(org_id)
            db_session.add(shift)
            db_session.add(_assignment(org_id, shift.id, user_id, position, status))
        await db_session.flush()

        positions = await svc.get_user_check_positions(user_id, org_id)

        assert positions == {"driver", "ems"}

    async def test_past_shift_assignments_still_count(self, db_session, org_and_member):
        """No shift-date filter, matching the submit guard: an end-of-shift
        check is legitimately submitted after the shift date has passed."""
        org_id, user_id = org_and_member
        svc = EquipmentCheckService(db_session)

        shift = _shift(org_id, days_ahead=-1)
        db_session.add(shift)
        db_session.add(
            _assignment(
                org_id,
                shift.id,
                user_id,
                ShiftPosition.DRIVER,
                AssignmentStatus.CONFIRMED,
            )
        )
        await db_session.flush()

        assert await svc.get_user_check_positions(user_id, org_id) == {"driver"}


class TestMyChecklistsFeed:
    """The feed must not list checklists the submit guard is going to refuse:
    a declined seat's 'Start Check' is a guaranteed 403."""

    async def test_declined_assignments_do_not_feed_the_page(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        svc = EquipmentCheckService(db_session)

        listed_shift = _shift(org_id, days_ahead=1)
        declined_shift = _shift(org_id, days_ahead=2)
        db_session.add_all([listed_shift, declined_shift])
        db_session.add_all(
            [
                _assignment(
                    org_id,
                    listed_shift.id,
                    user_id,
                    ShiftPosition.DRIVER,
                    AssignmentStatus.ASSIGNED,
                ),
                _assignment(
                    org_id,
                    declined_shift.id,
                    user_id,
                    ShiftPosition.DRIVER,
                    AssignmentStatus.DECLINED,
                ),
            ]
        )
        await db_session.flush()

        seen: list[str] = []

        async def record(shift, organization_id, user_position, existing_checks=None):
            seen.append(str(shift.id))
            return []

        with patch.object(svc, "_checklists_for_shift", side_effect=record):
            await svc.get_my_checklists(user_id, org_id)

        assert seen == [str(listed_shift.id)]


class TestIncompleteCheckResume:
    """Deactivating a template must not strand a member's saved incomplete
    check behind a 404 — completion stays possible; starting a new check on an
    inactive template is still refused elsewhere."""

    @pytest.fixture
    async def inactive_template(self, db_session, org_and_member):
        org_id, user_id = org_and_member
        svc = EquipmentCheckService(db_session)
        template = await svc.create_template(
            organization_id=org_id,
            created_by=user_id,
            data={"name": "Engine Daily", "check_timing": "start_of_shift"},
        )
        template.is_active = False
        await db_session.flush()
        return template

    async def test_deactivated_template_404s_without_an_incomplete_check(
        self, db_session, org_and_member, inactive_template
    ):
        org_id, user_id = org_and_member
        svc = EquipmentCheckService(db_session)
        loaded = await svc.get_template(
            inactive_template.id,
            org_id,
            visible_positions=set(),
            submitter_user_id=user_id,
        )
        assert loaded is None

    async def test_owned_incomplete_check_keeps_the_template_loadable(
        self, db_session, org_and_member, inactive_template
    ):
        org_id, user_id = org_and_member
        svc = EquipmentCheckService(db_session)
        db_session.add(
            ShiftEquipmentCheck(
                id=_uid(),
                organization_id=org_id,
                template_id=inactive_template.id,
                checked_by=user_id,
                check_timing="start_of_shift",
                overall_status="incomplete",
            )
        )
        await db_session.flush()

        loaded = await svc.get_template(
            inactive_template.id,
            org_id,
            visible_positions=set(),
            submitter_user_id=user_id,
        )
        assert loaded is not None
        assert str(loaded.id) == str(inactive_template.id)

    async def test_another_members_incomplete_check_grants_nothing(
        self, db_session, org_and_member, inactive_template
    ):
        org_id, user_id = org_and_member
        svc = EquipmentCheckService(db_session)
        db_session.add(
            ShiftEquipmentCheck(
                id=_uid(),
                organization_id=org_id,
                template_id=inactive_template.id,
                checked_by=user_id,
                check_timing="start_of_shift",
                overall_status="incomplete",
            )
        )
        await db_session.flush()

        loaded = await svc.get_template(
            inactive_template.id,
            org_id,
            visible_positions=set(),
            submitter_user_id=_uid(),
        )
        assert loaded is None

    async def test_a_completed_check_grants_nothing(
        self, db_session, org_and_member, inactive_template
    ):
        org_id, user_id = org_and_member
        svc = EquipmentCheckService(db_session)
        db_session.add(
            ShiftEquipmentCheck(
                id=_uid(),
                organization_id=org_id,
                template_id=inactive_template.id,
                checked_by=user_id,
                check_timing="start_of_shift",
                overall_status="pass",
            )
        )
        await db_session.flush()

        loaded = await svc.get_template(
            inactive_template.id,
            org_id,
            visible_positions=set(),
            submitter_user_id=user_id,
        )
        assert loaded is None
