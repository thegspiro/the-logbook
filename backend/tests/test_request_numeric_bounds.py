"""
Numeric request fields must fit the column they are stored in.

A field typed ``int`` / ``Decimal`` / ``float`` with no upper bound passes
validation for a value its column cannot hold, and then fails at flush as MySQL
error 1264, which an endpoint can only report as "An unexpected error
occurred". Three guards:

  - ``TestEveryNumericRequestFieldIsBounded`` walks every request body of the
    real application and fails on any numeric field that has no bound on both
    sides and is not a documented exception, so a field added later cannot
    quietly bring the problem back.
  - ``TestBoundsMatchTheColumn`` ties each bounded field to the column it is
    stored in, so a bound that is present but wrong (too loose, or copied from
    the wrong type) fails too.
  - ``TestTheExceptionList`` keeps the documented exceptions honest: an entry
    whose field has since been bounded, or has gone, must be removed.

The data lives in ``request_bound_columns.py``.
"""

import collections.abc
import importlib
import types
import typing
from dataclasses import dataclass
from decimal import Decimal
from typing import Annotated, Any, Dict, Iterator, List, Optional, Tuple

import annotated_types as at
import pytest
from fastapi import Body, FastAPI
from fastapi.routing import APIRoute
from pydantic import BaseModel, Field, TypeAdapter, ValidationError
from sqlalchemy import Float, Integer, Numeric

from app.core.database import Base
from tests.request_bound_columns import (
    COLUMN_BACKED,
    NOT_COLUMN_BACKED,
    POLICY_BOUNDED,
)

pytestmark = pytest.mark.unit

_NUMERIC = (int, float, Decimal)
_CATEGORIES = {"JSON", "COMPARED", "TRANSIENT", "SERVICE_VALIDATED", "ARITHMETIC"}


# ============================================
# Walking a request body
# ============================================


@dataclass(frozen=True)
class RequestField:
    module: str
    cls: str
    field: str
    lower: bool
    upper: bool

    @property
    def key(self) -> str:
        return f"{self.module}:{self.cls}.{self.field}"


def _leaves(annotation: Any) -> Iterator[Tuple[Any, list]]:
    """The innermost types of an annotation, with the ``Annotated`` metadata
    seen on the way down. Looks through Optional/Union and through list, set,
    tuple and dict values, so ``Optional[List[int]]`` yields ``int``."""
    origin = typing.get_origin(annotation)
    if origin is Annotated:
        inner, *meta = typing.get_args(annotation)
        for base, found in _leaves(inner):
            yield base, list(meta) + found
    elif origin in (typing.Union, types.UnionType):
        for arg in typing.get_args(annotation):
            if arg is not type(None):
                yield from _leaves(arg)
    elif origin in (list, set, frozenset, tuple, collections.abc.Sequence):
        for arg in typing.get_args(annotation):
            if arg is not Ellipsis:
                yield from _leaves(arg)
    elif origin in (dict, collections.abc.Mapping):
        args = typing.get_args(annotation)
        if len(args) == 2:
            yield from _leaves(args[1])
    else:
        yield annotation, []


def _sides(metadata: list) -> Tuple[bool, bool]:
    """(has a lower bound, has an upper bound) among constraint metadata. A
    Decimal's ``max_digits`` bounds its magnitude in both directions."""
    lower = upper = False
    for item in metadata:
        if isinstance(item, (at.Ge, at.Gt)):
            lower = True
        elif isinstance(item, (at.Le, at.Lt)):
            upper = True
        elif isinstance(item, at.Interval):
            lower = lower or item.ge is not None or item.gt is not None
            upper = upper or item.le is not None or item.lt is not None
        if getattr(item, "max_digits", None) is not None:
            lower = upper = True
        for inner in getattr(item, "metadata", None) or ():
            low, up = _sides([inner])
            lower, upper = lower or low, upper or up
    return lower, upper


def _declaring_class(model: type, name: str) -> type:
    for klass in model.__mro__:
        if name in klass.__dict__.get("__annotations__", {}):
            return klass
    return model


def _routes(router: Any, seen: Optional[set] = None) -> Iterator[APIRoute]:
    """Every APIRoute under ``router``, through included routers (FastAPI wraps
    those lazily) and mounts."""
    seen = set() if seen is None else seen
    for route in getattr(router, "routes", []):
        if isinstance(route, APIRoute):
            if id(route) not in seen:
                seen.add(id(route))
                yield route
            continue
        inner = (
            getattr(route, "original_router", None)
            or getattr(route, "app", None)
            or getattr(route, "router", None)
        )
        if inner is not None and hasattr(inner, "routes"):
            yield from _routes(inner, seen)


def unbounded_request_fields(app: Any) -> Dict[str, RequestField]:
    """Numeric request-body fields of ``app`` lacking a bound on either side,
    keyed ``module:Class.field``. A numeric body parameter that is not part of
    a model is keyed by its handler: ``module:function.parameter``."""
    found: Dict[str, RequestField] = {}

    def record(module: str, cls: str, field: str, lower: bool, upper: bool) -> None:
        item = RequestField(module, cls, field, lower, upper)
        found.setdefault(item.key, item)

    def visit(model: type, stack: tuple = ()) -> None:
        if model in stack:
            return
        for name, info in model.model_fields.items():
            for base, extra in _leaves(info.annotation):
                if isinstance(base, type) and issubclass(base, BaseModel):
                    visit(base, stack + (model,))
                elif base in _NUMERIC:
                    lower, upper = _sides(list(info.metadata) + extra)
                    if not (lower and upper):
                        owner = _declaring_class(model, name)
                        record(owner.__module__, owner.__name__, name, lower, upper)

    for route in _routes(app):
        for param in route.dependant.body_params:
            for base, extra in _leaves(param.field_info.annotation):
                if isinstance(base, type) and issubclass(base, BaseModel):
                    visit(base)
                elif base in _NUMERIC:
                    lower, upper = _sides(list(param.field_info.metadata) + extra)
                    if not (lower and upper):
                        handler = route.endpoint
                        record(
                            handler.__module__,
                            handler.__name__,
                            param.name,
                            lower,
                            upper,
                        )
    return found


@pytest.fixture(scope="module")
def application():
    from main import app

    return app


@pytest.fixture(scope="module")
def unbounded(application) -> Dict[str, RequestField]:
    return unbounded_request_fields(application)


class TestEveryNumericRequestFieldIsBounded:
    def test_no_request_field_is_left_unbounded(self, unbounded):
        undocumented = sorted(set(unbounded) - set(NOT_COLUMN_BACKED))
        assert not undocumented, (
            "These request fields accept a number their column cannot hold. Give "
            "each a ge/le matching its column (app/schemas/column_bounds.py has the "
            "constants) and add a COLUMN_BACKED row in tests/request_bound_columns.py; "
            "if it is stored in JSON or never stored, add it to NOT_COLUMN_BACKED "
            "with the reason:\n  "
            + "\n  ".join(
                f"{key} (no bound {'below' if unbounded[key].upper else 'above'}"
                f"{'' if unbounded[key].upper or unbounded[key].lower else ' or below'})"
                for key in undocumented
            )
        )

    def test_the_whole_application_is_walked(self, application):
        routes = list(_routes(application))
        assert len(routes) > 1000
        modules = {route.endpoint.__module__ for route in routes}
        assert "app.api.v1.endpoints.inventory" in modules
        assert "app.api.v1.endpoints.finance" in modules
        assert any(
            name.startswith("app.api.public.") for name in modules
        ), "the public routers mounted directly on the app were not reached"

    def test_the_walker_flags_an_unbounded_field(self):
        class Loose(BaseModel):
            count: int
            ratio: float = 1.0

        app = FastAPI()

        @app.post("/loose")
        def post_loose(body: Loose):  # pragma: no cover - never called
            return body

        assert set(unbounded_request_fields(app)) == {
            f"{__name__}:Loose.count",
            f"{__name__}:Loose.ratio",
        }

    def test_the_walker_looks_through_containers_and_nesting(self):
        class Inner(BaseModel):
            deep: int

        class Outer(BaseModel):
            maybe: Optional[int] = None
            many: List[int] = []
            tally: Dict[str, int] = {}
            inner: Optional[Inner] = None
            money: Decimal = Decimal(0)

        app = FastAPI()

        @app.post("/outer")
        def post_outer(body: Outer):  # pragma: no cover - never called
            return body

        flagged = {key.split(".")[-1] for key in unbounded_request_fields(app)}
        assert flagged == {"maybe", "many", "tally", "deep", "money"}

    def test_the_walker_accepts_every_way_of_bounding_a_field(self):
        class Bounded(BaseModel):
            both: int = Field(0, ge=0, le=5)
            annotated: Annotated[int, Field(ge=0, le=5)] = 0
            digits: Decimal = Field(Decimal(0), max_digits=12, decimal_places=2)
            items: List[Annotated[int, Field(ge=0, le=5)]] = []

        app = FastAPI()

        @app.post("/bounded")
        def post_bounded(body: Bounded):  # pragma: no cover - never called
            return body

        assert unbounded_request_fields(app) == {}

    def test_the_walker_wants_both_sides(self):
        class Half(BaseModel):
            floor_only: int = Field(0, ge=0)
            ceiling_only: int = Field(0, le=5)

        app = FastAPI()

        @app.post("/half")
        def post_half(body: Half):  # pragma: no cover - never called
            return body

        found = unbounded_request_fields(app)
        assert {item.field: (item.lower, item.upper) for item in found.values()} == {
            "floor_only": (True, False),
            "ceiling_only": (False, True),
        }

    def test_the_walker_sees_a_bare_numeric_body_parameter(self):
        app = FastAPI()

        @app.post("/bare")
        def post_bare(count: int = Body(...)):  # pragma: no cover - never called
            return count

        assert set(unbounded_request_fields(app)) == {f"{__name__}:post_bare.count"}


# ============================================
# Bounds match the column
# ============================================

# The largest round figure inside MySQL FLOAT's range (single precision, max
# 3.402823466e38): what the schema promises to accept.
_FLOAT32_LIMIT = 3.4e38


def _column_range(model: type, column: str):
    """(lowest, highest, just_above, just_below) the stored column can hold."""
    col_type = model.__table__.c[column].type
    if isinstance(col_type, Integer):
        low, high = -(2**31), 2**31 - 1
        return low, high, high + 1, low - 1
    # Float is a subclass of Numeric, so it has to be asked first.
    if isinstance(col_type, Float):
        return -_FLOAT32_LIMIT, _FLOAT32_LIMIT, 1e39, -1e39
    if isinstance(col_type, Numeric):
        step = Decimal(1).scaleb(-col_type.scale)
        high = Decimal(10) ** (col_type.precision - col_type.scale) - step
        return -high, high, high + step, -high - step
    raise AssertionError(f"{model.__name__}.{column} is {col_type!r}, not numeric")


def _validator(schema: Any, field: str) -> TypeAdapter:
    info = schema.model_fields[field]
    if not info.metadata:
        return TypeAdapter(info.annotation)
    return TypeAdapter(Annotated[info.annotation, *info.metadata])


def _accepts(adapter: TypeAdapter, value: Any) -> bool:
    try:
        adapter.validate_python(value)
        return True
    except ValidationError:
        return False


@pytest.fixture(scope="module")
def orm_models() -> Dict[str, type]:
    importlib.import_module("app.models")  # registers every ORM model
    return {mapper.class_.__name__: mapper.class_ for mapper in Base.registry.mappers}


def _split(row: str) -> Tuple[str, str, str, str, str]:
    where, column_ref = row.split("=")
    module, rest = where.split(":")
    cls, field = rest.rsplit(".", 1)
    model, column = column_ref.split(".")
    return module, cls, field, model, column


class TestBoundsMatchTheColumn:
    @pytest.mark.parametrize("row", COLUMN_BACKED, ids=lambda row: row.split(":")[1])
    def test_refuses_what_the_column_cannot_hold(self, row, orm_models):
        module, cls, field, model, column = _split(row)
        schema = getattr(importlib.import_module(module), cls)
        _, high, above, below = _column_range(orm_models[model], column)
        adapter = _validator(schema, field)

        assert not _accepts(adapter, above), "one past the column's maximum is accepted"
        assert not _accepts(adapter, below), "one past the column's minimum is accepted"
        assert _accepts(
            adapter, high
        ), "the column's own maximum is refused, so the bound is tighter than the column"

    @pytest.mark.parametrize("row", POLICY_BOUNDED, ids=lambda row: row.split(":")[1])
    def test_a_policy_bound_sits_inside_the_column(self, row, orm_models):
        module, cls, field, model, column = _split(row)
        schema = getattr(importlib.import_module(module), cls)
        _, high, above, below = _column_range(orm_models[model], column)
        adapter = _validator(schema, field)

        assert not _accepts(adapter, above), "one past the column's maximum is accepted"
        assert not _accepts(adapter, below), "one past the column's minimum is accepted"
        assert not _accepts(
            adapter, high
        ), "the column's own maximum is accepted, so this is a column bound, not a policy one"

    def test_no_row_is_listed_twice(self):
        counts = collections.Counter(row.split("=")[0] for row in COLUMN_BACKED)
        assert [key for key, n in counts.items() if n > 1] == []

    def test_a_row_is_not_also_an_exception(self):
        listed = {row.split("=")[0] for row in COLUMN_BACKED + POLICY_BOUNDED}
        assert sorted(listed & set(NOT_COLUMN_BACKED)) == []

    def test_a_field_is_column_backed_or_policy_bounded_not_both(self):
        both = {r.split("=")[0] for r in COLUMN_BACKED} & {
            r.split("=")[0] for r in POLICY_BOUNDED
        }
        assert sorted(both) == []


# ============================================
# The exception list
# ============================================


class TestTheExceptionList:
    def test_every_exception_is_still_unbounded(self, unbounded):
        """An entry whose field now has a bound -- or no longer exists -- is
        stale: delete it, and add a COLUMN_BACKED row if it maps to a column."""
        stale = sorted(set(NOT_COLUMN_BACKED) - set(unbounded))
        assert not stale, "remove these from NOT_COLUMN_BACKED:\n  " + "\n  ".join(
            stale
        )

    def test_every_exception_names_a_known_category_and_a_reason(self):
        for key, (category, reason) in NOT_COLUMN_BACKED.items():
            assert category in _CATEGORIES, key
            assert len(reason) > 20, key
