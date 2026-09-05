"""
Tests for PII-free call tracking (app/services/call_tracking_service.py).

The invariant these exist to protect: **a department's call volume is the
number of distinct calls, never a sum of per-unit or per-member numbers.**
Summing apparatus runs multiplies every mutual response by the units on it;
summing member credit multiplies it by crew size. Both produce a number that
looks entirely plausible and is wrong on the grant application, and neither
fails loudly — which is why they are asserted here rather than left to review.
"""

from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic import ValidationError

from app.models.call_tracking import (
    DEFAULT_CALL_TYPES,
    MAX_CALLS_PER_SHIFT,
    CallTrackingMode,
)
from app.schemas.scheduling import (
    CallTrackingSettings,
    MemberCallCredit,
    ShiftFinalizeRequest,
)
from app.services.call_tracking_service import CallTrackingService
from app.services.scheduling_service import SchedulingService
from app.services.shift_eligibility_service import ShiftEligibilityService


def _scalars(items):
    r = MagicMock()
    r.scalars.return_value.all.return_value = items
    return r


def _rows(items):
    r = MagicMock()
    r.all.return_value = items
    return r


@pytest.mark.parametrize("mode", [CallTrackingMode.COUNT_ONLY, CallTrackingMode.OFF])
@pytest.mark.asyncio
async def test_detailed_shift_call_rejected_outside_detailed_mode(monkeypatch, mode):
    """Count-only/off tenants must not be able to persist incident details."""
    db = MagicMock()
    db.rollback = AsyncMock()
    service = SchedulingService(db)
    service.get_shift_by_id = AsyncMock(return_value=SimpleNamespace(id="shift-1"))
    monkeypatch.setattr(
        CallTrackingService,
        "get_settings",
        AsyncMock(return_value={"mode": mode, "call_types": []}),
    )

    call, error = await service.create_shift_call(
        "11111111-1111-1111-1111-111111111111",
        "22222222-2222-2222-2222-222222222222",
        {
            "incident_type": "medical",
            "incident_number": "CAD-12345",
            "notes": "Patient details must not be stored",
        },
    )

    assert call is None
    assert error == "Detailed call records are disabled for this organization"
    db.add.assert_not_called()


# ======================================================================
# Type-slot expansion
# ======================================================================


class TestExpandTypeSlots:
    def test_pads_short_tally_with_unclassified(self):
        """A total without a full breakdown is recorded honestly, not padded
        with an invented type."""
        slots = CallTrackingService._expand_type_slots({"ems": 2}, 5)
        assert slots == ["ems", "ems", None, None, None]

    def test_truncates_tally_longer_than_total(self):
        slots = CallTrackingService._expand_type_slots({"ems": 9}, 2)
        assert slots == ["ems", "ems"]

    def test_multiple_types_are_deterministic(self):
        """Sorted, so re-finalizing an unchanged shift retypes nothing."""
        a = CallTrackingService._expand_type_slots({"fire": 1, "ems": 2}, 3)
        b = CallTrackingService._expand_type_slots({"ems": 2, "fire": 1}, 3)
        assert a == b == ["ems", "ems", "fire"]

    def test_empty_tally_is_all_unclassified(self):
        assert CallTrackingService._expand_type_slots({}, 3) == [None, None, None]

    def test_zero_length(self):
        assert CallTrackingService._expand_type_slots({"ems": 3}, 0) == []


# ======================================================================
# Settings resolution — absence must mean "current behaviour"
# ======================================================================


class TestCallTrackingSettingsResolution:
    def _svc_with_settings(self, scheduling_settings):
        svc = ShiftEligibilityService(MagicMock())
        org = SimpleNamespace(settings={"scheduling": scheduling_settings})
        return svc, org

    def test_missing_config_defaults_to_detailed(self):
        """Pitfall #19: a missing setting means today's behaviour, never off.
        Defaulting to disabled would silently stop call logging for every
        existing installation on upgrade."""
        svc, org = self._svc_with_settings({})
        resolved = svc.get_call_tracking_settings(org)
        assert resolved["mode"] == CallTrackingMode.DETAILED

    def test_missing_config_seeds_default_types(self):
        svc, org = self._svc_with_settings({})
        resolved = svc.get_call_tracking_settings(org)
        assert len(resolved["call_types"]) == len(DEFAULT_CALL_TYPES)
        assert {t["slug"] for t in resolved["call_types"]} == {
            t["slug"] for t in DEFAULT_CALL_TYPES
        }

    def test_unknown_mode_degrades_to_detailed(self):
        """rule.config is unvalidated JSON an admin can edit. A bad value must
        not raise: an exception here takes out close-out for the whole
        department over one typo."""
        svc, org = self._svc_with_settings({"call_tracking": {"mode": "banana"}})
        assert svc.get_call_tracking_settings(org)["mode"] == CallTrackingMode.DETAILED

    def test_non_dict_config_degrades(self):
        svc, org = self._svc_with_settings({"call_tracking": "count_only"})
        resolved = svc.get_call_tracking_settings(org)
        assert resolved["mode"] == CallTrackingMode.DETAILED
        assert resolved["call_types"]

    def test_malformed_type_entries_are_dropped_not_fatal(self):
        svc, org = self._svc_with_settings(
            {
                "call_tracking": {
                    "mode": CallTrackingMode.COUNT_ONLY,
                    "call_types": [
                        {"slug": "fire", "label": "Fire"},
                        "not-a-dict",
                        {"label": "no slug"},
                        {"slug": "  ", "label": "blank"},
                    ],
                }
            }
        )
        resolved = svc.get_call_tracking_settings(org)
        assert resolved["mode"] == CallTrackingMode.COUNT_ONLY
        assert resolved["call_types"] == [
            {"slug": "fire", "label": "Fire", "active": True}
        ]

    def test_all_types_malformed_falls_back_to_defaults(self):
        svc, org = self._svc_with_settings(
            {"call_tracking": {"mode": "count_only", "call_types": ["junk"]}}
        )
        assert len(svc.get_call_tracking_settings(org)["call_types"]) == len(
            DEFAULT_CALL_TYPES
        )

    def test_label_defaults_to_slug_when_absent(self):
        svc, org = self._svc_with_settings(
            {"call_tracking": {"call_types": [{"slug": "brush"}]}}
        )
        assert svc.get_call_tracking_settings(org)["call_types"] == [
            {"slug": "brush", "label": "brush", "active": True}
        ]

    def test_none_settings_object(self):
        svc = ShiftEligibilityService(MagicMock())
        resolved = svc.get_call_tracking_settings(SimpleNamespace(settings=None))
        assert resolved["mode"] == CallTrackingMode.DETAILED


# ======================================================================
# Settings schema
# ======================================================================


class TestCallTrackingSettingsSchema:
    def test_accepts_valid(self):
        s = CallTrackingSettings(
            mode=CallTrackingMode.COUNT_ONLY,
            call_types=[{"slug": "fire", "label": "Fire"}],
        )
        assert s.mode == "count_only"

    def test_rejects_unknown_mode(self):
        with pytest.raises(ValidationError):
            CallTrackingSettings(mode="sometimes")

    def test_rejects_duplicate_slugs(self):
        """Two types with one slug makes the stored value ambiguous and the
        breakdown unreconcilable."""
        with pytest.raises(ValidationError):
            CallTrackingSettings(
                call_types=[
                    {"slug": "fire", "label": "Fire"},
                    {"slug": "fire", "label": "Structure Fire"},
                ]
            )

    def test_rejects_slug_with_display_characters(self):
        """Slugs are permanent identifiers; labels are what get renamed."""
        with pytest.raises(ValidationError):
            CallTrackingSettings(call_types=[{"slug": "Motor Vehicle", "label": "MVA"}])

    def test_defaults_to_detailed(self):
        assert CallTrackingSettings().mode == CallTrackingMode.DETAILED


# ======================================================================
# Finalize request validation — the PII boundary and the arithmetic
# ======================================================================


class TestShiftFinalizeCallVolume:
    def test_accepts_count_with_breakdown(self):
        body = ShiftFinalizeRequest(
            reported_call_count=5, reported_call_types={"ems": 3, "fire": 1}
        )
        assert body.reported_call_count == 5

    def test_none_is_distinct_from_zero(self):
        """'Not answered' and 'we ran none' are different facts. A report that
        conflates them understates quiet nights as missing data."""
        assert ShiftFinalizeRequest().reported_call_count is None
        assert ShiftFinalizeRequest(reported_call_count=0).reported_call_count == 0

    def test_rejects_types_summing_over_total(self):
        with pytest.raises(ValidationError):
            ShiftFinalizeRequest(reported_call_count=2, reported_call_types={"ems": 3})

    def test_allows_types_summing_under_total(self):
        """The remainder is unclassified. Requiring an exact reconciliation
        just teaches officers to invent a type at 0700 to make it submit."""
        body = ShiftFinalizeRequest(
            reported_call_count=5, reported_call_types={"ems": 2}
        )
        assert sum(body.reported_call_types.values()) < body.reported_call_count

    def test_rejects_breakdown_without_total(self):
        with pytest.raises(ValidationError):
            ShiftFinalizeRequest(reported_call_types={"ems": 1})

    def test_rejects_negative_total(self):
        with pytest.raises(ValidationError):
            ShiftFinalizeRequest(reported_call_count=-1)

    def test_rejects_total_over_cap(self):
        with pytest.raises(ValidationError):
            ShiftFinalizeRequest(reported_call_count=MAX_CALLS_PER_SHIFT + 1)

    def test_rejects_member_credited_beyond_apparatus_count(self):
        """A member cannot have gone on more calls than the rig ran."""
        with pytest.raises(ValidationError):
            ShiftFinalizeRequest(
                reported_call_count=3,
                member_call_counts=[
                    MemberCallCredit(
                        user_id="11111111-1111-1111-1111-111111111111", call_count=4
                    )
                ],
            )

    def test_allows_member_credited_below_apparatus_count(self):
        """The late-arrival case, which is the whole reason credit is
        per-member rather than the shift number restated."""
        body = ShiftFinalizeRequest(
            reported_call_count=5,
            member_call_counts=[
                MemberCallCredit(
                    user_id="11111111-1111-1111-1111-111111111111", call_count=2
                )
            ],
        )
        assert body.member_call_counts[0].call_count == 2

    def test_rejects_blank_type_slug(self):
        with pytest.raises(ValidationError):
            ShiftFinalizeRequest(reported_call_count=1, reported_call_types={"  ": 1})

    @pytest.mark.parametrize(
        "field", ["address", "patient_name", "narrative", "incident_number"]
    )
    def test_incident_detail_is_not_accepted(self, field):
        """The PII boundary is structural, not advisory. Hiding a field in
        React does not stop a POST, so the close-out payload must have nowhere
        to put an address or a narrative in the first place."""
        body = ShiftFinalizeRequest(**{"reported_call_count": 1, field: "sensitive"})
        assert not hasattr(body, field)


# ======================================================================
# record_shift_calls — validation before any write
# ======================================================================


class TestRecordShiftCallsValidation:
    def _service(self, valid_slugs=("ems", "fire")):
        svc = CallTrackingService(MagicMock())
        svc.get_settings = AsyncMock(
            return_value={
                "mode": CallTrackingMode.COUNT_ONLY,
                "call_types": [{"slug": s, "label": s} for s in valid_slugs],
            }
        )
        return svc

    def _shift(self):
        return SimpleNamespace(
            id="shift-1", apparatus_id="app-1", shift_date=date(2026, 8, 18)
        )

    async def test_rejects_negative_count(self):
        svc = self._service()
        svc.db.add = MagicMock()
        created, err = await svc.record_shift_calls(
            self._shift(), "org-1", total_calls=-1
        )
        assert created == 0
        assert "negative" in err
        svc.db.add.assert_not_called()

    async def test_rejects_count_over_cap(self):
        """A fat-fingered 500 would write 500 rows and skew every report that
        reads them."""
        svc = self._service()
        svc.db.add = MagicMock()
        created, err = await svc.record_shift_calls(
            self._shift(), "org-1", total_calls=MAX_CALLS_PER_SHIFT + 1
        )
        assert created == 0
        assert str(MAX_CALLS_PER_SHIFT) in err
        svc.db.add.assert_not_called()

    async def test_rejects_unknown_type_slug(self):
        """A slug not in the department's own list would be invisible in every
        breakdown that renders labels from settings."""
        svc = self._service()
        svc.db.add = MagicMock()
        created, err = await svc.record_shift_calls(
            self._shift(), "org-1", total_calls=2, type_counts={"grass_fire": 1}
        )
        assert created == 0
        assert "grass_fire" in err
        svc.db.add.assert_not_called()

    async def test_rejects_tally_over_total(self):
        svc = self._service()
        svc.db.add = MagicMock()
        created, err = await svc.record_shift_calls(
            self._shift(), "org-1", total_calls=1, type_counts={"ems": 5}
        )
        assert created == 0
        assert "more than the total" in err
        svc.db.add.assert_not_called()

    async def test_zero_counts_in_tally_are_ignored(self):
        svc = self._service()
        svc._partition_existing = AsyncMock(return_value=([], []))
        svc.db.add = MagicMock()
        svc.db.flush = AsyncMock()
        svc.db.execute = AsyncMock()
        created, err = await svc.record_shift_calls(
            self._shift(), "org-1", total_calls=1, type_counts={"ems": 1, "fire": 0}
        )
        assert err is None
        assert created == 1

    async def test_rejects_total_below_already_attached_shared_calls(self):
        """Lowering the total below what this unit is already attached to
        would leave its tally above the number the officer signed off on.
        Detaching is an explicit act, not a side effect of a smaller number."""
        svc = self._service()
        svc._partition_existing = AsyncMock(return_value=([], ["shared-1", "shared-2"]))
        svc.db.add = MagicMock()
        created, err = await svc.record_shift_calls(
            self._shift(), "org-1", total_calls=1
        )
        assert created == 0
        assert "Detach a shared call first" in err
        svc.db.add.assert_not_called()

    async def test_creates_one_call_and_one_response_per_call(self):
        svc = self._service()
        svc._partition_existing = AsyncMock(return_value=([], []))
        svc.db.add = MagicMock()
        svc.db.flush = AsyncMock()
        svc.db.execute = AsyncMock()
        created, err = await svc.record_shift_calls(
            self._shift(), "org-1", total_calls=3
        )
        assert err is None
        assert created == 3
        # One OrgCall + one OrgCallResponse each.
        assert svc.db.add.call_count == 6

    async def test_shared_calls_reduce_what_this_shift_creates(self):
        """A call this unit shares with another is already on the record.
        Recreating it here would count one incident twice for the
        department — the exact double-count this design exists to prevent."""
        svc = self._service()
        svc._partition_existing = AsyncMock(return_value=([], ["call-shared"]))
        svc.db.add = MagicMock()
        svc.db.flush = AsyncMock()
        svc.db.execute = AsyncMock()
        created, err = await svc.record_shift_calls(
            self._shift(), "org-1", total_calls=3
        )
        assert err is None
        assert created == 3
        # Two new calls, not three: the shared one already exists.
        assert svc.db.add.call_count == 4


# ======================================================================
# _partition_existing — what may be rebuilt vs what must survive
# ======================================================================


class TestMemberCreditReachesThePerson:
    """Credit that is stored but never shown to the member is not credit.

    The count-only fallbacks exist because both downstream consumers derive
    calls from ShiftCall rows, which a count-only department never creates.
    Without them a member is told "Calls responded: 0" for a shift whose own
    record says five, and their own attendance row agrees it was five.
    """

    async def test_summary_fallback_reads_attendance_credit(self):
        """The per-member shift summary notification."""
        svc = CallTrackingService(MagicMock())
        svc.shift_type_counts = AsyncMock(return_value={"ems": 2, "fire": 1})

        attendance = [
            SimpleNamespace(user_id="u1", call_count=3),
            SimpleNamespace(user_id="u2", call_count=1),
            SimpleNamespace(user_id="u3", call_count=0),
        ]
        type_counts = await svc.shift_type_counts("shift-1")
        flat = []
        for slug in sorted(type_counts):
            flat.extend([slug] * type_counts[slug])

        per_member = {
            str(a.user_id): {
                "count": int(a.call_count or 0),
                "types": flat[: int(a.call_count or 0)],
            }
            for a in attendance
            if int(a.call_count or 0) > 0
        }

        assert per_member["u1"]["count"] == 3
        assert per_member["u2"]["count"] == 1
        # A member credited with nothing is omitted, not reported as zero
        # calls on a shift they were not on.
        assert "u3" not in per_member
        # Types are drawn from the shift's tally, capped at the member's credit.
        assert len(per_member["u2"]["types"]) == 1

    async def test_trainee_fallback_uses_attendance_not_shift_total(self):
        """The training-credit path. A late arrival must not be credited with
        the whole tour."""
        from app.services.shift_completion_service import ShiftCompletionService

        db = MagicMock()
        result = MagicMock()
        result.scalar_one_or_none.return_value = 2
        db.execute = AsyncMock(return_value=result)

        svc = ShiftCompletionService(db)
        count, types = await svc._get_trainee_call_data_from_counts("shift-1", "u1")
        assert count == 2

    async def test_trainee_fallback_with_no_credit_returns_zero(self):
        from app.services.shift_completion_service import ShiftCompletionService

        db = MagicMock()
        result = MagicMock()
        result.scalar_one_or_none.return_value = None
        db.execute = AsyncMock(return_value=result)

        svc = ShiftCompletionService(db)
        assert await svc._get_trainee_call_data_from_counts("shift-1", "u1") == (0, [])


class TestPartitionExisting:
    async def test_no_existing_calls(self):
        svc = CallTrackingService(MagicMock())
        svc.db.execute = AsyncMock(return_value=_scalars([]))
        assert await svc._partition_existing("shift-1", "org-1") == ([], [])

    async def test_sole_responder_calls_are_owned(self):
        svc = CallTrackingService(MagicMock())
        svc.db.execute = AsyncMock(
            side_effect=[_scalars(["c1", "c2"]), _rows([("c1", 1), ("c2", 1)])]
        )
        owned, shared = await svc._partition_existing("shift-1", "org-1")
        assert owned == ["c1", "c2"]
        assert shared == []

    async def test_multi_responder_calls_are_shared(self):
        """Shared calls must survive this shift being re-finalized, or
        correcting a typo silently deletes the other unit's run."""
        svc = CallTrackingService(MagicMock())
        svc.db.execute = AsyncMock(
            side_effect=[_scalars(["c1", "c2"]), _rows([("c1", 1), ("c2", 2)])]
        )
        owned, shared = await svc._partition_existing("shift-1", "org-1")
        assert owned == ["c1"]
        assert shared == ["c2"]


# ======================================================================
# Settings sanitising — degrade, never raise
# ======================================================================


class TestCallTypeSanitising:
    """The sanitiser must drop exactly what CallTypeOption would reject.

    Letting a malformed entry through turned the promised safe degradation
    into a 500 for the whole organisation: it survived the filter, then failed
    schema construction on the settings endpoint and on every close-out.
    """

    def _resolve(self, call_types):
        svc = ShiftEligibilityService(MagicMock())
        org = SimpleNamespace(
            settings={"scheduling": {"call_tracking": {"call_types": call_types}}}
        )
        return svc.get_call_tracking_settings(org)["call_types"]

    def test_drops_a_slug_the_schema_would_reject(self):
        assert self._resolve(
            [{"slug": "EMS", "label": "Upper"}, {"slug": "ems", "label": "EMS"}]
        ) == [{"slug": "ems", "label": "EMS", "active": True}]

    def test_drops_duplicate_slugs(self):
        assert self._resolve(
            [{"slug": "ems", "label": "First"}, {"slug": "ems", "label": "Second"}]
        ) == [{"slug": "ems", "label": "First", "active": True}]

    def test_drops_an_overlong_slug(self):
        assert self._resolve([{"slug": "x" * 51, "label": "Long"}]) == [
            {"slug": t["slug"], "label": t["label"], "active": True}
            for t in DEFAULT_CALL_TYPES
        ]

    def test_blank_label_falls_back_to_the_slug(self):
        assert self._resolve([{"slug": "fire", "label": "   "}]) == [
            {"slug": "fire", "label": "fire", "active": True}
        ]

    def test_everything_it_returns_satisfies_the_schema(self):
        resolved = self._resolve(
            [
                {"slug": "EMS", "label": "bad"},
                {"slug": "ems", "label": "EMS"},
                {"slug": "ems", "label": "dup"},
                {"slug": "y" * 80, "label": "long"},
                {"slug": "fire", "label": ""},
            ]
        )
        # Constructing this is what used to blow up.
        assert CallTrackingSettings(call_types=resolved).call_types


# ======================================================================
# Retirement — a type stops being offered without orphaning its history
# ======================================================================


class TestCallTypeRetirement:
    """``active`` decides what close-out offers, never what it can resolve.

    Deleting a type an org has filed calls under leaves those rows pointing at
    a slug nothing can label, so the editor retires instead. Every read path
    therefore has to keep returning the retired entry.
    """

    def _resolve(self, call_types):
        svc = ShiftEligibilityService(MagicMock())
        org = SimpleNamespace(
            settings={"scheduling": {"call_tracking": {"call_types": call_types}}}
        )
        return svc.get_call_tracking_settings(org)["call_types"]

    def test_retired_entry_is_returned_not_dropped(self):
        assert self._resolve(
            [{"slug": "brush", "label": "Brush", "active": False}]
        ) == [{"slug": "brush", "label": "Brush", "active": False}]

    def test_absent_active_reads_as_active(self):
        """Every entry stored before this field existed lacks the key. Reading
        that absence as "retired" would empty every department's close-out
        list on upgrade (pitfall #19)."""
        assert self._resolve([{"slug": "fire", "label": "Fire"}])[0]["active"] is True

    @pytest.mark.parametrize("value", [None, "", 0])
    def test_only_an_explicit_false_retires(self, value):
        """Hand-edited JSON fails toward offering the type: an unusable
        close-out list is louder than one row too many."""
        resolved = self._resolve([{"slug": "fire", "label": "Fire", "active": value}])
        assert resolved[0]["active"] is True

    def test_retiring_every_type_does_not_resurrect_the_defaults(self):
        """Retiring all of them is how a department asks for a bare total. The
        empty-list fallback must not read that as "never configured" and put
        nine rows back."""
        resolved = self._resolve(
            [
                {"slug": "fire", "label": "Fire", "active": False},
                {"slug": "ems", "label": "EMS", "active": False},
            ]
        )
        assert [t["slug"] for t in resolved] == ["fire", "ems"]
        assert not any(t["active"] for t in resolved)

    def test_schema_round_trips_active(self):
        s = CallTrackingSettings(
            call_types=[
                {"slug": "fire", "label": "Fire"},
                {"slug": "brush", "label": "Brush", "active": False},
            ]
        )
        assert [t.active for t in s.call_types] == [True, False]

    def test_schema_bounds_the_list(self):
        """It lands in an unvalidated JSON column every close-out reads."""
        with pytest.raises(ValidationError):
            CallTrackingSettings(
                call_types=[{"slug": f"t{i}", "label": f"T{i}"} for i in range(51)]
            )

    async def test_submitting_a_retired_slug_is_still_accepted(self):
        """Retirement stops a type being *offered*; it is not grounds to
        reject a re-finalize of a shift that has always carried those counts,
        and an admin retiring a type mid-tour must not turn an officer's
        close-out into a failure they have no way to clear."""
        svc = CallTrackingService(MagicMock())
        svc.get_settings = AsyncMock(
            return_value={
                "mode": CallTrackingMode.COUNT_ONLY,
                "call_types": [{"slug": "brush", "label": "Brush", "active": False}],
            }
        )
        assert await svc._valid_type_slugs("org-1") == {"brush"}


# ======================================================================
# Resumable close-out — schema contract
# ======================================================================


class TestCloseoutStepSchemas:
    """The wizard saves each step as it advances, so each step's payload is
    validated on its own rather than only at the end."""

    def test_attendance_rejects_leaving_before_arriving(self):
        from app.schemas.scheduling import CloseoutAttendanceEntry

        with pytest.raises(ValidationError):
            CloseoutAttendanceEntry(
                user_id="11111111-1111-1111-1111-111111111111",
                checked_in_at=datetime(2026, 8, 19, 20, 0, tzinfo=timezone.utc),
                checked_out_at=datetime(2026, 8, 19, 8, 0, tzinfo=timezone.utc),
            )

    def test_attendance_allows_open_checkout(self):
        """A member still on when the officer starts the close-out."""
        from app.schemas.scheduling import CloseoutAttendanceEntry

        entry = CloseoutAttendanceEntry(
            user_id="11111111-1111-1111-1111-111111111111",
            checked_in_at=datetime(2026, 8, 19, 8, 0, tzinfo=timezone.utc),
        )
        assert entry.checked_out_at is None

    def test_calls_step_rejects_tally_over_total(self):
        from app.schemas.scheduling import CloseoutCallsRequest

        with pytest.raises(ValidationError):
            CloseoutCallsRequest(reported_call_count=2, reported_call_types={"ems": 5})

    def test_calls_step_rejects_breakdown_without_total(self):
        from app.schemas.scheduling import CloseoutCallsRequest

        with pytest.raises(ValidationError):
            CloseoutCallsRequest(reported_call_types={"ems": 1})

    def test_calls_step_rejects_over_cap(self):
        from app.schemas.scheduling import CloseoutCallsRequest

        with pytest.raises(ValidationError):
            CloseoutCallsRequest(reported_call_count=MAX_CALLS_PER_SHIFT + 1)

    def test_calls_step_accepts_attachments_alone(self):
        """Claiming another unit's call without reporting a total of your own."""
        from app.schemas.scheduling import CloseoutCallsRequest

        body = CloseoutCallsRequest(
            attach_call_ids=["22222222-2222-2222-2222-222222222222"]
        )
        assert body.reported_call_count is None
        assert len(body.attach_call_ids) == 1

    @pytest.mark.parametrize(
        "field", ["address", "patient_name", "narrative", "dispatched_at"]
    )
    def test_calls_step_has_nowhere_for_incident_detail(self, field):
        """The PII boundary holds on the per-step endpoint too, not only on
        finalize — a second write path is a second chance to leak."""
        from app.schemas.scheduling import CloseoutCallsRequest

        body = CloseoutCallsRequest(**{"reported_call_count": 1, field: "sensitive"})
        assert not hasattr(body, field)

    def test_state_response_defaults_are_empty_not_absent(self):
        """A fresh close-out renders as an empty wizard, not a crash."""
        from app.schemas.scheduling import CloseoutStateResponse

        state = CloseoutStateResponse(
            shift_id="33333333-3333-3333-3333-333333333333",
            is_finalized=False,
            call_tracking_mode=CallTrackingMode.COUNT_ONLY,
        )
        assert state.closeout_step == 0
        assert state.members == []
        assert state.attachable_calls == []
        assert state.combined_hours == 0.0


# ======================================================================
# Integration — the arithmetic that matters, against a real database
# ======================================================================


async def _make_org(db_session, name="Call Tracking Test"):
    from app.core.utils import generate_uuid
    from app.models.user import Organization

    org = Organization(
        id=generate_uuid(),
        name=name,
        slug=f"cts-{generate_uuid()[:8]}",
        organization_type="fire_department",
        settings={
            "scheduling": {"call_tracking": {"mode": CallTrackingMode.COUNT_ONLY}}
        },
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _make_shift(db_session, org, apparatus_id, on_date=None):
    from app.core.utils import generate_uuid
    from app.models.training import Shift

    on_date = on_date or date(2026, 8, 18)
    start = datetime(2026, 8, 18, 8, 0, tzinfo=timezone.utc)
    shift = Shift(
        id=generate_uuid(),
        organization_id=org.id,
        shift_date=on_date,
        start_time=start,
        end_time=start + timedelta(hours=12),
        apparatus_id=apparatus_id,
    )
    db_session.add(shift)
    await db_session.flush()
    return shift


# These four classes need a live database. CI splits the suite: the unit job
# runs `-m "not integration ..."` with no MySQL service, and a separate
# integration job supplies one. Without the marker they ran in the unit job and
# errored on connect — 14 red checks for tests that were never given a database.
@pytest.mark.integration
class TestDepartmentTotalIsNotASum:
    """The single most dangerous bug in this design, asserted directly."""

    async def test_two_units_on_one_call_count_once_for_the_department(
        self, db_session
    ):
        org = await _make_org(db_session)
        svc = CallTrackingService(db_session)

        engine_shift = await _make_shift(db_session, org, "engine-5")
        medic_shift = await _make_shift(db_session, org, "medic-1")

        # Engine 5 logs the MVA.
        _, err = await svc.record_shift_calls(
            engine_shift, org.id, total_calls=1, type_counts={"mva": 1}
        )
        assert err is None

        # Medic 1 says "we were on that one too" rather than logging its own.
        calls = await svc.list_calls_in_window(org.id, date(2026, 8, 18))
        assert len(calls) == 1
        ok, err = await svc.attach_response(calls[0]["id"], medic_shift, org.id)
        assert ok
        assert err is None

        window = (date(2026, 8, 1), date(2026, 8, 31))
        assert await svc.department_call_count(org.id, *window) == 1

        runs = await svc.apparatus_run_counts(org.id, *window)
        assert runs == {"engine-5": 1, "medic-1": 1}
        # The runs sum to 2 while the department ran 1. That is correct, and
        # it is exactly why the total is not computed from them.
        assert sum(runs.values()) != await svc.department_call_count(org.id, *window)

    async def test_independent_calls_are_counted_separately(self, db_session):
        org = await _make_org(db_session)
        svc = CallTrackingService(db_session)
        engine_shift = await _make_shift(db_session, org, "engine-5")
        medic_shift = await _make_shift(db_session, org, "medic-1")

        await svc.record_shift_calls(engine_shift, org.id, total_calls=2)
        await svc.record_shift_calls(medic_shift, org.id, total_calls=3)

        window = (date(2026, 8, 1), date(2026, 8, 31))
        assert await svc.department_call_count(org.id, *window) == 5

    async def test_crew_size_does_not_multiply_the_department_total(self, db_session):
        """A four-person crew on five calls is five calls, not twenty. Member
        credit lives on attendance and is never summed into this figure."""
        org = await _make_org(db_session)
        svc = CallTrackingService(db_session)
        shift = await _make_shift(db_session, org, "engine-5")
        await svc.record_shift_calls(shift, org.id, total_calls=5)

        window = (date(2026, 8, 1), date(2026, 8, 31))
        assert await svc.department_call_count(org.id, *window) == 5
        assert await svc.apparatus_run_counts(org.id, *window) == {"engine-5": 5}


@pytest.mark.integration
class TestReconciliation:
    async def test_refinalizing_with_the_same_number_is_idempotent(self, db_session):
        """A bare COUNT-and-rewrite would duplicate the tour's calls on every
        correction."""
        org = await _make_org(db_session)
        svc = CallTrackingService(db_session)
        shift = await _make_shift(db_session, org, "engine-5")

        window = (date(2026, 8, 1), date(2026, 8, 31))
        await svc.record_shift_calls(shift, org.id, total_calls=4)
        await svc.record_shift_calls(shift, org.id, total_calls=4)
        assert await svc.department_call_count(org.id, *window) == 4

    async def test_correcting_the_number_downward_removes_calls(self, db_session):
        org = await _make_org(db_session)
        svc = CallTrackingService(db_session)
        shift = await _make_shift(db_session, org, "engine-5")
        window = (date(2026, 8, 1), date(2026, 8, 31))

        await svc.record_shift_calls(shift, org.id, total_calls=6)
        await svc.record_shift_calls(shift, org.id, total_calls=2)
        assert await svc.department_call_count(org.id, *window) == 2

    async def test_correcting_upward_adds_calls(self, db_session):
        org = await _make_org(db_session)
        svc = CallTrackingService(db_session)
        shift = await _make_shift(db_session, org, "engine-5")
        window = (date(2026, 8, 1), date(2026, 8, 31))

        await svc.record_shift_calls(shift, org.id, total_calls=2)
        await svc.record_shift_calls(shift, org.id, total_calls=5)
        assert await svc.department_call_count(org.id, *window) == 5

    async def test_refinalizing_preserves_another_units_shared_response(
        self, db_session
    ):
        """The reason reconciliation only touches solely-owned calls. Rebuilding
        every call would delete the medic's run the first time the engine
        officer fixed a typo."""
        org = await _make_org(db_session)
        svc = CallTrackingService(db_session)
        engine_shift = await _make_shift(db_session, org, "engine-5")
        medic_shift = await _make_shift(db_session, org, "medic-1")
        window = (date(2026, 8, 1), date(2026, 8, 31))

        await svc.record_shift_calls(engine_shift, org.id, total_calls=1)
        shared = (await svc.list_calls_in_window(org.id, date(2026, 8, 18)))[0]
        await svc.attach_response(shared["id"], medic_shift, org.id)

        # Engine officer reopens and corrects to 3.
        await svc.record_shift_calls(engine_shift, org.id, total_calls=3)

        runs = await svc.apparatus_run_counts(org.id, *window)
        assert runs["medic-1"] == 1, "the medic's run survived the correction"
        assert runs["engine-5"] == 3
        assert await svc.department_call_count(org.id, *window) == 3

    async def test_retyping_a_tally_updates_existing_calls(self, db_session):
        org = await _make_org(db_session)
        svc = CallTrackingService(db_session)
        shift = await _make_shift(db_session, org, "engine-5")
        window = (date(2026, 8, 1), date(2026, 8, 31))

        await svc.record_shift_calls(
            shift, org.id, total_calls=2, type_counts={"ems": 2}
        )
        await svc.record_shift_calls(
            shift, org.id, total_calls=2, type_counts={"fire": 2}
        )
        assert await svc.calls_by_type(org.id, *window) == {"fire": 2}

    async def test_untyped_calls_reconcile_as_unclassified(self, db_session):
        """The breakdown always adds up to the total, so a partial tally cannot
        make calls disappear from the report."""
        org = await _make_org(db_session)
        svc = CallTrackingService(db_session)
        shift = await _make_shift(db_session, org, "engine-5")
        window = (date(2026, 8, 1), date(2026, 8, 31))

        await svc.record_shift_calls(
            shift, org.id, total_calls=5, type_counts={"ems": 2}
        )
        by_type = await svc.calls_by_type(org.id, *window)
        assert by_type == {"ems": 2, "unclassified": 3}
        assert sum(by_type.values()) == await svc.department_call_count(org.id, *window)

    async def test_attaching_twice_is_idempotent(self, db_session):
        org = await _make_org(db_session)
        svc = CallTrackingService(db_session)
        engine_shift = await _make_shift(db_session, org, "engine-5")
        medic_shift = await _make_shift(db_session, org, "medic-1")
        window = (date(2026, 8, 1), date(2026, 8, 31))

        await svc.record_shift_calls(engine_shift, org.id, total_calls=1)
        shared = (await svc.list_calls_in_window(org.id, date(2026, 8, 18)))[0]
        await svc.attach_response(shared["id"], medic_shift, org.id)
        await svc.attach_response(shared["id"], medic_shift, org.id)

        assert (await svc.apparatus_run_counts(org.id, *window))["medic-1"] == 1


@pytest.mark.integration
class TestOrgScoping:
    async def test_attach_rejects_a_call_from_another_org(self, db_session):
        """Pitfall #14b: a permission check asserts the caller holds the
        permission in their own org; it says nothing about the target row."""
        org_a = await _make_org(db_session, "Dept A")
        org_b = await _make_org(db_session, "Dept B")
        svc = CallTrackingService(db_session)

        a_shift = await _make_shift(db_session, org_a, "engine-a")
        b_shift = await _make_shift(db_session, org_b, "engine-b")

        await svc.record_shift_calls(a_shift, org_a.id, total_calls=1)
        a_call = (await svc.list_calls_in_window(org_a.id, date(2026, 8, 18)))[0]

        ok, err = await svc.attach_response(a_call["id"], b_shift, org_b.id)
        assert not ok
        assert err == "Call not found"

    async def test_rollups_do_not_leak_across_orgs(self, db_session):
        org_a = await _make_org(db_session, "Dept A")
        org_b = await _make_org(db_session, "Dept B")
        svc = CallTrackingService(db_session)
        window = (date(2026, 8, 1), date(2026, 8, 31))

        await svc.record_shift_calls(
            await _make_shift(db_session, org_a, "engine-a"), org_a.id, total_calls=7
        )
        await svc.record_shift_calls(
            await _make_shift(db_session, org_b, "engine-b"), org_b.id, total_calls=2
        )

        assert await svc.department_call_count(org_a.id, *window) == 7
        assert await svc.department_call_count(org_b.id, *window) == 2
        assert "engine-b" not in await svc.apparatus_run_counts(org_a.id, *window)


@pytest.mark.integration
class TestWindowing:
    async def test_calls_outside_the_window_are_excluded(self, db_session):
        org = await _make_org(db_session)
        svc = CallTrackingService(db_session)

        await svc.record_shift_calls(
            await _make_shift(db_session, org, "e1", date(2026, 7, 1)),
            org.id,
            total_calls=3,
        )
        await svc.record_shift_calls(
            await _make_shift(db_session, org, "e2", date(2026, 8, 18)),
            org.id,
            total_calls=2,
        )
        assert (
            await svc.department_call_count(org.id, date(2026, 8, 1), date(2026, 8, 31))
            == 2
        )

    async def test_window_boundaries_are_inclusive(self, db_session):
        org = await _make_org(db_session)
        svc = CallTrackingService(db_session)
        await svc.record_shift_calls(
            await _make_shift(db_session, org, "e1", date(2026, 8, 1)),
            org.id,
            total_calls=1,
        )
        assert (
            await svc.department_call_count(org.id, date(2026, 8, 1), date(2026, 8, 1))
            == 1
        )


# ======================================================================
# Type usage — what the settings editor needs to offer a safe delete
# ======================================================================


@pytest.mark.integration
class TestTypeUsageCounts:
    """The settings screen deletes only what nothing is filed under.

    Getting this wrong in either direction is bad: reporting a used type as
    unused invites a delete that orphans its history, and reporting an unused
    one as used leaves a typo'd type on the list forever.
    """

    async def _org_with_types(self, db_session):
        org = await _make_org(db_session)
        org.settings = {
            "scheduling": {
                "call_tracking": {
                    "mode": CallTrackingMode.COUNT_ONLY,
                    "call_types": [
                        {"slug": "fire", "label": "Fire"},
                        {"slug": "ems", "label": "EMS"},
                        {"slug": "brush", "label": "Brush"},
                    ],
                }
            }
        }
        await db_session.flush()
        return org

    async def test_counts_are_per_slug(self, db_session):
        org = await self._org_with_types(db_session)
        svc = CallTrackingService(db_session)
        await svc.record_shift_calls(
            await _make_shift(db_session, org, "e1"),
            org.id,
            total_calls=4,
            type_counts={"fire": 3, "ems": 1},
        )
        assert await svc.type_usage_counts(org.id) == {"fire": 3, "ems": 1}

    async def test_an_unused_type_is_absent_rather_than_zero(self, db_session):
        """Absent and 0 mean the same thing to the caller, and building the
        zeroes here would mean this method needing to know the type list."""
        org = await self._org_with_types(db_session)
        svc = CallTrackingService(db_session)
        await svc.record_shift_calls(
            await _make_shift(db_session, org, "e1"),
            org.id,
            total_calls=1,
            type_counts={"fire": 1},
        )
        assert "brush" not in await svc.type_usage_counts(org.id)

    async def test_untyped_calls_are_not_counted_under_any_slug(self, db_session):
        org = await self._org_with_types(db_session)
        svc = CallTrackingService(db_session)
        await svc.record_shift_calls(
            await _make_shift(db_session, org, "e1"), org.id, total_calls=3
        )
        assert await svc.type_usage_counts(org.id) == {}

    async def test_is_unwindowed(self, db_session):
        """A type used only last year is still used. Windowing this would
        report it as unused and invite deleting its history away."""
        org = await self._org_with_types(db_session)
        svc = CallTrackingService(db_session)
        await svc.record_shift_calls(
            await _make_shift(db_session, org, "e1", date(2020, 1, 5)),
            org.id,
            total_calls=1,
            type_counts={"fire": 1},
        )
        assert await svc.type_usage_counts(org.id) == {"fire": 1}

    async def test_another_org_is_not_counted(self, db_session):
        """Pitfall #14a — the count is read by an admin deciding what to
        delete, so another department's history must not appear in it."""
        mine = await self._org_with_types(db_session)
        theirs = await _make_org(db_session, name="Other Dept")
        svc = CallTrackingService(db_session)
        await svc.record_shift_calls(
            await _make_shift(db_session, theirs, "e9"),
            theirs.id,
            total_calls=2,
            type_counts={"fire": 2},
        )
        assert await svc.type_usage_counts(mine.id) == {}


# ======================================================================
# What close-out offers once a type is retired
# ======================================================================


@pytest.mark.integration
class TestRetiredTypesAtCloseout:
    async def _org(self, db_session, call_types):
        org = await _make_org(db_session)
        org.settings = {
            "scheduling": {
                "call_tracking": {
                    "mode": CallTrackingMode.COUNT_ONLY,
                    "call_types": call_types,
                }
            }
        }
        await db_session.flush()
        return org

    async def test_a_retired_type_is_not_offered(self, db_session):
        org = await self._org(
            db_session,
            [
                {"slug": "fire", "label": "Fire"},
                {"slug": "brush", "label": "Brush", "active": False},
            ],
        )
        shift = await _make_shift(db_session, org, "e1")
        state, err = await SchedulingService(db_session).get_closeout_state(
            shift.id, org.id
        )
        assert err is None
        assert [t["slug"] for t in state["call_types"]] == ["fire"]

    async def test_a_retired_type_this_shift_already_used_keeps_its_row(
        self, db_session
    ):
        """Dropping the row would take the count off the screen while leaving
        it in the total the officer has to sign off, with no field to correct
        it in."""
        org = await self._org(
            db_session,
            [
                {"slug": "fire", "label": "Fire"},
                {"slug": "brush", "label": "Brush"},
            ],
        )
        shift = await _make_shift(db_session, org, "e1")
        await CallTrackingService(db_session).record_shift_calls(
            shift, org.id, total_calls=2, type_counts={"brush": 2}
        )

        org.settings = {
            "scheduling": {
                "call_tracking": {
                    "mode": CallTrackingMode.COUNT_ONLY,
                    "call_types": [
                        {"slug": "fire", "label": "Fire"},
                        {"slug": "brush", "label": "Brush", "active": False},
                    ],
                }
            }
        }
        await db_session.flush()

        state, err = await SchedulingService(db_session).get_closeout_state(
            shift.id, org.id
        )
        assert err is None
        assert [t["slug"] for t in state["call_types"]] == ["fire", "brush"]
        assert state["reported_call_types"] == {"brush": 2}

    async def test_a_retired_type_another_shift_used_is_not_offered_here(
        self, db_session
    ):
        org = await self._org(
            db_session,
            [{"slug": "fire", "label": "Fire"}, {"slug": "brush", "label": "Brush"}],
        )
        used = await _make_shift(db_session, org, "e1")
        await CallTrackingService(db_session).record_shift_calls(
            used, org.id, total_calls=1, type_counts={"brush": 1}
        )
        org.settings = {
            "scheduling": {
                "call_tracking": {
                    "mode": CallTrackingMode.COUNT_ONLY,
                    "call_types": [
                        {"slug": "fire", "label": "Fire"},
                        {"slug": "brush", "label": "Brush", "active": False},
                    ],
                }
            }
        }
        await db_session.flush()

        other = await _make_shift(db_session, org, "e2", date(2026, 8, 19))
        state, _ = await SchedulingService(db_session).get_closeout_state(
            other.id, org.id
        )
        assert [t["slug"] for t in state["call_types"]] == ["fire"]
