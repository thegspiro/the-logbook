"""New audit entries do not name a screening's type (MS-18, 2026-11-06).

The type is encrypted on ``screening_records``. The audit log is
hash-chained, so a type written into an entry could never be removed again;
the record-created entry and the records-list filter therefore leave it out.
Source inspection, in the manner of test_medical_screening_create_audit_includes_id.
"""

import ast
import inspect

import pytest

from app.api.v1.endpoints import medical_screening as ep

pytestmark = pytest.mark.unit


def _event_data_keys(func) -> set:
    """Every string key of every dict literal inside ``event_data=``/the
    audit helper's dict argument in ``func``."""
    keys: set = set()
    for node in ast.walk(ast.parse(inspect.getsource(func))):
        if isinstance(node, ast.Dict):
            keys.update(
                key.value
                for key in node.keys
                if isinstance(key, ast.Constant) and isinstance(key.value, str)
            )
    return keys


def test_record_created_entry_does_not_name_the_type():
    assert "screening_type" not in _event_data_keys(ep.create_record)


def test_records_list_entry_does_not_name_the_type_filter():
    keys = _event_data_keys(ep.list_records)
    assert "screening_type" not in keys
    assert "screening_type_filtered" in keys
