"""Security-focused tests for the centralized logging configuration."""

import sentry_sdk

from app.core import logging as logging_config


def test_all_log_sinks_disable_exception_variable_diagnostics(monkeypatch):
    """Tracebacks must not render sensitive local variable values."""
    sink_options = []

    monkeypatch.setattr(logging_config.logger, "remove", lambda: None)
    monkeypatch.setattr(
        logging_config.logger,
        "add",
        lambda _sink, **options: sink_options.append(options),
    )
    monkeypatch.setattr(logging_config.os, "makedirs", lambda *args, **kwargs: None)
    monkeypatch.setattr(logging_config.os.path, "exists", lambda _path: False)
    monkeypatch.setattr(logging_config, "_intercept_stdlib_logging", lambda: None)

    logging_config.setup_logging(log_format="text", environment="production")
    logging_config.setup_logging(log_format="json", environment="production")

    assert len(sink_options) == 4
    assert all(options["diagnose"] is False for options in sink_options)


def test_sentry_log_sinks_disable_exception_variable_diagnostics(monkeypatch):
    """Sentry's additional Loguru handlers must also suppress local values."""
    init_options = {}
    sink_options = []

    monkeypatch.setattr(
        sentry_sdk, "init", lambda **options: init_options.update(options)
    )
    monkeypatch.setattr(
        logging_config.logger,
        "add",
        lambda _sink, **options: sink_options.append(options),
    )
    monkeypatch.setattr(logging_config.logger, "info", lambda _message: None)

    logging_config.setup_sentry("https://public@example.test/1")
    loguru_integration = init_options["integrations"][-1]
    loguru_integration.setup_once()

    assert len(sink_options) == 3
    assert all(options["diagnose"] is False for options in sink_options)
