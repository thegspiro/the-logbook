"""
Salesforce Integration Service

Connects to Salesforce REST API using OAuth 2.0 refresh-token or client
credentials flow.
Supports syncing contacts, events, training records, and incidents
between The Logbook and a department's Salesforce org.
"""

import asyncio
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any

import httpx
from loguru import logger

from app.services.integration_services.base import create_integration_client

# Salesforce REST API base path template
_API_PATH = "/services/data/{version}"

# Production vs sandbox token endpoints
_TOKEN_URLS = {
    "production": "https://login.salesforce.com/services/oauth2/token",
    "sandbox": "https://test.salesforce.com/services/oauth2/token",
}

# Salesforce reports an unknown column as INVALID_FIELD with a message like
# "No such column 'Foo__c' on sobject of type Contact".
_UNKNOWN_COLUMN_RE = re.compile(r"No such column '([^']+)'")

# Cap the drop-unknown-field retry loop so a genuinely broken payload cannot
# spin indefinitely (each retry removes at least one field, but guard anyway).
_MAX_FIELD_RETRIES = 6
_MAX_REQUEST_RETRIES = 3
_RETRYABLE_READ_STATUSES = frozenset({429, 500, 502, 503, 504})
_MAX_RETRY_DELAY_SECONDS = 120.0

_INSTANCE_URL_RE = re.compile(r"^https://[a-zA-Z0-9.-]+\.salesforce\.com$")


class SalesforceService:
    """Client for the Salesforce REST API."""

    def __init__(
        self,
        credentials: dict[str, Any],
        *,
        skip_unknown_fields: bool = True,
    ):
        self.instance_url: str = credentials.get("instance_url", "")
        self.client_id: str = credentials.get("client_id", "")
        self.client_secret: str = credentials.get("client_secret", "")
        self.refresh_token: str = credentials.get("refresh_token", "")
        self.api_version: str = credentials.get("api_version", "v62.0")
        self.environment: str = credentials.get("environment", "production")
        self._access_token: str = credentials.get("access_token", "")
        # When True, a write that references a custom field the target org has
        # not created yet (common while a department is still building out its
        # Salesforce org) drops the offending field and retries instead of
        # failing the whole record. Names of dropped fields accumulate here so
        # callers can surface them to the admin.
        self.skip_unknown_fields: bool = skip_unknown_fields
        self.skipped_fields: set[str] = set()

    @property
    def _token_url(self) -> str:
        # Salesforce's client-credentials flow is scoped to the Connected
        # App's org and uses that org's My Domain token endpoint. Interactive
        # refresh-token grants continue to use the appropriate login host.
        if not self.refresh_token:
            instance_url = self.instance_url.rstrip("/")
            if not _INSTANCE_URL_RE.fullmatch(instance_url):
                raise Exception(
                    "A valid Salesforce My Domain instance URL is required "
                    "for client credentials"
                )
            return f"{instance_url}/services/oauth2/token"
        return _TOKEN_URLS.get(self.environment, _TOKEN_URLS["production"])

    async def _refresh_access_token(self) -> str:
        """Obtain an access token using the configured server-side grant.

        A refresh token represents an interactive OAuth connection.  When it
        is absent, use Salesforce's client-credentials flow, whose Connected
        App must have a dedicated Run As user.  Client-credentials access
        tokens are deliberately reacquired rather than persisted.
        """
        if not self.client_id or not self.client_secret:
            raise Exception("Salesforce client credentials are not configured")

        if self.refresh_token:
            token_request = {
                "grant_type": "refresh_token",
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "refresh_token": self.refresh_token,
            }
        else:
            token_request = {
                "grant_type": "client_credentials",
                "client_id": self.client_id,
                "client_secret": self.client_secret,
            }

        async with create_integration_client() as client:
            response = None
            for attempt in range(_MAX_REQUEST_RETRIES + 1):
                try:
                    response = await client.post(self._token_url, data=token_request)
                except httpx.TransportError:
                    if attempt >= _MAX_REQUEST_RETRIES:
                        raise
                    await asyncio.sleep(min(2**attempt, _MAX_RETRY_DELAY_SECONDS))
                    continue
                if response.status_code not in _RETRYABLE_READ_STATUSES:
                    break
                if attempt < _MAX_REQUEST_RETRIES:
                    await asyncio.sleep(self._retry_delay(response, attempt))
            assert response is not None
            if response.status_code != 200:
                # OAuth error bodies can contain identifiers and must not be
                # copied into application logs.
                logger.error(
                    "Salesforce token request failed with HTTP {}",
                    response.status_code,
                )
                raise Exception(
                    "Failed to refresh Salesforce access token — "
                    "verify your Connected App credentials"
                )

            token_data = response.json()
            self._access_token = token_data.get("access_token", "")
            if not self._access_token:
                raise Exception("Salesforce token response missing access_token")

            # Salesforce returns the canonical instance_url in the token
            # response. Use it to handle org migrations transparently.
            returned_url = token_data.get("instance_url", "")
            if returned_url:
                canonical_url = returned_url.rstrip("/")
                if not _INSTANCE_URL_RE.fullmatch(canonical_url):
                    raise Exception("Salesforce returned an invalid instance URL")
                self.instance_url = canonical_url

            return self._access_token

    async def _ensure_access_token(self) -> str:
        """Return a cached access token or refresh one."""
        if self._access_token:
            return self._access_token
        return await self._refresh_access_token()

    def _api_url(self, path: str) -> str:
        """Build a full Salesforce REST API URL.

        self.instance_url is only validated against _INSTANCE_URL_RE on the
        token-refresh paths (_token_url, _refresh_access_token's handling of
        the returned instance_url). When an access token is already cached,
        _ensure_access_token() returns it without ever calling
        _refresh_access_token(), so this constructor-supplied,
        org-admin-editable value would otherwise reach every outbound
        request URL — with the org's live bearer token attached —
        completely unvalidated. Validate it here too, since this is the one
        call site every request goes through regardless of token state
        (CRON2-31-12, SSRF-adjacent).
        """
        instance_url = self.instance_url.rstrip("/")
        if not _INSTANCE_URL_RE.fullmatch(instance_url):
            raise Exception("Salesforce instance URL is invalid or not configured")
        base = _API_PATH.format(version=self.api_version)
        return f"{instance_url}{base}{path}"

    async def _request(
        self,
        method: str,
        url: str,
        *,
        json: dict[str, Any] | None = None,
        params: dict[str, str] | None = None,
    ) -> "httpx.Response":  # noqa: F821
        """Execute an API request with bounded authentication/transient retries.

        If Salesforce returns 401 (expired token), the access token is
        refreshed once and the request is retried — matching the standard
        behavior of Salesforce's own SDKs.
        """
        import httpx  # local import to satisfy type reference

        headers: dict[str, str] = {
            "Authorization": f"Bearer {await self._ensure_access_token()}",
        }
        if json is not None:
            headers["Content-Type"] = "application/json"

        async with create_integration_client() as client:
            request_kwargs: dict[str, Any] = {
                "method": method,
                "url": url,
                "headers": headers,
            }
            if json is not None:
                request_kwargs["json"] = json
            if params is not None:
                request_kwargs["params"] = params

            auth_retried = False
            transient_attempt = 0
            while True:
                response: httpx.Response = await client.request(**request_kwargs)

                if response.status_code == 401 and not auth_retried:
                    # Token expired — refresh and retry once.
                    auth_retried = True
                    self._access_token = ""
                    new_token = await self._refresh_access_token()
                    headers["Authorization"] = f"Bearer {new_token}"
                    request_kwargs["headers"] = headers
                    continue

                # Salesforce rejects rate-limited requests before applying
                # them, so 429 is safe to retry for reads and writes. For
                # ambiguous 5xx responses, only retry idempotent reads to
                # avoid accidentally creating duplicate records.
                retryable = self._is_rate_limited(response) or (
                    method.upper() == "GET"
                    and response.status_code in _RETRYABLE_READ_STATUSES
                )
                if not retryable or transient_attempt >= _MAX_REQUEST_RETRIES:
                    break

                delay = self._retry_delay(response, transient_attempt)
                transient_attempt += 1
                await asyncio.sleep(delay)

            return response

    @staticmethod
    def _is_rate_limited(response: "httpx.Response") -> bool:  # noqa: F821
        """Recognize both HTTP and Salesforce-specific rate-limit responses."""
        if response.status_code == 429:
            return True
        if response.status_code != 403:
            return False
        try:
            body = response.json()
        except Exception:
            return False
        errors = body if isinstance(body, list) else [body]
        return any(
            isinstance(error, dict)
            and error.get("errorCode") == "REQUEST_LIMIT_EXCEEDED"
            for error in errors
        )

    @staticmethod
    def _retry_delay(response: "httpx.Response", attempt: int) -> float:  # noqa: F821
        """Parse Retry-After seconds or HTTP-date, with a bounded fallback."""
        retry_after = response.headers.get("Retry-After", "")
        try:
            delay = float(retry_after)
        except (TypeError, ValueError):
            try:
                retry_at = parsedate_to_datetime(retry_after)
                if retry_at.tzinfo is None:
                    retry_at = retry_at.replace(tzinfo=timezone.utc)
                delay = (retry_at - datetime.now(timezone.utc)).total_seconds()
            except (TypeError, ValueError, OverflowError):
                delay = float(2**attempt)
        return min(max(delay, 0.0), _MAX_RETRY_DELAY_SECONDS)

    async def test_connection(self) -> str:
        """Verify connectivity by querying the Salesforce org limits endpoint."""
        url = self._api_url("/limits")
        response = await self._request("GET", url)
        if response.status_code == 200:
            return "Connected to Salesforce successfully"
        if response.status_code == 401:
            raise Exception(
                "Salesforce authentication failed — "
                "the access token may be expired or revoked"
            )
        raise Exception(f"Salesforce returned HTTP {response.status_code}")

    async def query(self, soql: str) -> list[dict[str, Any]]:
        """Execute a SOQL query and return all records (handles pagination)."""
        url = self._api_url("/query")
        response = await self._request("GET", url, params={"q": soql})
        if response.status_code != 200:
            logger.warning("Salesforce query failed ({})", response.status_code)
            raise Exception(f"Salesforce query failed (HTTP {response.status_code})")

        data = response.json()
        records: list[dict[str, Any]] = data.get("records", [])

        # Salesforce paginates large result sets (default 2 000 per page).
        # Follow nextRecordsUrl until all pages are consumed.
        while not data.get("done", True) and data.get("nextRecordsUrl"):
            next_url = f"{self.instance_url}{data['nextRecordsUrl']}"
            response = await self._request("GET", next_url)
            if response.status_code != 200:
                logger.warning(
                    "Salesforce query pagination failed ({})",
                    response.status_code,
                )
                raise Exception(
                    "Salesforce query pagination failed "
                    f"(HTTP {response.status_code}); refusing partial results"
                )
            data = response.json()
            records.extend(data.get("records", []))

        return records

    def _extract_unknown_fields(
        self, response: "httpx.Response", payload: dict[str, Any]  # noqa: F821
    ) -> list[str]:
        """Return field names Salesforce rejected as non-existent columns.

        Only fields actually present in *payload* are returned, so a retry
        always makes progress and never loops on an unrelated error.
        """
        try:
            errors = response.json()
        except Exception:
            return []
        if not isinstance(errors, list):
            return []

        dropped: list[str] = []
        for err in errors:
            if not isinstance(err, dict):
                continue
            if err.get("errorCode") != "INVALID_FIELD":
                continue
            match = _UNKNOWN_COLUMN_RE.search(err.get("message", ""))
            if match and match.group(1) in payload and match.group(1) not in dropped:
                dropped.append(match.group(1))
            # Salesforce sometimes lists the offending field(s) separately.
            for field in err.get("fields", []) or []:
                if field in payload and field not in dropped:
                    dropped.append(field)
        return dropped

    async def create_record(self, sobject: str, fields: dict[str, Any]) -> str:
        """Create a record in Salesforce. Returns the new record ID.

        If the org is missing custom fields referenced in *fields* and
        ``skip_unknown_fields`` is enabled, those fields are dropped and the
        create is retried so a half-configured org still receives the record.
        """
        payload = dict(fields)
        for _ in range(_MAX_FIELD_RETRIES):
            url = self._api_url(f"/sobjects/{sobject}")
            response = await self._request("POST", url, json=payload)
            if response.status_code in (200, 201):
                result = response.json()
                record_id: str = result.get("id", "")
                return record_id

            if self.skip_unknown_fields and response.status_code == 400:
                unknown = self._extract_unknown_fields(response, payload)
                if unknown:
                    for field in unknown:
                        payload.pop(field, None)
                        self.skipped_fields.add(field)
                    if payload:
                        continue

            logger.warning(
                "Salesforce create {} failed ({})", sobject, response.status_code
            )
            raise Exception(f"Failed to create {sobject} in Salesforce")

        raise Exception(f"Failed to create {sobject}: too many unknown-field retries")

    async def update_record(
        self, sobject: str, record_id: str, fields: dict[str, Any]
    ) -> bool:
        """Update an existing Salesforce record by ID.

        Unknown custom fields are dropped and retried when
        ``skip_unknown_fields`` is enabled (see ``create_record``).
        """
        payload = dict(fields)
        for _ in range(_MAX_FIELD_RETRIES):
            url = self._api_url(f"/sobjects/{sobject}/{record_id}")
            response = await self._request("PATCH", url, json=payload)
            if response.status_code == 204:
                return True

            if self.skip_unknown_fields and response.status_code == 400:
                unknown = self._extract_unknown_fields(response, payload)
                if unknown:
                    for field in unknown:
                        payload.pop(field, None)
                        self.skipped_fields.add(field)
                    if payload:
                        continue

            logger.warning(
                "Salesforce update {}/{} failed ({})",
                sobject,
                record_id,
                response.status_code,
            )
            return False

        return False

    async def describe_sobject(self, sobject: str) -> dict[str, Any]:
        """Return field metadata for an sObject via the describe endpoint.

        Used by the readiness check to determine which custom fields the
        target org has actually created.
        """
        url = self._api_url(f"/sobjects/{sobject}/describe")
        response = await self._request("GET", url)
        if response.status_code != 200:
            raise Exception(
                f"Failed to describe {sobject} (HTTP {response.status_code})"
            )
        result: dict[str, Any] = response.json()
        return result

    async def get_field_names(self, sobject: str) -> set[str]:
        """Return the set of field API names defined on an sObject."""
        described = await self.describe_sobject(sobject)
        fields = described.get("fields", [])
        return {
            f.get("name", "") for f in fields if isinstance(f, dict) and f.get("name")
        }

    async def get_record(self, sobject: str, record_id: str) -> dict[str, Any]:
        """Fetch a single Salesforce record by ID."""
        url = self._api_url(f"/sobjects/{sobject}/{record_id}")
        response = await self._request("GET", url)
        if response.status_code != 200:
            raise Exception(
                f"Failed to fetch {sobject}/{record_id} "
                f"(HTTP {response.status_code})"
            )
        result: dict[str, Any] = response.json()
        return result
