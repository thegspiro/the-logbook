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

import ast
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.api.v1.onboarding import (
    ONBOARDING_CONFIG_MAX_BYTES,
    EmailConfigRequest,
    EmailTestRequest,
    FileStorageConfigRequest,
    ITTeamMemberRequest,
    ITTeamRequest,
    PositionsSetupRequest,
    RolePermission,
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


class TestRoleSetupItemPermissionsCap:
    """ONB3-30-1: a role/position's own ``permissions`` dict had no cap.

    ``RoleSetupItem.permissions`` keys are arbitrary client-supplied module
    ids (there is no server-side allowlist — see ONB-7), so nothing bounded
    how many `{module}.view`/`{module}.manage`/`{module}.*` entries one role
    could carry. The outer `roles`/`positions` list caps (ONB2-30-2) bound
    the number of roles per request, not the size of any single role's own
    permission set.
    """

    def test_accepts_up_to_the_cap(self):
        RoleSetupItem(
            id="role-1",
            name="Role 1",
            permissions={f"module{i}": RolePermission() for i in range(50)},
        )

    def test_rejects_over_the_cap(self):
        with pytest.raises(ValidationError):
            RoleSetupItem(
                id="role-1",
                name="Role 1",
                permissions={f"module{i}": RolePermission() for i in range(51)},
            )


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))


def _config_of_size(total: int) -> dict:
    """A config whose JSON form is exactly ``total`` bytes."""
    overhead = len(json.dumps({"k": ""}))
    return {"k": "x" * (total - overhead)}


class TestFreeFormConfigCap:
    """ONB6-30-1: the free-form config dicts had only the 60 MB request ceiling.

    ``/session/email``, ``/session/file-storage`` and ``/session/it-team``
    persist these into the session's JSON ``data`` column for a caller who
    holds only a session cookie.
    """

    def test_accepts_a_config_at_the_cap(self):
        config = _config_of_size(ONBOARDING_CONFIG_MAX_BYTES)

        assert FileStorageConfigRequest(platform="s3", config=config)
        assert EmailConfigRequest(platform="gmail", config=config)
        assert EmailTestRequest(platform="gmail", config=config)
        assert ITTeamRequest(it_team=[], backup_access=config)

    def test_rejects_a_config_over_the_cap(self):
        config = _config_of_size(ONBOARDING_CONFIG_MAX_BYTES + 1)

        with pytest.raises(ValidationError, match="too large"):
            FileStorageConfigRequest(platform="s3", config=config)
        with pytest.raises(ValidationError, match="too large"):
            EmailConfigRequest(platform="gmail", config=config)
        with pytest.raises(ValidationError, match="too large"):
            EmailTestRequest(platform="gmail", config=config)
        with pytest.raises(ValidationError, match="too large"):
            ITTeamRequest(it_team=[], backup_access=config)

    def test_a_google_service_account_key_fits(self):
        key = {"type": "service_account", "private_key": "-----BEGIN-----" + "A" * 2400}

        FileStorageConfigRequest(
            platform="googledrive", config={"googleDriveServiceAccountKey": key}
        )

    def test_no_request_model_declares_an_unbounded_dict(self):
        source = Path(__file__).parents[1] / "app/api/v1/onboarding.py"
        offenders = []
        for node in ast.parse(source.read_text()).body:
            if not (isinstance(node, ast.ClassDef) and node.name.endswith("Request")):
                continue
            for item in node.body:
                if not isinstance(item, ast.AnnAssign):
                    continue
                annotation = ast.unparse(item.annotation)
                if annotation.replace(" ", "") in (
                    "dict[str,Any]",
                    "dict",
                    "Dict[str,Any]",
                ):
                    offenders.append(f"{node.name}.{ast.unparse(item.target)}")

        assert not offenders, (
            f"These onboarding request fields are free-form dicts with no size "
            f"cap: {offenders}. Type them as BoundedConfig."
        )


class TestDuplicatePositionIds:
    """ONB6-30-3: two entries sharing one id reached a unique-slug IntegrityError.

    The id is the stored slug, unique per organization, so a payload carrying
    it twice could only ever fail at flush, as a 500.
    """

    def test_roles_with_a_repeated_id_are_refused(self):
        with pytest.raises(ValidationError, match="more than once"):
            RolesSetupRequest(roles=[_role(1), _role(1)])

    def test_positions_with_a_repeated_id_are_refused(self):
        with pytest.raises(ValidationError, match="more than once"):
            PositionsSetupRequest(positions=[_role(1), _role(2), _role(1)])

    def test_distinct_ids_are_accepted(self):
        RolesSetupRequest(roles=[_role(1), _role(2)])
        PositionsSetupRequest(positions=[_role(1), _role(2)])
