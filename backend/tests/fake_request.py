"""A minimal Starlette request for tests that call an endpoint function directly.

Endpoints that write an audit row read the caller's address and browser from
the request; a test that bypasses the HTTP layer hands them this instead.
"""

from starlette.requests import Request

FAKE_IP = "203.0.113.7"
FAKE_USER_AGENT = "pytest-fake-request/1.0"


def fake_request(ip: str = FAKE_IP, user_agent: str = FAKE_USER_AGENT) -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/",
            "headers": [(b"user-agent", user_agent.encode())],
            "client": (ip, 1234),
            "query_string": b"",
        }
    )
