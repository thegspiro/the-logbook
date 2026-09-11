"""Database-backed test for `update_application`'s own "reload with fresh
relationships" step (`grants.py`'s second call to `get_application`).

Caught by Codex review on PR #2483 (GF-36's own fix): `update_application`
loads the application (populating its `grant_notes`/`compliance_tasks`
collections in the session's identity map), then mutates it — adding a
status-change note, and on award, generating compliance tasks — via a bare
`application_id=` assignment rather than a relationship append. The
endpoint's follow-up `get_application()` call returns the *same* identity-
mapped Python object; SQLAlchemy's `selectinload` does not re-run for a
collection already marked loaded, so without `populate_existing=True` the
"reload" silently returns the stale pre-mutation collections — the note or
tasks the request itself just created are absent from the response.

A mocked-session test cannot catch this: the mock hands back canned objects
regardless of SQLAlchemy's identity-map/collection-loading state. This needs
a real database and two genuinely separate query executions in one session.
"""

import uuid
from datetime import date

import pytest

from app.models.grant import ApplicationStatus, GrantApplication, ReportingFrequency
from app.models.user import Organization, User
from app.services.grant_service import GrantService

pytestmark = pytest.mark.integration


async def _make_org(db, name="Grants FD"):
    org = Organization(name=name, slug=f"grants-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _make_user(db, org):
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"officer-{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex[:8]}@example.test",
        first_name="Pat",
        last_name="Quinn",
        password_hash="x",
    )
    db.add(user)
    await db.flush()
    return user


async def test_reloading_after_a_status_change_sees_the_new_note(db_session):
    org = await _make_org(db_session)
    application = GrantApplication(
        organization_id=org.id, grant_program_name="AFG Equipment Grant"
    )
    db_session.add(application)
    await db_session.flush()
    application_id = application.id

    user = await _make_user(db_session, org)
    service = GrantService(db_session)
    updated = await service.update_application(
        application_id, org.id, {"application_status": "submitted"}, user.id
    )
    assert updated is not None

    # Mirrors the endpoint's own second call, meant to reload with fresh
    # relationships after the mutation above.
    reloaded = await service.get_application(application_id, org.id)
    assert reloaded is not None
    assert len(reloaded.grant_notes) == 1, (
        "the status-change note created by update_application must be "
        "visible on the very next get_application() call, not only after "
        "a request the identity map has forgotten about"
    )
    assert "Status changed" in reloaded.grant_notes[0].content


async def test_reloading_after_award_sees_the_generated_compliance_tasks(db_session):
    org = await _make_org(db_session)
    application = GrantApplication(
        organization_id=org.id,
        grant_program_name="AFG Equipment Grant",
        application_status=ApplicationStatus.SUBMITTED,
        grant_start_date=date(2026, 1, 1),
        grant_end_date=date(2026, 12, 31),
        reporting_frequency=ReportingFrequency.QUARTERLY,
    )
    db_session.add(application)
    await db_session.flush()
    application_id = application.id

    user = await _make_user(db_session, org)
    service = GrantService(db_session)
    updated = await service.update_application(
        application_id, org.id, {"application_status": "awarded"}, user.id
    )
    assert updated is not None

    reloaded = await service.get_application(application_id, org.id)
    assert reloaded is not None
    assert len(reloaded.compliance_tasks) > 0, (
        "the compliance tasks auto-generated on award must be visible on "
        "the very next get_application() call"
    )
    assert reloaded.compliance_tasks_generated is True
