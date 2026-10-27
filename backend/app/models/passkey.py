"""
Passkeys (WebAuthn credentials) used as a member's second factor.

A passkey stands in for the authenticator-app code after the password (or an
SSO sign-in) has been accepted; it never replaces the password. The private
key stays on the member's phone or laptop. This table holds only the public
key the browser handed over at registration, which is not a secret: what it
proves is checked against a fresh, single-use challenge from
``webauthn_challenges``.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, BigInteger, Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


class UserPasskey(Base):
    __tablename__ = "user_passkeys"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    organization_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # The spec allows credential ids up to 1023 bytes, which base64url-encodes
    # past what a MySQL utf8mb4 unique index can cover. Uniqueness is enforced
    # on the digest instead, and the id itself is kept whole for the browser.
    credential_id: Mapped[str] = mapped_column(Text, nullable=False)
    credential_id_hash: Mapped[str] = mapped_column(
        String(64), nullable=False, unique=True, index=True
    )
    public_key: Mapped[str] = mapped_column(Text, nullable=False)
    # The domain the passkey was created for. The browser will only use it on
    # that domain, so one registered before the site moved is kept for the
    # member to see and remove but never counted as a working second factor.
    rp_id: Mapped[str] = mapped_column(String(255), nullable=False)
    # An unsigned 32-bit counter. Passkeys that sync between devices always
    # report 0, so a counter that never moves is normal, not a clone.
    sign_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    transports: Mapped[Optional[list[str]]] = mapped_column(JSON, nullable=True)
    aaguid: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    backed_up: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_used_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class WebAuthnChallenge(Base):
    """A challenge handed to the browser, consumed by the response to it.

    Kept in the database rather than Redis because a challenge must be
    single-use across every worker: without Redis the per-process fallback
    other short-lived values use would let the response land on a worker that
    never issued it, and a member whose only second factor is a passkey would
    be locked out until Redis came back.
    """

    __tablename__ = "webauthn_challenges"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # "register", "login" or "stepup": a challenge issued for one flow cannot
    # be answered in another.
    purpose: Mapped[str] = mapped_column(String(20), nullable=False)
    challenge: Mapped[str] = mapped_column(String(128), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
