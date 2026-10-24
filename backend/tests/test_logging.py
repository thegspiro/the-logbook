"""Security-focused tests for the centralized logging configuration."""

import io
import json

import pytest
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


def test_sentry_events_exclude_frame_local_variables(monkeypatch):
    """Frame locals hold decrypted PHI; the scrubber only knows credential names."""
    init_options = {}
    monkeypatch.setattr(
        sentry_sdk, "init", lambda **options: init_options.update(options)
    )
    monkeypatch.setattr(logging_config.logger, "info", lambda _message: None)

    logging_config.setup_sentry("https://public@example.test/1")

    assert init_options["include_local_variables"] is False
    assert init_options["send_default_pii"] is False


def test_transaction_hook_tolerates_a_trimmed_span_list():
    """Sentry replaces an over-long span list with an AnnotatedValue; the hook
    passes the event through untouched."""
    from sentry_sdk.utils import AnnotatedValue

    event = {"spans": AnnotatedValue.removed_because_over_size_limit()}
    assert logging_config._sentry_before_send_transaction(event, {}) is event


def test_transaction_hook_redacts_span_query_credentials():
    event = {
        "spans": [
            {"data": {"http.query": "key=abc&page=2"}},
            {"data": None},
            {},
        ]
    }
    logging_config._sentry_before_send_transaction(event, {})
    assert event["spans"][0]["data"]["http.query"] == "key=[REDACTED]&page=2"


# ------------------------------------------------------------------
# Single-line text sinks
# ------------------------------------------------------------------

FORGED = "bob\nINFO     | app.api:login:1 - Admin login succeeded for chief"


@pytest.fixture
def text_sink():
    """A real Loguru handler using the stdout text format, written to a buffer."""
    buffer = io.StringIO()
    handler_id = logging_config.logger.add(
        buffer,
        format=logging_config._single_line_format(logging_config._STDOUT_TEXT_FORMAT),
        colorize=False,
        level="DEBUG",
    )
    yield buffer
    logging_config.logger.remove(handler_id)


def test_escape_renders_line_breaks_and_control_characters_visibly():
    escape = logging_config.escape_log_message
    assert escape("a\nb\rc") == "a\\nb\\rc"
    assert escape("\x1b[31mred") == "\\x1b[31mred"
    assert escape("x\x00y\x7fz") == "x\\x00y\\x7fz"
    assert escape("p\x85q r s") == "p\\x85q\\u2028r\\u2029s"
    assert escape("tab\tstays") == "tab\tstays"
    assert escape("plain text, née Ünïcode") == "plain text, née Ünïcode"


def test_a_newline_in_a_message_cannot_forge_a_second_record(text_sink):
    logging_config.logger.info("Search by {}", FORGED)

    lines = text_sink.getvalue().splitlines()
    assert len(lines) == 1
    assert "Search by bob\\nINFO     | app.api:login:1" in lines[0]


def test_braces_in_the_escaped_message_are_not_reparsed(text_sink):
    logging_config.logger.info("Search by {}", "a{x}b{0}")

    assert "Search by a{x}b{0}" in text_sink.getvalue()


def test_a_traceback_still_prints_on_its_own_lines(text_sink):
    try:
        raise ValueError("boom")
    except ValueError:
        logging_config.logger.exception("Lookup failed for {}", "a\nb")

    output = text_sink.getvalue()
    first_line, _, rest = output.partition("\n")
    assert "Lookup failed for a\\nb" in first_line
    assert rest.startswith("Traceback")
    assert "ValueError: boom" in rest


def test_escaping_leaves_extra_untouched_for_later_handlers(text_sink):
    """Sentry's handler forwards every key under ``extra`` as a log attribute,
    so the escaped copy must not be stored there."""
    seen = []
    handler_id = logging_config.logger.add(
        lambda message: seen.append(dict(message.record["extra"])), level="DEBUG"
    )
    try:
        logging_config.logger.info("hello {}", "a\nb")
    finally:
        logging_config.logger.remove(handler_id)

    assert seen == [{}]


def test_setup_logging_escapes_on_both_text_sinks(monkeypatch, tmp_path):
    """The stdout text sink and app.log both get the single-line format; the
    JSON sink keeps the raw message for json.dumps to escape."""
    added = []
    monkeypatch.setattr(logging_config.logger, "remove", lambda: None)
    monkeypatch.setattr(
        logging_config.logger,
        "add",
        lambda sink, **options: added.append((sink, options)),
    )
    monkeypatch.setattr(logging_config.os, "makedirs", lambda *args, **kwargs: None)
    monkeypatch.setattr(logging_config.os.path, "exists", lambda _path: False)
    monkeypatch.setattr(logging_config, "_intercept_stdlib_logging", lambda: None)

    logging_config.setup_logging(log_format="text", environment="production")
    monkeypatch.undo()

    assert [type(sink) for sink, _ in added][1] is str  # the app.log path
    for _sink, options in added:
        buffer = io.StringIO()
        # The file sink's rotation options do not apply to a buffer; the
        # format is what is under test.
        handler_id = logging_config.logger.add(
            buffer, format=options["format"], colorize=False, level="DEBUG"
        )
        try:
            logging_config.logger.info("Search by {}", FORGED)
        finally:
            logging_config.logger.remove(handler_id)
        assert len(buffer.getvalue().splitlines()) == 1


def test_the_json_sink_escapes_through_json_dumps(capsys):
    handler_id = logging_config.logger.add(logging_config._json_sink, level="DEBUG")
    try:
        logging_config.logger.info("Search by {}", FORGED)
    finally:
        logging_config.logger.remove(handler_id)

    lines = capsys.readouterr().out.splitlines()
    assert len(lines) == 1
    assert json.loads(lines[0])["message"] == "Search by " + FORGED
