"""Migration 20260905_1900 renames a configured call type off the reserved slug.

Driven through a real Alembic ``MigrationContext`` against real tables, in the
manner of ``test_shift_finalization_backfill_migration.py`` — the transform
reads and rewrites three of them, so asserting it against a fake connection
would be asserting the shape of the mock.

SQLite is enough: the migration reads and writes JSON in Python and issues
plain parameterized UPDATEs, nothing dialect-specific. The CI matrix runs the
same statements on MySQL 8.0 and MariaDB 10.11.
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
_MATCHES = sorted(_VERSIONS.glob("*_rename_reserved_call_type_slug.py"))
assert len(_MATCHES) == 1, f"expected exactly one migration, found {_MATCHES}"
MIGRATION = _MATCHES[0]

RESERVED = "unclassified"


def _load_migration():
    spec = importlib.util.spec_from_file_location(
        "rename_reserved_call_type_slug", MIGRATION
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _settings(call_types, extra=None):
    document = {"scheduling": {"call_tracking": {"mode": "count_only"}}}
    if call_types is not None:
        document["scheduling"]["call_tracking"]["call_types"] = call_types
    if extra:
        document.update(extra)
    return json.dumps(document)


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
    org_calls = sa.Table(
        "org_calls",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("call_type", sa.String(50), nullable=True),
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
    return {
        "organizations": organizations,
        "org_calls": org_calls,
        "shift_completion_reports": reports,
    }


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


def _stored_types(engine, org_id):
    with engine.connect() as conn:
        raw = conn.execute(
            sa.text("SELECT settings FROM organizations WHERE id = :id"),
            {"id": org_id},
        ).scalar_one()
    return json.loads(raw)["scheduling"]["call_tracking"]["call_types"]


def _call_types(engine, org_id):
    with engine.connect() as conn:
        rows = conn.execute(
            sa.text(
                "SELECT call_type FROM org_calls WHERE organization_id = :id "
                "ORDER BY id"
            ),
            {"id": org_id},
        ).fetchall()
    return [row[0] for row in rows]


def _report_types(engine, report_id):
    with engine.connect() as conn:
        raw = conn.execute(
            sa.text("SELECT call_types FROM shift_completion_reports WHERE id = :id"),
            {"id": report_id},
        ).scalar_one()
    return json.loads(raw)


def _seed_affected_org(engine, tables, label="Fire Police", calls=2):
    _seed(
        engine,
        tables["organizations"],
        [
            {
                "id": "org1",
                "settings": _settings(
                    [
                        {"slug": "fire", "label": "Fire"},
                        {"slug": RESERVED, "label": label},
                    ]
                ),
            }
        ],
    )
    _seed(
        engine,
        tables["org_calls"],
        [
            {"id": f"c{i}", "organization_id": "org1", "call_type": RESERVED}
            for i in range(calls)
        ]
        + [{"id": "cf", "organization_id": "org1", "call_type": "fire"}],
    )


class TestTheReservedEntryIsRenamed:
    def test_the_new_slug_comes_from_the_departments_own_label(self, engine, tables):
        _seed_affected_org(engine, tables)

        _run(engine)

        assert _stored_types(engine, "org1") == [
            {"slug": "fire", "label": "Fire"},
            # The label is kept verbatim; only the storage key changes.
            {"slug": "fire_police", "label": "Fire Police"},
        ]

    def test_the_calls_filed_under_it_move_with_it(self, engine, tables):
        _seed_affected_org(engine, tables)

        _run(engine)

        assert _call_types(engine, "org1") == [
            "fire_police",
            "fire_police",
            # An unrelated type is not touched.
            "fire",
        ]

    def test_a_genuinely_untyped_call_stays_untyped(self, engine, tables):
        """NULL is the remainder and is not this department's type."""
        _seed_affected_org(engine, tables)
        _seed(
            engine,
            tables["org_calls"],
            [{"id": "cn", "organization_id": "org1", "call_type": None}],
        )

        _run(engine)

        with engine.connect() as conn:
            assert (
                conn.execute(
                    sa.text("SELECT call_type FROM org_calls WHERE id = 'cn'")
                ).scalar_one()
                is None
            )

    def test_an_unslugifiable_label_falls_back(self, engine, tables):
        _seed_affected_org(engine, tables, label="???")

        _run(engine)

        assert _stored_types(engine, "org1")[1]["slug"] == "unclassified_type"
        assert _call_types(engine, "org1")[0] == "unclassified_type"

    def test_a_label_that_slugifies_back_to_the_reserved_slug_falls_back(
        self, engine, tables
    ):
        """Otherwise the repair writes the very value it exists to remove."""
        _seed_affected_org(engine, tables, label="Unclassified")

        _run(engine)

        assert _stored_types(engine, "org1")[1]["slug"] == "unclassified_type"

    def test_the_rest_of_the_settings_document_is_carried_through(self, engine, tables):
        _seed(
            engine,
            tables["organizations"],
            [
                {
                    "id": "org1",
                    "settings": _settings(
                        [{"slug": RESERVED, "label": "Fire Police"}],
                        extra={"modules": {"events": True}},
                    ),
                }
            ],
        )

        _run(engine)

        with engine.connect() as conn:
            stored = json.loads(
                conn.execute(
                    sa.text("SELECT settings FROM organizations WHERE id = 'org1'")
                ).scalar_one()
            )
        assert stored["modules"] == {"events": True}
        assert stored["scheduling"]["call_tracking"]["mode"] == "count_only"


class TestTheReplacementNeverMergesTwoHistories:
    def test_it_avoids_a_slug_another_configured_entry_holds(self, engine, tables):
        _seed(
            engine,
            tables["organizations"],
            [
                {
                    "id": "org1",
                    "settings": _settings(
                        [
                            {"slug": "fire_police", "label": "Fire Police (old)"},
                            {"slug": RESERVED, "label": "Fire Police"},
                        ]
                    ),
                }
            ],
        )

        _run(engine)

        assert _stored_types(engine, "org1")[1]["slug"] == "unclassified_type"

    def test_it_avoids_a_slug_only_the_call_history_holds(self, engine, tables):
        """A type deleted from settings still owns its calls; renaming into it
        would silently merge two distinct histories into one bucket."""
        _seed(
            engine,
            tables["organizations"],
            [
                {
                    "id": "org1",
                    "settings": _settings([{"slug": RESERVED, "label": "Fire Police"}]),
                }
            ],
        )
        _seed(
            engine,
            tables["org_calls"],
            [
                {"id": "c1", "organization_id": "org1", "call_type": "fire_police"},
                {"id": "c2", "organization_id": "org1", "call_type": RESERVED},
            ],
        )

        _run(engine)

        assert _stored_types(engine, "org1")[0]["slug"] == "unclassified_type"
        assert _call_types(engine, "org1") == ["fire_police", "unclassified_type"]

    def test_it_avoids_a_slug_only_a_filed_report_holds(self, engine, tables):
        _seed(
            engine,
            tables["organizations"],
            [
                {
                    "id": "org1",
                    "settings": _settings([{"slug": RESERVED, "label": "Fire Police"}]),
                }
            ],
        )
        _seed(
            engine,
            tables["shift_completion_reports"],
            [
                {
                    "id": "r1",
                    "organization_id": "org1",
                    "call_types": json.dumps(["fire_police"]),
                    "data_sources": json.dumps({"call_types": "org_calls"}),
                }
            ],
        )

        _run(engine)

        assert _stored_types(engine, "org1")[0]["slug"] == "unclassified_type"

    def test_numbered_variants_are_tried_in_turn(self, engine, tables):
        _seed(
            engine,
            tables["organizations"],
            [
                {
                    "id": "org1",
                    "settings": _settings(
                        [
                            {"slug": "unclassified_type", "label": "Taken"},
                            {"slug": "unclassified_type_2", "label": "Also taken"},
                            {"slug": RESERVED, "label": "???"},
                        ]
                    ),
                }
            ],
        )

        _run(engine)

        assert _stored_types(engine, "org1")[2]["slug"] == "unclassified_type_3"


class TestReportSnapshots:
    def _seed_report(self, engine, tables, provenance, values):
        _seed(
            engine,
            tables["organizations"],
            [
                {
                    "id": "org1",
                    "settings": _settings([{"slug": RESERVED, "label": "Fire Police"}]),
                }
            ],
        )
        _seed(
            engine,
            tables["shift_completion_reports"],
            [
                {
                    "id": "r1",
                    "organization_id": "org1",
                    "call_types": json.dumps(values),
                    "data_sources": json.dumps({"call_types": provenance}),
                }
            ],
        )

    def test_a_snapshot_of_org_slugs_is_rewritten(self, engine, tables):
        self._seed_report(engine, tables, "org_calls", ["fire", RESERVED])

        _run(engine)

        assert _report_types(engine, "r1") == ["fire", "fire_police"]

    def test_incident_text_is_left_alone(self, engine, tables):
        """Under shift_calls provenance the column holds what an officer typed.
        The word is prose there, not this department's slug."""
        self._seed_report(engine, tables, "shift_calls", ["unclassified"])

        _run(engine)

        assert _report_types(engine, "r1") == ["unclassified"]

    def test_a_report_without_provenance_is_left_alone(self, engine, tables):
        """A report filed before provenance was recorded is treated as verbatim
        text, which is what it rendered as before labels existed."""
        _seed(
            engine,
            tables["organizations"],
            [
                {
                    "id": "org1",
                    "settings": _settings([{"slug": RESERVED, "label": "Fire Police"}]),
                }
            ],
        )
        _seed(
            engine,
            tables["shift_completion_reports"],
            [
                {
                    "id": "r1",
                    "organization_id": "org1",
                    "call_types": json.dumps([RESERVED]),
                    "data_sources": None,
                }
            ],
        )

        _run(engine)

        assert _report_types(engine, "r1") == [RESERVED]

    def test_another_orgs_report_is_left_alone(self, engine, tables):
        self._seed_report(engine, tables, "org_calls", [RESERVED])
        _seed(
            engine,
            tables["shift_completion_reports"],
            [
                {
                    "id": "r2",
                    "organization_id": "org2",
                    "call_types": json.dumps([RESERVED]),
                    "data_sources": json.dumps({"call_types": "org_calls"}),
                }
            ],
        )

        _run(engine)

        assert _report_types(engine, "r2") == [RESERVED]


class TestOrganizationsLeftAlone:
    def test_an_org_without_the_reserved_entry(self, engine, tables):
        _seed(
            engine,
            tables["organizations"],
            [
                {
                    "id": "org1",
                    "settings": _settings([{"slug": "fire", "label": "Fire"}]),
                }
            ],
        )

        _run(engine)

        assert _stored_types(engine, "org1") == [{"slug": "fire", "label": "Fire"}]

    def test_calls_are_not_renamed_without_a_configured_entry(self, engine, tables):
        """The label is gone, so there is nothing to restore. Renaming would
        turn today's "Not categorised" into a raw orphan slug on the report."""
        _seed(
            engine,
            tables["organizations"],
            [
                {
                    "id": "org1",
                    "settings": _settings([{"slug": "fire", "label": "Fire"}]),
                }
            ],
        )
        _seed(
            engine,
            tables["org_calls"],
            [{"id": "c1", "organization_id": "org1", "call_type": RESERVED}],
        )

        _run(engine)

        assert _call_types(engine, "org1") == [RESERVED]

    def test_another_orgs_calls_are_not_renamed(self, engine, tables):
        _seed_affected_org(engine, tables, calls=1)
        _seed(
            engine,
            tables["org_calls"],
            [{"id": "other", "organization_id": "org2", "call_type": RESERVED}],
        )

        _run(engine)

        assert _call_types(engine, "org2") == [RESERVED]

    @pytest.mark.parametrize(
        "settings",
        [
            None,
            "",
            "not json",
            json.dumps({"scheduling": "not a dict"}),
            json.dumps({"scheduling": {"call_tracking": "not a dict"}}),
            json.dumps({"scheduling": {"call_tracking": {"call_types": "not a list"}}}),
            json.dumps({"scheduling": {"call_tracking": {"call_types": []}}}),
            json.dumps({"scheduling": {"call_tracking": {"call_types": ["bare"]}}}),
        ],
    )
    def test_a_malformed_settings_document_does_not_fail_the_upgrade(
        self, engine, tables, settings
    ):
        """This is hand-editable JSON. Raising here takes out the whole upgrade
        for every organization in the database (pitfall #19)."""
        _seed(engine, tables["organizations"], [{"id": "org1", "settings": settings}])

        _run(engine)


class TestIdempotencyAndDowngrade:
    def test_a_second_run_changes_nothing(self, engine, tables):
        _seed_affected_org(engine, tables)

        _run(engine)
        after_first = (_stored_types(engine, "org1"), _call_types(engine, "org1"))
        _run(engine)

        assert (
            _stored_types(engine, "org1"),
            _call_types(engine, "org1"),
        ) == after_first

    def test_downgrade_is_a_no_op(self, engine, tables):
        """Irreversible by design: restoring the old value means writing back
        the slug the application refuses to accept and cannot display."""
        _seed_affected_org(engine, tables)
        _run(engine)

        _run(engine, "downgrade")

        assert _stored_types(engine, "org1")[1]["slug"] == "fire_police"
        assert _call_types(engine, "org1")[0] == "fire_police"


class TestDuplicateReservedEntries:
    def test_each_gets_its_own_slug_and_only_the_first_takes_the_history(
        self, engine, tables
    ):
        """The settings reader keeps the first of duplicate slugs and has always
        ignored the rest, so only the first one's calls exist."""
        _seed(
            engine,
            tables["organizations"],
            [
                {
                    "id": "org1",
                    "settings": _settings(
                        [
                            {"slug": RESERVED, "label": "Fire Police"},
                            {"slug": RESERVED, "label": "Fire Police"},
                        ]
                    ),
                }
            ],
        )
        _seed(
            engine,
            tables["org_calls"],
            [{"id": "c1", "organization_id": "org1", "call_type": RESERVED}],
        )

        _run(engine)

        slugs = [entry["slug"] for entry in _stored_types(engine, "org1")]
        assert slugs == ["fire_police", "unclassified_type"]
        assert _call_types(engine, "org1") == ["fire_police"]
