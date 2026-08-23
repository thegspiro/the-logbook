"""
What a tamper seal leaves on the record, against a real database.

`tests/test_equipment_check_seals.py` covers the schemas either side of the
wire. This file covers the part that outlives the request: which seals are
written, which are refused, and which one the next crew is shown.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.apparatus import CheckTemplateCompartment, EquipmentCheckTemplate
from app.models.training import ShiftEquipmentCheck, ShiftEquipmentCheckSeal
from app.models.user import Organization
from app.services.equipment_check_service import EquipmentCheckService

pytestmark = [pytest.mark.integration]


async def _org(db_session) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Seal Test Department",
        slug=f"seals-{uuid.uuid4().hex[:8]}",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _template(db_session, org) -> EquipmentCheckTemplate:
    template = EquipmentCheckTemplate(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Medic 2 Daily",
        check_timing="start_of_shift",
    )
    db_session.add(template)
    await db_session.flush()
    return template


async def _compartment(
    db_session, template, name: str, *, sealed: bool
) -> CheckTemplateCompartment:
    compartment = CheckTemplateCompartment(
        id=str(uuid.uuid4()),
        template_id=template.id,
        name=name,
        is_sealed=sealed,
        container_type="bag" if sealed else "compartment",
    )
    db_session.add(compartment)
    await db_session.flush()
    return compartment


async def _check(
    db_session,
    org,
    template,
    *,
    status: str = "pass",
    checked_at: datetime | None = None,
    apparatus_id: str | None = "app-1",
) -> ShiftEquipmentCheck:
    check = ShiftEquipmentCheck(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        template_id=template.id,
        apparatus_id=apparatus_id,
        check_timing="start_of_shift",
        overall_status=status,
        checked_at=checked_at or datetime.now(timezone.utc),
    )
    db_session.add(check)
    await db_session.flush()
    return check


async def _seals_on(db_session, check_id: str) -> list[ShiftEquipmentCheckSeal]:
    from sqlalchemy import select

    rows = (
        (
            await db_session.execute(
                select(ShiftEquipmentCheckSeal).where(
                    ShiftEquipmentCheckSeal.check_id == check_id
                )
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


class TestSealedCompartmentIds:
    async def test_reports_only_the_compartments_marked_sealed(self, db_session):
        org = await _org(db_session)
        template = await _template(db_session, org)
        bag = await _compartment(db_session, template, "Drug Bag", sealed=True)
        await _compartment(db_session, template, "Driver Side", sealed=False)

        service = EquipmentCheckService(db_session)
        assert await service._sealed_compartment_ids(template.id) == {bag.id}

    # A template with nothing sealed is the common case, and the empty set is
    # what makes _create_check_seals refuse every seal for it.
    async def test_is_empty_for_a_template_with_no_sealed_containers(self, db_session):
        org = await _org(db_session)
        template = await _template(db_session, org)
        await _compartment(db_session, template, "Driver Side", sealed=False)

        service = EquipmentCheckService(db_session)
        assert await service._sealed_compartment_ids(template.id) == set()

    async def test_does_not_reach_into_another_template(self, db_session):
        org = await _org(db_session)
        mine = await _template(db_session, org)
        theirs = await _template(db_session, org)
        await _compartment(db_session, theirs, "Their Drug Bag", sealed=True)

        service = EquipmentCheckService(db_session)
        assert await service._sealed_compartment_ids(mine.id) == set()


class TestCreateCheckSeals:
    async def test_writes_the_seal_a_crew_read(self, db_session):
        org = await _org(db_session)
        template = await _template(db_session, org)
        bag = await _compartment(db_session, template, "Drug Bag", sealed=True)
        check = await _check(db_session, org, template)

        service = EquipmentCheckService(db_session)
        await service._create_check_seals(
            check.id,
            [
                {
                    "template_compartment_id": bag.id,
                    "compartment_name": "Drug Bag",
                    "seal_number": "M2-40817",
                    "intact": True,
                    "cleared_item_count": 4,
                }
            ],
            {bag.id},
        )
        await db_session.flush()

        (seal,) = await _seals_on(db_session, check.id)
        assert seal.seal_number == "M2-40817"
        assert seal.intact is True
        assert seal.cleared_item_count == 4
        assert seal.compartment_name == "Drug Bag"

    # A seal for a compartment the template does not mark sealed is a client
    # that has drifted from the template. Storing it would put a claim on the
    # record that nobody was ever asked to make.
    async def test_refuses_a_seal_for_an_unsealed_compartment(self, db_session):
        org = await _org(db_session)
        template = await _template(db_session, org)
        plain = await _compartment(db_session, template, "Driver Side", sealed=False)
        check = await _check(db_session, org, template)

        service = EquipmentCheckService(db_session)
        written = await service._create_check_seals(
            check.id,
            [
                {
                    "template_compartment_id": plain.id,
                    "compartment_name": "Driver Side",
                    "seal_number": "M2-40817",
                    "intact": True,
                }
            ],
            await service._sealed_compartment_ids(template.id),
        )
        await db_session.flush()

        assert written == []
        assert await _seals_on(db_session, check.id) == []

    # Completing an incomplete check re-reads the same bags. Two rows for one
    # compartment would leave the record unable to say which seal the crew
    # actually saw.
    async def test_replaces_rather_than_appends_on_a_second_pass(self, db_session):
        org = await _org(db_session)
        template = await _template(db_session, org)
        bag = await _compartment(db_session, template, "Drug Bag", sealed=True)
        check = await _check(db_session, org, template)
        service = EquipmentCheckService(db_session)

        for number, intact in (("M2-40817", True), ("M2-99999", False)):
            await service._create_check_seals(
                check.id,
                [
                    {
                        "template_compartment_id": bag.id,
                        "compartment_name": "Drug Bag",
                        "seal_number": number,
                        "intact": intact,
                    }
                ],
                {bag.id},
            )
            await db_session.flush()

        seals = await _seals_on(db_session, check.id)
        assert len(seals) == 1
        assert seals[0].seal_number == "M2-99999"
        assert seals[0].intact is False

    # Two entries for one bag in a single payload is a client bug, not two
    # readings — the last one wins rather than both being filed.
    async def test_keeps_one_row_per_compartment_within_one_payload(self, db_session):
        org = await _org(db_session)
        template = await _template(db_session, org)
        bag = await _compartment(db_session, template, "Drug Bag", sealed=True)
        check = await _check(db_session, org, template)

        service = EquipmentCheckService(db_session)
        await service._create_check_seals(
            check.id,
            [
                {"template_compartment_id": bag.id, "seal_number": "FIRST"},
                {"template_compartment_id": bag.id, "seal_number": "SECOND"},
            ],
            {bag.id},
        )
        await db_session.flush()

        seals = await _seals_on(db_session, check.id)
        assert [s.seal_number for s in seals] == ["SECOND"]

    # A crew that could not find the tag records a broken seal with no number.
    # An empty string is not a seal number, and storing one would let it match
    # the next empty string as though the bag were untouched.
    async def test_stores_a_missing_tag_as_no_number_rather_than_blank(
        self, db_session
    ):
        org = await _org(db_session)
        template = await _template(db_session, org)
        bag = await _compartment(db_session, template, "Drug Bag", sealed=True)
        check = await _check(db_session, org, template)

        service = EquipmentCheckService(db_session)
        await service._create_check_seals(
            check.id,
            [
                {
                    "template_compartment_id": bag.id,
                    "compartment_name": "Drug Bag",
                    "seal_number": "",
                    "intact": False,
                }
            ],
            {bag.id},
        )
        await db_session.flush()

        (seal,) = await _seals_on(db_session, check.id)
        assert seal.seal_number is None
        assert seal.intact is False

    async def test_leaves_another_checks_seals_alone(self, db_session):
        org = await _org(db_session)
        template = await _template(db_session, org)
        bag = await _compartment(db_session, template, "Drug Bag", sealed=True)
        yesterday = await _check(db_session, org, template)
        today = await _check(db_session, org, template)
        service = EquipmentCheckService(db_session)

        payload = [{"template_compartment_id": bag.id, "seal_number": "M2-40817"}]
        await service._create_check_seals(yesterday.id, payload, {bag.id})
        await db_session.flush()
        await service._create_check_seals(
            today.id,
            [{"template_compartment_id": bag.id, "seal_number": "M2-40900"}],
            {bag.id},
        )
        await db_session.flush()

        assert [s.seal_number for s in await _seals_on(db_session, yesterday.id)] == [
            "M2-40817"
        ]
        assert [s.seal_number for s in await _seals_on(db_session, today.id)] == [
            "M2-40900"
        ]


class TestGetLastCheckSeals:
    async def test_returns_the_seal_from_the_most_recent_check(self, db_session):
        org = await _org(db_session)
        template = await _template(db_session, org)
        bag = await _compartment(db_session, template, "Drug Bag", sealed=True)
        service = EquipmentCheckService(db_session)

        now = datetime.now(timezone.utc)
        older = await _check(
            db_session, org, template, checked_at=now - timedelta(days=2)
        )
        newer = await _check(
            db_session, org, template, checked_at=now - timedelta(hours=2)
        )
        await service._create_check_seals(
            older.id,
            [{"template_compartment_id": bag.id, "seal_number": "OLD"}],
            {bag.id},
        )
        await service._create_check_seals(
            newer.id,
            [{"template_compartment_id": bag.id, "seal_number": "NEW"}],
            {bag.id},
        )
        await db_session.flush()

        seals = await service.get_last_check_seals(template.id, org.id, "app-1")
        assert seals[bag.id]["seal_number"] == "NEW"
        assert seals[bag.id]["intact"] is True

    # A half-finished check is not a count. Taking its seal as the baseline
    # would let the next crew's matching tag clear contents nobody counted.
    async def test_ignores_an_incomplete_check(self, db_session):
        org = await _org(db_session)
        template = await _template(db_session, org)
        bag = await _compartment(db_session, template, "Drug Bag", sealed=True)
        service = EquipmentCheckService(db_session)

        now = datetime.now(timezone.utc)
        counted = await _check(
            db_session, org, template, checked_at=now - timedelta(days=1)
        )
        abandoned = await _check(
            db_session, org, template, status="incomplete", checked_at=now
        )
        await service._create_check_seals(
            counted.id,
            [{"template_compartment_id": bag.id, "seal_number": "COUNTED"}],
            {bag.id},
        )
        await service._create_check_seals(
            abandoned.id,
            [{"template_compartment_id": bag.id, "seal_number": "ABANDONED"}],
            {bag.id},
        )
        await db_session.flush()

        seals = await service.get_last_check_seals(template.id, org.id, "app-1")
        assert seals[bag.id]["seal_number"] == "COUNTED"

    # The same template can be run on two rigs. A tag read on Medic 2 says
    # nothing about the bag riding on Medic 4.
    async def test_does_not_cross_apparatus(self, db_session):
        org = await _org(db_session)
        template = await _template(db_session, org)
        bag = await _compartment(db_session, template, "Drug Bag", sealed=True)
        service = EquipmentCheckService(db_session)

        other_rig = await _check(db_session, org, template, apparatus_id="app-2")
        await service._create_check_seals(
            other_rig.id,
            [{"template_compartment_id": bag.id, "seal_number": "M4-11111"}],
            {bag.id},
        )
        await db_session.flush()

        assert await service.get_last_check_seals(template.id, org.id, "app-1") == {}

    async def test_does_not_cross_organizations(self, db_session):
        org = await _org(db_session)
        other = await _org(db_session)
        template = await _template(db_session, org)
        bag = await _compartment(db_session, template, "Drug Bag", sealed=True)
        service = EquipmentCheckService(db_session)

        check = await _check(db_session, org, template)
        await service._create_check_seals(
            check.id,
            [{"template_compartment_id": bag.id, "seal_number": "M2-40817"}],
            {bag.id},
        )
        await db_session.flush()

        assert await service.get_last_check_seals(template.id, other.id, "app-1") == {}

    # A bag checked for the first time has nothing to compare against, and the
    # form has to offer a plain "record the seal" rather than the shortcut.
    async def test_is_empty_when_nothing_has_been_checked_yet(self, db_session):
        org = await _org(db_session)
        template = await _template(db_session, org)
        await _compartment(db_session, template, "Drug Bag", sealed=True)

        service = EquipmentCheckService(db_session)
        assert await service.get_last_check_seals(template.id, org.id, "app-1") == {}

    async def test_reports_a_broken_seal_as_broken(self, db_session):
        org = await _org(db_session)
        template = await _template(db_session, org)
        bag = await _compartment(db_session, template, "Drug Bag", sealed=True)
        service = EquipmentCheckService(db_session)

        check = await _check(db_session, org, template)
        await service._create_check_seals(
            check.id,
            [
                {
                    "template_compartment_id": bag.id,
                    "seal_number": "M2-40817",
                    "intact": False,
                }
            ],
            {bag.id},
        )
        await db_session.flush()

        seals = await service.get_last_check_seals(template.id, org.id, "app-1")
        assert seals[bag.id]["intact"] is False
