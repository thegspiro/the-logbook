"""
``b795d1b3401b``: every untouched template reaches the current defaults.

The rows a department holds were stamped with whatever the defaults were the
day an admin first opened the Templates screen. This revision recognises every
earlier shipped version by digest and rewrites only those, field by field.
What it must never do is touch a field somebody edited — so most of these
tests are about what is left alone.

SQLite in memory: the rewrite is plain Python over the rows, so this stays in
the no-database unit job.
"""

import importlib.util
import pathlib

import pytest
import sqlalchemy as sa

from app.services.email_template_service import EmailTemplateService

pytestmark = pytest.mark.unit

_VERSIONS = pathlib.Path(__file__).resolve().parent.parent / "alembic" / "versions"


def _load(pattern: str):
    matches = list(_VERSIONS.glob(pattern))
    assert len(matches) == 1, matches
    spec = importlib.util.spec_from_file_location(matches[0].stem, matches[0])
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _load("*_b795d1b3401b_*.py")
SHELL = _load("*_f0d76814a9ab_*.py")
FEB_WELCOME = _load("20260206_0302_*.py")
FEB_RESET = _load("20260206_0303_*.py")

_DEFAULTS = {d["type"].value: d for d in EmailTemplateService._DEFAULT_TEMPLATE_DEFS}


def _engine(rows):
    engine = sa.create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                "CREATE TABLE email_templates ("
                "id TEXT PRIMARY KEY, template_type TEXT, subject TEXT, "
                "html_body TEXT, text_body TEXT, css_styles TEXT, footer_key TEXT)"
            )
        )
        for row in rows:
            values = {
                "subject": None,
                "html_body": None,
                "text_body": None,
                "css_styles": None,
                "footer_key": None,
                **row,
            }
            conn.execute(
                sa.text(
                    "INSERT INTO email_templates VALUES (:id, :template_type, "
                    ":subject, :html_body, :text_body, :css_styles, :footer_key)"
                ),
                values,
            )
    return engine


def _run(engine, fn):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            fn()


def _rows(engine) -> dict:
    with engine.connect() as conn:
        result = conn.execute(sa.text("SELECT * FROM email_templates"))
        return {row.id: row._asdict() for row in result}


class TestTheFrozenDefaults:
    def test_every_shipped_default_is_the_migrations_current(self):
        # If this fails, a default changed. Ship a new revision that knows
        # this one's CURRENT as an earlier version, and repoint this test at
        # it — otherwise rows still on today's default stay on it forever.
        for template_type, frozen in MIGRATION.CURRENT.items():
            shipped = _DEFAULTS[template_type]
            assert frozen["html"] == shipped["html"], template_type
            assert frozen["text"] == shipped["text"], template_type
            assert frozen["subject"] == shipped["subject"], template_type
            assert frozen["footer"] == shipped.get("footer"), template_type

    def test_no_current_default_is_counted_as_an_earlier_one(self):
        # A current value in the history would be rewritten to itself, which
        # is harmless, but it means the history was built wrong.
        for template_type, frozen in MIGRATION.CURRENT.items():
            for field, history in (
                ("html", MIGRATION.HTML_HISTORY),
                ("text", MIGRATION.TEXT_HISTORY),
                ("subject", MIGRATION.SUBJECT_HISTORY),
            ):
                assert MIGRATION._digest(frozen[field]) not in history.get(
                    template_type, frozenset()
                ), (template_type, field)

    def test_every_history_entry_has_a_current_to_move_to(self):
        for history in (
            MIGRATION.HTML_HISTORY,
            MIGRATION.TEXT_HISTORY,
            MIGRATION.SUBJECT_HISTORY,
        ):
            assert set(history) <= set(MIGRATION.CURRENT)


class TestEveryEarlierVersionIsRecognised:
    @pytest.mark.parametrize("template_type", sorted(SHELL.PREVIOUS_BODIES))
    def test_the_body_before_the_redesign(self, template_type):
        # f0d76814a9ab already moves these; recognising them too is what
        # makes this revision a superset rather than a second, partial rule.
        assert MIGRATION._is_earlier_default(
            MIGRATION.HTML_HISTORY,
            template_type,
            SHELL.PREVIOUS_BODIES[template_type],
        )

    def test_the_rows_the_february_migrations_wrote(self):
        for template_type, module, html, text in (
            (
                "welcome",
                FEB_WELCOME,
                FEB_WELCOME.DEFAULT_WELCOME_HTML,
                FEB_WELCOME.DEFAULT_WELCOME_TEXT,
            ),
            (
                "password_reset",
                FEB_RESET,
                FEB_RESET.DEFAULT_RESET_HTML,
                FEB_RESET.DEFAULT_RESET_TEXT,
            ),
        ):
            assert MIGRATION._is_earlier_default(
                MIGRATION.HTML_HISTORY, template_type, html
            ), module.__name__
            assert MIGRATION._is_earlier_default(
                MIGRATION.TEXT_HISTORY, template_type, text
            ), module.__name__

    def test_the_old_inline_do_not_reply_bodies_are_among_them(self):
        assert "do not reply" in FEB_WELCOME.DEFAULT_WELCOME_HTML.lower()
        assert MIGRATION._is_earlier_default(
            MIGRATION.HTML_HISTORY, "welcome", FEB_WELCOME.DEFAULT_WELCOME_HTML
        )


class TestTheRewrite:
    def _scenario(self):
        old_html = SHELL.PREVIOUS_BODIES["event_request_status"]
        feb_html = FEB_WELCOME.DEFAULT_WELCOME_HTML
        feb_text = FEB_WELCOME.DEFAULT_WELCOME_TEXT
        feb_subject = "Welcome to {{organization_name}} — Your Account is Ready"
        return _engine(
            [
                {
                    "id": "untouched",
                    "template_type": "welcome",
                    "subject": feb_subject,
                    "html_body": feb_html,
                    "text_body": feb_text,
                },
                {
                    "id": "public-notice",
                    "template_type": "event_request_status",
                    "html_body": old_html,
                },
                {
                    "id": "footer-chosen",
                    "template_type": "event_request_status",
                    "html_body": old_html,
                    "footer_key": "official",
                },
                {
                    "id": "reworded-subject",
                    "template_type": "welcome",
                    "subject": "Welcome aboard, {{first_name}}",
                    "html_body": feb_html,
                    "text_body": feb_text,
                },
                {
                    "id": "edited-body",
                    "template_type": "welcome",
                    "subject": feb_subject,
                    "html_body": feb_html.replace("Welcome", "Hello"),
                    "text_body": feb_text,
                },
                {
                    "id": "own-stylesheet",
                    "template_type": "welcome",
                    "html_body": feb_html,
                    "css_styles": ".container { color: navy; }",
                },
                {
                    "id": "another-types-body",
                    "template_type": "password_reset",
                    "html_body": feb_html,
                },
                {
                    "id": "custom",
                    "template_type": "custom",
                    "html_body": feb_html,
                },
                {
                    "id": "already-current",
                    "template_type": "welcome",
                    "subject": _DEFAULTS["welcome"]["subject"],
                    "html_body": _DEFAULTS["welcome"]["html"],
                    "text_body": _DEFAULTS["welcome"]["text"],
                },
                {"id": "empty", "template_type": "welcome"},
            ]
        )

    def test_an_untouched_row_takes_every_current_field(self):
        engine = self._scenario()
        _run(engine, MIGRATION.upgrade)
        row = _rows(engine)["untouched"]
        current = _DEFAULTS["welcome"]
        assert row["html_body"] == current["html"]
        assert row["text_body"] == current["text"]
        assert row["subject"] == current["subject"]
        assert "do not reply" not in row["html_body"].lower()
        assert "do not reply" not in row["text_body"].lower()

    def test_a_converted_public_notice_closes_with_the_public_footer(self):
        engine = self._scenario()
        _run(engine, MIGRATION.upgrade)
        rows = _rows(engine)
        assert (
            rows["public-notice"]["html_body"]
            == _DEFAULTS["event_request_status"]["html"]
        )
        assert rows["public-notice"]["footer_key"] == "public"
        # A footer somebody chose is theirs, even on a converted body.
        assert rows["footer-chosen"]["footer_key"] == "official"
        assert (
            rows["footer-chosen"]["html_body"]
            == _DEFAULTS["event_request_status"]["html"]
        )

    def test_each_field_is_judged_on_its_own(self):
        engine = self._scenario()
        before = _rows(engine)
        _run(engine, MIGRATION.upgrade)
        after = _rows(engine)

        reworded = after["reworded-subject"]
        assert reworded["subject"] == before["reworded-subject"]["subject"]
        assert reworded["html_body"] == _DEFAULTS["welcome"]["html"]

        edited = after["edited-body"]
        assert edited["html_body"] == before["edited-body"]["html_body"]
        assert edited["text_body"] == _DEFAULTS["welcome"]["text"]
        assert edited["subject"] == _DEFAULTS["welcome"]["subject"]

    def test_what_it_cannot_vouch_for_is_left_alone(self):
        engine = self._scenario()
        before = _rows(engine)
        _run(engine, MIGRATION.upgrade)
        after = _rows(engine)
        for row_id in (
            "own-stylesheet",
            "another-types-body",
            "custom",
            "already-current",
            "empty",
        ):
            assert after[row_id] == before[row_id], row_id

    def test_running_it_twice_changes_nothing_more(self):
        engine = self._scenario()
        _run(engine, MIGRATION.upgrade)
        once = _rows(engine)
        _run(engine, MIGRATION.upgrade)
        assert _rows(engine) == once

    def test_downgrade_leaves_the_rows_as_they_are(self):
        engine = self._scenario()
        _run(engine, MIGRATION.upgrade)
        upgraded = _rows(engine)
        _run(engine, MIGRATION.downgrade)
        assert _rows(engine) == upgraded


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
