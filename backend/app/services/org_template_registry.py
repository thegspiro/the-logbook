"""
Department Template Export/Import — Table Registry

Declarative registry describing which tables constitute a department's
*structural template* (definitions/config an admin would otherwise rebuild by
hand) and how each must be treated when exported or imported.

Design principle: **allowlist, not denylist.** A table is part of the template
only if it has an explicit :class:`TableSpec` here. A new model added elsewhere
in the codebase is invisible to the exporter until someone deliberately adds a
spec — so new PHI/secret tables cannot leak by default.

Only structural/definitional tables appear below. Members, PHI, transactional
records, per-member progress/history, logs, sessions, and secrets are
intentionally absent (they are EXCLUDE and never exported).

See docs/DEPARTMENT_TEMPLATE_EXPORT_IMPORT_PLAN.md for the full design and the
security threat model (§8). This module implements Phase 1 (registry + export);
fields reserved for the import phase (``natural_key``, ``system_seed``,
``json_id_paths``) are recorded now so the registry is complete, even though the
export path does not consume all of them.
"""

from dataclasses import dataclass
from typing import Callable, Optional

from app.models.admin_hours import AdminHoursCategory, EventHourMapping
from app.models.apparatus import (
    ApparatusCustomField,
    ApparatusMaintenanceType,
    ApparatusStatus,
    ApparatusType,
    CheckTemplateCompartment,
    CheckTemplateItem,
    EquipmentCheckTemplate,
    EvocLevel,
)
from app.models.compliance_config import ComplianceConfig, ComplianceProfile
from app.models.document import DocumentFolder
from app.models.email_template import EmailTemplate
from app.models.event import EventTemplate
from app.models.event_request import EventRequestEmailTemplate
from app.models.facilities import (
    FacilityMaintenanceType,
    FacilityStatus,
    FacilityType,
)
from app.models.finance import (
    ApprovalChain,
    ApprovalChainStep,
    BudgetCategory,
    DuesSchedule,
    ExportMapping,
    FiscalYear,
)
from app.models.forms import Form, FormField, FormIntegration
from app.models.inventory import (
    EquipmentKit,
    EquipmentKitItem,
    InventoryCategory,
    IssuanceAllowance,
    ItemVariantGroup,
    StorageArea,
)
from app.models.location import Location
from app.models.medical_screening import ScreeningRequirement
from app.models.membership_pipeline import (
    MembershipPipeline,
    MembershipPipelineStep,
)
from app.models.minute import MinutesTemplate
from app.models.notification import NotificationRule
from app.models.operational_rank import OperationalRank
from app.models.public_portal import (
    PublicPortalConfig,
    PublicPortalDataWhitelist,
)
from app.models.skills_testing import SkillTemplate
from app.models.training import (
    BasicApparatus,
    CompetencyMatrix,
    ProgramMilestone,
    ProgramPhase,
    ProgramRequirement,
    RecertificationPathway,
    SelfReportConfig,
    ShiftTemplate,
    SkillEvaluation,
    TrainingCategory,
    TrainingCourse,
    TrainingModuleConfig,
    TrainingProgram,
    TrainingRequirement,
)
from app.models.user import Position

# Table name of the users table — referenced FKs pointing here are member
# identity and are always nulled in a structure-only export.
USERS_TABLE = "users"

# Column-name substrings that indicate a secret/credential. No INCLUDE table may
# contain a column matching these — enforced by a unit test (S6/§8.1). Kept
# deliberately broad; it is a tripwire, not the only control.
SECRET_COLUMN_PATTERNS: tuple[str, ...] = (
    "password",
    "secret",
    "token",
    "_hash",
    "encrypted",
    "salt",
    "api_key",
    "apikey",
    "private_key",
    "credential",
)


@dataclass(frozen=True)
class TableSpec:
    """How one model participates in the department template.

    Attributes consumed by the **export** path:
        model:      SQLAlchemy model class.
        module:     Logical module the table belongs to (for filtering/grouping).
        parent_fk:  If the table has no ``organization_id``, the FK column that
                    scopes it to its parent (rows are selected by parent id).
        null_columns: Extra columns forced to NULL on export (INCLUDE→EXCLUDE
                    FKs, PII JSON columns, etc.). User-referencing columns are
                    detected and nulled automatically and need not be listed.
        pii_scrub_columns: Columns nulled on export *only if* the value looks
                    like PII (email address or a raw user UUID), e.g. a
                    polymorphic ``approver_value``.
        regenerate: Unique/non-guessable tokens dropped on export (regenerated
                    on import), e.g. ``public_slug``, ``display_code``.
        row_filter: Optional predicate(row) -> bool; rows returning False are
                    skipped (e.g. per-member "owner" document folders).

    Attributes recorded now for the **import** phase (not used by export):
        natural_key:  Columns forming the upsert/dedupe key in the target org.
        system_seed:  True when a fresh org already seeds these rows; only
                    org-custom rows travel and matched rows are reused, never
                    duplicated.
        json_id_paths: JSON locations embedding foreign row IDs to remap.
    """

    model: type
    module: str
    parent_fk: Optional[str] = None
    null_columns: tuple[str, ...] = ()
    pii_scrub_columns: tuple[str, ...] = ()
    regenerate: tuple[str, ...] = ()
    row_filter: Optional[Callable[[object], bool]] = None
    natural_key: Optional[tuple[str, ...]] = None
    system_seed: bool = False
    json_id_paths: tuple[str, ...] = ()

    @property
    def tablename(self) -> str:
        return self.model.__tablename__


def _no_owner(row: object) -> bool:
    """Exclude per-member "owner" folders — only shared/system structure travels."""
    return getattr(row, "owner_user_id", None) is None


def _not_system(row: object) -> bool:
    """Exclude system-seeded rows; a fresh org already has them."""
    return not bool(getattr(row, "is_system", False))


# ---------------------------------------------------------------------------
# The registry. Order is not significant here — the engine topologically sorts
# parent-scoped tables after their parents at run time.
# ---------------------------------------------------------------------------
INCLUDE_SPECS: tuple[TableSpec, ...] = (
    # ---- Roles / settings / cross-cutting lookups ----
    TableSpec(
        Position,
        "settings",
        natural_key=("slug",),
        row_filter=_not_system,
        null_columns=("settings",),  # per-role UI prefs may embed device ids
    ),
    TableSpec(
        OperationalRank,
        "settings",
        natural_key=("rank_code",),
    ),
    TableSpec(
        Location,
        "settings",
        null_columns=("facility_id", "facility_room_id"),  # INCLUDE→EXCLUDE
        regenerate=("display_code",),
    ),
    # ---- Forms ----
    TableSpec(Form, "forms", regenerate=("public_slug",)),
    TableSpec(FormField, "forms", parent_fk="form_id"),
    TableSpec(
        FormIntegration,
        "forms",
        parent_fk="form_id",
        json_id_paths=("field_mappings",),
    ),
    # ---- Documents / comms / notifications / portal ----
    TableSpec(
        DocumentFolder,
        "documents",
        natural_key=("slug",),
        row_filter=_no_owner,
    ),
    TableSpec(NotificationRule, "notifications"),
    TableSpec(EmailTemplate, "communications", natural_key=("name",)),
    TableSpec(PublicPortalConfig, "public_portal"),
    TableSpec(
        PublicPortalDataWhitelist,
        "public_portal",
        parent_fk="config_id",
    ),
    # ---- Training & compliance ----
    TableSpec(TrainingCategory, "training"),
    TableSpec(
        TrainingCourse,
        "training",
        json_id_paths=("prerequisites", "category_ids"),
    ),
    TableSpec(
        TrainingRequirement,
        "training",
        json_id_paths=("required_courses", "required_skills", "category_ids"),
    ),
    TableSpec(
        TrainingProgram,
        "training",
        json_id_paths=("prerequisite_program_ids",),
    ),
    TableSpec(
        ProgramPhase,
        "training",
        parent_fk="program_id",
        json_id_paths=("prerequisite_phase_ids",),
    ),
    TableSpec(ProgramRequirement, "training", parent_fk="program_id"),
    TableSpec(ProgramMilestone, "training", parent_fk="program_id"),
    TableSpec(
        SkillEvaluation,
        "training",
        json_id_paths=("allowed_evaluators", "required_for_programs"),
    ),
    TableSpec(TrainingModuleConfig, "training"),
    TableSpec(SelfReportConfig, "training"),
    TableSpec(ShiftTemplate, "scheduling"),
    TableSpec(BasicApparatus, "scheduling"),
    TableSpec(
        RecertificationPathway,
        "training",
        json_id_paths=(
            "required_courses",
            "category_hour_requirements",
            "prerequisite_pathway_ids",
        ),
    ),
    TableSpec(
        CompetencyMatrix,
        "training",
        json_id_paths=("skill_requirements",),
    ),
    TableSpec(SkillTemplate, "skills_testing"),
    TableSpec(ScreeningRequirement, "medical_screening"),
    TableSpec(
        ComplianceConfig,
        "compliance",
        null_columns=("report_email_recipients",),  # email PII
    ),
    TableSpec(
        ComplianceProfile,
        "compliance",
        parent_fk="config_id",
        json_id_paths=(
            "role_ids",
            "required_requirement_ids",
            "optional_requirement_ids",
            "admin_hours_requirements",
        ),
    ),
    TableSpec(AdminHoursCategory, "admin_hours"),
    TableSpec(EventHourMapping, "admin_hours"),
    # ---- Apparatus ----
    TableSpec(ApparatusType, "apparatus", system_seed=True),
    TableSpec(ApparatusStatus, "apparatus", system_seed=True),
    TableSpec(
        ApparatusCustomField,
        "apparatus",
        json_id_paths=("applies_to_types",),
    ),
    TableSpec(
        ApparatusMaintenanceType,
        "apparatus",
        system_seed=True,
        json_id_paths=("applies_to_types",),
    ),
    TableSpec(EvocLevel, "apparatus", system_seed=True),
    TableSpec(
        EquipmentCheckTemplate,
        "apparatus",
        null_columns=("apparatus_id",),  # INCLUDE→EXCLUDE physical asset
    ),
    TableSpec(
        CheckTemplateCompartment,
        "apparatus",
        parent_fk="template_id",
    ),
    TableSpec(
        CheckTemplateItem,
        "apparatus",
        parent_fk="compartment_id",
        null_columns=("equipment_id",),  # INCLUDE→EXCLUDE per-asset row
    ),
    # ---- Inventory ----
    TableSpec(InventoryCategory, "inventory"),
    TableSpec(IssuanceAllowance, "inventory"),
    TableSpec(StorageArea, "inventory"),
    TableSpec(ItemVariantGroup, "inventory"),
    TableSpec(EquipmentKit, "inventory"),
    TableSpec(
        EquipmentKitItem,
        "inventory",
        parent_fk="kit_id",
        null_columns=("item_id",),  # INCLUDE→EXCLUDE physical item
    ),
    # ---- Facilities ----
    TableSpec(FacilityType, "facilities", system_seed=True),
    TableSpec(FacilityStatus, "facilities", system_seed=True),
    TableSpec(FacilityMaintenanceType, "facilities", system_seed=True),
    # ---- Meetings / events ----
    TableSpec(MinutesTemplate, "minutes"),
    TableSpec(EventTemplate, "events"),
    TableSpec(EventRequestEmailTemplate, "events"),
    # ---- Membership ----
    TableSpec(MembershipPipeline, "membership"),
    TableSpec(
        MembershipPipelineStep,
        "membership",
        parent_fk="pipeline_id",
    ),
    # ---- Finance ----
    TableSpec(FiscalYear, "finance"),
    TableSpec(BudgetCategory, "finance"),
    TableSpec(ApprovalChain, "finance"),
    TableSpec(
        ApprovalChainStep,
        "finance",
        parent_fk="chain_id",
        pii_scrub_columns=("approver_value",),  # holds a user id / email
    ),
    TableSpec(DuesSchedule, "finance"),
    TableSpec(ExportMapping, "finance"),
)


# Fast lookups -------------------------------------------------------------
SPEC_BY_TABLE: dict[str, TableSpec] = {s.tablename: s for s in INCLUDE_SPECS}
INCLUDED_TABLES: frozenset[str] = frozenset(SPEC_BY_TABLE)


def modules() -> list[str]:
    """Sorted list of distinct module names present in the registry."""
    return sorted({s.module for s in INCLUDE_SPECS})


def specs_for_modules(names: Optional[set[str]]) -> list[TableSpec]:
    """Specs in the named modules (all specs when ``names`` is None)."""
    if names is None:
        return list(INCLUDE_SPECS)
    return [s for s in INCLUDE_SPECS if s.module in names]
