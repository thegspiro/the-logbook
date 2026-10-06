"""A retired setting left in .env is ignored, not a reason to refuse to boot.

pydantic-settings rejects an unknown key in a .env file, so deleting a setting
outright stops every installation whose .env still names it. Retired names are
listed in RETIRED_SETTINGS and dropped before validation instead.
"""

import pytest
from pydantic import ValidationError

from app.core.config import RETIRED_SETTINGS, Settings

pytestmark = pytest.mark.unit


@pytest.mark.parametrize("name", sorted(RETIRED_SETTINGS))
def test_a_retired_setting_in_dotenv_still_boots(tmp_path, name):
    env = tmp_path / ".env"
    env.write_text(f"{name}=1\n")

    settings = Settings(_env_file=str(env))

    assert not hasattr(settings, name)


def test_an_unknown_setting_is_still_refused(tmp_path):
    # Only the named retirements are forgiven; a typo keeps failing loudly.
    env = tmp_path / ".env"
    env.write_text("NOT_A_REAL_SETTING=1\n")

    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        Settings(_env_file=str(env))
