"""A username with a dot can be used to sign in.

An administrator's create and the member import store the username they are
given, and the import's own template suggests ``john.doe``. Sign-in's schema
allowed only letters, digits, hyphens and underscores, so such a member was
refused with "Username can only contain letters, numbers, hyphens, and
underscores" and could sign in only by email. ``POST /auth/login`` parses its
body with ``UserLogin``, so the schema is the gate.
"""

import pytest
from pydantic import ValidationError

from app.schemas.auth import UserLogin, UserRegister

pytestmark = pytest.mark.unit

PASSWORD = "Correct-Horse-Battery-9"


class TestSignInUsername:
    @pytest.mark.parametrize("username", ["john.doe", "j.r.smith", "jo-ann_2"])
    def test_a_stored_username_is_accepted(self, username):
        assert UserLogin(username=username, password=PASSWORD).username == username

    def test_an_email_still_signs_in_lower_cased(self):
        login = UserLogin(username="John.Doe@Example.com", password=PASSWORD)
        assert login.username == "john.doe@example.com"

    @pytest.mark.parametrize("username", ["john doe", "a;b", "x'--", "bob<b>"])
    def test_other_characters_are_still_refused(self, username):
        with pytest.raises(ValidationError, match="Username can only contain"):
            UserLogin(username=username, password=PASSWORD)


class TestRegistrationIsUnchanged:
    def test_self_registration_still_refuses_a_dot(self):
        with pytest.raises(ValidationError, match="Username can only contain"):
            UserRegister(
                username="john.doe",
                email="john@example.com",
                password="Correct-Horse-Battery-9",
                first_name="John",
                last_name="Doe",
            )
