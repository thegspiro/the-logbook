"""Rich-text minutes sections.

The sanitizer and its consumers need no database; the HTTP behaviour (what is
stored, what blocks circulation, that an approved version still verifies) runs
against the real schema like the rest of minutes record keeping.
"""

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from pydantic import ValidationError
from pypdf import PdfReader
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.minute import SectionEntry, TemplateSectionEntry
from app.services.document_service import DocumentService
from app.utils.minutes_pdf import render_minutes_pdf
from app.utils.minutes_snapshot import build_snapshot, content_hash
from app.utils.rich_text import (
    html_to_pdf_blocks,
    html_to_text,
    sanitize_html,
    section_is_blank,
    section_text,
)
from tests.minutes_support import (
    _approve,
    _client,
    _create,
    _fill_required_sections,
    _World,
    build_world,
)

# ── The sanitizer ────────────────────────────────────────────────────


@pytest.mark.unit
class TestSanitizer:
    def test_the_editors_own_output_passes_through(self):
        source = (
            "<h2>Old business</h2><p>Moved <strong>and</strong> <em>seconded</em> "
            '<u>twice</u>, see <a href="https://example.org/a">the link</a>.</p>'
            "<ul><li>One</li></ul><ol><li>Two</li></ol>"
            "<blockquote><p>Quoted</p></blockquote>"
        )
        cleaned = sanitize_html(source)
        for fragment in (
            "<h2>Old business</h2>",
            "<strong>and</strong>",
            "<em>seconded</em>",
            "<u>twice</u>",
            "<li>One</li>",
            "<blockquote>",
        ):
            assert fragment in cleaned

    @pytest.mark.parametrize(
        "attack",
        [
            "<script>alert(1)</script>",
            "<img src=x onerror=alert(1)>",
            "<p onclick=alert(1)>x</p>",
            '<a href="javascript:alert(1)">x</a>',
            '<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>',
            "<iframe src='https://evil.example'></iframe>",
            "<style>body{display:none}</style>",
            '<svg onload="alert(1)"></svg>',
            "<p style='position:fixed'>x</p>",
            "<!-- <script>alert(1)</script> -->",
        ],
    )
    def test_active_content_is_removed(self, attack):
        cleaned = sanitize_html(f"<p>kept</p>{attack}").lower()
        assert "kept" in cleaned
        for danger in (
            "<script",
            "onerror",
            "onclick",
            "onload",
            "javascript:",
            "data:",
            "<iframe",
            "<style",
            "<svg",
            "<img",
            "style=",
            "<!--",
        ):
            assert danger not in cleaned

    def test_links_keep_only_an_allowed_scheme_and_are_made_safe(self):
        cleaned = sanitize_html(
            '<a href="https://ok.example">a</a><a href="mailto:x@y.example">b</a>'
            '<a href="ftp://no.example">c</a>'
        )
        assert 'href="https://ok.example"' in cleaned
        assert 'href="mailto:x@y.example"' in cleaned
        assert "ftp:" not in cleaned
        assert cleaned.count('rel="noopener noreferrer"') >= 2

    def test_text_inside_a_removed_tag_is_kept_but_not_script_bodies(self):
        cleaned = sanitize_html(
            "<div><span>words</span></div><script>secret()</script>"
        )
        assert "words" in cleaned
        assert "secret" not in cleaned

    def test_empty_and_none(self):
        assert sanitize_html("") == ""
        assert sanitize_html(None) == ""


@pytest.mark.unit
class TestBlankAndText:
    def test_an_empty_paragraph_is_blank_for_rich_text_only(self):
        assert section_is_blank({"content": "<p></p>", "format": "html"})
        assert section_is_blank({"content": "<p> <br> </p>", "format": "html"})
        assert not section_is_blank({"content": "<p></p>"})
        assert not section_is_blank({"content": "<p>x</p>", "format": "html"})

    def test_plain_text_is_never_read_as_markup(self):
        section = {"content": "Quorum was <5 and a > b"}
        assert section_text(section) == "Quorum was <5 and a > b"

    def test_rich_text_reads_as_text_with_entities_decoded(self):
        assert html_to_text("<p>Fish &amp; chips</p><ul><li>a</li></ul>") == (
            "Fish & chips\na"
        )


@pytest.mark.unit
class TestPdfBlocks:
    def test_structure_becomes_blocks(self):
        blocks = html_to_pdf_blocks(
            "<h2>T</h2><p>x <strong>b</strong> &lt;y&gt;<br>z</p>"
            "<ol><li>one</li><li>two</li></ol><ul><li>dot</li></ul>"
            "<blockquote>q</blockquote>"
        )
        assert blocks == [
            ("h2", "T"),
            ("p", "x <b>b</b> &lt;y&gt;<br/>z"),
            ("li", "1. one"),
            ("li", "2. two"),
            ("li", "• dot"),
            ("quote", "q"),
        ]

    def test_markup_in_the_text_cannot_become_pdf_markup(self):
        blocks = html_to_pdf_blocks(
            "<p>&lt;b&gt;not bold&lt;/b&gt; <script>x</script></p>"
        )
        assert blocks == [("p", "&lt;b&gt;not bold&lt;/b&gt;")]

    def test_a_link_without_an_allowed_target_loses_the_anchor(self):
        blocks = html_to_pdf_blocks('<p><a href="javascript:x()">hi</a></p>')
        assert blocks == [("p", "hi")]


# ── Schemas ──────────────────────────────────────────────────────────


@pytest.mark.unit
class TestSchemas:
    def test_a_section_defaults_to_plain_text_and_is_left_alone(self):
        section = SectionEntry(order=0, key="a", title="A", content="<b>literal</b>")
        assert section.format == "text"
        assert section.content == "<b>literal</b>"

    def test_a_rich_section_is_cleaned_on_the_way_in(self):
        section = SectionEntry(
            order=0,
            key="a",
            title="A",
            content="<p onclick=x>hi</p><script>bad()</script>",
            format="html",
        )
        assert section.content == "<p>hi</p>"

    def test_an_unknown_format_is_refused(self):
        with pytest.raises(ValidationError):
            SectionEntry(order=0, key="a", title="A", format="markdown")

    def test_a_rich_section_over_the_limit_is_refused(self):
        with pytest.raises(ValidationError, match="too long"):
            SectionEntry(
                order=0,
                key="a",
                title="A",
                content="<p>" + "x" * 100_001,
                format="html",
            )

    def test_an_outline_default_is_cleaned_too(self):
        section = TemplateSectionEntry(
            order=0,
            key="a",
            title="A",
            default_content="<p>hi</p><img src=x>",
            format="html",
        )
        assert section.default_content == "<p>hi</p>"


# ── Snapshot, PDF and published copy ─────────────────────────────────


def _minutes_row(sections):
    return SimpleNamespace(
        title="October",
        meeting_type="business",
        meeting_date=datetime(2026, 10, 1, 19, 0, tzinfo=timezone.utc),
        location=None,
        called_by=None,
        called_to_order_at=None,
        adjourned_at=None,
        quorum_met=None,
        quorum_count=None,
        quorum_type=None,
        quorum_threshold=None,
        attendees=[],
        motions=[],
        action_items=[],
        adopted_on=None,
        adopted_as_amended=None,
        adopting_minutes_id=None,
        get_sections=lambda: sections,
        get_effective_header=lambda: {},
        get_effective_footer=lambda: {},
        status="draft",
        id="min-1",
        published_document_id=None,
    )


@pytest.mark.unit
class TestSnapshot:
    LEGACY = [{"order": 0, "key": "a", "title": "A", "content": "Plain"}]

    def test_a_plain_section_hashes_as_it_did_before_the_editor(self):
        snapshot = build_snapshot(_minutes_row(self.LEGACY), [], [], [])
        assert snapshot["sections"] == [
            {"order": 0, "key": "a", "title": "A", "content": "Plain"}
        ]

    def test_a_text_marker_does_not_change_the_hash(self):
        marked = [{**self.LEGACY[0], "format": "text"}]
        assert content_hash(build_snapshot(_minutes_row(marked), [], [], [])) == (
            content_hash(build_snapshot(_minutes_row(self.LEGACY), [], [], []))
        )

    def test_a_rich_section_records_its_format(self):
        rich = [{**self.LEGACY[0], "content": "<p>Plain</p>", "format": "html"}]
        snapshot = build_snapshot(_minutes_row(rich), [], [], [])
        assert snapshot["sections"][0]["format"] == "html"
        assert content_hash(snapshot) != content_hash(
            build_snapshot(_minutes_row(self.LEGACY), [], [], [])
        )


@pytest.mark.unit
class TestOutputs:
    def test_the_pdf_renders_rich_and_plain_sections(self):
        data = {
            "title": "October",
            "meeting_type": "business",
            "sections": [
                {
                    "title": "Rich",
                    "content": "<h3>Sub</h3><p>One <em>two</em></p>"
                    "<ul><li>a</li></ul><blockquote>q</blockquote>",
                    "format": "html",
                },
                {"title": "Plain", "content": "A < B"},
                {"title": "Empty", "content": "<p></p>", "format": "html"},
            ],
        }
        pdf = render_minutes_pdf(data, {})
        assert pdf.getvalue().startswith(b"%PDF")
        text = "".join(page.extract_text() for page in PdfReader(pdf).pages)
        for expected in ("Sub", "One two", "A < B"):
            assert expected in text
        assert "<p>" not in text
        assert "<ul>" not in text

    def test_the_published_copy_escapes_plain_and_cleans_rich(self):
        sections = [
            {"order": 0, "key": "a", "title": "Plain", "content": "<b>x</b>"},
            {
                "order": 1,
                "key": "b",
                "title": "Rich",
                "content": "<p>ok</p><script>bad()</script>",
                "format": "html",
            },
        ]
        html_out = DocumentService(None)._generate_minutes_html(
            SimpleNamespace(
                get_effective_header=lambda: {},
                get_effective_footer=lambda: {},
                get_sections=lambda: sections,
                meeting_type="business",
                meeting_date=datetime(2026, 1, 15, 19, 0, tzinfo=timezone.utc),
                title="T",
                location=None,
                called_by=None,
                called_to_order_at=None,
                adjourned_at=None,
                attendees=[],
                quorum_met=None,
                quorum_count=None,
                motions=[],
                action_items=[],
                approved_at=None,
                status="approved",
                id="m",
                published_document_id=None,
                adopted_on=None,
                adopted_as_amended=None,
                adopting_minutes_id=None,
                adopting_minutes=None,
            )
        )
        assert "&lt;b&gt;x&lt;/b&gt;" in html_out
        assert "<p>ok</p>" in html_out
        assert "<script>" not in html_out


# ── Over HTTP ────────────────────────────────────────────────────────

integration = pytest.mark.integration


@pytest.fixture
async def world(db_session: AsyncSession) -> _World:
    return await build_world(db_session)


@integration
class TestRichTextOverHttp:
    async def test_a_rich_section_is_cleaned_stored_and_returned(self, world: _World):
        minutes = await _create(
            world,
            sections=[
                {
                    "order": 0,
                    "key": "old_business",
                    "title": "Old Business",
                    "content": "<p onclick=x>Discussed <strong>hoses</strong></p><script>bad()</script>",
                    "format": "html",
                }
            ],
        )
        (section,) = minutes["sections"]
        assert section["format"] == "html"
        assert section["content"] == "<p>Discussed <strong>hoses</strong></p>"

    async def test_an_empty_rich_paragraph_does_not_satisfy_a_required_section(
        self, world: _World
    ):
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            current = (await c.get(f"/minutes/{minutes['id']}")).json()
            sections = [
                (
                    {**s, "content": "<p></p>", "format": "html"}
                    if s["required"]
                    else {**s, "content": s["content"] or "x"}
                )
                for s in current["sections"]
            ]
            assert any(s["required"] for s in sections)
            await c.put(f"/minutes/{minutes['id']}", json={"sections": sections})
            resp = await c.post(f"/minutes/{minutes['id']}/submit")
        assert resp.status_code == 400, resp.text

    async def test_a_rich_section_approves_and_verifies(self, world: _World):
        minutes = await _create(world)
        await _fill_required_sections(world, minutes["id"])
        async with _client(world.db, world.secretary) as c:
            current = (await c.get(f"/minutes/{minutes['id']}")).json()
            sections = [
                {
                    **s,
                    "content": f"<p>{s['title']} <em>noted</em></p>",
                    "format": "html",
                }
                for s in current["sections"]
            ]
            assert (
                await c.put(f"/minutes/{minutes['id']}", json={"sections": sections})
            ).status_code == 200
        await _approve(world, minutes["id"])
        async with _client(world.db, world.member) as c:
            verdict = (await c.get(f"/minutes/{minutes['id']}/verify")).json()
        assert verdict["verified"] is True, verdict

    async def test_plain_text_sections_keep_displaying_as_plain_text(
        self, world: _World
    ):
        minutes = await _create(
            world,
            sections=[
                {
                    "order": 0,
                    "key": "notes",
                    "title": "Notes",
                    "content": "Quorum was <5 & the vote was a > b",
                }
            ],
        )
        (section,) = minutes["sections"]
        assert section["format"] == "text"
        assert section["content"] == "Quorum was <5 & the vote was a > b"

    async def test_an_outline_can_start_minutes_with_rich_default_text(
        self, world: _World
    ):
        async with _client(world.db, world.secretary) as c:
            created = await c.post(
                "/minutes/templates",
                json={
                    "name": "Rich order",
                    "meeting_type": "special",
                    "is_default": True,
                    "sections": [
                        {
                            "order": 0,
                            "key": "opening",
                            "title": "Opening",
                            "default_content": "<p>The chair <strong>opened</strong>.</p><img src=x>",
                            "format": "html",
                        }
                    ],
                },
            )
        assert created.status_code == 201, created.text
        assert created.json()["sections"][0]["default_content"] == (
            "<p>The chair <strong>opened</strong>.</p>"
        )
        minutes = await _create(world, meeting_type="special")
        async with _client(world.db, world.secretary) as c:
            applied = await c.post(
                f"/minutes/{minutes['id']}/apply-outline",
                json={"template_id": created.json()["id"]},
            )
        assert applied.status_code == 200, applied.text
        by_key = {s["key"]: s for s in applied.json()["sections"]}
        assert by_key["opening"]["format"] == "html"
        assert by_key["opening"]["content"] == (
            "<p>The chair <strong>opened</strong>.</p>"
        )
