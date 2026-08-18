"""
Equipment Readiness Service Unit Tests

Covers the three reconstruction rules the check log depends on, each of which
produces a plausible-looking wrong number when it is got subtly wrong:

1. Grid columns are shared duty dates, but a completion rate is measured
   against the checks *that apparatus* expected — otherwise a rig on a weekly
   check reads as neglected next to one checked twice a day.
2. Out of service is excluded from the denominator, not counted as missed.
3. A check that never happened has to exist as a row; ``shift_equipment_checks``
   alone can never report below 100%.

Mocked sessions — no DB — so it runs in the sandbox, matching
test_equipment_check_service.py.
"""

from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.services.equipment_readiness_service import (
    READY_ATTENTION,
    READY_IN_SERVICE,
    READY_NO_CHECKS,
    READY_OUT_OF_SERVICE,
    STATUS_DUE,
    STATUS_FAILED,
    STATUS_MISSED,
    STATUS_OUT_OF_SERVICE,
    STATUS_PARTIAL,
    STATUS_PASSED,
    STATUS_SCHEDULED,
    EquipmentReadinessService,
    FleetUnit,
    _Occasion,
    _worst,
)

TODAY = date(2026, 8, 16)


@pytest.fixture
def mock_db():
    db = AsyncMock()
    db.execute = AsyncMock()
    return db


@pytest.fixture
def service(mock_db):
    return EquipmentReadinessService(mock_db)


def make_unit(key="e1", label="E-1", full_id="e1", type_slug="engine", **kwargs):
    return FleetUnit(
        key=key, label=label, full_id=full_id, type_slug=type_slug, **kwargs
    )


def make_check(
    status="pass",
    failed=0,
    items=(),
    checked_by="user-1",
    checked_at=None,
    check_id="chk-1",
):
    return SimpleNamespace(
        id=check_id,
        overall_status=status,
        failed_items=failed,
        total_items=10,
        completed_items=10,
        checked_by=checked_by,
        checked_at=checked_at or datetime(2026, 8, 16, 7, 12, tzinfo=timezone.utc),
        items=[SimpleNamespace(status=s, item_name=n) for s, n in items],
    )


def make_occasion(day, status, unit_key="e1", template_id="t1", check=None, findings=0):
    return _Occasion(
        shift_id=f"shift-{day}",
        shift_date=day,
        unit_key=unit_key,
        template_id=template_id,
        template_name="Engine Daily Check",
        check_timing="start_of_shift",
        check=check,
        status=status,
        finding_count=findings,
    )


class TestStatusDerivation:
    def test_out_of_service_item_outranks_a_plain_failure(self):
        check = make_check(
            status="fail",
            failed=2,
            items=(("fail", "Light"), ("out_of_service", "Spreader")),
        )
        assert EquipmentReadinessService._status_for_check(check) == (
            STATUS_OUT_OF_SERVICE
        )

    def test_failed_items_marks_the_check_failed(self):
        check = make_check(status="fail", failed=1, items=(("fail", "Light"),))
        assert EquipmentReadinessService._status_for_check(check) == STATUS_FAILED

    def test_incomplete_is_partial_not_failed(self):
        check = make_check(status="incomplete", failed=0)
        assert EquipmentReadinessService._status_for_check(check) == STATUS_PARTIAL

    def test_clean_check_passes(self):
        check = make_check(status="pass", failed=0, items=(("pass", "Light"),))
        assert EquipmentReadinessService._status_for_check(check) == STATUS_PASSED

    def test_worst_collapses_a_day_to_its_most_severe_outcome(self):
        assert _worst([STATUS_PASSED, STATUS_MISSED]) == STATUS_MISSED
        assert _worst([STATUS_FAILED, STATUS_OUT_OF_SERVICE]) == STATUS_OUT_OF_SERVICE
        assert _worst([STATUS_PASSED, STATUS_PASSED]) == STATUS_PASSED

    def test_worst_of_nothing_is_scheduled_not_missed(self):
        """A date with no expected check is idle, not a failure to check."""
        assert _worst([]) == STATUS_SCHEDULED


class TestCompletionRate:
    """Rule 2 — out of service leaves the denominator."""

    def test_out_of_service_days_excluded_from_denominator(self):
        occasions = [
            make_occasion(date(2026, 8, 10), STATUS_PASSED),
            make_occasion(date(2026, 8, 11), STATUS_OUT_OF_SERVICE),
            make_occasion(date(2026, 8, 12), STATUS_OUT_OF_SERVICE),
        ]
        owed, done = EquipmentReadinessService._rate_parts(occasions)
        assert (owed, done) == (1, 1)
        assert EquipmentReadinessService._rate(owed, done) == 100.0

    def test_missed_days_do_count_against_the_rate(self):
        occasions = [
            make_occasion(date(2026, 8, 10), STATUS_PASSED),
            make_occasion(date(2026, 8, 11), STATUS_MISSED),
        ]
        owed, done = EquipmentReadinessService._rate_parts(occasions)
        assert (owed, done) == (2, 1)
        assert EquipmentReadinessService._rate(owed, done) == 50.0

    def test_a_check_not_yet_owed_is_not_held_against_anyone(self):
        occasions = [
            make_occasion(date(2026, 8, 16), STATUS_DUE),
            make_occasion(date(2026, 8, 17), STATUS_SCHEDULED),
        ]
        assert EquipmentReadinessService._rate_parts(occasions) == (0, 0)
        assert EquipmentReadinessService._rate(0, 0) is None

    def test_a_started_but_unfinished_check_is_owed_and_not_done(self):
        occasions = [make_occasion(date(2026, 8, 10), STATUS_PARTIAL)]
        assert EquipmentReadinessService._rate_parts(occasions) == (1, 0)


class TestAvailabilityReconstruction:
    """Rule 2's other half — availability comes from history, not current
    status, so a rig that has since come back still shows its down days."""

    async def test_down_interval_is_reconstructed_from_history(self, service, mock_db):
        oos = SimpleNamespace(
            apparatus_id="e2", changed_at=datetime(2026, 8, 11, 8, tzinfo=timezone.utc)
        )
        back = SimpleNamespace(
            apparatus_id="e2", changed_at=datetime(2026, 8, 14, 9, tzinfo=timezone.utc)
        )
        result = SimpleNamespace(all=lambda: [(oos, False), (back, True)])
        mock_db.execute.return_value = result

        fleet = {"e2": make_unit(key="e2", label="E-2", full_id="e2")}
        down = await service._unavailable_dates(
            "org-1", fleet, date(2026, 8, 10), date(2026, 8, 16)
        )

        assert down["e2"] == {date(2026, 8, 11), date(2026, 8, 12), date(2026, 8, 13)}
        # Came back on the 14th, so the rig is on the hook again from then.
        assert date(2026, 8, 14) not in down["e2"]
        assert date(2026, 8, 10) not in down["e2"]

    async def test_no_history_falls_back_to_current_status(self, service, mock_db):
        mock_db.execute.return_value = SimpleNamespace(all=lambda: [])
        fleet = {
            "e2": make_unit(key="e2", label="E-2", full_id="e2", status_available=False)
        }
        down = await service._unavailable_dates(
            "org-1", fleet, date(2026, 8, 15), date(2026, 8, 16)
        )
        assert down["e2"] == {date(2026, 8, 15), date(2026, 8, 16)}

    async def test_basic_apparatus_has_no_status_history_to_read(
        self, service, mock_db
    ):
        """BasicApparatus carries no status record, so nothing is excluded and
        the query is skipped entirely."""
        fleet = {"b7": make_unit(key="b7", label="B-7", full_id=None)}
        down = await service._unavailable_dates(
            "org-1", fleet, date(2026, 8, 15), date(2026, 8, 16)
        )
        assert down == {}
        mock_db.execute.assert_not_awaited()

    def test_state_entering_uses_the_last_change_before_the_window(self):
        changes = [
            (date(2026, 8, 1), False),
            (date(2026, 8, 5), True),
            (date(2026, 8, 20), False),
        ]
        assert (
            EquipmentReadinessService._state_entering(changes, date(2026, 8, 10), True)
            is True
        )
        assert (
            EquipmentReadinessService._state_entering(changes, date(2026, 8, 3), True)
            is False
        )


class TestTemplateResolution:
    def test_apparatus_specific_templates_replace_the_type_default(self):
        specific = SimpleNamespace(id="t-specific")
        generic = SimpleNamespace(id="t-generic")
        resolved = EquipmentReadinessService._templates_for(
            make_unit(),
            {"e1": [specific]},
            {"engine": [generic]},
        )
        assert resolved == [specific]

    def test_type_templates_used_when_no_specific_one_exists(self):
        generic = SimpleNamespace(id="t-generic")
        resolved = EquipmentReadinessService._templates_for(
            make_unit(), {}, {"engine": [generic]}
        )
        assert resolved == [generic]

    def test_basic_apparatus_can_only_match_by_type(self):
        """A BasicApparatus id can never match an apparatus-scoped template —
        that FK targets the full apparatus table."""
        generic = SimpleNamespace(id="t-generic")
        unit = make_unit(key="b7", label="B-7", full_id=None, type_slug="brush")
        assert EquipmentReadinessService._templates_for(
            unit, {"b7": [SimpleNamespace(id="wrong")]}, {"brush": [generic]}
        ) == [generic]


class TestBuildOccasions:
    """Rule 3 — a check that did not happen has to become a row."""

    @staticmethod
    def _patched(service, shifts, templates_by_type, checks=None, unavailable=None):
        mock_result = SimpleNamespace(
            scalars=lambda: SimpleNamespace(all=lambda: shifts)
        )
        service.db.execute.return_value = mock_result
        return (
            patch.object(
                service,
                "_load_templates",
                new_callable=AsyncMock,
                return_value=({}, templates_by_type),
            ),
            patch.object(
                service,
                "_load_checks",
                new_callable=AsyncMock,
                return_value=checks or {},
            ),
            patch.object(
                service,
                "_unavailable_dates",
                new_callable=AsyncMock,
                return_value=unavailable or {},
            ),
        )

    @staticmethod
    def _shift(day, apparatus="e1"):
        return SimpleNamespace(
            id=f"shift-{apparatus}-{day}", shift_date=day, apparatus_id=apparatus
        )

    @staticmethod
    def _template(tid="t1", name="Engine Daily Check", timing="start_of_shift"):
        return SimpleNamespace(id=tid, name=name, check_timing=timing)

    async def test_unsubmitted_past_check_becomes_a_missed_occasion(self, service):
        shifts = [self._shift(date(2026, 8, 14)), self._shift(date(2026, 8, 15))]
        fleet = {"e1": make_unit()}
        patches = self._patched(service, shifts, {"engine": [self._template()]})
        with patches[0], patches[1], patches[2]:
            occasions, columns = await service._build_occasions(
                "org-1", fleet, 7, TODAY
            )

        assert len(occasions) == 2
        assert {o.status for o in occasions} == {STATUS_MISSED}
        assert columns == [date(2026, 8, 14), date(2026, 8, 15)]

    async def test_todays_unsubmitted_check_is_due_not_missed(self, service):
        shifts = [self._shift(TODAY)]
        fleet = {"e1": make_unit()}
        patches = self._patched(service, shifts, {"engine": [self._template()]})
        with patches[0], patches[1], patches[2]:
            occasions, _ = await service._build_occasions("org-1", fleet, 7, TODAY)
        assert occasions[0].status == STATUS_DUE

    async def test_out_of_service_day_is_not_a_missed_check(self, service):
        shifts = [self._shift(date(2026, 8, 12))]
        fleet = {"e1": make_unit()}
        patches = self._patched(
            service,
            shifts,
            {"engine": [self._template()]},
            unavailable={"e1": {date(2026, 8, 12)}},
        )
        with patches[0], patches[1], patches[2]:
            occasions, _ = await service._build_occasions("org-1", fleet, 7, TODAY)
        assert occasions[0].status == STATUS_OUT_OF_SERVICE

    async def test_submitted_check_carries_its_findings(self, service):
        day = date(2026, 8, 15)
        shifts = [self._shift(day)]
        fleet = {"e1": make_unit()}
        check = make_check(
            status="fail", failed=1, items=(("fail", "SCBA bottle #4"), ("pass", "Ax"))
        )
        patches = self._patched(
            service,
            shifts,
            {"engine": [self._template()]},
            checks={(f"shift-e1-{day}", "t1"): check},
        )
        with patches[0], patches[1], patches[2]:
            occasions, _ = await service._build_occasions("org-1", fleet, 7, TODAY)

        assert occasions[0].status == STATUS_FAILED
        assert occasions[0].finding_count == 1
        assert occasions[0].findings == ["SCBA bottle #4"]

    async def test_columns_trim_to_the_most_recent_duty_days(self, service):
        shifts = [self._shift(TODAY - timedelta(days=n)) for n in range(10)]
        fleet = {"e1": make_unit()}
        patches = self._patched(service, shifts, {"engine": [self._template()]})
        with patches[0], patches[1], patches[2]:
            _, columns = await service._build_occasions("org-1", fleet, 3, TODAY)

        assert columns == [
            TODAY - timedelta(days=2),
            TODAY - timedelta(days=1),
            TODAY,
        ]

    async def test_a_rig_with_no_template_produces_no_expected_checks(self, service):
        """A shift on a rig nobody configured a checklist for is not a missed
        check — it is a rig with no checklist."""
        shifts = [self._shift(date(2026, 8, 15))]
        fleet = {"e1": make_unit()}
        patches = self._patched(service, shifts, {})
        with patches[0], patches[1], patches[2]:
            occasions, columns = await service._build_occasions(
                "org-1", fleet, 7, TODAY
            )
        assert occasions == []
        assert columns == []


class TestGridAndRates:
    """Rule 1 — shared columns, per-apparatus denominators."""

    def test_weekly_rig_scores_full_marks_against_its_own_occasions(self, service):
        columns = [TODAY - timedelta(days=n) for n in range(13, -1, -1)]
        daily = [make_occasion(day, STATUS_PASSED, unit_key="e1") for day in columns]
        weekly = [
            make_occasion(TODAY - timedelta(days=7), STATUS_PASSED, unit_key="b7"),
            make_occasion(TODAY, STATUS_PASSED, unit_key="b7"),
        ]
        fleet = {
            "e1": make_unit(),
            "b7": make_unit(key="b7", label="B-7", full_id=None, type_slug="brush"),
        }

        rows = service._grid_rows(fleet, daily + weekly, columns)
        by_unit = {r["unit_label"]: r for r in rows}

        assert by_unit["E-1"]["completion_rate"] == 100.0
        assert by_unit["B-7"]["completion_rate"] == 100.0
        # Same shared columns for both, sparsely filled for the weekly rig.
        assert len(by_unit["B-7"]["cells"]) == len(columns)
        filled = [c for c in by_unit["B-7"]["cells"] if c["status"] is not None]
        assert len(filled) == 2
        assert by_unit["B-7"]["expected"] == 2

    def test_cell_lists_both_checks_start_before_end(self, service):
        day = TODAY
        start = make_occasion(day, STATUS_PASSED)
        end = _Occasion(
            shift_id="s1",
            shift_date=day,
            unit_key="e1",
            template_id="t2",
            template_name="Engine Close-Out",
            check_timing="end_of_shift",
            status=STATUS_PASSED,
        )
        rows = service._grid_rows({"e1": make_unit()}, [end, start], [day])
        timings = [c["check_timing"] for c in rows[0]["cells"][0]["checks"]]
        assert timings == ["start_of_shift", "end_of_shift"]

    def test_apparatus_with_no_occasions_is_left_out_of_the_grid(self, service):
        fleet = {"e1": make_unit(), "m2": make_unit(key="m2", label="M-2")}
        rows = service._grid_rows(
            fleet, [make_occasion(TODAY, STATUS_PASSED, unit_key="e1")], [TODAY]
        )
        assert [r["unit_label"] for r in rows] == ["E-1"]


class TestLogEntries:
    def test_missed_checks_appear_as_entries_without_a_check_id(self, service):
        occasions = [
            make_occasion(date(2026, 8, 14), STATUS_MISSED),
            make_occasion(date(2026, 8, 15), STATUS_PASSED, check=make_check()),
        ]
        entries = service._log_entries({"e1": make_unit()}, occasions, None)
        missed = [e for e in entries if e["status"] == STATUS_MISSED]
        assert len(missed) == 1
        assert missed[0]["check_id"] is None
        assert missed[0]["unit_label"] == "E-1"

    def test_upcoming_checks_are_not_log_lines(self, service):
        occasions = [
            make_occasion(TODAY, STATUS_DUE),
            make_occasion(TODAY + timedelta(days=1), STATUS_SCHEDULED),
        ]
        assert service._log_entries({"e1": make_unit()}, occasions, None) == []

    def test_own_scope_keeps_only_that_members_checks(self, service):
        mine = make_occasion(
            date(2026, 8, 15), STATUS_PASSED, check=make_check(checked_by="me")
        )
        theirs = make_occasion(
            date(2026, 8, 14), STATUS_PASSED, check=make_check(checked_by="them")
        )
        missed = make_occasion(date(2026, 8, 13), STATUS_MISSED)
        entries = service._log_entries(
            {"e1": make_unit()}, [mine, theirs, missed], "me"
        )
        assert len(entries) == 1
        assert entries[0]["checked_by"] == "me"

    def test_entries_are_newest_first(self, service):
        occasions = [
            make_occasion(date(2026, 8, 12), STATUS_MISSED),
            make_occasion(date(2026, 8, 15), STATUS_MISSED),
            make_occasion(date(2026, 8, 13), STATUS_MISSED),
        ]
        entries = service._log_entries({"e1": make_unit()}, occasions, None)
        assert [e["shift_date"] for e in entries] == [
            "2026-08-15",
            "2026-08-13",
            "2026-08-12",
        ]


class TestOpenFindings:
    async def test_only_the_latest_check_per_template_counts(self, service):
        """A fault found on Monday and clear on Tuesday is not still open."""
        monday = make_occasion(
            date(2026, 8, 10),
            STATUS_FAILED,
            check=make_check(status="fail", failed=1, items=(("fail", "Light"),)),
        )
        tuesday = make_occasion(
            date(2026, 8, 11),
            STATUS_PASSED,
            check=make_check(status="pass", items=(("pass", "Light"),)),
        )
        counts = await service._open_findings(
            "org-1", {"e1": make_unit()}, [monday, tuesday]
        )
        assert counts["e1"] == {"failed": 0, "out_of_service": 0}

    async def test_out_of_service_items_counted_separately(self, service):
        latest = make_occasion(
            date(2026, 8, 15),
            STATUS_OUT_OF_SERVICE,
            check=make_check(
                status="fail",
                failed=2,
                items=(("out_of_service", "Spreader"), ("fail", "Light")),
            ),
        )
        counts = await service._open_findings("org-1", {"e1": make_unit()}, [latest])
        assert counts["e1"] == {"failed": 1, "out_of_service": 1}


class TestVerdict:
    @staticmethod
    def _verdict(
        unit=None, occasions=None, findings=None, overdue=0, due=0, part=False
    ):
        return EquipmentReadinessService._verdict(
            unit or make_unit(),
            occasions if occasions is not None else [make_occasion(TODAY, STATUS_DUE)],
            findings or {"failed": 0, "out_of_service": 0},
            overdue,
            due,
            part,
        )

    def test_apparatus_status_takes_the_rig_off_the_road(self):
        unit = make_unit(status_available=False, status_label="Out of Service")
        readiness, reason = self._verdict(unit=unit)
        assert readiness == READY_OUT_OF_SERVICE
        assert "Out of Service" in reason

    def test_out_of_service_item_takes_the_rig_off_the_road(self):
        readiness, reason = self._verdict(findings={"failed": 0, "out_of_service": 1})
        assert readiness == READY_OUT_OF_SERVICE
        assert reason == "1 item marked out of service on the last check."

    def test_no_templates_reads_as_no_checks_not_as_healthy(self):
        readiness, reason = self._verdict(occasions=[])
        assert readiness == READY_NO_CHECKS
        assert "No check templates" in reason

    def test_missed_check_needs_attention(self):
        readiness, reason = self._verdict(overdue=2)
        assert readiness == READY_ATTENTION
        assert reason == "2 checks missed."

    def test_failed_item_needs_attention(self):
        readiness, reason = self._verdict(findings={"failed": 1, "out_of_service": 0})
        assert readiness == READY_ATTENTION
        assert reason == "1 item failed on the last check."

    def test_unfinished_check_needs_attention(self):
        readiness, _ = self._verdict(part=True)
        assert readiness == READY_ATTENTION

    def test_a_check_merely_due_today_is_still_in_service(self):
        readiness, reason = self._verdict(due=1)
        assert readiness == READY_IN_SERVICE
        assert reason == "1 check due today."

    def test_clean_rig_is_in_service(self):
        readiness, reason = self._verdict()
        assert readiness == READY_IN_SERVICE
        assert reason == "Checks current, nothing outstanding."

    def test_every_verdict_carries_a_reason(self):
        """The pill is a claim the app makes; it never ships bare."""
        for kwargs in (
            {"unit": make_unit(status_available=False)},
            {"findings": {"failed": 0, "out_of_service": 1}},
            {"occasions": []},
            {"overdue": 1},
            {"findings": {"failed": 1, "out_of_service": 0}},
            {"part": True},
            {"due": 1},
            {},
        ):
            _, reason = self._verdict(**kwargs)
            assert reason
            assert reason.endswith(".")


class TestCheckLogScope:
    async def test_member_scope_withholds_the_grid(self, service):
        """A matrix of one member's checks would read as fleet coverage."""
        with (
            patch.object(
                service,
                "_load_fleet",
                new_callable=AsyncMock,
                return_value={"e1": make_unit()},
            ),
            patch.object(
                service,
                "_build_occasions",
                new_callable=AsyncMock,
                return_value=(
                    [
                        make_occasion(
                            date(2026, 8, 15),
                            STATUS_PASSED,
                            check=make_check(checked_by="me"),
                        )
                    ],
                    [date(2026, 8, 15)],
                ),
            ),
        ):
            payload = await service.get_check_log(
                "org-1", dates=7, only_user_id="me", today=TODAY
            )

        assert payload["scope"] == "own"
        assert payload["rows"] == []
        assert len(payload["entries"]) == 1

    async def test_fleet_scope_returns_the_grid(self, service):
        with (
            patch.object(
                service,
                "_load_fleet",
                new_callable=AsyncMock,
                return_value={"e1": make_unit()},
            ),
            patch.object(
                service,
                "_build_occasions",
                new_callable=AsyncMock,
                return_value=(
                    [make_occasion(date(2026, 8, 15), STATUS_PASSED)],
                    [date(2026, 8, 15)],
                ),
            ),
        ):
            payload = await service.get_check_log("org-1", dates=7, today=TODAY)

        assert payload["scope"] == "fleet"
        assert len(payload["rows"]) == 1
        assert payload["dates"] == ["2026-08-15"]

    async def test_window_is_clamped_to_the_supported_range(self, service):
        with (
            patch.object(
                service, "_load_fleet", new_callable=AsyncMock, return_value={}
            ),
        ):
            payload = await service.get_check_log("org-1", dates=5000, today=TODAY)
        assert payload["window_dates"] == 90

    async def test_no_fleet_returns_an_empty_payload_not_an_error(self, service):
        with patch.object(
            service, "_load_fleet", new_callable=AsyncMock, return_value={}
        ):
            payload = await service.get_check_log("org-1", today=TODAY)
        assert payload["entries"] == []
        assert payload["summary"]["expected"] == 0


class TestSummary:
    def test_summary_counts_the_window(self, service):
        occasions = [
            make_occasion(date(2026, 8, 10), STATUS_PASSED, check=make_check()),
            make_occasion(
                date(2026, 8, 11),
                STATUS_FAILED,
                check=make_check(status="fail", failed=1),
                findings=1,
            ),
            make_occasion(date(2026, 8, 12), STATUS_MISSED),
            make_occasion(date(2026, 8, 13), STATUS_OUT_OF_SERVICE),
        ]
        summary = service._log_summary(occasions, None)
        assert summary["expected"] == 3
        assert summary["completed"] == 2
        assert summary["missed"] == 1
        assert summary["with_findings"] == 1
        assert summary["out_of_service_days"] == 1
        assert summary["completion_rate"] == pytest.approx(66.7)


class TestUserNameResolution:
    async def test_names_filled_for_apparatus_and_entries(self, service, mock_db):
        user = SimpleNamespace(id="u1", first_name="Kelly", last_name="Moreno")
        mock_db.execute.return_value = SimpleNamespace(
            scalars=lambda: SimpleNamespace(all=lambda: [user])
        )
        payload = {
            "apparatus": [{"last_check_by": "u1", "last_check_by_name": None}],
            "entries": [{"checked_by": "u1", "checked_by_name": None}],
        }
        resolved = await service.resolve_user_names(payload)
        assert resolved["apparatus"][0]["last_check_by_name"] == "Kelly Moreno"
        assert resolved["entries"][0]["checked_by_name"] == "Kelly Moreno"

    async def test_no_ids_skips_the_query(self, service, mock_db):
        payload = {"apparatus": [{"last_check_by": None}], "entries": []}
        await service.resolve_user_names(payload)
        mock_db.execute.assert_not_awaited()
