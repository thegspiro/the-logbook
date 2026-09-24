"""The public portal's field catalogue, and the screen that reads it.

The Data Exposure Control screen marks a field ``PII`` so an administrator
sees, before enabling it, that its value identifies a person. That badge reads
``is_sensitive``, which nothing produced: no column held it and no response
carried it, so the badge never rendered on any installation and the
"N sensitive fields enabled" warning beside it was permanently zero. The
screen's whole purpose is to make that judgement visible at the moment of the
decision, and it was showing every field as equally safe to publish.

It could not have rendered anyway, for a second reason: nothing seeded
``public_portal_data_whitelist``, so the screen listed nothing at all.

So there are two halves to hold down here — that the catalogue describes the
fields ``portal.py`` can actually serve, and that a row exists for each of them
— plus the classification itself, which is a judgement and therefore the thing
most likely to be changed by accident.
"""

import ast
import pathlib
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.public_portal_admin import _ensure_catalogue_rows, get_data_whitelist
from app.core.public_portal_fields import PUBLIC_PORTAL_FIELDS, catalogue_entry
from app.models.public_portal import PublicPortalConfig, PublicPortalDataWhitelist
from app.schemas.public_portal import PublicPortalDataWhitelistResponse

PORTAL_SOURCE = (
    pathlib.Path(__file__).resolve().parents[1] / "app" / "api" / "public" / "portal.py"
)

# The three dictionaries portal.py hands to filter_data_by_whitelist, and the
# category each is filtered under.
HANDLER_DICTS = {
    "org_data": "organization",
    "stats_data": "stats",
    "event_data": "events",
}


def _keys_of_handler_dicts() -> set[tuple[str, str]]:
    """(category, field) pairs the public handlers can actually serve.

    Read out of the source rather than restated here: the point of the check
    is that the catalogue cannot drift from the handlers, and a hand-copied
    list in a test drifts exactly as easily as one in the catalogue.
    """
    tree = ast.parse(PORTAL_SOURCE.read_text())
    found: set[tuple[str, str]] = set()

    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign) or not isinstance(node.value, ast.Dict):
            continue
        for target in node.targets:
            if not isinstance(target, ast.Name):
                continue
            category = HANDLER_DICTS.get(target.id)
            if category is None:
                continue
            for key in node.value.keys:
                # A computed key cannot be read statically, and silently
                # skipping it would shrink this check without failing it.
                unreadable = (
                    f"{target.id} has a non-literal key; this check reads the "
                    "dictionary statically and cannot follow a computed one."
                )
                assert isinstance(key, ast.Constant), unreadable
                assert isinstance(key.value, str), unreadable
                found.add((category, key.value))

    return found


@pytest.mark.unit
class TestTheCatalogueMatchesWhatIsServed:
    def test_the_check_found_all_three_dictionaries(self):
        """A rename in portal.py must not quietly empty this file."""
        categories = {category for category, _ in _keys_of_handler_dicts()}
        assert categories == set(HANDLER_DICTS.values())

    def test_every_served_field_is_in_the_catalogue(self):
        """A field with no entry renders unlabelled and unclassified."""
        catalogued = {(f.category, f.name) for f in PUBLIC_PORTAL_FIELDS}
        missing = sorted(_keys_of_handler_dicts() - catalogued)
        assert missing == [], (
            f"portal.py can serve {missing}, but PUBLIC_PORTAL_FIELDS does not "
            "describe them. Add an entry — including whether the field "
            "identifies a person — so the screen can show and classify it."
        )

    def test_the_catalogue_offers_nothing_that_is_not_served(self):
        """A catalogued field no handler serves is an inert switch.

        CLAUDE.md #19: a setting whose only effect is being stored invites
        somebody to believe it does something.
        """
        served = _keys_of_handler_dicts()
        extra = sorted({(f.category, f.name) for f in PUBLIC_PORTAL_FIELDS} - served)
        assert extra == [], (
            f"PUBLIC_PORTAL_FIELDS offers {extra}, which no handler in "
            "portal.py puts in a dictionary, so enabling one exposes nothing."
        )

    def test_entries_are_unique_and_described(self):
        keys = [(f.category, f.name) for f in PUBLIC_PORTAL_FIELDS]
        assert len(keys) == len(set(keys)), "duplicate catalogue entry"
        undescribed = [
            f"{f.category}.{f.name}"
            for f in PUBLIC_PORTAL_FIELDS
            if not f.description.strip()
        ]
        assert undescribed == [], "the screen renders and searches descriptions"


@pytest.mark.unit
class TestTheSensitivityClassification:
    """The judgement itself, named field by field.

    Asserted by name rather than by counting, so flipping one is a visible,
    deliberate edit to this list and not a number that still passes.
    """

    SENSITIVE = {
        ("organization", "phone"),
        ("organization", "email"),
        ("organization", "mailing_address"),
        ("organization", "physical_address"),
    }

    def test_exactly_the_personal_contact_fields_are_sensitive(self):
        marked = {(f.category, f.name) for f in PUBLIC_PORTAL_FIELDS if f.is_sensitive}
        assert marked == self.SENSITIVE

    def test_no_aggregate_statistic_is_marked(self):
        """A count names nobody; marking it would train the badge away."""
        stats = [f for f in PUBLIC_PORTAL_FIELDS if f.category == "stats"]
        assert stats, "the stats category disappeared"
        assert not any(f.is_sensitive for f in stats)


def _entry(category: str, field_name: str, **kwargs) -> SimpleNamespace:
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        id=uuid.uuid4(),
        organization_id=uuid.uuid4(),
        data_category=category,
        field_name=field_name,
        is_enabled=kwargs.get("is_enabled", False),
        created_at=now,
        updated_at=now,
    )


@pytest.mark.unit
class TestTheResponseCarriesTheBadge:
    def test_a_sensitive_field_reports_itself_as_one(self):
        response = PublicPortalDataWhitelistResponse.from_entry(
            _entry("organization", "email")
        )
        assert response.is_sensitive is True
        assert response.description

    def test_an_ordinary_field_does_not(self):
        response = PublicPortalDataWhitelistResponse.from_entry(
            _entry("organization", "name")
        )
        assert response.is_sensitive is False

    def test_category_is_served_under_both_names(self):
        """The screen groups on `category`; grouping on undefined put every
        field in one section called "Undefined" and threw as soon as an
        administrator typed in the search box."""
        response = PublicPortalDataWhitelistResponse.from_entry(
            _entry("events", "title")
        )
        assert response.category == "events"
        assert response.data_category == "events"

    def test_an_uncatalogued_row_is_reported_plainly(self):
        """The admin API accepts any category and field name."""
        response = PublicPortalDataWhitelistResponse.from_entry(
            _entry("something", "made_up")
        )
        assert response.is_sensitive is False
        assert response.description is None
        assert catalogue_entry("something", "made_up") is None


async def _make_config(db: AsyncSession, org_id: str) -> str:
    config = PublicPortalConfig(
        organization_id=org_id,
        enabled=False,
        allowed_origins=[],
        default_rate_limit=1000,
        cache_ttl_seconds=300,
        settings={},
    )
    db.add(config)
    await db.flush()
    return str(config.id)


async def _rows(db: AsyncSession, org_id: str) -> list[PublicPortalDataWhitelist]:
    result = await db.execute(
        select(PublicPortalDataWhitelist).where(
            PublicPortalDataWhitelist.organization_id == org_id
        )
    )
    return list(result.scalars().all())


@pytest.mark.integration
class TestTheScreenHasSomethingToShow:
    async def test_every_catalogue_field_gets_a_disabled_row(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        await _make_config(db_session, org_id)

        await _ensure_catalogue_rows(db_session, org_id)

        rows = await _rows(db_session, org_id)
        assert {(r.data_category, r.field_name) for r in rows} == {
            (f.category, f.name) for f in PUBLIC_PORTAL_FIELDS
        }
        # Disabled is what makes this safe to run on an existing department:
        # filter_data_by_whitelist treats a disabled row and a missing one
        # identically, so nothing new becomes public.
        assert all(r.is_enabled is False for r in rows)

    async def test_running_twice_creates_nothing_further(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        await _make_config(db_session, org_id)

        await _ensure_catalogue_rows(db_session, org_id)
        first = len(await _rows(db_session, org_id))
        await _ensure_catalogue_rows(db_session, org_id)

        assert (
            len(await _rows(db_session, org_id)) == first == len(PUBLIC_PORTAL_FIELDS)
        )

    async def test_an_enabled_field_is_not_reset(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        """The decisions a department has already made are the whole point."""
        org_id, _ = setup_org_and_admin
        config_id = await _make_config(db_session, org_id)
        db_session.add(
            PublicPortalDataWhitelist(
                organization_id=org_id,
                config_id=config_id,
                data_category="organization",
                field_name="name",
                is_enabled=True,
            )
        )
        await db_session.flush()

        await _ensure_catalogue_rows(db_session, org_id)

        rows = await _rows(db_session, org_id)
        enabled = [r for r in rows if r.is_enabled]
        assert len(enabled) == 1
        assert enabled[0].field_name == "name"
        assert len(rows) == len(PUBLIC_PORTAL_FIELDS)

    async def test_an_uncatalogued_row_survives(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        """A hand-added field, or one a later release stopped serving."""
        org_id, _ = setup_org_and_admin
        config_id = await _make_config(db_session, org_id)
        db_session.add(
            PublicPortalDataWhitelist(
                organization_id=org_id,
                config_id=config_id,
                data_category="legacy",
                field_name="retired_field",
                is_enabled=True,
            )
        )
        await db_session.flush()

        await _ensure_catalogue_rows(db_session, org_id)

        rows = await _rows(db_session, org_id)
        assert ("legacy", "retired_field") in {
            (r.data_category, r.field_name) for r in rows
        }
        assert len(rows) == len(PUBLIC_PORTAL_FIELDS) + 1

    async def test_no_configuration_means_no_rows(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        """config_id is NOT NULL, so there is nothing to attach them to."""
        org_id, _ = setup_org_and_admin

        await _ensure_catalogue_rows(db_session, org_id)

        assert await _rows(db_session, org_id) == []

    async def test_rows_are_scoped_to_the_organization(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        other_org = str(uuid.uuid4())
        await db_session.execute(
            text(
                "INSERT INTO organizations "
                "(id, name, organization_type, slug, timezone) "
                "VALUES (:id, 'Other', 'fire_department', :slug, 'UTC')"
            ),
            {"id": other_org, "slug": f"other-{other_org[:8]}"},
        )
        await _make_config(db_session, org_id)
        await _make_config(db_session, other_org)

        await _ensure_catalogue_rows(db_session, org_id)

        assert await _rows(db_session, other_org) == []
        assert len(await _rows(db_session, org_id)) == len(PUBLIC_PORTAL_FIELDS)


@pytest.mark.integration
class TestTheEndpointServesTheBadge:
    """The handler, composed — the two halves above are each other's blind spot.

    A response that carries `is_sensitive` still shows no badge if the screen
    has no rows to draw, and rows still show no badge if the response drops
    the field. Only calling the handler proves an administrator sees one.
    """

    async def test_a_fresh_department_gets_a_classified_list(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        await _make_config(db_session, org_id)
        caller = SimpleNamespace(organization_id=org_id)

        # category=None explicitly: called directly rather than through the
        # app, the parameter keeps its `Query(None)` default, which is a
        # truthy object and would filter on it. FastAPI resolves it to None.
        served = await get_data_whitelist(
            current_user=caller, db=db_session, category=None
        )

        assert len(served) == len(PUBLIC_PORTAL_FIELDS)
        badged = {r.field_name for r in served if r.is_sensitive}
        assert badged == {"phone", "email", "mailing_address", "physical_address"}
        assert all(r.category == r.data_category for r in served)
        assert all(r.description for r in served)
        # Default deny is unchanged: the list is a set of decisions to make,
        # not a set already made.
        assert not any(r.is_enabled for r in served)

    async def test_one_category_can_be_asked_for(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        await _make_config(db_session, org_id)
        caller = SimpleNamespace(organization_id=org_id)

        served = await get_data_whitelist(
            current_user=caller, db=db_session, category="stats"
        )

        assert served
        assert {r.data_category for r in served} == {"stats"}
