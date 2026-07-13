"""
Documenso Integration Service

Connects to a Documenso instance (cloud at app.documenso.com or a
self-hosted deployment) via the Documenso REST API v1 to send documents
out for electronic signature — an open-source DocuSign alternative.

Documenso authenticates API requests with a personal/team API token passed
directly in the ``Authorization`` header (no ``Bearer`` prefix). Tokens are
created under Settings → API in the Documenso dashboard.
"""

from typing import Any

from loguru import logger

from app.services.integration_services.base import create_integration_client

# Default Documenso Cloud API base. Self-hosted orgs override this with their
# own https://<host>/api/v1 in the integration config.
DEFAULT_API_BASE_URL = "https://app.documenso.com/api/v1"

# Documenso recipient roles the API accepts. SIGNER is the common case.
VALID_RECIPIENT_ROLES = frozenset({"SIGNER", "APPROVER", "CC", "VIEWER"})

# Documenso webhook event names that mean every recipient has finished signing.
COMPLETION_EVENTS = frozenset({"DOCUMENT_COMPLETED"})


def parse_webhook_event(payload: dict[str, Any]) -> dict[str, Any]:
    """Extract the fields we care about from a Documenso webhook body.

    Documenso posts ``{"event": "...", "payload": {...}}``. We surface the
    event name, whether it represents completion, the document's externalId
    (the Logbook identifier we set at send time), and the recipient emails so
    a completed signature can be correlated back to a prospect.
    """
    event = str(payload.get("event") or payload.get("type") or "")
    data = payload.get("payload") or payload.get("data") or {}
    if not isinstance(data, dict):
        data = {}
    recipients = data.get("recipients") or []
    emails = [
        r.get("email", "") for r in recipients if isinstance(r, dict) and r.get("email")
    ]
    return {
        "event": event,
        "completed": event.upper() in COMPLETION_EVENTS,
        "external_id": str(data.get("externalId") or ""),
        "title": str(data.get("title") or ""),
        "recipient_emails": emails,
    }


def _normalize_base_url(api_base_url: str) -> str:
    """Strip a trailing slash so path joins never double up."""
    return (api_base_url or DEFAULT_API_BASE_URL).rstrip("/")


def build_create_document_payload(
    title: str,
    recipients: list[dict[str, Any]],
    *,
    external_id: str | None = None,
) -> dict[str, Any]:
    """
    Build the JSON body for ``POST /documents``.

    Documenso creates the document record first and returns an ``uploadUrl``
    the caller then PUTs the PDF bytes to. This helper only assembles the
    metadata/recipient portion of that first request.

    Args:
        title: Human-readable document title shown to signers.
        recipients: List of {name, email, role?} dicts. ``role`` defaults to
            SIGNER and is upper-cased; unknown roles fall back to SIGNER.
        external_id: Optional Logbook-side identifier echoed back on webhooks,
            letting us correlate a completed signature with its source record.

    Returns:
        A JSON-serializable payload dict.
    """
    normalized_recipients: list[dict[str, Any]] = []
    for index, recipient in enumerate(recipients, start=1):
        role = str(recipient.get("role", "SIGNER")).upper()
        if role not in VALID_RECIPIENT_ROLES:
            role = "SIGNER"
        normalized_recipients.append(
            {
                "name": recipient.get("name", ""),
                "email": recipient.get("email", ""),
                "role": role,
                # Sequential signing order matches the order recipients arrive.
                "signingOrder": index,
            }
        )

    payload: dict[str, Any] = {
        "title": title,
        "recipients": normalized_recipients,
    }
    if external_id:
        payload["externalId"] = external_id
    return payload


class DocumensoService:
    """Client for the Documenso REST API v1."""

    def __init__(self, credentials: dict[str, Any]):
        self.api_base_url: str = _normalize_base_url(
            credentials.get("api_base_url", "")
        )
        self.api_token: str = credentials.get("api_token", "")

    @property
    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": self.api_token,
            "Content-Type": "application/json",
        }

    async def test_connection(self) -> str:
        """Verify the API token by listing one document."""
        if not self.api_token:
            raise Exception("No Documenso API token configured")

        async with create_integration_client() as client:
            response = await client.get(
                f"{self.api_base_url}/documents",
                headers=self._headers,
                params={"page": 1, "perPage": 1},
            )
            if response.status_code == 200:
                return "Connected to Documenso successfully"
            if response.status_code in (401, 403):
                raise Exception(
                    "Documenso rejected the API token — verify it is correct "
                    "and has not been revoked"
                )
            logger.warning(
                "Documenso test returned {}: {}",
                response.status_code,
                response.text[:200],
            )
            raise Exception(
                f"Documenso returned an unexpected status ({response.status_code})"
            )

    async def create_document(
        self,
        title: str,
        recipients: list[dict[str, Any]],
        *,
        external_id: str | None = None,
    ) -> dict[str, Any]:
        """
        Create a document record and its recipients.

        Returns the Documenso response, which includes ``documentId`` and an
        ``uploadUrl`` the caller PUTs the PDF bytes to before the document can
        be sent for signature.
        """
        payload = build_create_document_payload(
            title, recipients, external_id=external_id
        )
        async with create_integration_client() as client:
            response = await client.post(
                f"{self.api_base_url}/documents",
                headers=self._headers,
                json=payload,
            )
            if 200 <= response.status_code < 300:
                return response.json()
            logger.error(
                "Documenso create document failed {}: {}",
                response.status_code,
                response.text[:300],
            )
            raise Exception(f"Documenso rejected the document ({response.status_code})")
