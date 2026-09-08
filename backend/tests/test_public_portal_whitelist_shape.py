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
"""

import pytest

from app.schemas.public_portal import PublicOrganizationInfo, PublicOrganizationStats

WHITELIST_FILTERED_MODELS = (PublicOrganizationInfo, PublicOrganizationStats)


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
