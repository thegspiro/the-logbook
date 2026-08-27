"""
Administration-page frame: registry invariants and slot resolution.

These are the parts of the frame that decide what an admin *sees* before any
query runs — which metrics a module offers, which of them survive into the four
slots, and what the attention card says about itself. They are pure, so they
are tested without a database; the resolvers that read one are exercised by the
endpoint tests.
"""

from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.exc import IntegrityError

from app.schemas.admin_hub import AdminAttentionItem, AdminMetricSettingsUpdate
from app.services.admin_hub_service import (
    ATTENTION_METRIC_KEY,
    MODULE_REGISTRY,
    OPEN_SLOTS,
    AdminHubService,
    MetricContext,
    MetricSpec,
    ModuleSpec,
    _attention_context,
    _fmt_hours,
    _fmt_int,
    _plural,
    _quarter_start,
    _waiting_phrase,
)


async def _stub_resolve(ctx: MetricContext) -> tuple[str, str]:
    return "n/a", ""


def make_context(
    enabled: set[str] | None = None,
    permissions: set[str] | None = None,
) -> MetricContext:
    """A context with no database — enough for every pure code path here."""
    return MetricContext(
        db=None,  # type: ignore[arg-type]
        organization_id="org-1",
        user=SimpleNamespace(
            positions=[
                SimpleNamespace(
                    permissions=list(
                        permissions
                        if permissions is not None
                        else {"members.manage", "medical_screening.view"}
                    )
                )
            ],
            rank=None,
        ),  # type: ignore[arg-type]
        today=date(2026, 8, 23),
        timezone_name="UTC",
        local_midnight=datetime(2026, 8, 23, tzinfo=timezone.utc),
        enabled_modules=(
            enabled
            if enabled is not None
            else {
                "members",
                "events",
                "training",
                "inventory",
                "prospective_members",
            }
        ),
    )


class TestRegistryInvariants:
    """The registry is the authority; a module that lies about itself would
    render a card that can never resolve."""

    @pytest.mark.parametrize("module_key", sorted(MODULE_REGISTRY))
    def test_defaults_name_metrics_the_module_actually_offers(self, module_key):
        spec = MODULE_REGISTRY[module_key]
        offered = {metric.key for metric in spec.metrics}
        assert len(spec.default_metrics) == OPEN_SLOTS
        for key in spec.default_metrics:
            assert key in offered, f"{module_key} defaults to a metric it lacks: {key}"

    @pytest.mark.parametrize("module_key", sorted(MODULE_REGISTRY))
    def test_metric_keys_are_unique_within_a_module(self, module_key):
        keys = [metric.key for metric in MODULE_REGISTRY[module_key].metrics]
        assert len(keys) == len(set(keys))

    @pytest.mark.parametrize("module_key", sorted(MODULE_REGISTRY))
    def test_the_attention_count_is_never_a_choosable_metric(self, module_key):
        # Slot four is what the page is for. Offering it as a choice would let
        # an admin fill two slots with the same number, or none with it.
        keys = {metric.key for metric in MODULE_REGISTRY[module_key].metrics}
        assert ATTENTION_METRIC_KEY not in keys

    @pytest.mark.parametrize("module_key", sorted(MODULE_REGISTRY))
    def test_defaults_never_depend_on_an_optional_module(self, module_key):
        # A default that needs an optional module leaves a fresh organization
        # with fewer than three slots filled before anyone has chosen anything.
        spec = MODULE_REGISTRY[module_key]
        by_key = {metric.key: metric for metric in spec.metrics}
        for key in spec.default_metrics:
            assert by_key[key].requires_module is None

    @pytest.mark.parametrize("module_key", sorted(MODULE_REGISTRY))
    def test_every_module_gates_on_its_own_manage_permission(self, module_key):
        assert MODULE_REGISTRY[module_key].permission.endswith(".manage")

    def test_get_module_rejects_a_name_it_does_not_have(self):
        with pytest.raises(ValueError, match="Unknown administration module"):
            AdminHubService.get_module("payroll")


class TestSlotResolution:
    """A stored selection outlives the module that fed it."""

    def setup_method(self):
        self.service = AdminHubService(db=None)  # type: ignore[arg-type]
        self.spec = MODULE_REGISTRY["members"]

    def test_a_saved_selection_is_kept_in_order(self):
        chosen = ["inactive_members", "active_members", "members_on_leave"]
        assert self.service._sanitize(self.spec, chosen, make_context()) == chosen

    def test_an_unknown_key_falls_back_to_the_module_default(self):
        resolved = self.service._sanitize(
            self.spec, ["active_members", "retired_hamsters"], make_context()
        )
        assert resolved[0] == "active_members"
        assert len(resolved) == OPEN_SLOTS
        assert "retired_hamsters" not in resolved

    def test_a_metric_whose_module_was_turned_off_is_dropped_not_blanked(self):
        # Prospects need the pipeline module. A department that turns it off
        # must not be left with a card that can never render.
        resolved = self.service._sanitize(
            self.spec,
            ["prospective_members", "active_members", "inactive_members"],
            make_context(enabled={"members"}),
        )
        assert "prospective_members" not in resolved
        assert len(resolved) == OPEN_SLOTS

    def test_a_metric_whose_permission_is_missing_is_dropped_not_rendered(self):
        resolved = self.service._sanitize(
            self.spec,
            ["screening_current", "active_members", "inactive_members"],
            make_context(permissions={"members.manage"}),
        )
        assert "screening_current" not in resolved
        assert len(resolved) == OPEN_SLOTS

    def test_members_attention_requires_medical_screening_access(self):
        assert self.spec.attention_permission == "medical_screening.view"

    def test_the_same_metric_cannot_occupy_two_slots(self):
        resolved = self.service._sanitize(
            self.spec,
            ["active_members", "active_members", "inactive_members"],
            make_context(),
        )
        assert resolved.count("active_members") == 1
        assert len(resolved) == OPEN_SLOTS

    def test_more_than_the_open_slots_is_truncated(self):
        resolved = self.service._sanitize(
            self.spec,
            [
                "active_members",
                "inactive_members",
                "members_on_leave",
                "screening_current",
            ],
            make_context(),
        )
        assert resolved == [
            "active_members",
            "inactive_members",
            "members_on_leave",
        ]

    def test_no_stored_selection_yields_the_module_default(self):
        # Absence means current behaviour, never "no metrics".
        assert self.service._sanitize(self.spec, [], make_context()) == list(
            self.spec.default_metrics
        )

    def test_padding_from_module_defaults_still_respects_permission_gates(self):
        # LOC2-32-2: the primary loop over the caller's stored selection
        # already drops a permission-gated key (see the test above); the
        # padding loop that tops slots back up from spec.default_metrics must
        # apply the same gate. Otherwise a gated default gets padded straight
        # into the resolved selection, and _render_metric's redacted-value
        # branch still shows that metric's *label* to an admin who lacks the
        # permission — this repo's "members" module has no gated default, so
        # this uses a purpose-built ModuleSpec to actually exercise the gate.
        gated_spec = ModuleSpec(
            key="test_module",
            permission="members.manage",
            attention=self.spec.attention,
            default_metrics=("open_slot", "gated_slot", "another_slot"),
            metrics=(
                MetricSpec(
                    key="open_slot",
                    label="Open",
                    description="",
                    resolve=_stub_resolve,
                ),
                MetricSpec(
                    key="gated_slot",
                    label="Gated",
                    description="",
                    resolve=_stub_resolve,
                    permission="medical_screening.view",
                ),
                MetricSpec(
                    key="another_slot",
                    label="Another",
                    description="",
                    resolve=_stub_resolve,
                ),
            ),
        )
        resolved = self.service._sanitize(
            gated_spec, ["open_slot"], make_context(permissions={"members.manage"})
        )
        assert "gated_slot" not in resolved
        assert resolved == ["open_slot", "another_slot"]


def _mock_db_with_no_existing_preferences() -> MagicMock:
    """A db whose _load_preferences query always finds no stored row —
    matching what two concurrent first-time saves both observe."""
    db = MagicMock()
    result = MagicMock()
    result.scalars.return_value.all.return_value = []
    db.execute = AsyncMock(return_value=result)
    db.add = MagicMock()
    db.rollback = AsyncMock()
    db.refresh = AsyncMock()
    return db


class TestSaveSettingsFirstInsertRace:
    """LOC2-32-3: two concurrent first-time saves for the same (org, module,
    scope) can both observe no existing row and both attempt to insert,
    tripping the uq_admin_hub_metric_pref_scope unique constraint on the
    second commit. save_settings must retry as an update rather than
    surfacing the IntegrityError as a 500 that silently drops the save.
    db mocked — the DB-backed test fixture wraps each test in one rolled-back
    transaction, which cannot host two independently-committing sessions, so
    this exercises the retry loop directly rather than a live two-connection
    race (see CLAUDE.md pitfall #27 / test_capacity_locking.py for why this
    codebase verifies such shapes statically or via mocks rather than a live
    race)."""

    def setup_method(self):
        self.spec = MODULE_REGISTRY["members"]
        self.ctx = make_context(permissions={"members.manage"})
        # _load_preferences/save_settings key the personal row on user.id,
        # which make_context()'s bare SimpleNamespace doesn't carry.
        self.ctx.user.id = "user-1"
        self.payload = AdminMetricSettingsUpdate(
            metric_keys=["active_members"], applies_to_everyone=True
        )

    async def test_a_conflicting_first_commit_retries_and_succeeds(self, monkeypatch):
        db = _mock_db_with_no_existing_preferences()
        commit_calls = {"n": 0}

        async def flaky_commit():
            commit_calls["n"] += 1
            if commit_calls["n"] == 1:
                raise IntegrityError("insert", {}, Exception("Duplicate entry"))

        db.commit = AsyncMock(side_effect=flaky_commit)

        service = AdminHubService(db)
        monkeypatch.setattr(service, "_context", AsyncMock(return_value=self.ctx))
        monkeypatch.setattr(
            service, "get_settings", AsyncMock(return_value="final-settings")
        )

        result = await service.save_settings("members", self.ctx.user, self.payload)

        assert commit_calls["n"] == 2
        db.rollback.assert_awaited_once()
        # rollback() expires every persistent object in the session,
        # including ctx.user — refreshed so the retry's own permission
        # check (and the caller's later attribute reads, e.g. an audit-log
        # call) don't hit an expired attribute (Codex, PR #1916).
        assert db.refresh.await_count == 2
        db.refresh.assert_any_await(self.ctx.user)
        db.refresh.assert_any_await(self.ctx.user, attribute_names=["positions"])
        assert result == "final-settings"

    async def test_a_second_conflict_on_the_retry_still_raises(self, monkeypatch):
        # A retry is a mitigation, not a guarantee — two conflicts in a row
        # must not loop forever or swallow the error silently.
        db = _mock_db_with_no_existing_preferences()
        db.commit = AsyncMock(
            side_effect=IntegrityError("insert", {}, Exception("Duplicate entry"))
        )

        service = AdminHubService(db)
        monkeypatch.setattr(service, "_context", AsyncMock(return_value=self.ctx))

        with pytest.raises(IntegrityError):
            await service.save_settings("members", self.ctx.user, self.payload)

        assert db.commit.await_count == 2
        assert db.rollback.await_count == 2
        assert db.refresh.await_count == 4  # user + positions, each attempt


class TestAttentionCardCopy:
    def test_an_empty_queue_says_nothing_is_waiting(self):
        assert _attention_context([]) == "nothing waiting"

    def test_the_card_reports_the_oldest_thing_in_the_queue(self):
        items = [
            AdminAttentionItem(
                key="a", title="A", action_label="Go", href="/", oldest_age_days=3
            ),
            AdminAttentionItem(
                key="b", title="B", action_label="Go", href="/", oldest_age_days=9
            ),
        ]
        assert _attention_context(items) == "oldest waiting 9 days"

    def test_an_ageless_queue_falls_back_to_counting_exceptions(self):
        items = [
            AdminAttentionItem(key="a", title="A", action_label="Go", href="/"),
            AdminAttentionItem(key="b", title="B", action_label="Go", href="/"),
        ]
        assert _attention_context(items) == "2 exceptions"


class TestFormatting:
    def test_one_day_is_not_pluralised(self):
        assert _waiting_phrase(1) == "oldest waiting 1 day"

    def test_everything_opened_today_says_so_rather_than_zero_days(self):
        assert _waiting_phrase(0) == "all opened today"

    def test_no_age_produces_no_phrase(self):
        assert _waiting_phrase(None) == ""

    def test_counts_carry_thousands_separators(self):
        assert _fmt_int(1840) == "1,840"
        assert _fmt_int(None) == "0"

    def test_small_hour_totals_keep_a_decimal_and_large_ones_drop_it(self):
        assert _fmt_hours(31.5) == "31.5"
        assert _fmt_hours(1840) == "1,840"

    def test_plural_uses_the_supplied_irregular_form(self):
        assert _plural(1, "entry", "entries") == "entry"
        assert _plural(2, "entry", "entries") == "entries"

    @pytest.mark.parametrize(
        ("today", "expected"),
        [
            (date(2026, 1, 5), date(2026, 1, 1)),
            (date(2026, 3, 31), date(2026, 1, 1)),
            (date(2026, 4, 1), date(2026, 4, 1)),
            (date(2026, 8, 23), date(2026, 7, 1)),
            (date(2026, 12, 31), date(2026, 10, 1)),
        ],
    )
    def test_quarter_start(self, today, expected):
        assert _quarter_start(today) == expected
