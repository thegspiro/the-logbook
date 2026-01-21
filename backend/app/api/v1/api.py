"""
API Router v1

Combines all API route modules into a single router.
"""

from fastapi import APIRouter

# Import route modules
from app.api.v1 import onboarding
from app.api.v1.endpoints import events, locations

api_router = APIRouter()

# Include route modules
api_router.include_router(onboarding.router)
api_router.include_router(events.router, prefix="/events", tags=["events"])
api_router.include_router(locations.router, prefix="/locations", tags=["locations"])

# Future route modules (to be implemented)
# from app.api.v1.endpoints import auth, users, audit
# api_router.include_router(auth.router, prefix="/auth", tags=["authentication"])
# api_router.include_router(users.router, prefix="/users", tags=["users"])
# api_router.include_router(audit.router, prefix="/audit", tags=["audit"])

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
            "inventory": "/api/v1/inventory"
        }
    }
