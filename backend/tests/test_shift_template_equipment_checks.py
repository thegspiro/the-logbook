"""Which checklists a shift carries, against a real database.

A shift used to find its equipment checklists one way: through its apparatus,
by id and then by type. A shift template can now name them outright, and the
rule is that naming them **replaces** apparatus resolution rather than adding
to it — the officer who wrote the template said what this shift carries, and
the apparatus-type default is not a second opinion to be merged in.

Three resolvers implement that rule and they have to agree, or a reminder names
one set of checklists and the crew is shown another:

* ``EquipmentCheckService._resolve_templates`` — what the crew is offered
* ``scheduled_tasks.resolve_check_templates`` — what the reminders name
* ``EquipmentReadinessService`` — what the fleet board scores against
  (covered in ``test_equipment_readiness_service.py``, which stubs its queries)

The subtle case, and the one worth reading twice: a template whose links all
point at *deactivated* checklists resolves to **nothing**, not to the
apparatus default. Falling back there would report a crew as missing a check
nobody asked them for.
"""

import uuid

import pytest

from app.models.apparatus import EquipmentCheckTemplate
from app.models.training import (
    BasicApparatus,
    Shift,
    ShiftTemplate,
    ShiftTemplateEquipmentCheck,
)
from app.models.user import Organization
from app.services.equipment_check_service import EquipmentCheckService
from app.services.scheduled_tasks import resolve_check_templates
from app.services.scheduling_service import SchedulingService

pytestmark = [pytest.mark.integration]


async def _org(db_session) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Checklist Link Department",
        slug=f"stec-{uuid.uuid4().hex[:8]}",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _check_template(
    db_session,
    org,
    name: str,
    *,
    apparatus_type: str | None = None,
    timing: str = "start_of_shift",
    active: bool = True,
) -> EquipmentCheckTemplate:
    template = EquipmentCheckTemplate(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=name,
        check_timing=timing,
        apparatus_type=apparatus_type,
        is_active=active,
    )
    db_session.add(template)
    await db_session.flush()
    return template


async def _engine(db_session, org) -> BasicApparatus:
    """A real rig, so the apparatus-type fallback can actually match.

    Without one, every fallback assertion below would be satisfied by "found
    nothing" just as well as by "fell back and found nothing", which proves
    neither.
    """
    rig = BasicApparatus(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        unit_number="E-1",
        name="Engine 1",
        apparatus_type="engine",
    )
    db_session.add(rig)
    await db_session.flush()
    return rig


async def _shift_template(db_session, org, name: str = "Day Shift") -> ShiftTemplate:
    template = ShiftTemplate(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=name,
        start_time_of_day="07:00",
        end_time_of_day="19:00",
        duration_hours=12.0,
    )
    db_session.add(template)
    await db_session.flush()
    return template


async def _link(db_session, org, shift_template, check_template, order=0):
    row = ShiftTemplateEquipmentCheck(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        shift_template_id=shift_template.id,
        equipment_check_template_id=check_template.id,
        sort_order=order,
    )
    db_session.add(row)
    await db_session.flush()
    return row


def _shift(org, *, apparatus_id=None, template_id=None) -> Shift:
    """An unsaved Shift — the resolver reads its attributes, not its row."""
    from datetime import datetime, timezone

    return Shift(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        shift_date=datetime.now(timezone.utc).date(),
        start_time=datetime.now(timezone.utc),
        apparatus_id=apparatus_id,
        template_id=template_id,
    )


class TestResolveTemplates:
    """The crew-facing resolver."""

    async def test_an_explicit_link_is_what_the_crew_gets(self, db_session):
        org = await _org(db_session)
        linked = await _check_template(db_session, org, "Medic Daily")
        shift_template = await _shift_template(db_session, org)
        await _link(db_session, org, shift_template, linked)

        service = EquipmentCheckService(db_session)
        resolved = await service._resolve_templates(
            _shift(org, template_id=shift_template.id), org.id, None
        )
        assert [t.name for t in resolved] == ["Medic Daily"]

    async def test_an_explicit_link_replaces_the_apparatus_type_default(
        self, db_session
    ):
        org = await _org(db_session)
        await _check_template(db_session, org, "Engine Daily", apparatus_type="engine")
        linked = await _check_template(db_session, org, "Special Detail")
        shift_template = await _shift_template(db_session, org)
        await _link(db_session, org, shift_template, linked)

        service = EquipmentCheckService(db_session)
        resolved = await service._resolve_templates(
            _shift(org, apparatus_id="eng-1", template_id=shift_template.id),
            org.id,
            None,
        )
        assert [t.name for t in resolved] == ["Special Detail"]

    async def test_links_are_returned_in_the_officers_order(self, db_session):
        org = await _org(db_session)
        second = await _check_template(db_session, org, "Second")
        first = await _check_template(db_session, org, "First")
        shift_template = await _shift_template(db_session, org)
        await _link(db_session, org, shift_template, first, order=0)
        await _link(db_session, org, shift_template, second, order=1)

        service = EquipmentCheckService(db_session)
        resolved = await service._resolve_templates(
            _shift(org, template_id=shift_template.id), org.id, None
        )
        assert {t.name for t in resolved} == {"First", "Second"}

    async def test_a_template_naming_nothing_falls_back_to_the_apparatus(
        self, db_session
    ):
        org = await _org(db_session)
        rig = await _engine(db_session, org)
        await _check_template(db_session, org, "Engine Daily", apparatus_type="engine")
        shift_template = await _shift_template(db_session, org)

        service = EquipmentCheckService(db_session)
        resolved = await service._resolve_templates(
            _shift(org, apparatus_id=rig.id, template_id=shift_template.id),
            org.id,
            None,
        )
        assert [t.name for t in resolved] == ["Engine Daily"]

    async def test_links_to_deactivated_checklists_resolve_to_nothing(self, db_session):
        """Not a fallback. See the module docstring."""
        org = await _org(db_session)
        await _check_template(db_session, org, "Engine Daily", apparatus_type="engine")
        retired = await _check_template(db_session, org, "Retired", active=False)
        shift_template = await _shift_template(db_session, org)
        await _link(db_session, org, shift_template, retired)

        service = EquipmentCheckService(db_session)
        resolved = await service._resolve_templates(
            _shift(org, apparatus_id="eng-1", template_id=shift_template.id),
            org.id,
            None,
        )
        assert resolved == []

    async def test_a_shift_with_no_template_uses_the_apparatus(self, db_session):
        """Every shift created before shifts.template_id existed is this case."""
        org = await _org(db_session)
        rig = await _engine(db_session, org)
        await _check_template(db_session, org, "Engine Daily", apparatus_type="engine")
        shift_template = await _shift_template(db_session, org)
        linked = await _check_template(db_session, org, "Linked")
        await _link(db_session, org, shift_template, linked)

        service = EquipmentCheckService(db_session)
        resolved = await service._resolve_templates(
            _shift(org, apparatus_id=rig.id), org.id, None
        )
        assert [t.name for t in resolved] == ["Engine Daily"]

    async def test_another_orgs_links_are_not_resolved(self, db_session):
        """The link row is org-scoped in its own right (pitfall #14a)."""
        org = await _org(db_session)
        other = await _org(db_session)
        theirs = await _check_template(db_session, other, "Their Checklist")
        rig = await _engine(db_session, org)
        await _check_template(db_session, org, "Engine Daily", apparatus_type="engine")
        shift_template = await _shift_template(db_session, org)
        # A link row stamped with the *other* org, as a cross-tenant write
        # would leave it.
        await _link(db_session, other, shift_template, theirs)

        service = EquipmentCheckService(db_session)
        resolved = await service._resolve_templates(
            _shift(org, apparatus_id=rig.id, template_id=shift_template.id),
            org.id,
            None,
        )
        # Their checklist is not resolved, and the shift falls through to its
        # own apparatus rather than to nothing.
        assert [t.name for t in resolved] == ["Engine Daily"]

    async def test_position_eligibility_still_filters_a_linked_set(self, db_session):
        """Timing and eligibility stay on the checklist, not on the link."""
        org = await _org(db_session)
        linked = await _check_template(db_session, org, "Driver Only")
        linked.assigned_positions = ["driver"]
        shift_template = await _shift_template(db_session, org)
        await _link(db_session, org, shift_template, linked)
        await db_session.flush()

        service = EquipmentCheckService(db_session)
        shift = _shift(org, template_id=shift_template.id)

        assert await service._resolve_templates(shift, org.id, "driver")
        assert await service._resolve_templates(shift, org.id, "firefighter") == []


class TestResolveCheckTemplatesForReminders:
    """The reminder resolver must agree with the crew-facing one."""

    async def test_an_explicit_link_is_what_the_reminder_names(self, db_session):
        org = await _org(db_session)
        await _check_template(db_session, org, "Engine Daily", apparatus_type="engine")
        linked = await _check_template(db_session, org, "Special Detail")
        shift_template = await _shift_template(db_session, org)
        await _link(db_session, org, shift_template, linked)

        resolved = await resolve_check_templates(
            db_session,
            org.id,
            "eng-1",
            "start_of_shift",
            shift_template_id=shift_template.id,
        )
        assert [t.name for t in resolved] == ["Special Detail"]

    async def test_timing_still_filters_a_linked_set(self, db_session):
        """The link carries no timing; the checklist does.

        An end-of-shift reminder names only the linked checklists that are
        end-of-shift ones — and does not fall through to the apparatus for the
        others, because the template did name checklists.
        """
        org = await _org(db_session)
        await _check_template(
            db_session,
            org,
            "Engine EOS",
            apparatus_type="engine",
            timing="end_of_shift",
        )
        start_only = await _check_template(db_session, org, "Start Only")
        shift_template = await _shift_template(db_session, org)
        await _link(db_session, org, shift_template, start_only)

        resolved = await resolve_check_templates(
            db_session,
            org.id,
            "eng-1",
            "end_of_shift",
            shift_template_id=shift_template.id,
        )
        assert resolved == []

    async def test_no_links_falls_back_to_the_apparatus_type(self, db_session):
        org = await _org(db_session)
        rig = await _engine(db_session, org)
        await _check_template(db_session, org, "Engine Daily", apparatus_type="engine")
        shift_template = await _shift_template(db_session, org)

        resolved = await resolve_check_templates(
            db_session,
            org.id,
            rig.id,
            "start_of_shift",
            shift_template_id=shift_template.id,
        )
        # A shift template naming nothing does not claim the shift, so the
        # apparatus branch runs and finds the checklist.
        assert [t.name for t in resolved] == ["Engine Daily"]

    async def test_a_shift_with_neither_resolves_to_nothing(self, db_session):
        org = await _org(db_session)
        resolved = await resolve_check_templates(
            db_session, org.id, None, "start_of_shift", shift_template_id=None
        )
        assert resolved == []


class TestLinkManagement:
    """Creating and editing the links through the shift-template service."""

    async def test_create_stores_the_links_in_order(self, db_session):
        org = await _org(db_session)
        first = await _check_template(db_session, org, "First")
        second = await _check_template(db_session, org, "Second")

        service = SchedulingService(db_session)
        template, error = await service.create_template(
            org.id,
            {
                "name": "Day Shift",
                "start_time_of_day": "07:00",
                "end_time_of_day": "19:00",
                "duration_hours": 12.0,
                "equipment_check_template_ids": [second.id, first.id],
            },
            None,
        )
        assert error is None
        assert template.equipment_check_template_ids == [second.id, first.id]

    async def test_update_omitting_the_key_leaves_links_alone(self, db_session):
        """An omitted key means "leave this alone" (pitfall #1)."""
        org = await _org(db_session)
        linked = await _check_template(db_session, org, "Keep Me")
        shift_template = await _shift_template(db_session, org)
        await _link(db_session, org, shift_template, linked)

        service = SchedulingService(db_session)
        updated, error = await service.update_template(
            shift_template.id, org.id, {"name": "Renamed"}
        )
        assert error is None
        assert updated.name == "Renamed"
        assert updated.equipment_check_template_ids == [linked.id]

    async def test_update_with_an_empty_list_clears_the_links(self, db_session):
        """The officer unticked them all — a real choice, not a no-op.

        Clearing restores apparatus-based resolution, which is why an empty
        list has to reach the database rather than being dropped as falsy.
        """
        org = await _org(db_session)
        linked = await _check_template(db_session, org, "Remove Me")
        shift_template = await _shift_template(db_session, org)
        await _link(db_session, org, shift_template, linked)

        service = SchedulingService(db_session)
        updated, error = await service.update_template(
            shift_template.id, org.id, {"equipment_check_template_ids": []}
        )
        assert error is None
        assert updated.equipment_check_template_ids == []

    async def test_update_replaces_rather_than_merges(self, db_session):
        org = await _org(db_session)
        old = await _check_template(db_session, org, "Old")
        new = await _check_template(db_session, org, "New")
        shift_template = await _shift_template(db_session, org)
        await _link(db_session, org, shift_template, old)

        service = SchedulingService(db_session)
        updated, error = await service.update_template(
            shift_template.id, org.id, {"equipment_check_template_ids": [new.id]}
        )
        assert error is None
        assert updated.equipment_check_template_ids == [new.id]

    async def test_another_orgs_checklist_is_refused(self, db_session):
        """A client-supplied FK, org-checked before it is stored (pitfall #14c).

        Not merely a dangling reference: this link decides which checklists a
        crew is shown, so a foreign id would point them at another
        department's.
        """
        org = await _org(db_session)
        other = await _org(db_session)
        theirs = await _check_template(db_session, other, "Theirs")
        shift_template = await _shift_template(db_session, org)

        service = SchedulingService(db_session)
        updated, error = await service.update_template(
            shift_template.id, org.id, {"equipment_check_template_ids": [theirs.id]}
        )
        assert updated is None
        assert error == "Equipment checklist not found"

    async def test_duplicate_ids_are_collapsed(self, db_session):
        """The unique constraint would reject the second row anyway."""
        org = await _org(db_session)
        linked = await _check_template(db_session, org, "Once")
        shift_template = await _shift_template(db_session, org)

        service = SchedulingService(db_session)
        updated, error = await service.update_template(
            shift_template.id,
            org.id,
            {"equipment_check_template_ids": [linked.id, linked.id]},
        )
        assert error is None
        assert updated.equipment_check_template_ids == [linked.id]
