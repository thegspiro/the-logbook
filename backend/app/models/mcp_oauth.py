"""
OAuth 2.1 authorization server for the Claude MCP endpoint.

A service key (``mcp_service_key``) acts for the department as a whole. The
tables here let an individual member connect an MCP client — the claude.ai
custom-connector dialog, Claude Desktop, Claude Code — with their *own*
account instead, through the authorization-code flow with PKCE:

* ``McpOAuthClient`` — an MCP client an IT administrator registered for the
  department: its public ``client_id``, its exact redirect URIs and, for a
  confidential client, the SHA-256 digest of its secret. There is no dynamic
  client registration: every client is registered by a person holding
  ``integrations.mcp_keys``.
* ``McpOAuthAuthorization`` — one pass through ``/authorize``: the request the
  consent screen shows, then the one-time code the member's approval issues.
* ``McpOAuthGrant`` — what a member consented to: one row per connection,
  holding the digests of its *current* access and refresh tokens.

Only digests are stored. Every token, code and secret is 32 bytes of CSPRNG
output, so SHA-256 (not a slow hash) is the right tool for the same reason
``mcp_service_key`` gives: nothing to brute-force, and the access-token check
runs on every MCP call.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


class McpOAuthClient(Base):
    __tablename__ = "mcp_oauth_clients"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # The public identifier the client sends. Unique across installations'
    # organizations so the client alone identifies the department it was
    # registered for — the authorization server never takes an organization
    # from the request.
    client_id: Mapped[str] = mapped_column(
        String(64), nullable=False, unique=True, index=True
    )
    # SHA-256 hex digest of the client secret; NULL for a public client,
    # which authenticates with PKCE alone.
    client_secret_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    # Canonical shape: a JSON list of absolute URL strings, compared
    # byte-for-byte with the ``redirect_uri`` a request presents. Validated
    # and normalized to that shape on every write (CLAUDE.md pitfall 20).
    redirect_uris: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    revoked_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revoked_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class McpOAuthGrant(Base):
    __tablename__ = "mcp_oauth_grants"

    # Also the public handle embedded in this grant's tokens, so a presented
    # refresh token names the grant it claims to belong to and a stale one
    # can be recognised as a replay (rather than as an unknown token).
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    client_pk: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("mcp_oauth_clients.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # The consenting member. Their permissions are re-read on every call, so
    # the grant can never do more than they can do now.
    user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Space-separated granted scopes; only ever narrowed after consent.
    scope: Mapped[str] = mapped_column(String(255), nullable=False)
    resource: Mapped[str] = mapped_column(String(500), nullable=False)
    access_token_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    access_expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    refresh_token_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    refresh_expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Absolute end of the connection, however often it refreshes.
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_used_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revoked_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revoked_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Why the grant ended: member, administrator, client, refresh_reuse,
    # code_reuse, client_revoked, password_change, disconnected.
    revoked_reason: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)


class McpOAuthAuthorization(Base):
    __tablename__ = "mcp_oauth_authorizations"

    # Also the handle the consent screen is opened with.
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    client_pk: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("mcp_oauth_clients.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    redirect_uri: Mapped[str] = mapped_column(Text, nullable=False)
    # Requested scopes until the decision; the granted subset after it.
    scope: Mapped[str] = mapped_column(String(255), nullable=False)
    state: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    code_challenge: Mapped[str] = mapped_column(String(128), nullable=False)
    resource: Mapped[str] = mapped_column(String(500), nullable=False)
    # pending → approved | denied; approved → consumed | failed.
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    user_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    code_hash: Mapped[Optional[str]] = mapped_column(
        String(64), nullable=True, unique=True, index=True
    )
    # The pending request's deadline, then the code's once it is issued.
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    decided_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    consumed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # The grant the code was exchanged for, so a replayed code can revoke it
    # (RFC 6749 §4.1.2).
    grant_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("mcp_oauth_grants.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
