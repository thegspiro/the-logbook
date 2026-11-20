"""Run the backend tests as if it were another time of day.

A test that builds "now minus fourteen hours" and compares calendar dates
passes in the afternoon and fails in the hour after midnight; the suite runs
whenever someone pushes, so such a test merges green and turns ``main`` red
overnight. The shift-evaluation tests did exactly that on 2026-11-14. This
plugin lets a run choose the hour instead of inheriting it::

    CLOCK_SHIFT_AT=00:30 pytest -p tests.clock_shift tests/

``CLOCK_SHIFT_AT`` is a UTC time of day. The clock moves to the occurrence of
that time nearest the real one (today's, yesterday's or tomorrow's), so the
jump is never more than twelve hours, and keeps ticking from there. Without
the variable the plugin does nothing. The nightly workflow
(``.github/workflows/clock-shift.yml``) runs it at the hours that matter for a
US department: around UTC midnight and around US Eastern midnight.

What moves:

* ``datetime.now()``, ``datetime.utcnow()``, ``datetime.today()`` and
  ``date.today()`` as read by every module under ``backend/`` (the app, the
  tests, the migrations and scripts) and by PyJWT, which checks token expiry
  against its own clock. The names ``datetime`` and ``date`` in those modules
  are replaced, as freezegun does, by subclasses whose ``isinstance`` and
  ``issubclass`` answer for the real classes and whose constructors return
  real objects, so drivers that dispatch on the exact type are unaffected.
  A comparison by identity (``x is datetime``) cannot hold; write
  ``issubclass(x, datetime)``.
* The database's ``NOW()``: every pooled connection checkout runs
  ``SET timestamp`` to the moved instant, frozen for that checkout.

* The same classes on the ``datetime`` module itself while each test runs, so
  an import made inside a function body sees them too.
* ``time.time()`` and ``time.time_ns()`` in the same modules, which some code
  uses to stamp a token's expiry.

What does not: monotonic clocks, Redis TTLs, and any library reading the clock
that is not named above.
"""

from __future__ import annotations

import datetime as _dt
import os
import sys
import time as _time
import types
from pathlib import Path

import pytest

_BACKEND = Path(__file__).resolve().parent.parent
_RealDatetime = _dt.datetime
_RealDate = _dt.date


def _offset_to(at: str) -> _dt.timedelta:
    """The jump to the occurrence of UTC ``HH:MM`` nearest the real now."""
    hour, minute = (int(part) for part in at.split(":"))
    now = _RealDatetime.now(_dt.timezone.utc)
    today = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    candidates = (today + _dt.timedelta(days=d) for d in (-1, 0, 1))
    return min((c - now for c in candidates), key=abs)


_AT = os.environ.get("CLOCK_SHIFT_AT", "").strip()
_OFFSET = _offset_to(_AT) if _AT else _dt.timedelta(0)


class _DatetimeMeta(type):
    def __instancecheck__(cls, obj: object) -> bool:
        return isinstance(obj, _RealDatetime)

    def __subclasscheck__(cls, sub: type) -> bool:
        return issubclass(sub, _RealDatetime)


class _DateMeta(type):
    def __instancecheck__(cls, obj: object) -> bool:
        return isinstance(obj, _RealDate)

    def __subclasscheck__(cls, sub: type) -> bool:
        return issubclass(sub, _RealDate)


class ShiftedDatetime(_RealDatetime, metaclass=_DatetimeMeta):
    # Every constructor, and fromtimestamp/fromisoformat/combine (which call
    # cls), yields a real datetime: database drivers dispatch on exact type.
    def __new__(cls, *args, **kwargs):
        return _RealDatetime(*args, **kwargs)

    # A model declared while a test runs (a schema module imported inside a
    # function) annotates its fields with this class; validate as the real one.
    @classmethod
    def __get_pydantic_core_schema__(cls, source, handler):
        return handler.generate_schema(_RealDatetime)

    @classmethod
    def now(cls, tz=None):
        return _RealDatetime.now(tz) + _OFFSET

    @classmethod
    def utcnow(cls):
        return _RealDatetime.now(_dt.timezone.utc).replace(tzinfo=None) + _OFFSET

    @classmethod
    def today(cls):
        return _RealDatetime.now() + _OFFSET


class ShiftedDate(_RealDate, metaclass=_DateMeta):
    def __new__(cls, *args, **kwargs):
        return _RealDate(*args, **kwargs)

    @classmethod
    def __get_pydantic_core_schema__(cls, source, handler):
        return handler.generate_schema(_RealDate)

    @classmethod
    def today(cls):
        return (_RealDatetime.now() + _OFFSET).date()


_shifted_time = types.ModuleType("time")
_shifted_time.__dict__.update(_time.__dict__)
_shifted_time.time = lambda: _time.time() + _OFFSET.total_seconds()
_shifted_time.time_ns = lambda: _time.time_ns() + int(_OFFSET.total_seconds() * 1e9)

_shifted_module = types.ModuleType("datetime")
_shifted_module.__dict__.update(_dt.__dict__)
_shifted_module.datetime = ShiftedDatetime
_shifted_module.date = ShiftedDate


def _in_scope(name: str, module: types.ModuleType) -> bool:
    if name == "jwt" or name.startswith("jwt."):
        return True
    path = getattr(module, "__file__", None)
    if not path:
        return False
    try:
        return Path(path).resolve().is_relative_to(_BACKEND)
    except OSError:
        return False


def _shift_loaded_modules() -> None:
    for name, module in list(sys.modules.items()):
        if module is None or module is _shifted_module or not _in_scope(name, module):
            continue
        namespace = getattr(module, "__dict__", None)
        if not namespace or name == __name__:
            continue
        for attr, value in list(namespace.items()):
            if value is _RealDatetime:
                namespace[attr] = ShiftedDatetime
            elif value is _RealDate:
                namespace[attr] = ShiftedDate
            elif value is _dt:
                namespace[attr] = _shifted_module
            elif value is _time:
                namespace[attr] = _shifted_time


if _AT:
    from sqlalchemy import event
    from sqlalchemy.pool import Pool

    @event.listens_for(Pool, "checkout")
    def _move_the_database_clock(dbapi_connection, record, proxy) -> None:
        # MySQL and MariaDB only: the SQLite engines some migration tests
        # build have no settable clock, and no NOW() default to move.
        if "sqlite" in type(dbapi_connection).__module__:
            return
        cursor = dbapi_connection.cursor()
        moved = _RealDatetime.now(_dt.timezone.utc) + _OFFSET
        cursor.execute(f"SET timestamp = {moved.timestamp():.6f}")
        cursor.close()

    def pytest_report_header(config) -> str:
        moved = _RealDatetime.now(_dt.timezone.utc) + _OFFSET
        return f"clock shifted to {moved:%Y-%m-%d %H:%M} UTC (CLOCK_SHIFT_AT={_AT})"

    # At each test, so a module imported since the last one is covered too.
    # A plugin's autouse fixture runs before a test module's own, so the
    # module's _clock() (tests/clock_support.py) reads the moved clock.
    @pytest.fixture(autouse=True)
    def _clock_shift():
        _shift_loaded_modules()
        # Code that imports inside a function (`from datetime import datetime`
        # in a scheduled task's body) reads the module's attribute at call
        # time, so the module itself carries the shifted classes while a test
        # runs, and gets the real ones back after it.
        _dt.datetime, _dt.date = ShiftedDatetime, ShiftedDate
        try:
            yield
        finally:
            _dt.datetime, _dt.date = _RealDatetime, _RealDate
