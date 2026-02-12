"""
API Router v1

Combines all API route modules into a single router.
"""

from fastapi import APIRouter

# Import route modules
from app.api.v1 import onboarding, public_portal_admin
from app.api.v1.endpoints import (
    auth,
    dashboard,
    events,
    forms,
    locations,
    roles,
    users,
    organizations,
    apparatus,
    security_monitoring,
    training,
    training_programs,
    training_sessions,
    elections,
    inventory,
    external_training,
    email_templates,
)

api_router = APIRouter()

# Include route modules
api_router.include_router(onboarding.router)
api_router.include_router(events.router, prefix="/events", tags=["events"])
api_router.include_router(locations.router, prefix="/locations", tags=["locations"])
api_router.include_router(roles.router, prefix="/roles", tags=["roles"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(organizations.router, prefix="/organization", tags=["organization"])
api_router.include_router(apparatus.router, prefix="/apparatus", tags=["apparatus"])
api_router.include_router(security_monitoring.router, prefix="/security", tags=["security"])
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"])
api_router.include_router(training.router, prefix="/training", tags=["training"])
api_router.include_router(training_programs.router, prefix="/training/programs", tags=["training-programs"])
api_router.include_router(training_sessions.router, prefix="/training/sessions", tags=["training-sessions"])
api_router.include_router(elections.router, prefix="/elections", tags=["elections"])
api_router.include_router(inventory.router, prefix="/inventory", tags=["inventory"])
api_router.include_router(forms.router, prefix="/forms", tags=["forms"])
api_router.include_router(external_training.router, prefix="/training/external", tags=["external-training"])
api_router.include_router(email_templates.router, prefix="/email-templates", tags=["email-templates"])
api_router.include_router(public_portal_admin.router)

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
            "training_programs": "/api/v1/training/programs",
            "training_external": "/api/v1/training/external",
            "elections": "/api/v1/elections",
            "inventory": "/api/v1/inventory",
            "apparatus": "/api/v1/apparatus",
            "security": "/api/v1/security",
            "email_templates": "/api/v1/email-templates",
            "forms": "/api/v1/forms",
            "public_portal": "/api/v1/public-portal"
        }
    }
