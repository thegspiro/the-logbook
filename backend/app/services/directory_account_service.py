"""
Directory account provisioning for newly converted members.

When a department has connected a directory integration (Google Workspace or
Microsoft 365) and a member is converted from an applicant with a department email address,
the conversion stages a :class:`DirectoryAccountProvision` row in its own
transaction. After that transaction commits, :meth:`provision` creates the
account. A failure never undoes the conversion -- the member exists whatever
the directory says -- and leaves a row an officer can retry from the member's
profile.

Ordering is the point of this module. The directory's API call is an external
side effect that cannot roll back with the database, so it never runs before
the member is durable: creating the account first would leave an orphaned
account, holding a license, behind any conversion that then failed.

Nothing here names a vendor. The provider a row belongs to is recorded on the
row, its client is reached through :func:`directory_for`, and every message
takes its wording from the provider's :class:`DirectoryProviderInfo`.
"""

import html
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from loguru import logger
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import generate_temporary_password
from app.models.directory_account import (
    DirectoryAccountProvision,
    DirectoryAccountStatus,
)
from app.models.directory_account_departure import (
    SUSPENDABLE_STATUSES,
    has_departed,
)
from app.models.integration import Integration
from app.models.user import Organization, User
from app.services.email_theme import callout, fact, facts
from app.services.integration_services.directory_common import (
    DirectoryAccount,
    DirectoryAccountExistsError,
    DirectoryAccountManagedElsewhereError,
    DirectoryAccountNotFoundError,
    DirectoryClient,
    DirectoryError,
    DirectoryProviderInfo,
)
from app.services.integration_services.google_workspace_service import (
    GOOGLE_WORKSPACE_PROVIDER,
)
from app.services.integration_services.microsoft_365_service import (
    MICROSOFT_365_PROVIDER,
)

# Every directory The Logbook can provision into, by the value stored in
# ``directory_account_provisions.provider``. A department connects one at a
# time (the integrations endpoint refuses a second).
PROVIDERS: dict[str, DirectoryProviderInfo] = {
    info.provider: info for info in (GOOGLE_WORKSPACE_PROVIDER, MICROSOFT_365_PROVIDER)
}
_BY_INTEGRATION = {info.integration_type: info for info in PROVIDERS.values()}


def provider_info(provider: str) -> DirectoryProviderInfo:
    info = PROVIDERS.get(provider)
    if info is None:
        raise DirectoryError(f"The directory {provider!r} is not supported.")
    return info


def directory_for(integration: Integration) -> DirectoryClient:
    """The client for a connected directory integration."""
    info = _BY_INTEGRATION.get(integration.integration_type)
    if info is None:
        raise DirectoryError("That integration is not a directory.")
    return info.client_for(integration)


# Two retries this close together are a double click, not a decision.
RETRY_COOLDOWN = timedelta(seconds=60)

# How long a failed suspension waits before the scheduled sync tries again.
SUSPENSION_RETRY_AFTER = timedelta(minutes=15)

# A record still being created after this long never got its answer from
# the directory (a worker stopped, or the call is wedged); the same length of time
# that marks every other item as overdue for the daily alert is longer.
STALE_PENDING_AFTER = timedelta(hours=1)
# How long an item may wait before the daily alert reports it. The sweep has
# retried a failed suspension dozens of times by then.
ATTENTION_OVERDUE_AFTER = timedelta(hours=24)


class AttentionIssue:
    NOT_SUSPENDED = "not_suspended"
    NOT_UNSUSPENDED = "not_unsuspended"
    NOT_CREATED = "not_created"
    SETUP_UNFINISHED = "setup_unfinished"


# The one wording of each issue: the list's response carries it, and the
# email reads it from there, so the screen and the email cannot disagree.
ATTENTION_LABELS = {
    AttentionIssue.NOT_SUSPENDED: "Left, but the account is not suspended",
    AttentionIssue.NOT_UNSUSPENDED: "Returned, but the account is still suspended",
    AttentionIssue.NOT_CREATED: "Account not created",
    AttentionIssue.SETUP_UNFINISHED: "Account setup unfinished",
}


def unanswered_creation_message(info: DirectoryProviderInfo) -> str:
    return (
        f"Left while the account was being created, and {info.vendor} never "
        "answered. An account may exist at this address: check "
        f"{info.admin_console} and suspend it there."
    )


@dataclass(frozen=True)
class AttentionItem:
    user_id: str
    member_name: str
    primary_email: str
    issue: str
    label: str
    detail: Optional[str]
    since: Optional[datetime]
    overdue: bool


def linked_existing_message(info: DirectoryProviderInfo) -> str:
    return (
        f"That address already belongs to a {info.vendor} account, alias or "
        "group. The Logbook has linked the member to it and left it unchanged; "
        f"manage it in {info.admin_console}."
    )


# Accounts that exist in the directory, and so can be suspended. A linked existing
# account is suspended too (owner decision, 2026-10-15); only a suspension
# The Logbook applied is ever lifted.
_SUSPENDABLE = frozenset(SUSPENDABLE_STATUSES)


def suspendable_address(row: Optional[DirectoryAccountProvision]) -> Optional[str]:
    """The key to suspend for *row*, when it names an account in the directory."""
    if row is None or row.status not in _SUSPENDABLE:
        return None
    return _account_key(row)


def member_has_departed(user: User) -> bool:
    return has_departed(user.status, user.deleted_at)


class ProvisionRetryError(Exception):
    """A retry that cannot run; the message is safe to show."""


class ProvisionRetryTooSoon(ProvisionRetryError):
    pass


def _domain_of(email: str) -> str:
    return email.rsplit("@", 1)[-1].lower()


def credentials_html(
    info: DirectoryProviderInfo, primary_email: str, password: str
) -> str:
    """The card appended to the welcome email. Values are escaped here."""
    return callout(
        "info",
        f"Your {info.product} account",
        "Sign in at "
        f"{info.sign_in_url} as <strong>{html.escape(primary_email)}</strong> "
        f"with the temporary password <code>{html.escape(password)}</code>. "
        f"{info.vendor} will ask you to choose a new password. A new account can "
        "take a few minutes before it accepts a sign-in.",
    )


def credentials_text(
    info: DirectoryProviderInfo, primary_email: str, password: str
) -> str:
    return (
        f"\n\nYour {info.product} account\n"
        f"Sign in at {info.sign_in_url}\n"
        f"Address: {primary_email}\n"
        f"Temporary password: {password}\n"
        f"{info.vendor} will ask you to choose a new password. A new account can "
        "take a few minutes before it accepts a sign-in.\n"
    )


# The audit event (after the provider's prefix) recording an account found
# active again after its member left; the daily attention email reads it.
ACTIVE_AFTER_DEPARTURE_EVENT = "account_active_after_departure"


def active_after_departure_message(info: DirectoryProviderInfo) -> str:
    return (
        f"The account was turned back on in {info.admin_console} after the "
        "member left. The Logbook is suspending it again."
    )


def account_in_use_message(info: DirectoryProviderInfo) -> str:
    return (
        f"The {info.vendor} account at that address is still recorded for "
        "another member (a former member whose address was reused, for "
        "example). The Logbook will not let two members govern one account; "
        f"resolve it in {info.admin_console} or change the member's department "
        "email, then retry."
    )


def address_taken_message(info: DirectoryProviderInfo) -> str:
    return (
        f"That address belongs to a {info.vendor} group, or is an alias on "
        "another person's account, so The Logbook will not take it over. Free "
        "the address or change the member's department email, then retry."
    )


def _not_connected(info: DirectoryProviderInfo) -> str:
    return f"The {info.product} integration is not connected."


def _domain_mismatch(info: DirectoryProviderInfo, domain: str) -> str:
    return (
        f"The member's address is not on the {info.product} domain {domain}. "
        "Check the department email settings."
    )


def _is_duplicate_key(exc: IntegrityError) -> bool:
    """MySQL/MariaDB error 1062: a unique index refused the row."""
    args: tuple[object, ...] = tuple(getattr(exc.orig, "args", None) or ())
    return len(args) > 0 and args[0] == 1062


def _account_key(row: DirectoryAccountProvision) -> str:
    """The directory's immutable user id when known. An address can be renamed
    or re-pointed as an alias to someone else; the id cannot."""
    return row.external_user_id or row.primary_email


class DirectoryAccountService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def is_connected(self, organization_id: str) -> bool:
        return await self.connected_provider(organization_id) is not None

    async def connected_provider(
        self, organization_id: str
    ) -> Optional[DirectoryProviderInfo]:
        """The directory this department provisions into, if one is connected."""
        for info in PROVIDERS.values():
            if await self._active_integration(organization_id, info) is not None:
                return info
        return None

    async def _active_integration(
        self, organization_id: str, info: DirectoryProviderInfo
    ) -> Optional[Integration]:
        integration: Optional[Integration] = (
            await self.db.execute(
                select(Integration).where(
                    Integration.organization_id == str(organization_id),
                    Integration.integration_type == info.integration_type,
                )
            )
        ).scalar_one_or_none()
        if integration is None or not integration.enabled:
            return None
        if integration.status != "connected":
            return None
        return integration

    async def active_integration(
        self, organization_id: str, info: DirectoryProviderInfo
    ) -> Optional[Integration]:
        """The department's connected, enabled integration for *info*."""
        return await self._active_integration(organization_id, info)

    async def stage_for_transfer(
        self,
        *,
        organization_id: str,
        user_id: str,
        department_email: Optional[str],
        created_by: Optional[str],
    ) -> Optional[DirectoryAccountProvision]:
        """Add a provisioning row to the conversion's transaction, if one applies.

        Nothing is staged without a department address — the applicant's own
        address is not the department's to create — or while no directory is
        connected.
        """
        if not department_email:
            return None
        info = await self.connected_provider(organization_id)
        if info is None:
            return None
        integration = await self._active_integration(organization_id, info)
        if integration is None:
            return None

        config = integration.config or {}
        domain = str(config.get("domain", "")).lower()
        email = department_email.strip().lower()
        row = DirectoryAccountProvision(
            organization_id=str(organization_id),
            user_id=str(user_id),
            provider=info.provider,
            primary_email=email,
            status=DirectoryAccountStatus.PENDING.value,
            pending_groups=list(config.get(info.groups_key) or []) or None,
            created_by=created_by,
        )
        if _domain_of(email) != domain:
            row.status = DirectoryAccountStatus.FAILED.value
            row.pending_groups = None
            row.last_error = _domain_mismatch(info, domain)
        self.db.add(row)
        return row

    async def _load(
        self,
        organization_id: str,
        *,
        user_id: Optional[str] = None,
        provision_id: Optional[str] = None,
        lock: bool = False,
    ) -> Optional[DirectoryAccountProvision]:
        query = select(DirectoryAccountProvision).where(
            DirectoryAccountProvision.organization_id == str(organization_id)
        )
        if provision_id is not None:
            query = query.where(DirectoryAccountProvision.id == str(provision_id))
        if user_id is not None:
            query = query.where(DirectoryAccountProvision.user_id == str(user_id))
        if lock:
            query = query.with_for_update()
        row: Optional[DirectoryAccountProvision] = (
            await self.db.execute(query)
        ).scalar_one_or_none()
        return row

    async def get_for_user(
        self, user_id: str, organization_id: str
    ) -> Optional[DirectoryAccountProvision]:
        return await self._load(organization_id, user_id=user_id)

    async def _load_member(self, user_id: str, organization_id: str) -> Optional[User]:
        member: Optional[User] = (
            await self.db.execute(
                select(User).where(
                    User.id == str(user_id),
                    User.organization_id == str(organization_id),
                )
            )
        ).scalar_one_or_none()
        return member

    async def _begin_attempt(self, row: DirectoryAccountProvision) -> None:
        """Stamp the attempt and commit, releasing the row lock before the
        directory is called."""
        row.attempts = (row.attempts or 0) + 1
        row.last_attempt_at = datetime.now(timezone.utc)
        await self.db.commit()

    async def provision(
        self, provision_id: str, organization_id: str, *, stamp: bool = True
    ) -> Optional[str]:
        """Create the directory account for a staged row.

        Returns the temporary password when an account was created, for the
        caller to deliver; ``None`` when nothing was created. Never raises for
        a directory failure: the outcome is written to the row.
        """
        row = await self._load(organization_id, provision_id=provision_id, lock=True)
        if row is None or row.status not in (
            DirectoryAccountStatus.PENDING.value,
            DirectoryAccountStatus.FAILED.value,
        ):
            await self.db.commit()
            return None

        info = provider_info(row.provider)
        integration = await self._active_integration(organization_id, info)
        if integration is None:
            row.status = DirectoryAccountStatus.FAILED.value
            row.last_error = _not_connected(info)
            await self.db.commit()
            return None
        domain = str((integration.config or {}).get("domain", "")).lower()
        if _domain_of(row.primary_email) != domain:
            row.status = DirectoryAccountStatus.FAILED.value
            row.last_error = _domain_mismatch(info, domain)
            await self.db.commit()
            return None

        user = await self._load_member(row.user_id, organization_id)
        if user is None:
            await self.db.commit()
            return None
        given_name = (user.first_name or "").strip() or "Member"
        family_name = (user.last_name or "").strip() or "Member"

        if stamp:
            await self._begin_attempt(row)
        else:
            await self.db.commit()
        password = generate_temporary_password()
        created = False
        directory: Optional[DirectoryClient] = None
        try:
            directory = directory_for(integration)
            row.external_user_id = await directory.create_user(
                row.primary_email,
                given_name,
                family_name,
                password,
                member_id=row.user_id,
            )
            row.status = DirectoryAccountStatus.CREATED.value
            row.last_error = None
            created = True
        except DirectoryAccountExistsError:
            assert directory is not None  # only create_user raises this
            created = await self._settle_existing_address(
                row, info, directory, password
            )
        except DirectoryError as exc:
            row.status = DirectoryAccountStatus.FAILED.value
            row.last_error = str(exc)
        except Exception:
            logger.exception(
                f"Unexpected failure creating {info.product} account for "
                f"provision {row.id}"
            )
            row.status = DirectoryAccountStatus.FAILED.value
            row.last_error = f"The {info.product} account creation failed."

        if created:
            await self._finish_setup(row, integration)
        await self.db.commit()
        logger.info(f"{info.product} provisioning for user {row.user_id}: {row.status}")
        return password if created else None

    async def _settle_existing_address(
        self,
        row: DirectoryAccountProvision,
        info: DirectoryProviderInfo,
        directory: DirectoryClient,
        password: str,
    ) -> bool:
        """Decide what an address the directory already holds means for this
        member.

        Returns True when the account turns out to be The Logbook's own --
        tagged at creation with this member's id, from an attempt whose answer
        never arrived -- whose password has then been reset to *password* for
        delivery. An account tagged for a different member, or not tagged, is
        somebody else's and is linked, never reset.

        A directory answers a lookup of an alias with the account that owns
        it, so an address is only treated as the member's when it is that account's
        primary address. Linking an alias would make the member's departure
        suspend somebody else.
        """
        account: Optional[DirectoryAccount]
        try:
            account = await directory.get_user(row.primary_email)
        except DirectoryAccountNotFoundError:
            account = None  # a group holds the address; groups are not users
        except DirectoryError as exc:
            row.status = DirectoryAccountStatus.FAILED.value
            row.last_error = str(exc)
            return False

        if (
            account is None
            or row.primary_email not in account.addresses
            or not account.id
        ):
            row.status = DirectoryAccountStatus.FAILED.value
            row.pending_groups = None
            row.last_error = address_taken_message(info)
            return False

        # One account, one member: a second record would let either member's
        # departure or return suspend or unsuspend the other's account.
        if await self._account_recorded_for_another(row, account.id):
            row.status = DirectoryAccountStatus.FAILED.value
            row.pending_groups = None
            row.last_error = account_in_use_message(info)
            return False

        row.external_user_id = account.id
        row.managed_on_premises = account.managed_elsewhere
        if account.member_id == row.user_id:
            # Ours, from an attempt whose answer never arrived. Nobody holds
            # its password, so it is reset for this attempt to deliver.
            try:
                await directory.reset_password(account.id, password)
            except DirectoryError as exc:
                row.status = DirectoryAccountStatus.CREATED.value
                row.credentials_sent = False
                row.last_error = str(exc)
                return False
            row.status = DirectoryAccountStatus.CREATED.value
            row.last_error = None
            return True

        row.status = DirectoryAccountStatus.LINKED_EXISTING.value
        row.pending_groups = None
        row.last_error = linked_existing_message(info)
        return False

    async def _account_recorded_for_another(
        self, row: DirectoryAccountProvision, external_id: str
    ) -> bool:
        other = await self.db.execute(
            select(DirectoryAccountProvision.id).where(
                DirectoryAccountProvision.organization_id == row.organization_id,
                DirectoryAccountProvision.provider == row.provider,
                DirectoryAccountProvision.external_user_id == external_id,
                DirectoryAccountProvision.user_id != row.user_id,
            )
        )
        return other.first() is not None

    async def _finish_setup(
        self, row: DirectoryAccountProvision, integration: Integration
    ) -> None:
        """License a created account if its directory needs it, then add it to
        the groups it is still missing. Either can fail without undoing the
        other; what is left is on the row for a retry."""
        try:
            directory = directory_for(integration)
        except DirectoryError as exc:
            row.last_error = str(exc)
            return
        license_error: Optional[str] = None
        try:
            await directory.ensure_licensed(_account_key(row))
            row.license_pending = False
        except DirectoryError as exc:
            row.license_pending = True
            license_error = str(exc)
        remaining: list[str] = []
        for group in list(row.pending_groups or []):
            try:
                await directory.add_to_group(str(group), row.primary_email)
            except DirectoryError:
                remaining.append(str(group))
        row.pending_groups = remaining or None
        problems: list[str] = []
        if license_error is not None:
            problems.append(f"its license could not be assigned ({license_error})")
        if remaining:
            problems.append("it could not be added to: " + ", ".join(remaining))
        if problems:
            row.last_error = "The account exists, but " + "; and ".join(problems)

    async def mark_credentials_sent(
        self, provision_id: str, organization_id: str
    ) -> None:
        row = await self._load(organization_id, provision_id=provision_id)
        if row is not None:
            row.credentials_sent = True
            await self.db.commit()

    async def send_credentials_email(
        self, provision_id: str, organization_id: str, password: str
    ) -> bool:
        """Email the temporary password on its own, to the member's personal
        address. Records the delivery on success."""
        from app.services.email_service import EmailService, wrap_email_body

        row = await self._load(organization_id, provision_id=provision_id)
        if row is None:
            return False
        info = provider_info(row.provider)
        user = await self._load_member(row.user_id, organization_id)
        organization = (
            await self.db.execute(
                select(Organization).where(Organization.id == str(organization_id))
            )
        ).scalar_one_or_none()
        # The new mailbox cannot receive its own password.
        recipient = user.personal_email if user is not None else None
        if not recipient:
            row.last_error = (
                "The member has no personal email address to send the "
                f"{info.vendor} password to. Add one, then retry."
            )
            await self.db.commit()
            return False

        name = html.escape((user.first_name or "").strip()) if user else ""
        body = (
            f"        <p>Hello {name},</p>\n"
            f"        <p>A {info.product} account has been created for you. "
            f"{info.vendor} will ask you to choose a new password at your first "
            "sign-in. A new account can take a few minutes before it accepts "
            "a sign-in.</p>\n"
            + facts(
                [
                    [fact("Address", html.escape(row.primary_email), mono=True)],
                    [fact("Temporary password", html.escape(password), mono=True)],
                ],
                panel=True,
            )
            + f"\n        <p>Sign in at {info.sign_in_url}</p>"
        )
        org_name = (organization.name if organization else "") or "The Logbook"
        sent_count, _ = await EmailService(organization).send_email(
            to_emails=[recipient],
            subject=f"Your {org_name} {info.product} account",
            html_body=wrap_email_body(
                organization, f"Your {info.product} account", body
            ),
            text_body=(
                f"Hello {(user.first_name or '').strip() if user else ''},"
                + credentials_text(info, row.primary_email, password)
            ),
            db=self.db,
            template_type=f"{info.audit_prefix}_credentials",
        )
        if sent_count > 0:
            row.credentials_sent = True
            if not row.pending_groups and not row.license_pending:
                row.last_error = None
        else:
            row.last_error = (
                "The account exists, but the email with its temporary password "
                "could not be sent. Retry once email is working."
            )
        await self.db.commit()
        return sent_count > 0

    async def reconcile_suspension(
        self,
        user_id: str,
        organization_id: str,
        *,
        actor_id: Optional[str] = None,
        stamp: bool = True,
    ) -> None:
        """Bring the directory account to the suspension the row wants.

        Never raises: the departure or return it follows is already durable,
        and a failure stays on the row (``suspension_settled`` False) for the
        member profile's retry.
        """
        try:
            await self._reconcile_suspension(user_id, organization_id, actor_id, stamp)
        except Exception:
            logger.exception(
                f"Directory account suspension sync crashed for user {user_id}"
            )
            await self.db.rollback()

    async def _reconcile_suspension(
        self,
        user_id: str,
        organization_id: str,
        actor_id: Optional[str],
        stamp: bool,
    ) -> None:
        from app.core.audit import log_audit_event

        row = await self._load(organization_id, user_id=user_id, lock=True)
        if row is None or row.suspension_settled or row.status not in _SUSPENDABLE:
            await self.db.commit()
            return
        info = provider_info(row.provider)
        integration = await self._active_integration(organization_id, info)
        if integration is None:
            row.suspension_error = (
                f"The {info.product} integration is not connected, so the "
                "account could not be updated."
            )
            await self.db.commit()
            return

        wanted = row.suspension_wanted
        if stamp:
            await self._begin_attempt(row)
        else:
            await self.db.commit()

        outcome = "unchanged"
        try:
            directory = directory_for(integration)
            key = _account_key(row)
            if wanted and not row.suspended_by_logbook:
                if await directory.is_suspended(key):
                    # Someone suspended it in the directory already. Not
                    # ours, so a return will not lift it.
                    outcome = "already_suspended"
                else:
                    await directory.set_suspended(key, True)
                    row.suspended_by_logbook = True
                    row.suspended_at = datetime.now(timezone.utc)
                    outcome = "suspended"
            elif not wanted and row.suspended_by_logbook:
                await directory.set_suspended(key, False)
                row.suspended_by_logbook = False
                row.suspended_at = None
                outcome = "unsuspended"
            row.suspension_settled = True
            row.suspension_error = None
            row.managed_on_premises = False
        except DirectoryAccountNotFoundError as exc:
            # Deleted in the directory: nothing left to suspend or restore.
            row.suspended_by_logbook = False
            row.suspension_settled = True
            row.suspension_error = str(exc)
            outcome = "missing"
        except DirectoryAccountManagedElsewhereError as exc:
            # No call here can ever change it, so it stays unsettled -- the
            # member's profile and the attention list keep saying so -- but
            # the sweep stops retrying. A person disables it where it lives;
            # Retry looks again.
            row.managed_on_premises = True
            row.suspension_error = str(exc)
            outcome = "managed_on_premises"
        except DirectoryError as exc:
            row.suspension_error = str(exc)
            outcome = "failed"
        await self.db.commit()

        await log_audit_event(
            self.db,
            f"{info.audit_prefix}.account_suspension",
            "integrations",
            "warning" if outcome in ("failed", "managed_on_premises") else "info",
            {
                "target_user_id": row.user_id,
                "suspend": wanted,
                "outcome": outcome,
            },
            user_id=actor_id,
            organization_id=str(organization_id),
        )
        await self.db.commit()
        logger.info(f"{info.product} suspension for user {row.user_id}: {outcome}")

    async def link_existing_members(
        self,
        organization_id: str,
        info: DirectoryProviderInfo,
        *,
        apply: bool,
        actor_id: Optional[str],
        expected: Optional[int] = None,
    ) -> dict[str, int]:
        """Bring members who joined before the integration under it.

        A current member whose Logbook email is exactly the primary address of
        an account in the directory's domain gets an "existing account" record,
        so leaving suspends that account. Nothing in the directory is changed.
        Aliases
        and groups are never listed as users, so they never match. Members who
        have already left are counted, not linked: linking them would suspend
        their accounts now, which is a decision this does not make.

        With ``apply`` False nothing is written; the counts preview the run.
        With ``expected`` (the count an officer confirmed), an applied run that
        would link a different number writes nothing: every linked account is
        one The Logbook will later suspend, so the confirmation must cover
        exactly what is linked. Raises ProvisionRetryError with a safe message
        when it cannot run.
        """
        integration = await self._active_integration(organization_id, info)
        if integration is None:
            raise ProvisionRetryError(f"Connect the {info.product} integration first.")
        domain = str((integration.config or {}).get("domain", "")).lower()
        try:
            accounts = await directory_for(integration).list_users(domain)
        except DirectoryError as exc:
            raise ProvisionRetryError(str(exc))
        # Every address an account owns finds it, its primary address ahead
        # of any other: written second, a primary is never overwritten.
        by_address: dict[str, DirectoryAccount] = {}
        for account in accounts:
            if account.id:
                for other in account.other_addresses:
                    by_address[other] = account
        for account in accounts:
            if account.id and account.primary_email:
                by_address[account.primary_email] = account

        records = (
            await self.db.execute(
                select(
                    DirectoryAccountProvision.user_id,
                    DirectoryAccountProvision.status,
                    DirectoryAccountProvision.provider,
                    DirectoryAccountProvision.external_user_id,
                ).where(
                    DirectoryAccountProvision.organization_id == str(organization_id)
                )
            )
        ).all()
        status_by_member = {r.user_id: r.status for r in records}
        claimed = {
            r.external_user_id
            for r in records
            if r.external_user_id and r.provider == info.provider
        }
        member_query = select(User).where(User.organization_id == str(organization_id))
        if apply:
            # A locking read, so a member dropped while this runs is either
            # seen as departed here or waits for this commit -- and then finds
            # the new record for the departure hook to stage. A plain read
            # would answer from the snapshot and link a member who had left.
            member_query = member_query.with_for_update()
        members = (await self.db.execute(member_query)).scalars().all()
        # The key names are the response's, which the screen reads; the
        # Google-era "not_in_google" means "no account in the directory".
        counts = {
            "linked": 0,
            "already_linked": 0,
            "unfinished": 0,
            "departed": 0,
            "not_in_google": 0,
            "off_domain": 0,
            "account_in_use": 0,
        }
        candidates: list[tuple[User, str, DirectoryAccount]] = []
        for member in members:
            recorded_status = status_by_member.get(str(member.id))
            if recorded_status is not None:
                # A record that is not an account in the directory (being
                # created, or failed) is finished from the member's profile, not here.
                key = (
                    "already_linked"
                    if recorded_status in _SUSPENDABLE
                    else "unfinished"
                )
                counts[key] += 1
                continue
            address = (member.email or "").strip().lower()
            if not address or _domain_of(address) != domain:
                counts["off_domain"] += 1
                continue
            match = by_address.get(address)
            if match is None:
                counts["not_in_google"] += 1
                continue
            if member_has_departed(member):
                counts["departed"] += 1
                continue
            candidates.append((member, address, match))
        # One account, one member. Where two members' addresses find the same
        # account (one its sign-in name, the other its mail), neither is
        # linked: choosing would let one member's departure suspend an
        # account the other may be using (owner decision, 2026-10-17).
        matches_per_account: dict[str, int] = {}
        for _, _, match in candidates:
            matches_per_account[match.id] = matches_per_account.get(match.id, 0) + 1
        to_link: list[tuple[User, str, DirectoryAccount]] = []
        for member, address, match in candidates:
            if match.id in claimed or matches_per_account[match.id] > 1:
                counts["account_in_use"] += 1
                continue
            counts["linked"] += 1
            to_link.append((member, address, match))
        if not apply:
            return counts
        if expected is not None and counts["linked"] != expected:
            raise ProvisionRetryError(
                f"The roster changed since the preview: {counts['linked']} "
                f"members would be linked, not {expected}. Review it again."
            )
        for member, address, match in to_link:
            self.db.add(
                DirectoryAccountProvision(
                    organization_id=str(organization_id),
                    user_id=str(member.id),
                    provider=info.provider,
                    primary_email=address,
                    status=DirectoryAccountStatus.LINKED_EXISTING.value,
                    external_user_id=match.id,
                    managed_on_premises=match.managed_elsewhere,
                    created_by=actor_id,
                )
            )
        try:
            await self.db.commit()
        except IntegrityError as exc:
            await self.db.rollback()
            # A conversion recorded one of these members meanwhile, and
            # the unique index on user_id refused the second record.
            # Anything else is not that, and is raised.
            if not _is_duplicate_key(exc):
                raise
            raise ProvisionRetryError(
                "A member was given an account while this ran. Run it again."
            )
        return counts

    async def link_new_member(
        self, user_id: str, organization_id: str, *, actor_id: Optional[str]
    ) -> Optional[DirectoryAccountProvision]:
        """Link a member just added to the account already at their address.

        ``link_existing_members`` for one member and one lookup, under the
        same rules: the Logbook email must be one of the account's own
        addresses in the directory's domain, the member must not have left or
        have a record already, and no other record or member may lay claim to
        the account -- one account, one member. Nothing in the directory is
        changed. Never raises: the member was created whatever happens here,
        and one left unlinked is picked up by Link existing members.
        """
        try:
            return await self._link_new_member(user_id, organization_id, actor_id)
        except Exception:
            logger.exception(f"Linking new member {user_id} to a directory failed")
            await self.db.rollback()
            return None

    async def _link_new_member(
        self, user_id: str, organization_id: str, actor_id: Optional[str]
    ) -> Optional[DirectoryAccountProvision]:
        info = await self.connected_provider(organization_id)
        if info is None:
            return None
        integration = await self._active_integration(organization_id, info)
        member = await self._load_member(user_id, organization_id)
        if integration is None or member is None or member_has_departed(member):
            return None
        if await self._load(organization_id, user_id=user_id) is not None:
            return None
        domain = str((integration.config or {}).get("domain", "")).lower()
        address = (member.email or "").strip().lower()
        if not address or _domain_of(address) != domain:
            return None
        try:
            account = await directory_for(integration).get_user(address)
        except DirectoryAccountNotFoundError:
            return None
        except DirectoryError as exc:
            logger.warning(
                f"{info.product} lookup for new member {user_id} failed: "
                f"{type(exc).__name__}"
            )
            return None
        # A lookup by alias answers with the account that owns the alias:
        # only the account's own addresses make it this member's.
        own = {a.strip().lower() for a in account.addresses if a}
        if not account.id or address not in own:
            return None
        claimed = await self.db.execute(
            select(DirectoryAccountProvision.id).where(
                DirectoryAccountProvision.organization_id == str(organization_id),
                DirectoryAccountProvision.provider == info.provider,
                DirectoryAccountProvision.external_user_id == account.id,
            )
        )
        if claimed.first() is not None:
            return None
        other_member = await self.db.execute(
            select(User.id).where(
                User.organization_id == str(organization_id),
                User.id != str(user_id),
                func.lower(User.email).in_(own),
            )
        )
        if other_member.first() is not None:
            return None
        row = DirectoryAccountProvision(
            organization_id=str(organization_id),
            user_id=str(user_id),
            provider=info.provider,
            primary_email=address,
            status=DirectoryAccountStatus.LINKED_EXISTING.value,
            external_user_id=account.id,
            managed_on_premises=account.managed_elsewhere,
            created_by=actor_id,
        )
        self.db.add(row)
        try:
            await self.db.commit()
        except IntegrityError as exc:
            await self.db.rollback()
            if not _is_duplicate_key(exc):
                raise
            return None  # a record was written for this member meanwhile
        logger.info(f"Linked new member {user_id} to their {info.product} account")
        return row

    async def check_departed_suspensions(self, organization_id: str) -> list[str]:
        """Suspend again any departed member's account found active.

        A suspension The Logbook applied (or found in place) can be lifted in
        the directory's own admin console, and nothing else notices: the sweep
        only revisits records still unsettled. One read-only listing of the
        domain is compared with every departed member whose suspension is
        settled; an account found active again is audit-logged as such and
        suspended once more, through the same path as a departure, so a
        failure is retried by the sweep and shown on the attention list.
        Accounts the directory API cannot change, and accounts no longer in
        the directory, are left alone. Returns the members found active.
        """
        info = await self.connected_provider(organization_id)
        if info is None:
            return []
        integration = await self._active_integration(organization_id, info)
        if integration is None:
            return []
        rows = (
            await self.db.execute(
                select(DirectoryAccountProvision, User)
                .join(User, User.id == DirectoryAccountProvision.user_id)
                .where(
                    DirectoryAccountProvision.organization_id == str(organization_id),
                    User.organization_id == str(organization_id),
                    DirectoryAccountProvision.provider == info.provider,
                    DirectoryAccountProvision.status.in_(SUSPENDABLE_STATUSES),
                    DirectoryAccountProvision.suspension_wanted.is_(True),
                    DirectoryAccountProvision.suspension_settled.is_(True),
                    DirectoryAccountProvision.managed_on_premises.isnot(True),
                )
            )
        ).all()
        departed = [row for row, member in rows if member_has_departed(member)]
        if not departed:
            return []  # nothing to compare: no listing call
        domain = str((integration.config or {}).get("domain", "")).lower()
        try:
            accounts = await directory_for(integration).list_users(domain)
        except DirectoryError as exc:
            logger.warning(
                f"{info.product} departure check for {organization_id} could not "
                f"list accounts: {type(exc).__name__}"
            )
            return []
        by_id = {a.id: a for a in accounts if a.id}
        by_address = {
            address.lower(): a for a in accounts for address in a.addresses if address
        }
        now = datetime.now(timezone.utc)
        found: list[str] = []
        for row in departed:
            # A record that knows its account's id is matched by the id alone:
            # the address may since belong to a different, newer account.
            account = (
                by_id.get(row.external_user_id)
                if row.external_user_id
                else by_address.get((row.primary_email or "").lower())
            )
            if account is None or account.suspended:
                continue
            # Staged exactly as a departure stages it, with the suspension no
            # longer counted as ours: the reconcile below then asks the
            # directory again rather than trusting the record.
            row.suspended_by_logbook = False
            row.suspended_at = None
            row.suspension_settled = False
            row.suspension_requested_at = now
            row.suspension_error = active_after_departure_message(info)
            found.append(str(row.user_id))
        if not found:
            return []
        await self.db.commit()
        from app.core.audit import log_audit_event

        for user_id in found:
            await log_audit_event(
                self.db,
                f"{info.audit_prefix}.{ACTIVE_AFTER_DEPARTURE_EVENT}",
                "integrations",
                "warning",
                {"target_user_id": user_id},
                organization_id=str(organization_id),
            )
        await self.db.commit()
        for user_id in found:
            await self.reconcile_suspension(user_id, organization_id)
        return found

    async def attention_items(
        self, organization_id: str, now: Optional[datetime] = None
    ) -> list[AttentionItem]:
        """Every account in this department that needs a person to act.

        A suspension or unsuspension the directory has not taken yet, an account
        never created, and one created but left unfinished (groups, or a
        password the member never received). A member who has left is listed
        only for their suspension: creating or finishing their account is not
        wanted. Overdue items -- waiting longer than ATTENTION_OVERDUE_AFTER --
        are the ones the daily alert reports. Departures come first, oldest
        first within each issue, because a departed member's working account
        is the risk this list exists to surface.
        """
        now = now or datetime.now(timezone.utc)
        rows = (
            await self.db.execute(
                select(DirectoryAccountProvision, User)
                .join(User, User.id == DirectoryAccountProvision.user_id)
                .where(
                    DirectoryAccountProvision.organization_id == str(organization_id),
                    User.organization_id == str(organization_id),
                )
            )
        ).all()
        items: list[AttentionItem] = []
        for row, member in rows:
            found = _attention_issue(row, member, now)
            if found is None:
                continue
            issue, detail, since = found
            since = _aware(since)
            items.append(
                AttentionItem(
                    user_id=str(member.id),
                    member_name=member.full_name,
                    primary_email=row.primary_email,
                    issue=issue,
                    label=ATTENTION_LABELS[issue],
                    detail=detail,
                    since=since,
                    overdue=since is not None
                    and now - since >= ATTENTION_OVERDUE_AFTER,
                )
            )
        order = [
            AttentionIssue.NOT_SUSPENDED,
            AttentionIssue.NOT_UNSUSPENDED,
            AttentionIssue.NOT_CREATED,
            AttentionIssue.SETUP_UNFINISHED,
        ]
        oldest = datetime.min.replace(tzinfo=timezone.utc)
        items.sort(key=lambda i: (order.index(i.issue), i.since or oldest))
        return items

    async def sync_pending_suspensions(self) -> int:
        """Finish every suspension a departure or return left unsettled.

        The backstop for the after-commit task (a worker that stopped before
        it ran, the directory failing at the time). A row never yet tried runs at
        once; one that failed waits ``SUSPENSION_RETRY_AFTER`` before the next
        attempt, so an outage is not hammered. Returns the rows attempted.
        """
        cutoff = datetime.now(timezone.utc) - SUSPENSION_RETRY_AFTER
        rows = (
            await self.db.execute(
                select(
                    DirectoryAccountProvision.user_id,
                    DirectoryAccountProvision.organization_id,
                ).where(
                    DirectoryAccountProvision.suspension_settled.is_(False),
                    DirectoryAccountProvision.status.in_(SUSPENDABLE_STATUSES),
                    # A block only Active Directory can apply is not retried;
                    # a return (nothing to unblock) still settles here.
                    or_(
                        DirectoryAccountProvision.managed_on_premises.is_(False),
                        DirectoryAccountProvision.suspension_wanted.is_(False),
                    ),
                    or_(
                        DirectoryAccountProvision.suspension_error.is_(None),
                        DirectoryAccountProvision.last_attempt_at.is_(None),
                        DirectoryAccountProvision.last_attempt_at < cutoff,
                    ),
                )
            )
        ).all()
        for user_id, organization_id in rows:
            await self.reconcile_suspension(user_id, organization_id)
        return len(rows)

    async def suspend_detached(
        self,
        organization_id: str,
        provider: str,
        account_key: str,
        actor_id: Optional[str],
    ) -> bool:
        """Suspend an account whose record is already gone (a hard delete).

        Nothing is left to retry from, so the outcome goes to the audit log.
        Never raises.
        """
        from app.core.audit import log_audit_event

        info = provider_info(provider)
        outcome = "failed"
        try:
            integration = await self._active_integration(organization_id, info)
            if integration is None:
                outcome = "not_connected"
            else:
                directory = directory_for(integration)
                if await directory.is_suspended(account_key):
                    outcome = "already_suspended"
                else:
                    await directory.set_suspended(account_key, True)
                    outcome = "suspended"
        except DirectoryAccountNotFoundError:
            outcome = "missing"
        except DirectoryAccountManagedElsewhereError:
            outcome = "managed_on_premises"
        except Exception:
            logger.exception(
                f"Suspending a hard-deleted member's {info.product} account failed"
            )
        try:
            await log_audit_event(
                self.db,
                f"{info.audit_prefix}.account_suspension",
                "integrations",
                # Either way a departed member's account still works and
                # nothing is left to retry it: a person has to act.
                (
                    "critical"
                    if outcome in ("failed", "managed_on_premises")
                    else "info"
                ),
                {"suspend": True, "outcome": outcome, "reason": "member_deleted"},
                user_id=actor_id,
                organization_id=str(organization_id),
            )
            await self.db.commit()
        except Exception:
            logger.exception(
                f"Could not audit a hard-deleted member's {info.product} account"
            )
            await self.db.rollback()
        return outcome in {"suspended", "already_suspended", "missing"}

    async def retry(
        self, user_id: str, organization_id: str
    ) -> DirectoryAccountProvision:
        """Finish whatever is incomplete for one member's account.

        An unsettled suspension is brought into line first. Otherwise a failed
        or pending row creates the account -- unless the member has left -- and
        a created one re-adds any groups that failed and, if the member never
        received the password, resets it and sends a new one. That reset is
        safe only because nobody has signed in with a password nobody
        received. A linked existing account is only ever suspended or
        unsuspended, never otherwise changed.
        """
        row = await self._load(organization_id, user_id=user_id, lock=True)
        if row is None:
            raise LookupError("No directory account record for this member")
        if row.last_attempt_at is not None:
            last = row.last_attempt_at
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) - last < RETRY_COOLDOWN:
                raise ProvisionRetryTooSoon(
                    "This account was worked on moments ago. Wait a minute "
                    "before retrying."
                )

        info = provider_info(row.provider)
        integration = await self._active_integration(organization_id, info)
        if integration is None:
            raise ProvisionRetryError(
                f"Connect the {info.product} integration before retrying."
            )

        if not row.suspension_settled and row.status in _SUSPENDABLE:
            # Stamped and committed while the row is still locked, so a second
            # retry queued on the lock sees this one and stops at the cooldown.
            await self._begin_attempt(row)
            await self.reconcile_suspension(user_id, organization_id, stamp=False)
            return await self._reloaded(row.id, organization_id)

        if row.status == DirectoryAccountStatus.LINKED_EXISTING.value:
            raise ProvisionRetryError(linked_existing_message(info))
        nothing_to_do = (
            row.status == DirectoryAccountStatus.CREATED.value
            and not row.pending_groups
            and not row.license_pending
            and row.credentials_sent
        )
        if nothing_to_do:
            raise ProvisionRetryError(
                f"This {info.vendor} account needs nothing further."
            )
        # Creating an account, resetting its password and adding it to groups
        # all hand something to the member; none of it is for someone who has
        # left. Only the suspension, settled above, still applies to them.
        member = await self._load_member(row.user_id, organization_id)
        if member is None or member_has_departed(member):
            raise ProvisionRetryError(
                f"This member has left the department, so their {info.vendor} "
                "account is not set up any further."
            )

        await self._begin_attempt(row)

        if row.status in (
            DirectoryAccountStatus.PENDING.value,
            DirectoryAccountStatus.FAILED.value,
        ):
            password = await self.provision(row.id, organization_id, stamp=False)
            if password:
                await self.send_credentials_email(row.id, organization_id, password)
        else:
            row.last_error = None
            if row.pending_groups or row.license_pending:
                await self._finish_setup(row, integration)
            if not row.credentials_sent:
                password = generate_temporary_password()
                try:
                    await directory_for(integration).reset_password(
                        _account_key(row), password
                    )
                except DirectoryError as exc:
                    row.last_error = str(exc)
                    password = ""
                await self.db.commit()
                if password:
                    await self.send_credentials_email(row.id, organization_id, password)
            await self.db.commit()

        return await self._reloaded(row.id, organization_id)

    async def _reloaded(
        self, provision_id: str, organization_id: str
    ) -> DirectoryAccountProvision:
        refreshed = await self._load(organization_id, provision_id=provision_id)
        if refreshed is None:
            raise LookupError("No directory account record for this member")
        await self.db.refresh(refreshed)
        return refreshed


def _aware(moment: Optional[datetime]) -> Optional[datetime]:
    # MySQL hands DATETIME back naive; every value here was written in UTC.
    if moment is not None and moment.tzinfo is None:
        return moment.replace(tzinfo=timezone.utc)
    return moment


def _attention_issue(
    row: DirectoryAccountProvision, member: User, now: datetime
) -> Optional[tuple[str, Optional[str], Optional[datetime]]]:
    """(issue, detail, waiting since) for one record, or None if it is fine."""
    if not row.suspension_settled and row.status in _SUSPENDABLE:
        issue = (
            AttentionIssue.NOT_SUSPENDED
            if row.suspension_wanted
            else AttentionIssue.NOT_UNSUSPENDED
        )
        return (
            issue,
            row.suspension_error,
            row.suspension_requested_at or row.updated_at,
        )
    # Waiting is measured from the record's creation, never from the latest
    # attempt: a Retry that fails again must not restart the clock.
    if row.status == DirectoryAccountStatus.PENDING.value:
        attempted = _aware(row.last_attempt_at or row.created_at)
        if attempted is None or now - attempted < STALE_PENDING_AFTER:
            return None  # still in flight
        if member_has_departed(member):
            # The create call may have reached the directory with its answer
            # lost: the departure hook cannot suspend what it has no record of.
            return (
                AttentionIssue.NOT_SUSPENDED,
                unanswered_creation_message(provider_info(row.provider)),
                row.created_at,
            )
        return AttentionIssue.NOT_CREATED, row.last_error, row.created_at
    if member_has_departed(member):
        return None
    if row.status == DirectoryAccountStatus.FAILED.value:
        return AttentionIssue.NOT_CREATED, row.last_error, row.created_at
    if row.status == DirectoryAccountStatus.CREATED.value and (
        row.pending_groups or row.license_pending or not row.credentials_sent
    ):
        if not row.credentials_sent:
            fallback = "The member has not been sent the account's password."
        elif row.license_pending:
            fallback = "The account has no license yet, so it has no mailbox."
        else:
            fallback = "The account is not yet in every group."
        return (
            AttentionIssue.SETUP_UNFINISHED,
            row.last_error or fallback,
            row.created_at,
        )
    return None
