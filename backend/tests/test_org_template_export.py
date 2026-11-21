"""
Integration tests for department-template export (Phase 1).

Verifies org-scoping/isolation, user-reference scrubbing, exclusion of
non-structural tables, and archive integrity end-to-end against the database.
"""

import io
import json
import uuid
import zipfile

import pytest

from app.models.event import EventTemplate, EventType
from app.models.training import TrainingCategory
from app.models.user import Organization, Position, User
from app.services.org_template_service import OrgTemplateService

# Uses the real-database db_session fixture — must run in the integration job,
# not the DB-less unit job (where the connection attempt hangs to timeout).
pytestmark = [pytest.mark.integration]


async def _make_org(db, name: str) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name=name,
        slug=f"{name.lower().replace(' ', '-')}-{uuid.uuid4().hex[:8]}",
        active=True,
    )
    db.add(org)
    await db.flush()
    return org


async def _read_archive(zip_bytes: bytes):
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
        data = json.loads(archive.read("data.json"))
        manifest = json.loads(archive.read("manifest.json"))
    return data, manifest


async def test_export_is_org_scoped_and_scrubbed(db_session):
    org_a = await _make_org(db_session, "Alpha FD")
    org_b = await _make_org(db_session, "Bravo FD")

    # created_by FKs users.id, so the member reference must be a real row.
    member_a = User(
        id=str(uuid.uuid4()),
        organization_id=org_a.id,
        username=f"alpha-member-{uuid.uuid4().hex[:8]}",
        email=f"alpha-{uuid.uuid4().hex[:8]}@test.com",
    )
    db_session.add(member_a)
    await db_session.flush()

    cat_a = TrainingCategory(
        id=str(uuid.uuid4()),
        organization_id=org_a.id,
        name="Alpha Category",
        created_by=member_a.id,  # member reference — must be scrubbed
    )
    cat_b = TrainingCategory(
        id=str(uuid.uuid4()),
        organization_id=org_b.id,
        name="Bravo Category",
    )
    role_a = Position(
        id=str(uuid.uuid4()),
        organization_id=org_a.id,
        name="Alpha Custom Role",
        slug="alpha-custom-role",
        permissions=["training.view"],
        is_system=False,
    )
    db_session.add_all([cat_a, cat_b, role_a])
    await db_session.flush()

    zip_bytes, filename, manifest = await OrgTemplateService(
        db_session
    ).export_template(org_a.id)
    data, on_disk_manifest = await _read_archive(zip_bytes)

    # Tenant isolation: only org A's structural rows travel.
    categories = data.get("training_categories", [])
    names = {row["name"] for row in categories}
    assert "Alpha Category" in names
    assert "Bravo Category" not in names

    # Member identity is scrubbed.
    alpha = next(r for r in categories if r["name"] == "Alpha Category")
    assert alpha["created_by"] is None

    # Custom role travels; excluded tables never appear.
    positions = data.get("positions", [])
    assert any(p["slug"] == "alpha-custom-role" for p in positions)
    assert "users" not in data
    assert "training_records" not in data

    # Archive integrity.
    assert on_disk_manifest["format"] == "logbook-department-template"
    assert on_disk_manifest["source_org"]["slug"] == org_a.slug
    assert manifest["tables"].get("training_categories") == 1
    assert filename.endswith(".zip")


async def test_training_template_details_are_not_exported(db_session):
    """A Training template's details name a member (an id and a name the key
    scrubber does not catch) and an org-local course, so the column is
    written as null."""
    org = await _make_org(db_session, "Delta FD")
    member_id = str(uuid.uuid4())
    course_id = str(uuid.uuid4())
    template = EventTemplate(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Monthly Drill",
        event_type=EventType.TRAINING,
        training_details={
            "course_mode": "library",
            "course_id": course_id,
            "instructor_id": member_id,
            "instructor": "Pat Example",
        },
    )
    db_session.add(template)
    await db_session.flush()

    zip_bytes, _, _ = await OrgTemplateService(db_session).export_template(org.id)
    data, _ = await _read_archive(zip_bytes)

    exported = next(r for r in data["event_templates"] if r["name"] == "Monthly Drill")
    assert exported["training_details"] is None
    raw = json.dumps(data)
    assert member_id not in raw
    assert course_id not in raw
    assert "Pat Example" not in raw


async def test_system_positions_are_not_exported(db_session):
    org = await _make_org(db_session, "Gamma FD")
    system_role = Position(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="IT Manager",
        slug="it_manager",
        permissions=["*"],
        is_system=True,
    )
    db_session.add(system_role)
    await db_session.flush()

    zip_bytes, _, _ = await OrgTemplateService(db_session).export_template(org.id)
    data, _ = await _read_archive(zip_bytes)

    exported_slugs = {p["slug"] for p in data.get("positions", [])}
    assert "it_manager" not in exported_slugs


async def test_export_unknown_org_raises(db_session):
    service = OrgTemplateService(db_session)
    try:
        await service.export_template(str(uuid.uuid4()))
    except ValueError:
        return
    raise AssertionError("Expected ValueError for unknown organization")
