"""A gate on account status asks "is this a current member", never "is the
status exactly ``active``".

``UserStatus.PROBATIONARY`` is a current account status: the member signs in,
is scheduled, trains and holds property. The model says so in
``ACTIVE_ACCOUNT_STATUSES``, and sign-in and shift eligibility already read it.
Forty-odd other queries compared ``User.status == UserStatus.ACTIVE`` instead,
so a member an officer set probationary from the profile silently dropped out
of training compliance, certificate alerts, the competency matrix, quorum, the
org chart, several reports and the inventory pickers. Nearly every probationary
member carries ``active`` today only because nothing else sets the column, and
a membership-type-to-status link would move all of them at once — which is why
the gates were widened first.

The sweep makes the rule hold: a literal ``== ACTIVE`` on ``User.status``
anywhere under ``app/`` fails here unless the site is listed in ``ALLOWED``
with a reason. The allowlist is for a tile that deliberately splits Active from
Probationary, not for a gate that forgot the second status.
"""

import re
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import text

from app.models.user import ACTIVE_ACCOUNT_STATUSES, UserStatus
from app.services.admin_continuity_service import is_administrator
from app.services.org_chart_service import OrgChartService
from app.services.quorum_service import QuorumService

APP = Path(__file__).resolve().parents[1] / "app"

#: ``(relative path, enclosing function)`` pairs that compare on the literal
#: status on purpose. Each needs a Probationary counterpart beside it.
ALLOWED = {
    # The admin hub shows Active and Probationary as two tiles that add up.
    ("services/admin_hub_service.py", "_members_active"),
}

_LITERAL_ACTIVE = re.compile(
    r"User\.status\s*(==|!=)\s*(UserStatus\.ACTIVE(\.value)?|[\"']active[\"'])"
    r"|\buser\.status\s*(==|!=)\s*UserStatus\.ACTIVE\b"
    r"|User\.status\.in_\(\s*[\[(]\s*UserStatus\.ACTIVE\s*,?\s*[\])]\s*\)"
)


def _enclosing_function(lines, index):
    for i in range(index, -1, -1):
        match = re.match(r"\s*(async\s+)?def\s+(\w+)", lines[i])
        if match:
            return match.group(2)
    return "<module>"


def _literal_active_sites():
    found = []
    for path in sorted(APP.rglob("*.py")):
        lines = path.read_text(encoding="utf-8").splitlines()
        for index, line in enumerate(lines):
            if _LITERAL_ACTIVE.search(line):
                relative = path.relative_to(APP).as_posix()
                found.append((relative, _enclosing_function(lines, index), index + 1))
    return found


@pytest.mark.unit
def test_active_account_statuses_is_active_and_probationary():
    assert ACTIVE_ACCOUNT_STATUSES == (UserStatus.ACTIVE, UserStatus.PROBATIONARY)


@pytest.mark.unit
def test_no_gate_compares_account_status_to_the_literal_active():
    offenders = [
        f"{path}:{line} in {function}()"
        for path, function, line in _literal_active_sites()
        if (path, function) not in ALLOWED
    ]
    assert not offenders, (
        "A query on User.status asks whether the member is current, which "
        "includes probationary. Use User.status.in_(ACTIVE_ACCOUNT_STATUSES) "
        "(or `status in ACTIVE_ACCOUNT_STATUSES` on an instance), or add the "
        "site to ALLOWED with its Probationary counterpart:\n  "
        + "\n  ".join(offenders)
    )


@pytest.mark.unit
def test_every_allowed_site_still_exists():
    present = {(path, function) for path, function, _ in _literal_active_sites()}
    stale = ALLOWED - present
    assert not stale, f"ALLOWED names sites that no longer compare literally: {stale}"


@pytest.mark.unit
class TestAdministratorContinuity:
    """A probationary administrator still counts as one."""

    @staticmethod
    def _admin(status):
        return SimpleNamespace(
            status=status,
            deleted_at=None,
            rank=None,
            positions=[SimpleNamespace(permissions=["*"])],
        )

    @pytest.mark.parametrize("status", ACTIVE_ACCOUNT_STATUSES)
    def test_a_current_account_with_the_grant_is_an_administrator(self, status):
        assert is_administrator(self._admin(status))

    @pytest.mark.parametrize(
        "status",
        [s for s in UserStatus if s not in ACTIVE_ACCOUNT_STATUSES],
    )
    def test_a_non_current_account_is_not(self, status):
        assert not is_administrator(self._admin(status))


async def _org(db_session) -> str:
    org_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, "
            "timezone, active) VALUES (:id, :name, :otype, :slug, :tz, 1)"
        ),
        {
            "id": org_id,
            "name": "Gate FD",
            "otype": "fire_department",
            "slug": f"gate-{org_id[:8]}",
            "tz": "UTC",
        },
    )
    await db_session.flush()
    return org_id


async def _member(db_session, org_id: str, status: str) -> str:
    user_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status, membership_type) "
            "VALUES (:id, :org, :un, :fn, :ln, :em, 'x', :st, 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"g-{user_id[:8]}",
            "fn": "Sam",
            "ln": status.title(),
            "em": f"g-{user_id[:8]}@test.com",
            "st": status,
        },
    )
    await db_session.flush()
    return user_id


@pytest.mark.integration
class TestProbationaryMembersAreCounted:
    """Two of the widened gates, read back through a real database.

    The sweep above proves the comparison is gone from the source; this
    proves the replacement does what the rule says, on the two sites whose
    answer is a number a department acts on — the quorum denominator and the
    org chart's seat picker.
    """

    async def test_quorum_denominator_and_seat_picker_include_probationary(
        self, db_session
    ):
        org_id = await _org(db_session)
        active = await _member(db_session, org_id, "active")
        probationary = await _member(db_session, org_id, "probationary")
        await _member(db_session, org_id, "inactive")
        await _member(db_session, org_id, "retired")

        assert await QuorumService(db_session).get_active_member_count(org_id) == 2

        options = await OrgChartService(db_session).list_member_options(org_id)
        offered = {option["id"] for option in options}
        assert {active, probationary} <= offered
        assert len(offered) == 2
