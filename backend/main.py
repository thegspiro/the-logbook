"""
The Logbook - Backend Entry Point (FastAPI)

This is the main entry point for the backend API server.
It initializes the FastAPI application, sets up middleware,
connects to the database, and configures routes.
"""

from contextlib import asynccontextmanager
from datetime import datetime
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from loguru import logger
import sys

from app.core.config import settings
from app.core.database import database_manager
from app.core.cache import cache_manager
from app.api.v1.api import api_router


# Configure logging
logger.remove()
logger.add(
    sys.stdout,
    format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
    level="INFO" if settings.ENVIRONMENT == "production" else "DEBUG",
)
logger.add(
    "logs/app.log",
    rotation="500 MB",
    retention="10 days",
    level="INFO",
)


def run_migrations():
    """
    Run Alembic migrations to ensure database schema is up to date.
    This runs synchronously before the async app starts.
    """
    from alembic.config import Config
    from alembic import command
    import os

    try:
        # Get the directory where main.py is located
        base_dir = os.path.dirname(os.path.abspath(__file__))
        alembic_cfg = Config(os.path.join(base_dir, "alembic.ini"))
        alembic_cfg.set_main_option("script_location", os.path.join(base_dir, "alembic"))

        logger.info("Running database migrations...")
        command.upgrade(alembic_cfg, "head")
        logger.info("✓ Database migrations complete")
    except Exception as e:
        logger.warning(f"Migration warning: {e}")
        # Don't fail startup - tables might already exist


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager for startup and shutdown events
    """
    # Startup
    logger.info("🚀 Starting The Logbook Backend...")
    logger.info(f"Environment: {settings.ENVIRONMENT}")
    logger.info(f"Version: {settings.VERSION}")

    # Connect to database
    logger.info("Connecting to database...")
    await database_manager.connect()
    logger.info("✓ Database connected")

    # Run migrations to ensure tables exist
    run_migrations()
    
    # Connect to Redis
    logger.info("Connecting to Redis...")
    await cache_manager.connect()
    logger.info("✓ Redis connected")
    
    logger.info(f"✓ Server started on port {settings.PORT}")
    logger.info(f"📚 API Documentation: http://localhost:{settings.PORT}/docs")
    logger.info(f"🔒 Health Check: http://localhost:{settings.PORT}/health")
    
    yield
    
    # Shutdown
    logger.info("Shutting down gracefully...")
    await database_manager.disconnect()
    await cache_manager.disconnect()
    logger.info("✓ Shutdown complete")


# Create FastAPI application
app = FastAPI(
    title=settings.APP_NAME,
    description="A highly flexible, secure, and modular intranet platform",
    version=settings.VERSION,
    docs_url="/docs" if settings.ENABLE_DOCS else None,
    redoc_url="/redoc" if settings.ENABLE_DOCS else None,
    openapi_url="/openapi.json" if settings.ENABLE_DOCS else None,
    lifespan=lifespan,
)

# ============================================
# Middleware
# ============================================

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Compression
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Custom middleware for request logging, security headers, etc.
# from app.core.middleware import RequestLoggingMiddleware, SecurityHeadersMiddleware
# app.add_middleware(RequestLoggingMiddleware)
# app.add_middleware(SecurityHeadersMiddleware)


# ============================================
# Routes
# ============================================

# Include API v1 router
app.include_router(api_router, prefix="/api/v1")


# Health check endpoint
@app.get("/health")
async def health_check():
    """
    Comprehensive health check endpoint

    Checks:
    - API status
    - Database connectivity
    - Redis connectivity
    - Configuration validation
    """
    health_status = {
        "status": "healthy",
        "version": settings.VERSION,
        "environment": settings.ENVIRONMENT,
        "timestamp": datetime.utcnow().isoformat(),
        "checks": {}
    }

    # Check database
    try:
        from app.core.database import database_manager
        if database_manager.is_connected:
            health_status["checks"]["database"] = "connected"
        else:
            health_status["checks"]["database"] = "disconnected"
            health_status["status"] = "degraded"
    except Exception as e:
        health_status["checks"]["database"] = f"error: {str(e)}"
        health_status["status"] = "unhealthy"

    # Check Redis
    try:
        from app.core.cache import cache_manager
        if cache_manager.redis:
            await cache_manager.redis.ping()
            health_status["checks"]["redis"] = "connected"
        else:
            health_status["checks"]["redis"] = "disconnected"
            health_status["status"] = "degraded"
    except Exception as e:
        health_status["checks"]["redis"] = f"error: {str(e)}"
        health_status["status"] = "degraded"  # Redis is not critical

    # Configuration warnings
    config_warnings = []
    if settings.ENVIRONMENT == "production":
        if settings.DEBUG:
            config_warnings.append("DEBUG mode enabled in production")
        if settings.SECRET_KEY == "change_me_to_random_64_character_string":
            config_warnings.append("Default SECRET_KEY detected")
        if settings.DB_PASSWORD == "change_me_in_production":
            config_warnings.append("Default DB_PASSWORD detected")

    if config_warnings:
        health_status["checks"]["configuration"] = "warnings"
        health_status["warnings"] = config_warnings
        if health_status["status"] == "healthy":
            health_status["status"] = "degraded"
    else:
        health_status["checks"]["configuration"] = "ok"

    return health_status


@app.get("/health/detailed")
async def health_check_detailed():
    """
    Detailed health check with system information
    Only available in non-production environments for security
    """
    if settings.ENVIRONMENT == "production":
        return {"error": "Detailed health check not available in production"}

    import psutil
    from datetime import datetime

    return {
        "status": "healthy",
        "version": settings.VERSION,
        "environment": settings.ENVIRONMENT,
        "timestamp": datetime.utcnow().isoformat(),
        "system": {
            "cpu_percent": psutil.cpu_percent(interval=1),
            "memory_percent": psutil.virtual_memory().percent,
            "disk_percent": psutil.disk_usage('/').percent,
        },
        "configuration": {
            "debug": settings.DEBUG,
            "enable_docs": settings.ENABLE_DOCS,
            "email_enabled": settings.EMAIL_ENABLED,
            "redis_enabled": bool(settings.REDIS_HOST),
            "modules": {
                "training": settings.MODULE_TRAINING_ENABLED,
                "compliance": settings.MODULE_COMPLIANCE_ENABLED,
                "scheduling": settings.MODULE_SCHEDULING_ENABLED,
                "elections": settings.MODULE_ELECTIONS_ENABLED,
            }
        }
    }


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "message": "The Logbook API",
        "version": settings.VERSION,
        "docs": f"/docs" if settings.ENABLE_DOCS else "Documentation disabled",
    }


if __name__ == "__main__":
    import uvicorn
    
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=settings.PORT,
        reload=settings.ENVIRONMENT == "development",
        log_level="info",
    )
