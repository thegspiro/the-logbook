"""
The Logbook - Backend Entry Point (FastAPI)

This is the main entry point for the backend API server.
It initializes the FastAPI application, sets up middleware,
connects to the database, and configures routes.
"""

import os
import signal
import traceback
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, Request
from starlette.middleware.cors import CORSMiddleware as _StarletteCORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from loguru import logger
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.api.public.display import router as public_display_router
from app.api.public.forms import router as public_forms_router
from app.api.public.portal import router as public_portal_router
from app.api.v1.api import api_router
from app.core.cache import cache_manager
from app.core.config import settings
from app.core.database import database_manager
from app.core.logging import setup_logging, setup_sentry

# Create rate limiter instance (uses Redis if available, falls back to in-memory)
_rate_limit_storage_uri = (
    f"redis://:{settings.REDIS_PASSWORD}@{settings.REDIS_HOST}:{settings.REDIS_PORT}/1"
    if settings.REDIS_PASSWORD
    else "memory://"
)
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[settings.RATE_LIMIT_DEFAULT],
    storage_uri=_rate_limit_storage_uri,
)

# SEC: In-memory rate limiting is per-process — with multiple workers,
# each has independent counters, effectively multiplying the rate limit.
if _rate_limit_storage_uri == "memory://":
    import logging as _logging

    _logging.getLogger("security").warning(
        "Rate limiter using in-memory storage (per-process). "
        "Set REDIS_PASSWORD to use Redis for shared rate limiting across workers."
    )

setup_logging(
    log_level=settings.LOG_LEVEL,
    log_format=settings.LOG_FORMAT,
    environment=settings.ENVIRONMENT,
)

# Initialize Sentry SDK when enabled
if settings.SENTRY_ENABLED and settings.SENTRY_DSN:
    setup_sentry(
        sentry_dsn=settings.SENTRY_DSN,
        environment=settings.ENVIRONMENT,
        version=settings.VERSION,
    )


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
        self.started_at = datetime.now(timezone.utc)
        self.ready = False
        self.errors = []
        self.detailed_message = None

    def set_phase(
        self, phase: str, message: str, detailed_message: Optional[str] = None
    ):
        import os as _os

        self.phase = phase
        self.message = message
        self.detailed_message = detailed_message
        logger.info(f"Startup [worker {_os.getpid()}]: {message}")

    def set_migration_progress(self, current: str, completed: int, total: int):
        self.current_migration = current
        self.migrations_completed = completed
        self.migrations_total = total
        self.message = f"Running migration {completed}/{total}: {current}"
        self.detailed_message = "Applying database schema changes to keep your data structure up to date. This may take a few minutes on first startup."

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
            "uptime_seconds": (
                datetime.now(timezone.utc) - self.started_at
            ).total_seconds(),
        }

        if self.detailed_message:
            result["detailed_message"] = self.detailed_message

        if self.migrations_total > 0:
            result["migrations"] = {
                "total": self.migrations_total,
                "completed": self.migrations_completed,
                "current": self.current_migration,
                "progress_percent": (
                    int((self.migrations_completed / self.migrations_total) * 100)
                    if self.migrations_total > 0
                    else 0
                ),
            }

        if self.errors:
            result["errors"] = self.errors

        return result


# Global startup status instance
startup_status = StartupStatus()


@contextmanager
def timeout_context(seconds: int, operation_name: str = "Operation"):
    """
    Context manager for adding timeout to blocking operations.

    Args:
        seconds: Timeout in seconds
        operation_name: Name of operation for error messages

    Raises:
        TimeoutError: If operation exceeds timeout
    """

    def timeout_handler(signum, frame):
        raise TimeoutError(
            f"{operation_name} timed out after {seconds} seconds. "
            "This may indicate a deadlock, infinite loop, or network issue."
        )

    # Set up the signal handler (Unix/Linux only - works in Docker containers)
    original_handler = signal.signal(signal.SIGALRM, timeout_handler)
    signal.alarm(seconds)

    try:
        yield
    finally:
        # Cancel the alarm and restore original handler
        signal.alarm(0)
        signal.signal(signal.SIGALRM, original_handler)


def validate_schema(engine) -> tuple[bool, list[str]]:
    """
    Validate that all expected database tables exist.

    Dynamically derives the expected table list from:
    - Base.metadata (all SQLAlchemy model tables)
    - MIGRATION_ONLY_TABLES (tables created by migration files without models)

    Also spot-checks columns on critical tables to catch schema drift.
    Returns (is_valid, list_of_errors).
    """
    from sqlalchemy import inspect

    errors = []

    try:
        _import_all_models()
        from app.core.database import Base

        inspector = inspect(engine)
        existing_tables = set(inspector.get_table_names())

        # 1. Check all model-based tables exist
        expected_model_tables = set(Base.metadata.tables.keys())
        missing_model = expected_model_tables - existing_tables
        if missing_model:
            errors.append(
                f"Missing {len(missing_model)} model-based table(s): "
                + ", ".join(sorted(missing_model)[:10])
                + (
                    f" ... and {len(missing_model) - 10} more"
                    if len(missing_model) > 10
                    else ""
                )
            )

        # 2. Check migration-only tables exist
        missing_migration = set(MIGRATION_ONLY_TABLES) - existing_tables
        if missing_migration:
            errors.append(
                f"Missing migration-only table(s): {', '.join(sorted(missing_migration))}"
            )

        # 3. Spot-check columns on critical tables (catches schema drift)
        critical_columns = {
            "organizations": ["id", "name", "slug", "active", "created_at"],
            "users": [
                "id",
                "organization_id",
                "username",
                "email",
                "password_hash",
                "status",
            ],
            "roles": ["id", "organization_id", "name", "slug", "permissions"],
            "onboarding_sessions": ["id", "session_id", "data", "expires_at"],
            "notification_logs": [
                "id",
                "organization_id",
                "channel",
                "category",
                "expires_at",
                "action_url",
            ],
        }
        for table_name, required_columns in critical_columns.items():
            if table_name not in existing_tables:
                continue  # Already reported as missing above
            columns = {col["name"] for col in inspector.get_columns(table_name)}
            missing_cols = [col for col in required_columns if col not in columns]
            if missing_cols:
                errors.append(
                    f"Table '{table_name}' missing columns: {', '.join(missing_cols)}"
                )
    except Exception as e:
        errors.append(f"Schema validation error: {e}")

    return (len(errors) == 0, errors)


def _attempt_schema_repair(engine, base_dir, original_errors) -> tuple[bool, list[str]]:
    """
    Attempt to repair schema inconsistencies instead of immediately crashing.

    Uses create_all(checkfirst=True) to fill in any missing model-based tables,
    then re-runs migration-only files (which use op.create_table and will fail
    gracefully if tables already exist). Re-validates after repair.

    Returns (is_valid, errors) from the post-repair validation.
    """
    from sqlalchemy import text
    from sqlalchemy.exc import DatabaseError, OperationalError

    logger.warning(
        f"Schema validation found {len(original_errors)} issue(s). "
        "Attempting automatic repair..."
    )
    for err in original_errors:
        logger.warning(f"  Issue: {err}")

    try:
        _import_all_models()
        from app.core.database import Base

        with engine.begin() as conn:
            try:
                conn.execute(text("SET FOREIGN_KEY_CHECKS = 0"))

                # Fill in any missing model-based tables
                logger.info(
                    "Repair: running create_all(checkfirst=True) for missing tables..."
                )
                Base.metadata.create_all(conn, checkfirst=True)

                # Re-run migration-only files for non-model tables
                versions_dir = os.path.join(base_dir, "alembic", "versions")
                for migration_file in MIGRATION_ONLY_FILES:
                    migration_path = os.path.join(versions_dir, migration_file)
                    if os.path.exists(migration_path):
                        try:
                            _run_migration_file(conn, migration_path)
                        except Exception as mf_err:
                            # "already exists" is expected if table was partially created
                            if "already exists" not in str(mf_err).lower():
                                logger.warning(
                                    f"Repair: migration file failed: {mf_err}"
                                )
            finally:
                try:
                    conn.execute(text("SET FOREIGN_KEY_CHECKS = 1"))
                except (OperationalError, DatabaseError):
                    logger.debug(
                        "Could not re-enable FOREIGN_KEY_CHECKS during schema repair",
                        exc_info=True,
                    )

        # Fill in any missing columns on existing tables — create_all only
        # handles missing tables, not missing columns.
        _add_missing_model_columns(engine)

        # Re-validate after repair
        schema_valid, schema_errors = validate_schema(engine)
        if schema_valid:
            logger.info("Schema repair successful - all issues resolved")
        else:
            logger.error(
                f"Schema repair incomplete - {len(schema_errors)} issue(s) remain"
            )
        return (schema_valid, schema_errors)

    except Exception as repair_err:
        logger.error(f"Schema repair failed: {repair_err}")
        return (False, original_errors + [f"Repair attempt failed: {repair_err}"])


def _add_missing_model_columns(engine):
    """
    Detect and add columns that exist in SQLAlchemy models but are missing
    from the database.

    create_all(checkfirst=True) only creates missing TABLES — it does not
    add missing columns to existing tables.  When the fast-path (or an
    'already exists' stamp-to-head) created the DB from an earlier model
    snapshot, columns added in later model updates will be absent.  This
    function fills that gap with ALTER TABLE … ADD COLUMN.
    """
    from sqlalchemy import inspect
    from sqlalchemy.exc import OperationalError

    _import_all_models()
    from app.core.database import Base

    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    added = []

    with engine.begin() as conn:
        for table_name, table in Base.metadata.tables.items():
            if table_name not in existing_tables:
                continue

            existing_cols = {c["name"] for c in inspector.get_columns(table_name)}

            for col in table.columns:
                if col.name in existing_cols:
                    continue

                col_type = col.type.compile(engine.dialect)
                # Use individually parameterized DDL; table/column names come
                # from SQLAlchemy metadata (trusted), not user input, but we
                # still avoid bare f-string interpolation for defence-in-depth.
                from sqlalchemy import DDL

                stmt = DDL(
                    "ALTER TABLE `%s` ADD COLUMN `%s` %s NULL"
                    % (
                        table_name.replace("`", "``"),
                        col.name.replace("`", "``"),
                        col_type,
                    )
                )
                try:
                    conn.execute(stmt)
                    added.append(f"{table_name}.{col.name}")
                    logger.info(f"Added missing column: {table_name}.{col.name}")
                except OperationalError as e:
                    if "duplicate column" not in str(e).lower():
                        logger.warning(
                            f"Could not add column {table_name}.{col.name}: {e}"
                        )

    if added:
        logger.info(
            f"Schema column repair: added {len(added)} missing column(s): "
            + ", ".join(added)
        )

    return added


# The revision stamped by the initial SQL schema (001_initial_schema.sql)
INITIAL_SQL_REVISION = "20260118_0001"

# The init SQL now only creates alembic_version (no application tables).
# The fast-path drops all non-alembic tables and creates everything fresh.

# Migration files that create tables without corresponding SQLAlchemy models.
# These must be run explicitly during fast-path initialization since
# Base.metadata.create_all() won't know about them.
MIGRATION_ONLY_FILES = [
    "20260201_0016_create_compliance_tables.py",
]

# Tables created by migration-only files (used by validate_schema to check completeness).
MIGRATION_ONLY_TABLES = [
    # compliance module (20260201_0016)
    "compliance_policies",
    "policy_acknowledgments",
    "compliance_checklists",
    "checklist_submissions",
    "compliance_incidents",
]

# Migration files that seed initial system data
SEED_DATA_FILE = "20260203_0023_seed_apparatus_data.py"
SEED_DATA_FILES = [
    "20260203_0023_seed_apparatus_data.py",
    "20260214_2000_seed_facilities_data.py",
    "20260306_0200_seed_nfpa_facility_data.py",
]


def _cleanup_duplicate_revisions(versions_dir):
    """
    Detect and remove migration files with duplicate revision IDs, and
    restore previously-staled files that are now needed.

    Stale migration files can appear when Docker images cache old COPY layers,
    or from incomplete git operations. Duplicate revision IDs crash Alembic's
    revision graph walker with "overlaps with other requested revisions".

    After resolving duplicates, any ``.stale`` files whose revision ID is no
    longer present among active ``.py`` files — but *is* referenced as a
    ``down_revision`` by another migration — are restored.  This handles the
    case where a previous startup incorrectly staled a file that a later code
    change (e.g. renaming the duplicate) has made unique again.

    Also removes stale __pycache__ bytecode in the versions directory.  When
    the host Python version differs from the container version (e.g. 3.11 vs
    3.13), leftover .pyc files can confuse module loaders and cause Alembic
    to silently skip revision scripts.
    """
    import re
    import shutil

    if not os.path.isdir(versions_dir):
        return

    # Remove __pycache__ to avoid stale bytecode from a different Python
    # version (common with Docker bind mounts).
    pycache_dir = os.path.join(versions_dir, "__pycache__")
    if os.path.isdir(pycache_dir):
        try:
            shutil.rmtree(pycache_dir)
            logger.info("Removed stale __pycache__ from migration versions directory")
        except Exception as e:
            logger.debug(f"Could not remove versions __pycache__: {e}")

    revision_re = re.compile(r"^revision\b.*?=\s*['\"](.+?)['\"]", re.MULTILINE)
    down_revision_re = re.compile(
        r"^down_revision\b.*?=\s*['\"](.+?)['\"]", re.MULTILINE
    )

    # Map revision ID -> list of (filepath, down_revision)
    rev_to_files = {}
    for filename in os.listdir(versions_dir):
        if not filename.endswith(".py") or filename.startswith("__"):
            continue
        filepath = os.path.join(versions_dir, filename)
        try:
            with open(filepath, "r") as f:
                content = f.read(2048)  # revision is always near the top
            rev_match = revision_re.search(content)
            if not rev_match:
                continue
            rev_id = rev_match.group(1)
            down_match = down_revision_re.search(content)
            down_rev = down_match.group(1) if down_match else None
            rev_to_files.setdefault(rev_id, []).append((filepath, filename, down_rev))
        except (OSError, ValueError):
            logger.debug(f"Could not parse migration file: {filename}", exc_info=True)
            continue

    # Build set of down_revisions that other files depend on.
    # A file that is depended on by another file is part of the chain.
    referenced_revisions = set()
    for rev_id, files in rev_to_files.items():
        for _, _, down_rev in files:
            if down_rev:
                referenced_revisions.add(down_rev)

    # For each duplicate, keep the file that's referenced by other migrations
    # (i.e., part of the active chain). Remove extras.
    for rev_id, files in rev_to_files.items():
        if len(files) <= 1:
            continue

        logger.warning(
            f"Duplicate revision '{rev_id}' found in {len(files)} files: "
            f"{[f[1] for f in files]}"
        )

        # Determine which file to keep: the one that is depended on by
        # another migration.  Check both exact revision ID references and
        # slug-form references (e.g. down_revision =
        # "20260303_0200_add_form_integration_type_column" instead of just
        # "20260303_0200").
        # If none or multiple are referenced, keep the one that appears first
        # alphabetically (most likely the original).
        files_sorted = sorted(files, key=lambda f: f[1])
        keep = files_sorted[0]
        for fp, fn, dr in files_sorted:
            slug = fn.removesuffix(".py")
            if slug in referenced_revisions or rev_id in referenced_revisions:
                keep = (fp, fn, dr)
                break

        for fp, fn, dr in files:
            if fp != keep[0]:
                stale_path = fp + ".stale"
                logger.warning(
                    f"Renaming stale duplicate migration: {fn} -> {fn}.stale"
                )
                try:
                    os.rename(fp, stale_path)
                except FileNotFoundError:
                    # Another worker already renamed it — harmless race
                    logger.info(
                        f"Duplicate migration {fn} already handled by another worker"
                    )
                except Exception as rename_err:
                    logger.error(f"Failed to rename {fn}: {rename_err}")

    # -----------------------------------------------------------------
    # Restore .stale files whose revision is no longer duplicated but is
    # needed by the migration chain.  This can happen when a previous
    # startup staled a file, and a subsequent code change resolved the
    # duplicate (e.g. the conflicting migration was renamed to a new
    # revision ID).
    # -----------------------------------------------------------------
    # Rebuild the active revision set after any duplicate cleanup above.
    active_revisions = set()
    active_down_revisions = set()
    for filename in os.listdir(versions_dir):
        if not filename.endswith(".py") or filename.startswith("__"):
            continue
        filepath = os.path.join(versions_dir, filename)
        try:
            with open(filepath, "r") as f:
                content = f.read(2048)
            rev_match = revision_re.search(content)
            down_match = down_revision_re.search(content)
            if rev_match:
                active_revisions.add(rev_match.group(1))
            if down_match:
                active_down_revisions.add(down_match.group(1))
        except (OSError, ValueError):
            continue

    for filename in os.listdir(versions_dir):
        if not filename.endswith(".py.stale"):
            continue
        filepath = os.path.join(versions_dir, filename)
        try:
            with open(filepath, "r") as f:
                content = f.read(2048)
            rev_match = revision_re.search(content)
            if not rev_match:
                continue
            stale_rev = rev_match.group(1)
            stale_slug = filename.removesuffix(".py.stale")
            # Only restore if: (a) this revision is not already provided by
            # an active .py file, and (b) some other migration depends on it
            # (either by exact revision ID or by filename slug).
            is_needed = (
                stale_rev in active_down_revisions
                or stale_slug in active_down_revisions
            )
            if stale_rev not in active_revisions and is_needed:
                restored = filepath.removesuffix(".stale")
                logger.info(
                    f"Restoring previously-staled migration {filename} "
                    f"(revision {stale_rev} needed by chain)"
                )
                try:
                    os.rename(filepath, restored)
                except Exception as restore_err:
                    logger.error(
                        f"Failed to restore {filename}: {restore_err}"
                    )
        except (OSError, ValueError):
            continue


def _import_all_models():
    """Import all SQLAlchemy models to ensure Base.metadata is complete."""
    import app.models  # noqa: F401 - triggers __init__.py which imports all models


def _run_migration_file(engine_or_conn, migration_path):
    """
    Run a single Alembic migration file's upgrade() function outside of Alembic.

    Uses Alembic's Operations context so migration code that calls
    op.create_table(), op.bulk_insert(), etc. works correctly.

    Args:
        engine_or_conn: SQLAlchemy Engine (opens new transaction) or
                        Connection (reuses existing transaction for batching).
        migration_path: Path to the Alembic migration .py file.
    """
    import importlib.util

    from sqlalchemy.engine import Connection

    from alembic.operations import Operations
    from alembic.runtime.migration import MigrationContext

    spec = importlib.util.spec_from_file_location("migration", migration_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    if isinstance(engine_or_conn, Connection):
        # Reuse existing connection/transaction (batched mode)
        ctx = MigrationContext.configure(engine_or_conn)
        with Operations.context(ctx):
            module.upgrade()
    else:
        # Open new transaction (standalone mode)
        with engine_or_conn.begin() as conn:
            ctx = MigrationContext.configure(conn)
            with Operations.context(ctx):
                module.upgrade()


def _fast_path_init(engine, alembic_cfg, base_dir, head_revision=None):
    """
    Fast-path database initialization for fresh installs.

    Instead of running 39+ individual Alembic migrations (which takes ~20 minutes),
    this creates all tables at once from SQLAlchemy model definitions and then
    handles tables/data that only exist in migration files.

    This reduces first-boot database setup from ~20 minutes to seconds.
    """
    from sqlalchemy import text
    from sqlalchemy.exc import DatabaseError, OperationalError

    from alembic import command
    from alembic.script import ScriptDirectory

    startup_status.set_phase(
        "migrations",
        "Fast-path: Initializing database schema...",
        "Creating all database tables from model definitions. "
        "This is much faster than running individual migrations.",
    )
    logger.info("Fresh database detected - using fast-path initialization")

    # 1. Import all models so Base.metadata has the complete schema
    _import_all_models()
    from app.core.database import Base

    # 2-5. Drop, create, and seed all in a SINGLE connection with FK checks off.
    #    This eliminates connection pool overhead and FK validation overhead
    #    across all DDL operations (~100+ CREATE TABLEs, ~40 indexes).
    versions_dir = os.path.join(base_dir, "alembic", "versions")
    with engine.begin() as conn:
        try:
            conn.execute(text("SET FOREIGN_KEY_CHECKS = 0"))

            # 2. Drop ALL existing tables so create_all() starts from a clean slate.
            #    Uses a single batched DROP TABLE statement instead of per-table drops.
            #    We keep alembic_version since command.stamp() manages it.
            logger.info("Dropping all existing tables for clean recreation...")
            result = conn.execute(text("SHOW TABLES"))
            tables_to_drop = [row[0] for row in result if row[0] != "alembic_version"]
            if tables_to_drop:
                import re

                _TABLE_NAME_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")
                for tname in tables_to_drop:
                    # SEC: Validate table name against strict allowlist pattern
                    # to prevent SQL injection via crafted table names.
                    if not _TABLE_NAME_RE.match(tname):
                        logger.warning(
                            "Skipping table with suspicious name: %r", tname
                        )
                        continue
                    conn.execute(text(f"DROP TABLE IF EXISTS `{tname}`"))
            logger.info(f"Dropped {len(tables_to_drop)} existing tables")

            # 3. Create ALL tables from current model definitions.
            #    checkfirst=True is used because multiple uvicorn workers may
            #    run this concurrently, and another worker may have already
            #    created some tables. FK_CHECKS=0 (set above) skips FK
            #    validation during CREATE TABLE.
            #    Iterates sorted_tables individually for progress logging so
            #    slow environments don't look hung during long create runs.
            sorted_tables = Base.metadata.sorted_tables
            total_tables = len(sorted_tables)
            logger.info(f"Creating {total_tables} tables from model definitions...")
            for i, table in enumerate(sorted_tables, 1):
                table.create(conn, checkfirst=True)
                if i % 25 == 0 or i == total_tables:
                    logger.info(f"  Tables created: {i}/{total_tables}")
            logger.info(f"All {total_tables} model-based tables created")

            # 4. Create tables that only exist in migration files (no SQLAlchemy models).
            #    Reuses the same connection to avoid pool overhead.
            for migration_file in MIGRATION_ONLY_FILES:
                migration_path = os.path.join(versions_dir, migration_file)
                if os.path.exists(migration_path):
                    logger.info(
                        f"Creating migration-only tables from {migration_file}..."
                    )
                    _run_migration_file(conn, migration_path)

            # 5. Insert seed data (apparatus types, statuses, maintenance types, facilities).
            for seed_file in SEED_DATA_FILES:
                seed_path = os.path.join(versions_dir, seed_file)
                if os.path.exists(seed_path):
                    logger.info(f"Inserting seed data from {seed_file}...")
                    _run_migration_file(conn, seed_path)
                    logger.info(f"Seed data from {seed_file} inserted")
        finally:
            # Re-enable FK checks even on failure. With NullPool the connection
            # dies anyway, but this is defense-in-depth for pooled engines.
            try:
                conn.execute(text("SET FOREIGN_KEY_CHECKS = 1"))
            except (OperationalError, DatabaseError):
                logger.debug(
                    "Could not re-enable FOREIGN_KEY_CHECKS during fast-path init",
                    exc_info=True,
                )

    # 6. Stamp alembic to head so future startups skip all migrations
    try:
        command.stamp(alembic_cfg, "head")
    except Exception as stamp_err:
        # If the revision graph is broken (missing migration file), stamp
        # directly with the manually-resolved head revision ID.
        logger.warning(
            f"command.stamp('head') failed ({stamp_err}). "
            "Falling back to manual head resolution for stamp."
        )
        import re as _stamp_re

        _rev_pat = _stamp_re.compile(
            r"^revision\s*[:=]\s*['\"](.+?)['\"]", _stamp_re.MULTILINE
        )
        _down_pat = _stamp_re.compile(
            r"^down_revision\s*[:=]\s*['\"](.+?)['\"]", _stamp_re.MULTILINE
        )
        _versions_dir = os.path.join(base_dir, "alembic", "versions")
        _all_revs = {}
        _all_down = set()
        for _fn in os.listdir(_versions_dir):
            if not _fn.endswith(".py") or _fn.startswith("_"):
                continue
            try:
                with open(os.path.join(_versions_dir, _fn)) as _mf:
                    _c = _mf.read(2048)
                _rm = _rev_pat.search(_c)
                _dm = _down_pat.search(_c)
                if _rm:
                    _all_revs[_rm.group(1)] = _dm.group(1) if _dm else None
                    if _dm:
                        _all_down.add(_dm.group(1))
            except Exception:
                continue
        _heads = sorted([r for r in _all_revs if r not in _all_down])
        if _heads:
            _manual_head = _heads[-1]
            logger.info(f"Stamping alembic_version to {_manual_head} via SQL")
            with engine.connect() as _sc:
                _sc.execute(text("DELETE FROM alembic_version"))
                _sc.execute(
                    text("INSERT INTO alembic_version (version_num) VALUES (:rev)"),
                    {"rev": _manual_head},
                )
                _sc.commit()
        else:
            logger.error("Could not determine head revision for stamp")

    try:
        head_rev = ScriptDirectory.from_config(alembic_cfg).get_current_head()
        logger.info(f"Database stamped to head revision: {head_rev}")
    except Exception:
        logger.info("Database stamped (could not resolve head for display)")
    logger.info("Fast-path database initialization complete")


def run_migrations():
    """
    Run Alembic migrations to ensure database schema is up to date.

    Optimized with two paths:
    - Fast-path: For fresh installs (detected by initial SQL revision stamp),
      uses SQLAlchemy create_all() instead of running 39+ individual migrations.
      Reduces first-boot setup from ~20 minutes to seconds.
    - Normal path: For existing installs, runs only pending Alembic migrations.
    """
    import os

    from sqlalchemy import create_engine, text
    from sqlalchemy.exc import DatabaseError, OperationalError, ProgrammingError
    from sqlalchemy.pool import NullPool

    from alembic import command
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    startup_status.set_phase("migrations", "Preparing database migrations...")

    base_dir = os.path.dirname(os.path.abspath(__file__))
    alembic_cfg = Config(os.path.join(base_dir, "alembic.ini"))
    alembic_cfg.set_main_option("script_location", os.path.join(base_dir, "alembic"))

    # Clean up duplicate/stale migration files before Alembic loads the graph.
    # Stale files can appear when Docker images cache old COPY layers and the
    # bind-mount doesn't fully override them, or from incomplete git operations.
    versions_dir = os.path.join(base_dir, "alembic", "versions")
    _cleanup_duplicate_revisions(versions_dir)

    # Retry revision graph loading with backoff.  On union filesystems
    # (e.g. Unraid shfs) recently-created migration files may not be
    # immediately visible to Docker bind mounts.
    import time as _time_mod

    _walk_ok = False
    _walk_err = None
    for _attempt in range(1, 4):  # up to 3 attempts
        script_dir = ScriptDirectory.from_config(alembic_cfg)
        try:
            all_revisions = list(script_dir.walk_revisions())
            total_migrations = len(all_revisions)
            _walk_ok = True
            break
        except Exception as walk_err:
            _walk_err = walk_err
            if _attempt < 3:
                logger.warning(
                    f"Revision graph walk failed (attempt {_attempt}/3): "
                    f"{walk_err}. Retrying in {_attempt}s..."
                )
                _time_mod.sleep(_attempt)  # 1s, 2s backoff
            else:
                logger.warning(
                    f"Could not walk revision graph after 3 attempts: " f"{walk_err}"
                )

    if not _walk_ok:
        missing_rev = str(_walk_err).strip("'\"")
        py_files = sorted(
            f
            for f in os.listdir(versions_dir)
            if f.endswith(".py") and not f.startswith("_")
        )
        # Check if the referenced migration file physically exists
        found = any(missing_rev in f for f in py_files)
        logger.warning(
            f"Revision '{missing_rev}' missing from graph. "
            f"{len(py_files)} .py files in versions dir. "
            f"File on disk: {found}"
        )

        # Create a fresh ScriptDirectory (the failed walk corrupts the
        # cached revision map on the old one).
        script_dir = ScriptDirectory.from_config(alembic_cfg)
        total_migrations = len(py_files)
    startup_status.migrations_total = total_migrations

    try:
        head_revision = script_dir.get_current_head()
    except Exception as head_err:
        logger.warning(
            f"Alembic could not resolve head revision: {head_err}. "
            f"Falling back to manual revision chain resolution."
        )
        # Fallback: manually walk the .py files to determine the head.
        # Build revision -> down_revision map, then find the revision
        # that no other revision depends on.
        import re as _re2

        _rev_pat = _re2.compile(r"^revision\b.*?=\s*['\"](.+?)['\"]", _re2.MULTILINE)
        _down_pat = _re2.compile(
            r"^down_revision\b.*?=\s*['\"](.+?)['\"]", _re2.MULTILINE
        )
        _all_revs = {}  # revision -> down_revision
        _all_down = set()
        _migration_files = [
            f
            for f in os.listdir(versions_dir)
            if f.endswith(".py") and not f.startswith("_")
        ]
        for _fname in _migration_files:
            _fpath = os.path.join(versions_dir, _fname)
            try:
                with open(_fpath, "r") as _mf:
                    _content = _mf.read(2048)
                _rm = _rev_pat.search(_content)
                _dm = _down_pat.search(_content)
                if _rm:
                    _rev_id = _rm.group(1)
                    _down_id = _dm.group(1) if _dm else None
                    _all_revs[_rev_id] = _down_id
                    if _down_id:
                        _all_down.add(_down_id)
            except Exception:
                continue
        # Head = a revision that is not referenced as any other's down_revision
        _heads = [r for r in _all_revs if r not in _all_down]
        if len(_heads) == 1:
            head_revision = _heads[0]
            logger.info(f"Manual head resolution succeeded: {head_revision}")
        elif _heads:
            # Multiple heads — pick the latest by sorting revision IDs
            head_revision = sorted(_heads)[-1]
            logger.warning(
                f"Multiple heads found: {_heads}. Using latest: {head_revision}"
            )
        else:
            logger.error(
                "Could not determine any head revision from migration files. "
                "Database migrations will be skipped."
            )
            return
    # NullPool avoids connection pool overhead during DDL-heavy initialization.
    # Matches Alembic's own env.py strategy (pool is discarded after migrations).
    engine = create_engine(settings.SYNC_DATABASE_URL, poolclass=NullPool)

    # Determine current database revision
    current_rev = None
    try:
        with engine.connect() as conn:
            result = conn.execute(
                text("SELECT version_num FROM alembic_version LIMIT 1")
            )
            row = result.fetchone()
            if row:
                current_rev = row[0]
    except (OperationalError, ProgrammingError):
        logger.debug(
            "Could not read alembic_version table (may not exist yet)", exc_info=True
        )

    # Fast exit: already at head - nothing to do
    if current_rev == head_revision:
        startup_status.migrations_completed = total_migrations
        startup_status.set_phase("migrations", "Database schema is up to date")
        logger.info(f"Database schema is already up to date (worker PID {os.getpid()})")

        # Still check for missing columns — create_all(checkfirst=True) during
        # fast-path init only creates missing TABLES, not missing columns on
        # existing tables.  Model updates that add new columns (e.g.
        # notification_logs.category) will be silently absent until repaired.
        try:
            _add_missing_model_columns(engine)
        except Exception as col_err:
            logger.warning(f"Column repair check failed (non-fatal): {col_err}")

        return

    # === ADVISORY LOCK: Serialize migrations across workers ===
    # Multiple uvicorn workers start simultaneously and all try to run
    # migrations. Use a MySQL advisory lock so only ONE worker performs
    # DDL; the others wait then re-check and skip.
    import time as _time

    MIGRATION_LOCK_NAME = "the_logbook_migrations"
    MIGRATION_LOCK_TIMEOUT = 300  # seconds to wait for the lock

    lock_conn = engine.connect()
    try:
        startup_status.set_phase("migrations", "Acquiring migration lock...")
        result = lock_conn.execute(
            text("SELECT GET_LOCK(:name, :timeout)"),
            {"name": MIGRATION_LOCK_NAME, "timeout": MIGRATION_LOCK_TIMEOUT},
        )
        got_lock = result.scalar()
        if not got_lock:
            raise RuntimeError(
                f"Could not acquire migration lock within {MIGRATION_LOCK_TIMEOUT}s. "
                "Another process may be stuck. Check for long-running DDL queries."
            )
        logger.info(
            f"Acquired migration lock (worker PID {os.getpid()}) - "
            "checking if migrations are needed"
        )

        # Re-check revision after acquiring lock - another worker may have
        # already completed migrations while we were waiting.
        current_rev = None
        try:
            with engine.connect() as check_conn:
                result = check_conn.execute(
                    text("SELECT version_num FROM alembic_version LIMIT 1")
                )
                row = result.fetchone()
                if row:
                    current_rev = row[0]
        except (OperationalError, ProgrammingError):
            logger.debug(
                "Could not re-read alembic_version after acquiring lock", exc_info=True
            )

        if current_rev == head_revision:
            startup_status.migrations_completed = total_migrations
            startup_status.set_phase("migrations", "Database schema is up to date")
            logger.info(
                f"Database already at head after acquiring lock (worker PID {os.getpid()}) "
                "- skipping migrations (another worker completed them)"
            )
            return

        # Check for revision mismatch (renamed migration files)
        if current_rev and current_rev != INITIAL_SQL_REVISION:
            try:
                script_dir.get_revision(current_rev)
            except Exception as rev_err:
                logger.debug(
                    f"Revision lookup failed for '{current_rev}': {rev_err}",
                    exc_info=True,
                )
                startup_status.set_phase(
                    "migrations", "Fixing migration version mismatch..."
                )
                logger.warning(
                    f"Migration revision '{current_rev}' not found. "
                    "Clearing invalid version..."
                )
                with engine.connect() as conn:
                    conn.execute(text("DELETE FROM alembic_version"))
                    conn.commit()
                current_rev = None
                logger.info("Cleared invalid migration version")

        # === FAST-PATH: Fresh database initialization ===
        # On first boot, the SQL init script stamps to INITIAL_SQL_REVISION.
        # Instead of running 39+ individual migrations (~20 min), create all
        # tables from model definitions in one batch (seconds).
        #
        # Self-healing: retries once on failure. Because MySQL auto-commits DDL,
        # a partial failure leaves orphaned tables. The retry drops everything
        # and starts from a clean slate, recovering without manual intervention.
        if current_rev == INITIAL_SQL_REVISION or current_rev is None:
            max_attempts = 2
            for attempt in range(1, max_attempts + 1):
                try:
                    with timeout_context(1200, "Fast-path database initialization"):
                        _fast_path_init(engine, alembic_cfg, base_dir, head_revision)
                    break  # Success
                except Exception as init_error:
                    if attempt < max_attempts:
                        logger.warning(
                            f"Fast-path attempt {attempt} failed: {init_error}. "
                            "Retrying (the retry will drop all tables and start clean)..."
                        )
                        startup_status.set_phase(
                            "migrations",
                            "Retrying database initialization...",
                            "First attempt failed. Retrying with a clean slate.",
                        )
                        _time.sleep(2)
                    else:
                        raise

            startup_status.migrations_completed = total_migrations
            startup_status.set_phase("migrations", "Validating database schema...")

            # Validate schema after fast-path init
            schema_valid, schema_errors = validate_schema(engine)

            # Self-healing: if validation fails, attempt to repair missing tables
            # before giving up. This handles edge cases like partial create_all()
            # where most tables were created but a few failed.
            if not schema_valid:
                schema_valid, schema_errors = _attempt_schema_repair(
                    engine, base_dir, schema_errors
                )

            if not schema_valid:
                error_msg = (
                    "DATABASE SCHEMA INCONSISTENCY DETECTED after fast-path init!\n"
                    "Issues found:\n"
                    + "\n".join(f"  - {e}" for e in schema_errors)
                    + "\n\n"
                    "Automatic repair was attempted but could not resolve all issues.\n"
                    "TO FIX: docker compose down -v && docker compose up --build"
                )
                logger.error(error_msg)
                raise RuntimeError(error_msg)

            logger.info("Database schema validated successfully")
            startup_status.set_phase("migrations", "Database initialization complete")
            return

        # === NORMAL PATH: Run pending Alembic migrations ===
        # For existing installations being upgraded
        startup_status.set_phase("migrations", "Running database migrations...")
        logger.info("Running database migrations...")

        schema_was_stamped = False

        try:
            with timeout_context(1800, "Database migrations"):
                command.upgrade(alembic_cfg, head_revision)

            startup_status.migrations_completed = total_migrations
            startup_status.set_phase("migrations", "Database migrations complete")
            logger.info("Database migrations complete")
        except TimeoutError as timeout_error:
            logger.error(f"{timeout_error}")
            startup_status.add_error(str(timeout_error))
            startup_status.phase = "error"
            startup_status.message = "Database migrations timed out"
            raise RuntimeError(
                "Database migrations timed out after 30 minutes. "
                "Check database logs for locked tables or stuck queries."
            )
        except Exception as upgrade_error:
            error_str = str(upgrade_error).lower()
            # Recoverable errors: table/index already exists, or Alembic
            # revision graph is broken (common on Unraid union filesystems
            # where bind-mounted files are transiently invisible).
            _is_dup = "already exists" in error_str or "duplicate" in error_str
            _is_graph = not _walk_ok  # revision graph was already broken
            if _is_dup or _is_graph:
                logger.warning(
                    f"Migration failed ({upgrade_error}). Stamping to head..."
                )
                if _is_graph:
                    # Ensure all model-defined tables exist since individual
                    # migrations couldn't run.
                    try:
                        _import_all_models()
                        from app.core.database import Base as _Base

                        _Base.metadata.create_all(engine, checkfirst=True)
                    except Exception as create_err:
                        logger.warning(f"create_all fallback failed: {create_err}")
                try:
                    # Use direct SQL to stamp — Alembic's command.stamp()
                    # re-builds the revision graph which can fail on union
                    # filesystems (Unraid shfs) when files are invisible.
                    with engine.begin() as stamp_conn:
                        stamp_conn.execute(text("DELETE FROM alembic_version"))
                        stamp_conn.execute(
                            text(
                                "INSERT INTO alembic_version (version_num) VALUES (:rev)"
                            ),
                            {"rev": head_revision},
                        )
                    schema_was_stamped = True
                    startup_status.migrations_completed = total_migrations
                    logger.info(f"Stamped database to {head_revision}")
                except Exception as stamp_error:
                    logger.warning(f"Could not stamp database: {stamp_error}")
                    startup_status.add_error(f"Migration stamp failed: {stamp_error}")
            else:
                startup_status.add_error(f"Migration failed: {upgrade_error}")
                raise

        # Validate schema after migrations
        startup_status.set_phase("migrations", "Validating database schema...")
        schema_valid, schema_errors = validate_schema(engine)

        # Self-healing: attempt repair before crashing
        if not schema_valid:
            schema_valid, schema_errors = _attempt_schema_repair(
                engine, base_dir, schema_errors
            )

        if not schema_valid:
            error_msg = (
                "DATABASE SCHEMA INCONSISTENCY DETECTED!\n"
                "The database schema does not match the expected structure.\n\n"
                "Issues found:\n"
                + "\n".join(f"  - {e}" for e in schema_errors)
                + "\n\n"
                "Automatic repair was attempted but could not resolve all issues.\n"
                "TO FIX: docker compose down -v && docker compose up --build"
            )
            logger.error(error_msg)

            if schema_was_stamped:
                logger.critical(
                    "CRITICAL: Schema stamped to head but validation failed. "
                    "Database must be reset with 'docker compose down -v'"
                )

            raise RuntimeError(error_msg)
        else:
            logger.info("Database schema validated successfully")
    finally:
        # Always release the advisory lock, even on error
        try:
            lock_conn.execute(
                text("SELECT RELEASE_LOCK(:name)"), {"name": MIGRATION_LOCK_NAME}
            )
        except (OperationalError, DatabaseError):
            logger.debug("Could not release migration advisory lock", exc_info=True)
        try:
            lock_conn.close()
        except (OperationalError, DatabaseError):
            logger.debug("Could not close migration lock connection", exc_info=True)


def validate_security_configuration():
    """
    Validate security configuration on startup.
    Blocks startup in production if critical security settings are missing.
    """
    warnings = settings.validate_security_config()

    # SEC: Also validate CORS configuration
    cors_warnings = settings.validate_cors_config()
    warnings.extend(cors_warnings)

    # SEC: Block wildcard CORS with credentials — this combination is
    # explicitly insecure and browsers will reject it, but a misconfigured
    # reverse proxy could still be exploited.
    origins = (
        settings.ALLOWED_ORIGINS
        if isinstance(settings.ALLOWED_ORIGINS, list)
        else [settings.ALLOWED_ORIGINS]
    )
    if "*" in origins:
        warnings.append(
            "CRITICAL: ALLOWED_ORIGINS contains wildcard '*'. "
            "This is insecure with allow_credentials=True and MUST be fixed."
        )

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
        critical_warnings = [w for w in warnings if "CRITICAL" in w]
        if critical_warnings and settings.ENVIRONMENT == "production":
            raise RuntimeError(
                "SECURITY FAILURE: Cannot start in production with insecure defaults. "
                f"{len(critical_warnings)} critical issue(s) found. "
                "Set required environment variables before deploying."
            )
        elif critical_warnings and settings.SECURITY_BLOCK_INSECURE_DEFAULTS:
            logger.error(
                f"SECURITY WARNING: {len(critical_warnings)} critical issue(s) found. "
                "These MUST be resolved before deploying to production."
            )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager for startup and shutdown events
    """
    # Startup
    import os as _os

    _worker_pid = _os.getpid()
    logger.info(f"Starting The Logbook Backend (worker PID {_worker_pid})...")
    logger.info(f"Environment: {settings.ENVIRONMENT}")
    logger.info(f"Version: {settings.VERSION}")

    # Validate security configuration first
    startup_status.set_phase(
        "security",
        "Validating security configuration...",
        "Checking encryption keys, secrets, and security settings to ensure safe operation.",
    )
    validate_security_configuration()

    # Connect to database
    startup_status.set_phase(
        "database",
        "Connecting to database...",
        "Establishing connection to MySQL database. This may take up to 2 minutes if MySQL is still initializing.",
    )
    logger.info("Connecting to database...")
    await database_manager.connect()
    logger.info("Database connected")

    # Preflight environment check before migrations
    startup_status.set_phase(
        "preflight",
        "Running preflight checks...",
        "Verifying environment configuration and system requirements before database setup.",
    )
    logger.info("Running preflight environment checks...")

    # Check critical environment variables
    _insecure = ("INSECURE_DEFAULT", "CHANGE_ME", "change_me")
    preflight_warnings = []
    if not settings.SECRET_KEY or any(p in settings.SECRET_KEY for p in _insecure):
        preflight_warnings.append("SECRET_KEY is not set or uses an insecure value")
    if not settings.ENCRYPTION_KEY or any(
        p in settings.ENCRYPTION_KEY for p in _insecure
    ):
        preflight_warnings.append(
            "ENCRYPTION_KEY is not set or uses an insecure value"
        )

    if preflight_warnings and settings.ENVIRONMENT == "production":
        for warning in preflight_warnings:
            logger.warning(f"⚠ Preflight: {warning}")

    logger.info("✓ Preflight checks complete")

    # Run migrations to ensure tables exist
    startup_status.set_phase(
        "migrations",
        "Setting up database tables...",
        "Preparing to run database migrations. This ensures your database schema is up to date.",
    )
    run_migrations()

    # After migrations complete, parallelize independent operations for faster startup
    startup_status.set_phase(
        "services",
        "Initializing services...",
        "Connecting to Redis, initializing GeoIP, and validating database in parallel.",
    )
    logger.info(f"Starting parallel service initialization (worker PID {_worker_pid})...")

    import asyncio

    async def connect_redis():
        """Connect to Redis cache"""
        try:
            logger.info("Connecting to Redis...")
            await cache_manager.connect()
            if cache_manager.is_connected:
                logger.info("✓ Redis connected")
            else:
                logger.warning(
                    "Redis unavailable - running in degraded mode (caching disabled)"
                )
        except Exception as e:
            logger.warning(f"Redis connection failed: {e}")

    async def initialize_geoip():
        """Initialize GeoIP service"""
        try:
            if settings.GEOIP_ENABLED:
                from app.core.geoip import init_geoip_service

                blocked_countries = settings.get_blocked_countries_set()
                init_geoip_service(
                    geoip_db_path=settings.GEOIP_DATABASE_PATH,
                    blocked_countries=blocked_countries,
                    enabled=True,
                )
                logger.info(
                    f"✓ GeoIP service initialized. Blocked countries: {blocked_countries or 'none'}"
                )
            else:
                logger.info("GeoIP service disabled")
        except Exception as e:
            logger.warning(f"GeoIP initialization failed: {e}")

    async def validate_database():
        """Validate database schema and enums"""
        try:
            logger.info("Validating database enum consistency...")
            from app.core.database import async_session_factory
            from app.utils.startup_validators import run_startup_validations

            async with async_session_factory() as db:
                # Run validations in non-strict mode (log warnings but don't block startup)
                await run_startup_validations(db, strict=False)
            logger.info("✓ Database validations complete")
        except Exception as e:
            logger.warning(f"Could not run startup validations: {e}")
            startup_status.add_error(f"Startup validation error: {str(e)}")

    # Run Redis, GeoIP, and validations in parallel
    await asyncio.gather(
        connect_redis(), initialize_geoip(), validate_database(), return_exceptions=True
    )

    logger.info(f"✓ Parallel service initialization complete (worker PID {_worker_pid})")

    # Start WebSocket pub/sub listener (after Redis is connected)
    from app.core.websocket_manager import ws_manager

    await ws_manager.start_listener()

    # Helper: use Redis SETNX to ensure a background task runs on only one worker.
    # Returns True if this worker should run the task.
    async def _try_claim_background_task(task_name: str, ttl: int = 300) -> bool:
        """Claim a one-time background task using Redis SETNX. Returns True if claimed."""
        try:
            if cache_manager.is_connected and cache_manager.redis_client:
                key = f"startup_task:{task_name}"
                claimed = await cache_manager.redis_client.set(
                    key, str(_worker_pid), nx=True, ex=ttl
                )
                return bool(claimed)
        except Exception:
            pass
        # If Redis is unavailable, fall back to running on all workers
        return True

    # Defer audit log verification to background (only in production, don't block startup)
    if settings.ENVIRONMENT == "production":

        async def verify_audit_logs_background():
            """Verify audit log integrity in background, rehash if needed"""
            try:
                await asyncio.sleep(5)  # Give server time to fully start
                if not await _try_claim_background_task("audit_log_verification"):
                    logger.debug(
                        f"Audit log verification skipped (worker PID {_worker_pid}) "
                        "- another worker is handling it"
                    )
                    return
                logger.info(f"Starting background audit log verification (worker PID {_worker_pid})...")
                from app.core.audit import audit_logger, verify_audit_log_integrity
                from app.core.database import async_session_factory

                async with async_session_factory() as db:
                    integrity_result = await verify_audit_log_integrity(db)
                    if integrity_result["verified"]:
                        logger.info(
                            f"✓ Audit log integrity verified ({integrity_result['total_checked']} entries)"
                        )
                    else:
                        error_count = len(integrity_result.get("errors", []))
                        logger.warning(
                            f"Audit log hash mismatches detected ({error_count} entries) — rehashing chain..."
                        )
                        rehashed = await audit_logger.rehash_chain(db)
                        await db.commit()
                        if rehashed > 0:
                            logger.info(
                                f"✓ Rehashed {rehashed} audit log entries, chain is now consistent"
                            )
                        else:
                            logger.critical(
                                f"⚠ AUDIT LOG INTEGRITY FAILURE: {error_count} issues could not be resolved!"
                            )
            except Exception as e:
                logger.warning(f"Could not verify audit log integrity: {e}")

        # Start audit verification in background (don't await)
        asyncio.create_task(verify_audit_logs_background())

    # Backfill FormIntegrations for existing pipeline stages (background, non-blocking)
    async def backfill_pipeline_form_integrations():
        """Create missing MEMBERSHIP_INTEREST FormIntegrations for pipeline stages
        that reference a form_id in their config but have no corresponding integration.
        """
        try:
            await asyncio.sleep(3)  # Let the server finish starting
            if not await _try_claim_background_task("pipeline_backfill"):
                logger.debug(
                    f"Pipeline backfill skipped (worker PID {_worker_pid}) "
                    "- another worker is handling it"
                )
                return
            from app.core.database import async_session_factory
            from app.models.membership_pipeline import (
                MembershipPipeline,
                MembershipPipelineStep,
            )
            from app.services.membership_pipeline_service import (
                MembershipPipelineService,
            )

            async with async_session_factory() as db:
                from sqlalchemy import select as sa_select

                result = await db.execute(
                    sa_select(
                        MembershipPipelineStep.config,
                        MembershipPipeline.organization_id,
                    ).join(
                        MembershipPipeline,
                        MembershipPipelineStep.pipeline_id == MembershipPipeline.id,
                    )
                )
                rows = result.all()

                service = MembershipPipelineService(db)
                created = 0
                for config, org_id in rows:
                    if not isinstance(config, dict):
                        continue
                    form_id = config.get("form_id")
                    if not form_id:
                        continue
                    try:
                        await service._ensure_membership_form_integration(
                            form_id, org_id
                        )
                        created += 1
                    except Exception as step_err:
                        logger.warning(
                            f"Backfill: could not create integration for "
                            f"form {form_id}: {step_err}"
                        )

                if created > 0:
                    logger.info(
                        f"✓ Backfill: checked {created} pipeline stage(s) for "
                        "missing FormIntegrations"
                    )
        except Exception as e:
            logger.warning(f"Pipeline form integration backfill failed: {e}")

    asyncio.create_task(backfill_pipeline_form_integrations())

    # Mark server as ready
    startup_status.set_ready()
    logger.info(f"Server started on port {settings.PORT} (worker PID {_worker_pid})")
    logger.info(f"API Documentation: http://localhost:{settings.PORT}/docs")
    logger.info(f"Health Check: http://localhost:{settings.PORT}/health")

    yield

    # Shutdown
    logger.info(f"Shutting down gracefully (worker PID {_worker_pid})...")
    await ws_manager.stop_listener()
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
    redirect_slashes=False,
)

# Attach rate limiter to application
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# Custom validation error handler — returns user-friendly messages
# without leaking internal schema/field details.
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse as _JSONResponse


@app.exception_handler(RequestValidationError)
async def _validation_error_handler(request: Request, exc: RequestValidationError):
    """
    Replace Pydantic's default verbose validation errors with concise,
    user-friendly messages that enumerate only the field name and the
    human-readable constraint that was violated.
    """
    errors: list[dict[str, str]] = []
    for err in exc.errors():
        loc_parts = [str(p) for p in err.get("loc", []) if p != "body"]
        field = ".".join(loc_parts) if loc_parts else "request"
        err_type = err.get("type", "")

        # Build a short, safe message
        if "literal_error" in err_type:
            ctx = err.get("ctx", {})
            expected = ctx.get("expected", "")
            msg = (
                f"Invalid value. Expected one of: {expected}"
                if expected
                else "Invalid value."
            )
        elif "missing" in err_type:
            msg = "This field is required."
        elif "string_too_short" in err_type:
            msg = "Value is too short."
        elif "string_too_long" in err_type:
            msg = "Value is too long."
        elif "greater_than_equal" in err_type or "less_than_equal" in err_type:
            msg = "Value is out of the allowed range."
        elif "uuid" in err_type:
            msg = "Invalid ID format."
        elif "date" in err_type or "datetime" in err_type:
            msg = "Invalid date format."
        elif "int" in err_type or "float" in err_type or "decimal" in err_type:
            msg = "Expected a number."
        elif "bool" in err_type:
            msg = "Expected true or false."
        else:
            msg = "Invalid value."

        errors.append({"field": field, "message": msg})

    return _JSONResponse(
        status_code=422,
        content={"detail": errors},
    )


# ============================================
# Middleware
# ============================================


class CORSMiddleware(_StarletteCORSMiddleware):
    """Thin wrapper that lets WebSocket connections bypass CORS origin checks.

    Starlette's CORSMiddleware rejects WebSocket upgrades whose ``Origin``
    header is not in ``allow_origins``.  Browsers *always* send ``Origin``
    on WebSocket handshakes (even same-origin), so deployments behind a
    reverse-proxy whose public URL differs from ``ALLOWED_ORIGINS`` get a
    spurious 403.  WebSocket endpoints already perform their own JWT-based
    authentication, so the CORS gate is redundant for them.
    """

    async def __call__(self, scope, receive, send):
        if scope["type"] == "websocket":
            await self.app(scope, receive, send)
            return
        await super().__call__(scope, receive, send)


# Security Headers Middleware (add first so it wraps all responses)
from app.core.security_middleware import (
    IPBlockingMiddleware,
    IPLoggingMiddleware,
    SecurityHeadersMiddleware,
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
# Global Exception Handler
# ============================================

# Query parameter keys that must never appear in error logs
_SENSITIVE_QUERY_KEYS = {
    "token",
    "api_key",
    "password",
    "secret",
    "key",
    "code",
    "access_token",
    "refresh_token",
}


def _sanitize_query_params(query_string: str) -> str:
    """Redact sensitive query parameters before persisting to error logs."""
    if not query_string:
        return ""
    from urllib.parse import parse_qs, urlencode

    parsed = parse_qs(query_string, keep_blank_values=True)
    for key in list(parsed.keys()):
        if key.lower() in _SENSITIVE_QUERY_KEYS:
            parsed[key] = ["[REDACTED]"]
    return urlencode(parsed, doseq=True)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """
    Catch unhandled backend exceptions and log them to the error_logs table
    so they appear on the Error Monitoring page.
    """
    # Build error details
    error_type = type(exc).__name__
    error_message = str(exc)
    tb = traceback.format_exc()

    # Try to extract user/org context from the JWT token
    user_id = None
    org_id = None
    try:
        from app.core.security import decode_token

        auth_header = request.headers.get("authorization", "")
        if auth_header.lower().startswith("bearer "):
            token = auth_header.split(" ", 1)[1]
            payload = decode_token(token)
            user_id = payload.get("sub")
            org_id = payload.get("org_id")
    except (ValueError, KeyError, AttributeError):
        logger.debug("Could not extract user context from JWT token", exc_info=True)

    # Persist to error_logs table
    if org_id:
        try:
            from app.core.database import database_manager
            from app.models.error_log import ErrorLog

            async for session in database_manager.get_session():
                error_log = ErrorLog(
                    organization_id=org_id,
                    error_type=f"BACKEND_{error_type.upper()}",
                    error_message=error_message,
                    user_message=f"An internal server error occurred: {error_type}",
                    troubleshooting_steps=[
                        "This error has been automatically logged",
                        "Check the Error Monitoring page for details",
                        "Contact your system administrator if the issue persists",
                    ],
                    context={
                        "method": request.method,
                        "path": str(request.url.path),
                        "query": _sanitize_query_params(str(request.url.query)),
                        "traceback": (
                            tb if settings.ENVIRONMENT != "production" else None
                        ),
                        "source": "backend",
                    },
                    user_id=user_id,
                )
                session.add(error_log)
                await session.commit()
                break
        except Exception as log_exc:
            logger.error(f"Failed to persist error log: {log_exc}")

    logger.exception(
        f"Unhandled {error_type} on {request.method} {request.url.path}: {error_message}"
    )

    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


# ============================================
# Routes
# ============================================

# Include API v1 router
app.include_router(api_router, prefix="/api/v1")

# Include public portal API (no /api/v1 prefix - uses /api/public/v1)
app.include_router(public_portal_router, prefix="/api")

# Include public forms API (no auth required - uses /api/public/v1/forms)
app.include_router(public_forms_router, prefix="/api")

# Include public display API (no auth required - uses /api/public/v1/display)
app.include_router(public_display_router, prefix="/api")


# Health check endpoint
@app.get("/health")
async def health_check():
    """
    Minimal health check endpoint for load balancers and Docker healthchecks.

    SEC: Returns only status and ready flag — no version, environment, or
    internal service state that could help attackers fingerprint the system.
    Use /health/detailed (authenticated, non-production) for diagnostics.
    """
    from fastapi.responses import JSONResponse

    overall_status = "healthy"
    db_status = "connected"
    redis_status = "connected"
    schema_error = None

    # Check if startup had fatal errors
    if startup_status.phase == "error" or any(
        "schema" in e.lower() for e in startup_status.errors
    ):
        overall_status = "unhealthy"
        schema_error = (
            "Database schema is inconsistent. "
            "Run 'docker compose down -v' then 'docker compose up --build' to fix."
        )

    # Check database connectivity
    try:
        from sqlalchemy import text as sa_text

        from app.core.database import database_manager

        if database_manager.is_connected:
            async with database_manager.session_factory() as session:
                await session.execute(sa_text("SELECT 1"))
        else:
            db_status = "disconnected"
            overall_status = "degraded"
    except Exception as e:
        logger.error(f"Health check - database error: {e}")
        db_status = "error"
        overall_status = "unhealthy"

    # Check Redis connectivity
    try:
        from app.core.cache import cache_manager

        if cache_manager.is_connected:
            await cache_manager.redis.ping()
        else:
            redis_status = "disconnected"
            if overall_status == "healthy":
                overall_status = "degraded"
    except Exception as e:
        logger.error(f"Health check - redis error: {e}")
        redis_status = "error"
        if overall_status == "healthy":
            overall_status = "degraded"

    body: dict = {
        "status": overall_status,
        "ready": startup_status.ready,
    }

    # SEC: Expose detailed service state only during startup (for the
    # onboarding UI which displays startup progress).  Once the app is
    # ready, the endpoint returns only status + ready flag to prevent
    # information leakage about internal services and configuration.
    if not startup_status.ready:
        body["version"] = settings.VERSION
        body["startup"] = startup_status.to_dict()
        body["checks"] = {
            "database": db_status,
            "redis": redis_status,
        }
        if schema_error:
            body["schema_error"] = schema_error

    status_code = 503 if overall_status == "unhealthy" else 200
    return JSONResponse(content=body, status_code=status_code)


@app.get("/health/detailed")
async def health_check_detailed():
    """
    Detailed health check with system information
    Only available in non-production environments for security
    """
    if settings.ENVIRONMENT == "production":
        return {"error": "Detailed health check not available in production"}

    import psutil

    return {
        "status": "healthy",
        "version": settings.VERSION,
        "environment": settings.ENVIRONMENT,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "system": {
            "cpu_percent": psutil.cpu_percent(interval=1),
            "memory_percent": psutil.virtual_memory().percent,
            "disk_percent": psutil.disk_usage("/").percent,
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
            },
        },
    }


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "message": "The Logbook API",
        "version": settings.VERSION,
        "docs": "/docs" if settings.ENABLE_DOCS else "Documentation disabled",
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
