"""Add Member with a membership number supplied.

``create_member`` checked the number with ``OrganizationService`` near the top
of the function and later re-imported that class inside the auto-generation
branch. A function-local import makes the name local to the *whole* function,
so the earlier use raised ``UnboundLocalError`` and every Add Member request
that carried a membership number failed as a bare 500. A request without one
took the other branch, which is why the screen still appeared to work.

pyflakes does not report a use before a local import, so the sweep below
checks the shape across ``app/`` rather than trusting review to notice it.
"""

import ast
import pathlib
import uuid
from unittest.mock import MagicMock

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.users import create_member
from app.models.user import Organization, User
from app.schemas.user import AdminUserCreate

APP_DIR = pathlib.Path(__file__).resolve().parents[1] / "app"


def _hex() -> str:
    return uuid.uuid4().hex[:8]


async def _org(db: AsyncSession) -> Organization:
    org = Organization(name="Membership Number VFD", slug=f"memno-{_hex()}")
    db.add(org)
    await db.flush()
    return org


async def _admin(db: AsyncSession, org: Organization) -> User:
    admin = User(
        organization_id=org.id,
        username=f"admin-{_hex()}",
        email=f"admin-{_hex()}@example.org",
        first_name="Pat",
        last_name="Chief",
    )
    db.add(admin)
    await db.flush()
    return admin


async def _add_member(db: AsyncSession, org: Organization, **fields):
    data = {
        "username": f"new-{_hex()}",
        "email": f"new-{_hex()}@example.org",
        "first_name": "Jordan",
        "last_name": "Hale",
        # Email is not configured in tests, so a temporary password cannot be
        # sent; the endpoint requires an initial one instead.
        "password": "Kz9!mQ7#vR4$wT2x",
    }
    data.update(fields)
    return await create_member(
        user_data=AdminUserCreate(**data),
        background_tasks=BackgroundTasks(),
        request=MagicMock(),
        db=db,
        current_user=await _admin(db, org),
    )


@pytest.mark.integration
class TestAddMemberWithMembershipNumber:
    async def test_a_supplied_number_is_kept(self, db_session: AsyncSession):
        org = await _org(db_session)
        number = f"M-{_hex()}"

        await _add_member(db_session, org, membership_number=number)

        stored = (
            await db_session.execute(
                select(User.membership_number).where(
                    User.organization_id == org.id,
                    User.membership_number == number,
                )
            )
        ).scalar_one_or_none()
        assert stored == number

    async def test_a_number_already_in_use_is_refused_plainly(
        self, db_session: AsyncSession
    ):
        org = await _org(db_session)
        number = f"M-{_hex()}"
        await _add_member(db_session, org, membership_number=number)

        with pytest.raises(HTTPException) as exc:
            await _add_member(db_session, org, membership_number=number)

        assert exc.value.status_code == 400


def _uses_before_local_import(path: pathlib.Path) -> list[str]:
    def own_nodes(fn: ast.AST):
        # A nested function or class has its own scope; its imports cannot
        # shadow a name in the enclosing function.
        for child in ast.iter_child_nodes(fn):
            if isinstance(
                child,
                (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef),
            ):
                continue
            yield child
            yield from own_nodes(child)

    found = []
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for fn in ast.walk(tree):
        if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        nodes = list(own_nodes(fn))
        first_import: dict[str, int] = {}
        for node in nodes:
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                for alias in node.names:
                    name = (alias.asname or alias.name).split(".")[0]
                    first_import.setdefault(name, node.lineno)
        for node in nodes:
            if (
                isinstance(node, ast.Name)
                and isinstance(node.ctx, ast.Load)
                and node.lineno < first_import.get(node.id, 0)
            ):
                found.append(
                    f"{path.relative_to(APP_DIR.parent)}:{node.lineno} "
                    f"{fn.name} uses {node.id} before its local import"
                )
    return found


@pytest.mark.unit
def test_no_function_uses_a_name_before_importing_it_locally():
    offenders = [
        hit
        for path in sorted(APP_DIR.rglob("*.py"))
        for hit in _uses_before_local_import(path)
    ]
    assert offenders == []
