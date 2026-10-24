"""
Microsoft 365 (Microsoft Graph) connector for directory accounts.

Creates member accounts, licenses them, adds them to groups and blocks their
sign-in on departure, on behalf of a department, as an Entra ID application
using the client credentials flow -- the same flow, token helper and failure
throttling as Microsoft 365 SMTP (``app/utils/microsoft_oauth.py``), asking
for Microsoft Graph instead of Exchange Online.

Three Graph behaviours shape this module:

- **An account has no mailbox until it is licensed**, and a license needs a
  usage location. The location is set when the account is created; the
  license, when the integration names one, is assigned after
  (:meth:`ensure_licensed`). A department using group-based licensing names no
  license and adds a licensed group instead.
- **Exchange owns distribution lists and mail-enabled security groups**, and
  Graph cannot change their membership. Test rejects them, and dynamic groups,
  whose membership a rule decides.
- **A user synced from on-premises Active Directory cannot be changed here.**
  Such an account is never blocked or reset through Graph;
  :class:`Microsoft365ManagedOnPremisesError` tells an officer to disable it
  in Active Directory.

Every account The Logbook creates carries ``the-logbook-member:<id>`` in
``onPremisesExtensionAttributes.extensionAttribute15`` (Exchange custom
attribute 15), set in the same request that creates it. That is what tells a
retry's "already exists" -- a create whose answer never arrived -- from
somebody else's account at the address. Graph lets a cloud-only user's
extension attributes be written at creation; an open extension would need a
second call, and an account created by the first would be untagged if the
second failed.

Error messages are written here, never copied from Graph's response, which
can echo addresses and request detail.
"""

import asyncio
import re
from datetime import date
from typing import TYPE_CHECKING, Any, Callable, Optional, Sequence
from urllib.parse import quote

import httpx
from loguru import logger

from app.models.directory_account import MICROSOFT_365_INTEGRATION, DirectoryProvider
from app.services.integration_services.base import create_integration_client
from app.services.integration_services.directory_common import (
    DirectoryAccount,
    DirectoryAccountExistsError,
    DirectoryAccountManagedElsewhereError,
    DirectoryAccountNotFoundError,
    DirectoryError,
    DirectoryProviderInfo,
)
from app.utils.microsoft_oauth import (
    MICROSOFT_GRAPH_SCOPE,
    MicrosoftOAuthError,
    acquire_access_token,
)

if TYPE_CHECKING:
    from app.models.integration import Integration

GRAPH_BASE = "https://graph.microsoft.com/v1.0"
TAG_ATTRIBUTE = "extensionAttribute15"
TAG_PREFIX = "the-logbook-member:"
USER_FIELDS = (
    "id,userPrincipalName,mail,accountEnabled,onPremisesSyncEnabled,"
    "onPremisesExtensionAttributes"
)
GROUP_FIELDS = (
    "id,displayName,mail,groupTypes,mailEnabled,securityEnabled,assignedLicenses"
)
_GUID = re.compile(r"\A[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\Z")
# A mailNickname may not contain these, among others; anything outside the
# safe set is dropped rather than risk Graph refusing the whole account.
_NICKNAME_UNSAFE = re.compile(r"[^A-Za-z0-9._-]")
# Graph pages user listings at most 999 at a time.
_PAGE_SIZE = 999

ClientFactory = Callable[[], httpx.AsyncClient]


class Microsoft365Error(DirectoryError):
    """A failure whose message is safe to show an officer."""


class Microsoft365AccountExistsError(Microsoft365Error, DirectoryAccountExistsError):
    """The address already belongs to a user, alias or group."""


class Microsoft365AccountNotFoundError(
    Microsoft365Error, DirectoryAccountNotFoundError
):
    """The account a per-user call names no longer exists."""


class Microsoft365ManagedOnPremisesError(
    Microsoft365Error, DirectoryAccountManagedElsewhereError
):
    """The account is synced from on-premises Active Directory."""


# The integration config key an administrator fills from Entra ID, and the
# days before it at which the administrators are warned: a month to arrange a
# new secret, a week as the reminder, and the day it has run out.
SECRET_EXPIRY_KEY = "client_secret_expires_on"
SECRET_WARNING_DAYS = (30, 7, 0)


def client_secret_days_left(config: Any, today: date) -> Optional[int]:
    """Days from *today* until the client secret expires, negative once it
    has; None when no date is recorded (or the stored one is unreadable)."""
    raw = config.get(SECRET_EXPIRY_KEY) if isinstance(config, dict) else None
    if not isinstance(raw, str) or not raw:
        return None
    try:
        return (date.fromisoformat(raw) - today).days
    except ValueError:
        return None


def client_secret_warning_level(days_left: Optional[int]) -> Optional[int]:
    """The smallest warning threshold *days_left* has reached, if any."""
    if days_left is None:
        return None
    reached = [days for days in SECRET_WARNING_DAYS if days_left <= days]
    return min(reached) if reached else None


MANAGED_ON_PREMISES_MESSAGE = (
    "This account is synced from on-premises Active Directory, so Microsoft "
    "365 cannot block or change it. Disable the account in Active Directory."
)


def to_directory_account(user: dict[str, Any]) -> DirectoryAccount:
    """A Graph user resource, as the engine reads accounts."""
    upn = str(user.get("userPrincipalName") or "").strip().lower()
    mail = str(user.get("mail") or "").strip().lower()
    attributes = user.get("onPremisesExtensionAttributes")
    tag = attributes.get(TAG_ATTRIBUTE) if isinstance(attributes, dict) else None
    member_id = (
        tag[len(TAG_PREFIX) :]
        if isinstance(tag, str) and tag.startswith(TAG_PREFIX)
        else None
    )
    user_id = user.get("id")
    return DirectoryAccount(
        id=user_id if isinstance(user_id, str) else "",
        primary_email=upn,
        suspended=user.get("accountEnabled") is False,
        member_id=member_id or None,
        other_addresses=(mail,) if mail and mail != upn else (),
        managed_elsewhere=bool(user.get("onPremisesSyncEnabled")),
    )


def _odata_string(value: str) -> str:
    """A value for a $filter string literal: OData doubles single quotes."""
    return value.replace("'", "''")


def _error_detail(response: httpx.Response) -> tuple[str, str]:
    """Graph's error code and message, for classification only -- neither is
    ever shown or logged."""
    try:
        body = response.json()
    except ValueError:
        return "", ""
    error = body.get("error") if isinstance(body, dict) else None
    if not isinstance(error, dict):
        return "", ""
    return str(error.get("code") or ""), str(error.get("message") or "")


def _translate(
    response: httpx.Response, action: str, user_scoped: bool
) -> Microsoft365Error:
    status = response.status_code
    code, message = _error_detail(response)
    lowered = message.lower()
    # Only the action, the status and Graph's error code are logged: the
    # message and the URL can carry the member's address.
    logger.warning("Microsoft 365 {} failed: HTTP {} ({})", action, status, code or "-")
    if status == 400 and (
        "on-premises" in lowered
        or "originated within an external service" in lowered
        or code == "AzureActiveDirectoryCannotUpdateObjectsOriginatedInExternalService"
    ):
        return Microsoft365ManagedOnPremisesError(MANAGED_ON_PREMISES_MESSAGE)
    if status == 400 and "already exist" in lowered:
        return Microsoft365AccountExistsError(
            "That address already belongs to an account, alias or group in "
            "Microsoft 365."
        )
    if status == 400 and "password" in lowered:
        return Microsoft365Error(
            "Microsoft 365 rejected the temporary password. Check the tenant's "
            "password policy."
        )
    if status == 400 and action == "license assignment":
        return Microsoft365Error(
            "Microsoft 365 could not assign the license. Check that the "
            "subscription has licenses available and that the usage location "
            "is a country the license is sold in."
        )
    if status == 400:
        return Microsoft365Error(
            "Microsoft 365 rejected the request as invalid. Check the domain, "
            "the usage location and the group addresses."
        )
    if status == 401:
        return Microsoft365Error(
            "Microsoft 365 refused the application's token. Check the tenant "
            "ID, client ID and client secret."
        )
    if status == 403:
        return Microsoft365Error(
            "Microsoft 365 denied the request. Check that the application's "
            "Microsoft Graph permissions have admin consent and that it holds "
            "the User Administrator role."
        )
    if status == 404 and user_scoped:
        return Microsoft365AccountNotFoundError(
            "The account no longer exists in Microsoft 365."
        )
    if status == 404:
        return Microsoft365Error(
            "Microsoft 365 could not find a resource it needed. Check the "
            "group addresses and the license."
        )
    if status == 429 or status >= 500:
        return Microsoft365Error(
            "Microsoft 365 is busy or unavailable. Try again in a few minutes."
        )
    return Microsoft365Error(f"The Microsoft 365 {action} failed.")


def _mail_nickname(primary_email: str) -> str:
    local = primary_email.split("@", 1)[0]
    return (_NICKNAME_UNSAFE.sub("", local) or "member")[:64]


class Microsoft365Directory:
    def __init__(
        self,
        tenant_id: str,
        client_id: str,
        client_secret: str,
        usage_location: str = "US",
        license_sku_id: Optional[str] = None,
        client_factory: ClientFactory = create_integration_client,
    ):
        self._tenant_id = tenant_id
        self._client_id = client_id
        self._client_secret = client_secret
        self._usage_location = usage_location
        self._license_sku_id = license_sku_id or None
        self._client_factory = client_factory

    async def _token(self) -> str:
        # msal blocks (requests underneath), so it runs off the event loop.
        try:
            return await asyncio.to_thread(
                acquire_access_token,
                self._tenant_id,
                self._client_id,
                self._client_secret,
                MICROSOFT_GRAPH_SCOPE,
            )
        except MicrosoftOAuthError as exc:
            # Written by microsoft_oauth for an administrator; safe to show.
            raise Microsoft365Error(str(exc)) from exc

    async def _request(
        self,
        method: str,
        url: str,
        action: str,
        *,
        json: Optional[dict[str, Any]] = None,
        params: Optional[dict[str, str]] = None,
        user_scoped: bool = False,
    ) -> Any:
        token = await self._token()
        try:
            async with self._client_factory() as client:
                response = await client.request(
                    method,
                    url,
                    json=json,
                    params=params,
                    headers={"Authorization": f"Bearer {token}"},
                )
        except httpx.HTTPError as exc:
            logger.warning("Microsoft 365 {} failed: {}", action, type(exc).__name__)
            raise Microsoft365Error(
                "Microsoft 365 could not be reached. Check outbound access to "
                "graph.microsoft.com and try again."
            ) from exc
        if response.status_code >= 400:
            raise _translate(response, action, user_scoped)
        if response.status_code == 204 or not response.content:
            return {}
        try:
            return response.json()
        except ValueError as exc:
            raise Microsoft365Error(
                f"Microsoft 365 answered the {action} with something unreadable."
            ) from exc

    async def _user_resource(self, user_key: str) -> dict[str, Any]:
        """The user *user_key* resolves to: an id, or an address matched
        against the sign-in name or the primary mail address."""
        if "@" not in user_key:
            user = await self._request(
                "GET",
                f"{GRAPH_BASE}/users/{quote(user_key, safe='')}",
                "account lookup",
                params={"$select": USER_FIELDS},
                user_scoped=True,
            )
            return user if isinstance(user, dict) else {}
        address = _odata_string(user_key.strip().lower())
        page = await self._request(
            "GET",
            f"{GRAPH_BASE}/users",
            "account lookup",
            params={
                "$filter": f"userPrincipalName eq '{address}' or mail eq '{address}'",
                "$select": USER_FIELDS,
            },
        )
        users = [u for u in (page or {}).get("value") or [] if isinstance(u, dict)]
        if not users:
            raise Microsoft365AccountNotFoundError(
                "No Microsoft 365 user has that address."
            )
        # The account whose sign-in name is the address wins over one that
        # merely has it as mail.
        wanted = user_key.strip().lower()
        users.sort(
            key=lambda u: str(u.get("userPrincipalName") or "").lower() != wanted
        )
        return users[0]

    async def create_user(
        self,
        primary_email: str,
        given_name: str,
        family_name: str,
        password: str,
        member_id: str,
    ) -> Optional[str]:
        """Create the account, tagged with *member_id*; returns its id."""
        body = {
            "accountEnabled": True,
            "displayName": f"{given_name} {family_name}".strip(),
            "givenName": given_name,
            "surname": family_name,
            "mailNickname": _mail_nickname(primary_email),
            "userPrincipalName": primary_email,
            "usageLocation": self._usage_location,
            "passwordProfile": {
                "password": password,
                "forceChangePasswordNextSignIn": True,
            },
            "onPremisesExtensionAttributes": {TAG_ATTRIBUTE: TAG_PREFIX + member_id},
        }
        created = await self._request(
            "POST", f"{GRAPH_BASE}/users", "account creation", json=body
        )
        user_id = created.get("id") if isinstance(created, dict) else None
        return user_id if isinstance(user_id, str) else None

    async def list_users(self, domain: str) -> list[DirectoryAccount]:
        """Every user with an address in *domain*, following Graph's paging.

        Graph cannot filter on a domain suffix without advanced queries, so
        the domain is applied here; a department's tenant is small.
        """
        suffix = "@" + domain.lower()
        users: list[DirectoryAccount] = []
        url: Optional[str] = f"{GRAPH_BASE}/users"
        params: Optional[dict[str, str]] = {
            "$select": USER_FIELDS,
            "$top": str(_PAGE_SIZE),
        }
        while url:
            page = await self._request("GET", url, "account listing", params=params)
            for raw in (page or {}).get("value") or []:
                if not isinstance(raw, dict):
                    continue
                account = to_directory_account(raw)
                if account.id and any(a.endswith(suffix) for a in account.addresses):
                    users.append(account)
            next_link = (page or {}).get("@odata.nextLink")
            # The next link carries its own query. Only Graph's own is
            # followed: anything else would send the bearer token elsewhere.
            if isinstance(next_link, str) and next_link.startswith(GRAPH_BASE + "/"):
                url, params = next_link, None
            else:
                url = None
        return users

    async def get_user(self, user_key: str) -> DirectoryAccount:
        return to_directory_account(await self._user_resource(user_key))

    async def is_suspended(self, user_key: str) -> bool:
        return (await self.get_user(user_key)).suspended

    async def set_suspended(self, user_key: str, suspended: bool) -> None:
        """Block or restore sign-in. Blocking also ends active sessions."""
        account = await self.get_user(user_key)
        if account.managed_elsewhere:
            raise Microsoft365ManagedOnPremisesError(MANAGED_ON_PREMISES_MESSAGE)
        path = f"{GRAPH_BASE}/users/{quote(account.id, safe='')}"
        action = "sign-in block" if suspended else "sign-in unblock"
        await self._request(
            "PATCH",
            path,
            action,
            json={"accountEnabled": not suspended},
            user_scoped=True,
        )
        if not suspended:
            return
        # Best effort. With sign-in blocked no new token is issued and a
        # refresh is refused, so a failure here leaves at most the access
        # tokens already held, which expire on their own. Raising would leave
        # the block unrecorded, and a member's return would then never lift it.
        try:
            await self._request(
                "POST", f"{path}/revokeSignInSessions", "session revocation"
            )
        except Microsoft365Error:
            logger.warning("Microsoft 365 sign-in blocked; sessions not revoked")

    async def reset_password(self, user_key: str, password: str) -> None:
        account = await self.get_user(user_key)
        if account.managed_elsewhere:
            raise Microsoft365ManagedOnPremisesError(MANAGED_ON_PREMISES_MESSAGE)
        await self._request(
            "PATCH",
            f"{GRAPH_BASE}/users/{quote(account.id, safe='')}",
            "password reset",
            json={
                "passwordProfile": {
                    "password": password,
                    "forceChangePasswordNextSignIn": True,
                }
            },
            user_scoped=True,
        )

    async def ensure_licensed(self, user_key: str) -> None:
        if self._license_sku_id is None:
            return  # group-based licensing, or licenses assigned by hand
        user = await self._request(
            "GET",
            f"{GRAPH_BASE}/users/{quote(user_key, safe='')}",
            "license check",
            params={"$select": "id,assignedLicenses"},
            user_scoped=True,
        )
        held = {
            str(lic.get("skuId", "")).lower()
            for lic in (user or {}).get("assignedLicenses") or []
            if isinstance(lic, dict)
        }
        if self._license_sku_id.lower() in held:
            return
        await self._request(
            "POST",
            f"{GRAPH_BASE}/users/{quote(user_key, safe='')}/assignLicense",
            "license assignment",
            json={
                "addLicenses": [{"skuId": self._license_sku_id, "disabledPlans": []}],
                "removeLicenses": [],
            },
            user_scoped=True,
        )

    async def _group(self, group: str) -> dict[str, Any]:
        """The group *group* names: an object id, or a mail address."""
        if _GUID.match(group):
            found = await self._request(
                "GET",
                f"{GRAPH_BASE}/groups/{group}",
                "group lookup",
                params={"$select": GROUP_FIELDS},
            )
            return found if isinstance(found, dict) else {}
        page = await self._request(
            "GET",
            f"{GRAPH_BASE}/groups",
            "group lookup",
            params={
                "$filter": f"mail eq '{_odata_string(group.lower())}'",
                "$select": GROUP_FIELDS,
            },
        )
        groups = [g for g in (page or {}).get("value") or [] if isinstance(g, dict)]
        if not groups:
            raise Microsoft365Error(f"No Microsoft 365 group has the address {group}.")
        return groups[0]

    async def add_to_group(self, group: str, member_email: str) -> None:
        """Add a member to a group; already being a member counts as success."""
        group_id = str((await self._group(group)).get("id") or "")
        account = await self.get_user(member_email)
        try:
            await self._request(
                "POST",
                f"{GRAPH_BASE}/groups/{quote(group_id, safe='')}/members/$ref",
                "group membership",
                json={"@odata.id": f"{GRAPH_BASE}/directoryObjects/{account.id}"},
            )
        except Microsoft365AccountExistsError:
            return

    async def update_name(
        self, user_key: str, given_name: str, family_name: str
    ) -> None:
        """Give the account the member's name -- display name included, as at
        creation. The sign-in name and address are not changed."""
        await self._request(
            "PATCH",
            f"{GRAPH_BASE}/users/{quote(user_key, safe='')}",
            "account rename",
            json={
                "displayName": f"{given_name} {family_name}".strip(),
                "givenName": given_name,
                "surname": family_name,
            },
            user_scoped=True,
        )

    async def remove_from_group(self, group: str, user_key: str) -> bool:
        """Take a member out of a group; not being in it counts as done.

        A group that assigns licenses is left alone (False): removing the
        member would take the license, and a mailbox without one is deleted
        after Microsoft's grace period (owner decision, 2026-10-23). So is a
        group whose licenses Graph did not report, rather than guessed at.
        """
        found = await self._group(group)
        licenses = found.get("assignedLicenses")
        if not isinstance(licenses, list) or licenses:
            return False
        group_id = str(found.get("id") or "")
        try:
            account = await self.get_user(user_key)
            await self._request(
                "DELETE",
                f"{GRAPH_BASE}/groups/{quote(group_id, safe='')}/members/"
                f"{quote(account.id, safe='')}/$ref",
                "group membership removal",
                user_scoped=True,
            )
        except Microsoft365AccountNotFoundError:
            pass
        return True

    async def test_connection(
        self, domain: str, groups: Sequence[str], license_sku_id: Optional[str]
    ) -> str:
        """Read-only: the credentials work, the license exists, and every
        group is one Graph can add members to. Nothing is created."""
        await self._request(
            "GET",
            f"{GRAPH_BASE}/users",
            "connection test",
            params={"$select": "id", "$top": "1"},
        )
        license_note = ""
        if license_sku_id:
            license_note = await self._check_license(license_sku_id)
        for group in groups:
            await self._check_group(group)
        group_note = f" and {len(groups)} group(s)" if groups else ""
        return f"Connected to Microsoft 365 for {domain}{license_note}{group_note}"

    async def _check_license(self, sku_id: str) -> str:
        skus = await self._request(
            "GET",
            f"{GRAPH_BASE}/subscribedSkus",
            "license check",
            params={"$select": "skuId,skuPartNumber,prepaidUnits,consumedUnits"},
        )
        for sku in (skus or {}).get("value") or []:
            if not isinstance(sku, dict):
                continue
            if str(sku.get("skuId", "")).lower() != sku_id.lower():
                continue
            prepaid = sku.get("prepaidUnits") or {}
            enabled = int(prepaid.get("enabled") or 0)
            available = enabled - int(sku.get("consumedUnits") or 0)
            name = str(sku.get("skuPartNumber") or sku_id)
            return f": license {name} ({max(available, 0)} available)"
        raise Microsoft365Error(
            "The license is not one of this tenant's subscriptions. Check the "
            "SKU ID in the Microsoft 365 admin center."
        )

    async def _check_group(self, group: str) -> None:
        found = await self._group(group)
        group_types = [str(t) for t in found.get("groupTypes") or []]
        name = str(found.get("displayName") or group)
        if "DynamicMembership" in group_types:
            raise Microsoft365Error(
                f"The group {name} has dynamic membership: a rule decides who "
                "is in it, so The Logbook cannot add members. Use an assigned "
                "group."
            )
        if "Unified" in group_types:
            return  # a Microsoft 365 group
        if found.get("securityEnabled") and not found.get("mailEnabled"):
            return  # a security group
        raise Microsoft365Error(
            f"The group {name} is a distribution list or mail-enabled security "
            "group. Only Exchange can change its members, so The Logbook "
            "cannot. Use a security group or a Microsoft 365 group."
        )


def directory_for(integration: "Integration") -> Microsoft365Directory:
    """Build a client from a microsoft-365 integration's stored settings."""
    config = integration.config or {}
    secret = integration.get_secret("client_secret")
    tenant_id = config.get("tenant_id")
    client_id = config.get("client_id")
    if not (
        secret
        and isinstance(tenant_id, str)
        and tenant_id
        and isinstance(client_id, str)
        and client_id
    ):
        raise Microsoft365Error(
            "Microsoft 365 is missing its tenant ID, client ID or client secret."
        )
    return Microsoft365Directory(
        tenant_id,
        client_id,
        secret,
        usage_location=str(config.get("usage_location") or "US"),
        license_sku_id=str(config.get("license_sku_id") or "") or None,
    )


MICROSOFT_365_PROVIDER = DirectoryProviderInfo(
    provider=DirectoryProvider.MICROSOFT.value,
    integration_type=MICROSOFT_365_INTEGRATION,
    product="Microsoft 365",
    vendor="Microsoft",
    admin_console="the Microsoft 365 admin center",
    sign_in_url="https://www.office.com/",
    audit_prefix="microsoft_365",
    client_for=directory_for,
    groups_key="groups",
)
