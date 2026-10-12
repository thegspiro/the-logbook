"""The applicant status token is not readable from the database (PP-6).

The token behind the public application-status page is a bearer credential.
It used to sit in ``prospective_members.status_token`` in plaintext and be
matched with ``=``, so a database dump or backup yielded every live link. It is
now looked up only by its SHA-256 (``status_token_hash``) and stored encrypted
for the pipeline emails that re-send it.
"""

import hashlib
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import text
from sqlalchemy.dialects import mysql
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.membership_pipeline import ProspectiveMember
from app.services.membership_pipeline_service import MembershipPipelineService


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


@pytest.mark.unit
class TestHashFollowsTheToken:
    def test_constructor_sets_the_hash(self):
        prospect = ProspectiveMember(status_token="tok_constructed")
        assert prospect.status_token_hash == _sha256("tok_constructed")

    def test_rotation_moves_the_hash(self):
        """The anonymizer rotates the token so old links die; the lookup key
        has to move with it, or the old link would still resolve."""
        prospect = ProspectiveMember(status_token="tok_old")
        prospect.status_token = "tok_new"
        assert prospect.status_token_hash == _sha256("tok_new")

    def test_clearing_the_token_clears_the_hash(self):
        prospect = ProspectiveMember(status_token="tok_old")
        prospect.status_token = None
        assert prospect.status_token_hash is None


@pytest.mark.unit
class TestLookupIsByHash:
    """Both public entry points must match on the hash, never the token."""

    @staticmethod
    def _capturing_service():
        db = MagicMock()
        result = MagicMock()
        result.scalars.return_value.first.return_value = None
        db.execute = AsyncMock(return_value=result)
        return MembershipPipelineService(db), db

    @staticmethod
    def _where_sql(db) -> tuple[str, dict]:
        stmt = db.execute.await_args.args[0]
        compiled = stmt.compile(dialect=mysql.dialect())
        return str(stmt.whereclause.compile(dialect=mysql.dialect())), dict(
            compiled.params
        )

    async def test_status_read(self):
        svc, db = self._capturing_service()
        assert await svc.get_prospect_by_token("tok_lookup_read") is None
        where, params = self._where_sql(db)
        assert "status_token_hash" in where
        assert _sha256("tok_lookup_read") in params.values()
        assert "tok_lookup_read" not in params.values()

    async def test_withdrawal(self):
        svc, db = self._capturing_service()
        assert await svc.withdraw_prospect_by_token("tok_lookup_wd") is None
        where, params = self._where_sql(db)
        assert "status_token_hash" in where
        assert _sha256("tok_lookup_wd") in params.values()
        assert "tok_lookup_wd" not in params.values()


@pytest.mark.integration
class TestStoredForm:
    async def test_database_holds_ciphertext_and_hash_only(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline = await svc.create_pipeline(
            organization_id=org_id, name="PP-6 at rest"
        )
        prospect = await svc.create_prospect(
            organization_id=org_id,
            data={
                "first_name": "Rest",
                "last_name": "Test",
                "email": "pp6-at-rest@example.com",
                "pipeline_id": pipeline.id,
            },
            created_by=admin_id,
        )
        token = prospect.status_token
        prospect_id = prospect.id
        assert token

        row = (
            await db_session.execute(
                text(
                    "SELECT status_token, status_token_hash "
                    "FROM prospective_members WHERE id = :id"
                ),
                {"id": prospect_id},
            )
        ).one()
        stored, stored_hash = row
        assert token not in stored
        assert stored_hash == _sha256(token)

        # The ORM still hands the token back for the emails that re-send it.
        db_session.expire(prospect)
        reloaded = await db_session.get(ProspectiveMember, prospect_id)
        assert reloaded.status_token == token

    async def test_a_link_sent_before_the_upgrade_still_opens(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        """A row the migration converted: the hash was computed from the old
        plaintext, so the token already in the applicant's inbox resolves."""
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline = await svc.create_pipeline(
            organization_id=org_id, name="PP-6 legacy link"
        )
        pipeline.public_status_enabled = True
        prospect = await svc.create_prospect(
            organization_id=org_id,
            data={
                "first_name": "Legacy",
                "last_name": "Link",
                "email": "pp6-legacy@example.com",
                "pipeline_id": pipeline.id,
            },
            created_by=admin_id,
        )
        legacy_token = "LegacyPlaintextToken_0123456789abcdefghijklmn"
        # The state the upgrade leaves a pre-existing row in, written raw so
        # nothing in the ORM helps it along.
        from app.core.security import encrypt_data

        await db_session.execute(
            text(
                "UPDATE prospective_members SET status_token = :enc, "
                "status_token_hash = :hash WHERE id = :id"
            ),
            {
                "enc": encrypt_data(legacy_token),
                "hash": _sha256(legacy_token),
                "id": prospect.id,
            },
        )
        await db_session.flush()
        db_session.expire_all()

        page = await svc.get_prospect_by_token(legacy_token)
        assert page is not None
        assert page["first_name"] == "Legacy"
