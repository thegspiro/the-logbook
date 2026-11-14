"""
Intuit QuickBooks Online: the OAuth 2.0 and Accounting API calls Finance makes

Every URL, header, parameter and field below was checked against Intuit's own
documentation on 2026-11-06, not recalled (CLAUDE.md pitfall #34):

- OAuth endpoints: the discovery documents,
  https://developer.api.intuit.com/.well-known/openid_configuration and
  .../openid_sandbox_configuration. Both name the same authorization, token
  and revocation endpoints, so sandbox and production differ only in the
  API base URL.
- The authorization request, code exchange, refresh, revoke and token
  lifetimes: "Set up OAuth 2.0",
  https://developer.intuit.com/quickbooks-online/docs/develop/authentication-and-authorization/oauth-2.0
- Base URLs: "Create basic requests",
  https://developer.intuit.com/quickbooks-online/docs/get-started/create-a-request
- URI formats and headers: "Basic schema and data formats",
  https://developer.intuit.com/quickbooks-online/docs/learn/rest-api-features
- ``minorversion``: https://developer.intuit.com/quickbooks-online/docs/learn/explore-the-quickbooks-online-api/minor-versions
- ``requestid``: "Basic ID and field definitions",
  https://developer.intuit.com/quickbooks-online/docs/learn/learn-basic-field-definitions
- Queries and paging: https://developer.intuit.com/quickbooks-online/docs/learn/explore-the-quickbooks-online-api/data-queries
- Throttling: https://developer.intuit.com/quickbooks-online/docs/learn/limits-and-throttles
- Fault format and codes: https://developer.intuit.com/quickbooks-online/docs/develop/troubleshooting/handling-common-errors
  and .../troubleshooting/error-codes

The Purchase's payment type, checked on 2026-11-08. Intuit's API reference
page for Purchase renders in the browser only and could not be read from
here, so each value below is taken from what Intuit publishes beside it, and
nothing was built on a value those sources do not give:

- ``PaymentType`` is ``Cash``, ``Check`` or ``CreditCard``, and the account
  each is paid from: Intuit's v3 schema, as generated into its PHP SDK,
  https://github.com/intuit/QuickBooks-V3-PHP-SDK/blob/master/src/Data/IPPPurchase.php
  ("Expense Type can be Cash, Check or CreditCard"; AccountRef: "Check should
  have bank account, CreditCard should specify credit card account"), and
  its Java SDK's PaymentTypeEnum,
  https://github.com/intuit/QuickBooks-V3-Java-SDK/blob/develop/ipp-v3-java-data/src/main/java/com/intuit/ipp/data/PaymentTypeEnum.java
- The account types as QuickBooks names them, ``Bank`` and ``Credit Card``
  (with the space): the Java SDK's AccountTypeEnum,
  .../ipp-v3-java-data/src/main/java/com/intuit/ipp/data/AccountTypeEnum.java
- A check's number is its ``DocNumber``: Intuit's "Data services extensions
  and parameters" page, https://developer.intuit.com/quickbooks-online/docs/develop/sdks-and-samples-collections/java/data-services-extensions-and-parameters
  (``allowduplicatedocnum`` is "supported by the Purchase resource, to allow
  duplicate check numbers"), and the .NET SDK's own test that creates a Check
  Purchase with a DocNumber and needs that parameter to create a second,
  https://github.com/intuit/QuickBooks-V3-DotNET-SDK/blob/master/IPPDotNetDevKitCSV3/Test/Intuit.Ipp.Test/SDKV3Test/Services/QBO/Purchase.cs
  (CheckPurchaseAddDuplicateDocNumberGlobalTestUsingoAuth). The parameter is
  not sent: a duplicate check number is more likely a check the Treasurer
  already entered by hand than one to record twice.
- ``DocNumber`` is at most 21 characters in QuickBooks Online, and on a
  purchase is left empty when not given; ``TxnDate`` and ``PrivateNote``
  ("organization-private note") are on every transaction, which Purchase
  extends: the schema's Transaction type,
  https://github.com/intuit/QuickBooks-V3-PHP-SDK/blob/master/src/Data/IPPTransaction.php
  and .../ipp-v3-java-data/src/main/java/com/intuit/ipp/data/Purchase.java
  ("Purchase extends Transaction").
- ``PrintStatus`` is ``NotSet``, ``NeedToPrint`` or ``PrintComplete`` (the
  Java SDK's PrintStatusEnum); the .NET SDK's helper that builds the test
  purchases sets ``NotSet`` on every purchase but a card one, and ``Credit``
  false on a card one ("If Credit is Null or False, it is considered as
  Charge"), https://github.com/intuit/QuickBooks-V3-DotNET-SDK/blob/master/IPPDotNetDevKitCSV3/Test/Intuit.Ipp.Test/SDKV3Test/Common/QBOHelper.cs
  (CreatePurchase). A check posted here was already written, so it is
  ``NotSet``: ``NeedToPrint`` would put it in QuickBooks' print queue.

The Accounting scope grants read and write to the whole company, and there is
no narrower one. This module is therefore the whole of what the app does with
it: read the chart of accounts and the vendor list, create a vendor, create a
Purchase (a cash expense, a check, or a credit card expense). Nothing here
updates or deletes anything in QuickBooks.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Optional
from urllib.parse import urlencode

import httpx

from app.core.config import settings

AUTHORIZATION_ENDPOINT = "https://appcenter.intuit.com/connect/oauth2"
TOKEN_ENDPOINT = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"
REVOCATION_ENDPOINT = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke"
ACCOUNTING_SCOPE = "com.intuit.quickbooks.accounting"

API_BASE_URLS = {
    "sandbox": "https://sandbox-quickbooks.api.intuit.com",
    "production": "https://quickbooks.api.intuit.com",
}

# Minor versions below 75 were retired on 2025-08-01 and are answered as 75;
# naming it keeps the schema fixed if Intuit moves the default on.
MINOR_VERSION = "75"

# The most a query returns in one page (default 100).
QUERY_PAGE_SIZE = 1000

# The entities ``query`` may read, each with its fixed statement.
_QUERY_STATEMENTS: dict[str, str] = {
    "Account": "SELECT * FROM Account",
    "Vendor": "SELECT * FROM Vendor",
}

# Intuit times out a request after 120 seconds; waiting longer is pointless.
REQUEST_TIMEOUT_SECONDS = 120.0

# A requestid may be at most 50 characters outside batch operations.
REQUEST_ID_MAX = 50

# On HTTP 429 Intuit asks for a 60-second wait before retrying.
RATE_LIMIT_WAIT = timedelta(seconds=60)


PAYMENT_TYPE_CASH = "Cash"
PAYMENT_TYPE_CHECK = "Check"
PAYMENT_TYPE_CREDIT_CARD = "CreditCard"

ACCOUNT_TYPE_BANK = "Bank"
ACCOUNT_TYPE_CREDIT_CARD = "Credit Card"

# The account type each payment type is paid from.
PAID_FROM_ACCOUNT_TYPE = {
    PAYMENT_TYPE_CASH: ACCOUNT_TYPE_BANK,
    PAYMENT_TYPE_CHECK: ACCOUNT_TYPE_BANK,
    PAYMENT_TYPE_CREDIT_CARD: ACCOUNT_TYPE_CREDIT_CARD,
}

DOC_NUMBER_MAX = 21
PRINT_STATUS_NOT_SET = "NotSet"


class QuickBooksError(Exception):
    """A call to Intuit did not succeed. ``str()`` is safe to show."""


class QuickBooksNotConfigured(QuickBooksError):
    """QBO_CLIENT_ID, QBO_CLIENT_SECRET or QBO_REDIRECT_URI is blank."""


class QuickBooksAuthError(QuickBooksError):
    """The tokens no longer work: 401, the scope was refused, or the refresh
    token was rejected (``invalid_grant``). Someone has to reconnect."""


class QuickBooksRateLimited(QuickBooksError):
    """HTTP 429: wait ``RATE_LIMIT_WAIT`` before sending anything else."""


class QuickBooksTransient(QuickBooksError):
    """A network failure, timeout or 5xx. Whether the request took effect is
    unknown, so a create is resent with the same ``requestid``."""


class QuickBooksRejected(QuickBooksError):
    """Intuit refused the request (a 4xx with a Fault). Nothing was created."""

    def __init__(self, message: str, code: Optional[str] = None):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class Credentials:
    client_id: str
    client_secret: str
    redirect_uri: str
    environment: str


@dataclass(frozen=True)
class TokenSet:
    access_token: str
    refresh_token: str
    access_expires_at: Optional[datetime]
    refresh_expires_at: Optional[datetime]


def configured_credentials() -> Optional[Credentials]:
    """The Intuit app this installation connects through, or None if unset."""
    client_id = (settings.QBO_CLIENT_ID or "").strip()
    client_secret = (settings.QBO_CLIENT_SECRET or "").strip()
    redirect_uri = (settings.QBO_REDIRECT_URI or "").strip()
    if not (client_id and client_secret and redirect_uri):
        return None
    return Credentials(client_id, client_secret, redirect_uri, settings.QBO_ENVIRONMENT)


def require_credentials() -> Credentials:
    credentials = configured_credentials()
    if credentials is None:
        raise QuickBooksNotConfigured(
            "QuickBooks Online is not configured on this server"
        )
    return credentials


def authorization_url(credentials: Credentials, state: str) -> str:
    """The Intuit consent page to send the Treasurer's browser to."""
    query = urlencode(
        {
            "client_id": credentials.client_id,
            "response_type": "code",
            "scope": ACCOUNTING_SCOPE,
            "redirect_uri": credentials.redirect_uri,
            "state": state,
        }
    )
    return f"{AUTHORIZATION_ENDPOINT}?{query}"


def _basic_auth(credentials: Credentials) -> str:
    raw = f"{credentials.client_id}:{credentials.client_secret}".encode("utf-8")
    return "Basic " + base64.b64encode(raw).decode("ascii")


def _seconds_from_now(value: Any) -> Optional[datetime]:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) or (isinstance(value, str) and value.isdigit()):
        return datetime.now(timezone.utc) + timedelta(seconds=int(value))
    return None


def _token_set(payload: Any) -> TokenSet:
    if not isinstance(payload, dict):
        raise QuickBooksTransient("QuickBooks returned an unreadable token response")
    access = payload.get("access_token")
    refresh = payload.get("refresh_token")
    if not isinstance(access, str) or not access:
        raise QuickBooksTransient("QuickBooks returned no access token")
    if not isinstance(refresh, str) or not refresh:
        raise QuickBooksTransient("QuickBooks returned no refresh token")
    return TokenSet(
        access_token=access,
        refresh_token=refresh,
        access_expires_at=_seconds_from_now(payload.get("expires_in")),
        refresh_expires_at=_seconds_from_now(payload.get("x_refresh_token_expires_in")),
    )


async def _token_request(
    http: httpx.AsyncClient, credentials: Credentials, form: dict[str, str]
) -> TokenSet:
    try:
        response = await http.post(
            TOKEN_ENDPOINT,
            data=form,
            headers={
                "Accept": "application/json",
                "Authorization": _basic_auth(credentials),
            },
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as exc:
        raise QuickBooksTransient(
            "Could not reach QuickBooks to sign in; try again shortly"
        ) from exc
    if response.status_code >= 500:
        raise QuickBooksTransient("QuickBooks sign-in is unavailable; try again later")
    if response.status_code == 400 or response.status_code == 401:
        # Intuit answers a refused code or refresh token with 400 invalid_grant.
        raise QuickBooksAuthError(
            "QuickBooks refused the sign-in; connect to QuickBooks again"
        )
    if response.status_code != 200:
        raise QuickBooksTransient(
            f"QuickBooks sign-in answered HTTP {response.status_code}"
        )
    try:
        payload = response.json()
    except ValueError as exc:
        raise QuickBooksTransient(
            "QuickBooks returned an unreadable token response"
        ) from exc
    return _token_set(payload)


async def exchange_code(
    http: httpx.AsyncClient, credentials: Credentials, code: str
) -> TokenSet:
    """Trade the authorization code for tokens. Intuit warns that a second
    exchange of the same code may invalidate the tokens, so this is called
    once per callback and never retried."""
    return await _token_request(
        http,
        credentials,
        {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": credentials.redirect_uri,
        },
    )


async def refresh_tokens(
    http: httpx.AsyncClient, credentials: Credentials, refresh_token: str
) -> TokenSet:
    """A new access token. The response's refresh token replaces the stored
    one: Intuit says to always keep the latest."""
    return await _token_request(
        http,
        credentials,
        {"grant_type": "refresh_token", "refresh_token": refresh_token},
    )


async def revoke_token(
    http: httpx.AsyncClient, credentials: Credentials, token: str
) -> bool:
    """Revoke the grant (Intuit: "revokes the access token and removes
    permissions"). True on 200; False on anything else, which the caller
    reports rather than raises, since the local tokens are discarded anyway."""
    try:
        response = await http.post(
            REVOCATION_ENDPOINT,
            json={"token": token},
            headers={
                "Accept": "application/json",
                "Authorization": _basic_auth(credentials),
            },
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError:
        return False
    return response.status_code == 200


def _fault_message(payload: Any) -> tuple[str, Optional[str]]:
    """``(message, code)`` from Intuit's ``{"Fault": {"Error": [...]}}``."""
    fault = payload.get("Fault") if isinstance(payload, dict) else None
    if not isinstance(fault, dict):
        return "", None
    errors = fault.get("Error")
    first = errors[0] if isinstance(errors, list) and errors else None
    if not isinstance(first, dict):
        return "", None
    code = first.get("code")
    parts = [
        str(part)
        for part in (first.get("Message"), first.get("Detail"))
        if isinstance(part, str) and part.strip()
    ]
    return " - ".join(parts), (str(code) if code is not None else None)


class AccountingClient:
    """The four Accounting API calls Finance makes, against one company."""

    def __init__(
        self,
        http: httpx.AsyncClient,
        *,
        environment: str,
        realm_id: str,
        access_token: str,
    ):
        if environment not in API_BASE_URLS:
            raise QuickBooksNotConfigured(
                f"Unknown QuickBooks environment {environment!r}"
            )
        self._http = http
        self._base = f"{API_BASE_URLS[environment]}/v3/company/{realm_id}"
        self._token = access_token

    def _headers(self, json_body: bool) -> dict[str, str]:
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self._token}",
        }
        if json_body:
            headers["Content-Type"] = "application/json"
        return headers

    async def _send(
        self,
        method: str,
        path: str,
        params: dict[str, str],
        body: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        params = {**params, "minorversion": MINOR_VERSION}
        try:
            response = await self._http.request(
                method,
                f"{self._base}/{path}",
                params=params,
                json=body,
                headers=self._headers(body is not None),
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
        except httpx.HTTPError as exc:
            raise QuickBooksTransient(
                "Could not reach QuickBooks; it will be tried again"
            ) from exc
        try:
            payload: Any = response.json()
        except ValueError:
            payload = None
        status = response.status_code
        message, code = _fault_message(payload)
        if status == 429:
            raise QuickBooksRateLimited(
                "QuickBooks is limiting requests; it will be tried again in a minute"
            )
        if status == 401:
            raise QuickBooksAuthError(
                "QuickBooks no longer accepts this connection; connect again"
            )
        if status == 403:
            # 3100 is the missing-scope code; any 403 means the grant cannot do
            # this, which only a fresh connection can change.
            raise QuickBooksAuthError(
                "QuickBooks refused access"
                + (f" ({message})" if message else "")
                + "; connect again"
            )
        if status >= 500:
            raise QuickBooksTransient(
                f"QuickBooks had an error (HTTP {status}); it will be tried again"
            )
        if status >= 400 or not isinstance(payload, dict) or "Fault" in payload:
            raise QuickBooksRejected(
                message or f"QuickBooks refused the request (HTTP {status})",
                code,
            )
        return payload

    async def query(self, entity: str) -> list[dict[str, Any]]:
        """Every ``entity`` in the company, a page of ``QUERY_PAGE_SIZE`` at a
        time.

        Only the entities in ``_QUERY_STATEMENTS`` can be queried. Each one's
        statement is a literal, so no caller can splice text into the query
        language, and an unknown name is refused before anything is sent.
        """
        base = _QUERY_STATEMENTS.get(entity)
        if base is None:
            raise ValueError(f"QuickBooks entity {entity!r} cannot be queried")
        rows: list[dict[str, Any]] = []
        start = 1
        while True:
            statement = f"{base} STARTPOSITION {start} MAXRESULTS {QUERY_PAGE_SIZE}"
            payload = await self._send("GET", "query", {"query": statement})
            response = payload.get("QueryResponse")
            page = response.get(entity) if isinstance(response, dict) else None
            items = (
                [r for r in page if isinstance(r, dict)]
                if isinstance(page, list)
                else []
            )
            rows.extend(items)
            if len(items) < QUERY_PAGE_SIZE:
                return rows
            start += QUERY_PAGE_SIZE

    async def list_accounts(self) -> list[dict[str, Any]]:
        return await self.query("Account")

    async def list_vendors(self) -> list[dict[str, Any]]:
        return await self.query("Vendor")

    async def create_vendor(self, display_name: str, request_id: str) -> dict[str, Any]:
        payload = await self._send(
            "POST",
            "vendor",
            {"requestid": _request_id(request_id)},
            {"DisplayName": display_name},
        )
        return _entity(payload, "Vendor")

    async def create_purchase(
        self, purchase: dict[str, Any], request_id: str
    ) -> dict[str, Any]:
        payload = await self._send(
            "POST", "purchase", {"requestid": _request_id(request_id)}, purchase
        )
        return _entity(payload, "Purchase")


def purchase_body(
    *,
    payment_type: str,
    account_id: str,
    txn_date: str,
    doc_number: Optional[str],
    lines: list[tuple[str, Decimal]],
    private_note: Optional[str] = None,
) -> dict[str, Any]:
    """The Purchase to create: paid from ``account_id``, one expense line per
    ``(account id, amount)``. The vendor's ``EntityRef`` is added by the
    caller once the vendor is found."""
    if payment_type not in PAID_FROM_ACCOUNT_TYPE:
        raise ValueError(f"Unknown QuickBooks payment type {payment_type!r}")
    if doc_number is not None and len(doc_number) > DOC_NUMBER_MAX:
        raise ValueError(
            f"'{doc_number}' is longer than the {DOC_NUMBER_MAX} characters "
            "QuickBooks allows in a transaction number"
        )
    body: dict[str, Any] = {
        "PaymentType": payment_type,
        "AccountRef": {"value": account_id},
        "TxnDate": txn_date,
    }
    if doc_number is not None:
        body["DocNumber"] = doc_number
    if private_note is not None:
        body["PrivateNote"] = private_note
    if payment_type == PAYMENT_TYPE_CHECK:
        body["PrintStatus"] = PRINT_STATUS_NOT_SET
    elif payment_type == PAYMENT_TYPE_CREDIT_CARD:
        body["Credit"] = False
    body["Line"] = [
        {
            "Amount": float(amount),
            "DetailType": "AccountBasedExpenseLineDetail",
            "AccountBasedExpenseLineDetail": {"AccountRef": {"value": account}},
        }
        for account, amount in lines
    ]
    return body


def _request_id(value: str) -> str:
    if not value or len(value) > REQUEST_ID_MAX:
        raise ValueError("A QuickBooks request id must be 1 to 50 characters")
    return value


def _entity(payload: dict[str, Any], name: str) -> dict[str, Any]:
    entity = payload.get(name)
    if not isinstance(entity, dict) or not entity.get("Id"):
        # Answered 200 without the record: whether it was created is unknown,
        # so it is treated as transient and resent with the same request id.
        raise QuickBooksTransient(f"QuickBooks did not return the {name} it created")
    return entity
