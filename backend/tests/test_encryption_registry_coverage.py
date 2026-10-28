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


def _fingerprint_registry() -> set[tuple[str, str]]:
    """(table, fingerprint_column) pairs ``rotate_encryption_key.py`` rotates."""
    tree = ast.parse((SCRIPTS / "rotate_encryption_key.py").read_text())
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == "_FINGERPRINT_COLUMNS"
            for t in node.targets
        ):
            return {
                (table, fingerprint)
                for table, _address, fingerprint in ast.literal_eval(node.value)
            }
    raise AssertionError("_FINGERPRINT_COLUMNS not found in rotate_encryption_key.py")


def _keep_email_fingerprint_calls() -> set[tuple[str, str]]:
    """(table, fingerprint_column) pairs wired up by ``keep_email_fingerprint``.

    Scans every module-level ``keep_email_fingerprint(Model.attr, "name")`` call
    under ``app/models/`` by AST, then resolves ``Model`` through the live
    declarative registry (so a renamed model or attribute is still caught) to
    find the table ``name`` actually lives on.
    """
    classes = {
        mapper.class_.__name__: mapper.class_ for mapper in Base.registry.mappers
    }
    found: set[tuple[str, str]] = set()
    models_dir = Path(__file__).resolve().parents[1] / "app" / "models"
    for path in models_dir.glob("*.py"):
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if not (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "keep_email_fingerprint"
            ):
                continue
            target, name_arg = node.args
            assert isinstance(target, ast.Attribute), (
                f"{path.name}: keep_email_fingerprint's first argument must be "
                "a Model.attribute reference"
            )
            cls = classes[target.value.id]
            found.add((cls.__tablename__, name_arg.value))
    return found


def test_every_keep_email_fingerprint_call_is_in_the_rotation_script():
    """A model wired for blind-index lookup must have its fingerprint rotated.

    ``keep_email_fingerprint`` keeps the column correct going forward; only
    ``rotate_encryption_key.py``'s hand-written ``_FINGERPRINT_COLUMNS`` list
    rewrites the rows that already exist, under the current key — which is
    what lets an old ``ENCRYPTION_KEY`` be retired from
    ``ENCRYPTION_KEYS_LEGACY`` without losing every row that was never
    re-saved since the last rotation. ``email_fingerprints()`` checking every
    legacy key hides exactly this gap today; it reappears, silently, the day
    the legacy key a forgotten column still needs is finally removed.
    """
    missing = _keep_email_fingerprint_calls() - _fingerprint_registry()
    assert not missing, (
        f"rotate_encryption_key.py's _FINGERPRINT_COLUMNS is missing "
        f"{sorted(missing)}; add them so a key rotation can rewrite their "
        "fingerprints"
    )


def test_fingerprint_registry_names_no_column_that_is_not_wired():
    """A stale ``_FINGERPRINT_COLUMNS`` entry is harmless but misleading."""
    stale = _fingerprint_registry() - _keep_email_fingerprint_calls()
    assert not stale, (
        f"rotate_encryption_key.py's _FINGERPRINT_COLUMNS lists {sorted(stale)}, "
        "which no keep_email_fingerprint() call wires up any more"
    )


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
