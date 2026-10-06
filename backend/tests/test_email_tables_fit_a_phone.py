"""
Service-built email tables fit a phone-width card.

A phone gives an email card roughly 300px. Tables of five or six columns ran
past it, pushing the right-hand columns — the value, the vote count, the
quantity the reader acts on — off the screen. Each table now carries three
columns at most, with secondary detail (serial number, category, percentage)
set as a grey line under the value it qualifies. These tests pin the column
count, that the detail moved rather than vanished, and that it is escaped.

Mocked sessions and mail — no DB.
"""

from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models.user import Organization
from app.services.election_service import ElectionService
from app.services.email_template_service import build_items_list_html
from app.services.email_theme import SUBLINE_STYLE, with_subline
from app.services.inventory_service import InventoryService
from app.services.scheduled_tasks import (
    run_inventory_low_stock_alerts,
    run_nfpa_retirement_alerts,
)
from app.utils.org_timezone import org_today

pytestmark = pytest.mark.unit


def _columns(html: str) -> int:
    return html.count("<th ")


class TestWithSubline:
    def test_stacks_the_secondary_line(self):
        assert with_subline("A", "B") == (
            f'A<br><span style="{SUBLINE_STYLE}">B</span>'
        )

    def test_an_empty_secondary_leaves_no_blank_line(self):
        assert with_subline("A", "") == "A"


class TestOutstandingPropertyTable:
    """Shared by the property-return reminder and the member-dropped notice."""

    def _items(self):
        return [
            {
                "name": "Turnout Coat",
                "serial_number": "GX-2024-0045612",
                "asset_tag": "TCOAT-0123",
                "value": 2450.0,
                "condition": "good",
            }
        ]

    def test_reminder_has_two_columns(self):
        html = build_items_list_html(self._items(), 2450.0)
        assert _columns(html) == 2
        assert "Condition" not in html
        for gone in (">#<", ">Serial #<", ">Asset Tag<"):
            assert gone not in html
        assert "S/N GX-2024-0045612<br>Tag TCOAT-0123" in html
        assert 'colspan="1"' in html

    def test_dropped_notice_puts_condition_under_the_item(self):
        html = build_items_list_html(self._items(), 2450.0, include_condition=True)
        assert _columns(html) == 2
        assert ">Condition<" not in html
        assert "Condition: Good<br>S/N GX-2024-0045612<br>Tag TCOAT-0123" in html
        assert 'colspan="1"' in html

    def test_a_missing_identifier_is_left_out(self):
        html = build_items_list_html(
            [{"name": "Radio", "serial_number": None, "asset_tag": "-", "value": 1}],
            1,
        )
        assert "S/N" not in html
        assert "Tag" not in html
        assert "None" not in html

    def test_identifiers_are_escaped(self):
        html = build_items_list_html(
            [
                {
                    "name": "x",
                    "serial_number": "<i>1</i>",
                    "asset_tag": "a&b",
                    "value": 0,
                }
            ],
            0,
        )
        assert "<i>1</i>" not in html
        assert "S/N &lt;i&gt;1&lt;/i&gt;<br>Tag a&amp;b" in html


def _cand(name, votes, pct, winner=False, tied=False):
    return SimpleNamespace(
        candidate_name=name,
        vote_count=votes,
        percentage=pct,
        is_winner=winner,
        is_tied=tied,
    )


class TestElectionResultsTable:
    def _html(self, is_tie=False):
        results = SimpleNamespace(
            results_by_position=[
                SimpleNamespace(
                    label="Lieutenant <A>",
                    position="pos-1",
                    is_tie=is_tie,
                    candidates=[
                        _cand("Blair", 22, 57.9, winner=True),
                        _cand("Devon", 16, 42.1),
                    ],
                )
            ],
            tie_policy="co_winners",
        )
        html, _ = ElectionService(MagicMock())._build_results_tables(results)
        return html

    def test_three_columns_with_the_position_as_a_heading_row(self):
        html = self._html()
        assert _columns(html) == 3
        assert ">Position<" not in html
        assert ">%<" not in html
        # Once per position, not repeated on every candidate row.
        assert html.count("Lieutenant &lt;A&gt;") == 1
        assert 'colspan="3"' in html

    def test_percentage_rides_under_the_vote_count(self):
        assert with_subline("22", "57.9%") in self._html()

    def test_tie_outcome_spans_the_new_width(self):
        html = self._html(is_tie=True)
        assert 'colspan="5"' not in html


class _CaptureEmail:
    sent: list = []

    def __init__(self, organization=None):
        pass

    async def send_email(self, **kwargs):
        _CaptureEmail.sent.append(kwargs)
        return (len(kwargs["to_emails"]), 0)


def _orgs_result():
    result = MagicMock()
    result.scalars.return_value.all.return_value = [
        Organization(id="org-1", name="Test FD")
    ]
    return result


def _officer():
    return SimpleNamespace(
        id="qm1",
        email="qm@fd.example",
        roles=[SimpleNamespace(permissions=["inventory.manage"])],
        notification_preferences=None,
    )


class TestLowStockTable:
    async def test_category_moves_under_the_item(self):
        _CaptureEmail.sent = []
        users = MagicMock()
        users.scalars.return_value.all.return_value = [_officer()]
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_orgs_result(), users])
        db.rollback = AsyncMock()
        item = SimpleNamespace(
            name="Gloves <L>",
            reorder_point=10,
            category=SimpleNamespace(name="PPE & Gear", item_type=None),
        )
        with patch.object(
            InventoryService,
            "get_low_stock_items_for_alerts",
            new=AsyncMock(return_value=[(item, 2, False)]),
        ), patch("app.services.email_service.EmailService", _CaptureEmail):
            await run_inventory_low_stock_alerts(db)

        html = _CaptureEmail.sent[0]["html_body"]
        assert _columns(html) == 3
        assert ">Category<" not in html
        assert with_subline("Gloves &lt;L&gt;", "PPE &amp; Gear") in html


class TestNfpaRetirementTable:
    async def test_identifier_moves_under_the_item(self):
        _CaptureEmail.sent = []
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_orgs_result()])
        db.rollback = AsyncMock()
        today = org_today(None)
        due = [
            {
                "item_name": "Turnout Coat",
                "serial_number": "GX<1>",
                "retirement_date": today + timedelta(days=20),
                "days_until_retirement": 20,
            },
            {
                "item_name": "Helmet",
                "serial_number": None,
                "asset_tag": None,
                "retirement_date": today - timedelta(days=3),
                "days_until_retirement": -3,
            },
        ]
        with patch.object(
            InventoryService,
            "get_nfpa_retirement_due_items",
            new=AsyncMock(return_value=due),
        ), patch(
            "app.services.scheduled_tasks._stock_alert_recipients",
            new=AsyncMock(return_value=[_officer()]),
        ), patch(
            "app.services.email_service.EmailService", _CaptureEmail
        ):
            await run_nfpa_retirement_alerts(db)

        html = _CaptureEmail.sent[0]["html_body"]
        # Two tier sections, three columns each.
        assert _columns(html) == 6
        assert ">ID<" not in html
        assert with_subline("Turnout Coat", "GX&lt;1&gt;") in html
        # An item with no identifier gets no sub-line, and no "N/A".
        assert "N/A" not in html
        assert "Helmet</td>" in html
