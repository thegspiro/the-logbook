"""
Claude MCP service keys.

One organization-level credential lets an MCP client (Claude Code, Claude
Desktop, the Messages API connector) reach this installation's MCP endpoint.
There is no per-member identity behind a call: the key acts for the
department as a whole, which is why minting one is reserved for the
``integrations.mcp_keys`` permission rather than ``integrations.manage``.

The plaintext key is shown exactly once, at creation. Only its SHA-256 digest
is stored. A slow hash (bcrypt, as the public portal uses) is deliberately not
used here: the key is 32 bytes of CSPRNG output, so a digest cannot be
brute-forced from the hash, and every MCP tool call is one HTTP request that
must verify the key — a bcrypt round per call would cost more CPU than the
tool call itself.
"""

from sqlalchemy import Column, DateTime, ForeignKey, String
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


class McpServiceKey(Base):
    __tablename__ = "mcp_service_keys"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # SHA-256 hex digest of the plaintext key. Unique so the by-hash lookup
    # during authentication returns at most one candidate.
    key_hash = Column(String(64), nullable=False, unique=True, index=True)
    # First characters of the plaintext key, shown in the UI so an
    # administrator can tell which key a client is configured with.
    key_prefix = Column(String(24), nullable=False)
    name = Column(String(100), nullable=False)
    # NULL means the key never expires ("lifetime").
    expires_at = Column(DateTime(timezone=True), nullable=True)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    # Set when an administrator revokes the key or mints its replacement.
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    revoked_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_by = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    @property
    def is_active(self) -> bool:
        return self.revoked_at is None
