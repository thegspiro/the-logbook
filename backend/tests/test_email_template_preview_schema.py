"""
What the preview endpoint accepts as overrides.

The live preview pane re-renders the draft on every keystroke, so the request
it sends carries whatever the editor form currently holds — including the
fields the admin has not touched. Two of those, the accent and the layout, are
nullable on the row: a template that has never been recoloured stores neither
and renders with the colourway its type ships with. The form has no way to
express that absence other than an empty string, and an empty string is not
one of the seven accents or three layouts. Rejecting it took down the whole
preview pane rather than one field, on precisely the templates nobody had
customised.

An *update* carrying a blank is a different thing — a write that would clear a
column the UI offers no way to clear — and stays rejected. That asymmetry is
what these pin.

No DB: schema validation only.
"""

import pytest
from pydantic import ValidationError

from app.schemas.email_template import (
    EmailTemplatePreviewRequest,
    EmailTemplateUpdate,
)
from app.services.email_theme import ACCENT_INDIGO, LAYOUTS


class TestPreviewOverridesTreatBlankAsUnset:
    @pytest.mark.parametrize("blank", ["", "   "])
    def test_blank_accent_is_read_as_absent(self, blank):
        req = EmailTemplatePreviewRequest(header_accent=blank)
        assert req.header_accent is None

    @pytest.mark.parametrize("blank", ["", "   "])
    def test_blank_layout_is_read_as_absent(self, blank):
        req = EmailTemplatePreviewRequest(layout=blank)
        assert req.layout is None

    def test_a_draft_with_neither_set_still_validates(self):
        # The exact payload the editor sends for an uncustomised template.
        # This is the request that used to 422 with two field errors and no
        # preview at all.
        req = EmailTemplatePreviewRequest(
            subject="Subject",
            html_body="<p>Body</p>",
            text_body="",
            css_styles="",
            footer_key="",
            header_accent="",
            status_chip="",
            layout="",
        )
        assert req.header_accent is None
        assert req.layout is None
        # Everything else keeps its empty string: cleared means cleared, and
        # the endpoint distinguishes those with `is not None`.
        assert req.text_body == ""
        assert req.css_styles == ""
        assert req.footer_key == ""
        assert req.status_chip == ""

    def test_a_real_accent_still_has_to_be_one_we_ship(self):
        with pytest.raises(ValidationError):
            EmailTemplatePreviewRequest(header_accent="#123456")

    def test_a_real_layout_still_has_to_be_one_we_render(self):
        with pytest.raises(ValidationError):
            EmailTemplatePreviewRequest(layout="newsletter")

    def test_a_known_accent_is_normalised_not_dropped(self):
        req = EmailTemplatePreviewRequest(header_accent=ACCENT_INDIGO.upper())
        assert req.header_accent == ACCENT_INDIGO

    @pytest.mark.parametrize("layout", LAYOUTS)
    def test_every_shipped_layout_is_accepted(self, layout):
        assert EmailTemplatePreviewRequest(layout=layout).layout == layout


class TestUpdateStillRejectsBlank:
    """The leniency is scoped to the preview, deliberately.

    A preview omitting the accent falls back to the saved one and shows the
    admin the same thing they would get. An update omitting it would write a
    blank into the column, and the renderer would mail
    ``border-top-color: ;`` to everyone on the list.
    """

    def test_blank_accent_is_rejected_on_update(self):
        with pytest.raises(ValidationError):
            EmailTemplateUpdate(header_accent="")

    def test_blank_layout_is_rejected_on_update(self):
        with pytest.raises(ValidationError):
            EmailTemplateUpdate(layout="")
