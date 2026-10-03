"""An apparatus added without a fuel type has none (workflow review W48-3).

The add form's Fuel Type starts at "Select Fuel Type" and sends nothing when
left there, but the model defaulted the column to diesel, so every apparatus
added that way was recorded, and shown on its detail page, as diesel. The
database column carries no default of its own and allows NULL; only the ORM
supplied one.
"""

import pytest

from app.models.apparatus import Apparatus

pytestmark = pytest.mark.unit


def test_fuel_type_has_no_default():
    column = Apparatus.__table__.c.fuel_type
    assert column.default is None
    assert column.server_default is None
    assert column.nullable is True
