"""
Facilities Service Unit Tests

Focused on FAC2-1: the sub-entity update paths must re-validate a reassigned
parent FK (facility_id / utility_account_id / checklist_id) in the caller's
org, mirroring their create paths. Without this, `_apply_updates`' blind
setattr (and the two hand-rolled setattr loops) let a row be re-parented onto
another org's facility.

Mocked sessions/getters — no DB — so it runs in the sandbox.
"""

import inspect
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy.dialects import mysql

from app.models.facilities import Facility, FacilityComplianceItem, FacilityPhoto
from app.schemas.facilities import (
    EmergencyContactTypeEnum,
    FacilityAccessKeyUpdate,
    FacilityCapitalProjectUpdate,
    FacilityComplianceItemCreate,
    FacilityComplianceItemResponse,
    FacilityComplianceItemUpdate,
    FacilityDocumentResponse,
    FacilityEmergencyContactCreate,
    FacilityOccupantUpdate,
    FacilityPhotoResponse,
    FacilityRoomUpdate,
)
from app.services.facilities_service import FacilitiesService
from app.utils.model_updates import apply_updates


@pytest.fixture
def mock_db():
    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    db.execute = AsyncMock()
    return db


@pytest.fixture
def service(mock_db):
    return FacilitiesService(mock_db)


@pytest.fixture
def org_id():
    return str(uuid4())


class TestAssertFacilityInOrg:
    """The shared helper used by every facility_id-bearing update path."""

    async def test_foreign_facility_raises(self, service, org_id):
        with patch.object(service, "get_facility", return_value=None):
            with pytest.raises(ValueError, match="Invalid facility"):
                await service._assert_facility_in_org(str(uuid4()), org_id)

    async def test_none_facility_is_noop(self, service, org_id):
        with patch.object(service, "get_facility", return_value=None) as mock_get:
            await service._assert_facility_in_org(None, org_id)
        mock_get.assert_not_awaited()

    async def test_in_org_facility_passes(self, service, org_id):
        with patch.object(service, "get_facility", return_value=MagicMock()):
            await service._assert_facility_in_org(str(uuid4()), org_id)  # no raise


class TestDashboardCounts:
    async def test_counts_are_unpaginated_database_aggregates(
        self, service, mock_db, org_id
    ):
        mock_db.scalar.side_effect = [125, 98, 17, 9]

        result = await service.get_dashboard_counts(org_id)

        assert result == {
            "total_facilities": 125,
            "operational_facilities": 98,
            "overdue_maintenance": 17,
            "upcoming_inspections": 9,
        }
        assert mock_db.scalar.await_count == 4

    async def test_null_database_counts_become_zero(self, service, mock_db, org_id):
        mock_db.scalar.side_effect = [None, None, None, None]

        result = await service.get_dashboard_counts(org_id)

        assert set(result.values()) == {0}

    async def test_dashboard_summary_uses_globally_ordered_preview_queries(
        self, service, mock_db, org_id
    ):
        service.get_dashboard_counts = AsyncMock(
            return_value={
                "total_facilities": 125,
                "operational_facilities": 98,
                "overdue_maintenance": 17,
                "upcoming_inspections": 9,
            }
        )
        overdue = SimpleNamespace(
            id="maint-overdue",
            facility_id="facility-1",
            description="Repair bay door",
            due_date=None,
            completed_date=None,
            updated_at=None,
        )
        inspection = SimpleNamespace(
            id="inspection-next",
            facility_id="facility-2",
            title="Annual inspection",
            next_inspection_date="2026-08-21",
        )
        completed = SimpleNamespace(
            id="maint-complete",
            facility_id="facility-3",
            description="Generator service",
            due_date=None,
            completed_date="2026-08-19",
            updated_at=None,
        )
        mock_db.execute.side_effect = [
            SimpleNamespace(all=lambda: [(overdue, "Station 1")]),
            SimpleNamespace(all=lambda: [(inspection, "Station 2")]),
            SimpleNamespace(all=lambda: [(completed, "Station 3")]),
        ]

        result = await service.get_dashboard_summary(org_id)

        assert result["overdue_maintenance_records"][0]["facility_name"] == "Station 1"
        assert result["upcoming_inspection_records"][0]["facility_name"] == "Station 2"
        assert (
            result["recent_maintenance_completions"][0]["facility_name"] == "Station 3"
        )
        assert mock_db.execute.await_count == 3

        # The production database is MySQL/MariaDB, which rejects the
        # PostgreSQL-style ``NULLS LAST`` modifier.  The preview queries must
        # express null placement portably so opening the dashboard does not
        # fail with LB-SYS-001.
        statements = [call.args[0] for call in mock_db.execute.await_args_list]
        compiled_sql = "\n".join(
            str(statement.compile(dialect=mysql.dialect())) for statement in statements
        )
        assert "NULLS LAST" not in compiled_sql.upper()
        assert "facility_maintenance.due_date IS NULL" in compiled_sql
        assert "facility_maintenance.completed_date IS NULL" in compiled_sql


class TestUpdateReparentingRejected:
    """A reassigned parent FK that isn't in-org is rejected before any write."""

    async def test_room_rejects_foreign_facility(self, service, org_id):
        with (
            patch.object(service, "get_room", return_value=MagicMock()),
            patch.object(service, "get_facility", return_value=None),
        ):
            with pytest.raises(ValueError, match="Invalid facility"):
                await service.update_room(
                    str(uuid4()),
                    FacilityRoomUpdate(facility_id=str(uuid4())),
                    org_id,
                )

    async def test_occupant_rejects_foreign_facility(self, service, org_id):
        with (
            patch.object(service, "get_occupant", return_value=MagicMock()),
            patch.object(service, "get_facility", return_value=None),
        ):
            with pytest.raises(ValueError, match="Invalid facility"):
                await service.update_occupant(
                    str(uuid4()),
                    FacilityOccupantUpdate(facility_id=str(uuid4())),
                    org_id,
                )

    async def test_capital_project_rejects_foreign_facility(self, service, org_id):
        with (
            patch.object(service, "get_capital_project", return_value=MagicMock()),
            patch.object(service, "get_facility", return_value=None),
        ):
            with pytest.raises(ValueError, match="Invalid facility"):
                await service.update_capital_project(
                    str(uuid4()),
                    FacilityCapitalProjectUpdate(facility_id=str(uuid4())),
                    org_id,
                )

    async def test_access_key_rejects_foreign_facility(self, service, org_id):
        with (
            patch.object(service, "get_access_key", return_value=MagicMock()),
            patch.object(service, "get_facility", return_value=None),
        ):
            with pytest.raises(ValueError, match="Invalid facility"):
                await service.update_access_key(
                    str(uuid4()),
                    FacilityAccessKeyUpdate(facility_id=str(uuid4())),
                    org_id,
                )

    async def test_compliance_item_rejects_foreign_checklist(self, service, org_id):
        with (
            patch.object(service, "get_compliance_item", return_value=MagicMock()),
            patch.object(service, "get_compliance_checklist", return_value=None),
        ):
            with pytest.raises(ValueError, match="Invalid compliance checklist"):
                await service.update_compliance_item(
                    str(uuid4()),
                    FacilityComplianceItemUpdate(checklist_id=str(uuid4())),
                    org_id,
                )


class TestUpdateWithoutReparentingSkipsCheck:
    """An update that doesn't touch the parent FK never queries it."""

    async def test_occupant_no_facility_change_skips_validation(self, service, org_id):
        occupant = MagicMock()
        with (
            patch.object(service, "get_occupant", return_value=occupant),
            patch.object(service, "get_facility", return_value=None) as mock_get,
            patch.object(service, "_apply_updates", new_callable=AsyncMock),
        ):
            result = await service.update_occupant(
                str(uuid4()), FacilityOccupantUpdate(unit_name="Bay 2"), org_id
            )
        assert result is occupant
        mock_get.assert_not_awaited()


class TestNullabilityGuard:
    """FAC-7: an explicit null on a NOT NULL column must fail clean (a
    ValueError the endpoint turns into 400), not reach flush and raise a raw
    IntegrityError (500). `Facility.name` and `FacilityPhoto.is_primary` are
    the two columns a Codex review on PR #1836 named as reachable via
    `update_facility`/`update_photo`'s (former) blind `setattr` loops.
    """

    def test_facility_name_cannot_be_nulled(self):
        facility = Facility(name="Station 1", organization_id=str(uuid4()))
        with pytest.raises(ValueError, match="cannot be cleared"):
            apply_updates(facility, {"name": None})

    def test_photo_is_primary_cannot_be_nulled(self):
        photo = FacilityPhoto(is_primary=True)
        with pytest.raises(ValueError, match="cannot be cleared"):
            apply_updates(photo, {"is_primary": None})

    @pytest.mark.parametrize(
        "method_name",
        [
            "_apply_updates",
            "update_facility",
            "update_photo",
            "update_maintenance_record",
            "update_inspection",
            "update_capital_project",
            "update_insurance_policy",
        ],
    )
    def test_update_methods_route_through_the_shared_guard(self, method_name):
        """Every update path that used to hand-roll `for field, value in
        update_data.items(): setattr(...)` must route through the shared
        `apply_updates` utility instead, or a future edit can silently
        reintroduce the null-on-NOT-NULL 500."""
        source = inspect.getsource(getattr(FacilitiesService, method_name))
        assert "apply_updates(" in source
        assert "for field, value in update_data.items()" not in source


class TestFacilityFileResponseRedaction:
    """FAC-8: `file_path` is an internal storage location, not something a
    baseline `facilities.view` holder should learn — mirrors the generic
    Documents module's `DocumentResponse`, which excludes the same field."""

    def test_photo_response_excludes_file_path(self):
        assert "file_path" not in FacilityPhotoResponse.model_fields

    def test_document_response_excludes_file_path(self):
        assert "file_path" not in FacilityDocumentResponse.model_fields


class TestCreateComplianceItem:
    """FAC-46: the only caller of `create_compliance_item`
    (`POST /compliance-checklists/{checklist_id}/items`) passes
    `checklist_id=checklist_id` as a keyword argument the method did not
    accept — `TypeError: create_compliance_item() got an unexpected keyword
    argument 'checklist_id'` on every single call, unconditionally (not a
    race, not an edge case). Not caught by the endpoint's `except ValueError`
    handler, so it reached the client as a raw 500. Verified directly against
    the method's real signature via `inspect.signature(...).bind(...)`
    with the endpoint's exact call shape, both before this fix (raised
    `TypeError`) and after (binds cleanly) — see the PR description for the
    `git stash`-isolated confirmation against the pre-fix source.

    Separately, the request body's `checklist_id` field was *required*
    (`FacilityComplianceItemCreate.checklist_id: str`) while the shipped,
    unused frontend service method (`facilitiesServices.ts`'s
    `createComplianceItem`) never sends it — so even a caller who supplied
    the right keyword arguments would have 422'd at the schema layer before
    ever reaching this method. The field is now optional and ignored; the
    URL path's checklist_id is the sole, authoritative source, matching
    `list_compliance_items`' own explicit `checklist_id` parameter.
    """

    async def test_item_is_created_under_the_path_checklist(self, service, org_id):
        checklist_id = str(uuid4())
        checklist = MagicMock()
        with patch.object(service, "get_compliance_checklist", return_value=checklist):
            item = await service.create_compliance_item(
                checklist_id=checklist_id,
                item_data=FacilityComplianceItemCreate(description="Exit lights"),
                organization_id=org_id,
                created_by=str(uuid4()),
            )
        assert item.checklist_id == checklist_id
        assert item.description == "Exit lights"

    async def test_a_mismatched_body_checklist_id_is_ignored_not_trusted(
        self, service, org_id
    ):
        """The URL path is authoritative — a caller cannot attach an item to
        a different checklist by setting a mismatched value in the body."""
        path_checklist_id = str(uuid4())
        body_checklist_id = str(uuid4())
        checklist = MagicMock()
        with patch.object(service, "get_compliance_checklist", return_value=checklist):
            item = await service.create_compliance_item(
                checklist_id=path_checklist_id,
                item_data=FacilityComplianceItemCreate(
                    checklist_id=body_checklist_id, description="Exit lights"
                ),
                organization_id=org_id,
                created_by=str(uuid4()),
            )
        assert item.checklist_id == path_checklist_id

    async def test_invalid_checklist_raises_clean_value_error(self, service, org_id):
        """A checklist outside the caller's org (or missing) is a 400, not a
        500 — the endpoint's `except ValueError` handler covers this."""
        with patch.object(service, "get_compliance_checklist", return_value=None):
            with pytest.raises(ValueError, match="Invalid compliance checklist"):
                await service.create_compliance_item(
                    checklist_id=str(uuid4()),
                    item_data=FacilityComplianceItemCreate(description="x"),
                    organization_id=org_id,
                    created_by=str(uuid4()),
                )

    def test_endpoint_call_shape_binds_against_the_real_signature(self):
        """Source-inspection guard: the endpoint
        (`api/v1/endpoints/facilities.py::create_facility_compliance_item`)
        calls `service.create_compliance_item(checklist_id=..., item_data=...,
        organization_id=..., created_by=...)`. Bind that exact call shape
        against the real method signature so a future signature edit that
        reopens the mismatch fails here instead of only at runtime."""
        import inspect

        sig = inspect.signature(FacilitiesService.create_compliance_item)
        sig.bind(
            None,  # self
            checklist_id="x",
            item_data=object(),
            organization_id="org",
            created_by="user",
        )

    async def test_sort_order_is_stored_as_item_number(self, service, org_id):
        """Codex review of the FAC-46 fix, PR #2425: the frontend's already-
        shipped `ComplianceItemCreate.sort_order` (facilitiesServices.ts) and
        the schema's `item_number` field were different names for the same
        thing, so a real caller's `sort_order` was silently dropped by
        Pydantic rather than stored — the request would succeed with the
        requested ordering quietly lost. The schema field is now named
        `sort_order` to match; the ORM column stays `item_number`
        (unchanged, no migration) and the service translates between them.
        """
        checklist = MagicMock()
        with patch.object(service, "get_compliance_checklist", return_value=checklist):
            item = await service.create_compliance_item(
                checklist_id=str(uuid4()),
                item_data=FacilityComplianceItemCreate(
                    description="Exit lights", sort_order=3
                ),
                organization_id=org_id,
                created_by=str(uuid4()),
            )
        assert item.item_number == 3
        assert not hasattr(item, "sort_order")

    def test_response_serializes_item_number_as_sort_order(self):
        """The other half of the same finding: a response built from the ORM
        row must expose the frontend's expected `sortOrder` key, not the
        model's own `itemNumber`. `FacilityComplianceItemResponse` reads the
        model's `item_number` attribute (`validation_alias`) but serializes
        it under `sortOrder` (`serialization_alias`), matching
        `ComplianceItem.sortOrder` in facilitiesServices.ts.
        """
        item = FacilityComplianceItem(
            id=str(uuid4()),
            organization_id=str(uuid4()),
            checklist_id=str(uuid4()),
            item_number=7,
            description="Exit lights",
            corrective_action_completed=False,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        payload = FacilityComplianceItemResponse.model_validate(item).model_dump(
            by_alias=True
        )
        assert payload["sortOrder"] == 7
        assert "itemNumber" not in payload
        assert "item_number" not in payload


class TestUpdateComplianceItem:
    """Codex review of the FAC-46 fix, PR #2425 -- the update path has the
    identical sort_order/item_number translation need as create above, and
    without it `apply_updates` would reject `sort_order` outright as an
    unknown field on `FacilityComplianceItem` (it only maps to real column
    names) rather than silently dropping it.
    """

    async def test_sort_order_update_is_applied_to_item_number(self, service, org_id):
        item = FacilityComplianceItem(
            id=str(uuid4()),
            organization_id=org_id,
            checklist_id=str(uuid4()),
            item_number=1,
            description="Exit lights",
            corrective_action_completed=False,
        )
        with patch.object(service, "get_compliance_item", return_value=item):
            updated = await service.update_compliance_item(
                item_id=item.id,
                item_data=FacilityComplianceItemUpdate(sort_order=9),
                organization_id=org_id,
            )
        assert updated.item_number == 9


class TestCreateEmergencyContact:
    """FAC-46: `create_emergency_contact` passed `created_by=created_by` into
    `FacilityEmergencyContact(...)` — but that model has no `created_by`
    column (only its sibling `FacilityComplianceChecklist` does; this one
    tracks no author). SQLAlchemy's declarative constructor rejects any
    keyword that isn't a mapped attribute, so this raised
    `TypeError: 'created_by' is an invalid keyword argument for
    FacilityEmergencyContact` on every call — unconditionally, not a race —
    and unlike the compliance-item bug above, `POST /facilities/emergency-
    contacts` is wired to real, shipped UI (`ContactsSection.tsx`'s "Add
    Emergency Contact" form), so every attempt to add one has been failing
    with a raw 500 for every organization using this screen.

    Found by a repository-wide static sweep (AST-walking every
    `Model(...)` call site in facilities_service.py against the model's
    actual mapped attributes, both explicit keywords and `**schema.
    model_dump()` spreads) after the identical bug was found by hand in
    `create_compliance_item` — see TestCreateComplianceItem above. The
    sweep found exactly these two instances and no others.
    """

    async def test_contact_is_created_without_crashing(self, service, org_id):
        facility = MagicMock()
        with patch.object(service, "get_facility", return_value=facility):
            contact = await service.create_emergency_contact(
                contact_data=FacilityEmergencyContactCreate(
                    facility_id=str(uuid4()),
                    contact_type=EmergencyContactTypeEnum.ALARM_COMPANY,
                    company_name="Acme Alarm Co.",
                ),
                organization_id=org_id,
                created_by=str(uuid4()),
            )
        assert contact.company_name == "Acme Alarm Co."


class TestModelConstructorsMatchTheirColumns:
    """Guards the whole bug class FAC-46 belongs to, not just its two known
    instances: every `Model(...)` call in this file — explicit keywords and
    `**schema.model_dump()` spreads alike — must only ever pass attributes
    the target model actually maps. A future create method copying the same
    `created_by=created_by` pattern onto a model without that column fails
    here instead of shipping silently, the way these two did.
    """

    def test_no_constructor_call_passes_an_unmapped_keyword(self):
        import ast

        def class_attrs(src: str) -> dict[str, set[str]]:
            out: dict[str, set[str]] = {}
            for node in ast.walk(ast.parse(src)):
                if isinstance(node, ast.ClassDef):
                    attrs: set[str] = set()
                    for stmt in node.body:
                        if isinstance(stmt, ast.Assign):
                            attrs.update(
                                t.id for t in stmt.targets if isinstance(t, ast.Name)
                            )
                        elif isinstance(stmt, ast.AnnAssign) and isinstance(
                            stmt.target, ast.Name
                        ):
                            attrs.add(stmt.target.id)
                    if attrs:
                        out[node.name] = attrs
            return out

        models_path = inspect.getfile(Facility).replace(".pyc", ".py")
        services_path = inspect.getfile(FacilitiesService)
        model_attrs = class_attrs(open(models_path).read())
        schema_attrs = class_attrs(
            open(
                services_path.replace(
                    "services/facilities_service", "schemas/facilities"
                )
            ).read()
        )
        tree = ast.parse(open(services_path).read())

        explicit_issues = []
        spread_issues = []
        for fn in ast.walk(tree):
            if not isinstance(fn, ast.AsyncFunctionDef):
                continue
            param_types = {}
            for arg in fn.args.args:
                if arg.annotation is not None:
                    ann = arg.annotation
                    name = (
                        ann.id
                        if isinstance(ann, ast.Name)
                        else getattr(ann, "attr", None)
                    )
                    if name:
                        param_types[arg.arg] = name
            for node in ast.walk(fn):
                if not (
                    isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Name)
                    and node.func.id in model_attrs
                ):
                    continue
                model_cls = node.func.id
                allowed = model_attrs[model_cls]
                for kw in node.keywords:
                    if kw.arg is not None and kw.arg not in allowed:
                        explicit_issues.append(
                            f"{fn.name}:{node.lineno} {model_cls}({kw.arg}=...)"
                        )
                    elif kw.arg is None and isinstance(kw.value, ast.Call):
                        call = kw.value
                        if (
                            isinstance(call.func, ast.Attribute)
                            and call.func.attr == "model_dump"
                            and isinstance(call.func.value, ast.Name)
                            and call.func.value.id in param_types
                        ):
                            schema_cls = param_types[call.func.value.id]
                            if schema_cls in schema_attrs:
                                excluded = {
                                    elt.value
                                    for mdkw in call.keywords
                                    if mdkw.arg == "exclude"
                                    and isinstance(mdkw.value, ast.Set)
                                    for elt in mdkw.value.elts
                                    if isinstance(elt, ast.Constant)
                                }
                                missing = (
                                    schema_attrs[schema_cls] - excluded
                                ) - allowed
                                if missing:
                                    spread_issues.append(
                                        f"{fn.name}:{node.lineno} "
                                        f"{model_cls}(**{schema_cls}.model_dump()) "
                                        f"has unmapped fields: {sorted(missing)}"
                                    )

        assert not explicit_issues, explicit_issues
        assert not spread_issues, spread_issues
