"""
NFC Tag Service

Issues, revokes and resolves the NFC credentials embedded in member ID cards,
and turns a tap at a check-in station into attendance on a shift, an event (a
meeting is an event) or an admin hours category.

Why the check-in dispatch lives here rather than in each module's service: the
station is one screen with one reader, and the three modules already own three
different attendance shapes (a ShiftAttendance row, an EventRSVP, an open
AdminHoursEntry). This translates a tap into whichever of those the operator
selected, so a fourth target is an entry in one table below rather than a
fourth station.
"""

import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_encryption_salt
from app.models.admin_hours import AdminHoursEntryMethod
from app.models.event import Event, EventRSVP
from app.models.nfc_tag import NfcCredentialType, NfcTag, NfcTagStatus
from app.models.user import User, UserStatus
from app.schemas.nfc_tag import (
    NfcCheckInDirection,
    NfcCheckInStatus,
    NfcCheckInTarget,
)
from app.services.admin_hours_service import AdminHoursService
from app.services.event_service import (
    ATTENDANCE_LOCKED_PREFIX,
    PHASE_GATE_PREFIX,
    EventService,
)
from app.services.scheduling_service import SchedulingService
from app.utils.model_updates import apply_updates
from app.utils.org_scoping import assert_in_org

# Card states that are the end of that card's life. Reporting a card lost is a
# statement about the physical world — somebody else may be holding it — which
# reactivating cannot undo, and revocation is a decision that should be revisited
# by issuing a new card rather than by quietly restoring the old one.
_TERMINAL_CARD_STATUSES = {NfcTagStatus.LOST, NfcTagStatus.REVOKED}

# A second tap this soon after the first is a bounce — a card held against the
# reader a beat too long, or a member who tapped, did not see the screen, and
# tapped again. Reading it as "check out" would close an arrival that is
# seconds old and record a zero-minute shift, so within this window the station
# reports the state instead of inverting it.
MIN_TOGGLE_SECONDS = 60

# Members whose card must stop working even though the record still exists.
# Mirrors ``User.is_active`` (status ACTIVE and not deleted) apart from two
# deliberate exceptions: a retired or on-leave member keeps a working card,
# because they still attend meetings and banquets, which is exactly what a
# station records. INACTIVE carries no such meaning — it is the plain "not an
# active member" state — so a card must not go on recording attendance for one.
_BLOCKED_MEMBER_STATUSES = {
    UserStatus.INACTIVE,
    UserStatus.SUSPENDED,
    UserStatus.DROPPED_VOLUNTARY,
    UserStatus.DROPPED_INVOLUNTARY,
    UserStatus.ARCHIVED,
}


def normalize_tag_uid(raw_uid: str) -> str:
    """Reduce a card credential to one canonical form.

    The same card reads back differently depending on what read it: Web NFC
    returns ``04:a2:24:...`` lowercase with colons, most USB readers type
    ``04A224...`` bare, and some emit dashes. Without normalization a card
    registered on a phone would not be recognised by the desk reader, which
    presents as "my card stopped working" with nothing in any log to explain
    it.
    """
    return "".join(c for c in raw_uid if c.isalnum()).upper()


def hash_tag_uid(raw_uid: str) -> str:
    """Hash a card serial for storage and lookup.

    Peppered with the installation's encryption salt so the hashes are not
    portable: a table lifted from one deployment cannot be matched against
    cards read anywhere else, and the space of card UIDs is small enough
    (32-80 bits, structured) that an unpeppered SHA-256 would be trivially
    enumerable.
    """
    normalized = normalize_tag_uid(raw_uid)
    return hashlib.sha256(
        get_encryption_salt() + b":nfc:" + normalized.encode()
    ).hexdigest()


def uid_preview(raw_uid: str) -> str:
    """Last four characters of the serial, for telling two cards apart."""
    return normalize_tag_uid(raw_uid)[-4:]


class NfcTagService:
    """Business logic for member ID card credentials."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # =========================================================================
    # Card management
    # =========================================================================

    async def list_tags(
        self,
        organization_id: str,
        *,
        user_id: Optional[str] = None,
        status: Optional[NfcTagStatus] = None,
    ) -> Tuple[List[Dict[str, Any]], int]:
        """List cards in the organization, newest first."""
        query = select(NfcTag).where(NfcTag.organization_id == str(organization_id))
        if user_id:
            query = query.where(NfcTag.user_id == str(user_id))
        if status:
            query = query.where(NfcTag.status == status)

        result = await self.db.execute(query.order_by(NfcTag.issued_at.desc()))
        tags = list(result.scalars().all())

        names = await self._name_map(
            organization_id,
            {t.user_id for t in tags} | {t.issued_by for t in tags if t.issued_by},
        )
        items = [self._to_dict(tag, names) for tag in tags]
        return items, len(items)

    async def get_tag(self, tag_id: str, organization_id: str) -> Optional[NfcTag]:
        """Fetch one card, org-scoped (XC-3: the permission does not scope it)."""
        result = await self.db.execute(
            select(NfcTag).where(
                NfcTag.id == str(tag_id),
                NfcTag.organization_id == str(organization_id),
            )
        )
        return result.scalar_one_or_none()

    async def register_tag(
        self,
        *,
        organization_id: str,
        user_id: str,
        tag_uid: str,
        label: Optional[str],
        issued_by: Optional[str],
        credential_type: NfcCredentialType = NfcCredentialType.SERIAL,
    ) -> Dict[str, Any]:
        """Bind a physical card to a member, on an officer's authority.

        Raises ``ValueError`` (→ 400) for a member outside the organization or
        a card already issued to somebody.
        """
        await assert_in_org(self.db, User, user_id, organization_id, label="Member")

        uid_hash = hash_tag_uid(tag_uid)
        existing = (
            await self.db.execute(
                select(NfcTag).where(
                    NfcTag.organization_id == str(organization_id),
                    NfcTag.uid_hash == uid_hash,
                )
            )
        ).scalar_one_or_none()

        if existing:
            # Naming the current holder would let anyone with card-issuing
            # rights turn a pile of found cards into a staff directory, so the
            # message says what to do rather than who has it.
            if existing.user_id == str(user_id):
                raise ValueError("This card is already registered to this member.")
            raise ValueError(
                "This card is already registered to another member. "
                "Revoke the existing registration before reissuing it."
            )

        tag = NfcTag(
            organization_id=str(organization_id),
            user_id=str(user_id),
            uid_hash=uid_hash,
            uid_preview=uid_preview(tag_uid),
            label=label,
            status=NfcTagStatus.ACTIVE,
            credential_type=credential_type,
            issued_by=str(issued_by) if issued_by else None,
        )
        self.db.add(tag)
        await self.db.flush()
        await self.db.refresh(tag)

        names = await self._name_map(organization_id, {tag.user_id, tag.issued_by})
        return self._to_dict(tag, names)

    async def update_tag(
        self, tag_id: str, organization_id: str, updates: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Update a card's label or lifecycle state."""
        tag = await self.get_tag(tag_id, organization_id)
        if not tag:
            raise ValueError("Card not found")

        new_status = updates.get("status")
        # Any move *out* of a terminal state, not just a direct jump back to
        # active. Rejecting only `lost -> active` left the invariant one hop
        # wide open: `lost -> suspended` and then `suspended -> active` restores
        # exactly the credential somebody else may be holding. A card whose
        # status is unchanged still passes, so relabelling a lost card works.
        if (
            new_status is not None
            and new_status != tag.status
            and tag.status in _TERMINAL_CARD_STATUSES
        ):
            raise ValueError(
                f"A card marked {tag.status.value} cannot be reactivated or "
                "reclassified. Issue a replacement card instead."
            )

        apply_updates(tag, updates, skip={"organization_id", "id", "user_id"})

        # Stamping the revocation here rather than asking the caller to send it
        # keeps "when did this card stop working" answerable from the row
        # itself, whichever screen revoked it.
        if new_status is not None and new_status != NfcTagStatus.ACTIVE:
            if tag.revoked_at is None:
                tag.revoked_at = datetime.now(timezone.utc)
        elif new_status == NfcTagStatus.ACTIVE:
            tag.revoked_at = None
            tag.revoked_reason = None

        await self.db.flush()
        await self.db.refresh(tag)
        names = await self._name_map(organization_id, {tag.user_id, tag.issued_by})
        return self._to_dict(tag, names)

    async def delete_tag(self, tag_id: str, organization_id: str) -> bool:
        """Delete a card registration outright.

        Kept alongside revocation because the two answer different needs: a
        revoked card stays on the member's record as history, a mis-scanned one
        registered to the wrong person should leave no trace on them at all.
        """
        tag = await self.get_tag(tag_id, organization_id)
        if not tag:
            return False
        await self.db.delete(tag)
        await self.db.flush()
        return True

    # =========================================================================
    # Resolution
    # =========================================================================

    async def resolve_tag(
        self, organization_id: str, candidates: Sequence[Optional[str]]
    ) -> Tuple[Optional[NfcTag], Optional[User], Optional[NfcCheckInStatus]]:
        """Resolve the identifiers read off a tag to (tag, member, refusal).

        ``candidates`` is tried in order, so callers put the deliberate binding
        first: a code an officer wrote onto a blank tag beats the chip serial
        underneath it, which may well have been registered to somebody else
        before the tag was reused.

        The third element is set when the card resolves but must not act:
        ``UNKNOWN_CARD``, ``CARD_INACTIVE`` or ``MEMBER_INACTIVE``. It is None
        exactly when both tag and user are usable.
        """
        tag: Optional[NfcTag] = None
        for candidate in candidates:
            if not candidate or not candidate.strip():
                continue
            tag = (
                await self.db.execute(
                    select(NfcTag).where(
                        NfcTag.organization_id == str(organization_id),
                        NfcTag.uid_hash == hash_tag_uid(candidate),
                    )
                )
            ).scalar_one_or_none()
            if tag:
                break

        if not tag:
            return None, None, NfcCheckInStatus.UNKNOWN_CARD
        if tag.status != NfcTagStatus.ACTIVE:
            return tag, None, NfcCheckInStatus.CARD_INACTIVE

        user = (
            await self.db.execute(
                select(User).where(
                    User.id == tag.user_id,
                    User.organization_id == str(organization_id),
                )
            )
        ).scalar_one_or_none()

        if not user or user.deleted_at or user.status in _BLOCKED_MEMBER_STATUSES:
            return tag, user, NfcCheckInStatus.MEMBER_INACTIVE
        return tag, user, None

    # =========================================================================
    # Check-in station
    # =========================================================================

    async def check_in(
        self,
        *,
        organization_id: str,
        tag_uid: str,
        target_type: NfcCheckInTarget,
        target_id: str,
        direction: NfcCheckInDirection = NfcCheckInDirection.AUTO,
        tag_payload: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Record a tap. Never raises for a domain outcome — see the schema."""
        tag, user, refusal = await self.resolve_tag(
            organization_id, (tag_payload, tag_uid)
        )

        if refusal == NfcCheckInStatus.UNKNOWN_CARD:
            return self._result(
                NfcCheckInStatus.UNKNOWN_CARD,
                "This card is not registered. Ask an officer to add it to your "
                "member record.",
            )
        if refusal == NfcCheckInStatus.CARD_INACTIVE:
            status_word = tag.status.value if tag else "inactive"
            return self._result(
                NfcCheckInStatus.CARD_INACTIVE,
                f"This card has been marked {status_word} and no longer works. "
                "Ask an officer to issue a replacement.",
            )
        if refusal == NfcCheckInStatus.MEMBER_INACTIVE or user is None:
            return self._result(
                NfcCheckInStatus.MEMBER_INACTIVE,
                "This card belongs to a member who is not currently active.",
            )

        if target_type == NfcCheckInTarget.SHIFT:
            result = await self._check_in_shift(
                organization_id, user, target_id, direction
            )
        elif target_type == NfcCheckInTarget.EVENT:
            result = await self._check_in_event(
                organization_id, user, target_id, direction
            )
        else:
            result = await self._check_in_admin_hours(
                organization_id, user, target_id, direction
            )

        result.setdefault("user_id", str(user.id))
        result.setdefault("member_name", user.full_name)
        result.setdefault("membership_number", user.membership_number)

        # Only a tap that actually moved attendance counts as use. Stamping on
        # a refusal too would make "last used" mean "last waved at a reader",
        # which is not what a card audit is looking for.
        if tag and result["status"] in (
            NfcCheckInStatus.CHECKED_IN,
            NfcCheckInStatus.CHECKED_OUT,
        ):
            tag.last_used_at = datetime.now(timezone.utc)
            await self.db.flush()

        return result

    async def _check_in_shift(
        self,
        organization_id: str,
        user: User,
        shift_id: str,
        direction: NfcCheckInDirection,
    ) -> Dict[str, Any]:
        service = SchedulingService(self.db)
        shift = await service.get_shift_by_id(shift_id, organization_id)
        if not shift:
            raise ValueError("Shift not found")

        target_name = await self._shift_label(service, shift, organization_id)
        attendance = await service.get_my_attendance(
            shift_id, str(user.id), organization_id
        )
        checked_in_at = attendance.checked_in_at if attendance else None
        checked_out_at = attendance.checked_out_at if attendance else None

        resolved = self._resolve_direction(direction, checked_in_at, checked_out_at)
        if isinstance(resolved, dict):
            return {**resolved, "target_name": target_name}

        if resolved == NfcCheckInDirection.IN:
            record, error = await service.member_check_in(
                shift_id=shift_id,
                user_id=str(user.id),
                organization_id=organization_id,
            )
            if not record:
                return self._result(
                    NfcCheckInStatus.REFUSED,
                    error or "Unable to check in.",
                    target_name=target_name,
                )
            return self._result(
                NfcCheckInStatus.CHECKED_IN,
                f"Checked in to {target_name}.",
                target_name=target_name,
                occurred_at=record.checked_in_at,
            )

        record, error = await service.member_check_out(
            shift_id=shift_id,
            user_id=str(user.id),
            organization_id=organization_id,
        )
        if not record:
            return self._result(
                NfcCheckInStatus.REFUSED,
                error or "Unable to check out.",
                target_name=target_name,
            )
        return self._result(
            NfcCheckInStatus.CHECKED_OUT,
            f"Checked out of {target_name}.",
            target_name=target_name,
            occurred_at=record.checked_out_at,
            duration_minutes=record.duration_minutes,
        )

    async def _check_in_event(
        self,
        organization_id: str,
        user: User,
        event_id: str,
        direction: NfcCheckInDirection,
    ) -> Dict[str, Any]:
        event = (
            await self.db.execute(
                select(Event).where(
                    Event.id == str(event_id),
                    Event.organization_id == str(organization_id),
                )
            )
        ).scalar_one_or_none()
        if not event:
            raise ValueError("Event not found")

        target_name = event.title or "Event"
        rsvp = (
            await self.db.execute(
                select(EventRSVP).where(
                    EventRSVP.event_id == str(event_id),
                    EventRSVP.user_id == str(user.id),
                )
            )
        ).scalar_one_or_none()

        resolved = self._resolve_direction(
            direction,
            rsvp.checked_in_at if rsvp else None,
            rsvp.checked_out_at if rsvp else None,
        )
        if isinstance(resolved, dict):
            return {**resolved, "target_name": target_name}

        is_checkout = resolved == NfcCheckInDirection.OUT
        service = EventService(self.db)
        record, error, _notice = await service.self_check_in(
            event_id=event_id,
            user_id=str(user.id),
            organization_id=organization_id,
            is_checkout=is_checkout,
        )

        if error == "ALREADY_CHECKED_IN":
            return self._result(
                NfcCheckInStatus.ALREADY_CHECKED_IN,
                f"Already checked in to {target_name}.",
                target_name=target_name,
                occurred_at=record.checked_in_at if record else None,
            )
        if error:
            # A training-pipeline phase warning is overridable by the member on
            # their own screen, where they can read it and decide. A station
            # has nobody to ask, and silently overriding a gate an officer set
            # is the wrong default — so it is reported and handled off-station.
            if error.startswith(PHASE_GATE_PREFIX):
                return self._result(
                    NfcCheckInStatus.REFUSED,
                    error[len(PHASE_GATE_PREFIX) :]
                    + " Check this member in from the event screen.",
                    target_name=target_name,
                )
            # Sentinel prefixes are for the HTTP layer; a station reader shows
            # the sentence to whoever is standing at it.
            if error.startswith(ATTENDANCE_LOCKED_PREFIX):
                error = error[len(ATTENDANCE_LOCKED_PREFIX) :]
            return self._result(
                NfcCheckInStatus.REFUSED, error, target_name=target_name
            )

        if is_checkout:
            return self._result(
                NfcCheckInStatus.CHECKED_OUT,
                f"Checked out of {target_name}.",
                target_name=target_name,
                occurred_at=record.checked_out_at if record else None,
                duration_minutes=(
                    record.attendance_duration_minutes if record else None
                ),
            )
        return self._result(
            NfcCheckInStatus.CHECKED_IN,
            f"Checked in to {target_name}.",
            target_name=target_name,
            occurred_at=record.checked_in_at if record else None,
        )

    async def _check_in_admin_hours(
        self,
        organization_id: str,
        user: User,
        category_id: str,
        direction: NfcCheckInDirection,
    ) -> Dict[str, Any]:
        service = AdminHoursService(self.db)
        category = await service.get_category(category_id, organization_id)
        if not category:
            raise ValueError("Admin hours category not found")

        target_name = category.name
        active = await service.get_active_session(str(user.id), organization_id)
        in_this_category = bool(active and active["category_id"] == str(category_id))

        # An open session in a *different* category is not a state this station
        # can resolve: clocking out of it would credit hours to the wrong
        # category, and clocking in would open a second concurrent session the
        # service refuses anyway.
        if active and not in_this_category:
            return self._result(
                NfcCheckInStatus.REFUSED,
                f"Already clocked in to {active['category_name']}. "
                "Clock out of that first.",
                target_name=target_name,
            )

        clock_in_at = active["clock_in_at"] if in_this_category else None
        resolved = self._resolve_direction(direction, clock_in_at, None)
        if isinstance(resolved, dict):
            return {**resolved, "target_name": target_name}

        try:
            if resolved == NfcCheckInDirection.IN:
                entry = await service.clock_in(
                    category_id=str(category_id),
                    user_id=str(user.id),
                    organization_id=str(organization_id),
                    entry_method=AdminHoursEntryMethod.NFC_STATION,
                )
                return self._result(
                    NfcCheckInStatus.CHECKED_IN,
                    f"Clocked in to {target_name}.",
                    target_name=target_name,
                    occurred_at=entry.clock_in_at,
                )
            entry = await service.clock_out_by_category(
                category_id=str(category_id),
                user_id=str(user.id),
                organization_id=str(organization_id),
            )
            return self._result(
                NfcCheckInStatus.CHECKED_OUT,
                f"Clocked out of {target_name}.",
                target_name=target_name,
                occurred_at=entry.clock_out_at,
                duration_minutes=entry.duration_minutes,
            )
        except ValueError as exc:
            message = str(exc)
            if message == "ALREADY_CLOCKED_IN":
                return self._result(
                    NfcCheckInStatus.ALREADY_CHECKED_IN,
                    f"Already clocked in to {target_name}.",
                    target_name=target_name,
                    occurred_at=clock_in_at,
                )
            return self._result(
                NfcCheckInStatus.REFUSED, message, target_name=target_name
            )

    # =========================================================================
    # Internals
    # =========================================================================

    @staticmethod
    async def _shift_label(
        service: SchedulingService, shift: Any, organization_id: str
    ) -> str:
        """Name a shift the way the station's operator would say it out loud.

        A shift row has no title — it is identified by the apparatus on it and
        the day it runs — so a bare "Shift" on the confirmation screen would
        leave an operator running two stations unable to tell which board they
        just wrote to.
        """
        apparatus_name = None
        if shift.apparatus_id:
            apparatus_map = await service._get_apparatus_map(
                organization_id, [shift.apparatus_id]
            )
            apparatus = apparatus_map.get(shift.apparatus_id)
            if apparatus:
                apparatus_name = apparatus.unit_number or apparatus.name
        parts = [p for p in (apparatus_name, shift.platoon) if p]
        if shift.shift_date:
            parts.append(shift.shift_date.isoformat())
        return " · ".join(parts) if parts else "Shift"

    def _resolve_direction(
        self,
        direction: NfcCheckInDirection,
        checked_in_at: Optional[datetime],
        checked_out_at: Optional[datetime],
    ) -> Any:
        """Decide in/out for this tap, or return a finished result dict.

        Returns either an ``NfcCheckInDirection`` to act on, or a result dict
        when the tap resolves to a statement about the current state (a bounce,
        or a card tapped again after the member already left).
        """
        if direction == NfcCheckInDirection.IN:
            if checked_in_at and not checked_out_at:
                return self._result(
                    NfcCheckInStatus.ALREADY_CHECKED_IN,
                    "Already checked in.",
                    occurred_at=checked_in_at,
                )
            return NfcCheckInDirection.IN

        if direction == NfcCheckInDirection.OUT:
            if checked_out_at:
                return self._result(
                    NfcCheckInStatus.ALREADY_CHECKED_OUT,
                    "Already checked out.",
                    occurred_at=checked_out_at,
                )
            return NfcCheckInDirection.OUT

        # AUTO
        if checked_out_at:
            return self._result(
                NfcCheckInStatus.ALREADY_CHECKED_OUT,
                "Already checked out for this one.",
                occurred_at=checked_out_at,
            )
        if not checked_in_at:
            return NfcCheckInDirection.IN

        since = datetime.now(timezone.utc) - _as_utc(checked_in_at)
        if since < timedelta(seconds=MIN_TOGGLE_SECONDS):
            return self._result(
                NfcCheckInStatus.ALREADY_CHECKED_IN,
                "Already checked in just now.",
                occurred_at=checked_in_at,
            )
        return NfcCheckInDirection.OUT

    @staticmethod
    def _result(
        status: NfcCheckInStatus,
        message: str,
        *,
        target_name: Optional[str] = None,
        occurred_at: Optional[datetime] = None,
        duration_minutes: Optional[int] = None,
    ) -> Dict[str, Any]:
        return {
            "status": status,
            "message": message,
            "target_name": target_name,
            "occurred_at": occurred_at,
            "duration_minutes": duration_minutes,
        }

    async def _name_map(self, organization_id: str, user_ids: set) -> Dict[str, str]:
        """Look up display names for a set of ids the caller already knows are
        in this org (drawn from an org-scoped ``NfcTag`` row's ``user_id`` /
        ``issued_by``, never a client-supplied id directly) — the org filter
        here is defense-in-depth on the query itself, per CLAUDE.md Pitfall
        #14a, rather than the only thing standing between this and a leak.
        """
        ids = {str(u) for u in user_ids if u}
        if not ids:
            return {}
        result = await self.db.execute(
            select(User.id, User.first_name, User.last_name).where(
                User.id.in_(ids),
                User.organization_id == str(organization_id),
            )
        )
        return {
            row.id: f"{row.first_name or ''} {row.last_name or ''}".strip()
            for row in result
        }

    @staticmethod
    def _to_dict(tag: NfcTag, names: Dict[str, str]) -> Dict[str, Any]:
        return {
            "id": tag.id,
            "organization_id": tag.organization_id,
            "user_id": tag.user_id,
            "uid_preview": tag.uid_preview,
            "credential_type": tag.credential_type,
            "label": tag.label,
            "status": tag.status,
            "issued_at": tag.issued_at,
            "last_used_at": tag.last_used_at,
            "revoked_at": tag.revoked_at,
            "revoked_reason": tag.revoked_reason,
            "issued_by": tag.issued_by,
            "created_at": tag.created_at,
            "updated_at": tag.updated_at,
            "member_name": names.get(tag.user_id),
            "issued_by_name": names.get(tag.issued_by) if tag.issued_by else None,
        }


def _as_utc(value: datetime) -> datetime:
    """Treat a naive datetime as UTC.

    MySQL DATETIME carries no offset, so a value read back through
    DateTime(timezone=True) arrives naive; comparing it against an aware `now`
    raises TypeError, which would 500 the tap rather than refuse it.
    """
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
