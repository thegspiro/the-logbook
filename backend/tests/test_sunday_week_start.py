"""The scheduling week runs Sunday to Saturday, as the shift board draws it."""

from datetime import date, timedelta

import pytest

from app.services.scheduling_service import sunday_week_start

pytestmark = [pytest.mark.unit]

SUNDAY = date(2026, 10, 18)


@pytest.mark.parametrize("offset", range(7))
def test_every_day_of_the_week_maps_to_its_sunday(offset):
    assert sunday_week_start(SUNDAY + timedelta(days=offset)) == SUNDAY


def test_a_sunday_starts_a_new_week_rather_than_ending_the_last():
    """The case the Monday rule got wrong: it put a Sunday at the end."""
    assert sunday_week_start(SUNDAY + timedelta(days=7)) == SUNDAY + timedelta(days=7)
    assert sunday_week_start(SUNDAY - timedelta(days=1)) == SUNDAY - timedelta(days=7)
