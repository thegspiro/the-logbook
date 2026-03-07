"""
API contract tests using Schemathesis.

Schemathesis auto-generates test cases from the FastAPI OpenAPI schema
to find responses that don't match declared schemas, unhandled edge
cases, and server errors.

Run with: pytest tests/test_api_contract.py -v --timeout=120
Or standalone: schemathesis run --app=main:app /openapi.json

These tests are marked 'slow' since they generate many requests.
"""

import pytest
import schemathesis

# Mark all tests in this module as slow + integration
pytestmark = [pytest.mark.slow, pytest.mark.integration]

# Load schema directly from the ASGI app — no running server needed.
# This may fail in environments where app dependencies (DB, Redis) aren't
# available. In that case, skip the whole module.
try:
    from main import app
    schema = schemathesis.openapi.from_asgi("/openapi.json", app=app)
    SCHEMA_AVAILABLE = True
except Exception:
    schema = None
    SCHEMA_AVAILABLE = False


@pytest.mark.skipif(not SCHEMA_AVAILABLE, reason="App dependencies not available")
class TestAPIContract:
    """
    Auto-generated API contract tests.

    Schemathesis generates random valid requests for each endpoint
    defined in the OpenAPI schema and checks that:
    - The response status code matches declared responses
    - The response body matches the declared schema
    - No 500 errors occur
    """

    # Only test public/unauthenticated endpoints to start.
    # Authenticated endpoints need token injection (add later).
    if SCHEMA_AVAILABLE and schema is not None:
        @schema.include(path_regex=r"^/api/public/").parametrize()
        def test_public_endpoints(self, case):
            """Public endpoints should return valid responses."""
            response = case.call_and_validate()
            # Ensure no server errors
            assert response.status_code < 500

        @schema.include(path_regex=r"^/api/v1/health").parametrize()
        def test_health_endpoints(self, case):
            """Health check endpoints should always respond."""
            response = case.call_and_validate()
            assert response.status_code < 500
