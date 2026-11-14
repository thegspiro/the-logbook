"""``RefusesNull``: an update schema's refusal of an explicit ``null``.

The base class is the one place a null that a handler would acknowledge and
ignore, or store and then fail to serialize, is turned into a 422. Its seventeen
subclasses are covered only by the integration tests of the modules they sit in,
which do not run in the unit job. Two things need to hold for every subclass and
are cheap to check here:

* the behaviour: a listed field refuses ``null``, an omitted key is untouched,
  and an unlisted field still takes ``null``;
* the list is real: a name in ``null_refused`` that is not a field of the schema
  refuses nothing, so a typo there is a silent no-op that looks like protection.
"""

import importlib
import pkgutil
from typing import Optional

import pytest
from pydantic import ValidationError

import app.schemas
from app.schemas.base import RefusesNull

pytestmark = [pytest.mark.unit]


def _subclasses() -> list[type[RefusesNull]]:
    for module in pkgutil.iter_modules(app.schemas.__path__):
        importlib.import_module(f"app.schemas.{module.name}")
    found: list[type[RefusesNull]] = []
    pending = list(RefusesNull.__subclasses__())
    while pending:
        schema = pending.pop()
        found.append(schema)
        pending.extend(schema.__subclasses__())
    return sorted(found, key=lambda s: f"{s.__module__}.{s.__qualname__}")


_SCHEMAS = _subclasses()


class _Sample(RefusesNull):
    refused: Optional[str] = None
    allowed: Optional[str] = None

    null_refused = frozenset({"refused"})


class TestTheBehaviour:
    def test_a_listed_field_refuses_null_and_names_the_field(self):
        with pytest.raises(ValidationError) as caught:
            _Sample(refused=None)

        error = caught.value.errors()[0]
        assert error["loc"] == ("refused",)
        assert "cannot be null" in error["msg"]

    def test_an_unlisted_field_still_takes_null(self):
        sample = _Sample(allowed=None)

        assert sample.model_dump(exclude_unset=True) == {"allowed": None}

    def test_an_omitted_key_is_untouched(self):
        assert _Sample().model_dump(exclude_unset=True) == {}

    def test_a_value_for_a_listed_field_is_kept(self):
        assert _Sample(refused="x").model_dump(exclude_unset=True) == {"refused": "x"}

    def test_a_schema_that_lists_nothing_refuses_nothing(self):
        class Plain(RefusesNull):
            anything: Optional[str] = None

        assert Plain(anything=None).anything is None


class TestEverySubclass:
    def test_there_are_subclasses_to_check(self):
        assert len(_SCHEMAS) >= 17

    @pytest.mark.parametrize("schema", _SCHEMAS, ids=lambda s: s.__qualname__)
    def test_every_listed_name_is_a_field(self, schema):
        unknown = sorted(set(schema.null_refused) - set(schema.model_fields))

        assert not unknown, f"{schema.__qualname__} lists non-fields: {unknown}"

    @pytest.mark.parametrize("schema", _SCHEMAS, ids=lambda s: s.__qualname__)
    def test_every_subclass_lists_something(self, schema):
        assert schema.null_refused, f"{schema.__qualname__} refuses nothing"
