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


class SalesforceService:
    """Client for the Salesforce REST API."""

    def __init__(self, credentials: dict[str, Any]):
        self.instance_url: str = credentials.get("instance_url", "")
        self.client_id: str = credentials.get("client_id", "")
        self.client_secret: str = credentials.get("client_secret", "")
        self.refresh_token: str = credentials.get("refresh_token", "")
        self.api_version: str = credentials.get("api_version", "v62.0")
        self._access_token: str = credentials.get("access_token", "")

    async def _ensure_access_token(self) -> str:
        """Obtain or refresh an access token via the OAuth 2.0 refresh-token grant."""
        if self._access_token:
            return self._access_token

        if not self.refresh_token:
            raise Exception(
                "No refresh token configured — complete the OAuth flow first"
            )

        async with create_integration_client() as client:
            response = await client.post(
                "https://login.salesforce.com/services/oauth2/token",
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
            return self._access_token

    def _api_url(self, path: str) -> str:
        """Build a full Salesforce REST API URL."""
        base = _API_PATH.format(version=self.api_version)
        return f"{self.instance_url}{base}{path}"

    async def test_connection(self) -> str:
        """Verify connectivity by querying the Salesforce org limits endpoint."""
        token = await self._ensure_access_token()
        url = self._api_url("/limits")
        async with create_integration_client() as client:
            response = await client.get(
                url,
                headers={"Authorization": f"Bearer {token}"},
            )
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
        """Execute a SOQL query and return the records."""
        token = await self._ensure_access_token()
        url = self._api_url("/query")
        async with create_integration_client() as client:
            response = await client.get(
                url,
                params={"q": soql},
                headers={"Authorization": f"Bearer {token}"},
            )
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
            return records

    async def create_record(
        self, sobject: str, fields: dict[str, Any]
    ) -> str:
        """Create a record in Salesforce. Returns the new record ID."""
        token = await self._ensure_access_token()
        url = self._api_url(f"/sobjects/{sobject}")
        async with create_integration_client() as client:
            response = await client.post(
                url,
                json=fields,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
            )
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
        token = await self._ensure_access_token()
        url = self._api_url(f"/sobjects/{sobject}/{record_id}")
        async with create_integration_client() as client:
            response = await client.patch(
                url,
                json=fields,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
            )
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
        token = await self._ensure_access_token()
        url = self._api_url(f"/sobjects/{sobject}/{record_id}")
        async with create_integration_client() as client:
            response = await client.get(
                url,
                headers={"Authorization": f"Bearer {token}"},
            )
            if response.status_code != 200:
                raise Exception(
                    f"Failed to fetch {sobject}/{record_id} "
                    f"(HTTP {response.status_code})"
                )
            result: dict[str, Any] = response.json()
            return result
