"""Regression checks for the secure defaults in the Unraid installer."""

from pathlib import Path

SETUP_SCRIPT = Path(__file__).parents[2] / "unraid" / "unraid-setup.sh"
UPDATE_SCRIPT = Path(__file__).parents[2] / "unraid" / "update.sh"


def test_generated_environment_requires_public_https_origin():
    script = SETUP_SCRIPT.read_text()

    assert "ALLOWED_ORIGINS=${HTTPS_ORIGIN}" in script
    assert "https://?*)" in script
    assert "ALLOWED_ORIGINS=http://${UNRAID_IP}:7880" not in script


def test_generated_environment_does_not_disable_secure_cookies():
    script = SETUP_SCRIPT.read_text()

    assert "COOKIE_SECURE=false" not in script


def test_update_backup_uses_private_permissions():
    script = UPDATE_SCRIPT.read_text()

    assert "umask 077" in script
    assert 'chmod 700 "$BACKUP_DIR"' in script
    assert 'chmod 600 "$BACKUP_FILE"' in script
