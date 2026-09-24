"""PUB-6: the public portal's whitelist-filtered responses must tolerate gaps.

``portal.py`` builds the full organization dictionary, hands it to
``filter_data_by_whitelist``, and constructs the response model from whatever
survives. A field an administrator has not enabled is therefore **absent** from
the dictionary — including all of them, which is the state every deployment
starts in (nothing seeds ``public_portal_data_whitelist``; rows only appear when
an administrator adds them through the admin API).

Under Pydantic v2 an ``Optional[T]`` annotation with no default is a *required*
field that merely accepts ``None``, so a response model written that way raises
``ValidationError`` for every configuration short of "all fields whitelisted" —
and the endpoint's own ``except Exception`` turns that into a 500. The
whitelist's default-deny path could not return the empty document it exists to
return.

These tests fail if a field loses its default, or if a newly-added field is
declared without one.

**PUB-7 is the same defect one model over, plus a second one.** ``PublicEvent``
was not in the list below, so nothing held it to the rule — and all eight of
its fields were required. Worse, three of the names it required
(``start_time``, ``end_time``, ``is_public``) were not keys the handler ever
produced, so even whitelisting *every* events field raised four validation
errors. ``/events/public`` could answer 200 only by returning ``[]``: a
department's public website got a 500 at the moment an administrator finished
configuring it. Both halves are covered here now — the optionality rule by
adding the model to the list, and the names by pinning them to the field
catalogue.
"""

import pytest

from app.core.public_portal_fields import PUBLIC_PORTAL_FIELDS
from app.schemas.public_portal import (
    PublicEvent,
    PublicOrganizationInfo,
    PublicOrganizationStats,
)

WHITELIST_FILTERED_MODELS = (
    PublicOrganizationInfo,
    PublicOrganizationStats,
    PublicEvent,
)


@pytest.mark.unit
@pytest.mark.parametrize(
    "model",
    WHITELIST_FILTERED_MODELS,
    ids=[model.__name__ for model in WHITELIST_FILTERED_MODELS],
)
def test_every_field_is_optional(model):
    """No field may be required: the whitelist can remove any one of them."""
    required = [name for name, f in model.model_fields.items() if f.is_required()]
    assert required == [], (
        f"{model.__name__} declares required field(s) {required}; the public "
        "portal constructs this model from a whitelist-filtered dict, so a "
        "required field 500s every organization that has not enabled it."
    )


@pytest.mark.unit
@pytest.mark.parametrize(
    "model",
    WHITELIST_FILTERED_MODELS,
    ids=[model.__name__ for model in WHITELIST_FILTERED_MODELS],
)
def test_default_deny_produces_an_empty_document(model):
    """An empty whitelist is the shipped default and must not be an error."""
    instance = model()  # equivalent to model(**{}) with nothing whitelisted
    assert all(value is None for value in instance.model_dump().values())


@pytest.mark.unit
def test_partial_whitelist_constructs():
    """The realistic case: an administrator enables a handful of fields."""
    info = PublicOrganizationInfo(**{"name": "Springfield VFD", "phone": "555-0100"})
    assert info.name == "Springfield VFD"
    assert info.logo is None

    stats = PublicOrganizationStats(**{"total_members": 45})
    assert stats.total_members == 45
    assert stats.apparatus is None


@pytest.mark.unit
def test_address_components_may_be_null():
    """``line2``/``country`` are routinely unset on a real organization row.

    ``portal.py`` builds the address dict from the columns unconditionally, so
    the value type has to admit ``None`` — ``Dict[str, str]`` rejected the very
    dictionary the handler produces.
    """
    info = PublicOrganizationInfo(
        **{
            "name": "Springfield VFD",
            "mailing_address": {
                "line1": "123 Main Street",
                "line2": None,
                "city": "Springfield",
                "state": "IL",
                "zip_code": "62701",
                "country": None,
            },
        }
    )
    assert info.mailing_address is not None
    assert info.mailing_address["line2"] is None


# ==============================================================================
# PUB-7 — the model's field names must be the keys the handler produces
# ==============================================================================


@pytest.mark.unit
def test_public_event_declares_every_whitelistable_events_field():
    """The model and the whitelist must agree on what an events field is called.

    `test_public_portal_whitelist_catalogue.py` pins the catalogue to the
    dictionary `portal.py` hands to `filter_data_by_whitelist`; this pins the
    response model to that same catalogue. Together they close the loop: a key
    the handler emits reaches a field of this model, under that name.

    A name that exists on only one side does not raise anywhere near the edit
    that broke it. It surfaces as a 500 on a public website, the first time an
    administrator enables the field.
    """
    catalogued = {f.name for f in PUBLIC_PORTAL_FIELDS if f.category == "events"}
    assert catalogued, "the events category disappeared from the catalogue"

    missing = sorted(catalogued - set(PublicEvent.model_fields))
    assert missing == [], (
        f"PublicEvent has no field for whitelistable events field(s) {missing}, "
        "so enabling one raises ValidationError and the route 500s."
    )


@pytest.mark.unit
def test_public_event_offers_nothing_the_whitelist_cannot_control():
    """ "Only whitelisted fields are returned" is this endpoint's invariant.

    A field on the model that no catalogue entry covers is one an
    administrator cannot switch off — and, because the handler never puts that
    key in the dictionary, one that can only ever serialize as null.
    """
    catalogued = {f.name for f in PUBLIC_PORTAL_FIELDS if f.category == "events"}
    extra = sorted(set(PublicEvent.model_fields) - catalogued)
    assert (
        extra == []
    ), f"PublicEvent declares {extra}, which the whitelist does not control."


@pytest.mark.unit
def test_the_handlers_exact_dictionary_constructs():
    """The reproduction from the security review, as a test.

    Built from the catalogue rather than retyped, so a field added to the
    handler is exercised here the day it is added.
    """
    event_data = {
        name: ("2026-03-15T14:00:00+00:00" if name.endswith("_datetime") else "x")
        for name in (f.name for f in PUBLIC_PORTAL_FIELDS if f.category == "events")
    }
    event_data["id"] = "123e4567-e89b-12d3-a456-426614174000"

    event = PublicEvent(**event_data)

    assert event.title == "x"
    assert event.start_datetime is not None


@pytest.mark.unit
def test_a_single_whitelisted_events_field_constructs():
    """The realistic first configuration: an administrator enables one field.

    This is the exact case that 500d — seven validation errors for the seven
    fields the request had not enabled.
    """
    event = PublicEvent(**{"title": "Community Open House"})

    assert event.title == "Community Open House"
    assert event.location is None
    # exclude_unset on the route is what keeps the un-enabled fields out of
    # the response rather than serializing them as nulls.
    assert set(event.model_dump(exclude_unset=True)) == {"title"}
