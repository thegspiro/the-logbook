"""Regression checks for the secure defaults in the Unraid installer."""

from pathlib import Path

SETUP_SCRIPT = Path(__file__).parents[2] / "unraid" / "unraid-setup.sh"
EXAMPLE_ENV = Path(__file__).parents[2] / "unraid" / ".env.example"


def test_generated_environment_requires_public_https_origin():
    script = SETUP_SCRIPT.read_text()

    assert "ALLOWED_ORIGINS=${HTTPS_ORIGIN}" in script
    assert "https://?*)" in script
    assert "ALLOWED_ORIGINS=http://${UNRAID_IP}:7880" not in script


def test_generated_environment_does_not_disable_secure_cookies():
    script = SETUP_SCRIPT.read_text()

    assert "COOKIE_SECURE=false" not in script


def test_example_environment_uses_https_origin():
    example = EXAMPLE_ENV.read_text()

    assert "ALLOWED_ORIGINS=https://" in example
    assert "ALLOWED_ORIGINS=http://" not in example
