"""Security-focused tests for the centralized logging configuration."""

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
