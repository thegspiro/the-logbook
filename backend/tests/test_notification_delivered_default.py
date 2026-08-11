"""
An in-app notification is delivered as soon as its row exists.

`NotificationLog.delivered` defaulted to False, and six of the write sites
that create in-app rows never set it — the Send Log then showed a red "Not
delivered" beside notifications the member had already opened and read. There
is no send step for the in-app channel: writing the row *is* the delivery.

Email keeps the old behaviour: it is not delivered until something says so,
so an explicit `delivered=` must still win over the default.
"""

import pytest

from app.models.notification import (
    NotificationChannel,
    NotificationLog,
    _delivered_default,
)


class _Context:
    """Stands in for SQLAlchemy's DefaultExecutionContext."""

    def __init__(self, **params):
        self._params = params

    def get_current_parameters(self):
        return self._params


@pytest.mark.parametrize(
    "channel",
    [NotificationChannel.IN_APP, NotificationChannel.IN_APP.value],
)
def test_in_app_defaults_to_delivered(channel):
    # The column default sees whatever the caller passed — the enum member on
    # a normal write, its bare value when a dict is bulk-inserted.
    assert _delivered_default(_Context(channel=channel)) is True


@pytest.mark.parametrize(
    "channel",
    [NotificationChannel.EMAIL, NotificationChannel.EMAIL.value],
)
def test_email_still_defaults_to_undelivered(channel):
    assert _delivered_default(_Context(channel=channel)) is False


def test_missing_channel_is_not_delivered():
    """Fail closed: an unknown channel is not something we can claim we sent."""
    assert _delivered_default(_Context()) is False


def test_the_column_uses_the_callable():
    default = NotificationLog.__table__.c.delivered.default
    assert default is not None
    assert default.arg is _delivered_default


def test_an_explicit_value_is_still_honoured():
    """
    The default only fills a column the caller left alone, so the email paths
    that set delivered=False on a bounce keep saying so.
    """
    log = NotificationLog(
        channel=NotificationChannel.IN_APP,
        delivered=False,
    )
    assert log.delivered is False
