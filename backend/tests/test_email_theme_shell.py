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
    ACCENT_RED,
    ACCENT_SLATE,
    CHIP_TINTS,
    DEFAULT_CSS,
    build_email_document,
    build_logo_cell,
    build_shell,
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
    def test_accent_reaches_all_four_elements(self):
        body = build_shell(
            "T",
            '        <div class="details" style="border-left-color: %s;">d</div>\n'
            '        <p><a href="#" class="button" style="background-color: %s;">Go</a></p>'
            % (ACCENT_BLUE, ACCENT_BLUE),
            accent=ACCENT_BLUE,
            chip="Reminder",
        )
        assert f"border-top-color: {ACCENT_BLUE}" in body
        assert f"color: {ACCENT_BLUE}" in body
        assert f"background-color: {CHIP_TINTS[ACCENT_BLUE]}" in body
        assert f"border-left-color: {ACCENT_BLUE}" in body
        assert f"background-color: {ACCENT_BLUE}" in body

    def test_chip_tint_is_looked_up_never_passed(self):
        # The two halves of a colourway cannot disagree, because only one of
        # them is an argument.
        for accent, tint in CHIP_TINTS.items():
            body = build_shell("T", "        <p>x</p>", accent=accent, chip="Chip")
            assert f"background-color: {tint}; color: {accent};" in body

    def test_unknown_accent_falls_back_to_the_slate_tint(self):
        body = build_shell("T", "        <p>x</p>", accent="#123456", chip="Chip")
        assert f"background-color: {CHIP_TINTS[ACCENT_SLATE]}" in body

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
        assert html.count('class="content"') == 1
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
