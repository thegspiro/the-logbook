"""
ONB2-30-1/ONB2-30-2: ITTeamRequest.it_team, RolesSetupRequest.roles, and
PositionsSetupRequest.positions had no length cap, unlike every sibling
collection in this schema module (StationsRequest.stations at 50,
ApparatusListRequest.apparatus at 100) — a malformed or hostile payload
could drive an unbounded per-item write loop (a password hash + DB
round-trip per IT-team member, a Role row insert per role/position) on the
single most privileged, unauthenticated bootstrap request in the app.
Schema-only; no DB needed.
"""

import pytest
from pydantic import ValidationError

from app.api.v1.onboarding import (
    ITTeamMemberRequest,
    ITTeamRequest,
    PositionsSetupRequest,
    RoleSetupItem,
    RolesSetupRequest,
)


def _role(i: int) -> RoleSetupItem:
    return RoleSetupItem(id=f"role-{i}", name=f"Role {i}")


class TestITTeamRequestCap:
    def test_accepts_up_to_the_cap(self):
        ITTeamRequest(
            it_team=[ITTeamMemberRequest(name="A", email="a@x.com") for _ in range(50)],
            backup_access={},
        )

    def test_rejects_over_the_cap(self):
        with pytest.raises(ValidationError):
            ITTeamRequest(
                it_team=[
                    ITTeamMemberRequest(name="A", email="a@x.com") for _ in range(51)
                ],
                backup_access={},
            )


class TestRolesSetupRequestCap:
    def test_accepts_up_to_the_cap(self):
        RolesSetupRequest(roles=[_role(i) for i in range(200)])

    def test_rejects_over_the_cap(self):
        with pytest.raises(ValidationError):
            RolesSetupRequest(roles=[_role(i) for i in range(201)])


class TestPositionsSetupRequestCap:
    def test_accepts_up_to_the_cap(self):
        PositionsSetupRequest(positions=[_role(i) for i in range(200)])

    def test_rejects_over_the_cap(self):
        with pytest.raises(ValidationError):
            PositionsSetupRequest(positions=[_role(i) for i in range(201)])


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
