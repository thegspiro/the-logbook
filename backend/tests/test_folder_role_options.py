"""The positions a folder can be restricted to (W53-4).

The Documents screen's "Specific roles" choice needs the department's
positions, and ``GET /roles`` is gated on positions.view — which a documents
manager such as the seeded historian lacks. ``GET /documents/folders/role-options``
serves names and slugs under documents.manage, org-scoped.
"""

from types import SimpleNamespace

import pytest

from app.api.v1.endpoints.documents import list_folder_role_options, router
from app.models.user import Organization, Position

pytestmark = [pytest.mark.integration]


async def test_lists_this_departments_positions_only(db_session):
    mine = Organization(name="Role Options FD", slug="role-opts-mine")
    other = Organization(name="Other FD", slug="role-opts-other")
    db_session.add_all([mine, other])
    await db_session.flush()
    db_session.add_all(
        [
            Position(organization_id=mine.id, name="Lieutenant", slug="lieutenant"),
            Position(organization_id=mine.id, name="Captain", slug="captain"),
            Position(organization_id=other.id, name="Secret", slug="secret"),
        ]
    )
    await db_session.flush()

    options = await list_folder_role_options(
        db=db_session, current_user=SimpleNamespace(organization_id=mine.id)
    )

    assert [(o.slug, o.name) for o in options] == [
        ("captain", "Captain"),
        ("lieutenant", "Lieutenant"),
    ]


def test_gated_on_documents_manage():
    route = next(
        r
        for r in router.routes
        if r.path == "/folders/role-options" and "GET" in r.methods
    )
    gates = [
        set(d.call.required_permissions)
        for d in route.dependant.dependencies
        if hasattr(d.call, "required_permissions")
    ]
    assert gates == [{"documents.manage"}]
