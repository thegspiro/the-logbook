"""
What the directory-account engine needs from a provider.

The engine (``app/services/directory_account_service.py``) owns the decisions
-- when an account is created, linked, suspended, retried -- and talks to a
department's directory only through :class:`DirectoryClient`. Each provider
module implements that client and describes itself with a
:class:`DirectoryProviderInfo`, whose wording the engine puts into every
message an officer or member reads, so the engine never names a vendor.

Every error a client raises is a :class:`DirectoryError` whose message is
written by the provider module and safe to show an officer; a provider's raw
response, which can echo addresses and request detail, never reaches one.
"""

from dataclasses import dataclass
from typing import TYPE_CHECKING, Callable, Optional, Protocol

if TYPE_CHECKING:
    from app.models.integration import Integration


class DirectoryError(Exception):
    """A failure whose message is safe to show an officer."""


class DirectoryAccountExistsError(DirectoryError):
    """The address already belongs to a user, alias or group."""


class DirectoryAccountNotFoundError(DirectoryError):
    """The account a per-user call names no longer exists."""


class DirectoryAccountManagedElsewhereError(DirectoryError):
    """The account is mastered outside the directory's API (a Microsoft 365
    user synced from on-premises Active Directory), so no call here can
    change it. Retrying cannot help; a person has to act where it lives."""


@dataclass(frozen=True)
class DirectoryAccount:
    """One account as the provider reports it.

    ``primary_email`` is the account's own address, never an alias the lookup
    happened to resolve through: a lookup by alias answers with the account
    that owns it, which is why the engine compares this field before treating
    an address as the member's. ``member_id`` is the Logbook member id the
    account was tagged with at creation, if any.

    ``other_addresses`` are further addresses that are the account's *own*
    and identify it as surely as ``primary_email`` -- Microsoft 365's primary
    mail address where it differs from the sign-in name. Never aliases.
    ``managed_elsewhere`` marks an account the directory's API cannot change.
    """

    id: str
    primary_email: str
    suspended: bool = False
    member_id: Optional[str] = None
    other_addresses: tuple[str, ...] = ()
    managed_elsewhere: bool = False

    @property
    def addresses(self) -> tuple[str, ...]:
        return (self.primary_email, *self.other_addresses)


class DirectoryClient(Protocol):
    async def create_user(
        self,
        primary_email: str,
        given_name: str,
        family_name: str,
        password: str,
        member_id: str,
    ) -> Optional[str]:
        """Create the account, tagged with *member_id*; returns its id."""

    async def list_users(self, domain: str) -> list[DirectoryAccount]:
        """Every user in *domain*. Aliases and groups are not users."""

    async def get_user(self, user_key: str) -> DirectoryAccount:
        """The account *user_key* (an id or an address) resolves to."""

    async def is_suspended(self, user_key: str) -> bool:
        """Whether sign-in to the account is blocked."""

    async def set_suspended(self, user_key: str, suspended: bool) -> None:
        """Block or restore sign-in. Mailbox and license are untouched."""

    async def reset_password(self, user_key: str, password: str) -> None:
        """Set a temporary password the member must change at sign-in."""

    async def add_to_group(self, group: str, member_email: str) -> None:
        """Add the account to *group*; already a member counts as success."""

    async def ensure_licensed(self, user_key: str) -> None:
        """Give the account the license the integration is configured with,
        if it lacks it. A directory that licenses on creation does nothing."""


@dataclass(frozen=True)
class DirectoryProviderInfo:
    """A provider's identity and the words the engine uses for it."""

    # Stored in ``directory_account_provisions.provider``.
    provider: str
    # The ``integrations.integration_type`` that connects it.
    integration_type: str
    # "Google Workspace": the product, as in "the Google Workspace integration".
    product: str
    # "Google": the vendor, as in "a Google account".
    vendor: str
    # Where an administrator manages accounts by hand.
    admin_console: str
    sign_in_url: str
    # Prefix of the audit events and email template types the engine writes.
    audit_prefix: str
    client_for: Callable[["Integration"], DirectoryClient]
    # The config key holding the groups a new account joins.
    groups_key: str = "group_emails"
