"""
Unit tests for pure helpers in the forms service
(app/services/forms_service.py). DB-free.

Focus: FORM-6 — a required field is satisfied only by a non-empty value, not
merely by the key being present.
"""

from app.services.forms_service import FormsService


class TestIsEmptyValue:
    """FORM-6: what counts as "not provided" for a required field."""

    def test_none_is_empty(self):
        assert FormsService._is_empty_value(None) is True

    def test_empty_string_is_empty(self):
        assert FormsService._is_empty_value("") is True

    def test_whitespace_string_is_empty(self):
        assert FormsService._is_empty_value("   \t\n") is True

    def test_empty_list_is_empty(self):
        # A required multiselect with nothing chosen.
        assert FormsService._is_empty_value([]) is True

    def test_empty_dict_is_empty(self):
        assert FormsService._is_empty_value({}) is True

    def test_nonempty_string_is_not_empty(self):
        assert FormsService._is_empty_value("hello") is False

    def test_zero_is_not_empty(self):
        # A required number field answered with 0 is a real answer.
        assert FormsService._is_empty_value(0) is False

    def test_false_is_not_empty(self):
        # A required boolean answered False is a real answer.
        assert FormsService._is_empty_value(False) is False

    def test_nonempty_list_is_not_empty(self):
        assert FormsService._is_empty_value(["a"]) is False
