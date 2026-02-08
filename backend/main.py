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
from app.api.public.portal import router as public_portal_router


# Configure logging
logger.remove()
logger.add(
    sys.stdout,
    format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
    level="INFO" if settings.ENVIRONMENT == "production" else "DEBUG",
)

# Add file logging with directory creation
import os
_logs_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")
try:
    os.makedirs(_logs_dir, exist_ok=True)
    logger.add(
        os.path.join(_logs_dir, "app.log"),
        rotation="500 MB",
        retention="10 days",
        level="INFO",
    )
except Exception as _log_err:
    # File logging is optional - stdout is sufficient for development
    pass


# ============================================
# Startup Status Tracking
# ============================================
class StartupStatus:
    """Tracks startup progress for the health endpoint"""
    def __init__(self):
        self.phase = "initializing"
        self.message = "Starting up..."
        self.migrations_total = 0
        self.migrations_completed = 0
        self.current_migration = None
        self.started_at = datetime.utcnow()
        self.ready = False
        self.errors = []
        self.detailed_message = None

    def set_phase(self, phase: str, message: str, detailed_message: str = None):
        self.phase = phase
        self.message = message
        self.detailed_message = detailed_message
        logger.info(f"Startup: {message}")

    def set_migration_progress(self, current: str, completed: int, total: int):
        self.current_migration = current
        self.migrations_completed = completed
        self.migrations_total = total
        self.message = f"Running migration {completed}/{total}: {current}"
        self.detailed_message = f"Applying database schema changes to keep your data structure up to date. This may take a few minutes on first startup."

    def set_ready(self):
        self.ready = True
        self.phase = "ready"
        self.message = "Server is ready"
        self.detailed_message = None

    def add_error(self, error: str):
        self.errors.append(error)

    def to_dict(self):
        result = {
            "phase": self.phase,
            "message": self.message,
            "ready": self.ready,
            "uptime_seconds": (datetime.utcnow() - self.started_at).total_seconds(),
        }

        if self.detailed_message:
            result["detailed_message"] = self.detailed_message

        if self.migrations_total > 0:
            result["migrations"] = {
                "total": self.migrations_total,
                "completed": self.migrations_completed,
                "current": self.current_migration,
                "progress_percent": int((self.migrations_completed / self.migrations_total) * 100) if self.migrations_total > 0 else 0
            }

        if self.errors:
            result["errors"] = self.errors

        return result

# Global startup status instance
startup_status = StartupStatus()


def validate_schema(engine) -> tuple[bool, list[str]]:
    """
    Validate that critical database schema elements exist.
    Returns (is_valid, list_of_errors).
    """
    from sqlalchemy import text, inspect

    errors = []

    # Critical tables and their required columns
    required_schema = {
        "organizations": [
            "id", "name", "slug", "organization_type", "timezone",
            "identifier_type", "active", "created_at"
        ],
        "users": [
            "id", "organization_id", "username", "email", "password_hash",
            "status", "created_at"
        ],
        "roles": [
            "id", "organization_id", "name", "slug", "permissions", "created_at"
        ],
        "onboarding_status": [
            "id", "is_completed", "current_step", "created_at"
        ],
        "onboarding_sessions": [
            "id", "session_id", "data", "expires_at"
        ],
    }

    try:
        inspector = inspect(engine)
        existing_tables = inspector.get_table_names()

        for table_name, required_columns in required_schema.items():
            if table_name not in existing_tables:
                errors.append(f"Missing table: {table_name}")
                continue

            # Get existing columns
            columns = {col["name"] for col in inspector.get_columns(table_name)}

            # Check for missing columns
            missing_cols = [col for col in required_columns if col not in columns]
            if missing_cols:
                errors.append(
                    f"Table '{table_name}' missing columns: {', '.join(missing_cols)}"
                )
    except Exception as e:
        errors.append(f"Schema validation error: {e}")

    return (len(errors) == 0, errors)


def run_migrations():
    """
    Run Alembic migrations to ensure database schema is up to date.
    This runs synchronously before the async app starts.
    """
    from alembic.config import Config
    from alembic import command
    from alembic.script import ScriptDirectory
    from alembic.runtime.migration import MigrationContext
    from sqlalchemy import create_engine, text
    import os

    startup_status.set_phase("migrations", "Preparing database migrations...")

    try:
        # Get the directory where main.py is located
        base_dir = os.path.dirname(os.path.abspath(__file__))
        alembic_cfg = Config(os.path.join(base_dir, "alembic.ini"))
        alembic_cfg.set_main_option("script_location", os.path.join(base_dir, "alembic"))

        # Count total migrations to run
        script_dir = ScriptDirectory.from_config(alembic_cfg)
        all_revisions = list(script_dir.walk_revisions())
        total_migrations = len(all_revisions)
        startup_status.migrations_total = total_migrations

        # Check for revision mismatch (common when migration files are renamed)
        try:
            engine = create_engine(settings.SYNC_DATABASE_URL)
            with engine.connect() as conn:
                # Check if alembic_version table exists
                result = conn.execute(text(
                    "SELECT version_num FROM alembic_version LIMIT 1"
                ))
                row = result.fetchone()

                if row:
                    current_rev = row[0]

                    # Check if current revision exists in our scripts
                    try:
                        script_dir.get_revision(current_rev)
                    except Exception:
                        # Revision not found - likely renamed migration files
                        startup_status.set_phase("migrations", "Fixing migration version mismatch...")
                        logger.warning(
                            f"Migration revision '{current_rev}' not found. "
                            "This may be due to renamed migration files. "
                            "Stamping database with 'head' to fix..."
                        )
                        # Clear the version table so migrations can run fresh
                        conn.execute(text("DELETE FROM alembic_version"))
                        conn.commit()
                        logger.info("✓ Cleared invalid migration version, will run fresh")
        except Exception as e:
            # Table might not exist yet, which is fine
            logger.debug(f"Could not check alembic_version: {e}")

        startup_status.set_phase("migrations", f"Running {total_migrations} database migrations...")
        logger.info("Running database migrations...")

        schema_was_stamped = False

        try:
            command.upgrade(alembic_cfg, "head")
            startup_status.migrations_completed = total_migrations
            startup_status.set_phase("migrations", "Database migrations complete")
            logger.info("✓ Database migrations complete")
        except Exception as upgrade_error:
            # If upgrade fails due to table already exists, stamp to head
            error_str = str(upgrade_error).lower()
            if "already exists" in error_str or "duplicate" in error_str:
                logger.warning(
                    f"Migration failed ({upgrade_error}). "
                    "Tables may already exist. Stamping to head..."
                )
                try:
                    command.stamp(alembic_cfg, "head")
                    schema_was_stamped = True
                    startup_status.migrations_completed = total_migrations
                    logger.info("✓ Stamped database to head")
                except Exception as stamp_error:
                    logger.warning(f"Could not stamp database: {stamp_error}")
                    startup_status.add_error(f"Migration stamp failed: {stamp_error}")
            else:
                startup_status.add_error(f"Migration failed: {upgrade_error}")
                raise

        # Validate schema after migrations or stamp
        startup_status.set_phase("migrations", "Validating database schema...")
        schema_valid, schema_errors = validate_schema(engine)

        if not schema_valid:
            error_msg = (
                "DATABASE SCHEMA INCONSISTENCY DETECTED!\n"
                "The database schema does not match the expected structure.\n"
                "This usually happens when migrations fail partway through.\n\n"
                "Issues found:\n" + "\n".join(f"  - {e}" for e in schema_errors) + "\n\n"
                "TO FIX THIS ISSUE:\n"
                "  1. Stop all containers: docker compose down -v\n"
                "  2. Rebuild: docker compose up --build\n\n"
                "The -v flag removes database volumes for a fresh start.\n"
                "Since onboarding hasn't completed, no data will be lost."
            )
            logger.error(error_msg)
            startup_status.add_error("Schema validation failed - database reset required")
            startup_status.phase = "error"
            startup_status.message = "Database schema invalid - see logs for fix instructions"

            if schema_was_stamped:
                # If we just stamped to head but schema is invalid, this is a critical issue
                logger.critical(
                    "CRITICAL: Schema stamped to head but validation failed. "
                    "Database must be reset with 'docker compose down -v'"
                )
        else:
            logger.info("✓ Database schema validated successfully")

    except Exception as e:
        logger.warning(f"Migration warning: {e}")
        startup_status.add_error(f"Migration warning: {e}")
        # Don't fail startup - tables might already exist


def validate_security_configuration():
    """
    Validate security configuration on startup.
    Blocks startup in production if critical security settings are missing.
    """
    warnings = settings.validate_security_config()

    if warnings:
        logger.warning("=" * 60)
        logger.warning("SECURITY CONFIGURATION WARNINGS:")
        for warning in warnings:
            if "CRITICAL" in warning:
                logger.error(f"  {warning}")
            else:
                logger.warning(f"  {warning}")
        logger.warning("=" * 60)

        # Block startup in production if critical issues exist
        if settings.SECURITY_BLOCK_INSECURE_DEFAULTS:
            critical_warnings = [w for w in warnings if "CRITICAL" in w]
            if critical_warnings:
                raise RuntimeError(
                    "SECURITY FAILURE: Cannot start with insecure default configuration. "
                    "Set required environment variables or disable SECURITY_BLOCK_INSECURE_DEFAULTS."
                )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager for startup and shutdown events
    """
    # Startup
    logger.info("Starting The Logbook Backend...")
    logger.info(f"Environment: {settings.ENVIRONMENT}")
    logger.info(f"Version: {settings.VERSION}")

    # Validate security configuration first
    startup_status.set_phase(
        "security",
        "Validating security configuration...",
        "Checking encryption keys, secrets, and security settings to ensure safe operation."
    )
    validate_security_configuration()

    # Connect to database
    startup_status.set_phase(
        "database",
        "Connecting to database...",
        "Establishing connection to MySQL database. This may take up to 2 minutes if MySQL is still initializing."
    )
    logger.info("Connecting to database...")
    await database_manager.connect()
    logger.info("Database connected")

    # Preflight environment check before migrations
    startup_status.set_phase(
        "preflight",
        "Running preflight checks...",
        "Verifying environment configuration and system requirements before database setup."
    )
    logger.info("Running preflight environment checks...")

    # Check critical environment variables
    preflight_warnings = []
    if settings.SECRET_KEY == "change_me_in_production":
        preflight_warnings.append("SECRET_KEY is using default value")
    if settings.ENCRYPTION_KEY == "change_me_in_production":
        preflight_warnings.append("ENCRYPTION_KEY is using default value")

    if preflight_warnings and settings.ENVIRONMENT == "production":
        for warning in preflight_warnings:
            logger.warning(f"⚠ Preflight: {warning}")

    logger.info("✓ Preflight checks complete")

    # Run migrations to ensure tables exist
    startup_status.set_phase(
        "migrations",
        "Setting up database tables...",
        "Preparing to run database migrations. This ensures your database schema is up to date."
    )
    run_migrations()

    # After migrations complete, parallelize independent operations for faster startup
    startup_status.set_phase(
        "services",
        "Initializing services...",
        "Connecting to Redis, initializing GeoIP, and validating database in parallel."
    )
    logger.info("Starting parallel service initialization...")

    import asyncio

    async def connect_redis():
        """Connect to Redis cache"""
        try:
            logger.info("Connecting to Redis...")
            await cache_manager.connect()
            if cache_manager.is_connected:
                logger.info("✓ Redis connected")
            else:
                logger.warning("Redis unavailable - running in degraded mode (caching disabled)")
        except Exception as e:
            logger.warning(f"Redis connection failed: {e}")

    async def initialize_geoip():
        """Initialize GeoIP service"""
        try:
            if settings.GEOIP_ENABLED:
                from app.core.geoip import init_geoip_service
                blocked_countries = settings.get_blocked_countries_set()
                geoip = init_geoip_service(
                    geoip_db_path=settings.GEOIP_DATABASE_PATH,
                    blocked_countries=blocked_countries,
                    enabled=True,
                )
                logger.info(f"✓ GeoIP service initialized. Blocked countries: {blocked_countries or 'none'}")
            else:
                logger.info("GeoIP service disabled")
        except Exception as e:
            logger.warning(f"GeoIP initialization failed: {e}")

    async def validate_database():
        """Validate database schema and enums"""
        try:
            logger.info("Validating database enum consistency...")
            from app.utils.startup_validators import run_startup_validations
            from app.core.database import async_session_factory

            async with async_session_factory() as db:
                # Run validations in non-strict mode (log warnings but don't block startup)
                await run_startup_validations(db, strict=False)
            logger.info("✓ Database validations complete")
        except Exception as e:
            logger.warning(f"Could not run startup validations: {e}")
            startup_status.add_error(f"Startup validation error: {str(e)}")

    # Run Redis, GeoIP, and validations in parallel
    await asyncio.gather(
        connect_redis(),
        initialize_geoip(),
        validate_database(),
        return_exceptions=True
    )

    logger.info("✓ Parallel service initialization complete")

    # Defer audit log verification to background (only in production, don't block startup)
    if settings.ENVIRONMENT == "production":
        async def verify_audit_logs_background():
            """Verify audit log integrity in background"""
            try:
                await asyncio.sleep(5)  # Give server time to fully start
                logger.info("Starting background audit log verification...")
                from app.core.audit import verify_audit_log_integrity
                from app.core.database import async_session_factory

                async with async_session_factory() as db:
                    integrity_result = await verify_audit_log_integrity(db)
                    if integrity_result["verified"]:
                        logger.info(f"✓ Audit log integrity verified ({integrity_result['total_checked']} entries)")
                    else:
                        logger.critical(
                            f"⚠ AUDIT LOG INTEGRITY FAILURE: {len(integrity_result.get('errors', []))} issues detected!"
                        )
            except Exception as e:
                logger.warning(f"Could not verify audit log integrity: {e}")

        # Start audit verification in background (don't await)
        asyncio.create_task(verify_audit_logs_background())

    # Mark server as ready
    startup_status.set_ready()
    logger.info(f"Server started on port {settings.PORT}")
    logger.info(f"API Documentation: http://localhost:{settings.PORT}/docs")
    logger.info(f"Health Check: http://localhost:{settings.PORT}/health")

    yield

    # Shutdown
    logger.info("Shutting down gracefully...")
    await database_manager.disconnect()
    await cache_manager.disconnect()
    logger.info("Shutdown complete")


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

# Security Headers Middleware (add first so it wraps all responses)
from app.core.security_middleware import (
    SecurityHeadersMiddleware,
    IPBlockingMiddleware,
    IPLoggingMiddleware,
    SecurityMonitoringMiddleware,
)
app.add_middleware(SecurityHeadersMiddleware)

# Security Monitoring Middleware (intrusion detection, session hijacking, data exfiltration)
if settings.ENVIRONMENT == "production":
    app.add_middleware(SecurityMonitoringMiddleware)

# IP Blocking Middleware (geo-blocking and IP blocklist)
if settings.GEOIP_ENABLED:
    app.add_middleware(IPBlockingMiddleware, enabled=True, log_blocked_attempts=True)

# IP Logging Middleware (logs all requests with geo info)
if settings.IP_LOGGING_ENABLED:
    app.add_middleware(IPLoggingMiddleware)

# CORS - Restrict methods and headers for security
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "X-Requested-With",
        "X-CSRF-Token",
        "X-Session-ID",
        "Accept",
        "Origin",
    ],
    expose_headers=["X-Request-ID", "X-CSRF-Token"],
)

# Compression
app.add_middleware(GZipMiddleware, minimum_size=1000)


# ============================================
# Routes
# ============================================

# Include API v1 router
app.include_router(api_router, prefix="/api/v1")

# Include public portal API (no /api/v1 prefix - uses /api/public/v1)
app.include_router(public_portal_router, prefix="/api")


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
    - Schema validation status
    """
    health_status = {
        "status": "healthy",
        "version": settings.VERSION,
        "environment": settings.ENVIRONMENT,
        "timestamp": datetime.utcnow().isoformat(),
        "checks": {}
    }

    # Check if startup had schema validation errors
    if startup_status.phase == "error" or any("schema" in e.lower() for e in startup_status.errors):
        health_status["status"] = "unhealthy"
        health_status["checks"]["schema"] = "invalid"
        health_status["schema_error"] = (
            "Database schema is inconsistent. "
            "Run 'docker compose down -v' then 'docker compose up --build' to fix."
        )

    # Check database
    try:
        from app.core.database import database_manager
        if database_manager.is_connected:
            health_status["checks"]["database"] = "connected"
        else:
            health_status["checks"]["database"] = "disconnected"
            health_status["status"] = "degraded"
    except Exception as e:
        # Log details internally but don't expose to clients
        logger.error(f"Health check - database error: {e}")
        health_status["checks"]["database"] = "error"
        health_status["status"] = "unhealthy"

    # Check Redis
    try:
        from app.core.cache import cache_manager
        if cache_manager.is_connected:
            await cache_manager.redis.ping()
            health_status["checks"]["redis"] = "connected"
        else:
            health_status["checks"]["redis"] = "disconnected"
            health_status["status"] = "degraded"
    except Exception as e:
        logger.error(f"Health check - redis error: {e}")
        health_status["checks"]["redis"] = "error"
        health_status["status"] = "degraded"  # Redis is not critical

    # Security configuration validation
    security_warnings = settings.validate_security_config()

    if security_warnings:
        # Only expose warning count, not details (security)
        critical_count = len([w for w in security_warnings if "CRITICAL" in w])
        warning_count = len(security_warnings) - critical_count

        health_status["checks"]["security"] = {
            "status": "issues_detected",
            "critical_issues": critical_count,
            "warnings": warning_count,
        }

        if critical_count > 0:
            health_status["status"] = "unhealthy"
        elif warning_count > 0 and health_status["status"] == "healthy":
            health_status["status"] = "degraded"
    else:
        health_status["checks"]["security"] = {"status": "ok"}

    # Include startup status for frontend progress display
    health_status["startup"] = startup_status.to_dict()

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
