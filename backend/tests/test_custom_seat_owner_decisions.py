"""The three SCHED-CUSTOM-SEAT owner decisions of 2026-11-01.

1. **Officer override.** A custom seat no rank, certification, training program
   or open position grants is eligible for nobody. A scheduling manager may
   seat a member in it anyway, with a reason that is noted on the assignment
   and audited; a member still cannot sign up for it, and a seat something
   *does* grant is never overridable.
2. **Certifications confer custom seats.** A department maps a qualification
   code to one of its own seats under Position Names
   (``custom_positions[].qualifications``), and a member holding that
   certification as of the shift date is eligible for the seat.
3. **The department's label.** Notification bodies and printed rosters name a
   custom seat the way Position Names does, through ``position_label`` with
   ``department_seat_labels``.
"""

import json
import uuid
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints import scheduling as scheduling_endpoint
from app.core.error_codes import ErrorCode
from app.models.operational_rank import OperationalRank
from app.models.qualification import MemberQualification
from app.models.training import ShiftAssignment
from app.schemas.scheduling import (
    ShiftAssignmentCreate,
    ShiftAssignmentUpdate,
    ShiftSignupRequest,
)
from app.schemas.scheduling_module_config import (
    CustomPositionSchema,
    ShiftSettingsSchema,
)
from app.services.print_document_service import _seat_column, build_shift_roster
from app.services.qualification_service import (
    custom_qualification_seats,
    known_qualification_codes,
    positions_for_qualifications,
)
from app.services.scheduling_module_config_service import (
    DEFAULT_SHIFT_SETTINGS,
    SchedulingModuleConfigService,
    department_seat_labels,
)
from app.services.scheduling_service import SchedulingService
from app.services.shift_eligibility_service import ShiftEligibilityService
from app.utils.positions import custom_seat_labels, position_label

GRANTED = "rescue_tech"  # a rank grants it
UNGRANTED = "rope_team"  # nothing grants it
MAPPED = "swiftwater"  # the EMT certification confers it

# ---------------------------------------------------------------------------
# Pure helpers — no database
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestSeatLabel:
    def test_a_custom_seat_reads_as_the_department_named_it(self):
        labels = custom_seat_labels([{"value": UNGRANTED, "label": "Rope Team"}])
        assert position_label(UNGRANTED, labels) == "Rope Team"
        # Matched however the stored seat was cased, as resolve_seat matches.
        assert position_label("Rope_Team", labels) == "Rope Team"

    def test_without_labels_a_custom_seat_is_title_cased_as_before(self):
        assert position_label("rt") == "Rt"
        assert position_label("rt", custom_seat_labels([])) == "Rt"

    def test_a_builtin_seat_keeps_its_label(self):
        labels = custom_seat_labels([{"value": UNGRANTED, "label": "Rope Team"}])
        assert position_label("ems", labels) == "EMT"

    def test_unusable_entries_contribute_nothing(self):
        assert custom_seat_labels(None) == {}
        assert (
            custom_seat_labels(
                ["rt", {"value": "rt"}, {"label": "Rope"}, {"value": " ", "label": "x"}]
            )
            == {}
        )

    def test_the_printed_roster_column_uses_the_label(self):
        labels = custom_seat_labels([{"value": "rt", "label": "Rope Team"}])
        assert _seat_column("rt", labels) == "ROPE TEAM"
        assert _seat_column("rt") == "RT"


@pytest.mark.unit
class TestQualificationSeatMapping:
    def test_a_mapped_certification_confers_the_custom_seat(self):
        mapping = custom_qualification_seats(
            [{"value": MAPPED, "label": "Swiftwater", "qualifications": ["emt"]}]
        )
        assert mapping == {"emt": {MAPPED}}
        assert positions_for_qualifications(["emt"], mapping) == {"ems", MAPPED}

    def test_without_a_mapping_only_builtin_seats_are_conferred(self):
        assert positions_for_qualifications(["emt"]) == {"ems"}

    def test_an_entry_saved_before_the_field_confers_nothing(self):
        assert custom_qualification_seats([{"value": MAPPED, "label": "S"}]) == {}

    def test_a_stale_or_malformed_code_is_dropped_on_read(self):
        assert known_qualification_codes(["emt", "emt", "gone", 3, " aemt "]) == [
            "aemt",
            "emt",
        ]
        assert known_qualification_codes("emt") == []

    def test_the_schema_refuses_an_unknown_certification(self):
        with pytest.raises(ValidationError):
            CustomPositionSchema(value=MAPPED, label="S", qualifications=["nope"])

    def test_the_schema_settles_one_canonical_shape(self):
        parsed = CustomPositionSchema(
            value=MAPPED, label="S", qualifications=["paramedic", "emt", "emt"]
        )
        assert parsed.model_dump(by_alias=True)["qualifications"] == [
            "emt",
            "paramedic",
        ]


@pytest.mark.unit
class TestOverridePermission:
    def _user(self, monkeypatch, *granted):
        monkeypatch.setattr(
            scheduling_endpoint,
            "user_has_permission",
            lambda _user, permission: permission in granted,
        )
        return SimpleNamespace(id="u", organization_id="o")

    def test_not_asked_is_not_an_override(self, monkeypatch):
        user = self._user(monkeypatch)
        assert scheduling_endpoint._seat_override_requested(user, False, None) is False

    def test_an_assigner_without_manage_cannot_override(self, monkeypatch):
        user = self._user(monkeypatch, "scheduling.assign")
        with pytest.raises(HTTPException) as caught:
            scheduling_endpoint._seat_override_requested(user, True, "short crew")
        assert caught.value.status_code == 403

    def test_a_reason_is_required(self, monkeypatch):
        user = self._user(monkeypatch, "scheduling.manage")
        with pytest.raises(HTTPException) as caught:
            scheduling_endpoint._seat_override_requested(user, True, "   ")
        assert caught.value.status_code == 400

    def test_a_manager_with_a_reason_may(self, monkeypatch):
        user = self._user(monkeypatch, "scheduling.manage")
        assert scheduling_endpoint._seat_override_requested(user, True, "short")


# ---------------------------------------------------------------------------
# Against the database
# ---------------------------------------------------------------------------


def _uid() -> str:
    return str(uuid.uuid4())


async def _add_org(db_session, name: str) -> str:
    org_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone, settings) "
            "VALUES (:id, :name, 'fire_department', :slug, "
            "'America/New_York', :settings)"
        ),
        {
            "id": org_id,
            "name": name,
            "slug": f"cso-{org_id[:8]}",
            "settings": json.dumps({"scheduling": {}}),
        },
    )
    return org_id


async def _add_member(db_session, org_id: str, rank) -> str:
    user_id = _uid()
    username = f"cso_{user_id[:8]}"
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status, `rank`) VALUES "
            "(:id, :org, :un, 'Test', :ln, :em, 'hashed', 'active', :rank)"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": username,
            "ln": (rank or "manager").title(),
            "em": f"{username}@test.com",
            "rank": rank,
        },
    )
    await db_session.flush()
    return user_id


async def _save_custom_positions(db_session, org_id, custom_positions):
    payload = dict(DEFAULT_SHIFT_SETTINGS)
    payload["custom_positions"] = custom_positions
    await SchedulingModuleConfigService(db_session).update_settings(
        org_id, ShiftSettingsSchema.model_validate(payload)
    )


CUSTOM_POSITIONS = [
    {"value": GRANTED, "label": "Rescue Technician"},
    {"value": UNGRANTED, "label": "Rope Team"},
    {"value": MAPPED, "label": "Swiftwater Rescuer", "qualifications": ["emt"]},
]


@pytest.fixture
def _department_today(monkeypatch):
    monkeypatch.setattr(
        "app.services.scheduling_service.resolve_org_today",
        AsyncMock(return_value=date.today()),
    )


@pytest.fixture
def audit(monkeypatch):
    recorder = AsyncMock()
    monkeypatch.setattr(scheduling_endpoint, "log_audit_event", recorder)
    return recorder


@pytest.fixture
async def department(db_session, _department_today):
    org_id = await _add_org(db_session, "Custom Seat Decisions FD")
    db_session.add(
        OperationalRank(
            organization_id=org_id,
            rank_code="rescue",
            display_name="Rescue Technician",
            eligible_positions=["firefighter", GRANTED],
        )
    )
    members = {
        "rescue": await _add_member(db_session, org_id, "rescue"),
        "firefighter": await _add_member(db_session, org_id, "firefighter"),
        "emt": await _add_member(db_session, org_id, "firefighter"),
        "manager": await _add_member(db_session, org_id, None),
    }
    db_session.add(
        MemberQualification(
            organization_id=org_id,
            user_id=members["emt"],
            qualification_code="emt",
        )
    )
    await db_session.flush()
    await _save_custom_positions(db_session, org_id, CUSTOM_POSITIONS)
    return org_id, members


async def _shift(svc, org_id, creator_id, seats=(GRANTED, UNGRANTED, MAPPED)):
    day = date.today() + timedelta(days=3)
    shift, err = await svc.create_shift(
        uuid.UUID(org_id),
        {
            "shift_date": day,
            "start_time": datetime(day.year, day.month, day.day, 7, 0),
            "positions": [{"position": s, "required": True} for s in seats],
        },
        uuid.UUID(creator_id),
    )
    assert err is None, err
    return SimpleNamespace(id=str(shift.id))


async def _user(db_session, user_id):
    return (
        await db_session.execute(
            select(scheduling_endpoint.User)
            .options(selectinload(scheduling_endpoint.User.positions))
            .where(scheduling_endpoint.User.id == user_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


async def _assignment(db_session, shift_id, user_id):
    return (
        await db_session.execute(
            select(ShiftAssignment)
            .where(
                ShiftAssignment.shift_id == str(shift_id),
                ShiftAssignment.user_id == str(user_id),
            )
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


@pytest.fixture
def _as_manager(monkeypatch, db_session, department):
    """The caller holds scheduling.manage (and so .assign)."""
    monkeypatch.setattr(
        scheduling_endpoint,
        "user_has_permission",
        lambda _user, permission: permission
        in {"scheduling.manage", "scheduling.assign"},
    )


async def _officer_assigns(db_session, monkeypatch, org_id, shift_id, body, caller):
    svc = SchedulingService(db_session)
    monkeypatch.setattr(
        scheduling_endpoint,
        "_authorize_shift_management",
        AsyncMock(return_value=await svc.get_shift_by_id(shift_id, org_id)),
    )
    return await scheduling_endpoint.create_assignment(
        uuid.UUID(shift_id),
        body,
        db=db_session,
        current_user=await _user(db_session, caller),
    )


@pytest.mark.integration
class TestOfficerOverride:
    @pytest.mark.usefixtures("_as_manager")
    async def test_an_ungranted_seat_is_refused_with_the_override_code(
        self, db_session, department, audit, monkeypatch
    ):
        org_id, m = department
        shift = await _shift(SchedulingService(db_session), org_id, m["manager"])

        with pytest.raises(HTTPException) as caught:
            await _officer_assigns(
                db_session,
                monkeypatch,
                org_id,
                shift.id,
                ShiftAssignmentCreate(
                    user_id=uuid.UUID(m["firefighter"]), position=UNGRANTED
                ),
                m["manager"],
            )

        assert caught.value.status_code == 400
        assert caught.value.error_code is ErrorCode.SCHED_SEAT_NOT_GRANTED
        # Named the way the department named it.
        assert "Rope Team" in caught.value.detail
        assert await _assignment(db_session, shift.id, m["firefighter"]) is None
        audit.assert_not_called()

    @pytest.mark.usefixtures("_as_manager")
    async def test_a_manager_seats_the_member_by_override_and_it_is_recorded(
        self, db_session, department, audit, monkeypatch
    ):
        org_id, m = department
        shift = await _shift(SchedulingService(db_session), org_id, m["manager"])

        response = await _officer_assigns(
            db_session,
            monkeypatch,
            org_id,
            shift.id,
            ShiftAssignmentCreate(
                user_id=uuid.UUID(m["firefighter"]),
                position=UNGRANTED,
                override_seat_eligibility=True,
                override_reason="Only rope tech on tonight",
            ),
            m["manager"],
        )

        assert response["position"] == UNGRANTED
        row = await _assignment(db_session, shift.id, m["firefighter"])
        assert row.notes == (
            f"{SchedulingService.SEAT_OVERRIDE_NOTE} Only rope tech on tonight"
        )
        audit.assert_awaited_once()
        event = audit.await_args.kwargs
        assert event["event_type"] == "shift_seat_eligibility_override"
        assert event["event_data"]["reason"] == "Only rope tech on tonight"
        assert event["event_data"]["position"] == UNGRANTED
        assert event["event_data"]["member_id"] == m["firefighter"]

    @pytest.mark.usefixtures("_as_manager")
    async def test_a_granted_seat_is_never_overridable(
        self, db_session, department, audit, monkeypatch
    ):
        """The decision covers seats nobody can fill, not a member an officer
        prefers in a seat a rank already grants to others."""
        org_id, m = department
        shift = await _shift(SchedulingService(db_session), org_id, m["manager"])

        with pytest.raises(HTTPException) as caught:
            await _officer_assigns(
                db_session,
                monkeypatch,
                org_id,
                shift.id,
                ShiftAssignmentCreate(
                    user_id=uuid.UUID(m["firefighter"]),
                    position=GRANTED,
                    override_seat_eligibility=True,
                    override_reason="Want him there",
                ),
                m["manager"],
            )

        assert caught.value.status_code == 400
        assert getattr(caught.value, "error_code", None) is not (
            ErrorCode.SCHED_SEAT_NOT_GRANTED
        )
        assert await _assignment(db_session, shift.id, m["firefighter"]) is None
        audit.assert_not_called()

    async def test_a_member_still_cannot_sign_up_for_an_ungranted_seat(
        self, db_session, department
    ):
        org_id, m = department
        shift = await _shift(SchedulingService(db_session), org_id, m["manager"])

        with pytest.raises(HTTPException) as caught:
            await scheduling_endpoint.signup_for_shift(
                uuid.UUID(shift.id),
                ShiftSignupRequest(position=UNGRANTED),
                db=db_session,
                current_user=await _user(db_session, m["firefighter"]),
            )
        assert caught.value.status_code == 403
        assert await _assignment(db_session, shift.id, m["firefighter"]) is None

    async def test_the_service_never_offers_it_to_a_self_signup(
        self, db_session, department
    ):
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])

        assignment, error = await svc.create_assignment(
            uuid.UUID(org_id),
            uuid.UUID(shift.id),
            {"user_id": m["firefighter"], "position": UNGRANTED},
            uuid.UUID(m["firefighter"]),
            self_signup=True,
            seat_override=True,
        )
        assert assignment is None
        assert "no longer eligible" in error

    @pytest.mark.usefixtures("_as_manager")
    async def test_the_override_respects_the_seat_cap(
        self, db_session, department, audit, monkeypatch
    ):
        """Pitfall #27: one rope seat holds one member, override or not."""
        org_id, m = department
        shift = await _shift(
            SchedulingService(db_session), org_id, m["manager"], seats=(UNGRANTED,)
        )
        for member in ("firefighter", "rescue"):
            body = ShiftAssignmentCreate(
                user_id=uuid.UUID(m[member]),
                position=UNGRANTED,
                override_seat_eligibility=True,
                override_reason="Cover",
            )
            if member == "firefighter":
                await _officer_assigns(
                    db_session, monkeypatch, org_id, shift.id, body, m["manager"]
                )
                continue
            with pytest.raises(HTTPException) as caught:
                await _officer_assigns(
                    db_session, monkeypatch, org_id, shift.id, body, m["manager"]
                )
            assert caught.value.status_code == 400
        assert await _assignment(db_session, shift.id, m["rescue"]) is None

    @pytest.mark.usefixtures("_as_manager")
    async def test_an_edit_moves_a_member_into_the_seat_by_override(
        self, db_session, department, audit, monkeypatch
    ):
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"], seats=(GRANTED, UNGRANTED))
        placed, err = await svc.create_assignment(
            uuid.UUID(org_id),
            uuid.UUID(shift.id),
            {"user_id": m["rescue"], "position": GRANTED, "notes": "Bring gear"},
            uuid.UUID(m["manager"]),
        )
        assert err is None, err
        # An id, not the row: the refused edit rolls the session back.
        placed_id = uuid.UUID(str(placed.id))
        monkeypatch.setattr(
            scheduling_endpoint, "_authorize_assignment_management", AsyncMock()
        )
        manager = await _user(db_session, m["manager"])

        with pytest.raises(HTTPException) as caught:
            await scheduling_endpoint.update_assignment(
                placed_id,
                ShiftAssignmentUpdate(position=UNGRANTED),
                db=db_session,
                current_user=manager,
            )
        assert caught.value.error_code is ErrorCode.SCHED_SEAT_NOT_GRANTED
        # Reloaded: the refusal rolled the session back and expired the row.
        manager = await _user(db_session, m["manager"])

        response = await scheduling_endpoint.update_assignment(
            placed_id,
            ShiftAssignmentUpdate(
                position=UNGRANTED,
                override_seat_eligibility=True,
                override_reason="Moved for the drill",
            ),
            db=db_session,
            current_user=manager,
        )
        assert response["position"] == UNGRANTED
        row = await _assignment(db_session, shift.id, m["rescue"])
        assert row.notes == (
            f"{SchedulingService.SEAT_OVERRIDE_NOTE} Moved for the drill Bring gear"
        )
        audit.assert_awaited_once()


@pytest.mark.integration
class TestCertificationConfersCustomSeat:
    async def test_a_mapped_certification_makes_the_member_eligible(
        self, db_session, department
    ):
        org_id, m = department
        shift = await _shift(SchedulingService(db_session), org_id, m["manager"])
        service = ShiftEligibilityService(db_session)

        holder = await service.get_eligible_positions(
            await _user(db_session, m["emt"]), org_id, shift.id
        )
        other = await service.get_eligible_positions(
            await _user(db_session, m["firefighter"]), org_id, shift.id
        )

        assert MAPPED in holder
        assert MAPPED not in other

    async def test_the_bulk_answer_agrees(self, db_session, department):
        org_id, m = department
        shift = await _shift(SchedulingService(db_session), org_id, m["manager"])
        answers = await ShiftEligibilityService(db_session).get_eligible_positions_bulk(
            await _user(db_session, m["emt"]), org_id, [shift.id]
        )
        assert MAPPED in answers[shift.id]

    async def test_the_holder_signs_up_for_the_seat(self, db_session, department):
        org_id, m = department
        shift = await _shift(SchedulingService(db_session), org_id, m["manager"])

        response = await scheduling_endpoint.signup_for_shift(
            uuid.UUID(shift.id),
            ShiftSignupRequest(position=MAPPED),
            db=db_session,
            current_user=await _user(db_session, m["emt"]),
        )
        assert response["position"] == MAPPED

    async def test_the_position_roster_names_the_certification(
        self, db_session, department
    ):
        org_id, m = department
        roster = await ShiftEligibilityService(db_session).get_position_roster(
            org_id, MAPPED
        )
        sources = {member["user_id"]: member["sources"] for member in roster["members"]}
        assert set(sources) == {m["emt"]}
        assert sources[m["emt"]][0]["type"] == "qualification"
        assert sources[m["emt"]][0]["label"] == "EMT"

    async def test_a_mapped_seat_counts_as_granted(self, db_session, department):
        org_id, _m = department
        service = ShiftEligibilityService(db_session)
        assert await service.seat_is_granted(org_id, MAPPED)
        assert await service.seat_is_granted(org_id, GRANTED)
        assert not await service.seat_is_granted(org_id, UNGRANTED)

    async def test_another_departments_mapping_confers_nothing_here(
        self, db_session, department
    ):
        org_id, m = department
        other = await _add_org(db_session, "Elsewhere FD")
        await _save_custom_positions(
            db_session,
            other,
            [{"value": UNGRANTED, "label": "Rope", "qualifications": ["emt"]}],
        )
        shift = await _shift(SchedulingService(db_session), org_id, m["manager"])

        eligible = await ShiftEligibilityService(db_session).get_eligible_positions(
            await _user(db_session, m["emt"]), org_id, shift.id
        )
        assert UNGRANTED not in eligible
        assert not await ShiftEligibilityService(db_session).seat_is_granted(
            org_id, UNGRANTED
        )

    async def test_the_settings_read_back_carries_the_mapping(
        self, db_session, department
    ):
        org_id, _m = department
        settings, _row = await SchedulingModuleConfigService(db_session).get_settings(
            org_id
        )
        by_value = {cp["value"]: cp for cp in settings["custom_positions"]}
        assert by_value[MAPPED]["qualifications"] == ["emt"]
        assert by_value[UNGRANTED]["qualifications"] == []


@pytest.mark.integration
class TestDepartmentLabel:
    async def test_the_helper_reads_this_department_only(self, db_session, department):
        org_id, _m = department
        other = await _add_org(db_session, "Elsewhere FD")
        await _save_custom_positions(
            db_session, other, [{"value": UNGRANTED, "label": "Their Rope"}]
        )
        labels = await department_seat_labels(db_session, org_id)
        assert position_label(UNGRANTED, labels) == "Rope Team"

    async def test_the_assignment_notice_uses_the_label(self, db_session, department):
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])
        svc._send_notification = AsyncMock()

        await svc._notify_shift_assignment(
            shift_id=shift.id,
            user_id=m["rescue"],
            position=GRANTED,
            organization_id=org_id,
        )

        message = svc._send_notification.await_args.kwargs["message"]
        assert "Rescue Technician position" in message
        assert "Rescue Tech position" not in message

    async def test_the_printed_roster_uses_the_label(self, db_session, department):
        org_id, m = department
        svc = SchedulingService(db_session)
        shift = await _shift(svc, org_id, m["manager"])
        _placed, err = await svc.create_assignment(
            uuid.UUID(org_id),
            uuid.UUID(shift.id),
            {"user_id": m["emt"], "position": MAPPED},
            uuid.UUID(m["manager"]),
        )
        assert err is None, err

        doc = await build_shift_roster(
            db_session, org_id, shift.id, "America/New_York", None
        )
        seats = [row.right for section in doc.sections for row in section.rows]
        assert "SWIFTWATER R" in seats
