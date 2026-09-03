"""
Minting, revoking and authenticating MCP service keys.

A department holds at most one *active* key. Minting a replacement revokes
the previous one in the same transaction, so rotation is a single step and
an old key can never keep working after a new one is handed out.
"""

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from pydantic import ValidationError
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.mcp.constants import (
    KEY_DISPLAY_PREFIX_LEN,
    KEY_PREFIX,
    LAST_USED_THROTTLE_SECONDS,
    MCP_INTEGRATION_TYPE,
)
from app.mcp.principal import McpPrincipal
from app.models.integration import Integration
from app.models.mcp_service_key import McpServiceKey
from app.schemas.integration import ClaudeMcpConfig

# Longest expiry the UI offers; anything beyond it is treated as a request
# for a lifetime key, which is the explicit ``None`` option instead.
MAX_EXPIRY_DAYS = 3650


class McpAuthError(Exception):
    """The presented key is not usable. ``status`` is the HTTP status to send."""

    def __init__(self, message: str, status: int = 401):
        super().__init__(message)
        self.status = status


def generate_key() -> tuple[str, str]:
    """Return ``(plaintext, display_prefix)`` for a brand-new key."""
    plaintext = f"{KEY_PREFIX}{secrets.token_urlsafe(32)}"
    return plaintext, plaintext[:KEY_DISPLAY_PREFIX_LEN]


def hash_key(plaintext: str) -> str:
    return hashlib.sha256(plaintext.encode("utf-8")).hexdigest()


def looks_like_key(candidate: str) -> bool:
    # ``token_urlsafe(32)`` is 43 characters; allow a little slack either way
    # so a future length change does not lock everyone out, while still
    # rejecting junk before it reaches the database.
    return (
        candidate.startswith(KEY_PREFIX)
        and 30 <= len(candidate) - len(KEY_PREFIX) <= 64
        and all(c.isalnum() or c in "-_" for c in candidate[len(KEY_PREFIX) :])
    )


def parse_config(raw: Optional[dict]) -> ClaudeMcpConfig:
    """Read the stored config defensively.

    ``Integration.config`` is unvalidated JSON. A row written by an older or
    newer build must degrade to the defaults — every switch off — rather than
    take the endpoint down (CLAUDE.md pitfall 19).
    """
    try:
        return ClaudeMcpConfig(**(raw or {}))
    except (ValidationError, TypeError):
        return ClaudeMcpConfig()


@dataclass(frozen=True)
class MintedKey:
    plaintext: str
    key: McpServiceKey
    revoked: list[McpServiceKey]


class McpKeyService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_keys(self, organization_id: str) -> list[McpServiceKey]:
        result = await self.db.execute(
            select(McpServiceKey)
            .where(McpServiceKey.organization_id == organization_id)
            .order_by(McpServiceKey.created_at.desc())
        )
        return list(result.scalars().all())

    async def active_keys(
        self, organization_id: str, *, for_update: bool = False
    ) -> list[McpServiceKey]:
        """Keys a client could authenticate with right now: not revoked and
        not past their expiry. The same definition ``authenticate`` applies,
        so the status screen never shows a key the endpoint would refuse."""
        now = datetime.now(timezone.utc)
        query = select(McpServiceKey).where(
            McpServiceKey.organization_id == organization_id,
            McpServiceKey.revoked_at.is_(None),
            or_(McpServiceKey.expires_at.is_(None), McpServiceKey.expires_at > now),
        )
        if for_update:
            query = query.with_for_update()
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def _unrevoked_keys(
        self, organization_id: str, *, for_update: bool = False
    ) -> list[McpServiceKey]:
        """Every key not yet revoked, expired ones included — what a
        rotation retires."""
        query = select(McpServiceKey).where(
            McpServiceKey.organization_id == organization_id,
            McpServiceKey.revoked_at.is_(None),
        )
        if for_update:
            query = query.with_for_update()
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_key(
        self, organization_id: str, key_id: str
    ) -> Optional[McpServiceKey]:
        result = await self.db.execute(
            select(McpServiceKey).where(
                McpServiceKey.id == key_id,
                McpServiceKey.organization_id == organization_id,
            )
        )
        return result.scalar_one_or_none()

    async def mint(
        self,
        organization_id: str,
        *,
        name: str,
        expires_in_days: Optional[int],
        created_by: Optional[str],
    ) -> MintedKey:
        """Create a key and revoke every other active key for the org.

        ``expires_in_days=None`` is a lifetime key. Commits.
        """
        name = name.strip()
        if not name:
            raise ValueError("A key needs a name")
        if expires_in_days is not None and not (
            1 <= expires_in_days <= MAX_EXPIRY_DAYS
        ):
            raise ValueError(
                f"Expiry must be between 1 and {MAX_EXPIRY_DAYS} days, "
                "or omitted for a lifetime key"
            )

        # Two administrators issuing at once must not both end up with a live
        # key (pitfall 27): serialize on the organization's integration row —
        # the one row both requests share — and make the read of the keys to
        # retire a locking read, or it answers from a stale snapshot.
        await self.db.execute(
            select(Integration.id)
            .where(
                Integration.organization_id == organization_id,
                Integration.integration_type == MCP_INTEGRATION_TYPE,
            )
            .with_for_update()
        )
        now = datetime.now(timezone.utc)
        revoked = await self._unrevoked_keys(organization_id, for_update=True)
        for old in revoked:
            old.revoked_at = now
            old.revoked_by = created_by

        plaintext, prefix = generate_key()
        key = McpServiceKey(
            organization_id=organization_id,
            key_hash=hash_key(plaintext),
            key_prefix=prefix,
            name=name[:100],
            expires_at=(
                now + timedelta(days=expires_in_days)
                if expires_in_days is not None
                else None
            ),
            created_by=created_by,
        )
        self.db.add(key)
        await self.db.commit()
        await self.db.refresh(key)
        return MintedKey(plaintext=plaintext, key=key, revoked=revoked)

    async def revoke(
        self, organization_id: str, key_id: str, *, revoked_by: Optional[str]
    ) -> Optional[McpServiceKey]:
        """Revoke one key. Returns None if it does not exist in this org.

        Revoking an already-revoked key is a no-op that still returns it, so a
        double click cannot produce an error toast. Commits.
        """
        key = await self.get_key(organization_id, key_id)
        if key is None:
            return None
        if key.revoked_at is None:
            key.revoked_at = datetime.now(timezone.utc)
            key.revoked_by = revoked_by
            await self.db.commit()
            await self.db.refresh(key)
        return key

    async def authenticate(
        self, presented: str, *, client_ip: Optional[str] = None
    ) -> McpPrincipal:
        """Resolve a bearer value to a principal, or raise ``McpAuthError``.

        Fails closed at every step: an unknown key, a revoked or expired one,
        an organization whose integration row is missing, disabled or not in
        the ``connected`` state (disconnecting sets it back to ``available``
        without deleting anything) all refuse.
        """
        presented = presented.strip()
        if not looks_like_key(presented):
            raise McpAuthError("Invalid service key")

        result = await self.db.execute(
            select(McpServiceKey).where(McpServiceKey.key_hash == hash_key(presented))
        )
        key = result.scalar_one_or_none()
        if key is None:
            raise McpAuthError("Invalid service key")

        now = datetime.now(timezone.utc)
        if key.revoked_at is not None:
            raise McpAuthError("This service key has been revoked")
        if key.expires_at is not None and _as_utc(key.expires_at) <= now:
            raise McpAuthError("This service key has expired")

        integration = await self.db.execute(
            select(Integration).where(
                Integration.organization_id == key.organization_id,
                Integration.integration_type == MCP_INTEGRATION_TYPE,
            )
        )
        row = integration.scalar_one_or_none()
        if row is None or not row.enabled or row.status != "connected":
            raise McpAuthError(
                "The Claude MCP integration is not enabled for this organization. "
                "An administrator can turn it on under Settings → Integrations.",
                status=403,
            )
        config = parse_config(row.config)

        if _last_used_is_stale(key.last_used_at, now):
            key.last_used_at = now
            await self.db.commit()

        return McpPrincipal(
            organization_id=key.organization_id,
            key_id=key.id,
            key_prefix=key.key_prefix,
            issued_by_user_id=key.created_by,
            access_mode=config.access_mode,
            expose_finance=config.expose_finance,
            expose_medical_screening=config.expose_medical_screening,
            client_ip=client_ip,
        )


def _as_utc(value: datetime) -> datetime:
    # MySQL hands back naive datetimes for ``DateTime(timezone=True)`` on
    # some driver configurations; every stored value is UTC.
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _last_used_is_stale(stored: Optional[datetime], now: datetime) -> bool:
    if stored is None:
        return True
    return (now - _as_utc(stored)).total_seconds() >= LAST_USED_THROTTLE_SECONDS
