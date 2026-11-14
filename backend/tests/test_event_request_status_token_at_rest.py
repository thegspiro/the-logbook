"""The event-request status token is not readable from the database.

The token behind the public ``/event-request/status/<token>`` page is a bearer
credential: whoever holds it can see the request and cancel it. It used to sit
in ``event_requests.status_token`` in plaintext and be matched with ``=``, so a
database dump or backup yielded every live link. It now gets the protection
the applicant status token got under PP-6 (``test_status_token_at_rest.py``):
looked up only by its SHA-256 (``status_token_hash``), and stored AES-256-GCM
encrypted for the coordinator's **Copy status link** control, which still has
to show it.
"""

import hashlib
import importlib.util
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import sqlalchemy as sa
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.dialects import mysql
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event_request import EventRequest, EventRequestStatus


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


@pytest.mark.unit
class TestHashFollowsTheToken:
    def test_a_new_request_gets_a_token_and_its_hash(self):
        """The token used to come from a column default, which runs at INSERT
        and so never passes through the hash validator. It is now issued at
        construction, so the hash exists from the start."""
        req = EventRequest(contact_name="A", description="d")
        assert req.status_token
        assert len(req.status_token) >= 40
        assert req.status_token_hash == _sha256(req.status_token)

    def test_two_requests_get_different_tokens(self):
        a = EventRequest(contact_name="A", description="d")
        b = EventRequest(contact_name="B", description="d")
        assert a.status_token != b.status_token

    def test_an_explicit_token_is_hashed(self):
        req = EventRequest(status_token="tok_explicit")
        assert req.status_token_hash == _sha256("tok_explicit")

    def test_rotation_moves_the_hash(self):
        req = EventRequest(status_token="tok_old")
        req.status_token = "tok_new"
        assert req.status_token_hash == _sha256("tok_new")

    def test_clearing_the_token_clears_the_hash(self):
        req = EventRequest(status_token="tok_old")
        req.status_token = None
        assert req.status_token_hash is None


def _capturing_db():
    db = MagicMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=result)
    return db


def _where(db) -> tuple[str, list]:
    stmt = db.execute.await_args_list[0].args[0]
    compiled = stmt.compile(dialect=mysql.dialect())
    return (
        str(stmt.whereclause.compile(dialect=mysql.dialect())),
        list(compiled.params.values()),
    )


@pytest.mark.unit
class TestPublicLookupIsByHash:
    """Both public entry points must match on the hash, never the token, and
    answer an unknown token with the same plain 404 as before."""

    async def test_status_page(self):
        from app.api.v1.endpoints.event_requests import check_request_status

        db = _capturing_db()
        with pytest.raises(HTTPException) as exc:
            await check_request_status(token="tok_status_read", db=db)
        assert exc.value.status_code == 404
        where, params = _where(db)
        assert "status_token_hash" in where
        assert _sha256("tok_status_read") in params
        assert "tok_status_read" not in params

    async def test_public_cancel(self):
        from app.api.v1.endpoints import event_requests as ep

        db = _capturing_db()
        with (
            patch.object(
                ep, "check_ip_rate_limit", AsyncMock(return_value=(True, 1, 10))
            ),
            patch.object(ep, "get_client_ip", return_value="203.0.113.9"),
        ):
            with pytest.raises(HTTPException) as exc:
                await ep.public_cancel_request(
                    token="tok_cancel",
                    data=SimpleNamespace(reason=None),
                    request=MagicMock(),
                    db=db,
                )
        assert exc.value.status_code == 404
        where, params = _where(db)
        assert "status_token_hash" in where
        assert _sha256("tok_cancel") in params
        assert "tok_cancel" not in params


async def _make_request(db_session: AsyncSession, org_id: str) -> EventRequest:
    req = EventRequest(
        organization_id=org_id,
        contact_name="Pat Requester",
        contact_email="pat@example.com",
        description="Station tour",
        status=EventRequestStatus.SUBMITTED,
    )
    db_session.add(req)
    await db_session.flush()
    return req


@pytest.mark.integration
class TestStoredForm:
    async def test_database_holds_ciphertext_and_hash_only(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _admin_id = setup_org_and_admin
        req = await _make_request(db_session, org_id)
        token, req_id = req.status_token, req.id

        stored, stored_hash = (
            await db_session.execute(
                text(
                    "SELECT status_token, status_token_hash "
                    "FROM event_requests WHERE id = :id"
                ),
                {"id": req_id},
            )
        ).one()
        assert token not in stored
        assert stored_hash == _sha256(token)

        # The ORM still hands the token back for Copy status link.
        db_session.expire_all()
        reloaded = await db_session.get(EventRequest, req_id)
        assert reloaded.status_token == token

    async def test_the_status_page_opens_by_the_token(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        from app.api.v1.endpoints.event_requests import check_request_status

        org_id, _admin_id = setup_org_and_admin
        req = await _make_request(db_session, org_id)
        page = await check_request_status(token=req.status_token, db=db_session)
        assert page.contact_name == "Pat Requester"

        with pytest.raises(HTTPException) as exc:
            await check_request_status(token=req.status_token_hash, db=db_session)
        assert exc.value.status_code == 404

    async def test_a_link_sent_before_the_upgrade_still_opens(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        """A row the migration converted: the hash was computed from the old
        plaintext, so the link a coordinator already shared still resolves."""
        from app.api.v1.endpoints.event_requests import check_request_status
        from app.core.security import encrypt_data

        org_id, _admin_id = setup_org_and_admin
        req = await _make_request(db_session, org_id)
        legacy = "LegacyEventRequestToken_0123456789abcdefghijk"
        await db_session.execute(
            text(
                "UPDATE event_requests SET status_token = :enc, "
                "status_token_hash = :hash WHERE id = :id"
            ),
            {"enc": encrypt_data(legacy), "hash": _sha256(legacy), "id": req.id},
        )
        await db_session.flush()
        db_session.expire_all()

        page = await check_request_status(token=legacy, db=db_session)
        assert page.contact_name == "Pat Requester"


# --- The migration, against rows -------------------------------------------

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
_SCRATCH = "zz_test_event_requests_token"


def _load_migration():
    matches = sorted(VERSIONS.glob("*_hash_event_request_status_token_at_rest.py"))
    assert len(matches) == 1, matches
    spec = importlib.util.spec_from_file_location("er_token_mig", matches[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module._TABLE = _SCRATCH
    return module


def _run(engine, step: str) -> None:
    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext

    module = _load_migration()
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            getattr(module, step)()


@pytest.fixture
def scratch_engine():
    from app.core.config import settings

    engine = sa.create_engine(settings.SYNC_DATABASE_URL)

    def _drop():
        with engine.begin() as conn:
            conn.execute(text(f"DROP TABLE IF EXISTS {_SCRATCH}"))

    _drop()
    yield engine
    _drop()
    engine.dispose()


# The pre-upgrade shape, as create_all built it from the old model.
_LEGACY_ROWS = {
    "r-live": "LiveLinkAlreadyShared_abcdefghijklmnopqrstuvwxyz0123",
    "r-other": "AnotherSharedLink_ZYXWVUTSRQPONMLKJIHGFEDCBA98765",
    "r-null": None,
    "r-empty": "",
}


def _make_legacy_table(engine) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                f"CREATE TABLE {_SCRATCH} (id VARCHAR(36) PRIMARY KEY, "
                "status_token VARCHAR(64) NULL) ENGINE=InnoDB"
            )
        )
        conn.execute(
            text(
                f"CREATE UNIQUE INDEX ix_{_SCRATCH}_status_token "
                f"ON {_SCRATCH} (status_token)"
            )
        )
        for row_id, token in _LEGACY_ROWS.items():
            conn.execute(
                text(f"INSERT INTO {_SCRATCH} (id, status_token) VALUES (:i, :t)"),
                {"i": row_id, "t": token},
            )


def _rows(engine) -> dict:
    with engine.begin() as conn:
        return {
            r.id: r
            for r in conn.execute(
                text(f"SELECT id, status_token, status_token_hash FROM {_SCRATCH}")
            ).fetchall()
        }


def _indexed_columns(engine) -> dict:
    return {
        tuple(ix["column_names"]): bool(ix.get("unique"))
        for ix in sa.inspect(engine).get_indexes(_SCRATCH)
    }


@pytest.mark.integration
class TestMigrationAgainstRows:
    def test_existing_tokens_are_hashed_and_encrypted_in_place(self, scratch_engine):
        from app.core.security import decrypt_data

        _make_legacy_table(scratch_engine)
        _run(scratch_engine, "upgrade")
        rows = _rows(scratch_engine)

        for row_id in ("r-live", "r-other"):
            token = _LEGACY_ROWS[row_id]
            assert token not in rows[row_id].status_token
            assert decrypt_data(rows[row_id].status_token) == token
            assert rows[row_id].status_token_hash == _sha256(token)
        assert rows["r-null"].status_token is None
        assert rows["r-null"].status_token_hash is None
        assert rows["r-empty"].status_token_hash is None

        indexes = _indexed_columns(scratch_engine)
        assert indexes.get(("status_token_hash",)) is True
        assert ("status_token",) not in indexes

    def test_running_twice_changes_nothing(self, scratch_engine):
        from app.core.security import decrypt_data

        _make_legacy_table(scratch_engine)
        _run(scratch_engine, "upgrade")
        _run(scratch_engine, "upgrade")
        row = _rows(scratch_engine)["r-live"]
        assert decrypt_data(row.status_token) == _LEGACY_ROWS["r-live"]
        assert row.status_token_hash == _sha256(_LEGACY_ROWS["r-live"])

    def test_downgrade_restores_the_plaintext_column(self, scratch_engine):
        _make_legacy_table(scratch_engine)
        _run(scratch_engine, "upgrade")
        _run(scratch_engine, "downgrade")
        with scratch_engine.begin() as conn:
            cols = {c["name"] for c in sa.inspect(conn).get_columns(_SCRATCH)}
            rows = {
                r.id: r.status_token
                for r in conn.execute(
                    text(f"SELECT id, status_token FROM {_SCRATCH}")
                ).fetchall()
            }
        assert "status_token_hash" not in cols
        assert rows["r-live"] == _LEGACY_ROWS["r-live"]
        assert _indexed_columns(scratch_engine).get(("status_token",)) is True

    def test_a_table_create_all_has_not_built_is_skipped(self, scratch_engine):
        _run(scratch_engine, "upgrade")
        assert _SCRATCH not in sa.inspect(scratch_engine).get_table_names()
