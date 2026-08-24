"""
The email template catalogue as a whole.

Every notice the platform sends is meant to be something a department can
reword, preview with realistic data, and receive looking like the rest of its
mail. Each of those three is easy to half-finish — a template type added to the
enum but never given a default body, a body using a variable nobody documented,
a computed HTML chunk that gets escaped into visible angle brackets — and each
failure is invisible until a member receives the result. These tests pin the
invariants rather than any particular wording, so they survive copy edits.

No DB: everything here is module-level data or a pure function.
"""

import re

import pytest

from app.models.email_template import EmailTemplateType
from app.services.email_service import inline_email_css
from app.services.email_template_service import (
    GLOBAL_VARIABLES,
    ORGANIZATION_FIELD_VARIABLES,
    ORGANIZATION_FIELDS_WITHOUT_VARIABLES,
    RENDERER_INJECTED_VARIABLES,
    SAMPLE_CONTEXT,
    EmailTemplateService,
    get_variables_for_type,
)
from app.services.email_theme import (
    CHIP_TINTS,
    DEFAULT_CSS,
    build_email_document,
)

_DEFS = EmailTemplateService._DEFAULT_TEMPLATE_DEFS
_REGISTERED = {d["type"] for d in _DEFS}

# CUSTOM is the blank slate for a template an admin creates by hand; it has no
# sending code and so no default body. Every other type is something the
# application sends on its own and must therefore be editable.
_NO_DEFAULT_EXPECTED = {EmailTemplateType.CUSTOM}


def _variables_used(defn: dict) -> set:
    used: set = set()
    for field in ("subject", "html", "text"):
        used |= set(re.findall(r"\{\{\s*(\w+)\s*\}\}", defn[field] or ""))
    # Injected by the renderer itself rather than by a caller.
    return used - RENDERER_INJECTED_VARIABLES


class TestEveryNoticeIsEditable:
    def test_every_template_type_has_a_default(self):
        missing = {t for t in EmailTemplateType} - _REGISTERED - _NO_DEFAULT_EXPECTED
        assert not missing, (
            "these types exist in the enum and appear in the Email Templates "
            f"screen but no row is ever created for them: {sorted(t.value for t in missing)}"
        )

    def test_no_default_is_registered_twice(self):
        types = [d["type"] for d in _DEFS]
        assert len(types) == len(set(types))

    @pytest.mark.parametrize("defn", _DEFS, ids=lambda d: d["type"].value)
    def test_default_has_all_four_parts(self, defn):
        assert defn["subject"].strip()
        assert defn["html"].strip()
        assert defn["text"].strip()
        assert defn["name"].strip()
        assert defn.get("description", "").strip()


class TestEveryVariableIsUsable:
    @pytest.mark.parametrize("defn", _DEFS, ids=lambda d: d["type"].value)
    def test_variables_are_documented(self, defn):
        """The editor's palette is this list; an omission is invisible."""
        documented = {v["name"] for v in get_variables_for_type(defn["type"].value)}
        missing = _variables_used(defn) - documented
        assert not missing, f"{defn['type'].value} does not document {sorted(missing)}"

    @pytest.mark.parametrize("defn", _DEFS, ids=lambda d: d["type"].value)
    def test_variables_have_sample_data(self, defn):
        """Otherwise the preview and the test email show blanks."""
        sample = set(SAMPLE_CONTEXT.get(defn["type"].value, {}))
        missing = _variables_used(defn) - sample
        assert not missing, f"{defn['type'].value} has no sample for {sorted(missing)}"

    @pytest.mark.parametrize("defn", _DEFS, ids=lambda d: d["type"].value)
    def test_computed_html_chunks_are_not_escaped(self, defn):
        """A ``*_html`` variable carries markup the service built.

        Left off the raw list it is HTML-escaped on the way out, and the
        recipient gets the table's angle brackets as visible text instead of
        the table. That is exactly what happened to the inventory notice's
        removed-items list and the ballot eligibility summary's recipient list.
        """
        raw = EmailTemplateService._RAW_HTML_VARIABLES
        html_vars = {v for v in _variables_used(defn) if v.endswith("_html")}
        missing = html_vars - raw
        assert not missing, (
            f"{defn['type'].value} injects {sorted(missing)} as markup but they "
            "are not in _RAW_HTML_VARIABLES, so they will be escaped"
        )


class TestEveryOrganizationFieldIsAccountedFor:
    """A department fills these in expecting them to be usable.

    The gap this closes was invisible: fax, county, founded year, EIN and the
    three department identifiers were all collected on the Organization
    Settings screen and none of them could be put in an email. The two maps
    below are a ledger — a column in neither is one nobody ruled on, and that
    is what this reports.
    """

    @staticmethod
    def _columns() -> set:
        from app.models.user import Organization

        return {column.name for column in Organization.__table__.columns}

    def test_no_column_is_left_undecided(self):
        decided = set(ORGANIZATION_FIELD_VARIABLES) | set(
            ORGANIZATION_FIELDS_WITHOUT_VARIABLES
        )
        undecided = self._columns() - decided
        assert not undecided, (
            "these Organization columns are neither offered to templates nor "
            "listed as deliberately withheld: "
            f"{sorted(undecided)} — add them to one map or the other"
        )

    def test_the_ledger_does_not_name_columns_that_are_gone(self):
        stale = (
            set(ORGANIZATION_FIELD_VARIABLES)
            | set(ORGANIZATION_FIELDS_WITHOUT_VARIABLES)
        ) - self._columns()
        assert not stale, sorted(stale)

    def test_no_column_is_in_both_maps(self):
        assert not set(ORGANIZATION_FIELD_VARIABLES) & set(
            ORGANIZATION_FIELDS_WITHOUT_VARIABLES
        )

    def test_every_offered_field_is_documented_for_the_editor(self):
        documented = {variable["name"] for variable in GLOBAL_VARIABLES}
        missing = set(ORGANIZATION_FIELD_VARIABLES.values()) - documented
        assert not missing, f"not in the editor's variable palette: {sorted(missing)}"

    def test_every_offered_field_has_sample_data(self):
        """Otherwise it previews blank and looks broken rather than empty."""
        sample = set(SAMPLE_CONTEXT["welcome"])
        missing = (
            set(ORGANIZATION_FIELD_VARIABLES.values()) - sample - {"organization_logo"}
        )
        assert not missing, sorted(missing)

    def test_a_populated_organization_fills_every_offered_variable(self):
        from types import SimpleNamespace

        organization = SimpleNamespace(
            **{column: f"value-{column}" for column in ORGANIZATION_FIELD_VARIABLES},
            identifier_type="fdid",
            organization_type="fire_ems_combined",
            settings={},
            physical_address_same=True,
            mailing_address_line1="1 Main",
            mailing_address_line2=None,
            mailing_city="Anytown",
            mailing_state="CA",
            mailing_zip="90210",
            mailing_country="USA",
        )
        context = EmailTemplateService.build_context({}, organization)
        for variable in ORGANIZATION_FIELD_VARIABLES.values():
            assert context[variable], variable
        assert context["organization_identifier"] == "value-fdid"
        assert context["organization_identifier_label"] == "FDID"
        assert context["organization_type_label"] == "Fire & EMS"


class TestAddressComposition:
    def test_the_country_is_dropped_when_it_is_the_implied_one(self):
        """Every US department's own address would otherwise gain a 'USA' line."""
        address = EmailTemplateService._format_address(
            "1 Main", None, "Anytown", "CA", "90210", "USA"
        )
        assert address.splitlines() == ["1 Main", "Anytown, CA 90210"]

    def test_a_country_that_is_not_the_implied_one_is_kept(self):
        address = EmailTemplateService._format_address(
            "1 King St", None, "Toronto", "ON", "M5H", "Canada"
        )
        assert address.splitlines()[-1] == "Canada"


class TestTheStylesheetSurvivesInlining:
    """Gmail strips ``<style>``; only what the inliner writes out survives."""

    def test_no_comments(self):
        assert "/*" not in DEFAULT_CSS

    def test_no_media_queries(self):
        assert "@media" not in DEFAULT_CSS

    def test_every_selector_is_one_the_inliner_understands(self):
        for match in re.finditer(r"([^{}]+)\{([^}]+)\}", DEFAULT_CSS):
            selector = match.group(1).strip()
            assert selector == "body" or re.fullmatch(
                r"\.[\w-]+(\s+\w+)?", selector
            ), f"{selector!r} is silently dropped by inline_email_css"

    def test_the_stylesheet_itself_uses_no_double_quotes(self):
        for match in re.finditer(r"\{([^}]+)\}", DEFAULT_CSS):
            assert '"' not in match.group(1)

    def test_a_double_quoted_value_does_not_truncate_the_attribute(self):
        """The safety net for a stylesheet an admin edited by hand.

        ``style="font-family: "Segoe UI", Arial;"`` ends the attribute at the
        second quote; the browser reads the rest as junk attributes and the
        declaration is lost. The inliner swaps the quote character, which CSS
        treats identically. A truncated attribute shows up as a value that no
        longer ends in a semicolon.
        """
        out = inline_email_css(
            build_email_document(
                "s", '<div class="x"></div>', '.x { font-family: "Segoe UI", Arial; }'
            )
        )
        tag = re.search(r"<div class=\"x\"[^>]*>", out)
        assert tag is not None
        value = re.search(r'style="([^"]*)"', tag.group(0))
        assert value is not None
        assert value.group(1).rstrip().endswith(";"), tag.group(0)
        assert "Arial" in value.group(1)


class TestInlinerScopesToTheWholeBlock:
    def test_every_paragraph_in_a_block_is_styled(self):
        """Not just the first.

        The inliner used to stop at the first closing tag inside the parent,
        so ``.content p`` reached the opening paragraph and nothing else — and
        since Gmail drops the stylesheet, that was the spacing most recipients
        saw.
        """
        html = build_email_document(
            "s",
            '<div class="content"><p>one</p><p>two</p>'
            '<div class="details"><p>three</p></div></div>',
            ".content p { margin: 0 0 16px 0; }",
        )
        out = inline_email_css(html)
        assert out.count("margin: 0 0 16px 0;") == 3

    def test_a_more_specific_rule_wins(self):
        """``.details p`` is written above ``.content p`` for this reason."""
        html = build_email_document(
            "s",
            '<div class="content"><p>a</p><div class="details"><p>b</p></div></div>',
            ".details p { color: #374151; }\n.content p { color: #1f2937; }",
        )
        out = inline_email_css(html)
        nested = re.search(r'<div class="details"[^>]*><p style="([^"]*)"', out)
        assert nested is not None
        # The later, less specific rule is merged in front, so #374151 wins.
        assert nested.group(1).rindex("#374151") > nested.group(1).rindex("#1f2937")

    def test_nested_same_tag_parents_do_not_end_the_block_early(self):
        html = build_email_document(
            "s",
            '<div class="content"><div><p>inner</p></div><p>after</p></div>',
            ".content p { margin: 0; }",
        )
        assert inline_email_css(html).count("margin: 0;") == 2


class TestAccentsAreReadable:
    """WCAG 2.1 AA (4.5:1) everywhere an accent carries text.

    1b moved the accent off the header band, so the old check — white on a
    solid header — no longer describes anything the design does. The accent
    now appears as a 5px rule (no text on it, nothing to check), as the
    button's background under white text, and as the chip's text on its own
    tint. The last one is the easy pair to get wrong: both halves are light,
    and a tint picked to look right beside a hex is not the same as a tint
    that reads under it.
    """

    @staticmethod
    def _luminance(hex_colour: str) -> float:
        def channel(value: int) -> float:
            srgb = value / 255
            return srgb / 12.92 if srgb <= 0.04045 else ((srgb + 0.055) / 1.055) ** 2.4

        r, g, b = (int(hex_colour[i : i + 2], 16) for i in (1, 3, 5))
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)

    @classmethod
    def _contrast(cls, fg: str, bg: str) -> float:
        a, b = cls._luminance(fg), cls._luminance(bg)
        lighter, darker = max(a, b), min(a, b)
        return (lighter + 0.05) / (darker + 0.05)

    def _contrast_with_white(self, hex_colour: str) -> float:
        return self._contrast("#ffffff", hex_colour)

    def test_the_header_title_reads_on_the_white_card(self):
        header_bg = re.search(
            r"\.header \{[^}]*background-color: (#[0-9a-f]{6})", DEFAULT_CSS
        )
        title_fg = re.search(r"\.header h1 \{[^}]*color: (#[0-9a-f]{6})", DEFAULT_CSS)
        assert header_bg is not None
        assert title_fg is not None
        ratio = self._contrast(title_fg.group(1), header_bg.group(1))
        assert ratio >= 4.5, f"header title is {ratio:.2f}:1"

    def test_the_default_button_carries_white_text(self):
        button = re.search(
            r"\.button \{[^}]*background-color: (#[0-9a-f]{6})", DEFAULT_CSS
        )
        assert button is not None
        assert self._contrast_with_white(button.group(1)) >= 4.5

    @pytest.mark.parametrize(("accent", "tint"), sorted(CHIP_TINTS.items()))
    def test_every_chip_reads_on_its_own_tint(self, accent, tint):
        ratio = self._contrast(accent, tint)
        assert ratio >= 4.5, f"chip {accent} on {tint} is {ratio:.2f}:1"

    @pytest.mark.parametrize("accent", sorted(CHIP_TINTS))
    def test_every_accent_carries_white_button_text(self, accent):
        ratio = self._contrast_with_white(accent)
        assert ratio >= 4.5, f"button {accent} is {ratio:.2f}:1"

    @pytest.mark.parametrize("defn", _DEFS, ids=lambda d: d["type"].value)
    def test_every_body_only_uses_accents_from_the_map(self, defn):
        """A hex typed into a body is a colourway nobody checked.

        The accent has to come from the map, because that is the only set the
        contrast tests above cover — and because a header rule and its chip
        drifting onto two different reds is exactly what the map exists to
        stop.
        """
        used = set(re.findall(r"border-top-color: (#[0-9a-f]{6})", defn["html"])) | set(
            re.findall(r"border-left-color: (#[0-9a-f]{6})", defn["html"])
        )
        stray = used - set(CHIP_TINTS)
        assert not stray, (
            f"{defn['type'].value} uses {sorted(stray)}, which is not an "
            "ACCENT_* constant"
        )

    @pytest.mark.parametrize("defn", _DEFS, ids=lambda d: d["type"].value)
    def test_chip_and_header_agree_on_the_colourway(self, defn):
        header = re.search(r"border-top-color: (#[0-9a-f]{6})", defn["html"])
        chip = re.search(
            r'class="chip" style="background-color: (#[0-9a-f]{6}); '
            r"color: (#[0-9a-f]{6});\"",
            defn["html"],
        )
        if not header or not chip:
            return
        tint, text = chip.groups()
        assert text == header.group(1), (
            f"{defn['type'].value}: chip text {text} does not match the "
            f"header accent {header.group(1)}"
        )
        assert tint == CHIP_TINTS[text], (
            f"{defn['type'].value}: chip tint {tint} is not the tint mapped "
            f"to {text}"
        )


class TestTheCodeDefaultsFillInTheOrganization:
    """The fallback path is the normal one for a new department.

    ``ensure_default_templates`` runs from the Email Templates screen and
    nowhere else, so until an admin visits it there are no template rows and
    every notice renders from the code defaults. Those defaults all carry an
    organization footer, and the fallback used to substitute nothing into it.
    """

    @staticmethod
    def _org():
        from types import SimpleNamespace

        return SimpleNamespace(
            name="Falls Church Fire & Rescue",
            logo="",
            phone="(555) 111-2222",
            email="info@example.org",
            website="https://example.org",
            settings={},
            physical_address_same=True,
            mailing_address_line1="1 Main St",
            mailing_city="Falls Church",
            mailing_state="VA",
            mailing_zip="22046",
        )

    @pytest.mark.parametrize("defn", _DEFS, ids=lambda d: d["type"].value)
    async def test_no_default_mails_a_raw_placeholder(self, defn):
        from app.services.email_service import EmailService

        svc = EmailService(organization=self._org())
        context = dict(SAMPLE_CONTEXT.get(defn["type"].value, {}))
        subject, html, text = await svc._render_with_fallback(
            template_type=defn["type"],
            context=context,
            default_subject=defn["subject"],
            default_html=defn["html"],
            default_text=defn["text"],
        )
        leftover = re.findall(r"\{\{\s*\w+\s*\}\}", subject + html + (text or ""))
        assert not leftover, f"{defn['type'].value} would mail {sorted(set(leftover))}"

    async def test_the_organization_footer_is_filled_in(self):
        from app.services.email_service import EmailService

        defn = next(d for d in _DEFS if d["type"] is EmailTemplateType.WELCOME)
        svc = EmailService(organization=self._org())
        # Only what a send site actually passes — the organization variables
        # are the renderer's job, which is the point of the test. (The sample
        # contexts carry their own, and would mask the bug.)
        _, html, text = await svc._render_with_fallback(
            template_type=defn["type"],
            context={
                "first_name": "Jo",
                "username": "jo",
                "temp_password": "x",
            },
            default_subject=defn["subject"],
            default_html=defn["html"],
            default_text=defn["text"],
        )
        assert "(555) 111-2222" in html
        assert "(555) 111-2222" in text
        # The HTML body is the only escaping destination; text/plain is not.
        assert "Falls Church Fire &amp; Rescue" in html
        assert "Falls Church Fire & Rescue" in text

    @pytest.mark.parametrize(
        ("template_type", "footer_text"),
        [
            (
                EmailTemplateType.EVENT_REQUEST_STATUS,
                "Replies to this message reach the department office.",
            ),
            (
                EmailTemplateType.MEMBER_DROPPED,
                "Please retain this notice for your records.",
            ),
        ],
    )
    async def test_code_default_uses_its_declared_footer(
        self, template_type, footer_text
    ):
        """The no-row path must honor the footer selected by the catalogue."""
        from app.services.email_service import EmailService

        defn = next(d for d in _DEFS if d["type"] is template_type)
        svc = EmailService(organization=self._org())

        _, html, text = await svc._render_with_fallback(
            template_type=template_type,
            context=dict(SAMPLE_CONTEXT[template_type.value]),
            default_subject=defn["subject"],
            default_html=defn["html"],
            default_text=defn["text"],
        )

        assert footer_text in html
        assert footer_text in text
        assert "Please do not reply to this email." not in html
        assert "Please do not reply to this email." not in text


class TestTheDocumentShell:
    def test_declares_its_encoding(self):
        """Without it Outlook decodes the em dash in most subjects as garbage."""
        assert 'charset="utf-8"' in build_email_document("s", "<p>x</p>")

    def test_escapes_the_subject_into_the_title_and_label(self):
        out = build_email_document('Chief & "Deputy"', "<p>x</p>")
        assert "&amp;" in out
        assert "<title>Chief &amp; &quot;Deputy&quot;</title>" in out or (
            "Chief &amp;" in out and 'aria-label="Chief &amp;' in out
        )


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
