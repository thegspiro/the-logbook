"""
The published OpenAPI schema must describe what the app actually returns.

These are cheap structural assertions that run in the ordinary unit suite, so
a regression is caught without waiting for the (opt-in, server-backed)
schemathesis run. They pin the corrections that suite found on 2026-08-01.
"""

import pytest

pytestmark = [pytest.mark.unit]


@pytest.fixture(scope="module")
def schema() -> dict:
    from main import app

    return app.openapi()


class TestValidationErrorSchema:
    """FastAPI's stock 422 model vs. the one the app's handler emits."""

    def test_validation_error_describes_field_and_message(self, schema):
        # main.py's RequestValidationError handler returns
        # {"detail": [{"field", "message"}]}, but FastAPI advertised its own
        # loc/msg/type model — so the single most common error response in the
        # API was documented as a shape no endpoint has ever returned.
        model = schema["components"]["schemas"]["ValidationError"]

        assert set(model["required"]) == {"field", "message"}
        assert set(model["properties"]) == {"field", "message"}

    def test_validation_error_no_longer_claims_loc_msg_type(self, schema):
        model = schema["components"]["schemas"]["ValidationError"]

        for stale in ("loc", "msg", "type"):
            assert stale not in model["properties"]

    def test_http_validation_error_wraps_a_list_of_them(self, schema):
        model = schema["components"]["schemas"]["HTTPValidationError"]
        detail = model["properties"]["detail"]

        assert detail["type"] == "array"
        assert detail["items"]["$ref"].endswith("/ValidationError")


class TestPublicRouteErrorResponses:
    """Public routes declared only 200/422 while returning 401/404/400/429."""

    def _responses(self, schema, path: str, method: str = "get") -> set[str]:
        return set(schema["paths"][path][method]["responses"])

    @pytest.mark.parametrize(
        ("path", "method", "expected"),
        [
            ("/api/public/v1/organization/info", "get", {"401", "404", "429"}),
            ("/api/public/v1/forms/{slug}", "get", {"404", "429"}),
            ("/api/public/v1/calendar/{token}.ics", "get", {"404", "429"}),
            ("/api/public/v1/finance/approvals/{token}", "get", {"404", "429"}),
            ("/api/public/v1/webhooks/calcom/{integration_id}", "post", {"404", "429"}),
        ],
    )
    def test_declares_the_codes_it_can_return(self, schema, path, method, expected):
        declared = self._responses(schema, path, method)

        assert expected <= declared, f"{path} missing {expected - declared}"


class TestTokenPathConstraints:
    """Token path params were typed as unconstrained strings."""

    def _param(self, schema, path: str, method: str, name: str) -> dict:
        params = schema["paths"][path][method]["parameters"]
        return next(p for p in params if p["name"] == name)

    def test_application_status_token_declares_its_length_bounds(self, schema):
        # The handler rejects anything outside 10..64 with a 400, so a client
        # generated from the schema had no way to know what a usable token
        # looks like.
        param = self._param(
            schema, "/api/public/v1/application-status/{token}", "get", "token"
        )

        assert param["schema"]["minLength"] == 10
        assert param["schema"]["maxLength"] == 64

    def test_approval_token_declares_its_length_bounds(self, schema):
        param = self._param(
            schema, "/api/public/v1/finance/approvals/{token}", "get", "token"
        )

        assert param["schema"]["minLength"] == 20
        assert param["schema"]["maxLength"] == 255
