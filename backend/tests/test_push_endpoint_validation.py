"""
Unit tests for validate_push_endpoint (NOTIF2 SSRF guard).

A push endpoint is a client-supplied URL the server later POSTs to via
webpush, so the subscribe boundary must reject anything that could aim the
server at an internal host. Pure function — no DB, runs in the unit job.
"""

import pytest

from app.services.push_service import validate_push_endpoint


class TestValidatePushEndpoint:
    @pytest.mark.parametrize(
        "endpoint",
        [
            "https://fcm.googleapis.com/fcm/send/abc123",
            "https://updates.push.services.mozilla.com/wpush/v2/xyz",
            "https://web.push.apple.com/Q/abc",
            "https://push.example/token",
        ],
    )
    def test_legitimate_https_endpoints_pass(self, endpoint):
        validate_push_endpoint(endpoint)  # no raise

    @pytest.mark.parametrize(
        "endpoint",
        [
            "http://fcm.googleapis.com/fcm/send/abc",  # not https
            "https://127.0.0.1/push",  # loopback IP
            "https://169.254.169.254/latest/meta-data/",  # cloud metadata
            "https://10.0.0.5/internal",  # private IPv4
            "https://[::1]/push",  # loopback IPv6
            "https://192.168.1.10:8080/x",  # private IPv4 with port
            "https://localhost/push",  # localhost name
            "https://cache.internal/push",  # internal suffix
            "https://printer.local/push",  # mDNS/local suffix
            "https://203.0.113.7/push",  # bare public IP literal (never a real endpoint)
            "ftp://push.example/x",  # non-http scheme
            "not-a-url",  # no scheme/host
            "https://",  # no host
        ],
    )
    def test_internal_or_malformed_endpoints_rejected(self, endpoint):
        with pytest.raises(ValueError, match="Invalid push endpoint"):
            validate_push_endpoint(endpoint)
