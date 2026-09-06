"""Migration 20260905_2200 narrows the org_calls call-type marker to real slugs.

Driven through a real Alembic ``MigrationContext`` against real tables, in the
manner of ``test_shift_finalization_backfill_migration.py``: the transform joins
two tables and rewrites a JSON column, so asserting it against a fake connection
would be asserting the shape of the mock.

SQLite is enough — the migration parses and writes JSON in Python and issues
plain parameterized statements. The CI matrix runs the same SQL on MySQL 8.0 and
MariaDB 10.11.
"""

import importlib.util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

# Located by suffix, not by full filename: the date prefix gets renumbered
# whenever main lands a migration claiming this one's revision id or parent.
_VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
_MATCHES = sorted(_VERSIONS.glob("*_narrow_call_type_provenance_to_slugs.py"))
assert len(_MATCHES) == 1, f"expected exactly one migration, found {_MATCHES}"
MIGRATION = _MATCHES[0]

ORG_CALLS = "org_calls"
SHIFT_CALLS = "shift_calls"


def _load_migration():
    spec = importlib.util.spec_from_file_location(
        "narrow_call_type_provenance_to_slugs", MIGRATION
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _settings(call_types):
    if call_types is None:
        return json.dumps({"scheduling": {"call_tracking": {"mode": "count_only"}}})
    return json.dumps({"scheduling": {"call_tracking": {"call_types": call_types}}})


@pytest.fixture
def engine():
    return sa.create_engine("sqlite://")


@pytest.fixture
def tables(engine):
    """The subset of the real tables the migration touches."""
    metadata = sa.MetaData()
    organizations = sa.Table(
        "organizations",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("settings", sa.Text(), nullable=True),
    )
    reports = sa.Table(
        "shift_completion_reports",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("call_types", sa.Text(), nullable=True),
        sa.Column("data_sources", sa.Text(), nullable=True),
    )
    metadata.create_all(engine)
    return {"organizations": organizations, "shift_completion_reports": reports}


def _seed(engine, table, rows):
    with engine.begin() as conn:
        for row in rows:
            conn.execute(table.insert().values(**row))


def _run(engine, direction="upgrade"):
    module = _load_migration()
    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            getattr(module, direction)()
        conn.commit()


def _marker(engine, report_id):
    with engine.connect() as conn:
        raw = conn.execute(
            sa.text("SELECT data_sources FROM shift_completion_reports WHERE id = :id"),
            {"id": report_id},
        ).scalar_one()
    return (json.loads(raw) if raw is not None else {}).get("call_types")


def _sources(engine, report_id):
    with engine.connect() as conn:
        raw = conn.execute(
            sa.text("SELECT data_sources FROM shift_completion_reports WHERE id = :id"),
            {"id": report_id},
        ).scalar_one()
    return json.loads(raw) if raw is not None else None


def _seed_org(engine, tables, org_id="org1", call_types=None):
    _seed(
        engine,
        tables["organizations"],
        [{"id": org_id, "settings": _settings(call_types)}],
    )


def _seed_report(
    engine,
    tables,
    report_id="r1",
    org_id="org1",
    call_types=None,
    sources=None,
    marker=ORG_CALLS,
):
    if sources is None:
        sources = {"call_types": marker} if marker is not None else {}
    _seed(
        engine,
        tables["shift_completion_reports"],
        [
            {
                "id": report_id,
                "organization_id": org_id,
                "call_types": (None if call_types is None else json.dumps(call_types)),
                "data_sources": json.dumps(sources),
            }
        ],
    )


class TestFreeTextLosesTheMarker:
    def test_officer_typed_incident_text_is_reverted(self, engine, tables):
        """The scenario the backfill's sibling-row evidence could not exclude:
        a detailed-mode report whose shift was later re-finalized under
        count-only tracking, manufacturing org_call_responses rows."""
        _seed_org(engine, tables)
        _seed_report(engine, tables, call_types=["Structure Fire", "MVA w/ entrapment"])

        _run(engine)

        assert _marker(engine, "r1") == SHIFT_CALLS

    def test_one_bad_value_reverts_the_whole_list(self, engine, tables):
        """The marker describes the array, not individual entries, and a reader
        acts on it for every value in the list."""
        _seed_org(engine, tables)
        _seed_report(engine, tables, call_types=["fire", "Structure Fire"])

        _run(engine)

        assert _marker(engine, "r1") == SHIFT_CALLS

    def test_a_non_string_entry_is_not_a_slug(self, engine, tables):
        _seed_org(engine, tables)
        _seed_report(engine, tables, call_types=["fire", 7])

        _run(engine)

        assert _marker(engine, "r1") == SHIFT_CALLS

    def test_the_rest_of_data_sources_is_carried_through(self, engine, tables):
        _seed_org(engine, tables)
        _seed_report(
            engine,
            tables,
            call_types=["Structure Fire"],
            sources={
                "call_types": ORG_CALLS,
                "calls_responded": "shift_calls",
                "hours_on_shift": "shift_attendance",
            },
        )

        _run(engine)

        assert _sources(engine, "r1") == {
            "call_types": SHIFT_CALLS,
            "calls_responded": "shift_calls",
            "hours_on_shift": "shift_attendance",
        }


class TestRealSlugsKeepTheMarker:
    def test_a_built_in_default_is_a_slug(self, engine, tables):
        """An organization that never materialized a list ran on the built-in
        nine, and its reports were written under those slugs."""
        _seed_org(engine, tables)
        _seed_report(engine, tables, call_types=["fire", "mutual_aid"])

        _run(engine)

        assert _marker(engine, "r1") == ORG_CALLS

    def test_a_configured_slug_is_a_slug(self, engine, tables):
        _seed_org(
            engine,
            tables,
            call_types=[{"slug": "brush", "label": "Brush Fire"}],
        )
        _seed_report(engine, tables, call_types=["brush"])

        _run(engine)

        assert _marker(engine, "r1") == ORG_CALLS

    def test_a_default_survives_after_the_org_materialized_its_own_list(
        self, engine, tables
    ):
        """Reports filed before the department customized its list were written
        under the defaults. Comparing against the stored list alone would revert
        them for a change made afterwards."""
        _seed_org(
            engine,
            tables,
            call_types=[{"slug": "brush", "label": "Brush Fire"}],
        )
        _seed_report(engine, tables, call_types=["mutual_aid"])

        _run(engine)

        assert _marker(engine, "r1") == ORG_CALLS

    def test_a_retired_type_is_still_configured(self, engine, tables):
        """Retirement takes a type off the close-out screen; it stays in the
        list precisely so its history keeps resolving."""
        _seed_org(
            engine,
            tables,
            call_types=[{"slug": "brush", "label": "Brush Fire", "active": False}],
        )
        _seed_report(engine, tables, call_types=["brush"])

        _run(engine)

        assert _marker(engine, "r1") == ORG_CALLS

    def test_an_empty_list_claims_nothing_and_is_left_alone(self, engine, tables):
        _seed_org(engine, tables)
        _seed_report(engine, tables, call_types=[])

        _run(engine)

        assert _marker(engine, "r1") == ORG_CALLS


class TestOrgScoping:
    def test_another_departments_slug_does_not_qualify(self, engine, tables):
        """A slug configured by one department says nothing about another's
        report (pitfall #14)."""
        _seed_org(engine, tables, org_id="org1")
        _seed_org(
            engine,
            tables,
            org_id="org2",
            call_types=[{"slug": "brush", "label": "Brush"}],
        )
        _seed_report(
            engine, tables, report_id="r1", org_id="org1", call_types=["brush"]
        )
        _seed_report(
            engine, tables, report_id="r2", org_id="org2", call_types=["brush"]
        )

        _run(engine)

        assert _marker(engine, "r1") == SHIFT_CALLS
        assert _marker(engine, "r2") == ORG_CALLS

    def test_a_report_whose_org_row_is_missing_falls_back_to_the_defaults(
        self, engine, tables
    ):
        _seed_report(engine, tables, org_id="ghost", call_types=["fire"])

        _run(engine)

        assert _marker(engine, "r1") == ORG_CALLS


class TestNothingIsPromoted:
    def test_a_shift_calls_report_is_never_touched(self, engine, tables):
        """Only rows claiming org_calls are examined. Promoting is what the
        superseded backfill did, and is not this migration's job."""
        _seed_org(engine, tables)
        _seed_report(engine, tables, call_types=["fire"], marker=SHIFT_CALLS)

        _run(engine)

        assert _marker(engine, "r1") == SHIFT_CALLS

    def test_a_report_with_no_marker_stays_unmarked(self, engine, tables):
        """Free text, so the slug test would fail — but there is no claim to
        narrow. An officer's edit clears the key deliberately, and writing one
        back would churn a row this migration has no business touching."""
        _seed_org(engine, tables)
        _seed_report(engine, tables, call_types=["Structure Fire"], sources={})

        _run(engine)

        assert _sources(engine, "r1") == {}

    def test_a_report_with_null_call_types_is_left_alone(self, engine, tables):
        _seed_org(engine, tables)
        _seed_report(engine, tables, call_types=None)

        _run(engine)

        assert _marker(engine, "r1") == ORG_CALLS


class TestMalformedDataDoesNotFailTheUpgrade:
    @pytest.mark.parametrize(
        "settings",
        [
            None,
            "",
            "not json",
            json.dumps({"scheduling": "not a dict"}),
            json.dumps({"scheduling": {"call_tracking": "not a dict"}}),
            json.dumps({"scheduling": {"call_tracking": {"call_types": "not a list"}}}),
            json.dumps({"scheduling": {"call_tracking": {"call_types": ["bare"]}}}),
        ],
    )
    def test_a_malformed_settings_document_degrades_to_the_defaults(
        self, engine, tables, settings
    ):
        """Hand-editable JSON. Raising here would fail the upgrade for every
        organization in the database (pitfall #19)."""
        _seed(engine, tables["organizations"], [{"id": "org1", "settings": settings}])
        _seed_report(engine, tables, call_types=["fire"])

        _run(engine)

        assert _marker(engine, "r1") == ORG_CALLS

    @pytest.mark.parametrize("raw", ["not json", '"a string"', "42"])
    def test_a_malformed_data_sources_document_is_skipped(self, engine, tables, raw):
        _seed_org(engine, tables)
        _seed(
            engine,
            tables["shift_completion_reports"],
            [
                {
                    "id": "r1",
                    "organization_id": "org1",
                    "call_types": json.dumps(["Structure Fire"]),
                    "data_sources": raw,
                }
            ],
        )

        _run(engine)

        with engine.connect() as conn:
            assert (
                conn.execute(
                    sa.text(
                        "SELECT data_sources FROM shift_completion_reports "
                        "WHERE id = 'r1'"
                    )
                ).scalar_one()
                == raw
            )

    def test_malformed_call_types_lose_the_marker(self, engine, tables):
        """Unparseable stored types cannot be slugs, so the claim is unsupported."""
        _seed_org(engine, tables)
        _seed(
            engine,
            tables["shift_completion_reports"],
            [
                {
                    "id": "r1",
                    "organization_id": "org1",
                    "call_types": "not json",
                    "data_sources": json.dumps({"call_types": ORG_CALLS}),
                }
            ],
        )

        _run(engine)

        assert _marker(engine, "r1") == SHIFT_CALLS


class TestIdempotencyAndDowngrade:
    def test_a_second_run_changes_nothing(self, engine, tables):
        _seed_org(engine, tables)
        _seed_report(engine, tables, report_id="bad", call_types=["Structure Fire"])
        _seed_report(engine, tables, report_id="good", call_types=["fire"])

        _run(engine)
        after_first = (_sources(engine, "bad"), _sources(engine, "good"))
        _run(engine)

        assert (_sources(engine, "bad"), _sources(engine, "good")) == after_first

    def test_downgrade_is_a_no_op(self, engine, tables):
        """Irreversible by design: restoring the marker would re-assert a claim
        the row does not support."""
        _seed_org(engine, tables)
        _seed_report(engine, tables, call_types=["Structure Fire"])
        _run(engine)

        _run(engine, "downgrade")

        assert _marker(engine, "r1") == SHIFT_CALLS
