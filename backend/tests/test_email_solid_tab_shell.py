"""
The solid-tab email shell (design "2b"): its blocks, its dark rendering, and
the revision that carries untouched templates onto it.

No database: the shell is pure functions over module-level data, and the
migration is exercised against SQLite in memory the same way
``test_email_template_history_migration`` exercises its predecessor.
"""

import importlib.util
import pathlib
import re
from types import SimpleNamespace

import pytest
import sqlalchemy as sa

from app.models.email_template import EmailTemplateType
from app.services.email_service import inline_email_css, wrap_email_body
from app.services.email_template_service import SAMPLE_CONTEXT, EmailTemplateService
from app.services.email_theme import (
    ACCENT_BLUE,
    ACCENT_GREEN,
    ACCENT_RED,
    ACCENT_SLATE,
    ACCENTS_ON_DARK,
    CALLOUT_KINDS,
    CHIP_TINTS,
    DARK_CSS,
    DARK_TINTS,
    DEFAULT_CSS,
    action,
    build_email_document,
    build_shell,
    callout,
    countdown_tile,
    date_tile,
    fact,
    facts,
    summary_facts,
)

pytestmark = pytest.mark.unit

_DEFS = EmailTemplateService._DEFAULT_TEMPLATE_DEFS
_DEFAULTS = {d["type"].value: d for d in _DEFS}
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


MIGRATION = _load("*_15c5bc7700aa_*.py")


def _contrast(fg: str, bg: str) -> float:
    """WCAG 2.1 relative-contrast ratio between two hex colours."""

    def luminance(colour: str) -> float:
        def channel(value: int) -> float:
            srgb = value / 255
            return srgb / 12.92 if srgb <= 0.04045 else ((srgb + 0.055) / 1.055) ** 2.4

        r, g, b = (int(colour[i : i + 2], 16) for i in (1, 3, 5))
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)

    a, b = luminance(fg), luminance(bg)
    return (max(a, b) + 0.05) / (min(a, b) + 0.05)


def _style_of(html: str, pattern: str) -> str:
    tag = re.search(pattern, html)
    assert tag, f"no tag matching {pattern!r}"
    style = re.search(r'style="([^"]*)"', tag.group(0))
    assert style, f"tag carries no style attribute: {tag.group(0)}"
    return style.group(1)


def _wins(style: str, declaration: str) -> bool:
    prop = declaration.split(":", 1)[0].strip()
    values = re.findall(rf"(?:^|;)\s*{re.escape(prop)}\s*:\s*([^;]+)", style)
    assert values, f"{prop} never set in {style!r}"
    return values[-1].strip() == declaration.split(":", 1)[1].strip()


def _org(**overrides):
    fields = dict(
        name="Northfield Volunteer Fire Company",
        logo="https://example.test/logo.png",
        phone="(555) 201-4400",
        email="office@example.test",
        website="https://example.test",
        settings={},
        physical_address_same=True,
        mailing_address_line1="PO Box 118",
        mailing_city="Northfield",
        mailing_state="PA",
        mailing_zip="19000",
        timezone="America/New_York",
    )
    fields.update(overrides)
    return SimpleNamespace(**fields)


def _inlined(content: str, **shell) -> str:
    return inline_email_css(
        build_email_document("s", build_shell("T", content, **shell))
    )


class TestTheTab:
    def test_the_note_is_written_only_when_there_is_one(self):
        assert 'class="tab-note"' not in build_shell("T", "<p>x</p>")
        body = build_shell("T", "<p>x</p>", tab_note="Due {{return_deadline}}")
        assert '<td class="tab-note">Due {{return_deadline}}</td>' in body

    def test_it_is_filled_with_the_accent_in_every_client(self):
        html = _inlined("<p>x</p>")
        tab = re.search(r'<table class="tab"[^>]*>', html)
        assert tab
        assert 'bgcolor="{{header_accent}}"' in tab.group(0)
        label = _style_of(html, r'<td class="tab-label"[^>]*>')
        assert _wins(label, "color: #ffffff")
        assert _wins(label, "text-transform: uppercase")

    @pytest.mark.parametrize("accent", sorted(CHIP_TINTS))
    def test_white_on_the_tab_clears_AA(self, accent):
        assert _contrast("#ffffff", accent) >= 4.5

    @pytest.mark.parametrize("accent", sorted(CHIP_TINTS))
    def test_the_subtitle_clears_AA_on_the_summary_tint(self, accent):
        assert _contrast("#334155", CHIP_TINTS[accent]) >= 4.5


class TestTheSummaryCard:
    def test_a_lead_tile_sits_beside_the_title(self):
        body = build_shell(
            "T", "<p>x</p>", lead=countdown_tile("{{days_remaining}}", "days")
        )
        summary = body.split('<div class="summary"', 1)[1].split("</div>", 1)[0]
        assert '<td class="summary-lead"><table class="tile-count"' in summary
        assert summary.index("summary-lead") < summary.index("<h1>")

    def test_summary_facts_go_inside_the_tinted_card(self):
        body = build_shell(
            "T",
            "<p>x</p>",
            summary=summary_facts([fact("Deadline", "{{d}}"), fact("Value", "$1")]),
        )
        summary = body.split('<div class="summary"', 1)[1].split(
            '<div class="{{content_class}}">', 1
        )[0]
        assert 'class="summary-facts"' in summary

    def test_only_the_emphasised_value_takes_the_accent(self):
        markup = summary_facts([fact("A", "1"), fact("B", "2")], emphasis=0)
        body = build_shell("T", "<p>x</p>", summary=markup)
        assert body.count('style="color: {{header_accent}};"') == 1
        assert summary_facts([fact("A", "1")]).count("{accent}") == 0

    def test_a_summary_of_three_is_refused(self):
        with pytest.raises(ValueError, match="one or two"):
            summary_facts([fact("A", "1"), fact("B", "2"), fact("C", "3")])

    def test_summary_values_do_not_take_the_subtitle_style(self):
        # .summary p sets the subtitle; a box's value is a paragraph inside
        # the same card and must name every property it overrides.
        html = _inlined("<p>x</p>", summary=summary_facts([fact("A", "1")]))
        value = _style_of(html, r'<p class="summary-fact-value"[^>]*>')
        assert _wins(value, "margin: 0")
        assert _wins(value, "font-size: 18px")
        assert _wins(value, "color: #0f172a")

    def test_the_preheader_leads_with_the_summary(self):
        body = build_shell(
            "T",
            facts([[fact("Later", "{{later}}")]]),
            summary=summary_facts([fact("Due", "{{due}}")]),
        )
        assert body.startswith('<div style="display:none;')
        assert body.split("&#847;", 1)[0].endswith(">{{due}}")

    def test_the_tiles_take_the_accent_token(self):
        assert "{accent}" in countdown_tile("3", "days")
        assert "{accent}" in date_tile("Oct", "14")
        body = build_shell("T", "<p>x</p>", lead=date_tile("Oct", "14"))
        assert "{accent}" not in body
        assert "background-color: {{header_accent}};" in body


class TestCallouts:
    def test_they_stack_under_the_body_card_and_above_the_footer(self):
        body = build_shell(
            "T", "<p>body</p>", after=callout("warning", "Heads up", "Renew.")
        )
        assert (
            body.index('<div class="{{content_class}}">')
            < body.index('<div class="callout-warning">')
            < body.index("{{footer_html}}")
        )

    def test_an_unknown_kind_is_refused(self):
        with pytest.raises(ValueError, match="unknown callout kind"):
            callout("loud", "x", "y")

    @pytest.mark.parametrize("kind", sorted(CALLOUT_KINDS))
    def test_every_kind_is_styled(self, kind):
        html = inline_email_css(
            build_email_document(
                "s", build_shell("T", "<p>x</p>", after=callout(kind, "A", "B"))
            )
        )
        for cls in (f"callout-{kind}", f"callout-title-{kind}", f"callout-text-{kind}"):
            assert _style_of(html, rf'class="{cls}"[^>]*>'), cls

    @pytest.mark.parametrize("kind", sorted(CALLOUT_KINDS))
    def test_every_kind_clears_AA_in_both_schemes(self, kind):
        surface, title, text, dark, dark_title = CALLOUT_KINDS[kind]
        assert _contrast(title, surface) >= 4.5
        assert _contrast(text, surface) >= 4.5
        assert _contrast(dark_title, dark) >= 4.5
        assert _contrast("#e5e7eb", dark) >= 4.5

    @pytest.mark.parametrize("kind", sorted(CALLOUT_KINDS))
    def test_no_callout_writes_a_colour_into_the_body(self, kind):
        # A callout's colours live in the stylesheet, keyed by its class, so
        # a stored body never carries a hex the colourway columns or the dark
        # sheet would have to fight.
        assert not re.search(r"#[0-9a-fA-F]{6}", callout(kind, "A", "B"))


class TestTheDarkRendering:
    def test_it_is_not_in_the_inlined_sheet(self):
        assert "@media" not in DEFAULT_CSS
        assert DARK_CSS.startswith("@media (prefers-color-scheme: dark) {")

    def test_every_declaration_can_beat_an_inline_style(self):
        body = DARK_CSS.split("{", 1)[1].rsplit("}", 1)[0]
        for declaration in re.findall(r"\{([^}]*)\}", body):
            for part in filter(None, (p.strip() for p in declaration.split(";"))):
                if part.startswith(("color-scheme", "supported-color-schemes")):
                    continue
                assert part.endswith("!important"), part

    @pytest.mark.parametrize("accent", sorted(CHIP_TINTS))
    def test_every_tint_has_a_dark_version(self, accent):
        assert f'.summary[style*="{CHIP_TINTS[accent]}"]' in DARK_CSS
        assert DARK_TINTS[accent] in DARK_CSS

    @pytest.mark.parametrize("accent", sorted(CHIP_TINTS))
    def test_an_emphasised_value_is_matched_at_the_end_of_its_style(self, accent):
        # A substring match would also hit the slate colour .summary p merges
        # in front of every value.
        assert f'.summary-fact-value[style$="color: {accent};"]' in DARK_CSS
        assert _contrast(ACCENTS_ON_DARK[accent], "#1c1f24") >= 4.5

    def test_the_merged_slate_does_not_decide_the_value_colour(self):
        html = _inlined(
            "<p>x</p>",
            summary=summary_facts([fact("Due", "Oct 1")], emphasis=0),
        ).replace("{{header_accent}}", ACCENT_RED)
        style = _style_of(html, r'<p class="summary-fact-value"[^>]*>')
        assert style.endswith(f"color: {ACCENT_RED};")
        assert "#334155" in style, "the case the anchored selector exists for"

    @pytest.mark.parametrize("colour", ["#f3f4f6", "#c3c8d0", "#9aa3af"])
    def test_the_neutral_text_tiers_clear_AA_on_the_card_and_page(self, colour):
        assert _contrast(colour, "#1c1f24") >= 4.5
        assert _contrast(colour, "#121417") >= 4.5

    def test_unclassed_islands_in_the_card_are_flattened(self):
        # Service-built fragments carry their own light backgrounds and no
        # class. Recolouring their text without removing those backgrounds
        # would leave light text on a light panel.
        assert ".content [style*=background]:not([class])" in DARK_CSS
        assert "background-color: transparent !important" in DARK_CSS

    def test_a_dark_block_never_reaches_a_custom_stylesheet(self):
        doc = build_email_document("s", "<p>x</p>", ".mine { color: red; }")
        assert DARK_CSS not in doc


class TestEveryDefaultRendersThroughTheShell:
    @pytest.mark.parametrize("defn", _DEFS, ids=lambda d: d["type"].value)
    def test_render_default_fills_every_token(self, defn):
        context = dict(SAMPLE_CONTEXT.get(defn["type"].value, {}))
        _subject, html, _text = EmailTemplateService.render_default(
            defn["type"], context, organization=_org()
        )
        body = html.split("<body", 1)[1]
        assert "{{" not in body, re.findall(r"\{\{\s*\w+\s*\}\}", body)
        assert "{accent}" not in body
        assert defn["accent"] in body
        assert 'class="tab"' in body

    def test_render_default_escapes_what_a_member_controls(self):
        context = dict(SAMPLE_CONTEXT["member_dropped"])
        context["member_name"] = "<script>x</script>"
        _subject, html, text = EmailTemplateService.render_default(
            EmailTemplateType.MEMBER_DROPPED, context, organization=_org()
        )
        assert "<script>x" not in html
        assert "&lt;script&gt;x" in html
        # The plain-text body is not markup and is not escaped.
        assert "<script>x</script>" in (text or "")

    def test_render_default_refuses_a_type_with_no_default(self):
        with pytest.raises(ValueError, match="no default template"):
            EmailTemplateService.render_default(EmailTemplateType.CUSTOM, {})

    def test_welcome_is_green_so_red_stays_official(self):
        assert _DEFAULTS["welcome"]["accent"] == ACCENT_GREEN
        assert _DEFAULTS["member_dropped"]["accent"] == ACCENT_RED


class TestEveryTemplateUsesTheBuiltInStylesheet:
    def test_a_stored_stylesheet_is_not_rendered(self):
        from app.models.email_template import EmailTemplate

        defn = _DEFAULTS["event_reminder"]
        template = EmailTemplate(
            template_type=defn["type"],
            subject=defn["subject"],
            html_body=defn["html"],
            text_body=defn["text"],
            css_styles=".container { color: navy; }",
        )
        _subject, html, _text = EmailTemplateService(None).render(
            template, {}, organization=_org()
        )
        assert "color: navy" not in html
        assert DEFAULT_CSS in html
        assert DARK_CSS in html

    def test_create_template_does_not_keep_a_stylesheet(self):
        import inspect

        source = inspect.getsource(EmailTemplateService.create_template)
        assert "css_styles=None," in source


class TestOneOffEmails:
    def test_the_chip_is_escaped_into_the_tab(self):
        html = wrap_email_body(
            _org(), "Alert", "<p>x</p>", header_color=ACCENT_BLUE, chip="<b>x</b>"
        )
        assert "<b>x</b>" not in html
        assert '<td class="tab-label">&lt;b&gt;x&lt;/b&gt;</td>' in html

    def test_an_unmapped_accent_gets_the_slate_tint(self):
        html = wrap_email_body(_org(), "A", "<p>x</p>", header_color="#dc2626")
        assert f"background-color: {CHIP_TINTS[ACCENT_SLATE]};" in html
        assert 'bgcolor="#dc2626"' in html

    def test_a_kit_button_resolves_inside_a_one_off(self):
        html = wrap_email_body(_org(), "A", action("https://x.test/a", "Go"))
        assert "{accent}" not in html
        assert "{{" not in html.split("<body", 1)[1]
        assert 'href="https://x.test/a"' in html


def _engine(rows):
    engine = sa.create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(sa.text("CREATE TABLE organizations (id TEXT PRIMARY KEY)"))
        conn.execute(sa.text("INSERT INTO organizations VALUES ('org-1')"))
        conn.execute(
            sa.text(
                "CREATE TABLE email_templates (id TEXT PRIMARY KEY, "
                "organization_id TEXT, template_type TEXT, name TEXT, "
                "subject TEXT, html_body TEXT, text_body TEXT, css_styles TEXT, "
                "footer_key TEXT, header_accent TEXT, status_chip TEXT, "
                "layout TEXT)"
            )
        )
        for row in rows:
            values = {
                "organization_id": "org-1",
                "name": "A template",
                **{column: None for column in MIGRATION.RESET_COLUMNS},
                **row,
            }
            conn.execute(
                sa.text(
                    "INSERT INTO email_templates VALUES (:id, :organization_id, "
                    ":template_type, :name, :subject, :html_body, :text_body, "
                    ":css_styles, :footer_key, :header_accent, :status_chip, "
                    ":layout)"
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


def _rows(engine, table="email_templates") -> dict:
    with engine.connect() as conn:
        result = conn.execute(sa.text(f"SELECT * FROM {table}"))
        return {row.id: row._asdict() for row in result}


def _current(template_type: str) -> dict:
    """A row holding exactly the new default for *template_type*."""
    return {
        name: MIGRATION.DEFAULTS[template_type][name]
        for name in MIGRATION.RESET_COLUMNS
        if name != "css_styles"
    }


class TestTheMigrationsFrozenDefaults:
    def test_every_shipped_default_is_frozen_exactly(self):
        # If this fails, a default changed without a migration to carry the
        # rows already holding this one. Ship a new revision whose previous
        # values are these, and point this test at it.
        # ba5c348d7045 carries the event reminder's body on (it gained the
        # date tile); its own test pins that the pair lines up.
        date_tile = _load("*_ba5c348d7045_*.py")
        assert set(MIGRATION.DEFAULTS) == set(_DEFAULTS)
        for template_type, frozen in MIGRATION.DEFAULTS.items():
            shipped = _DEFAULTS[template_type]
            assert frozen["subject"] == shipped["subject"], template_type
            if template_type == date_tile.TEMPLATE_TYPE:
                assert frozen["html_body"] == date_tile.PREVIOUS_BODY
                assert shipped["html"] == date_tile.CURRENT_BODY
            else:
                assert frozen["html_body"] == shipped["html"], template_type
            assert frozen["text_body"] == shipped["text"], template_type
            assert frozen["footer_key"] == shipped.get("footer"), template_type
            assert frozen["header_accent"] == shipped["accent"], template_type
            assert frozen["status_chip"] == shipped["chip"], template_type
            assert frozen["layout"] == shipped["layout"], template_type

    def test_the_backup_table_matches_the_model(self):
        from app.models.email_template import EmailTemplateBackup

        columns = set(EmailTemplateBackup.__table__.columns.keys())
        assert set(MIGRATION.RESET_COLUMNS) <= columns
        assert {"template_id", "organization_id", "reason"} <= columns
        assert EmailTemplateBackup.__tablename__ == MIGRATION.BACKUP_TABLE


class TestTheReset:
    def _scenario(self):
        return _engine(
            [
                {
                    "id": "edited",
                    "template_type": "welcome",
                    "subject": "Welcome aboard, {{first_name}}",
                    "html_body": '<div class="header"><h1>Hi</h1></div>',
                    "text_body": "Hi",
                    "header_accent": ACCENT_RED,
                    "status_chip": "Account ready",
                    "layout": "notice",
                },
                {
                    "id": "own-stylesheet",
                    "template_type": "event_reminder",
                    **_current("event_reminder"),
                    "css_styles": ".container { color: navy; }",
                },
                {
                    "id": "already-current",
                    "template_type": "event_reminder",
                    **_current("event_reminder"),
                },
                {
                    "id": "custom",
                    "template_type": "custom",
                    "subject": "Mine",
                    "html_body": "<p>Mine</p>",
                },
                {
                    "id": "upper",
                    "template_type": "PASSWORD_RESET",
                    "subject": "Old",
                    "html_body": "<p>Old</p>",
                },
            ]
        )

    def test_every_row_of_a_shipped_type_is_reset(self):
        engine = self._scenario()
        _run(engine, MIGRATION.upgrade)
        rows = _rows(engine)
        for row_id, template_type in (
            ("edited", "welcome"),
            ("own-stylesheet", "event_reminder"),
            ("upper", "password_reset"),
        ):
            for name, value in _current(template_type).items():
                assert rows[row_id][name] == value, (row_id, name)
            assert rows[row_id]["css_styles"] is None, row_id

    def test_welcome_is_green_after_the_reset(self):
        engine = self._scenario()
        _run(engine, MIGRATION.upgrade)
        assert _rows(engine)["edited"]["header_accent"] == ACCENT_GREEN

    def test_what_was_there_is_backed_up_first(self):
        engine = self._scenario()
        before = _rows(engine)
        _run(engine, MIGRATION.upgrade)
        backups = {
            row["template_id"]: row
            for row in _rows(engine, MIGRATION.BACKUP_TABLE).values()
        }
        assert set(backups) == {"edited", "own-stylesheet", "upper"}
        for template_id, backup in backups.items():
            assert backup["reason"] == MIGRATION.revision
            assert backup["organization_id"] == "org-1"
            for name in MIGRATION.RESET_COLUMNS:
                assert backup[name] == before[template_id][name], (template_id, name)

    def test_what_it_cannot_reset_or_need_not_is_left_alone(self):
        engine = self._scenario()
        before = _rows(engine)
        _run(engine, MIGRATION.upgrade)
        after = _rows(engine)
        assert after["custom"] == before["custom"]
        assert after["already-current"] == before["already-current"]

    def test_running_it_twice_changes_nothing_more(self):
        engine = self._scenario()
        _run(engine, MIGRATION.upgrade)
        once = (_rows(engine), _rows(engine, MIGRATION.BACKUP_TABLE))
        _run(engine, MIGRATION.upgrade)
        assert (_rows(engine), _rows(engine, MIGRATION.BACKUP_TABLE)) == once

    def test_downgrade_restores_every_row_and_drops_the_backups(self):
        engine = self._scenario()
        before = _rows(engine)
        _run(engine, MIGRATION.upgrade)
        _run(engine, MIGRATION.downgrade)
        assert _rows(engine) == before
        assert not sa.inspect(engine).has_table(MIGRATION.BACKUP_TABLE)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
