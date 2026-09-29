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
import re
import sys
import uuid
from contextvars import ContextVar
from typing import Any, Dict, Optional

from loguru import logger

# Context variable for per-request ID, accessible from any async task
request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")

# Some provider APIs authenticate with credentials in the query string — the
# TargetSolutions Training Records API takes ``key`` and ``secret`` as URL
# parameters and offers no header alternative. httpx logs every request URL at
# INFO, and Sentry's httpx integration records the raw query on breadcrumbs and
# spans, so without this both would carry a live credential.
_SENSITIVE_QUERY_PARAM = re.compile(
    r"(?:^|(?<=[?&]))"
    r"(key|secret|api_key|apikey|access_token|token|password)"
    r"=[^&#\s\"']*",
    re.IGNORECASE,
)
REDACTED_QUERY_VALUE = "[REDACTED]"


def redact_url_secrets(text: str) -> str:
    """Replace credential-bearing query parameter values in a URL or query."""
    return _SENSITIVE_QUERY_PARAM.sub(
        lambda m: f"{m.group(1)}={REDACTED_QUERY_VALUE}", text
    )


class _RedactUrlSecretsFilter(logging.Filter):
    """Redact query-string credentials from a stdlib log record's message."""

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        redacted = redact_url_secrets(message)
        if redacted != message:
            record.msg = redacted
            record.args = None
        return True


def install_httpx_url_redaction() -> None:
    """Attach the redaction filter to httpx's request logger (idempotent).

    Called from logging setup and again by the modules that put credentials in
    a URL, because a worker process may never run ``setup_logging``.
    """
    httpx_logger = logging.getLogger("httpx")
    if not any(isinstance(f, _RedactUrlSecretsFilter) for f in httpx_logger.filters):
        httpx_logger.addFilter(_RedactUrlSecretsFilter())


def _redact_http_query(data: Optional[Dict[str, Any]]) -> None:
    if data and isinstance(data.get("http.query"), str):
        data["http.query"] = redact_url_secrets(data["http.query"])


def _sentry_before_breadcrumb(
    crumb: Dict[str, Any], hint: Dict[str, Any]
) -> Dict[str, Any]:
    _redact_http_query(crumb.get("data"))
    if isinstance(crumb.get("message"), str):
        crumb["message"] = redact_url_secrets(crumb["message"])
    return crumb


# Sentry attaches each stack frame's local variables to an error event. In a
# failed provider request those include the query-parameter dict and httpx's
# request object, so a credential would leave the building with the traceback.
# Sentry's own scrubber covers names like "api_key" but not a bare "key".
_SENSITIVE_VARIABLE_NAMES = frozenset(
    {
        "key",
        "secret",
        "api_key",
        "apikey",
        "api_secret",
        "client_secret",
        "access_token",
        "accesstoken",
        "token",
        "password",
    }
)


def _scrub_credentials(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            k: (
                REDACTED_QUERY_VALUE
                if isinstance(k, str) and k.lower() in _SENSITIVE_VARIABLE_NAMES
                else _scrub_credentials(v)
            )
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [_scrub_credentials(v) for v in value]
    if isinstance(value, str):
        return redact_url_secrets(value)
    return value


def _sentry_before_send(event: Dict[str, Any], hint: Dict[str, Any]) -> Dict[str, Any]:
    return _scrub_credentials(event)


def _sentry_before_send_transaction(
    event: Dict[str, Any], hint: Dict[str, Any]
) -> Dict[str, Any]:
    for span in event.get("spans") or []:
        _redact_http_query(span.get("data"))
    return event


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
            diagnose=False,
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
            diagnose=False,
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
            diagnose=False,
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

    install_httpx_url_redaction()


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
        from sentry_sdk.integrations.loguru import (
            LoguruBreadcrumbHandler,
            LoguruEventHandler,
            LoguruIntegration,
            loguru_sentry_logs_handler,
        )
        from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

        class _SafeLoguruIntegration(LoguruIntegration):
            """Install Sentry handlers without rendering exception locals."""

            @staticmethod
            def setup_once() -> None:
                if LoguruIntegration.level is not None:
                    logger.add(
                        LoguruBreadcrumbHandler(level=LoguruIntegration.level),
                        level=LoguruIntegration.level,
                        format=LoguruIntegration.breadcrumb_format,
                        diagnose=False,
                    )

                if LoguruIntegration.event_level is not None:
                    logger.add(
                        LoguruEventHandler(level=LoguruIntegration.event_level),
                        level=LoguruIntegration.event_level,
                        format=LoguruIntegration.event_format,
                        diagnose=False,
                    )

                if LoguruIntegration.sentry_logs_level is not None:
                    logger.add(
                        loguru_sentry_logs_handler,
                        level=LoguruIntegration.sentry_logs_level,
                        diagnose=False,
                    )

        sentry_sdk.init(
            dsn=sentry_dsn,
            environment=environment,
            release=f"the-logbook@{version}",
            traces_sample_rate=0.2 if environment == "production" else 1.0,
            profiles_sample_rate=0.1 if environment == "production" else 0.0,
            integrations=[
                FastApiIntegration(),
                SqlalchemyIntegration(),
                _SafeLoguruIntegration(),
            ],
            send_default_pii=False,
            before_send=_sentry_before_send,
            before_breadcrumb=_sentry_before_breadcrumb,
            before_send_transaction=_sentry_before_send_transaction,
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
