"""
Call tracking service — PII-free call volume for departments without an RMS.

Three quantities live here and are deliberately computed by three separate
paths, because collapsing any two of them produces a number that looks right
and is wrong:

* **Department call volume** — distinct :class:`OrgCall` rows. One call is one
  call however many units rolled.
* **Apparatus runs** — :class:`OrgCallResponse` rows per unit. These do *not*
  sum to the department total and are not meant to; a 400-call department can
  hold 380 engine runs and 240 medic runs.
* **Member credit** — held on ``ShiftAttendance.call_count``, never derived
  from either of the above, because a member who came on at 0300 was not on
  the 2200 call.

Nothing in this module accepts an address, a narrative, a patient or caller
detail, a dispatch/on-scene/clear time, or a CAD incident number. That is
enforced by absence: there is no parameter to pass one to, and no column to
land it in. A department that wants incident-level records wants an incident
module, behind its own consent and access-control story.
"""

from datetime import date
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.utils import generate_uuid
from app.models.call_tracking import (
    MAX_CALLS_PER_SHIFT,
    UNCLASSIFIED_CALL_TYPE,
    CallSource,
    CallTrackingMode,
    OrgCall,
    OrgCallResponse,
)
from app.models.training import Shift
from app.services.shift_eligibility_service import ShiftEligibilityService


class CallTrackingService:
    """Records and rolls up PII-free call volume."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Settings
    # ------------------------------------------------------------------

    async def get_settings(self, organization_id: str) -> Dict[str, Any]:
        """Return ``{"mode", "call_types"}`` for the org (never raises)."""
        eligibility = ShiftEligibilityService(self.db)
        org = await eligibility._get_org(str(organization_id))
        if not org:
            return {"mode": CallTrackingMode.DETAILED, "call_types": []}
        return eligibility.get_call_tracking_settings(org)

    async def _valid_type_slugs(self, organization_id: str) -> set:
        """Slugs a submitted breakdown may name — **retired ones included**.

        Deliberately not filtered to active types. Retirement stops a type
        being *offered*; it is not a reason to reject a shift that is being
        re-finalized with the counts it has always had, and an admin
        retiring a type mid-tour would otherwise turn the officer's close-out
        into a hard "Unknown call type" failure they cannot clear. What a
        close-out offers is decided where the wizard's row list is built, not
        here.
        """
        settings = await self.get_settings(str(organization_id))
        return {t["slug"] for t in settings.get("call_types", [])}

    async def type_labels(self, organization_id: str) -> Dict[str, str]:
        """Slug to display label, for anything rendering a stored call type.

        Retired types are included, and that is the point: a slug is the value
        every call was filed under, so a report covering last year has to be
        able to label a type the department has since stopped offering.
        Callers fall back to the slug for anything absent here — a type
        deleted outright, or a value written while the org was on detailed
        tracking, where the stored text is already human-readable.
        """
        settings = await self.get_settings(str(organization_id))
        return {t["slug"]: t["label"] for t in settings.get("call_types", [])}

    async def type_usage_counts(self, organization_id: str) -> Dict[str, int]:
        """Calls on record per type slug, across all dates.

        Unlike ``calls_by_type`` this is deliberately unwindowed and omits the
        untyped remainder: its one consumer is the settings screen, which asks
        "is anything filed under this type?" before offering to delete it.
        Windowing that question would report a type used only last year as
        unused and invite its deletion.
        """
        rows = (
            await self.db.execute(
                select(OrgCall.call_type, func.count(OrgCall.id))
                .where(
                    OrgCall.organization_id == str(organization_id),
                    OrgCall.call_type.isnot(None),
                )
                .group_by(OrgCall.call_type)
            )
        ).all()
        return {slug: int(n) for slug, n in rows}

    # ------------------------------------------------------------------
    # Recording
    # ------------------------------------------------------------------

    async def record_shift_calls(
        self,
        shift: Shift,
        organization_id: str,
        total_calls: int,
        type_counts: Optional[Dict[str, int]] = None,
        recorded_by: Optional[str] = None,
        source: str = CallSource.MANUAL,
    ) -> Tuple[int, Optional[str]]:
        """Reconcile a shift's reported runs into calls and responses.

        Returns ``(responses_now_attributed_to_this_shift, error)``.

        **Only the calls this shift solely owns are reconciled.** A call this
        shift *shares* with another unit — because somebody said "we were on
        that one too" — is left alone and counted toward the total. Rebuilding
        every call from scratch on each finalize would delete the other unit's
        response along with it, quietly dropping their run from the record the
        first time this officer corrected a typo.

        Idempotent: finalizing twice with the same number leaves the same rows.
        """
        organization_id = str(organization_id)
        type_counts = {k: int(v) for k, v in (type_counts or {}).items() if int(v) > 0}

        if total_calls < 0:
            return 0, "Call count cannot be negative"
        if total_calls > MAX_CALLS_PER_SHIFT:
            return 0, f"Call count cannot exceed {MAX_CALLS_PER_SHIFT} for one shift"

        if type_counts:
            valid = await self._valid_type_slugs(organization_id)
            unknown = sorted(set(type_counts) - valid)
            if unknown:
                return 0, f"Unknown call type(s): {', '.join(unknown)}"
            if sum(type_counts.values()) > total_calls:
                return 0, "Call types add up to more than the total call count"

        shift_id = str(shift.id)
        apparatus_id = str(shift.apparatus_id) if shift.apparatus_id else None
        call_date = shift.shift_date or date.today()

        owned, shared = await self._partition_existing(shift_id, organization_id)

        # Shared calls are already on the record and already counted; this
        # shift only owes the remainder.
        if total_calls < len(shared):
            # Otherwise the shift ends up attached to more calls than it says
            # it ran, and its apparatus tally silently exceeds the number the
            # officer signed off on. Detaching is an explicit act, not
            # something a lowered total should do behind their back.
            return 0, (
                f"This shift is already recorded on {len(shared)} call(s) "
                f"shared with another unit, which is more than the "
                f"{total_calls} reported. Detach a shared call first."
            )
        owned_needed = total_calls - len(shared)
        wanted_types = self._expand_type_slots(type_counts, owned_needed)

        # Trim surplus owned calls (officer corrected the number downward).
        for call_id in owned[owned_needed:]:
            await self.db.execute(
                delete(OrgCallResponse).where(OrgCallResponse.call_id == call_id)
            )
            await self.db.execute(delete(OrgCall).where(OrgCall.id == call_id))
        owned = owned[:owned_needed]

        # Bring the survivors back in line with the shift as it stands now —
        # type *and* date. Calls are written when step 2 is saved, but the
        # shift's date and apparatus stay editable afterwards, so retyping
        # alone left a corrected shift reporting its calls under the old date.
        if owned:
            existing_rows = (
                (await self.db.execute(select(OrgCall).where(OrgCall.id.in_(owned))))
                .scalars()
                .all()
            )
            by_id = {str(r.id): r for r in existing_rows}
            for idx, call_id in enumerate(owned):
                row = by_id.get(call_id)
                if row is not None:
                    row.call_type = wanted_types[idx]
                    row.call_date = call_date

        # Same for the unit. A shift reassigned to another apparatus after its
        # calls were saved otherwise kept crediting the runs to the old one.
        if apparatus_id is not None:
            await self.db.execute(
                update(OrgCallResponse)
                .where(
                    OrgCallResponse.shift_id == shift_id,
                    OrgCallResponse.organization_id == organization_id,
                    OrgCallResponse.apparatus_id != apparatus_id,
                )
                .values(apparatus_id=apparatus_id)
            )

        # Add whatever is still missing.
        for idx in range(len(owned), owned_needed):
            call = OrgCall(
                id=generate_uuid(),
                organization_id=organization_id,
                call_date=call_date,
                call_type=wanted_types[idx],
                source=source,
                created_by=recorded_by,
            )
            self.db.add(call)
            self.db.add(
                OrgCallResponse(
                    id=generate_uuid(),
                    organization_id=organization_id,
                    call_id=call.id,
                    shift_id=shift_id,
                    apparatus_id=apparatus_id,
                )
            )

        await self.db.flush()
        return owned_needed + len(shared), None

    async def _partition_existing(
        self, shift_id: str, organization_id: str
    ) -> Tuple[List[str], List[str]]:
        """Split this shift's existing calls into solely-owned and shared.

        "Shared" means another unit also responded to that call, so the call
        row belongs to the department rather than to this shift and must
        survive this shift being re-finalized.
        """
        rows = (
            (
                await self.db.execute(
                    select(OrgCallResponse.call_id).where(
                        OrgCallResponse.shift_id == shift_id,
                        OrgCallResponse.organization_id == organization_id,
                    )
                )
            )
            .scalars()
            .all()
        )
        call_ids = [str(c) for c in rows]
        if not call_ids:
            return [], []

        counts = (
            await self.db.execute(
                select(
                    OrgCallResponse.call_id,
                    func.count(OrgCallResponse.id),
                )
                .where(OrgCallResponse.call_id.in_(call_ids))
                .group_by(OrgCallResponse.call_id)
            )
        ).all()
        responder_count = {str(cid): int(n) for cid, n in counts}

        owned = [c for c in call_ids if responder_count.get(c, 1) <= 1]
        shared = [c for c in call_ids if responder_count.get(c, 1) > 1]
        return owned, shared

    @staticmethod
    def _expand_type_slots(
        type_counts: Dict[str, int], length: int
    ) -> List[Optional[str]]:
        """Flatten ``{"ems": 3, "fire": 1}`` into a slot list of ``length``.

        Short tallies pad with ``None`` — an unclassified call, which is a
        truthful record of "the officer gave a total but not a breakdown".
        Requiring the tally to reconcile exactly would just teach officers to
        invent a type at 0700 to get the close-out to submit.
        """
        slots: List[Optional[str]] = []
        for slug in sorted(type_counts):
            slots.extend([slug] * type_counts[slug])
        slots = slots[:length]
        slots.extend([None] * (length - len(slots)))
        return slots

    # ------------------------------------------------------------------
    # Cross-unit attachment (the thing that makes dedup real)
    # ------------------------------------------------------------------

    async def attach_response(
        self,
        call_id: str,
        shift: Shift,
        organization_id: str,
    ) -> Tuple[bool, Optional[str]]:
        """Record that this shift's apparatus was on an already-logged call.

        This is what keeps one incident counted once when two units roll: the
        second unit points at the first unit's call instead of creating its
        own. Org-scoped by an explicit filter, not by the caller's permission
        (pitfall #14b).
        """
        organization_id = str(organization_id)
        call = (
            await self.db.execute(
                select(OrgCall).where(
                    OrgCall.id == str(call_id),
                    OrgCall.organization_id == organization_id,
                )
            )
        ).scalar_one_or_none()
        if call is None:
            return False, "Call not found"

        apparatus_id = str(shift.apparatus_id) if shift.apparatus_id else None
        # A shift with no apparatus is identified by the shift itself. Matching
        # on ``apparatus_id == None`` compiles to ``= NULL``, which is never
        # true, so every attach inserted another row: the unit's tally climbed
        # on each save and the third one made this query raise.
        dedupe = (
            OrgCallResponse.apparatus_id == apparatus_id
            if apparatus_id is not None
            else OrgCallResponse.shift_id == str(shift.id)
        )
        existing = (
            await self.db.execute(
                select(OrgCallResponse.id)
                .where(OrgCallResponse.call_id == str(call_id), dedupe)
                .limit(1)
            )
        ).scalar_one_or_none()
        if existing is not None:
            return True, None

        self.db.add(
            OrgCallResponse(
                id=generate_uuid(),
                organization_id=organization_id,
                call_id=str(call_id),
                shift_id=str(shift.id),
                apparatus_id=apparatus_id,
            )
        )
        await self.db.flush()
        return True, None

    async def list_calls_in_window(
        self,
        organization_id: str,
        on_date: date,
        exclude_shift_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Calls already logged that day, so a closing crew can attach to one.

        Returns the responding units per call — an officer needs to see "Engine
        5 logged an MVA" to recognise it as the one their medic also ran.
        """
        organization_id = str(organization_id)
        calls = (
            (
                await self.db.execute(
                    select(OrgCall)
                    .where(
                        OrgCall.organization_id == organization_id,
                        OrgCall.call_date == on_date,
                    )
                    .order_by(OrgCall.created_at)
                )
            )
            .scalars()
            .all()
        )
        if not calls:
            return []

        call_ids = [str(c.id) for c in calls]
        responses = (
            (
                await self.db.execute(
                    select(OrgCallResponse).where(OrgCallResponse.call_id.in_(call_ids))
                )
            )
            .scalars()
            .all()
        )
        by_call: Dict[str, List[OrgCallResponse]] = {}
        for r in responses:
            by_call.setdefault(str(r.call_id), []).append(r)

        result = []
        for call in calls:
            rows = by_call.get(str(call.id), [])
            if exclude_shift_id and any(
                str(r.shift_id) == str(exclude_shift_id) for r in rows
            ):
                continue
            result.append(
                {
                    "id": str(call.id),
                    "call_date": call.call_date,
                    "call_type": call.call_type,
                    "source": call.source,
                    "apparatus_ids": [
                        str(r.apparatus_id) for r in rows if r.apparatus_id
                    ],
                }
            )
        return result

    # ------------------------------------------------------------------
    # Roll-ups — three separate paths, on purpose
    # ------------------------------------------------------------------

    async def department_call_count(
        self, organization_id: str, start: date, end: date
    ) -> int:
        """Distinct calls the department ran.

        Counts :class:`OrgCall`, **never** a sum of per-unit or per-member
        numbers. Summing apparatus runs multiplies every mutual response by the
        number of units on it; summing member credit multiplies it by crew
        size. Both read as plausible and are wrong on the grant application.
        """
        return int(
            (
                await self.db.execute(
                    select(func.count(func.distinct(OrgCall.id))).where(
                        OrgCall.organization_id == str(organization_id),
                        OrgCall.call_date >= start,
                        OrgCall.call_date <= end,
                    )
                )
            ).scalar()
            or 0
        )

    async def calls_by_type(
        self, organization_id: str, start: date, end: date
    ) -> Dict[str, int]:
        """Department call volume split by type slug.

        Untyped calls are reported under ``"unclassified"`` rather than
        dropped, so the breakdown always reconciles to the total.
        """
        rows = (
            await self.db.execute(
                select(OrgCall.call_type, func.count(OrgCall.id))
                .where(
                    OrgCall.organization_id == str(organization_id),
                    OrgCall.call_date >= start,
                    OrgCall.call_date <= end,
                )
                .group_by(OrgCall.call_type)
            )
        ).all()
        return {(slug or UNCLASSIFIED_CALL_TYPE): int(n) for slug, n in rows}

    async def apparatus_run_counts(
        self, organization_id: str, start: date, end: date
    ) -> Dict[str, int]:
        """Runs per apparatus — unit responses, not incidents.

        Two units on one call yields 1 for the department and 1 run each here.
        These figures legitimately exceed the department total when summed.
        """
        rows = (
            await self.db.execute(
                select(
                    OrgCallResponse.apparatus_id,
                    func.count(func.distinct(OrgCallResponse.call_id)),
                )
                .join(OrgCall, OrgCall.id == OrgCallResponse.call_id)
                .where(
                    OrgCallResponse.organization_id == str(organization_id),
                    OrgCallResponse.apparatus_id.isnot(None),
                    OrgCall.call_date >= start,
                    OrgCall.call_date <= end,
                )
                .group_by(OrgCallResponse.apparatus_id)
            )
        ).all()
        return {str(aid): int(n) for aid, n in rows if aid}

    async def shift_response_count(self, shift_id: str) -> int:
        """How many calls this shift's apparatus was recorded on."""
        return int(
            (
                await self.db.execute(
                    select(func.count(OrgCallResponse.id)).where(
                        OrgCallResponse.shift_id == str(shift_id)
                    )
                )
            ).scalar()
            or 0
        )

    async def shift_type_counts(self, shift_id: str) -> Dict[str, int]:
        """This shift's own tally by type, for redisplay on a reopened shift."""
        rows = (
            await self.db.execute(
                select(OrgCall.call_type, func.count(OrgCall.id))
                .join(OrgCallResponse, OrgCallResponse.call_id == OrgCall.id)
                .where(OrgCallResponse.shift_id == str(shift_id))
                .group_by(OrgCall.call_type)
            )
        ).all()
        return {slug: int(n) for slug, n in rows if slug}
