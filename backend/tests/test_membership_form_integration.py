"""
Membership Form Integration Tests

Tests for the _ensure_membership_form_integration method on
MembershipPipelineService, covering:
 - Direct path: setting integration_type on the Form itself
 - Legacy path: creating/repairing FormIntegration records

These tests mock the database layer and verify the service logic.
"""

import sys
from types import ModuleType
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

# ---------------------------------------------------------------------------
# Module-level shims — ensure the transitive import chain resolves even when
# optional backend dependencies (jwt, redis, authlib, …) are not installed.
# We only need MembershipPipelineService + its model constants, so we stub
# everything else.
# ---------------------------------------------------------------------------

def _stub(name: str) -> ModuleType:
    """Create a stub module that returns MagicMock for any attribute access."""
    mod = ModuleType(name)
    mod.__dict__.setdefault("__all__", [])
    mod.__dict__.setdefault("__path__", [])
    # Allow arbitrary attribute access (e.g. argon2.PasswordHasher)
    mod.__class__ = type(
        "StubModule",
        (ModuleType,),
        {"__getattr__": lambda self, attr: MagicMock()},
    )
    return mod


_STUB_MODULES = [
    "jwt", "redis", "redis.asyncio",
    "authlib", "authlib.integrations", "authlib.integrations.starlette_client",
    "celery", "celery.result", "stripe",
    "fastapi", "fastapi.security", "fastapi.templating",
    "fastapi.responses", "fastapi.routing",
    "fastapi.middleware", "fastapi.middleware.cors",
    "fastapi_mail", "sentry_sdk",
    "twilio", "twilio.rest", "pyotp",
    "argon2", "argon2.exceptions", "bcrypt",
    "cryptography", "cryptography.hazmat", "cryptography.hazmat._oid",
    "cryptography.hazmat.primitives", "cryptography.hazmat.primitives.asymmetric",
    "cryptography.hazmat.primitives.asymmetric.ec",
    "cryptography.hazmat.primitives.ciphers",
    "cryptography.hazmat.primitives.ciphers.algorithms",
    "cryptography.hazmat.primitives.ciphers.modes",
    "cryptography.hazmat.primitives.kdf", "cryptography.hazmat.primitives.kdf.pbkdf2",
    "cryptography.hazmat.primitives.padding", "cryptography.hazmat.primitives.hashes",
    "cryptography.hazmat.backends", "cryptography.fernet",
    "ldap3", "onelogin", "onelogin.saml2", "onelogin.saml2.auth",
    "cffi", "_cffi_backend",
    "aiomysql", "jinja2", "httpx",
    "starlette", "starlette.requests", "starlette.responses",
    "starlette.middleware", "starlette.middleware.base",
    "starlette.types",
    "elasticsearch",
    "minio",
]

for _mod_name in _STUB_MODULES:
    if _mod_name not in sys.modules:
        sys.modules[_mod_name] = _stub(_mod_name)

# Now safe to import the services under test.
from app.services.membership_pipeline_service import MembershipPipelineService  # noqa: E402
from app.services.forms_service import FormsService  # noqa: E402


# ============================================
# Helpers
# ============================================


def _make_field(label: str, field_type: str = "text", field_id: str | None = None):
    """Create a mock FormField with the given label and type."""
    field = MagicMock()
    field.id = field_id or str(uuid4())
    field.label = label
    field.field_type = field_type
    return field


def _make_form(integration_type=None):
    """Create a mock Form with an optional integration_type."""
    form = MagicMock()
    form.integration_type = integration_type
    return form


def _make_result_chain(*items):
    """Build a mock result supporting .scalars().first() / .scalars().all()."""
    mock_result = MagicMock()
    scalars = MagicMock()
    scalars.first.return_value = items[0] if items else None
    scalars.all.return_value = list(items)
    mock_result.scalars.return_value = scalars
    return mock_result


# ============================================
# Fixtures
# ============================================


@pytest.fixture
def mock_db():
    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.rollback = AsyncMock()
    db.refresh = AsyncMock()
    db.execute = AsyncMock()
    return db


@pytest.fixture
def service(mock_db):
    return MembershipPipelineService(mock_db)


@pytest.fixture
def form_id():
    return str(uuid4())


@pytest.fixture
def org_id():
    return str(uuid4())


# ============================================
# Tests — direct path (form.integration_type)
# ============================================


class TestDirectPath:
    """When a Form exists without integration_type, the method should
    set it directly instead of creating a FormIntegration record."""

    async def test_sets_integration_type_on_form(
        self, service, mock_db, form_id, org_id
    ):
        form = _make_form(integration_type=None)
        mock_db.execute.side_effect = [
            _make_result_chain(form),  # Form query
        ]

        await service._ensure_membership_form_integration(form_id, org_id)

        assert form.integration_type == "membership_interest"
        mock_db.commit.assert_called_once()
        # No FormIntegration should be created
        assert not mock_db.add.called

    async def test_noop_when_already_membership_interest(
        self, service, mock_db, form_id, org_id
    ):
        form = _make_form(integration_type="membership_interest")
        mock_db.execute.side_effect = [
            _make_result_chain(form),  # Form query
        ]

        await service._ensure_membership_form_integration(form_id, org_id)

        mock_db.commit.assert_not_called()
        assert not mock_db.add.called

    async def test_warns_when_form_not_found(
        self, service, mock_db, form_id, org_id
    ):
        mock_db.execute.side_effect = [
            _make_result_chain(),  # Form query — not found
        ]

        await service._ensure_membership_form_integration(form_id, org_id)

        mock_db.commit.assert_not_called()
        assert not mock_db.add.called


# ============================================
# Tests — legacy path (FormIntegration records)
# When form.integration_type is set to something *other* than
# membership_interest, the method falls through to the legacy
# FormIntegration-based path.
# ============================================


class TestLegacyPathCreatesNew:
    """When no integration exists, a new one should be created."""

    async def test_creates_integration_with_matching_labels(
        self, service, mock_db, form_id, org_id
    ):
        form = _make_form(integration_type="equipment_assignment")
        fields = [
            _make_field("First Name"),
            _make_field("Last Name"),
            _make_field("Email Address"),
            _make_field("Phone Number"),
        ]
        mock_db.execute.side_effect = [
            _make_result_chain(form),       # Form query
            _make_result_chain(),            # no existing integration
            _make_result_chain(*fields),     # form fields
        ]

        await service._ensure_membership_form_integration(form_id, org_id)

        assert mock_db.add.called
        integration = mock_db.add.call_args[0][0]
        mappings = integration.field_mappings
        assert mappings[str(fields[0].id)] == "first_name"
        assert mappings[str(fields[1].id)] == "last_name"
        assert mappings[str(fields[2].id)] == "email"
        assert mappings[str(fields[3].id)] == "phone"

    async def test_skips_when_no_fields(self, service, mock_db, form_id, org_id):
        form = _make_form(integration_type="equipment_assignment")
        mock_db.execute.side_effect = [
            _make_result_chain(form),   # Form query
            _make_result_chain(),       # no existing integration
            _make_result_chain(),       # no fields
        ]

        await service._ensure_membership_form_integration(form_id, org_id)

        assert not mock_db.add.called

    async def test_skips_when_no_mappable_fields(self, service, mock_db, form_id, org_id):
        form = _make_form(integration_type="equipment_assignment")
        fields = [_make_field("Favorite Color"), _make_field("Preferred Shift")]
        mock_db.execute.side_effect = [
            _make_result_chain(form),        # Form query
            _make_result_chain(),             # no existing integration
            _make_result_chain(*fields),      # unmappable fields
        ]

        await service._ensure_membership_form_integration(form_id, org_id)

        assert not mock_db.add.called


class TestLegacyPathRepairsExisting:
    """Existing integration with bad field_mappings should be repaired."""

    async def test_repairs_empty_field_mappings(
        self, service, mock_db, form_id, org_id
    ):
        form = _make_form(integration_type="equipment_assignment")
        fields = [
            _make_field("First Name"),
            _make_field("Last Name"),
            _make_field("Email"),
        ]
        existing = MagicMock()
        existing.field_mappings = {}

        mock_db.execute.side_effect = [
            _make_result_chain(form),          # Form query
            _make_result_chain(existing),       # existing integration
            _make_result_chain(*fields),        # form fields
        ]

        await service._ensure_membership_form_integration(form_id, org_id)

        assert not mock_db.add.called
        assert existing.field_mappings != {}
        targets = set(existing.field_mappings.values())
        assert {"first_name", "last_name", "email"} <= targets
        mock_db.commit.assert_called()

    async def test_repairs_none_field_mappings(
        self, service, mock_db, form_id, org_id
    ):
        form = _make_form(integration_type="equipment_assignment")
        fields = [
            _make_field("First Name"),
            _make_field("Last Name"),
            _make_field("Email"),
        ]
        existing = MagicMock()
        existing.field_mappings = None

        mock_db.execute.side_effect = [
            _make_result_chain(form),         # Form query
            _make_result_chain(existing),      # existing integration
            _make_result_chain(*fields),       # form fields
        ]

        await service._ensure_membership_form_integration(form_id, org_id)

        assert not mock_db.add.called
        assert existing.field_mappings is not None
        assert "first_name" in existing.field_mappings.values()

    async def test_repairs_stale_field_ids(self, service, mock_db, form_id, org_id):
        form = _make_form(integration_type="equipment_assignment")
        old_id = str(uuid4())
        fields = [
            _make_field("First Name"),
            _make_field("Last Name"),
            _make_field("Email"),
        ]
        existing = MagicMock()
        existing.field_mappings = {old_id: "first_name"}

        mock_db.execute.side_effect = [
            _make_result_chain(form),           # Form query
            _make_result_chain(existing),        # existing integration
            _make_result_chain(*fields),         # form fields
        ]

        await service._ensure_membership_form_integration(form_id, org_id)

        assert not mock_db.add.called
        assert old_id not in existing.field_mappings
        targets = set(existing.field_mappings.values())
        assert {"first_name", "last_name", "email"} <= targets

    async def test_leaves_healthy_integration_alone(
        self, service, mock_db, form_id, org_id
    ):
        form = _make_form(integration_type="equipment_assignment")
        field_fn = _make_field("First Name")
        field_ln = _make_field("Last Name")
        field_em = _make_field("Email")
        fields = [field_fn, field_ln, field_em]

        existing = MagicMock()
        existing.field_mappings = {
            str(field_fn.id): "first_name",
            str(field_ln.id): "last_name",
            str(field_em.id): "email",
        }

        mock_db.execute.side_effect = [
            _make_result_chain(form),           # Form query
            _make_result_chain(existing),        # existing integration
            _make_result_chain(*fields),         # form fields
        ]

        await service._ensure_membership_form_integration(form_id, org_id)

        assert not mock_db.add.called
        # commit once for form lookup, but field_mappings unchanged
        # so repair path should NOT commit again
        assert mock_db.commit.call_count == 0

    async def test_repairs_when_missing_required_targets(
        self, service, mock_db, form_id, org_id
    ):
        form = _make_form(integration_type="equipment_assignment")
        field_fn = _make_field("First Name")
        field_ln = _make_field("Last Name")
        field_em = _make_field("Email")
        field_ph = _make_field("Phone")
        fields = [field_fn, field_ln, field_em, field_ph]

        existing = MagicMock()
        existing.field_mappings = {str(field_ph.id): "phone"}

        mock_db.execute.side_effect = [
            _make_result_chain(form),            # Form query
            _make_result_chain(existing),         # existing integration
            _make_result_chain(*fields),          # form fields
        ]

        await service._ensure_membership_form_integration(form_id, org_id)

        assert not mock_db.add.called
        targets = set(existing.field_mappings.values())
        assert {"first_name", "last_name", "email"} <= targets
        mock_db.commit.assert_called()


# ============================================
# Tests — _resolve_pipeline_for_form
# ============================================


class TestResolvePipelineForForm:
    """FormsService._resolve_pipeline_for_form should find the pipeline
    whose step references a given form_id in its config JSON."""

    @pytest.fixture
    def forms_service(self, mock_db):
        return FormsService(mock_db)

    async def test_returns_pipeline_id_when_step_references_form(
        self, forms_service, mock_db
    ):
        frm_id = str(uuid4())
        expected_pipeline_id = str(uuid4())

        mock_db.execute.return_value = _make_result_chain(expected_pipeline_id)

        result = await forms_service._resolve_pipeline_for_form(frm_id)

        assert result == expected_pipeline_id
        mock_db.execute.assert_called_once()

    async def test_returns_none_when_no_step_references_form(
        self, forms_service, mock_db
    ):
        frm_id = str(uuid4())

        mock_db.execute.return_value = _make_result_chain()  # No results

        result = await forms_service._resolve_pipeline_for_form(frm_id)

        assert result is None


# ============================================
# Tests — pipeline_id propagation in
# _process_membership_interest
# ============================================


def _make_submission(frm_id: str, org_id: str, data: dict):
    """Create a mock FormSubmission."""
    sub = MagicMock()
    sub.id = str(uuid4())
    sub.form_id = frm_id
    sub.organization_id = org_id
    sub.data = data
    return sub


def _make_form_with_fields(frm_id: str, fields: list, integration_type=None):
    """Create a mock Form with fields and integration_type."""
    form = MagicMock()
    form.id = frm_id
    form.fields = fields
    form.integrations = []
    form.integration_type = integration_type
    return form


def _make_prospect(prospect_id: str, form_submission_id: str | None = None):
    """Create a mock ProspectiveMember."""
    p = MagicMock()
    p.id = prospect_id
    p.form_submission_id = form_submission_id
    return p


class TestMembershipInterestPipelineId:
    """_process_membership_interest should resolve the correct pipeline_id
    from the form's linked pipeline step and pass it to create_prospect."""

    @pytest.fixture
    def forms_service(self, mock_db):
        return FormsService(mock_db)

    async def test_passes_resolved_pipeline_id_to_create_prospect(
        self, forms_service, mock_db
    ):
        frm_id = str(uuid4())
        org_id = str(uuid4())
        pipeline_id = str(uuid4())
        prospect_id = str(uuid4())

        fields = [
            _make_field("First Name"),
            _make_field("Last Name"),
            _make_field("Email", field_type="email"),
        ]
        form = _make_form_with_fields(frm_id, fields)

        data = {
            str(fields[0].id): "John",
            str(fields[1].id): "Doe",
            str(fields[2].id): "john@example.com",
        }
        submission = _make_submission(frm_id, org_id, data)

        # _resolve_pipeline_for_form runs first, then duplicate guard
        mock_db.execute.side_effect = [
            _make_result_chain(pipeline_id),   # _resolve_pipeline_for_form
            _make_result_chain(),              # duplicate guard (no existing)
        ]

        prospect = _make_prospect(prospect_id, str(submission.id))

        # Patch MembershipPipelineService.create_prospect
        import app.services.membership_pipeline_service as mps_mod
        original_init = mps_mod.MembershipPipelineService.__init__
        original_create = mps_mod.MembershipPipelineService.create_prospect

        captured_data = {}

        async def mock_create_prospect(self, organization_id, data, created_by=None):
            captured_data.update(data)
            return prospect

        mps_mod.MembershipPipelineService.__init__ = lambda self, db: None
        mps_mod.MembershipPipelineService.create_prospect = mock_create_prospect

        # Patch _complete_form_submission_step (added by main) to no-op
        original_complete = FormsService._complete_form_submission_step
        FormsService._complete_form_submission_step = AsyncMock()

        try:
            result = await forms_service._process_membership_interest(
                submission, integration=None, form=form
            )

            assert result["success"] is True
            assert result["prospect_id"] == prospect_id
            assert captured_data.get("pipeline_id") == pipeline_id
        finally:
            mps_mod.MembershipPipelineService.__init__ = original_init
            mps_mod.MembershipPipelineService.create_prospect = original_create
            FormsService._complete_form_submission_step = original_complete

    async def test_omits_pipeline_id_when_no_step_references_form(
        self, forms_service, mock_db
    ):
        frm_id = str(uuid4())
        org_id = str(uuid4())
        prospect_id = str(uuid4())

        fields = [
            _make_field("First Name"),
            _make_field("Last Name"),
            _make_field("Email", field_type="email"),
        ]
        form = _make_form_with_fields(frm_id, fields)

        data = {
            str(fields[0].id): "Jane",
            str(fields[1].id): "Doe",
            str(fields[2].id): "jane@example.com",
        }
        submission = _make_submission(frm_id, org_id, data)

        # _resolve_pipeline_for_form runs first, then duplicate guard
        mock_db.execute.side_effect = [
            _make_result_chain(),   # _resolve_pipeline_for_form → None
            _make_result_chain(),   # duplicate guard (no existing)
        ]

        prospect = _make_prospect(prospect_id, str(submission.id))

        import app.services.membership_pipeline_service as mps_mod
        original_init = mps_mod.MembershipPipelineService.__init__
        original_create = mps_mod.MembershipPipelineService.create_prospect

        captured_data = {}

        async def mock_create_prospect(self, organization_id, data, created_by=None):
            captured_data.update(data)
            return prospect

        mps_mod.MembershipPipelineService.__init__ = lambda self, db: None
        mps_mod.MembershipPipelineService.create_prospect = mock_create_prospect

        # Patch _complete_form_submission_step (added by main) to no-op
        original_complete = FormsService._complete_form_submission_step
        FormsService._complete_form_submission_step = AsyncMock()

        try:
            result = await forms_service._process_membership_interest(
                submission, integration=None, form=form
            )

            assert result["success"] is True
            # pipeline_id should NOT be in the data (falls back to default)
            assert "pipeline_id" not in captured_data
        finally:
            mps_mod.MembershipPipelineService.__init__ = original_init
            mps_mod.MembershipPipelineService.create_prospect = original_create
            FormsService._complete_form_submission_step = original_complete


# ============================================
# Tests — reprocess reassignment
# When an existing prospect was created in the wrong pipeline,
# reprocessing should move it to the correct one.
# ============================================


class TestReprocessReassignment:
    """When reprocessing a submission whose prospect already exists
    but is in the wrong pipeline, _process_membership_interest should
    call _reassign_prospect_pipeline to move it."""

    @pytest.fixture
    def forms_service(self, mock_db):
        return FormsService(mock_db)

    async def test_reassigns_prospect_when_pipeline_differs(
        self, forms_service, mock_db
    ):
        frm_id = str(uuid4())
        org_id = str(uuid4())
        correct_pipeline_id = str(uuid4())
        wrong_pipeline_id = str(uuid4())
        prospect_id = str(uuid4())

        fields = [
            _make_field("First Name"),
            _make_field("Last Name"),
            _make_field("Email", field_type="email"),
        ]
        form = _make_form_with_fields(frm_id, fields)

        data = {
            str(fields[0].id): "John",
            str(fields[1].id): "Doe",
            str(fields[2].id): "john@example.com",
        }
        submission = _make_submission(frm_id, org_id, data)

        # Existing prospect in the wrong pipeline
        existing_prospect = _make_prospect(prospect_id, str(submission.id))
        existing_prospect.pipeline_id = wrong_pipeline_id

        # _resolve_pipeline_for_form runs first, then duplicate guard
        mock_db.execute.side_effect = [
            _make_result_chain(correct_pipeline_id),  # _resolve_pipeline_for_form
            _make_result_chain(existing_prospect),     # duplicate guard → found
        ]

        # Patch _reassign_prospect_pipeline to track calls
        reassign_calls = []
        original_reassign = FormsService._reassign_prospect_pipeline

        async def mock_reassign(self, prospect, pipeline_id):
            reassign_calls.append((str(prospect.id), pipeline_id))

        FormsService._reassign_prospect_pipeline = mock_reassign

        try:
            result = await forms_service._process_membership_interest(
                submission, integration=None, form=form
            )

            assert result["success"] is True
            assert result["prospect_id"] == prospect_id
            # Reassignment should have been called with correct pipeline
            assert len(reassign_calls) == 1
            assert reassign_calls[0] == (prospect_id, correct_pipeline_id)
        finally:
            FormsService._reassign_prospect_pipeline = original_reassign

    async def test_no_reassignment_when_pipeline_matches(
        self, forms_service, mock_db
    ):
        frm_id = str(uuid4())
        org_id = str(uuid4())
        pipeline_id = str(uuid4())
        prospect_id = str(uuid4())

        fields = [
            _make_field("First Name"),
            _make_field("Last Name"),
            _make_field("Email", field_type="email"),
        ]
        form = _make_form_with_fields(frm_id, fields)

        data = {
            str(fields[0].id): "Jane",
            str(fields[1].id): "Doe",
            str(fields[2].id): "jane@example.com",
        }
        submission = _make_submission(frm_id, org_id, data)

        # Existing prospect already in the correct pipeline
        existing_prospect = _make_prospect(prospect_id, str(submission.id))
        existing_prospect.pipeline_id = pipeline_id

        # _resolve_pipeline_for_form runs first, then duplicate guard
        mock_db.execute.side_effect = [
            _make_result_chain(pipeline_id),        # _resolve_pipeline_for_form
            _make_result_chain(existing_prospect),   # duplicate guard → found
        ]

        reassign_calls = []
        original_reassign = FormsService._reassign_prospect_pipeline

        async def mock_reassign(self, prospect, pipeline_id):
            reassign_calls.append((str(prospect.id), pipeline_id))

        FormsService._reassign_prospect_pipeline = mock_reassign

        try:
            result = await forms_service._process_membership_interest(
                submission, integration=None, form=form
            )

            assert result["success"] is True
            assert result["prospect_id"] == prospect_id
            # No reassignment should happen — already in correct pipeline
            assert len(reassign_calls) == 0
        finally:
            FormsService._reassign_prospect_pipeline = original_reassign

    async def test_no_reassignment_when_no_pipeline_resolved(
        self, forms_service, mock_db
    ):
        frm_id = str(uuid4())
        org_id = str(uuid4())
        wrong_pipeline_id = str(uuid4())
        prospect_id = str(uuid4())

        fields = [
            _make_field("First Name"),
            _make_field("Last Name"),
            _make_field("Email", field_type="email"),
        ]
        form = _make_form_with_fields(frm_id, fields)

        data = {
            str(fields[0].id): "Bob",
            str(fields[1].id): "Smith",
            str(fields[2].id): "bob@example.com",
        }
        submission = _make_submission(frm_id, org_id, data)

        # Existing prospect — no pipeline step references this form
        existing_prospect = _make_prospect(prospect_id, str(submission.id))
        existing_prospect.pipeline_id = wrong_pipeline_id

        # _resolve_pipeline_for_form returns None, then duplicate guard finds existing
        mock_db.execute.side_effect = [
            _make_result_chain(),                    # _resolve_pipeline_for_form → None
            _make_result_chain(existing_prospect),   # duplicate guard → found
        ]

        reassign_calls = []
        original_reassign = FormsService._reassign_prospect_pipeline

        async def mock_reassign(self, prospect, pipeline_id):
            reassign_calls.append((str(prospect.id), pipeline_id))

        FormsService._reassign_prospect_pipeline = mock_reassign

        try:
            result = await forms_service._process_membership_interest(
                submission, integration=None, form=form
            )

            assert result["success"] is True
            # No reassignment — we can't resolve a target pipeline
            assert len(reassign_calls) == 0
        finally:
            FormsService._reassign_prospect_pipeline = original_reassign
