"""
Tests for breached-password detection (app/core/breached_password.py).

The properties that matter are the privacy one (only a 5-character hash prefix
ever leaves the process) and the availability one (a provider outage must not
block password changes).
"""

import hashlib

import httpx
import pytest

from app.core.breached_password import (
    _hash_prefix_and_suffix,
    _parse_range_response,
    check_password_not_breached,
    get_breach_count,
)

# "Firetruck2024!" — satisfies every complexity rule the platform enforces.
SAMPLE_PASSWORD = "Firetruck2024!"


def _digest(password: str) -> tuple[str, str]:
    full = hashlib.sha1(password.encode("utf-8")).hexdigest().upper()
    return full[:5], full[5:]


@pytest.fixture(autouse=True)
def _enabled(monkeypatch):
    monkeypatch.setattr(
        "app.core.breached_password.settings.BREACHED_PASSWORD_CHECK_ENABLED", True
    )
    monkeypatch.setattr(
        "app.core.breached_password.settings.BREACHED_PASSWORD_MIN_COUNT", 1
    )
    monkeypatch.setattr(
        "app.core.breached_password.settings.BREACHED_PASSWORD_API_URL",
        "https://api.pwnedpasswords.com/range",
    )


def _mock_transport(monkeypatch, handler):
    """Route the module's AsyncClient through a MockTransport."""
    real_client = httpx.AsyncClient

    def _factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real_client(*args, **kwargs)

    monkeypatch.setattr("app.core.breached_password.httpx.AsyncClient", _factory)


@pytest.mark.unit
def test_only_five_hash_characters_are_split_off():
    prefix, suffix = _hash_prefix_and_suffix(SAMPLE_PASSWORD)
    expected_prefix, expected_suffix = _digest(SAMPLE_PASSWORD)

    assert prefix == expected_prefix
    assert len(prefix) == 5
    assert suffix == expected_suffix
    # The two halves are the whole hash and nothing more.
    assert len(prefix) + len(suffix) == 40


@pytest.mark.unit
async def test_request_sends_only_the_prefix(monkeypatch):
    """Neither the password nor its full hash may appear in the request."""
    prefix, suffix = _digest(SAMPLE_PASSWORD)
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        return httpx.Response(200, text=f"{suffix}:42\n")

    _mock_transport(monkeypatch, handler)
    count = await get_breach_count(SAMPLE_PASSWORD)

    assert count == 42
    assert seen["url"].endswith(f"/{prefix}")
    assert SAMPLE_PASSWORD not in seen["url"]
    assert suffix not in seen["url"]


@pytest.mark.unit
async def test_breached_password_is_rejected(monkeypatch):
    _, suffix = _digest(SAMPLE_PASSWORD)

    def handler(_request):
        return httpx.Response(200, text=f"AAAAAAAA:9\n{suffix}:1337\n")

    _mock_transport(monkeypatch, handler)
    is_valid, error = await check_password_not_breached(SAMPLE_PASSWORD)

    assert is_valid is False
    assert "data breach" in error
    # The count is an oracle over the corpus — it must not be echoed back.
    assert "1337" not in error


@pytest.mark.unit
async def test_absent_suffix_is_accepted(monkeypatch):
    def handler(_request):
        return httpx.Response(200, text="AAAAAAAA:9\nBBBBBBBB:3\n")

    _mock_transport(monkeypatch, handler)
    is_valid, error = await check_password_not_breached(SAMPLE_PASSWORD)

    assert is_valid is True
    assert error is None


@pytest.mark.unit
@pytest.mark.parametrize(
    "failure",
    [
        httpx.ConnectTimeout("timed out"),
        httpx.ConnectError("dns failure"),
    ],
)
async def test_provider_outage_fails_open(monkeypatch, failure):
    """A third-party outage must never block a password change."""

    def handler(_request):
        raise failure

    _mock_transport(monkeypatch, handler)
    is_valid, error = await check_password_not_breached(SAMPLE_PASSWORD)

    assert is_valid is True
    assert error is None


@pytest.mark.unit
async def test_http_error_fails_open(monkeypatch):
    def handler(_request):
        return httpx.Response(503, text="service unavailable")

    _mock_transport(monkeypatch, handler)
    is_valid, _ = await check_password_not_breached(SAMPLE_PASSWORD)

    assert is_valid is True


@pytest.mark.unit
async def test_garbage_response_fails_open(monkeypatch):
    def handler(_request):
        return httpx.Response(200, text="<html>not a range response</html>")

    _mock_transport(monkeypatch, handler)
    is_valid, _ = await check_password_not_breached(SAMPLE_PASSWORD)

    assert is_valid is True


@pytest.mark.unit
async def test_disabled_makes_no_request(monkeypatch):
    monkeypatch.setattr(
        "app.core.breached_password.settings.BREACHED_PASSWORD_CHECK_ENABLED", False
    )
    called = False

    def handler(_request):
        nonlocal called
        called = True
        return httpx.Response(200, text="")

    _mock_transport(monkeypatch, handler)
    is_valid, _ = await check_password_not_breached(SAMPLE_PASSWORD)

    assert is_valid is True
    assert called is False


@pytest.mark.unit
async def test_min_count_threshold_tolerates_rare_appearances(monkeypatch):
    monkeypatch.setattr(
        "app.core.breached_password.settings.BREACHED_PASSWORD_MIN_COUNT", 10
    )
    _, suffix = _digest(SAMPLE_PASSWORD)

    def handler(_request):
        return httpx.Response(200, text=f"{suffix}:3\n")

    _mock_transport(monkeypatch, handler)
    is_valid, _ = await check_password_not_breached(SAMPLE_PASSWORD)

    assert is_valid is True


@pytest.mark.unit
def test_malformed_line_does_not_mask_a_later_hit():
    """One bad line must not turn a real match further down into a pass."""
    body = "not-a-valid-line\nAAAA:notanumber\nDEADBEEF:77\n"

    assert _parse_range_response(body, "DEADBEEF") == 77


@pytest.mark.unit
def test_suffix_match_is_case_insensitive():
    assert _parse_range_response("deadbeef:5\n", "DEADBEEF") == 5
