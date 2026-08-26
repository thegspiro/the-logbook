"""
API Router v1

Combines all API route modules into a single router.
"""

from fastapi import APIRouter, Depends

from app.api.dependencies import require_module

# Import route modules
from app.api.v1 import onboarding, public_portal_admin
from app.api.v1.endpoints import (
    admin_hours,
    admin_hub,
    analytics,
    apparatus,
    audit_logs,
    auth,
    calcom_sync,
    compliance_config,
    compliance_officer,
    course_cohorts,
    course_syllabus,
    dashboard,
    documents,
    elections,
    email_templates,
    equipment_check,
    error_logs,
    event_requests,
    events,
    external_training,
    facilities,
    finance,
    forms,
    grants,
    integrations,
    inventory,
    ip_security,
    labels,
    legal_documents,
    locations,
    medical_screening,
    medical_supplies,
    meetings,
    member_leaves,
    member_status,
    membership_pipeline,
    message_history,
    messages,
    minutes,
    nfc_tags,
    notifications,
    officers,
    operational_ranks,
    org_chart,
    organizations,
    platform_analytics,
    reports,
    roles,
    salesforce_sync,
    scheduled,
    scheduling,
    scheduling_module_config,
    security_monitoring,
    shift_completion,
    skills_testing,
    station_documents,
    storefront,
    training,
    training_enhancements,
    training_module_config,
    training_programs,
    training_sessions,
    training_submissions,
    training_waivers,
    users,
)
from app.core.security_middleware import verify_csrf_token


def module_gate(module: str, label: str | None = None) -> list:
    """``dependencies=`` for a router owned by one configurable module.

    Gating here rather than per-endpoint is the point: a route added to an
    already-gated module inherits the gate, so the invariant cannot be lost
    by somebody forgetting a decorator on a new handler.

    A router is gated only when the module owns its data outright. Three
    kinds of router are deliberately left ungated, and each has a reason
    that is not "we did not get to it":

    * **Essential modules** — members, events, documents, roles, settings.
      ``ModuleSettings`` has no field for them and ``get_enabled_modules``
      always reports them, so a gate would be a permanent no-op.
    * **Cross-module infrastructure** — ``locations`` (the simplified stand-in
      the app serves when Facilities is off, so gating it on Facilities would
      remove the fallback along with the feature), ``forms`` (the builder that
      powers shift checkouts, equipment checks and training data collection,
      and a core module in onboarding), ``labels`` and ``nfc_tags`` (printing
      and tag scanning for apparatus, facilities, prospects and members
      alike), ``email_templates`` (the templates behind mail the app sends
      regardless of which screens exist), and ``analytics`` and ``compliance``
      (which read across several modules at once).
    * **Platform and session surfaces** — auth, onboarding, audit, errors,
      security, platform analytics, scheduled tasks, and the dashboard and
      admin hub, which gate their own contents block by block because they
      deliberately span modules.

    ``admin_hours`` is ungated for a different reason: it is a real module
    with a frontend, a nav entry and its own permissions, but no
    ``ModuleSettings`` field, so there is nothing to gate on yet. Giving it a
    flag is a separate change.
    """
    return [Depends(require_module(module, label))]


api_router = APIRouter(dependencies=[Depends(verify_csrf_token)])

# Include route modules
api_router.include_router(onboarding.router)
api_router.include_router(events.router, prefix="/events", tags=["events"])
api_router.include_router(event_requests.router, tags=["event-requests"])
api_router.include_router(locations.router, prefix="/locations", tags=["locations"])
api_router.include_router(roles.router, prefix="/roles", tags=["roles"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(nfc_tags.router, prefix="/nfc-tags", tags=["nfc-tags"])
api_router.include_router(
    organizations.router, prefix="/organization", tags=["organization"]
)
api_router.include_router(
    apparatus.router,
    prefix="/apparatus",
    tags=["apparatus"],
    dependencies=module_gate("apparatus", "Apparatus"),
)
api_router.include_router(
    facilities.router,
    prefix="/facilities",
    tags=["facilities"],
    dependencies=module_gate("facilities", "Facilities"),
)
api_router.include_router(
    security_monitoring.router, prefix="/security", tags=["security"]
)
api_router.include_router(
    ip_security.router, prefix="/ip-security", tags=["ip-security"]
)
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"])
api_router.include_router(admin_hub.router, prefix="/admin-hub", tags=["admin-hub"])
api_router.include_router(
    training.router,
    prefix="/training",
    tags=["training"],
    dependencies=module_gate("training", "Training"),
)
api_router.include_router(
    training_programs.router,
    prefix="/training/programs",
    tags=["training-programs"],
    dependencies=module_gate("training", "Training"),
)
api_router.include_router(
    training_sessions.router,
    prefix="/training/sessions",
    tags=["training-sessions"],
    dependencies=module_gate("training", "Training"),
)
# Syllabus routes hang off the existing course paths
# (/training/courses/{id}/classes), so they are mounted on the same prefix as
# the course CRUD in training.py rather than getting a prefix of their own.
api_router.include_router(
    course_syllabus.router,
    prefix="/training/courses",
    tags=["course-syllabus"],
    dependencies=module_gate("training", "Training"),
)
api_router.include_router(
    course_cohorts.router,
    prefix="/training/cohorts",
    tags=["course-cohorts"],
    dependencies=module_gate("training", "Training"),
)
# The prospect pipeline reaches in here: an ``election_vote`` stage renders
# ElectionPackageSection, which lists draft elections. Elections defaults off
# while Prospective Members defaults on, so a department that built an
# election stage without switching Elections on now gets the module error
# rather than a silent empty list — which is the honest answer, and names the
# switch that fixes it.
api_router.include_router(
    elections.router,
    prefix="/elections",
    tags=["elections"],
    dependencies=module_gate("elections", "Elections"),
)
api_router.include_router(
    inventory.router,
    prefix="/inventory",
    tags=["inventory"],
    dependencies=module_gate("inventory", "Inventory"),
)
api_router.include_router(
    medical_supplies.router,
    prefix="/medical-supplies",
    tags=["medical-supplies"],
    dependencies=module_gate("medical_supplies", "Medical Supplies"),
)
api_router.include_router(
    storefront.router,
    prefix="/store",
    tags=["storefront"],
    dependencies=module_gate("storefront", "The Department Store"),
)
api_router.include_router(labels.router, tags=["labels"])
api_router.include_router(station_documents.router, tags=["station-documents"])
api_router.include_router(forms.router, prefix="/forms", tags=["forms"])
api_router.include_router(
    training_submissions.router,
    prefix="/training/submissions",
    tags=["training-submissions"],
    dependencies=module_gate("training", "Training"),
)
api_router.include_router(
    shift_completion.router,
    prefix="/training/shift-reports",
    tags=["shift-completion"],
    dependencies=module_gate("training", "Training"),
)
api_router.include_router(
    external_training.router,
    prefix="/training/external",
    tags=["external-training"],
    dependencies=module_gate("training", "Training"),
)
api_router.include_router(
    training_module_config.router,
    prefix="/training/module-config",
    tags=["training-module-config"],
    dependencies=module_gate("training", "Training"),
)
api_router.include_router(
    email_templates.router, prefix="/email-templates", tags=["email-templates"]
)
api_router.include_router(
    legal_documents.router, prefix="/legal-documents", tags=["legal-documents"]
)
api_router.include_router(officers.router, prefix="/officers", tags=["officers"])
api_router.include_router(org_chart.router, prefix="/org-chart", tags=["org-chart"])
api_router.include_router(
    message_history.router, prefix="/message-history", tags=["message-history"]
)
api_router.include_router(member_status.router, prefix="/users", tags=["member-status"])
api_router.include_router(
    membership_pipeline.router,
    prefix="/prospective-members",
    tags=["prospective-members"],
    dependencies=module_gate("prospective_members", "Prospective Members"),
)
api_router.include_router(
    medical_screening.router,
    prefix="/medical-screening",
    tags=["medical-screening"],
    dependencies=module_gate("medical_screening", "Medical Screening"),
)
api_router.include_router(documents.router, prefix="/documents", tags=["documents"])
api_router.include_router(
    meetings.router,
    prefix="/meetings",
    tags=["meetings"],
    dependencies=module_gate("minutes", "Meeting Minutes"),
)
api_router.include_router(
    minutes.router,
    prefix="/minutes-records",
    tags=["minutes"],
    dependencies=module_gate("minutes", "Meeting Minutes"),
)
api_router.include_router(
    scheduling.router,
    prefix="/scheduling",
    tags=["scheduling"],
    dependencies=module_gate("scheduling", "Scheduling"),
)
api_router.include_router(
    scheduling_module_config.router,
    prefix="/scheduling/shift-settings",
    tags=["scheduling-module-config"],
    dependencies=module_gate("scheduling", "Scheduling"),
)
api_router.include_router(
    equipment_check.router,
    prefix="/equipment-checks",
    tags=["equipment-checks"],
    dependencies=module_gate("scheduling", "Scheduling"),
)
api_router.include_router(
    reports.router,
    prefix="/reports",
    tags=["reports"],
    dependencies=module_gate("reports", "Reports"),
)
api_router.include_router(
    notifications.router,
    prefix="/notifications",
    tags=["notifications"],
    dependencies=module_gate("notifications", "Notifications"),
)
# Deliberately ungated. Department messages surface in every member's
# dashboard feed, and the communications flag defaults to False — gating this
# on it would delete a live feature from every existing installation on
# upgrade, which is the trap CLAUDE.md pitfall 19 describes. The same goes for
# message_history above, which is email-delivery diagnostics rather than a
# module screen.
api_router.include_router(messages.router, prefix="/messages", tags=["messages"])
api_router.include_router(analytics.router, prefix="/analytics", tags=["analytics"])
api_router.include_router(
    platform_analytics.router, prefix="/platform-analytics", tags=["platform-analytics"]
)
api_router.include_router(error_logs.router, prefix="/errors", tags=["errors"])
api_router.include_router(audit_logs.router, prefix="/audit-logs", tags=["audit-logs"])
api_router.include_router(
    integrations.router,
    prefix="/integrations",
    tags=["integrations"],
    dependencies=module_gate("integrations", "Integrations"),
)
api_router.include_router(
    salesforce_sync.router,
    prefix="/integrations/salesforce",
    tags=["salesforce-sync"],
    dependencies=module_gate("integrations", "Integrations"),
)
api_router.include_router(
    calcom_sync.router,
    prefix="/integrations/calcom",
    tags=["calcom"],
    dependencies=module_gate("integrations", "Integrations"),
)
api_router.include_router(
    scheduled.router, prefix="/scheduled", tags=["scheduled-tasks"]
)
api_router.include_router(
    training_waivers.router,
    prefix="/training/waivers",
    tags=["training-waivers"],
    dependencies=module_gate("training", "Training"),
)
api_router.include_router(
    skills_testing.router,
    prefix="/training/skills-testing",
    tags=["skills-testing"],
    dependencies=module_gate("training", "Training"),
)
api_router.include_router(member_leaves.router, prefix="/users", tags=["member-leaves"])
api_router.include_router(
    operational_ranks.router, prefix="/operational-ranks", tags=["operational-ranks"]
)
api_router.include_router(
    admin_hours.router, prefix="/admin-hours", tags=["admin-hours"]
)
api_router.include_router(
    grants.router,
    prefix="/grants",
    tags=["grants"],
    dependencies=module_gate("grants", "Grants & Fundraising"),
)
api_router.include_router(
    finance.router,
    prefix="/finance",
    tags=["finance"],
    dependencies=module_gate("finance", "Finance"),
)
api_router.include_router(
    training_enhancements.router,
    prefix="/training",
    tags=["training-enhancements"],
    dependencies=module_gate("training", "Training"),
)
api_router.include_router(
    compliance_officer.router,
    prefix="/compliance",
    tags=["compliance-officer"],
)
api_router.include_router(
    compliance_config.router,
    prefix="/compliance",
    tags=["compliance-config"],
)
api_router.include_router(
    public_portal_admin.router,
    dependencies=module_gate("public_info", "Public Information"),
)


# Placeholder routes
@api_router.get("/")
async def api_root():
    """API v1 root endpoint"""
    return {
        "message": "The Logbook API v1",
        "version": "1.0.0",
        "endpoints": {
            "docs": "/docs",
            "health": "/health",
            "onboarding": "/api/v1/onboarding/status",
            "auth": "/api/v1/auth",
            "users": "/api/v1/users",
            "organizations": "/api/v1/organizations",
            "roles": "/api/v1/roles",
            "events": "/api/v1/events",
            "locations": "/api/v1/locations",
            "training_courses": "/api/v1/training/courses",
            "training_sessions": "/api/v1/training/sessions",
            "training_cohorts": "/api/v1/training/cohorts",
            "training_programs": "/api/v1/training/programs",
            "training_external": "/api/v1/training/external",
            "elections": "/api/v1/elections",
            "inventory": "/api/v1/inventory",
            "medical_supplies": "/api/v1/medical-supplies",
            "apparatus": "/api/v1/apparatus",
            "facilities": "/api/v1/facilities",
            "security": "/api/v1/security",
            "ip_security": "/api/v1/ip-security",
            "email_templates": "/api/v1/email-templates",
            "legal_documents": "/api/v1/legal-documents",
            "officers": "/api/v1/officers",
            "org_chart": "/api/v1/org-chart",
            "forms": "/api/v1/forms",
            "documents": "/api/v1/documents",
            "meetings": "/api/v1/meetings",
            "minutes": "/api/v1/minutes-records",
            "scheduling": "/api/v1/scheduling",
            "reports": "/api/v1/reports",
            "notifications": "/api/v1/notifications",
            "analytics": "/api/v1/analytics",
            "platform_analytics": "/api/v1/platform-analytics",
            "errors": "/api/v1/errors",
            "integrations": "/api/v1/integrations",
            "prospective_members": "/api/v1/prospective-members",
            "public_portal": "/api/v1/public-portal",
            "admin_hours": "/api/v1/admin-hours",
            "message_history": "/api/v1/message-history",
        },
    }
