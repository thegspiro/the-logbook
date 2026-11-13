"""An authenticator code typed as the app shows it is accepted (W04-10).

Authenticator apps display the six digits in two groups ("123 456"), and the
code schemas took exactly six characters, so a correct code typed as shown
was refused with "code: Value is too long". W02-10 fixed the sign-in screen
alone; enrolment, step-up, turning MFA off and new recovery codes still
refused it. The schemas now drop whitespace before the length check, so every
path that takes a code reads it the same way.
"""

import pytest
from pydantic import ValidationError

from app.schemas.auth import MFALogin, MFAVerify, StepUpRequest

pytestmark = pytest.mark.unit


@pytest.mark.parametrize("typed", ["123 456", " 123456 ", "123 456", "12 34 56"])
def test_enrolment_and_settings_take_a_grouped_code(typed):
    assert MFAVerify(code=typed).code == "123456"


def test_step_up_takes_a_grouped_code():
    assert StepUpRequest(code="123 456").code == "123456"


def test_sign_in_takes_a_grouped_code():
    assert MFALogin(temp_token="t", code="123 456").code == "123456"


@pytest.mark.parametrize("typed", ["12345", "1234567", "123 4567"])
def test_a_code_of_the_wrong_length_is_still_refused(typed):
    with pytest.raises(ValidationError):
        MFAVerify(code=typed)


def test_an_absent_code_stays_absent():
    assert StepUpRequest(password="x").code is None
    assert MFALogin(temp_token="t", recovery_code="abcde-fghij").code is None
