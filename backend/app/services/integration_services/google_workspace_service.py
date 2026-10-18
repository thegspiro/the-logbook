"""
Google Workspace (Admin SDK Directory API) connector.

Creates member accounts and adds them to groups on behalf of a department,
using a service account with domain-wide delegation that impersonates one of
the department's Workspace admins. Only the two scopes below are requested,
so a key leaked from here cannot read mail or files.

Every Google call blocks (googleapiclient over httplib2), so each public
method runs it in a worker thread rather than on the event loop. The
transport is the same bounded one the Google Calendar connector uses (INT-9
timeouts and response-size cap).
"""

import asyncio
import json
from typing import TYPE_CHECKING, Any, Optional, Sequence

from loguru import logger

from app.models.directory_account import GOOGLE_WORKSPACE_INTEGRATION, DirectoryProvider
from app.services.integration_services.directory_common import (
    DirectoryAccount,
    DirectoryAccountExistsError,
    DirectoryAccountNotFoundError,
    DirectoryError,
    DirectoryProviderInfo,
)
from app.services.integration_services.google_calendar_service import _BoundedHttp

if TYPE_CHECKING:
    from app.models.integration import Integration

# The Logbook marks each account it creates with the member's id, in the
# user's standard ``externalIds`` field (no extra scope). It is what tells a
# 409 on a retry -- an account an earlier attempt created whose answer never
# arrived -- from somebody else's account at the same address.
LOGBOOK_EXTERNAL_ID_TYPE = "the-logbook-member"


def to_directory_account(account: dict[str, Any]) -> DirectoryAccount:
    """A Directory API user resource, as the engine reads accounts."""
    google_id = account.get("id")
    return DirectoryAccount(
        id=google_id if isinstance(google_id, str) else "",
        primary_email=str(account.get("primaryEmail", "")).strip().lower(),
        suspended=bool(account.get("suspended")),
        member_id=logbook_member_id(account),
    )


def logbook_member_id(account: dict[str, Any]) -> Optional[str]:
    """The Logbook member id an account was created for, if it carries one."""
    for entry in account.get("externalIds") or []:
        if (
            isinstance(entry, dict)
            and entry.get("type") == "custom"
            and entry.get("customType") == LOGBOOK_EXTERNAL_ID_TYPE
            and isinstance(entry.get("value"), str)
        ):
            return str(entry["value"])
    return None


DIRECTORY_SCOPES = (
    "https://www.googleapis.com/auth/admin.directory.user",
    "https://www.googleapis.com/auth/admin.directory.group.member",
)

# Read-only, and requested by the connection test alone. Google refuses a
# delegated token outright when any scope asked for is not authorized, so
# adding it to DIRECTORY_SCOPES would stop account creation and suspension on
# every installation that authorized only the two above.
ORG_UNIT_SCOPE = "https://www.googleapis.com/auth/admin.directory.orgunit.readonly"


class GoogleWorkspaceError(DirectoryError):
    """A failure whose message is safe to show an officer.

    Messages are written here, never copied from Google's response, which can
    echo addresses and request detail.
    """


class GoogleAccountExistsError(GoogleWorkspaceError, DirectoryAccountExistsError):
    """The address already belongs to a user, alias or group in the domain."""


class GoogleAccountNotFoundError(GoogleWorkspaceError, DirectoryAccountNotFoundError):
    """The account a per-user call names no longer exists in Google."""


def _translate(
    exc: Exception, action: str, user_scoped: bool = False
) -> GoogleWorkspaceError:
    from google.auth.exceptions import RefreshError
    from googleapiclient.errors import HttpError

    # Only the type and HTTP status are logged: Google's error carries the
    # request URL (with the member's address as userKey) and its raw body.
    logger.warning(
        "Google Workspace {} failed: {} (HTTP {})",
        action,
        type(exc).__name__,
        getattr(getattr(exc, "resp", None), "status", "-"),
    )
    if isinstance(exc, GoogleWorkspaceError):
        return exc
    if isinstance(exc, RefreshError):
        return GoogleWorkspaceError(
            "Google refused the service account. Check that domain-wide "
            "delegation is granted to its client ID for the Directory API "
            "scopes, and that the admin email is a Workspace admin."
        )
    if isinstance(exc, HttpError):
        status = int(getattr(exc.resp, "status", 0) or 0)
        if status == 409:
            return GoogleAccountExistsError(
                "That address already belongs to an account, alias or group in "
                "Google Workspace."
            )
        if status in (401, 403):
            return GoogleWorkspaceError(
                "Google denied the request. The delegated admin may lack the "
                "privilege to manage users or groups."
            )
        if status == 404 and user_scoped:
            return GoogleAccountNotFoundError(
                "The account no longer exists in Google Workspace."
            )
        if status == 404:
            return GoogleWorkspaceError(
                "Google could not find a resource it needed. Check the org unit "
                "path and the group addresses."
            )
        if status == 412:
            return GoogleWorkspaceError(
                "Google could not create the account. The domain may have no "
                "Workspace licenses left."
            )
        if status == 400:
            return GoogleWorkspaceError(
                "Google rejected the request as invalid. Check the org unit path "
                "and the domain's password policy."
            )
        if status in (429, 500, 502, 503, 504):
            return GoogleWorkspaceError(
                "Google Workspace is busy or unavailable. Try again in a few "
                "minutes."
            )
    return GoogleWorkspaceError(f"The Google Workspace {action} failed.")


class GoogleWorkspaceDirectory:
    def __init__(
        self,
        service_account_info: dict[str, Any],
        admin_email: str,
        org_unit_path: str = "/",
    ):
        self._info = service_account_info
        self._admin_email = admin_email
        self._org_unit_path = org_unit_path or "/"
        self._credentials: dict[tuple[str, ...], Any] = {}

    def _service(self, scopes: tuple[str, ...] = DIRECTORY_SCOPES) -> Any:
        # The HTTP transport is built per call -- httplib2 connections are not
        # thread-safe, and each call runs on whichever worker thread asyncio
        # hands it -- but the credentials are kept, so one access token serves
        # every call this client makes (a conversion with groups makes several,
        # one after another, never concurrently).
        from google.oauth2 import service_account
        from google_auth_httplib2 import AuthorizedHttp
        from googleapiclient.discovery import build

        creds = self._credentials.get(scopes)
        if creds is None:
            creds = service_account.Credentials.from_service_account_info(
                self._info, scopes=list(scopes), subject=self._admin_email
            )
            self._credentials[scopes] = creds
        return build(
            "admin",
            "directory_v1",
            http=AuthorizedHttp(creds, http=_BoundedHttp()),
            static_discovery=True,
        )

    async def _run(self, action: str, call: Any, user_scoped: bool = False) -> Any:
        try:
            return await asyncio.to_thread(call)
        except Exception as exc:
            raise _translate(exc, action, user_scoped) from exc

    async def create_user(
        self,
        primary_email: str,
        given_name: str,
        family_name: str,
        password: str,
        member_id: str,
    ) -> Optional[str]:
        """Create the account in the configured org unit, tagged with
        *member_id*; returns Google's id."""
        body = {
            "primaryEmail": primary_email,
            "name": {"givenName": given_name, "familyName": family_name},
            "password": password,
            "changePasswordAtNextLogin": True,
            "orgUnitPath": self._org_unit_path,
            "externalIds": [
                {
                    "type": "custom",
                    "customType": LOGBOOK_EXTERNAL_ID_TYPE,
                    "value": member_id,
                }
            ],
        }

        def call() -> Any:
            return self._service().users().insert(body=body).execute()

        created = await self._run("account creation", call)
        google_id = created.get("id") if isinstance(created, dict) else None
        return google_id if isinstance(google_id, str) else None

    async def list_users(self, domain: str) -> list[DirectoryAccount]:
        """Every user in *domain*: id and primary address.

        Paged at Google's maximum of 500, so a department-sized domain takes a
        call or two rather than one per member. Aliases are not users and are
        not listed.
        """
        users: list[DirectoryAccount] = []
        page_token: Optional[str] = None
        while True:

            def call(token: Optional[str] = page_token) -> Any:
                return (
                    self._service()
                    .users()
                    .list(
                        domain=domain,
                        maxResults=500,
                        pageToken=token,
                        projection="basic",
                        fields="users(id,primaryEmail),nextPageToken",
                    )
                    .execute()
                )

            page = await self._run("account listing", call)
            if not isinstance(page, dict):
                return users
            users.extend(
                to_directory_account(u)
                for u in page.get("users") or []
                if isinstance(u, dict)
            )
            page_token = page.get("nextPageToken")
            if not page_token:
                return users

    async def get_user(self, user_key: str) -> DirectoryAccount:
        """The account *user_key* resolves to. An alias resolves to the account
        that owns it, which is why callers compare ``primaryEmail``."""

        def call() -> Any:
            return (
                self._service()
                .users()
                .get(userKey=user_key, projection="basic")
                .execute()
            )

        user = await self._run("account lookup", call, user_scoped=True)
        return to_directory_account(user if isinstance(user, dict) else {})

    async def is_suspended(self, user_key: str) -> bool:
        return (await self.get_user(user_key)).suspended

    async def set_suspended(self, user_key: str, suspended: bool) -> None:
        body = {"suspended": suspended}

        def call() -> Any:
            return self._service().users().update(userKey=user_key, body=body).execute()

        action = "account suspension" if suspended else "account unsuspension"
        await self._run(action, call, user_scoped=True)

    async def reset_password(self, user_key: str, password: str) -> None:
        body = {"password": password, "changePasswordAtNextLogin": True}

        def call() -> Any:
            return self._service().users().update(userKey=user_key, body=body).execute()

        await self._run("password reset", call)

    async def add_to_group(self, group: str, member_email: str) -> None:
        """Add a member to a group; already being a member counts as success."""
        body = {"email": member_email, "role": "MEMBER"}

        def call() -> Any:
            return self._service().members().insert(groupKey=group, body=body).execute()

        try:
            await self._run("group membership", call)
        except GoogleAccountExistsError:
            return

    async def ensure_licensed(self, user_key: str) -> None:
        """Google licenses an account when it is created; nothing to do."""

    async def test_connection(
        self, domain: str, group_emails: Sequence[str], org_unit_path: str
    ) -> str:
        """Read-only check that delegation works, the org unit exists and
        every group can be read. Nothing is created or changed."""

        def list_users() -> Any:
            return self._service().users().list(domain=domain, maxResults=1).execute()

        await self._run("connection test", list_users)
        unchecked = await self._check_org_unit(domain, org_unit_path)
        for group in group_emails:

            def list_members(group_key: str = group) -> Any:
                return (
                    self._service()
                    .members()
                    .list(groupKey=group_key, maxResults=1)
                    .execute()
                )

            try:
                await self._run("group check", list_members)
            except GoogleWorkspaceError:
                raise GoogleWorkspaceError(
                    f"Connected to {domain}, but the group {group} could not be "
                    "read. Check the address and the admin's group privileges."
                )
        groups = f" and {len(group_emails)} group(s)" if group_emails else ""
        unit = org_unit_path if org_unit_path not in ("", "/") else "the top level"
        message = f"Connected to Google Workspace for {domain}: org unit {unit}{groups}"
        return f"{message}. {unchecked}" if unchecked else message

    async def _check_org_unit(self, domain: str, org_unit_path: str) -> Optional[str]:
        """Raise if the org unit does not exist. Returns a note, rather than
        failing, when only the optional read-only scope is missing: account
        creation and suspension work without it, and a red Test would mark a
        working integration unhealthy."""
        path = (org_unit_path or "/").strip("/")
        if not path:
            return None  # the top level always exists

        def get_org_unit() -> Any:
            return (
                self._service(DIRECTORY_SCOPES + (ORG_UNIT_SCOPE,))
                .orgunits()
                .get(customerId="my_customer", orgUnitPath=path)
                .execute()
            )

        try:
            await asyncio.to_thread(get_org_unit)
        except Exception as exc:
            from google.auth.exceptions import RefreshError
            from googleapiclient.errors import HttpError

            # Delegation already worked for the two operating scopes above, so
            # a refused token here means only the read-only one is missing.
            if isinstance(exc, RefreshError):
                logger.warning("Google Workspace org unit check: scope refused")
                return (
                    "The org unit was not checked: add the read-only scope "
                    + ORG_UNIT_SCOPE
                    + " to the service account's domain-wide delegation to "
                    "have Test confirm it exists."
                )
            status = int(getattr(getattr(exc, "resp", None), "status", 0) or 0)
            if isinstance(exc, HttpError) and status in (400, 404):
                logger.warning("Google Workspace org unit check: not found")
                raise GoogleWorkspaceError(
                    f"Connected to {domain}, but the org unit /{path} does not "
                    "exist. Check the path in the Google Admin console."
                ) from exc
            raise _translate(exc, "org unit check") from exc
        return None


def directory_for(integration: "Integration") -> GoogleWorkspaceDirectory:
    """Build a client from a google-workspace integration's stored settings."""
    raw_key = integration.get_secret("service_account_key")
    admin_email = (integration.config or {}).get("admin_email")
    if not raw_key or not isinstance(admin_email, str) or not admin_email:
        raise GoogleWorkspaceError(
            "Google Workspace is missing its service-account key or admin email."
        )
    try:
        info = json.loads(raw_key)
    except ValueError:
        raise GoogleWorkspaceError("The stored service-account key is unreadable.")
    if not isinstance(info, dict):
        raise GoogleWorkspaceError("The stored service-account key is unreadable.")
    org_unit_path = str((integration.config or {}).get("org_unit_path") or "/")
    return GoogleWorkspaceDirectory(info, admin_email, org_unit_path)


GOOGLE_WORKSPACE_PROVIDER = DirectoryProviderInfo(
    provider=DirectoryProvider.GOOGLE.value,
    integration_type=GOOGLE_WORKSPACE_INTEGRATION,
    product="Google Workspace",
    vendor="Google",
    admin_console="the Google Admin console",
    sign_in_url="https://accounts.google.com/",
    audit_prefix="google_workspace",
    client_for=directory_for,
)
