"""
Google Workspace account provisioning for newly converted members.

When a department has connected the ``google-workspace`` integration and a
member is converted from an applicant with a department email address, the
conversion stages a :class:`GoogleAccountProvision` row in its own
transaction. After that transaction commits, :meth:`provision` creates the
Google account. A failure never undoes the conversion — the member exists
whatever Google says — and leaves a row an officer can retry from the
member's profile.

Ordering is the point of this module. The Directory API call is an external
side effect that cannot roll back with the database, so it never runs before
the member is durable: creating the account first would leave an orphaned
Google user, holding a license, behind any conversion that then failed.
"""

import html
from datetime import datetime, timedelta, timezone
from typing import Optional

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import generate_temporary_password
from app.models.google_workspace import (
    GOOGLE_WORKSPACE_INTEGRATION,
    GoogleAccountProvision,
    GoogleAccountStatus,
)
from app.models.integration import Integration
from app.models.user import Organization, User, UserStatus
from app.services.email_theme import callout, fact, facts
from app.services.integration_services.google_workspace_service import (
    GoogleAccountExistsError,
    GoogleAccountNotFoundError,
    GoogleWorkspaceError,
    directory_for,
)

# Two retries this close together are a double click, not a decision.
RETRY_COOLDOWN = timedelta(seconds=60)

GOOGLE_SIGN_IN_URL = "https://accounts.google.com/"

LINKED_EXISTING_MESSAGE = (
    "That address already belongs to a Google account, alias or group. The "
    "Logbook has linked the member to it and left it unchanged; manage it in "
    "the Google Admin console."
)


# A member in one of these has left: their account is suspended, and none is
# created for them. Retired is deliberately absent -- a department may let
# retirees keep their address (owner decision, 2026-10-15).
DEPARTED_STATUSES = frozenset(
    {UserStatus.DROPPED_VOLUNTARY, UserStatus.DROPPED_INVOLUNTARY, UserStatus.ARCHIVED}
)

# Accounts that exist in Google, and so can be suspended. A linked existing
# account is suspended too (owner decision, 2026-10-15); only a suspension
# The Logbook applied is ever lifted.
_SUSPENDABLE = frozenset(
    {GoogleAccountStatus.CREATED.value, GoogleAccountStatus.LINKED_EXISTING.value}
)


def suspendable_address(row: Optional[GoogleAccountProvision]) -> Optional[str]:
    """The address to suspend for *row*, when it names an account in Google."""
    if row is None or row.status not in _SUSPENDABLE:
        return None
    return row.primary_email


def member_has_departed(user: User) -> bool:
    return user.deleted_at is not None or user.status in DEPARTED_STATUSES


class ProvisionRetryError(Exception):
    """A retry that cannot run; the message is safe to show."""


class ProvisionRetryTooSoon(ProvisionRetryError):
    pass


def _domain_of(email: str) -> str:
    return email.rsplit("@", 1)[-1].lower()


def google_credentials_html(primary_email: str, password: str) -> str:
    """The card appended to the welcome email. Values are escaped here."""
    return callout(
        "info",
        "Your Google Workspace account",
        "Sign in at "
        f"{GOOGLE_SIGN_IN_URL} as <strong>{html.escape(primary_email)}</strong> "
        f"with the temporary password <code>{html.escape(password)}</code>. "
        "Google will ask you to choose a new password. A new account can take a "
        "few minutes before it accepts a sign-in.",
    )


def google_credentials_text(primary_email: str, password: str) -> str:
    return (
        "\n\nYour Google Workspace account\n"
        f"Sign in at {GOOGLE_SIGN_IN_URL}\n"
        f"Address: {primary_email}\n"
        f"Temporary password: {password}\n"
        "Google will ask you to choose a new password. A new account can take "
        "a few minutes before it accepts a sign-in.\n"
    )


class GoogleWorkspaceProvisioningService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def _active_integration(self, organization_id: str) -> Optional[Integration]:
        integration: Optional[Integration] = (
            await self.db.execute(
                select(Integration).where(
                    Integration.organization_id == str(organization_id),
                    Integration.integration_type == GOOGLE_WORKSPACE_INTEGRATION,
                )
            )
        ).scalar_one_or_none()
        if integration is None or not integration.enabled:
            return None
        if integration.status != "connected":
            return None
        return integration

    async def stage_for_transfer(
        self,
        *,
        organization_id: str,
        user_id: str,
        department_email: Optional[str],
        created_by: Optional[str],
    ) -> Optional[GoogleAccountProvision]:
        """Add a provisioning row to the conversion's transaction, if one applies.

        Nothing is staged without a department address — the applicant's own
        address is not the department's to create — or while the integration
        is not connected.
        """
        if not department_email:
            return None
        integration = await self._active_integration(organization_id)
        if integration is None:
            return None

        config = integration.config or {}
        domain = str(config.get("domain", "")).lower()
        email = department_email.strip().lower()
        row = GoogleAccountProvision(
            organization_id=str(organization_id),
            user_id=str(user_id),
            primary_email=email,
            status=GoogleAccountStatus.PENDING.value,
            pending_groups=list(config.get("group_emails") or []) or None,
            created_by=created_by,
        )
        if _domain_of(email) != domain:
            row.status = GoogleAccountStatus.FAILED.value
            row.pending_groups = None
            row.last_error = (
                f"The member's address is not on the Google Workspace domain "
                f"{domain}. Check the department email settings."
            )
        self.db.add(row)
        return row

    async def _load(
        self,
        organization_id: str,
        *,
        user_id: Optional[str] = None,
        provision_id: Optional[str] = None,
        lock: bool = False,
    ) -> Optional[GoogleAccountProvision]:
        query = select(GoogleAccountProvision).where(
            GoogleAccountProvision.organization_id == str(organization_id)
        )
        if provision_id is not None:
            query = query.where(GoogleAccountProvision.id == str(provision_id))
        if user_id is not None:
            query = query.where(GoogleAccountProvision.user_id == str(user_id))
        if lock:
            query = query.with_for_update()
        row: Optional[GoogleAccountProvision] = (
            await self.db.execute(query)
        ).scalar_one_or_none()
        return row

    async def get_for_user(
        self, user_id: str, organization_id: str
    ) -> Optional[GoogleAccountProvision]:
        return await self._load(organization_id, user_id=user_id)

    async def _begin_attempt(self, row: GoogleAccountProvision) -> None:
        """Stamp the attempt and commit, releasing the row lock before Google."""
        row.attempts = (row.attempts or 0) + 1
        row.last_attempt_at = datetime.now(timezone.utc)
        await self.db.commit()

    async def provision(
        self, provision_id: str, organization_id: str, *, stamp: bool = True
    ) -> Optional[str]:
        """Create the Google account for a staged row.

        Returns the temporary Google password when an account was created, for
        the caller to deliver; ``None`` when nothing was created. Never raises
        for a Google failure: the outcome is written to the row.
        """
        row = await self._load(organization_id, provision_id=provision_id, lock=True)
        if row is None or row.status not in (
            GoogleAccountStatus.PENDING.value,
            GoogleAccountStatus.FAILED.value,
        ):
            await self.db.commit()
            return None

        integration = await self._active_integration(organization_id)
        if integration is None:
            row.status = GoogleAccountStatus.FAILED.value
            row.last_error = "The Google Workspace integration is not connected."
            await self.db.commit()
            return None
        domain = str((integration.config or {}).get("domain", "")).lower()
        if _domain_of(row.primary_email) != domain:
            row.status = GoogleAccountStatus.FAILED.value
            row.last_error = (
                f"The member's address is not on the Google Workspace domain "
                f"{domain}. Check the department email settings."
            )
            await self.db.commit()
            return None

        user = (
            await self.db.execute(
                select(User).where(
                    User.id == row.user_id,
                    User.organization_id == str(organization_id),
                )
            )
        ).scalar_one_or_none()
        if user is None:
            await self.db.commit()
            return None
        given_name = (user.first_name or "").strip() or "Member"
        family_name = (user.last_name or "").strip() or "Member"
        org_unit = str((integration.config or {}).get("org_unit_path") or "/")

        if stamp:
            await self._begin_attempt(row)
        else:
            await self.db.commit()
        password = generate_temporary_password()
        created = False
        try:
            directory = directory_for(integration)
            row.google_user_id = await directory.create_user(
                row.primary_email, given_name, family_name, password, org_unit
            )
            row.status = GoogleAccountStatus.CREATED.value
            row.last_error = None
            created = True
        except GoogleAccountExistsError:
            row.status = GoogleAccountStatus.LINKED_EXISTING.value
            row.pending_groups = None
            row.last_error = LINKED_EXISTING_MESSAGE
        except GoogleWorkspaceError as exc:
            row.status = GoogleAccountStatus.FAILED.value
            row.last_error = str(exc)
        except Exception:
            logger.exception(
                f"Unexpected failure creating Google account for provision {row.id}"
            )
            row.status = GoogleAccountStatus.FAILED.value
            row.last_error = "The Google Workspace account creation failed."

        if created:
            await self._add_pending_groups(row, integration)
        await self.db.commit()
        logger.info(
            f"Google Workspace provisioning for user {row.user_id}: {row.status}"
        )
        return password if created else None

    async def _add_pending_groups(
        self, row: GoogleAccountProvision, integration: Integration
    ) -> None:
        remaining: list[str] = []
        directory = directory_for(integration)
        for group in list(row.pending_groups or []):
            try:
                await directory.add_to_group(str(group), row.primary_email)
            except GoogleWorkspaceError:
                remaining.append(str(group))
        row.pending_groups = remaining or None
        if remaining:
            row.last_error = (
                "The account exists, but it could not be added to: "
                + ", ".join(remaining)
            )

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
        """Email the temporary Google password on its own, to the member's
        personal address. Records the delivery on success."""
        from app.services.email_service import EmailService, wrap_email_body

        row = await self._load(organization_id, provision_id=provision_id)
        if row is None:
            return False
        user = (
            await self.db.execute(
                select(User).where(
                    User.id == row.user_id,
                    User.organization_id == str(organization_id),
                )
            )
        ).scalar_one_or_none()
        organization = (
            await self.db.execute(
                select(Organization).where(Organization.id == str(organization_id))
            )
        ).scalar_one_or_none()
        # The new mailbox cannot receive its own password.
        recipient = user.personal_email if user is not None else None
        if not recipient:
            row.last_error = (
                "The member has no personal email address to send the Google "
                "password to. Add one, then retry."
            )
            await self.db.commit()
            return False

        name = html.escape((user.first_name or "").strip()) if user else ""
        body = (
            f"        <p>Hello {name},</p>\n"
            "        <p>A Google Workspace account has been created for you. "
            "Google will ask you to choose a new password at your first "
            "sign-in. A new account can take a few minutes before it accepts "
            "a sign-in.</p>\n"
            + facts(
                [
                    [fact("Address", html.escape(row.primary_email), mono=True)],
                    [fact("Temporary password", html.escape(password), mono=True)],
                ],
                panel=True,
            )
            + f"\n        <p>Sign in at {GOOGLE_SIGN_IN_URL}</p>"
        )
        org_name = (organization.name if organization else "") or "The Logbook"
        sent_count, _ = await EmailService(organization).send_email(
            to_emails=[recipient],
            subject=f"Your {org_name} Google Workspace account",
            html_body=wrap_email_body(
                organization, "Your Google Workspace account", body
            ),
            text_body=(
                f"Hello {(user.first_name or '').strip() if user else ''},"
                + google_credentials_text(row.primary_email, password)
            ),
            db=self.db,
            template_type="google_workspace_credentials",
        )
        if sent_count > 0:
            row.credentials_sent = True
            if not row.pending_groups:
                row.last_error = None
        else:
            row.last_error = (
                "The account exists, but the email with its temporary password "
                "could not be sent. Retry once email is working."
            )
        await self.db.commit()
        return sent_count > 0

    async def stage_suspension(
        self, user_id: str, organization_id: str, suspended: bool
    ) -> bool:
        """Record, in the caller's transaction, that the account should be
        suspended (or no longer suspended).

        Returns whether there is anything for :meth:`reconcile_suspension` to
        do once the caller commits. Google is never called here: the
        departure it follows has not committed yet.
        """
        row = await self._load(organization_id, user_id=user_id)
        if row is None or row.status not in _SUSPENDABLE:
            return False
        if row.suspension_wanted == suspended and row.suspension_settled:
            return False
        row.suspension_wanted = suspended
        row.suspension_settled = False
        row.suspension_error = None
        return True

    async def reconcile_suspension(
        self,
        user_id: str,
        organization_id: str,
        *,
        actor_id: Optional[str] = None,
        stamp: bool = True,
    ) -> None:
        """Bring the Google account to the suspension the row wants.

        Never raises: the departure or return it follows is already durable,
        and a failure stays on the row (``suspension_settled`` False) for the
        member profile's retry.
        """
        try:
            await self._reconcile_suspension(user_id, organization_id, actor_id, stamp)
        except Exception:
            logger.exception(
                f"Google Workspace suspension sync crashed for user {user_id}"
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
        integration = await self._active_integration(organization_id)
        if integration is None:
            row.suspension_error = (
                "The Google Workspace integration is not connected, so the "
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
            if wanted and not row.suspended_by_logbook:
                if await directory.is_suspended(row.primary_email):
                    # Someone suspended it in Google already. Not ours, so a
                    # return will not lift it.
                    outcome = "already_suspended"
                else:
                    await directory.set_suspended(row.primary_email, True)
                    row.suspended_by_logbook = True
                    row.suspended_at = datetime.now(timezone.utc)
                    outcome = "suspended"
            elif not wanted and row.suspended_by_logbook:
                await directory.set_suspended(row.primary_email, False)
                row.suspended_by_logbook = False
                row.suspended_at = None
                outcome = "unsuspended"
            row.suspension_settled = True
            row.suspension_error = None
        except GoogleAccountNotFoundError as exc:
            # Deleted in Google: there is nothing left to suspend or restore.
            row.suspended_by_logbook = False
            row.suspension_settled = True
            row.suspension_error = str(exc)
            outcome = "missing"
        except GoogleWorkspaceError as exc:
            row.suspension_error = str(exc)
            outcome = "failed"
        await self.db.commit()

        await log_audit_event(
            self.db,
            "google_workspace.account_suspension",
            "integrations",
            "warning" if outcome == "failed" else "info",
            {
                "target_user_id": row.user_id,
                "suspend": wanted,
                "outcome": outcome,
            },
            user_id=actor_id,
            organization_id=str(organization_id),
        )
        await self.db.commit()
        logger.info(f"Google Workspace suspension for user {row.user_id}: {outcome}")

    async def suspend_detached(
        self,
        organization_id: str,
        primary_email: str,
        actor_id: Optional[str],
    ) -> bool:
        """Suspend an account whose record is already gone (a hard delete).

        Nothing is left to retry from, so the outcome goes to the audit log.
        Never raises.
        """
        from app.core.audit import log_audit_event

        outcome = "failed"
        try:
            integration = await self._active_integration(organization_id)
            if integration is None:
                outcome = "not_connected"
            else:
                directory = directory_for(integration)
                if await directory.is_suspended(primary_email):
                    outcome = "already_suspended"
                else:
                    await directory.set_suspended(primary_email, True)
                    outcome = "suspended"
        except GoogleAccountNotFoundError:
            outcome = "missing"
        except Exception:
            logger.exception("Suspending a hard-deleted member's Google account failed")
        try:
            await log_audit_event(
                self.db,
                "google_workspace.account_suspension",
                "integrations",
                "info" if outcome != "failed" else "critical",
                {"suspend": True, "outcome": outcome, "reason": "member_deleted"},
                user_id=actor_id,
                organization_id=str(organization_id),
            )
            await self.db.commit()
        except Exception:
            logger.exception("Could not audit a hard-deleted member's Google account")
            await self.db.rollback()
        return outcome in {"suspended", "already_suspended", "missing"}

    async def retry(self, user_id: str, organization_id: str) -> GoogleAccountProvision:
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
            raise LookupError("No Google Workspace account record for this member")
        if row.last_attempt_at is not None:
            last = row.last_attempt_at
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) - last < RETRY_COOLDOWN:
                raise ProvisionRetryTooSoon(
                    "This account was worked on moments ago. Wait a minute "
                    "before retrying."
                )

        integration = await self._active_integration(organization_id)
        if integration is None:
            raise ProvisionRetryError(
                "Connect the Google Workspace integration before retrying."
            )

        if not row.suspension_settled and row.status in _SUSPENDABLE:
            # Stamped and committed while the row is still locked, so a second
            # retry queued on the lock sees this one and stops at the cooldown.
            await self._begin_attempt(row)
            await self.reconcile_suspension(user_id, organization_id, stamp=False)
            return await self._reloaded(row.id, organization_id)

        if row.status == GoogleAccountStatus.LINKED_EXISTING.value:
            raise ProvisionRetryError(LINKED_EXISTING_MESSAGE)
        nothing_to_do = (
            row.status == GoogleAccountStatus.CREATED.value
            and not row.pending_groups
            and row.credentials_sent
        )
        if nothing_to_do:
            raise ProvisionRetryError("This Google account needs nothing further.")
        if row.status in (
            GoogleAccountStatus.PENDING.value,
            GoogleAccountStatus.FAILED.value,
        ):
            member = (
                await self.db.execute(
                    select(User).where(
                        User.id == row.user_id,
                        User.organization_id == str(organization_id),
                    )
                )
            ).scalar_one_or_none()
            if member is None or member_has_departed(member):
                raise ProvisionRetryError(
                    "This member has left the department, so no Google account "
                    "will be created for them."
                )

        await self._begin_attempt(row)

        if row.status in (
            GoogleAccountStatus.PENDING.value,
            GoogleAccountStatus.FAILED.value,
        ):
            password = await self.provision(row.id, organization_id, stamp=False)
            if password:
                await self.send_credentials_email(row.id, organization_id, password)
        else:
            row.last_error = None
            if row.pending_groups:
                await self._add_pending_groups(row, integration)
            if not row.credentials_sent:
                password = generate_temporary_password()
                try:
                    await directory_for(integration).reset_password(
                        row.primary_email, password
                    )
                except GoogleWorkspaceError as exc:
                    row.last_error = str(exc)
                    password = ""
                await self.db.commit()
                if password:
                    await self.send_credentials_email(row.id, organization_id, password)
            await self.db.commit()

        return await self._reloaded(row.id, organization_id)

    async def _reloaded(
        self, provision_id: str, organization_id: str
    ) -> GoogleAccountProvision:
        refreshed = await self._load(organization_id, provision_id=provision_id)
        if refreshed is None:
            raise LookupError("No Google Workspace account record for this member")
        await self.db.refresh(refreshed)
        return refreshed
