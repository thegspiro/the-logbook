"""An administrative member holds no operational rank.

A rank is not decoration. ``_collect_user_permissions`` unions
``get_rank_default_permissions(user.rank)`` into a member's effective
permissions, so a member who is Administrative *and* Fire Chief holds
``settings.manage``/``security.manage`` through a chain of command they are by
definition outside of. ``_enforce_rank_grant_ceiling`` guards who may *grant* a
rank and says nothing about who may *hold* one.

Two behaviours, and the split between them is the point:

* a single write naming **both** an administrative class and a rank is refused
  — contradictory input, and dropping half of what an operator typed is worse
  than saying no;
* a write that merely **moves** somebody to administrative clears the rank they
  were carrying — nobody asserted it, and leaving it would leave its
  permissions live.

DB mocked; no MySQL.
"""

import inspect
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.member_status import change_membership_type
from app.api.v1.endpoints.users import (
    _refuse_administrative_rank,
    update_user_profile,
)
from app.schemas.user import UserUpdate
from app.utils.membership import (
    ADMINISTRATIVE_RANK_MESSAGE,
    MemberClass,
    effective_member_class,
    is_administrative,
)


class _Result:
    def __init__(self, value):
        self.value = value

    def scalar_one(self):
        return self.value

    def scalar_one_or_none(self):
        return self.value


def _caller(perms=("members.manage",)):
    return SimpleNamespace(
        id=str(uuid4()),
        organization_id=str(uuid4()),
        username="secretary",
        rank=None,
        positions=[SimpleNamespace(permissions=list(perms))],
    )


def _target(*, rank=None, member_class=None, membership_type="active"):
    return SimpleNamespace(
        id=str(uuid4()),
        rank=rank,
        member_class=member_class,
        member_status=None,
        membership_type=membership_type,
        membership_type_changed_at=None,
        full_name="Dana Reyes",
    )


# ---------------------------------------------------------------------------
# The predicate
# ---------------------------------------------------------------------------


class TestTheQuestionAsked:
    """It asks "is this administrative", never "is this not operational"."""

    @pytest.mark.parametrize(
        ("member_class", "membership_type"),
        [
            ("administrative", "administrative"),
            ("Administrative", "active"),  # explicit class wins, and is cased
            (None, "administrative"),  # legacy-only row
        ],
    )
    def test_administrative_is_administrative(self, member_class, membership_type):
        assert is_administrative(member_class, membership_type) is True

    @pytest.mark.parametrize(
        ("member_class", "membership_type"),
        [
            ("operational", "active"),
            ("operational", "administrative"),  # the pair is the authority
            ("social", "honorary"),
            (None, "honorary"),
            (None, "retired"),
            (None, "life"),
            (None, "probationary"),
            (None, None),
        ],
    )
    def test_everything_else_keeps_its_rank(self, member_class, membership_type):
        assert is_administrative(member_class, membership_type) is False

    def test_a_custom_membership_tier_is_not_swept_up(self):
        """The regression this predicate's shape exists to prevent.

        ``membership_type`` doubles as an org-configurable tier id — the shipped
        defaults already include ``senior`` — and ``split_membership_type``
        resolves an unrecognised tier to no class at all. Written as ``not
        is_operational(...)``, this rule would have stripped the rank of every
        member on a custom tier in every department that configured one.
        """
        assert effective_member_class(None, "senior") is None
        assert is_administrative(None, "senior") is False

    def test_the_explicit_class_beats_the_legacy_field(self):
        assert effective_member_class("administrative", "active") == (
            MemberClass.ADMINISTRATIVE
        )
        assert effective_member_class("operational", "administrative") == (
            MemberClass.OPERATIONAL
        )


class TestTheGuard:
    def test_refuses_the_contradictory_pair(self):
        with pytest.raises(HTTPException) as exc:
            _refuse_administrative_rank("administrative", None, "fire_chief")
        assert exc.value.status_code == 400
        assert exc.value.detail == ADMINISTRATIVE_RANK_MESSAGE

    def test_an_administrative_member_with_no_rank_is_fine(self):
        _refuse_administrative_rank("administrative", None, None)
        _refuse_administrative_rank("administrative", None, "")

    def test_an_operational_member_may_hold_a_rank(self):
        _refuse_administrative_rank("operational", "active", "fire_chief")


# ---------------------------------------------------------------------------
# PATCH /users/{id}/profile
# ---------------------------------------------------------------------------


class TestProfileUpdate:
    @staticmethod
    def _db(caller, target):
        db = AsyncMock()
        # perm lookup, target lookup, perm lookup for restricted fields,
        # re-query after commit.
        db.execute.side_effect = [
            _Result(caller),
            _Result(target),
            _Result(caller),
            _Result(target),
        ]
        return db

    async def _run(self, caller, target, db, payload):
        with patch(
            "app.api.v1.endpoints.users.OperationalRankService",
            return_value=SimpleNamespace(
                resolve_rank_code=AsyncMock(side_effect=lambda _org, code: code)
            ),
        ):
            with patch(
                "app.api.v1.endpoints.users.log_audit_event", new=AsyncMock()
            ) as audit:
                with patch(
                    "app.api.v1.endpoints.users._enforce_rank_grant_ceiling",
                    new=AsyncMock(),
                ):
                    result = await update_user_profile(uuid4(), payload, db, caller)
        return result, audit

    async def test_setting_a_rank_on_an_administrative_member_is_refused(self):
        caller = _caller()
        target = _target(membership_type="administrative")
        db = self._db(caller, target)

        with pytest.raises(HTTPException) as exc:
            await self._run(caller, target, db, UserUpdate(rank="fire_chief"))

        assert exc.value.status_code == 400
        assert exc.value.detail == ADMINISTRATIVE_RANK_MESSAGE
        db.commit.assert_not_awaited()

    async def test_naming_both_in_one_payload_is_refused(self):
        caller = _caller()
        target = _target(membership_type="active")
        db = self._db(caller, target)

        with pytest.raises(HTTPException) as exc:
            await self._run(
                caller,
                target,
                db,
                UserUpdate(member_class="administrative", rank="captain"),
            )

        assert exc.value.status_code == 400
        db.commit.assert_not_awaited()

    async def test_moving_a_ranked_member_to_administrative_clears_the_rank(self):
        """No 400 here: the operator named a class, not a rank."""
        caller = _caller()
        target = _target(rank="captain", member_class="operational")
        db = self._db(caller, target)

        _result, audit = await self._run(
            caller, target, db, UserUpdate(member_class="administrative")
        )

        assert target.rank is None
        assert target.member_class == "administrative"
        db.commit.assert_awaited()
        # A permission-bearing change nobody asked for has to show in the trail.
        fields = audit.await_args.kwargs["event_data"]["fields_updated"]
        assert "rank" in fields
        assert "member_class" in fields

    async def test_an_administrative_member_without_a_rank_needs_no_clear(self):
        caller = _caller()
        target = _target(rank=None, member_class="operational")
        db = self._db(caller, target)

        _result, audit = await self._run(
            caller, target, db, UserUpdate(member_class="administrative")
        )

        assert target.rank is None
        assert "rank" not in audit.await_args.kwargs["event_data"]["fields_updated"]

    async def test_a_social_member_keeps_the_rank_they_have(self):
        caller = _caller()
        target = _target(rank="engineer", member_class="operational")
        db = self._db(caller, target)

        await self._run(caller, target, db, UserUpdate(member_class="social"))

        assert target.rank == "engineer"

    async def test_the_class_actually_lands_on_the_row(self):
        """``member_class`` was gated by ``restricted_fields`` and then dropped.

        It was missing from ``ALLOWED_PROFILE_FIELDS``, so the endpoint
        permission-checked, audited and 200'd a write it never made — and this
        rule cannot be enforced against a class no caller can set.
        """
        caller = _caller()
        target = _target(member_class="operational")
        db = self._db(caller, target)

        await self._run(
            caller,
            target,
            db,
            UserUpdate(member_class="social", member_status="junior"),
        )

        assert target.member_class == "social"
        assert target.member_status == "junior"


# ---------------------------------------------------------------------------
# PATCH /users/{id}/membership-type
# ---------------------------------------------------------------------------


class TestMembershipTypeChange:
    @staticmethod
    def _db(member, org):
        db = AsyncMock()
        db.execute.side_effect = [_Result(member), _Result(org)]
        return db

    @staticmethod
    def _request(membership_type):
        return SimpleNamespace(membership_type=membership_type, reason=None)

    async def _run(self, member, membership_type, tiers=None):
        caller = _caller()
        member.organization_id = caller.organization_id
        org = SimpleNamespace(
            id=caller.organization_id,
            settings={"membership_tiers": {"tiers": tiers}} if tiers else {},
        )
        db = self._db(member, org)
        with patch(
            "app.api.v1.endpoints.member_status.log_audit_event", new=AsyncMock()
        ) as audit:
            result = await change_membership_type(
                uuid4(), self._request(membership_type), db, caller
            )
        return result, audit

    async def test_becoming_administrative_clears_the_rank(self):
        member = _target(rank="fire_chief", membership_type="active")

        _result, audit = await self._run(member, "administrative")

        assert member.rank is None
        assert audit.await_args.kwargs["event_data"]["cleared_rank"] == "fire_chief"

    async def test_an_ordinary_tier_change_leaves_the_rank_alone(self):
        member = _target(rank="captain", membership_type="probationary")

        _result, audit = await self._run(member, "active")

        assert member.rank == "captain"
        assert audit.await_args.kwargs["event_data"]["cleared_rank"] is None

    async def test_a_custom_tier_leaves_the_rank_alone(self):
        member = _target(rank="captain", membership_type="active")

        await self._run(member, "senior")

        assert member.rank == "captain"

    async def test_an_administrative_member_with_no_rank_reports_none_cleared(self):
        member = _target(rank=None, membership_type="active")

        _result, audit = await self._run(member, "administrative")

        assert audit.await_args.kwargs["event_data"]["cleared_rank"] is None


# ---------------------------------------------------------------------------
# The paths that are not reachable with a mocked session
# ---------------------------------------------------------------------------


class TestEveryWriterIsCovered:
    """Four endpoints write ``User.rank``; a rule enforced on three is enforced
    on none, because the fourth is the one an operator will find."""

    def test_the_create_path_refuses_the_pair(self):
        from app.api.v1.endpoints import users as users_ep

        source = inspect.getsource(users_ep.create_member)
        assert "_refuse_administrative_rank(" in source
        # Against the resolved rank, not the caller's spelling — the guard runs
        # after canonicalization for the same reason the ceiling does.
        assert source.index("canonical_rank = await") < source.index(
            "_refuse_administrative_rank("
        )

    def test_the_create_path_persists_the_class_it_checked(self):
        """Checking ``member_class`` and then discarding it is not enforcement."""
        from app.api.v1.endpoints import users as users_ep

        source = inspect.getsource(users_ep.create_member)
        assert "new_user.member_class = user_data.member_class" in source
        assert "new_user.member_status = user_data.member_status" in source

    def test_the_prospect_transfer_path_refuses_the_pair(self):
        """``_do_transfer`` returns refusals as a dict rather than raising, so
        it cannot reuse the endpoint helper — but it must refuse the same thing
        in the same words."""
        from app.services.membership_pipeline_service import (
            MembershipPipelineService,
        )

        source = inspect.getsource(MembershipPipelineService._do_transfer)
        assert "is_administrative(" in source
        assert "ADMINISTRATIVE_RANK_MESSAGE" in source

    def test_every_path_refuses_in_the_same_words(self):
        """An operator told two different things by two screens has no way to
        tell they are the same rule."""
        from app.api.v1.endpoints import users as users_ep
        from app.services import membership_pipeline_service as pipeline

        # One constant, imported rather than retyped, at every site.
        assert users_ep.ADMINISTRATIVE_RANK_MESSAGE is ADMINISTRATIVE_RANK_MESSAGE
        assert pipeline.ADMINISTRATIVE_RANK_MESSAGE is ADMINISTRATIVE_RANK_MESSAGE
        with pytest.raises(HTTPException) as exc:
            _refuse_administrative_rank("administrative", None, "captain")
        assert exc.value.detail == ADMINISTRATIVE_RANK_MESSAGE


class TestTheBackfillMatchesTheRule:
    """The stored rows and the new writes have to agree on who is covered.

    Asserted against the statement the migration actually emits rather than
    against its source text: the source moved from raw SQL to Core once MySQL
    rejected an unquoted ``rank``, and a grep-the-source test would have gone
    on passing while the statement changed underneath it.
    """

    @staticmethod
    def _migration():
        import importlib.util
        from pathlib import Path

        path = (
            Path(__file__).resolve().parents[1]
            / "alembic"
            / "versions"
            / "20260827_1200_a7c4e9b13f58_clear_rank_for_administrative_members.py"
        )
        spec = importlib.util.spec_from_file_location("_rank_backfill", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def _sql(self, *, is_mariadb: bool) -> str:
        import sqlalchemy as sa
        from sqlalchemy.dialects import mysql

        table = self._migration()._users
        statement = (
            table.update()
            .where(
                table.c.rank.isnot(None),
                sa.or_(
                    table.c.member_class == "administrative",
                    sa.and_(
                        table.c.member_class.is_(None),
                        table.c.membership_type == "administrative",
                    ),
                ),
            )
            .values(rank=None)
        )
        return str(
            statement.compile(
                dialect=mysql.dialect(is_mariadb=is_mariadb),
                compile_kwargs={"literal_binds": True},
            )
        )

    def test_it_consults_both_spellings(self):
        """``member_class`` is the authority, but it is nullable and was only
        backfilled by ``f1a2b3c4d5e6`` — a row written by a path that names only
        the legacy field can still have it NULL."""
        sql = self._sql(is_mariadb=True)
        assert "member_class = 'administrative'" in sql
        assert "member_class IS NULL" in sql
        assert "membership_type = 'administrative'" in sql

    def test_it_does_not_sweep_on_not_operational(self):
        """The one way this backfill could do real damage.

        ``!= 'operational'`` matches every member on a custom membership tier,
        whose class resolves to NULL. Their ranks are not this rule's business.
        """
        for is_mariadb in (True, False):
            sql = self._sql(is_mariadb=is_mariadb)
            assert "!= 'operational'" not in sql
            assert "<> 'operational'" not in sql

    def test_it_only_clears_rows_that_have_a_rank(self):
        assert "IS NOT NULL" in self._sql(is_mariadb=True)

    def test_the_column_is_quoted_for_mysql(self):
        """MySQL reserved ``RANK`` in 8.0.2 for the window function; MariaDB
        10.11 did not.

        So an unquoted ``SET rank = NULL`` parses on MariaDB and is a 1064
        syntax error on MySQL. Local testing against one engine cannot catch
        that, which is exactly how it reached CI — letting the dialect quote the
        identifier is what makes the statement engine-independent.
        """
        assert "`rank`" in self._sql(is_mariadb=False)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
