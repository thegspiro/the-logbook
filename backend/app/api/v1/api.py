"""
API Router v1

Combines all API route modules into a single router.
"""

from fastapi import APIRouter

# Import route modules
from app.api.v1 import onboarding
from app.api.v1.endpoints import (
    auth,
    users,
    organizations,
    roles,
    events,
    training,
    training_sessions,
    elections,
    inventory,
)

api_router = APIRouter()

# Include route modules
api_router.include_router(onboarding.router)
api_router.include_router(auth.router, prefix="/auth", tags=["authentication"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(organizations.router, prefix="/organizations", tags=["organizations"])
api_router.include_router(roles.router, prefix="/roles", tags=["roles"])
api_router.include_router(events.router, prefix="/events", tags=["events"])
api_router.include_router(training.router, prefix="/training/courses", tags=["training"])
api_router.include_router(training_sessions.router, prefix="/training/sessions", tags=["training-sessions"])
api_router.include_router(elections.router, prefix="/elections", tags=["elections"])
api_router.include_router(inventory.router, prefix="/inventory", tags=["inventory"])

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
            "training_courses": "/api/v1/training/courses",
            "training_sessions": "/api/v1/training/sessions",
            "elections": "/api/v1/elections",
            "inventory": "/api/v1/inventory"
        }
    }
