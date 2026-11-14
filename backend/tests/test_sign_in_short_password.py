"""A short password reaches the password check (workflow review W02-7).

``UserLogin`` required at least eight characters, so ``POST /auth/login``
answered a shorter attempt with a 422 the sign-in screen showed as
"password: Value is too short." instead of "Incorrect username or password".
That told a guesser the policy, never counted toward the account lockout, and
refused outright any member whose password is shorter than eight characters,
which ``PASSWORD_MIN_LENGTH`` (configurable) allows. Sign-in verifies a stored
password; it does not apply the policy for choosing one, as
``PasswordChange.current_password`` already does not.
"""

import pytest
from pydantic import ValidationError

from app.schemas.auth import UserLogin

pytestmark = pytest.mark.unit


class TestSignInPasswordLength:
    @pytest.mark.parametrize("password", ["x", "wrong-1", "1234567"])
    def test_a_password_under_eight_characters_is_accepted(self, password):
        assert UserLogin(username="review_member", password=password).password == (
            password
        )

    def test_an_empty_password_is_still_refused(self):
        with pytest.raises(ValidationError):
            UserLogin(username="review_member", password="")

    def test_the_hashing_ceiling_still_applies(self):
        # PASSWORD_MAX_LENGTH: an unbounded input is an Argon2 cost lever.
        with pytest.raises(ValidationError):
            UserLogin(username="review_member", password="x" * 129)
