"""``c8266855a348`` moves untouched election mail onto the W50 wording.

The W50 drive reworded the shipped ``ballot_notification`` (W50-68),
``election_rollback`` (W50-37) and ``election_report`` defaults, whose
previous text ``15c5bc7700aa`` froze. These tests pin that the revision's
previous bodies are exactly the frozen ones, that its current bodies are
exactly what ships, and that only a row still holding both frozen bodies
moves — and comes back on downgrade.
"""

import importlib.util
import pathlib

import pytest
import sqlalchemy as sa

from app.services.email_template_service import EmailTemplateService

pytestmark = pytest.mark.unit

_VERSIONS = pathlib.Path(__file__).resolve().parent.parent / "alembic" / "versions"
_SHIPPED = {d["type"].value: d for d in EmailTemplateService._DEFAULT_TEMPLATE_DEFS}


def _load(pattern: str):
    (path,) = list(_VERSIONS.glob(pattern))
    spec = importlib.util.spec_from_file_location(path.stem, path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _load("*_c8266855a348_*.py")
FREEZE = _load("*_15c5bc7700aa_*.py")
CARRIED_TYPES = sorted(MIGRATION.CARRIED)


def _engine(rows):
    engine = sa.create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                "CREATE TABLE email_templates (id TEXT PRIMARY KEY, "
                "template_type TEXT, html_body TEXT, text_body TEXT, "
                "css_styles TEXT)"
            )
        )
        for row in rows:
            conn.execute(
                sa.text(
                    "INSERT INTO email_templates VALUES "
                    "(:id, :template_type, :html_body, :text_body, :css_styles)"
                ),
                {"css_styles": None, **row},
            )
    return engine


def _run(engine, fn):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            fn()


def _bodies(engine):
    with engine.connect() as conn:
        rows = conn.execute(
            sa.text("SELECT id, html_body, text_body FROM email_templates")
        )
        return {row.id: (row.html_body, row.text_body) for row in rows}


class TestThePairs:
    def test_it_carries_exactly_the_three_reworded_types(self):
        assert CARRIED_TYPES == [
            "ballot_notification",
            "election_report",
            "election_rollback",
        ]

    @pytest.mark.parametrize("template_type", CARRIED_TYPES)
    def test_its_bodies_are_the_frozen_and_the_shipped_default(self, template_type):
        pair = MIGRATION.CARRIED[template_type]
        frozen = FREEZE.DEFAULTS[template_type]
        assert pair["previous"]["html"] == frozen["html_body"]
        assert pair["previous"]["text"] == frozen["text_body"]
        assert pair["current"]["html"] == _SHIPPED[template_type]["html"]
        assert pair["current"]["text"] == _SHIPPED[template_type]["text"]

    @pytest.mark.parametrize("template_type", CARRIED_TYPES)
    def test_each_pair_actually_differs(self, template_type):
        pair = MIGRATION.CARRIED[template_type]
        assert pair["previous"]["html"] != pair["current"]["html"]
        assert pair["previous"]["text"] != pair["current"]["text"]

    def test_the_ballot_link_is_no_longer_described_as_a_sign_in(self):
        pair = MIGRATION.CARRIED["ballot_notification"]
        assert "signs you in" in pair["previous"]["html"]
        assert "signs you in" not in pair["current"]["html"]
        assert "log you in" in pair["previous"]["text"]
        assert "log you in" not in pair["current"]["text"]
        assert "{{meeting_date_html}}" in pair["current"]["html"]
        assert "{{meeting_date_text}}" in pair["current"]["text"]


class TestTheMigration:
    def _scenario(self):
        rows = []
        for template_type in CARRIED_TYPES:
            pair = MIGRATION.CARRIED[template_type]
            previous_html = pair["previous"]["html"]
            previous_text = pair["previous"]["text"]
            rows.extend(
                [
                    {
                        "id": f"{template_type}:untouched",
                        "template_type": template_type,
                        "html_body": previous_html,
                        "text_body": previous_text,
                    },
                    {
                        "id": f"{template_type}:upper",
                        "template_type": template_type.upper(),
                        "html_body": previous_html,
                        "text_body": previous_text,
                    },
                    {
                        "id": f"{template_type}:edited-html",
                        "template_type": template_type,
                        "html_body": previous_html.replace("Hello", "Hi"),
                        "text_body": previous_text,
                    },
                    {
                        "id": f"{template_type}:edited-text",
                        "template_type": template_type,
                        "html_body": previous_html,
                        "text_body": previous_text + "\nRegards",
                    },
                    {
                        "id": f"{template_type}:own-css",
                        "template_type": template_type,
                        "html_body": previous_html,
                        "text_body": previous_text,
                        "css_styles": ".x {}",
                    },
                    {
                        "id": f"{template_type}:already-current",
                        "template_type": template_type,
                        "html_body": pair["current"]["html"],
                        "text_body": pair["current"]["text"],
                    },
                ]
            )
        rows.append(
            {
                "id": "other-type",
                "template_type": "welcome",
                "html_body": MIGRATION.CARRIED["ballot_notification"]["previous"][
                    "html"
                ],
                "text_body": MIGRATION.CARRIED["ballot_notification"]["previous"][
                    "text"
                ],
            }
        )
        return _engine(rows)

    def test_only_an_untouched_row_moves_and_it_comes_back(self):
        engine = self._scenario()
        before = _bodies(engine)
        _run(engine, MIGRATION.upgrade)
        after = _bodies(engine)
        for template_type in CARRIED_TYPES:
            current = MIGRATION.CARRIED[template_type]["current"]
            expected = (current["html"], current["text"])
            assert after[f"{template_type}:untouched"] == expected, template_type
            assert after[f"{template_type}:upper"] == expected, template_type
            assert after[f"{template_type}:already-current"] == expected
            for suffix in ("edited-html", "edited-text", "own-css"):
                row_id = f"{template_type}:{suffix}"
                assert after[row_id] == before[row_id], row_id
        assert after["other-type"] == before["other-type"]

        # A second upgrade is a no-op: the moved rows match nothing now.
        _run(engine, MIGRATION.upgrade)
        assert _bodies(engine) == after

        _run(engine, MIGRATION.downgrade)
        reverted = _bodies(engine)
        # The rows that were already current are indistinguishable from the
        # ones the upgrade moved, so the downgrade puts both back.
        for template_type in CARRIED_TYPES:
            previous = MIGRATION.CARRIED[template_type]["previous"]
            assert reverted[f"{template_type}:already-current"] == (
                previous["html"],
                previous["text"],
            )
            reverted.pop(f"{template_type}:already-current")
            before.pop(f"{template_type}:already-current")
        assert reverted == before

    def test_it_tolerates_a_database_without_the_table(self):
        engine = sa.create_engine("sqlite://")
        _run(engine, MIGRATION.upgrade)
        _run(engine, MIGRATION.downgrade)
