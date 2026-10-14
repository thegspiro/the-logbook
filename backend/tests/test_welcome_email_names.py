"""
The welcome email greets a member by the names they have on file.

A member can be created with no first or last name. The route used to pass
that missing name straight through, so the template's full name rendered as
the literal text "None Smith". It now passes an empty string, and the service
trims the join.
"""

from unittest.mock import AsyncMock

import pytest

from app.services.email_service import EmailService


async def _context_for(first_name: str, last_name: str) -> dict:
    service = EmailService.__new__(EmailService)
    service.organization = None
    service._render_with_fallback = AsyncMock(return_value=("subject", "<p/>", "text"))
    service.send_email = AsyncMock(return_value=(1, 0))

    await service.send_welcome_email(
        to_email="new@example.org",
        first_name=first_name,
        last_name=last_name,
        username="newmember",
        temp_password="not-a-real-password",
        organization_name="Test FD",
        login_url="https://example.org/login",
    )
    return service._render_with_fallback.call_args.kwargs["context"]


@pytest.mark.unit
class TestWelcomeEmailFullName:
    async def test_both_names_join_with_a_space(self):
        context = await _context_for("Alex", "Smith")
        assert context["full_name"] == "Alex Smith"

    @pytest.mark.parametrize(
        ("first", "last", "expected"),
        [("", "Smith", "Smith"), ("Alex", "", "Alex"), ("", "", "")],
    )
    async def test_a_missing_name_leaves_no_stray_space_or_none(
        self, first, last, expected
    ):
        context = await _context_for(first, last)
        assert context["full_name"] == expected
        assert "None" not in context["full_name"]
