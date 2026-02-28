"""
Centralized Logging Configuration

Configures Loguru as the single logging backend for the entire application:
- Intercepts stdlib `logging` so third-party libraries (uvicorn, sqlalchemy,
  alembic, etc.) flow through Loguru with consistent formatting.
- Supports text (human-readable) and JSON (structured) output formats.
- Adds file logging with rotation and retention.
- Initializes Sentry SDK when SENTRY_ENABLED is set.
- Provides request-scoped context (request_id) for log correlation.
"""

import json as _json
import logging
import os
import sys
import uuid
from contextvars import ContextVar

from loguru import logger

# Context variable for per-request ID, accessible from any async task
request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")


def setup_logging(
    log_level: str = "INFO",
    log_format: str = "text",
    environment: str = "development",
) -> None:
    """
    Configure Loguru and intercept stdlib logging.

    Call once at application startup, before any other module emits logs.

    Args:
        log_level: Minimum log level for production (DEBUG is forced in dev).
        log_format: "text" for human-readable, "json" for structured output.
        environment: "development", "staging", or "production".
    """
    # 1. Remove default Loguru handler
    logger.remove()

    effective_level = log_level if environment == "production" else "DEBUG"

    # 2. Add stdout handler (text or JSON)
    if log_format == "json":
        logger.add(
            _json_sink,
            level=effective_level,
            colorize=False,
        )
    else:
        logger.add(
            sys.stdout,
            format=(
                "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | "
                "<level>{level: <8}</level> | "
                "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - "
                "<level>{message}</level>"
            ),
            level=effective_level,
        )

    # 3. Add file logging (optional – failure does not block startup)
    _logs_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "logs",
    )
    try:
        os.makedirs(_logs_dir, mode=0o750, exist_ok=True)
        _log_path = os.path.join(_logs_dir, "app.log")
        logger.add(
            _log_path,
            rotation="500 MB",
            retention="30 days",
            compression="gz",
            level="INFO",
        )
        # Restrict log file permissions to owner read/write only
        if os.path.exists(_log_path):
            os.chmod(_log_path, 0o640)
    except OSError:
        logger.debug("Could not set up file logging – stdout only")

    # 4. Intercept stdlib logging → Loguru
    _intercept_stdlib_logging()


# ------------------------------------------------------------------
# JSON sink
# ------------------------------------------------------------------


def _json_sink(message) -> None:
    """Write a single structured JSON line to stdout."""
    record = message.record
    log_entry = {
        "timestamp": record["time"].isoformat(),
        "level": record["level"].name,
        "message": record["message"],
        "module": record["name"],
        "function": record["function"],
        "line": record["line"],
        "request_id": request_id_ctx.get("-"),
    }
    if record["exception"]:
        log_entry["exception"] = str(record["exception"])
    print(_json.dumps(log_entry), flush=True)


# ------------------------------------------------------------------
# Stdlib interception
# ------------------------------------------------------------------
class _InterceptHandler(logging.Handler):
    """Route stdlib log records into Loguru."""

    def emit(self, record: logging.LogRecord) -> None:
        # Map stdlib level to Loguru level
        try:
            level = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno

        # Find the caller frame that originated the log call
        frame, depth = logging.currentframe(), 2
        while frame and frame.f_code.co_filename == logging.__file__:
            frame = frame.f_back
            depth += 1

        logger.opt(depth=depth, exception=record.exc_info).log(
            level, record.getMessage()
        )


def _intercept_stdlib_logging() -> None:
    """
    Replace the root handler so every stdlib logger (uvicorn, sqlalchemy,
    alembic, etc.) is routed through Loguru.
    """
    logging.basicConfig(handlers=[_InterceptHandler()], level=0, force=True)

    # Explicitly intercept well-known noisy loggers
    for name in (
        "uvicorn",
        "uvicorn.access",
        "uvicorn.error",
        "sqlalchemy",
        "sqlalchemy.engine",
        "alembic",
        "fastapi",
    ):
        lib_logger = logging.getLogger(name)
        lib_logger.handlers = [_InterceptHandler()]
        lib_logger.propagate = False


# ------------------------------------------------------------------
# Sentry integration
# ------------------------------------------------------------------
def setup_sentry(
    sentry_dsn: str,
    environment: str = "development",
    version: str = "0.0.0",
) -> None:
    """
    Initialize the Sentry SDK for error tracking.

    Only call when SENTRY_ENABLED is True and SENTRY_DSN is set.
    """
    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.loguru import LoguruIntegration
        from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

        sentry_sdk.init(
            dsn=sentry_dsn,
            environment=environment,
            release=f"the-logbook@{version}",
            traces_sample_rate=0.2 if environment == "production" else 1.0,
            profiles_sample_rate=0.1 if environment == "production" else 0.0,
            integrations=[
                FastApiIntegration(),
                SqlalchemyIntegration(),
                LoguruIntegration(),
            ],
            send_default_pii=False,
        )
        logger.info("Sentry SDK initialized")
    except Exception as e:
        logger.warning(f"Failed to initialize Sentry SDK: {e}")


# ------------------------------------------------------------------
# Request-ID helpers
# ------------------------------------------------------------------
def generate_request_id() -> str:
    """Generate a new UUID4 request ID and store it in the context var."""
    rid = uuid.uuid4().hex[:16]
    request_id_ctx.set(rid)
    return rid
