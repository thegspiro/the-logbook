"""
API Router v1

Combines all API route modules into a single router.
"""

from fastapi import APIRouter

# Import route modules
from app.api.v1.endpoints import users, organizations, roles, auth, training, elections, events

api_router = APIRouter()

# Include route modules
api_router.include_router(auth.router, prefix="/auth", tags=["authentication"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(organizations.router, prefix="/organization", tags=["organization"])
api_router.include_router(roles.router, prefix="/roles", tags=["roles"])
api_router.include_router(training.router, prefix="/training", tags=["training"])
api_router.include_router(elections.router, prefix="/elections", tags=["elections"])
api_router.include_router(events.router, prefix="/events", tags=["events"])

# Placeholder routes
@api_router.get("/")
async def api_root():
    """API v1 root endpoint"""
    return {
        "message": "The Logbook API v1",
        "endpoints": {
            "docs": "/docs",
            "health": "/health",
            "auth": "/api/v1/auth",
            "users": "/api/v1/users",
            "organization_settings": "/api/v1/organization/settings",
            "roles": "/api/v1/roles",
            "training": "/api/v1/training",
            "elections": "/api/v1/elections",
            "events": "/api/v1/events",
        }
    }
