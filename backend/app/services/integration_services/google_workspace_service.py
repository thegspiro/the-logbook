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

from app.services.integration_services.google_calendar_service import _BoundedHttp

if TYPE_CHECKING:
    from app.models.integration import Integration

DIRECTORY_SCOPES = (
    "https://www.googleapis.com/auth/admin.directory.user",
    "https://www.googleapis.com/auth/admin.directory.group.member",
)


class GoogleWorkspaceError(Exception):
    """A failure whose message is safe to show an officer.

    Messages are written here, never copied from Google's response, which can
    echo addresses and request detail.
    """


class GoogleAccountExistsError(GoogleWorkspaceError):
    """The address already belongs to a user, alias or group in the domain."""


class GoogleAccountNotFoundError(GoogleWorkspaceError):
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
    def __init__(self, service_account_info: dict[str, Any], admin_email: str):
        self._info = service_account_info
        self._admin_email = admin_email
        self._credentials: Any = None

    def _service(self) -> Any:
        # The HTTP transport is built per call -- httplib2 connections are not
        # thread-safe, and each call runs on whichever worker thread asyncio
        # hands it -- but the credentials are kept, so one access token serves
        # every call this client makes (a conversion with groups makes several,
        # one after another, never concurrently).
        from google.oauth2 import service_account
        from google_auth_httplib2 import AuthorizedHttp
        from googleapiclient.discovery import build

        if self._credentials is None:
            self._credentials = service_account.Credentials.from_service_account_info(
                self._info, scopes=list(DIRECTORY_SCOPES), subject=self._admin_email
            )
        creds = self._credentials
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
        org_unit_path: str,
    ) -> Optional[str]:
        """Create the account; returns Google's user id."""
        body = {
            "primaryEmail": primary_email,
            "name": {"givenName": given_name, "familyName": family_name},
            "password": password,
            "changePasswordAtNextLogin": True,
            "orgUnitPath": org_unit_path or "/",
        }

        def call() -> Any:
            return self._service().users().insert(body=body).execute()

        created = await self._run("account creation", call)
        google_id = created.get("id") if isinstance(created, dict) else None
        return google_id if isinstance(google_id, str) else None

    async def get_user(self, user_key: str) -> dict[str, Any]:
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
        return user if isinstance(user, dict) else {}

    async def is_suspended(self, user_key: str) -> bool:
        return bool((await self.get_user(user_key)).get("suspended"))

    async def set_suspended(self, user_key: str, suspended: bool) -> None:
        body = {"suspended": suspended}

        def call() -> Any:
            return self._service().users().update(userKey=user_key, body=body).execute()

        action = "account suspension" if suspended else "account unsuspension"
        await self._run(action, call, user_scoped=True)

    async def reset_password(self, primary_email: str, password: str) -> None:
        body = {"password": password, "changePasswordAtNextLogin": True}

        def call() -> Any:
            return (
                self._service()
                .users()
                .update(userKey=primary_email, body=body)
                .execute()
            )

        await self._run("password reset", call)

    async def add_to_group(self, group_email: str, member_email: str) -> None:
        """Add a member to a group; already being a member counts as success."""
        body = {"email": member_email, "role": "MEMBER"}

        def call() -> Any:
            return (
                self._service()
                .members()
                .insert(groupKey=group_email, body=body)
                .execute()
            )

        try:
            await self._run("group membership", call)
        except GoogleAccountExistsError:
            return

    async def test_connection(self, domain: str, group_emails: Sequence[str]) -> str:
        """Read-only check that delegation works and every group exists."""

        def list_users() -> Any:
            return self._service().users().list(domain=domain, maxResults=1).execute()

        await self._run("connection test", list_users)
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
        return f"Connected to Google Workspace for {domain}{groups}"


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
    return GoogleWorkspaceDirectory(info, admin_email)
