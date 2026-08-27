"""The backfill that clears the rank of existing administrative members.

The application refuses the pair on write from here on, so what this migration
covers is the rows already in the database. Left alone they would each be
corrected only by the next write that happened to touch that member, so the
roster, the reports and the shift-eligibility check would keep showing a rank
for an unpredictable subset of administrative members for an unpredictable
length of time.

The interesting half is what it leaves alone. ``membership_type`` doubles as a
free-form membership *tier* id, so most values in that column are not one of
the seven legacy classifications at all — and a backfill that read an
unrecognised value as "not operational" would strip the rank of every member on
an org-configured tier.

SQLite is enough: the migration inspects column names and issues one UPDATE,
nothing dialect-specific.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

# Located by suffix, not by full filename: the date prefix gets renumbered
# whenever main lands a migration claiming this one's revision id or parent.
_VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
_MATCHES = sorted(_VERSIONS.glob("*_clear_rank_of_administrative_members.py"))
assert len(_MATCHES) == 1, f"expected exactly one migration, found {_MATCHES}"
MIGRATION = _MATCHES[0]


def _load_migration():
    spec = importlib.util.spec_from_file_location(
        "clear_rank_of_administrative_members", MIGRATION
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _users_table(metadata: sa.MetaData, *, with_member_class: bool) -> sa.Table:
    """The subset of the real table the migration touches."""
    columns = [
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("rank", sa.String(100)),
        sa.Column("membership_type", sa.String(50)),
    ]
    if with_member_class:
        columns.append(sa.Column("member_class", sa.String(20)))
    return sa.Table("users", metadata, *columns)


@pytest.fixture
def engine():
    return sa.create_engine("sqlite://")


@pytest.fixture
def users(engine):
    metadata = sa.MetaData()
    table = _users_table(metadata, with_member_class=True)
    table.create(engine)
    return table


def _seed(engine, rows):
    with engine.begin() as conn:
        for index, row in enumerate(rows):
            conn.execute(
                sa.text(
                    "INSERT INTO users (id, rank, membership_type, member_class) "
                    "VALUES (:id, :rank, :membership_type, :member_class)"
                ),
                {
                    "id": row.get("id", f"user-{index}"),
                    "rank": row.get("rank"),
                    "membership_type": row.get("membership_type"),
                    "member_class": row.get("member_class"),
                },
            )


def _run(engine, direction: str):
    module = _load_migration()
    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            getattr(module, direction)()
        conn.commit()


def _rank(engine, user_id: str):
    with engine.connect() as conn:
        return conn.execute(
            sa.text("SELECT rank FROM users WHERE id = :id"), {"id": user_id}
        ).scalar_one()


class TestUpgrade:
    def test_is_a_no_op_when_the_table_does_not_exist(self, engine):
        _run(engine, "upgrade")

        assert not sa.inspect(engine).has_table("users")

    def test_clears_the_rank_of_an_administrative_member(self, engine, users):
        _seed(
            engine,
            [{"id": "admin", "rank": "captain", "member_class": "administrative"}],
        )

        _run(engine, "upgrade")

        assert _rank(engine, "admin") is None

    def test_reads_the_legacy_field_when_no_class_is_recorded(self, engine, users):
        """``member_class`` is NULL until somebody writes the member's row.

        Every database upgraded into the class/status split starts that way, so
        keying only on ``member_class`` would make the backfill a no-op on
        exactly the installs that need it.
        """
        _seed(
            engine,
            [{"id": "legacy", "rank": "captain", "membership_type": "administrative"}],
        )

        _run(engine, "upgrade")

        assert _rank(engine, "legacy") is None

    def test_the_class_wins_over_the_legacy_field(self, engine, users):
        # `split_membership_type` says the pair is the authority whenever the
        # two disagree, and the derivation back to the legacy value is lossy —
        # an administrative probationer reads as plain "probationary" there.
        _seed(
            engine,
            [
                {
                    "id": "probationary-treasurer",
                    "rank": "captain",
                    "member_class": "administrative",
                    "membership_type": "probationary",
                }
            ],
        )

        _run(engine, "upgrade")

        assert _rank(engine, "probationary-treasurer") is None

    def test_an_operational_member_keeps_their_rank(self, engine, users):
        _seed(
            engine,
            [
                {
                    "id": "rider",
                    "rank": "captain",
                    "member_class": "operational",
                    "membership_type": "active",
                }
            ],
        )

        _run(engine, "upgrade")

        assert _rank(engine, "rider") == "captain"

    def test_a_custom_membership_tier_keeps_their_rank(self, engine, users):
        """The case the predicate is shaped around.

        "senior" is a shipped default in ``membership_tiers`` and is written
        straight into ``membership_type`` by the tier endpoint. It is not one of
        the seven legacy values, and reading "not administrative" out of that is
        the only safe answer — the alternative strips ranks from members whose
        department merely configured its own tiers.
        """
        _seed(
            engine, [{"id": "senior", "rank": "captain", "membership_type": "senior"}]
        )

        _run(engine, "upgrade")

        assert _rank(engine, "senior") == "captain"

    def test_a_social_member_keeps_their_rank(self, engine, users):
        _seed(
            engine,
            [{"id": "honorary", "rank": "captain", "member_class": "social"}],
        )

        _run(engine, "upgrade")

        assert _rank(engine, "honorary") == "captain"

    def test_case_and_whitespace_are_tolerated(self, engine, users):
        # Neither column has ever been constrained, and both have been written
        # by importers as well as by the app.
        _seed(
            engine,
            [{"id": "shouty", "rank": "captain", "member_class": "  Administrative "}],
        )

        _run(engine, "upgrade")

        assert _rank(engine, "shouty") is None

    def test_is_idempotent(self, engine, users):
        _seed(
            engine,
            [
                {"id": "admin", "rank": "captain", "member_class": "administrative"},
                {"id": "rider", "rank": "captain", "member_class": "operational"},
            ],
        )

        _run(engine, "upgrade")
        _run(engine, "upgrade")

        assert _rank(engine, "admin") is None
        assert _rank(engine, "rider") == "captain"

    def test_runs_on_a_database_predating_the_class_column(self, engine):
        """`member_class` arrived with the split; older databases lack it.

        Referencing it unconditionally would abort the upgrade with a SQL error
        on exactly those installs.
        """
        metadata = sa.MetaData()
        _users_table(metadata, with_member_class=False).create(engine)
        with engine.begin() as conn:
            conn.execute(
                sa.text(
                    "INSERT INTO users (id, rank, membership_type) "
                    "VALUES ('legacy', 'captain', 'administrative'), "
                    "('rider', 'captain', 'active')"
                )
            )

        _run(engine, "upgrade")

        assert _rank(engine, "legacy") is None
        assert _rank(engine, "rider") == "captain"


class TestDowngrade:
    def test_is_a_documented_no_op(self, engine, users):
        """Reversing it would re-grant the permissions the rank carries.

        The migration records nothing about which rows it cleared, and the
        value it removed is by definition the state the rule forbids. Pinned so
        a later "let's make it reversible" has to argue with a failing test.
        """
        _seed(
            engine,
            [{"id": "admin", "rank": "captain", "member_class": "administrative"}],
        )
        _run(engine, "upgrade")

        _run(engine, "downgrade")

        assert _rank(engine, "admin") is None
