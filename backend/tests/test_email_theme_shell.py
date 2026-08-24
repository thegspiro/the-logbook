"""
The email shell: what ``inline_email_css`` needs to be true of ``DEFAULT_CSS``.

Gmail strips ``<style>``, so the stylesheet is re-written onto ``style=""``
attributes before a message leaves the building. The inliner's parser is
deliberately small — ``body``, ``.class`` and ``.class tag`` — and it fails
*silently*: a comment becomes part of the next selector and takes that rule
with it, a double quote closes the attribute it lands in, and a rule written
below a less specific one loses to it. None of that raises; it just arrives in
somebody's inbox looking wrong.

So these tests pin the parser's assumptions rather than the rendered pixels.
A hex can change without touching this file; the ordering and the character
set cannot.

No DB: everything here is module-level data or a pure function.
"""

import pathlib
import re

import pytest

from app.services.email_service import inline_email_css
from app.services.email_template_service import EmailTemplateService
from app.services.email_theme import (
    ACCENT_BLUE,
    ACCENT_INDIGO,
    ACCENT_RED,
    ACCENT_SLATE,
    CHIP_TINTS,
    DEFAULT_CSS,
    LAYOUTS,
    build_email_document,
    build_logo_cell,
    build_shell,
    colourway_context,
    colourway_for,
)

_DEFS = EmailTemplateService._DEFAULT_TEMPLATE_DEFS


def _style_of(html: str, pattern: str) -> str:
    """Return the ``style=""`` value of the first tag matching *pattern*."""
    tag = re.search(pattern, html)
    assert tag, f"no tag matching {pattern!r} in:\n{html}"
    style = re.search(r'style="([^"]*)"', tag.group(0))
    assert style, f"tag carries no style attribute: {tag.group(0)}"
    return style.group(1)


def _rule_pos(selector: str) -> int:
    """Offset of a rule's own declaration block in ``DEFAULT_CSS``.

    Not ``.index(selector)``: ``.lockup`` occurs first inside ``.lockup img``,
    so a plain substring search compares a rule against itself.
    """
    at = DEFAULT_CSS.find(f"\n{selector} {{")
    assert at != -1, f"no rule for {selector!r}"
    return at


def _wins(style: str, declaration: str) -> bool:
    """Is *declaration* the last value set for its property in *style*?

    The inliner concatenates rules into one attribute, so two rules that both
    set ``padding`` both appear. CSS resolves that by document order within
    the block: the last one wins.
    """
    prop = declaration.split(":", 1)[0].strip()
    values = re.findall(rf"(?:^|;)\s*{re.escape(prop)}\s*:\s*([^;]+)", style)
    assert values, f"{prop} never set in {style!r}"
    return values[-1].strip() == declaration.split(":", 1)[1].strip()


class TestDefaultCssIsInlinable:
    def test_no_comments_no_media_no_double_quotes(self):
        assert "/*" not in DEFAULT_CSS
        assert "@media" not in DEFAULT_CSS
        assert '"' not in DEFAULT_CSS

    def test_specificity_ordering_the_inliner_depends_on(self):
        # The inliner has no cascade. For two rules that hit the same element
        # the one written first is applied first and therefore ends up last in
        # the style attribute, where CSS lets it win.
        for inner, outer in [
            (".details p", ".content p"),
            (".details td", ".content td"),
            (".details th", ".content th"),
            (".details table", ".content table"),
            (".alert p", ".content p"),
            (".details p", ".details"),
            (".lockup img", ".lockup td"),
            (".lockup td", ".lockup"),
            (".header h1", ".header"),
            (".content p", ".content"),
        ]:
            assert _rule_pos(inner) < _rule_pos(outer), (
                f"{inner} must be written above {outer}, or the inliner merges "
                f"{outer} on top of it"
            )

    def test_every_selector_is_one_the_parser_understands(self):
        # Anything else is dropped without a word.
        for rule in re.finditer(r"([^{}]+)\{[^}]*\}", DEFAULT_CSS):
            selector = rule.group(1).strip()
            assert selector == "body" or re.fullmatch(
                r"\.[\w-]+(\s+\w+)?", selector
            ), f"{selector!r} is not a selector inline_email_css can parse"

    def test_no_rule_is_silently_dropped(self):
        # Every class the stylesheet defines has to survive the round trip
        # onto an element that carries it.
        classes = set(re.findall(r"^\.([\w-]+)", DEFAULT_CSS, re.M))
        markup = "".join(f'<div class="{c}">x</div>' for c in sorted(classes))
        out = inline_email_css(build_email_document("s", markup))
        for cls in sorted(classes):
            style = _style_of(out, rf'<div class="{cls}"[^>]*>')
            assert style, f".{cls} produced no inline style"


class TestPanelsBeatTheDataTable:
    """``.details`` sits inside ``.content``, and the merge is per-declaration.

    A property ``.details th`` does not name is not overridden — it is
    inherited from ``.content th``, which is the *data table* heading: grey,
    uppercase, underlined. Those neutralising declarations are load-bearing.
    """

    def _panel(self) -> str:
        body = build_shell(
            "T",
            """        <div class="details" style="border-left-color: #1d4ed8;">
            <table><tr><th>Start</th><td>Tuesday</td></tr></table>
        </div>""",
            accent=ACCENT_BLUE,
            chip="Reminder",
        )
        return inline_email_css(build_email_document("s", body))

    def test_panel_label_is_not_a_data_table_heading(self):
        style = _style_of(self._panel(), r"<th[^>]*>")
        assert _wins(style, "background-color: transparent")
        assert _wins(style, "text-transform: none")
        assert _wins(style, "border-bottom: none")
        assert _wins(style, "font-weight: 400")

    def test_panel_row_has_no_separator_rule(self):
        style = _style_of(self._panel(), r"<td(?![^>]*logomark)[^>]*>Tuesday")
        assert _wins(style, "border-bottom: none")
        assert _wins(style, "padding: 0 0 12px 0")

    def test_panel_table_does_not_carry_the_content_margin(self):
        style = _style_of(self._panel(), r"<table(?![^>]*lockup)[^>]*>")
        assert _wins(style, "margin: 0")

    def test_fineprint_beats_the_body_paragraph(self):
        body = build_shell("T", '        <p class="fineprint">Small.</p>')
        out = inline_email_css(build_email_document("s", body))
        style = _style_of(out, r'<p class="fineprint"[^>]*>')
        assert _wins(style, "font-size: 13px")
        assert _wins(style, "color: #64748b")


class TestBuildShell:
    def test_the_accent_reaches_all_four_elements_as_one_token(self):
        # Four places, one variable. A body that named the colour four times
        # is a body that can disagree with itself three ways.
        body = build_shell(
            "T",
            '        <div class="details" style="border-left-color: {accent};">d</div>\n'
            '        <p><a href="#" class="button" style="background-color: {accent};">Go</a></p>',
            accent=ACCENT_BLUE,
            chip="Reminder",
        )
        assert "border-top-color: {{header_accent}}" in body
        assert 'color: {{header_accent}};">{{status_chip}}' in body
        assert "border-left-color: {{header_accent}}" in body
        assert "background-color: {{header_accent}}" in body
        assert "background-color: {{chip_tint}}" in body
        # And no hex anywhere, or the column could not be authoritative.
        assert ACCENT_BLUE not in body

    def test_chip_tint_is_looked_up_never_passed(self):
        # The two halves of a colourway cannot disagree, because only one of
        # them is ever supplied.
        for accent, tint in CHIP_TINTS.items():
            assert colourway_context(accent, "Chip") == {
                "header_accent": accent,
                "chip_tint": tint,
                "status_chip": "Chip",
            }

    def test_unknown_accent_falls_back_to_the_slate_tint(self):
        # Reads as deliberate rather than broken. wrap_email_body callers
        # pass hexes that are not ACCENT_* constants, so this path is live.
        assert colourway_context("#123456", "")["chip_tint"] == CHIP_TINTS[ACCENT_SLATE]

    def test_the_colourway_a_shell_was_built_with_is_recoverable(self):
        # What stamps a new template's columns. Without it the accent would
        # have to be restated beside markup that already implies one.
        body = build_shell("T", "        <p>x</p>", accent=ACCENT_BLUE, chip="Reminder")
        assert colourway_for(body) == {
            "accent": ACCENT_BLUE,
            "chip": "Reminder",
            "layout": "notice",
        }
        assert colourway_for("a body this module never built") == {}

    def test_empty_chip_and_subtitle_emit_no_markup(self):
        body = build_shell("T", "        <p>x</p>")
        assert "chip" not in body
        assert body.count("<p") == 1  # the content's paragraph, and no subline

    def test_the_old_centred_logo_block_is_gone(self):
        body = build_shell("T", "        <p>x</p>")
        assert '<div class="logo">' not in body
        assert "{{organization_logo_cell}}" in body

    def test_exactly_one_header_and_one_content(self):
        body = build_shell("T", "        <p>x</p>", accent=ACCENT_RED, chip="Chip")
        assert body.count('class="header"') == 1
        assert body.count('class="content"') == 1
        assert body.count("{{footer_html}}") == 1


class TestLogoCell:
    def test_a_department_without_a_logo_leads_with_its_name(self):
        # An empty cell would render as a 36px white box with a border and
        # nothing in it, which is worse than no cell at all.
        assert build_logo_cell("", "Falls Church") == ""

    def test_data_uris_are_skipped(self):
        # They embed the whole payload and push the message past Gmail's
        # 102 KB clipping threshold.
        assert build_logo_cell("data:image/png;base64,AAAA", "X") == ""

    def test_the_lockup_size_is_the_one_that_applies(self):
        # The legacy {{organization_logo_img}} ships a hard-coded 72px, and an
        # element that arrives already sized cannot be talked down by the
        # stylesheet — the inliner merges a class rule *behind* what the tag
        # carries. Building the cell here is what makes 36px stick.
        cell = build_logo_cell("https://example.test/logo.png", "Falls Church")
        assert "max-width:36px" in cell
        assert "max-height:36px" in cell
        assert "72px" not in cell

    def test_url_and_name_are_escaped(self):
        cell = build_logo_cell('https://x/"><script>', "<b>Org</b>")
        assert "<script>" not in cell
        assert "<b>" not in cell
        assert cell.count('"') == cell.count('="') * 2


class TestEveryTemplateRendersIntoTheShell:
    """The regression loop: all ~41 notices, rendered and inlined.

    The failure this catches is a body carrying a class the stylesheet no
    longer defines. It costs nothing to write and nothing to run, and it is
    the only thing standing between a renamed class and forty emails that
    silently lose their styling — because a class with no rule does not
    error, it just arrives unstyled.
    """

    @staticmethod
    def _org():
        from types import SimpleNamespace

        return SimpleNamespace(
            name="Falls Church Volunteer Fire Department",
            logo="https://example.test/logo.png",
            phone="(703) 555-0100",
            email="info@example.test",
            website="https://example.test",
            settings={},
            physical_address_same=True,
            mailing_address_line1="1 Main St",
            mailing_city="Falls Church",
            mailing_state="VA",
            mailing_zip="22046",
            timezone="America/New_York",
        )

    @staticmethod
    def _render(defn):
        from app.models.email_template import EmailTemplate
        from app.services.email_template_service import (
            SAMPLE_CONTEXT,
            EmailTemplateService,
        )

        svc = EmailTemplateService(None)
        template = EmailTemplate(
            subject=defn["subject"],
            html_body=defn["html"],
            text_body=defn["text"],
            css_styles=None,
            footer_key=defn.get("footer"),
        )
        context = dict(SAMPLE_CONTEXT.get(defn["type"].value, {}))
        _subject, html, _text = svc.render(
            template,
            context,
            organization=TestEveryTemplateRendersIntoTheShell._org(),
        )
        return inline_email_css(html)

    @pytest.mark.parametrize("defn", _DEFS, ids=lambda d: d["type"].value)
    def test_no_body_uses_a_class_the_stylesheet_dropped(self, defn):
        defined = set(re.findall(r"^\.([\w-]+)", DEFAULT_CSS, re.M))
        used = set(re.findall(r'class="([\w-]+)"', defn["html"]))
        assert used <= defined, (
            f"{defn['type'].value} uses {sorted(used - defined)}, which "
            "DEFAULT_CSS no longer defines — those elements will send unstyled"
        )

    @pytest.mark.parametrize("defn", _DEFS, ids=lambda d: d["type"].value)
    def test_every_classed_element_survives_inlining(self, defn):
        html = self._render(defn)
        for tag in re.finditer(r'<[a-zA-Z]\w*\b[^>]*\bclass="[\w-]+"[^>]*>', html):
            assert 'style="' in tag.group(0), (
                f"{defn['type'].value}: {tag.group(0)[:90]} kept its class but "
                "got no inline style, so Gmail will render it unstyled"
            )

    @pytest.mark.parametrize("defn", _DEFS, ids=lambda d: d["type"].value)
    def test_the_shell_is_intact(self, defn):
        html = defn["html"]
        assert '<div class="logo">' not in html, "the pre-1b centred logo block"
        assert html.count('class="header"') == 1
        assert len(re.findall(r'<div class="content[\w-]*"', html)) == 1
        assert "border-top-color:" in html, "no accent rule on the header"

    @pytest.mark.parametrize("defn", _DEFS, ids=lambda d: d["type"].value)
    def test_no_placeholder_survives_the_sample_render(self, defn):
        # A {{variable}} left in the output is one SAMPLE_CONTEXT forgot, and
        # the preview is where an admin would have to notice it.
        leftover = set(re.findall(r"\{\{\s*(\w+)\s*\}\}", self._render(defn)))
        assert not leftover, f"{defn['type'].value} previews with {sorted(leftover)}"


class TestTheEditorsBlockPaletteMatchesTheShell:
    """The frontend palette may only offer blocks this stylesheet styles.

    The palette is the sanctioned answer to "what does a correct body look
    like", so it is the one place a wrong class does real damage: an admin
    who inserts a block has every reason to believe it works. And a class
    with no rule does not error — it arrives in somebody's inbox unstyled,
    with nothing to notice at the moment the mistake is made.

    Reading a TypeScript file from a Python test is unusual, and deliberate:
    the alternative is two lists of class names in two languages that nobody
    diffs.
    """

    BLOCKS = (
        pathlib.Path(__file__).resolve().parents[2]
        / "frontend"
        / "src"
        / "modules"
        / "communications"
        / "constants"
        / "blocks.ts"
    )

    def _source(self) -> str:
        if not self.BLOCKS.exists():
            pytest.skip(f"{self.BLOCKS} not present in this checkout")
        return self.BLOCKS.read_text()

    def test_every_class_the_palette_inserts_is_defined(self):
        defined = set(re.findall(r"^\.([\w-]+)", DEFAULT_CSS, re.M))
        used = set(re.findall(r"class=\\?[\"']([\w-]+)", self._source()))
        assert used, "found no class attributes — has the file's shape changed?"
        assert used <= defined, (
            f"the block palette offers {sorted(used - defined)}, which "
            "DEFAULT_CSS does not define"
        )

    def test_the_palette_offers_a_block_for_each_shell_feature(self):
        # Not an exhaustive list — the point is that the three that carry the
        # accent, and are therefore the three hardest to hand-write
        # correctly, are all reachable without typing a tag.
        source = self._source()
        for needed in ("details", "button", "alert"):
            assert f"id: '{needed}'" in source, f"no {needed} block in the palette"


class TestIsCustomizedTracksWhatResetRestores:
    """ "Have we changed this?" is only meaningful against what Reset puts back.

    The two have to agree, so they read the same definition. Measuring
    against the body alone was the tempting shortcut and the wrong one: a
    notice whose subject line was reworded is edited, and telling an admin
    otherwise sends them looking for the change somewhere else.

    No DB — ``is_customized`` is a pure comparison against module-level data.
    """

    @staticmethod
    def _template(defn, **overrides):
        from app.models.email_template import EmailTemplate

        fields = {
            "template_type": defn["type"],
            "subject": defn["subject"],
            "html_body": defn["html"],
            "text_body": defn["text"],
            "footer_key": defn.get("footer"),
        }
        fields.update(overrides)
        return EmailTemplate(**fields)

    @pytest.fixture
    def service(self):
        from app.services.email_template_service import EmailTemplateService

        return EmailTemplateService(None)

    @pytest.mark.parametrize("defn", _DEFS, ids=lambda d: d["type"].value)
    def test_a_shipped_template_reads_as_default(self, service, defn):
        assert service.is_customized(self._template(defn)) is False

    @pytest.mark.parametrize(
        ("field", "value"),
        [
            ("subject", "Something the department wrote"),
            ("html_body", '<div class="container">edited</div>'),
            ("text_body", "edited"),
            ("footer_key", "official"),
        ],
    )
    def test_a_change_to_any_reset_field_counts(self, service, field, value):
        defn = _DEFS[0]
        # Guard against the parametrised value happening to equal the default,
        # which would make the assertion vacuous.
        assert (
            defn.get(field.replace("html_body", "html").replace("text_body", "text"))
            != value
        )
        assert service.is_customized(self._template(defn, **{field: value})) is True

    def test_a_type_with_no_default_is_customized_by_definition(self, service):
        from app.models.email_template import EmailTemplate, EmailTemplateType

        # CUSTOM is the blank slate an admin creates by hand. There is nothing
        # it could be a copy of, and no Reset that would do anything to it.
        template = EmailTemplate(
            template_type=EmailTemplateType.CUSTOM,
            subject="s",
            html_body="h",
            text_body="t",
        )
        assert service.is_customized(template) is True

    def test_reset_and_is_customized_read_the_same_definition(self, service):
        # If these ever diverge, Reset restores one thing and the badge
        # measures against another, and a freshly reset template shows as
        # Edited for reasons nobody can see.
        for defn in _DEFS:
            assert service.default_for(defn["type"]) is defn


class TestTheColourwayIsData:
    """The accent lives on the row, not baked into the markup.

    ``build_shell`` leaves ``{{header_accent}}`` / ``{{chip_tint}}`` /
    ``{{status_chip}}`` for the renderer, which is what lets an officer
    change a colourway from the screen instead of it taking a deploy. The
    invariant worth pinning is that there is exactly *one* place the colour
    comes from: a body that also carried a literal hex would have a column
    to disagree with, and the two would.
    """

    @pytest.mark.parametrize("defn", _DEFS, ids=lambda d: d["type"].value)
    def test_no_shipped_body_carries_a_literal_accent(self, defn):
        stray = set(re.findall(r"#[0-9a-fA-F]{6}", defn["html"])) & set(CHIP_TINTS)
        assert not stray, (
            f"{defn['type'].value} has {sorted(stray)} written into its markup "
            "as well as on its row; the column can no longer be authoritative"
        )

    @pytest.mark.parametrize("defn", _DEFS, ids=lambda d: d["type"].value)
    def test_every_definition_records_the_colourway_it_was_built_with(self, defn):
        assert defn.get("accent") in CHIP_TINTS, defn["type"].value
        assert defn.get("layout") in LAYOUTS, defn["type"].value

    @pytest.mark.parametrize("defn", _DEFS, ids=lambda d: d["type"].value)
    def test_a_body_with_a_chip_has_a_chip_to_put_in_it(self, defn):
        # An empty status_chip against markup that renders the pill would
        # mail a bare tinted lozenge with nothing in it.
        if "{{status_chip}}" in defn["html"]:
            assert defn.get("chip"), f"{defn['type'].value} renders an empty chip"

    def test_the_renderer_fills_every_token_it_leaves(self):
        from types import SimpleNamespace

        from app.models.email_template import EmailTemplate
        from app.services.email_template_service import EmailTemplateService

        defn = next(d for d in _DEFS if d["type"].value == "shift_assignment")
        template = EmailTemplate(
            template_type=defn["type"],
            subject=defn["subject"],
            html_body=defn["html"],
            text_body=defn["text"],
            header_accent=ACCENT_INDIGO,
            status_chip="Recoloured",
        )
        org = SimpleNamespace(
            name="Falls Church",
            logo="",
            phone="",
            email="",
            website="",
            settings={},
            physical_address_same=True,
            mailing_address_line1="",
            mailing_city="",
            mailing_state="",
            mailing_zip="",
        )
        _subject, html, _text = EmailTemplateService(None).render(template, {}, org)
        assert "{{" not in html.split("<body")[1]
        assert ACCENT_INDIGO in html
        assert CHIP_TINTS[ACCENT_INDIGO] in html
        assert "Recoloured" in html

    def test_a_row_predating_the_columns_falls_back_to_its_type(self):
        # NULL means "use what this type ships with", never "no colour". A
        # resolver that defaulted to blank would mail a style attribute
        # reading `border-top-color: ;` to every organization on upgrade.
        from types import SimpleNamespace

        from app.models.email_template import EmailTemplate
        from app.services.email_template_service import EmailTemplateService

        defn = next(d for d in _DEFS if d["type"].value == "shift_assignment")
        template = EmailTemplate(
            template_type=defn["type"],
            subject=defn["subject"],
            html_body=defn["html"],
            text_body=defn["text"],
            header_accent=None,
            status_chip=None,
        )
        org = SimpleNamespace(
            name="Falls Church",
            logo="",
            phone="",
            email="",
            website="",
            settings={},
            physical_address_same=True,
            mailing_address_line1="",
            mailing_city="",
            mailing_state="",
            mailing_zip="",
        )
        _subject, html, _text = EmailTemplateService(None).render(template, {}, org)
        assert defn["accent"] in html
        assert defn["chip"] in html

    def test_recolouring_does_not_count_as_editing_the_wording(self):
        # Reset restores the colour, because Reset means "what we ship". But
        # calling a recoloured notice "Edited" would send an admin looking
        # through the body for a change that is not in there.
        from app.models.email_template import EmailTemplate
        from app.services.email_template_service import EmailTemplateService

        defn = _DEFS[0]
        template = EmailTemplate(
            template_type=defn["type"],
            subject=defn["subject"],
            html_body=defn["html"],
            text_body=defn["text"],
            footer_key=defn.get("footer"),
            header_accent=ACCENT_INDIGO,
            status_chip="Something else",
        )
        assert EmailTemplateService(None).is_customized(template) is False

    def test_every_layout_has_a_content_class_the_stylesheet_defines(self):
        defined = set(re.findall(r"^\.([\w-]+)", DEFAULT_CSS, re.M))
        for layout in LAYOUTS:
            shell = build_shell("T", "        <p>x</p>", layout=layout)
            used = set(re.findall(r'<div class="(content[\w-]*)"', shell))
            assert used, f"{layout} produced no content div"
            assert used <= defined, f"{layout} uses undefined {sorted(used - defined)}"

    def test_an_unknown_layout_is_refused_rather_than_rendered_unstyled(self):
        with pytest.raises(ValueError, match="unknown layout"):
            build_shell("T", "        <p>x</p>", layout="fancy")

    def test_the_frontend_offers_exactly_the_accents_the_api_accepts(self):
        blocks = TestTheEditorsBlockPaletteMatchesTheShell.BLOCKS
        if not blocks.exists():
            pytest.skip("frontend not present in this checkout")
        source = blocks.read_text()
        offered = dict(
            re.findall(r"\{ accent: '(#[0-9a-f]{6})', tint: '(#[0-9a-f]{6})'", source)
        )
        assert offered, "found no colourways — has the file's shape changed?"
        assert offered == CHIP_TINTS, (
            "the swatch row and CHIP_TINTS disagree; a swatch the API rejects "
            "is a 422 an admin has no way to interpret"
        )

    def test_the_frontend_offers_exactly_the_layouts_the_api_accepts(self):
        blocks = TestTheEditorsBlockPaletteMatchesTheShell.BLOCKS
        if not blocks.exists():
            pytest.skip("frontend not present in this checkout")
        offered = re.findall(r"\{ id: '(\w+)', label: '\w+', hint:", blocks.read_text())
        assert tuple(offered) == LAYOUTS


class TestTheColourwayMigrationConvertsWhatItClaimsTo:
    """Every shipped body has a pre-upgrade form the migration recognises.

    The migration only rewrites a body still byte-identical to a shipped
    default, and reconstructs that form from the current constants. If the
    reconstruction is wrong the query matches nothing — silently. Nothing
    fails, nothing logs, and the result is a department whose untouched
    notices are all newly badged "Edited" with no accent on their rows.

    So this walks the same function the migration uses and asserts it can
    account for every default. It cannot catch a body written before the
    release that introduced the tokens — that one is genuinely edited
    relative to what we ship, and saying so is correct.
    """

    @pytest.fixture(scope="class")
    @classmethod
    def migration(cls):
        import importlib.util

        path = (
            pathlib.Path(__file__).resolve().parents[1]
            / "alembic"
            / "versions"
            / "20260823_1200_e7c4a913b8d2_email_template_colourway.py"
        )
        if not path.exists():
            pytest.skip("migration not present in this checkout")
        spec = importlib.util.spec_from_file_location("colourway_migration", path)
        assert spec is not None
        assert spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_the_frozen_tint_map_still_matches_the_live_one(self, migration):
        # A migration keeps transforming rows the way it did the day it ran,
        # so it holds its own copy. Drift is allowed — this asserts the copy
        # was correct *at the time*, which is what makes the reconstruction
        # sound. If CHIP_TINTS legitimately changes, this test is the record
        # of it and gets an explicit exception, not a quiet edit.
        assert migration._CHIP_TINTS == CHIP_TINTS

    @pytest.mark.parametrize("defn", _DEFS, ids=lambda d: d["type"].value)
    def test_a_reconstructed_form_is_the_token_form_with_hexes_in(
        self, migration, defn
    ):
        accent = defn.get("accent")
        if not accent:
            pytest.skip("no shipped colourway")
        first = migration._previous_forms(defn, accent, defn.get("chip", ""))[0]
        assert "{{header_accent}}" not in first
        assert "{{chip_tint}}" not in first
        assert "{{status_chip}}" not in first
        assert accent in first
        # And converting it back is the identity, which is what makes the
        # downgrade honest rather than approximate.
        restored = first.replace(CHIP_TINTS[accent], "{{chip_tint}}").replace(
            accent, "{{header_accent}}"
        )
        if defn.get("chip"):
            restored = restored.replace(defn["chip"], "{{status_chip}}", 1)
        assert restored == defn["html"]

    @pytest.mark.parametrize("defn", _DEFS, ids=lambda d: d["type"].value)
    def test_a_relayout_notice_is_still_recognised(self, migration, defn):
        # Four notices changed layout in the same release. Their stored
        # bodies say class="content", so a reconstruction that only offered
        # the new class would leave exactly those four behind.
        accent = defn.get("accent")
        if not accent:
            pytest.skip("no shipped colourway")
        forms = migration._previous_forms(defn, accent, defn.get("chip", ""))
        if defn.get("layout", "notice") != "notice":
            assert len(forms) == 2, "no class=content candidate for a relaid-out notice"
            assert '<div class="content">' in forms[1]
        else:
            assert len(forms) == 1


class TestSavingATemplateWritesWhatWasSent:
    """A PUT has to persist what the editor sent, including a cleared field.

    Two ways this went wrong at once, and both are silent — the endpoint
    answers 200 either way and the screen shows a success toast, so the only
    symptom is the change not being there the next time somebody looks.
    """

    @pytest.fixture
    async def template(self, db_session, sample_org_data):
        from app.models.email_template import EmailTemplate, EmailTemplateType
        from app.models.user import Organization

        org = Organization(**sample_org_data)
        db_session.add(org)
        await db_session.flush()

        defn = next(d for d in _DEFS if d["type"] == EmailTemplateType.WELCOME)
        row = EmailTemplate(
            organization_id=org.id,
            template_type=defn["type"],
            name=defn["name"],
            subject=defn["subject"],
            html_body=defn["html"],
            text_body=defn["text"],
            header_accent=defn["accent"],
            status_chip=defn["chip"],
            layout=defn["layout"],
            default_cc=["chief@example.test"],
        )
        db_session.add(row)
        await db_session.flush()
        return row

    async def test_the_colourway_columns_can_actually_be_saved(
        self, db_session, template
    ):
        # The editor writes these and the schema accepts them; if the service
        # does not list them as writable the whole control is inert, and
        # nothing anywhere says so.
        from app.services.email_template_service import EmailTemplateService

        service = EmailTemplateService(db_session)
        await service.update_template(
            template_id=template.id,
            organization_id=template.organization_id,
            header_accent=ACCENT_INDIGO,
            status_chip="Recoloured",
            layout="digest",
        )
        await db_session.refresh(template)
        assert template.header_accent == ACCENT_INDIGO
        assert template.status_chip == "Recoloured"
        assert template.layout == "digest"

    async def test_clearing_a_field_persists_the_clear(self, db_session, template):
        # `if value is not None` collapses "absent" and "explicitly null" into
        # one case. The user empties the CC box, the browser sends null to say
        # so, and the old address keeps receiving every copy.
        from app.services.email_template_service import EmailTemplateService

        service = EmailTemplateService(db_session)
        await service.update_template(
            template_id=template.id,
            organization_id=template.organization_id,
            default_cc=None,
        )
        await db_session.refresh(template)
        assert template.default_cc is None

    async def test_a_field_nobody_sent_is_left_alone(self, db_session, template):
        # The other half of the same distinction: an absent key still has to
        # mean "leave this", or every save would blank everything it omits.
        from app.services.email_template_service import EmailTemplateService

        service = EmailTemplateService(db_session)
        await service.update_template(
            template_id=template.id,
            organization_id=template.organization_id,
            subject="Reworded",
        )
        await db_session.refresh(template)
        assert template.subject == "Reworded"
        assert template.default_cc == ["chief@example.test"]
        assert template.header_accent == _DEFS[0]["accent"]

    async def test_tenancy_columns_are_not_writable_through_an_update(
        self, db_session, template
    ):
        from app.services.email_template_service import EmailTemplateService

        service = EmailTemplateService(db_session)
        await service.update_template(
            template_id=template.id,
            organization_id=template.organization_id,
            organization_id_="ignored",
            id="ignored",
        )
        await db_session.refresh(template)
        assert template.id != "ignored"
