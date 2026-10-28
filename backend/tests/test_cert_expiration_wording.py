"""The certification reminder says when a certificate expires, in words.

The Cert Expiration template is what the reminder sends now. Its default
counted down in ``{{days_remaining}} days``, which reads "0 days left" on a
certificate's last day and "1 days" the day before. These tests pin that the
default says ``{{expires_when}}`` instead, and that ``8079ea63f119`` moves
exactly the untouched rows onto it.
"""

import importlib.util
import pathlib

import pytest
import sqlalchemy as sa

from app.models.email_template import EmailTemplateType
from app.services.cert_alert_service import _expires_when
from app.services.email_template_service import (
    SAMPLE_CONTEXT,
    EmailTemplateService,
    get_variables_for_type,
)

pytestmark = pytest.mark.unit

_VERSIONS = pathlib.Path(__file__).resolve().parent.parent / "alembic" / "versions"
_DEFAULT = next(
    d
    for d in EmailTemplateService._DEFAULT_TEMPLATE_DEFS
    if d["type"] == EmailTemplateType.CERT_EXPIRATION
)


def _load(pattern: str):
    (path,) = list(_VERSIONS.glob(pattern))
    spec = importlib.util.spec_from_file_location(path.stem, path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _load("*_8079ea63f119_*.py")
PREVIOUS_REVISION = _load("*_15c5bc7700aa_*.py")


class TestTheTemplate:
    def test_the_default_never_counts_a_bare_number_of_days(self):
        for body in (_DEFAULT["html"], _DEFAULT["text"]):
            assert "{{days_remaining}} days" not in body
            assert "{{expires_when}}" in body
        assert "{{days_unit}}" in _DEFAULT["html"]

    def test_the_variables_are_declared_and_sampled(self):
        names = {v["name"] for v in get_variables_for_type("cert_expiration")}
        assert {"expires_when", "days_unit"} <= names
        assert SAMPLE_CONTEXT["cert_expiration"]["expires_when"] == "in 45 days"
        assert SAMPLE_CONTEXT["cert_expiration"]["days_unit"] == "days"

    @pytest.mark.parametrize(
        ("days", "when", "unit"),
        [(0, "today", "days"), (1, "tomorrow", "day"), (30, "in 30 days", "days")],
    )
    def test_the_last_days_read_as_words(self, days, when, unit):
        _subject, html, text = EmailTemplateService.render_default(
            EmailTemplateType.CERT_EXPIRATION,
            {
                "recipient_name": "Dana",
                "cert_name": "EMT-B",
                "expiration_date": "October 27, 2026",
                "days_remaining": str(days),
                "days_unit": unit,
                "expires_when": _expires_when(days),
                "renewal_url": "https://example.test/training/records",
            },
        )
        assert f"Expires {when}" in html
        assert f"({when})" in text
        assert "1 days" not in html + text
        assert "0 days left" not in html + text


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


def _rows(engine):
    with engine.connect() as conn:
        rows = conn.execute(
            sa.text("SELECT id, html_body, text_body FROM email_templates")
        )
        return {row.id: (row.html_body, row.text_body) for row in rows}


class TestTheMigration:
    def test_its_texts_are_the_previous_and_the_shipped_default(self):
        frozen = PREVIOUS_REVISION.DEFAULTS["cert_expiration"]
        assert MIGRATION.PREVIOUS_HTML == frozen["html_body"]
        assert MIGRATION.PREVIOUS_TEXT == frozen["text_body"]
        assert MIGRATION.CURRENT_HTML == _DEFAULT["html"]
        assert MIGRATION.CURRENT_TEXT == _DEFAULT["text"]

    def test_only_untouched_fields_move_and_they_come_back(self):
        old_html, old_text = MIGRATION.PREVIOUS_HTML, MIGRATION.PREVIOUS_TEXT
        engine = _engine(
            [
                {
                    "id": "untouched",
                    "template_type": "cert_expiration",
                    "html_body": old_html,
                    "text_body": old_text,
                },
                {
                    "id": "edited-html",
                    "template_type": "cert_expiration",
                    "html_body": old_html.replace("Hello", "Hi"),
                    "text_body": old_text,
                },
                {
                    "id": "own-css",
                    "template_type": "cert_expiration",
                    "html_body": old_html,
                    "text_body": old_text,
                    "css_styles": ".x {}",
                },
                {
                    "id": "other-type",
                    "template_type": "welcome",
                    "html_body": old_html,
                    "text_body": old_text,
                },
            ]
        )
        before = _rows(engine)
        _run(engine, MIGRATION.upgrade)
        after = _rows(engine)

        new = (MIGRATION.CURRENT_HTML, MIGRATION.CURRENT_TEXT)
        assert after["untouched"] == new
        # An edited body is kept; its untouched text still moves on its own.
        assert after["edited-html"] == (before["edited-html"][0], new[1])
        # A stylesheet keeps its body; the text is not styled and moves.
        assert after["own-css"] == (old_html, new[1])
        assert after["other-type"] == before["other-type"]

        _run(engine, MIGRATION.downgrade)
        assert _rows(engine) == before
