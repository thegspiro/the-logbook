"""Every encrypted column must be visited by the key-rotation scripts.

``rotate_encryption_key.py`` re-encrypts values under the current key so an old
key can be retired from ``ENCRYPTION_KEYS_LEGACY``; ``reencrypt_to_aesgcm.py``
upgrades legacy ciphertext. Each walks a hand-written list of columns. A column
that has an encrypted type in the models but is missing from that list keeps
its old-key ciphertext through every rotation, and becomes unreadable the day
the old key is removed. ``screening_records`` was in exactly that state until
this test existed, and ``prospective_members.status_token`` until 2026-10-26.
"""

import ast
from pathlib import Path

import pytest

import app.models  # noqa: F401 - importing registers every model on the metadata
from app.core.database import Base
from app.core.encrypted_types import EncryptedDate, EncryptedJSON, EncryptedText

pytestmark = pytest.mark.unit

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


def _registry(script: str) -> set[tuple[str, str]]:
    tree = ast.parse((SCRIPTS / script).read_text())
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == "_PLAIN_COLUMNS" for t in node.targets
        ):
            return {
                (table, column)
                for table, _pk, columns in ast.literal_eval(node.value)
                for column in columns
            }
    raise AssertionError(f"_PLAIN_COLUMNS not found in {script}")


def _encrypted_model_columns() -> set[tuple[str, str]]:
    return {
        (table.name, column.name)
        for table in Base.metadata.tables.values()
        for column in table.columns
        if isinstance(column.type, (EncryptedDate, EncryptedJSON, EncryptedText))
    }


@pytest.mark.parametrize(
    "script", ["rotate_encryption_key.py", "reencrypt_to_aesgcm.py"]
)
def test_every_encrypted_column_is_in_the_script(script):
    missing = _encrypted_model_columns() - _registry(script)

    assert not missing, (
        f"{script} would skip {sorted(missing)}; add them to _PLAIN_COLUMNS "
        "so a key rotation re-encrypts them"
    )


@pytest.mark.parametrize(
    "script", ["rotate_encryption_key.py", "reencrypt_to_aesgcm.py"]
)
def test_the_script_names_no_column_that_is_not_encrypted(script):
    """Rotating a plaintext column would encrypt it in place and break readers."""
    encrypted = _encrypted_model_columns()
    columns = {
        (table.name, column.name)
        for table in Base.metadata.tables.values()
        for column in table.columns
    }
    # mfa_secret, integrations.encrypted_config and the external-provider keys
    # are encrypted by explicit encrypt_data() calls rather than a column type.
    explicit = {
        ("users", "mfa_secret"),
        ("integrations", "encrypted_config"),
        ("external_training_providers", "api_key"),
        ("external_training_providers", "api_secret"),
        ("external_training_providers", "client_secret"),
    }

    unknown = _registry(script) - encrypted - explicit

    assert not unknown, f"{script} lists columns that are not encrypted: {unknown}"
    assert all(entry in columns for entry in _registry(script))


def test_status_token_is_rotated_because_it_is_ciphertext_not_a_hash():
    """The hash lives in ``status_token_hash``; ``status_token`` is decrypted.

    20261005_2326_f7c09cfec5b0 added the hash column and kept ``status_token``
    as ``EncryptedText`` so later pipeline emails can re-send the link. This
    test once excluded it as "a one-way hash". An unrotated token decrypts to
    nothing once its key is retired, and ``EncryptedText`` passes the
    ciphertext through as legacy plaintext, so applicants would be emailed a
    status link that does not resolve.
    """
    assert ("prospective_members", "status_token") in _encrypted_model_columns()
    for script in ("rotate_encryption_key.py", "reencrypt_to_aesgcm.py"):
        assert ("prospective_members", "status_token") in _registry(script)
