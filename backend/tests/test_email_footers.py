"""
Named footers, and the templates that choose between them.

The footer used to be copy-pasted into all 35 default bodies. It is now a
small library on the organization, with each template naming the one it
closes with. The things that can quietly break: a footer whose text stops
being substituted (it is resolved a step earlier than the template body, so
it does not ride the same pass), a footer key that no longer resolves to
anything, and admin-entered text reaching the recipient as markup.

DB-free: every function under test takes the organization as a plain object.
"""

from types import SimpleNamespace

import pytest

from app.services import email_footers
from app.services.email_template_service import EmailTemplateService

pytestmark = pytest.mark.unit


def _org(**overrides):
    base = dict(
        name="Falls Church Fire & Rescue",
        logo="",
        phone="(555) 111-2222",
        email="info@example.org",
        website="https://example.org",
        settings={},
        physical_address_same=True,
        mailing_address_line1="100 Main Street",
        mailing_address_line2=None,
        mailing_city="Falls Church",
        mailing_state="VA",
        mailing_zip="22046",
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def _with_library(library):
    return _org(settings={email_footers.ORG_SETTINGS_FOOTER_KEY: library})


class TestTheLibrarySeedsItself:
    def test_an_organization_with_no_settings_still_has_footers(self):
        library = email_footers.read_library(_org())
        assert library["footers"]
        assert library["default_key"] in {f["key"] for f in library["footers"]}

    def test_no_organization_at_all_still_has_footers(self):
        assert email_footers.read_library(None)["footers"]

    def test_the_seeded_keys_are_the_ones_templates_reference(self):
        """A default template naming a footer nobody seeded gets no footer."""
        seeded = {f["key"] for f in email_footers.DEFAULT_FOOTERS}
        referenced = {
            defn["footer"]
            for defn in EmailTemplateService._DEFAULT_TEMPLATE_DEFS
            if defn.get("footer")
        }
        assert referenced <= seeded, sorted(referenced - seeded)


class TestAMalformedBlobStillSends:
    """Settings can be hand-edited. Mail must not stop."""

    @pytest.mark.parametrize(
        "blob",
        [
            "not a dict",
            {"footers": "not a list"},
            {"footers": []},
            {"footers": [{"key": "x"}]},
            {"footers": [{"key": "UPPER", "name": "n", "lines": []}]},
        ],
    )
    def test_unusable_settings_fall_back_to_the_seeded_library(self, blob):
        library = email_footers.read_library(_with_library(blob))
        assert library["footers"] == email_footers.DEFAULT_FOOTERS

    def test_a_default_key_naming_nothing_falls_back_to_a_real_footer(self):
        library = email_footers.read_library(
            _with_library(
                {
                    "default_key": "deleted",
                    "footers": [{"key": "only", "name": "Only", "lines": ["a"]}],
                }
            )
        )
        assert library["default_key"] == "only"


class TestResolvingWhichFooterToUse:
    def test_a_template_gets_the_footer_it_names(self):
        assert email_footers.resolve(_org(), "public")["key"] == "public"

    def test_naming_nothing_gets_the_default(self):
        assert email_footers.resolve(_org(), None)["key"] == "internal"

    def test_naming_a_deleted_footer_gets_the_default(self):
        """Deleting a footer should cost a template its choice, not its footer."""
        assert email_footers.resolve(_org(), "removed")["key"] == "internal"


class TestRenderingAFooter:
    def test_organization_variables_are_substituted(self):
        """The footer is resolved before the body, so it cannot ride that pass.

        A ``{{organization_name}}`` left unsubstituted here reaches the
        recipient as those literal braces.
        """
        context = EmailTemplateService.build_context({}, _org())
        assert "{{" not in context["footer_html"]
        assert "{{" not in context["footer_text"]
        assert "Falls Church Fire &amp; Rescue" in context["footer_html"]
        assert "Falls Church Fire & Rescue" in context["footer_text"]

    def test_admin_text_cannot_become_markup(self):
        footer = {
            "key": "x",
            "name": "X",
            "lines": ["<script>alert(1)</script> from {{organization_name}}"],
            "show_contact": False,
        }
        html = email_footers.render_html(footer, {"organization_name": "A & B"})
        assert "<script>" not in html
        assert "&lt;script&gt;" in html
        assert "A &amp; B" in html

    def test_a_variable_a_footer_may_not_use_is_left_alone(self):
        """Blanking it would silently delete the line's subject."""
        footer = {"key": "x", "name": "X", "lines": ["Hi {{first_name}}"]}
        assert "{{first_name}}" in email_footers.render_text(
            footer, {"first_name": "Jo"}
        )

    def test_the_contact_line_is_omitted_when_switched_off(self):
        footer = {"key": "x", "name": "X", "lines": ["One"], "show_contact": False}
        context = {"organization_phone": "(555) 111-2222"}
        assert "555" not in email_footers.render_html(footer, context)

    def test_the_mailing_address_is_included_when_switched_on(self):
        footer = {
            "key": "x",
            "name": "X",
            "lines": [],
            "show_contact": False,
            "show_mailing_address": True,
        }
        context = {"organization_mailing_address": "100 Main Street\nFalls Church, VA"}
        html = email_footers.render_html(footer, context)
        assert "100 Main Street" in html
        assert "<br />" in html
        assert "100 Main Street" in email_footers.render_text(footer, context)

    def test_a_footer_with_nothing_in_it_renders_nothing(self):
        """Not an empty div that shows as a gap under every email."""
        footer = {"key": "x", "name": "X", "lines": [], "show_contact": False}
        assert email_footers.render_html(footer, {}) == ""
        assert email_footers.render_text(footer, {}) == ""


_CONTACT = {
    "organization_phone": "(555) 111-2222",
    "organization_email": "info@example.org",
    "organization_website": "https://example.org",
}


class TestChoosingWhichContactDetailsToShow:
    """Phone, email and website are switched one by one.

    Before the split one ``show_contact`` switched all three, so a
    department that wanted its email and website but not a phone nobody
    staffs had no way to say so.
    """

    def _footer(self, **flags):
        return {"key": "x", "name": "X", "lines": [], **flags}

    def test_email_and_website_without_the_phone(self):
        footer = self._footer(show_phone=False, show_email=True, show_website=True)
        html = email_footers.render_html(footer, _CONTACT)
        text = email_footers.render_text(footer, _CONTACT)
        assert "555" not in html
        assert "info@example.org | https://example.org" in html
        assert "555" not in text
        assert "info@example.org | https://example.org" in text

    def test_each_part_on_its_own(self):
        for flag, value in (
            ("show_phone", "(555) 111-2222"),
            ("show_email", "info@example.org"),
            ("show_website", "https://example.org"),
        ):
            flags = {f: f == flag for f in email_footers.CONTACT_FIELDS}
            text = email_footers.render_text(self._footer(**flags), _CONTACT)
            assert text == f"---\n{value}", flag

    def test_a_footer_saved_before_the_split_renders_as_it_did(self):
        """A stored footer carrying only ``show_contact`` must not change."""
        on = email_footers.render_text(self._footer(show_contact=True), _CONTACT)
        assert on.endswith("(555) 111-2222 | info@example.org | https://example.org")
        off = email_footers.render_text(self._footer(show_contact=False), _CONTACT)
        assert off == ""

    def test_a_part_the_footer_does_not_mention_follows_the_legacy_switch(self):
        footer = self._footer(show_contact=False, show_email=True)
        assert email_footers.render_text(footer, _CONTACT) == "---\ninfo@example.org"

    def test_a_non_boolean_flag_is_not_trusted(self):
        """A hand-edited blob must not switch a part with a stray string."""
        footer = self._footer(show_contact=False, show_phone="yes")
        assert email_footers.contact_flags(footer)["show_phone"] is False

    def test_a_blank_organization_value_is_skipped(self):
        footer = self._footer(show_phone=True, show_email=True, show_website=True)
        context = {**_CONTACT, "organization_phone": "  "}
        assert email_footers.render_text(footer, context) == (
            "---\ninfo@example.org | https://example.org"
        )

    def test_the_library_reports_every_flag_for_an_old_footer(self):
        """The editor needs an explicit value to put in each checkbox."""
        library = email_footers.read_library(
            _with_library(
                {
                    "default_key": "old",
                    "footers": [
                        {
                            "key": "old",
                            "name": "Old",
                            "lines": [],
                            "show_contact": False,
                        }
                    ],
                }
            )
        )
        footer = library["footers"][0]
        assert footer["show_phone"] is False
        assert footer["show_email"] is False
        assert footer["show_website"] is False
        assert footer["show_contact"] is False

    def test_reading_does_not_mutate_the_stored_settings(self):
        stored = {"key": "old", "name": "Old", "lines": [], "show_contact": True}
        org = _with_library({"default_key": "old", "footers": [stored]})
        email_footers.read_library(org)
        assert "show_phone" not in stored

    def test_the_seeded_footers_show_every_part(self):
        for footer in email_footers.DEFAULT_FOOTERS:
            assert all(email_footers.contact_flags(footer).values()), footer["key"]


class TestSavingContactFlags:
    def test_a_client_sending_only_the_legacy_switch_sets_every_part(self):
        from app.schemas.email_template import EmailFooter

        footer = EmailFooter(key="x", name="X", show_contact=False)
        assert (footer.show_phone, footer.show_email, footer.show_website) == (
            False,
            False,
            False,
        )

    def test_the_legacy_switch_reports_whether_any_part_is_shown(self):
        from app.schemas.email_template import EmailFooter

        footer = EmailFooter(
            key="x",
            name="X",
            show_contact=False,
            show_phone=False,
            show_email=True,
            show_website=False,
        )
        assert footer.show_contact is True
        assert footer.show_phone is False

    def test_turning_every_part_off_turns_the_legacy_switch_off(self):
        from app.schemas.email_template import EmailFooter

        footer = EmailFooter(
            key="x", name="X", show_phone=False, show_email=False, show_website=False
        )
        assert footer.show_contact is False


class TestTheEditorSeesWhatWillPrint:
    """The screen shows the actual values beside each switch."""

    def test_the_contact_details_come_from_the_organization(self):
        from app.api.v1.endpoints.email_templates import _footer_contact_details

        details = _footer_contact_details(_org(website=None))
        assert details.phone == "(555) 111-2222"
        assert details.email == "info@example.org"
        assert details.website == ""
        assert details.mailing_address.startswith("100 Main Street\n")
        assert "Falls Church, VA" in details.mailing_address

    def test_no_organization_reports_nothing_set(self):
        from app.api.v1.endpoints.email_templates import _footer_contact_details

        details = _footer_contact_details(None)
        assert details.model_dump() == {
            "phone": "",
            "email": "",
            "website": "",
            "mailing_address": "",
        }


class TestTemplatesCloseWithTheirOwnFooter:
    @staticmethod
    def _template(defn):
        return SimpleNamespace(
            subject=defn["subject"],
            html_body=defn["html"],
            text_body=defn["text"],
            css_styles=None,
            footer_key=defn.get("footer"),
        )

    def _render(self, type_value, organization):
        defn = next(
            d
            for d in EmailTemplateService._DEFAULT_TEMPLATE_DEFS
            if d["type"].value == type_value
        )
        service = EmailTemplateService.__new__(EmailTemplateService)
        return service.render(self._template(defn), {}, organization=organization)

    def test_a_public_notice_does_not_tell_the_recipient_not_to_reply(self):
        """It is the one notice whose recipient may well need to reply."""
        _, html, _ = self._render("event_request_status", _org())
        assert "do not reply" not in html.lower()

    def test_a_public_notice_carries_the_mailing_address(self):
        _, html, text = self._render("event_request_status", _org())
        assert "100 Main Street" in html
        assert "100 Main Street" in text

    def test_an_internal_notice_does_not_tell_the_recipient_not_to_reply(self):
        # Replies reach the department (EmailService.default_reply_to), so
        # the line would be discouraging the one thing that gets a member an
        # answer.
        _, html, _ = self._render("welcome", _org())
        assert "do not reply" not in html.lower()
        assert "automated message" in html.lower()

    def test_an_official_notice_says_so(self):
        _, html, _ = self._render("member_dropped", _org())
        assert "official department notice" in html.lower()

    def test_editing_a_footer_reaches_every_template_using_it(self):
        """The whole point: one edit, not thirty-five."""
        organization = _with_library(
            {
                "default_key": "internal",
                "footers": [
                    {
                        "key": "internal",
                        "name": "Internal",
                        "lines": ["Reworded by the department."],
                        "show_contact": False,
                    }
                ],
            }
        )
        for type_value in ("welcome", "password_reset", "event_reminder"):
            _, html, _ = self._render(type_value, organization)
            assert "Reworded by the department." in html


def _load_revision(revision: str):
    import importlib.util
    import pathlib

    versions = pathlib.Path(__file__).resolve().parent.parent / "alembic" / "versions"
    matches = list(versions.glob(f"*_{revision}_*.py"))
    assert len(matches) == 1, matches
    spec = importlib.util.spec_from_file_location(f"rev_{revision}", matches[0])
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestTheNoReplyMigration:
    """``3f3b315165ed``: saved libraries lose the seeded "do not reply" line.

    SQLite in memory, so this stays in the no-database unit job; the rewrite
    is plain Python over the JSON column and needs no MySQL behaviour.
    """

    migration = _load_revision("3f3b315165ed")

    def _seeded_as_saved(self):
        """The library exactly as the editor saved it before this release."""
        library = email_footers.default_library()
        library["footers"][0]["lines"] = [
            self.migration.INTERNAL_FIRST_LINE,
            self.migration.NO_REPLY_LINE,
        ]
        return library

    def _engine(self, rows):
        import sqlalchemy as sa

        engine = sa.create_engine("sqlite://")
        table = sa.Table(
            "organizations",
            sa.MetaData(),
            sa.Column("id", sa.String, primary_key=True),
            sa.Column("settings", sa.JSON, nullable=True),
        )
        table.create(engine)
        with engine.begin() as conn:
            for row_id, settings in rows.items():
                conn.execute(table.insert().values(id=row_id, settings=settings))
        return engine

    def _run(self, engine, fn):
        from alembic.migration import MigrationContext
        from alembic.operations import Operations

        with engine.begin() as conn:
            with Operations.context(MigrationContext.configure(conn)):
                fn()

    def _settings(self, engine):
        import sqlalchemy as sa

        table = self.migration._organizations_table()
        with engine.connect() as conn:
            return dict(conn.execute(sa.select(table.c.id, table.c.settings)).all())

    def test_the_frozen_first_line_is_still_the_seeded_one(self):
        # Downgrade recognises an untouched footer by this line. If the seed
        # is reworded, this revision still has to match what it stripped,
        # so the constant stays; this only flags the divergence.
        assert (
            email_footers.DEFAULT_FOOTERS[0]["lines"][0]
            == self.migration.INTERNAL_FIRST_LINE
        )

    def test_the_seeded_line_is_removed_and_nothing_else_moves(self):
        edited = self._seeded_as_saved()
        edited["footers"][0]["lines"].append("Call the station for anything urgent.")
        edited["footers"][1]["lines"].append("  Please do not reply to this email.  ")
        own_words = self._seeded_as_saved()
        own_words["footers"][0]["lines"] = ["Replies to this address are not read."]
        engine = self._engine(
            {
                "seeded": {"theme": "dark", "email_footers": self._seeded_as_saved()},
                "edited": {"email_footers": edited},
                "own-words": {"email_footers": own_words},
                "never-saved": {"theme": "dark"},
                "no-settings": None,
                "malformed": {"email_footers": {"footers": "nonsense"}},
            }
        )
        before = self._settings(engine)

        self._run(engine, self.migration.upgrade)
        after = self._settings(engine)

        seeded = after["seeded"]["email_footers"]
        assert seeded["footers"][0]["lines"] == [self.migration.INTERNAL_FIRST_LINE]
        assert seeded["footers"][1:] == before["seeded"]["email_footers"]["footers"][1:]
        assert after["seeded"]["theme"] == "dark"

        assert after["edited"]["email_footers"]["footers"][0]["lines"] == [
            self.migration.INTERNAL_FIRST_LINE,
            "Call the station for anything urgent.",
        ]
        assert (
            after["edited"]["email_footers"]["footers"][1]["lines"]
            == email_footers.DEFAULT_FOOTERS[1]["lines"]
        )

        for untouched in ("own-words", "never-saved", "no-settings", "malformed"):
            assert after[untouched] == before[untouched], untouched

    def test_downgrade_restores_an_untouched_library(self):
        engine = self._engine(
            {"seeded": {"email_footers": self._seeded_as_saved()}},
        )
        before = self._settings(engine)

        self._run(engine, self.migration.upgrade)
        self._run(engine, self.migration.downgrade)

        assert self._settings(engine) == before

    def test_upgrade_is_idempotent(self):
        engine = self._engine({"seeded": {"email_footers": self._seeded_as_saved()}})
        self._run(engine, self.migration.upgrade)
        once = self._settings(engine)
        self._run(engine, self.migration.upgrade)
        assert self._settings(engine) == once

    def test_the_stripped_library_still_renders(self):
        engine = self._engine({"seeded": {"email_footers": self._seeded_as_saved()}})
        self._run(engine, self.migration.upgrade)
        organization = _with_library(self._settings(engine)["seeded"]["email_footers"])
        footer = email_footers.resolve(organization)
        html = email_footers.render_html(footer, {"organization_name": "Station 9"})
        assert "do not reply" not in html.lower()
        assert "automated message from Station 9" in html


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
