"""
Salesforce Integration Service

Connects to Salesforce REST API using OAuth 2.0 refresh-token flow.
Supports syncing contacts, events, training records, and incidents
between The Logbook and a department's Salesforce org.
"""

import logging
from typing import Any

from app.services.integration_services.base import create_integration_client

logger = logging.getLogger(__name__)

# Salesforce REST API base path template
_API_PATH = "/services/data/{version}"

# Production vs sandbox token endpoints
_TOKEN_URLS = {
    "production": "https://login.salesforce.com/services/oauth2/token",
    "sandbox": "https://test.salesforce.com/services/oauth2/token",
}


class SalesforceService:
    """Client for the Salesforce REST API."""

    def __init__(self, credentials: dict[str, Any]):
        self.instance_url: str = credentials.get("instance_url", "")
        self.client_id: str = credentials.get("client_id", "")
        self.client_secret: str = credentials.get("client_secret", "")
        self.refresh_token: str = credentials.get("refresh_token", "")
        self.api_version: str = credentials.get("api_version", "v62.0")
        self.environment: str = credentials.get("environment", "production")
        self._access_token: str = credentials.get("access_token", "")

    @property
    def _token_url(self) -> str:
        return _TOKEN_URLS.get(self.environment, _TOKEN_URLS["production"])

    async def _refresh_access_token(self) -> str:
        """Obtain a fresh access token via the OAuth 2.0 refresh-token grant."""
        if not self.refresh_token:
            raise Exception(
                "No refresh token configured — complete the OAuth flow first"
            )

        async with create_integration_client() as client:
            response = await client.post(
                self._token_url,
                data={
                    "grant_type": "refresh_token",
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "refresh_token": self.refresh_token,
                },
            )
            if response.status_code != 200:
                body = response.text[:300]
                logger.error("Salesforce token refresh failed: %s", body)
                raise Exception(
                    "Failed to refresh Salesforce access token — "
                    "verify your Connected App credentials"
                )

            token_data = response.json()
            self._access_token = token_data.get("access_token", "")
            if not self._access_token:
                raise Exception(
                    "Salesforce token response missing access_token"
                )

            # Salesforce returns the canonical instance_url in the token
            # response. Use it to handle org migrations transparently.
            returned_url = token_data.get("instance_url", "")
            if returned_url:
                self.instance_url = returned_url

            return self._access_token

    async def _ensure_access_token(self) -> str:
        """Return a cached access token or refresh one."""
        if self._access_token:
            return self._access_token
        return await self._refresh_access_token()

    def _api_url(self, path: str) -> str:
        """Build a full Salesforce REST API URL."""
        base = _API_PATH.format(version=self.api_version)
        return f"{self.instance_url}{base}{path}"

    async def _request(
        self,
        method: str,
        url: str,
        *,
        json: dict[str, Any] | None = None,
        params: dict[str, str] | None = None,
    ) -> "httpx.Response":  # noqa: F821
        """Execute an API request with automatic 401 retry.

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

            response: httpx.Response = await client.request(**request_kwargs)

            if response.status_code == 401:
                # Token expired — refresh and retry once
                self._access_token = ""
                new_token = await self._refresh_access_token()
                headers["Authorization"] = f"Bearer {new_token}"
                request_kwargs["headers"] = headers
                response = await client.request(**request_kwargs)

            return response

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
        raise Exception(
            f"Salesforce returned HTTP {response.status_code}"
        )

    async def query(self, soql: str) -> list[dict[str, Any]]:
        """Execute a SOQL query and return all records (handles pagination)."""
        url = self._api_url("/query")
        response = await self._request("GET", url, params={"q": soql})
        if response.status_code != 200:
            logger.warning(
                "Salesforce query failed (%d): %s",
                response.status_code,
                response.text[:200],
            )
            raise Exception(
                f"Salesforce query failed (HTTP {response.status_code})"
            )

        data = response.json()
        records: list[dict[str, Any]] = data.get("records", [])

        # Salesforce paginates large result sets (default 2 000 per page).
        # Follow nextRecordsUrl until all pages are consumed.
        while not data.get("done", True) and data.get("nextRecordsUrl"):
            next_url = f"{self.instance_url}{data['nextRecordsUrl']}"
            response = await self._request("GET", next_url)
            if response.status_code != 200:
                logger.warning(
                    "Salesforce query pagination failed (%d)",
                    response.status_code,
                )
                break
            data = response.json()
            records.extend(data.get("records", []))

        return records

    async def create_record(
        self, sobject: str, fields: dict[str, Any]
    ) -> str:
        """Create a record in Salesforce. Returns the new record ID."""
        url = self._api_url(f"/sobjects/{sobject}")
        response = await self._request("POST", url, json=fields)
        if response.status_code not in (200, 201):
            logger.warning(
                "Salesforce create %s failed (%d): %s",
                sobject,
                response.status_code,
                response.text[:200],
            )
            raise Exception(
                f"Failed to create {sobject} in Salesforce"
            )
        result = response.json()
        record_id: str = result.get("id", "")
        return record_id

    async def update_record(
        self, sobject: str, record_id: str, fields: dict[str, Any]
    ) -> bool:
        """Update an existing Salesforce record by ID."""
        url = self._api_url(f"/sobjects/{sobject}/{record_id}")
        response = await self._request("PATCH", url, json=fields)
        if response.status_code == 204:
            return True
        logger.warning(
            "Salesforce update %s/%s failed (%d): %s",
            sobject,
            record_id,
            response.status_code,
            response.text[:200],
        )
        return False

    async def get_record(
        self, sobject: str, record_id: str
    ) -> dict[str, Any]:
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
