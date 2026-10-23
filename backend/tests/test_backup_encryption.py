"""Encrypted backups: the shared library, the sidecar run, backup.sh and keygen.

These drive the real shell scripts with real openssl. Nothing is mocked except
the programs that would reach a database or a cloud: mysqldump, aws, mysql.
"""

import hashlib
import os
import shutil
import subprocess
import uuid
from pathlib import Path

import pytest

REPO = Path(__file__).parents[2]
SCRIPTS = REPO / "scripts"
CRYPTO = SCRIPTS / "backup_crypto.sh"
SIDECAR = SCRIPTS / "backup-sidecar.sh"
BACKUP_SH = SCRIPTS / "backup.sh"
KEYGEN = SCRIPTS / "backup-keygen.sh"
VERIFY = SCRIPTS / "verify_backup.sh"

pytestmark = pytest.mark.skipif(
    shutil.which("openssl") is None, reason="openssl is required"
)

SECRET = "member-ssn-078-05-1120-and-a-diagnosis"


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _run(
    cmd: list[str],
    env: dict[str, str] | None = None,
    stdin: str | None = None,
    timeout: int = 60,
) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        env=env,
        input=stdin,
        timeout=timeout,
    )


@pytest.fixture(scope="module")
def pair(tmp_path_factory) -> tuple[Path, Path]:
    """A throwaway recipient certificate and its private key."""
    base = tmp_path_factory.mktemp("pair")
    key, cert = base / "private.pem", base / "cert.pem"
    _run(
        [
            "openssl",
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-keyout",
            str(key),
            "-out",
            str(cert),
            "-subj",
            "/CN=test",
            "-days",
            "30",
        ]
    )
    return cert, key


@pytest.fixture
def work(tmp_path: Path) -> Path:
    (tmp_path / "keys").mkdir()
    (tmp_path / "plain.tar.gz").write_text(SECRET * 2000)
    return tmp_path


def _install_keys(work: Path, pair, *, cert: bool, drill: bool) -> str:
    keys = work / "keys"
    for stale in keys.iterdir():
        stale.unlink()
    if cert:
        shutil.copy(pair[0], keys / "backup-recipient.pem")
    drill_hex = os.urandom(32).hex()
    if drill:
        (keys / "backup-drill.key").write_text(drill_hex + "\n")
    return drill_hex


def _lib(work: Path, body: str, **extra: str) -> subprocess.CompletedProcess:
    env = {
        "PATH": os.environ["PATH"],
        "BACKUP_KEYS_DIR": str(work / "keys"),
        **extra,
    }
    return _run(["bash", "-c", f'source "{CRYPTO}"\n{body}'], env=env)


@pytest.mark.unit
class TestEncryptDecrypt:
    def test_round_trip_with_the_drill_key(self, work, pair):
        _install_keys(work, pair, cert=True, drill=True)

        result = _lib(
            work,
            f'cd "{work}" && bk_encrypt_file plain.tar.gz out.tar.gz.enc && '
            "bk_decrypt_file out.tar.gz.enc back.tar.gz",
        )

        assert result.returncode == 0, result.stderr
        assert _sha(work / "back.tar.gz") == _sha(work / "plain.tar.gz")

    def test_the_offline_private_key_opens_it_too(self, work, pair):
        _install_keys(work, pair, cert=True, drill=True)
        assert (
            _lib(work, f'cd "{work}" && bk_encrypt_file plain.tar.gz o.tar.gz.enc')
        ).returncode == 0
        (work / "keys" / "backup-drill.key").unlink()

        result = _lib(
            work,
            f'cd "{work}" && bk_decrypt_file o.tar.gz.enc back.tar.gz "" "{pair[1]}"',
        )

        assert result.returncode == 0, result.stderr
        assert _sha(work / "back.tar.gz") == _sha(work / "plain.tar.gz")

    def test_the_ciphertext_does_not_contain_the_plaintext(self, work, pair):
        _install_keys(work, pair, cert=True, drill=True)
        _lib(work, f'cd "{work}" && bk_encrypt_file plain.tar.gz o.tar.gz.enc')

        assert SECRET.encode() not in (work / "o.tar.gz.enc").read_bytes()
        assert SECRET.encode() not in (work / "o.tar.gz.enc.key").read_bytes()

    def test_two_encryptions_of_one_file_differ(self, work, pair):
        _install_keys(work, pair, cert=True, drill=True)
        _lib(
            work,
            f'cd "{work}" && bk_encrypt_file plain.tar.gz a.tar.gz.enc && '
            "bk_encrypt_file plain.tar.gz b.tar.gz.enc",
        )

        assert _sha(work / "a.tar.gz.enc") != _sha(work / "b.tar.gz.enc")

    def test_certificate_only_can_be_opened_with_the_private_key_alone(
        self, work, pair
    ):
        _install_keys(work, pair, cert=True, drill=False)
        encrypted = _lib(
            work, f'cd "{work}" && bk_encrypt_file plain.tar.gz o.tar.gz.enc'
        )
        assert encrypted.returncode == 0, encrypted.stderr

        no_key = _lib(work, f'cd "{work}" && bk_decrypt_file o.tar.gz.enc back')
        with_key = _lib(
            work,
            f'cd "{work}" && bk_decrypt_file o.tar.gz.enc back.tar.gz "" "{pair[1]}"',
        )

        assert no_key.returncode != 0
        assert with_key.returncode == 0, with_key.stderr
        assert _sha(work / "back.tar.gz") == _sha(work / "plain.tar.gz")

    def test_drill_key_only_works(self, work, pair):
        _install_keys(work, pair, cert=False, drill=True)

        result = _lib(
            work,
            f'cd "{work}" && bk_encrypt_file plain.tar.gz o.tar.gz.enc && '
            "bk_decrypt_file o.tar.gz.enc back.tar.gz",
        )

        assert result.returncode == 0, result.stderr
        assert _sha(work / "back.tar.gz") == _sha(work / "plain.tar.gz")

    def test_no_recipient_refuses_and_leaves_nothing(self, work, pair):
        _install_keys(work, pair, cert=False, drill=False)

        result = _lib(work, f'cd "{work}" && bk_encrypt_file plain.tar.gz o.tar.gz.enc')

        assert result.returncode != 0
        assert not list(work.glob("o.tar.gz.enc*"))

    def test_a_malformed_drill_key_fails_loudly_instead_of_being_ignored(
        self, work, pair
    ):
        _install_keys(work, pair, cert=True, drill=False)
        (work / "keys" / "backup-drill.key").write_text("not-a-key")

        result = _lib(work, f'cd "{work}" && bk_encrypt_file plain.tar.gz o.tar.gz.enc')

        assert result.returncode != 0
        assert "64 hexadecimal" in result.stderr
        assert not list(work.glob("o.tar.gz.enc*"))

    def test_a_different_drill_key_cannot_open_it(self, work, pair):
        _install_keys(work, pair, cert=False, drill=True)
        _lib(work, f'cd "{work}" && bk_encrypt_file plain.tar.gz o.tar.gz.enc')
        (work / "keys" / "backup-drill.key").write_text(os.urandom(32).hex())

        result = _lib(work, f'cd "{work}" && bk_decrypt_file o.tar.gz.enc back.tar.gz')

        assert result.returncode != 0
        assert not (work / "back.tar.gz").exists()

    def test_a_modified_archive_is_refused_before_anything_is_written(self, work, pair):
        _install_keys(work, pair, cert=True, drill=True)
        _lib(work, f'cd "{work}" && bk_encrypt_file plain.tar.gz o.tar.gz.enc')
        data = bytearray((work / "o.tar.gz.enc").read_bytes())
        data[len(data) // 2] ^= 0xFF
        (work / "o.tar.gz.enc").write_bytes(bytes(data))

        result = _lib(work, f'cd "{work}" && bk_decrypt_file o.tar.gz.enc back.tar.gz')

        assert result.returncode != 0
        assert "corrupted, truncated or swapped" in result.stderr
        assert not (work / "back.tar.gz").exists()
        assert not (work / "back.tar.gz.partial").exists()

    def test_a_truncated_archive_is_refused(self, work, pair):
        _install_keys(work, pair, cert=True, drill=True)
        _lib(work, f'cd "{work}" && bk_encrypt_file plain.tar.gz o.tar.gz.enc')
        data = (work / "o.tar.gz.enc").read_bytes()
        (work / "o.tar.gz.enc").write_bytes(data[:-100])

        result = _lib(work, f'cd "{work}" && bk_decrypt_file o.tar.gz.enc back.tar.gz')

        assert result.returncode != 0
        assert not (work / "back.tar.gz").exists()

    def test_another_archives_key_file_is_refused(self, work, pair):
        _install_keys(work, pair, cert=True, drill=True)
        (work / "second.tar.gz").write_text("something else entirely" * 100)
        _lib(
            work,
            f'cd "{work}" && bk_encrypt_file plain.tar.gz a.tar.gz.enc && '
            "bk_encrypt_file second.tar.gz b.tar.gz.enc",
        )
        shutil.copy(work / "b.tar.gz.enc.key", work / "a.tar.gz.enc.key")

        result = _lib(work, f'cd "{work}" && bk_decrypt_file a.tar.gz.enc back.tar.gz')

        assert result.returncode != 0
        assert not (work / "back.tar.gz").exists()

    def test_a_missing_key_file_is_refused(self, work, pair):
        _install_keys(work, pair, cert=True, drill=True)
        _lib(work, f'cd "{work}" && bk_encrypt_file plain.tar.gz o.tar.gz.enc')
        (work / "o.tar.gz.enc.key").unlink()

        result = _lib(work, f'cd "{work}" && bk_decrypt_file o.tar.gz.enc back.tar.gz')

        assert result.returncode != 0

    def test_a_file_with_a_different_format_marker_is_refused(self, work, pair):
        _install_keys(work, pair, cert=True, drill=True)
        _lib(work, f'cd "{work}" && bk_encrypt_file plain.tar.gz o.tar.gz.enc')
        key = work / "o.tar.gz.enc.key"
        key.write_text(key.read_text().replace("LBENC1", "LBENC9", 1))

        result = _lib(work, f'cd "{work}" && bk_decrypt_file o.tar.gz.enc back.tar.gz')

        assert result.returncode != 0
        assert "not a LBENC1 key file" in result.stderr

    def test_only_the_expected_extension_counts_as_encrypted(self):
        result = _run(
            [
                "bash",
                "-c",
                f'source "{CRYPTO}"; bk_is_encrypted_archive a.tar.gz.enc '
                "&& ! bk_is_encrypted_archive a.tar.gz && echo yes",
            ]
        )
        assert result.stdout.strip() == "yes"


@pytest.mark.unit
class TestEncryptExisting:
    def _plain_archives(self, work: Path) -> None:
        (work / "backups").mkdir()
        for stamp in ("20260101_020000", "20260102_020000"):
            name = work / "backups" / f"logbook_backup_{stamp}.tar.gz"
            name.write_text(SECRET + stamp)
            (work / "backups" / f"{name.name}.sha256").write_text("x  " + name.name)

    def test_converts_verifies_then_removes_the_plaintext(self, work, pair):
        _install_keys(work, pair, cert=True, drill=True)
        self._plain_archives(work)
        originals = {p.name: _sha(p) for p in (work / "backups").glob("*.tar.gz")}

        result = _lib(work, f'bk_encrypt_existing "{work}/backups"')

        assert result.returncode == 0, result.stderr
        backups = work / "backups"
        assert not list(backups.glob("*.tar.gz")), "plaintext archives must be gone"
        assert len(list(backups.glob("*.tar.gz.enc"))) == 2
        assert len(list(backups.glob("*.tar.gz.enc.key"))) == 2
        assert (backups / ".encrypted_existing_done").exists()
        for name, digest in originals.items():
            enc = backups / f"{name}.enc"
            check = work / f"check_{name}"
            decrypt = _lib(work, f'bk_decrypt_file "{enc}" "{check}"')
            assert decrypt.returncode == 0, decrypt.stderr
            assert _sha(check) == digest
            checksum = (backups / f"{enc.name}.sha256").read_text().split()[0]
            assert checksum == _sha(enc)

    def test_without_a_drill_key_nothing_is_deleted(self, work, pair):
        _install_keys(work, pair, cert=True, drill=False)
        self._plain_archives(work)

        result = _lib(work, f'bk_encrypt_existing "{work}/backups"')

        assert result.returncode == 0
        assert len(list((work / "backups").glob("*.tar.gz"))) == 2
        assert not list((work / "backups").glob("*.enc"))
        assert "needs the drill key" in result.stderr

    def test_the_switch_turns_it_off(self, work, pair):
        _install_keys(work, pair, cert=True, drill=True)
        self._plain_archives(work)

        _lib(
            work,
            f'bk_encrypt_existing "{work}/backups"',
            BACKUP_ENCRYPT_EXISTING="false",
        )

        assert len(list((work / "backups").glob("*.tar.gz"))) == 2
        assert not list((work / "backups").glob("*.enc"))

    def test_it_does_not_run_twice(self, work, pair):
        _install_keys(work, pair, cert=True, drill=True)
        self._plain_archives(work)
        _lib(work, f'bk_encrypt_existing "{work}/backups"')
        late = work / "backups" / "logbook_backup_20260103_020000.tar.gz"
        late.write_text("added after the pass")

        _lib(work, f'bk_encrypt_existing "{work}/backups"')

        assert late.exists()

    def test_nothing_happens_without_any_key(self, work, pair):
        _install_keys(work, pair, cert=False, drill=False)
        self._plain_archives(work)

        result = _lib(work, f'bk_encrypt_existing "{work}/backups"')

        assert result.returncode == 0
        assert len(list((work / "backups").glob("*.tar.gz"))) == 2


MYSQLDUMP_STUB = """#!/bin/bash
if [[ -n "${STUB_DUMP_FAIL:-}" ]]; then
    exit 2
fi
echo "-- dump"
echo "INSERT INTO members VALUES ('%s');"
""" % SECRET


@pytest.fixture
def sidecar(tmp_path: Path, pair):
    """Environment for one RUN_ONCE sidecar cycle with a stub mysqldump."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    stub = bin_dir / "mysqldump"
    stub.write_text(MYSQLDUMP_STUB)
    stub.chmod(0o755)
    (tmp_path / "keys").mkdir()
    (tmp_path / "backups").mkdir()
    env = {
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "RUN_ONCE": "1",
        "VERIFY_EVERY_N_BACKUPS": "0",
        "DB_PASSWORD": "pw",
        "BACKUP_DIR": str(tmp_path / "backups"),
        "BACKUP_KEYS_DIR": str(tmp_path / "keys"),
        "TMPDIR": str(tmp_path),
    }
    return tmp_path, env


def _status(backups: Path) -> dict:
    import json

    return json.loads((backups / ".backup_status").read_text())


@pytest.mark.unit
class TestSidecarRun:
    def test_with_keys_only_ciphertext_reaches_the_volume(self, sidecar, pair):
        base, env = sidecar
        shutil.copy(pair[0], base / "keys" / "backup-recipient.pem")
        (base / "keys" / "backup-drill.key").write_text(os.urandom(32).hex())

        result = _run(["bash", str(SIDECAR)], env=env)

        assert result.returncode == 0, result.stderr + result.stdout
        backups = base / "backups"
        names = sorted(p.name for p in backups.iterdir() if not p.name.startswith("."))
        assert len(names) == 3, names
        assert any(n.endswith(".tar.gz.enc") for n in names)
        assert any(n.endswith(".tar.gz.enc.key") for n in names)
        assert any(n.endswith(".tar.gz.enc.sha256") for n in names)
        assert not any(n.endswith(".tar.gz") for n in names)
        for blob in backups.iterdir():
            assert SECRET.encode() not in blob.read_bytes()
        assert _status(backups)["encrypted"] is True
        assert _status(backups)["ok"] is True

    def test_the_published_checksum_matches_the_ciphertext(self, sidecar, pair):
        base, env = sidecar
        (base / "keys" / "backup-drill.key").write_text(os.urandom(32).hex())
        _run(["bash", str(SIDECAR)], env=env)

        backups = base / "backups"
        enc = next(backups.glob("*.tar.gz.enc"))
        recorded = (backups / f"{enc.name}.sha256").read_text().split()
        assert recorded == [_sha(enc), enc.name]

    def test_the_archive_decrypts_to_the_dump(self, sidecar, pair):
        base, env = sidecar
        shutil.copy(pair[0], base / "keys" / "backup-recipient.pem")
        (base / "keys" / "backup-drill.key").write_text(os.urandom(32).hex())
        _run(["bash", str(SIDECAR)], env=env)
        enc = next((base / "backups").glob("*.tar.gz.enc"))

        out = base / "opened.tar.gz"
        opened = _lib(base, f'bk_decrypt_file "{enc}" "{out}"')
        listing = _run(["tar", "-tzf", str(out)])

        assert opened.returncode == 0, opened.stderr
        assert "database.sql.gz" in listing.stdout

    def test_without_keys_it_stays_plaintext_and_says_so(self, sidecar):
        base, env = sidecar

        result = _run(["bash", str(SIDECAR)], env=env)

        assert result.returncode == 0, result.stderr
        assert "NOT encrypted" in result.stderr
        backups = base / "backups"
        assert next(backups.glob("*.tar.gz"))
        assert not list(backups.glob("*.enc"))
        assert _status(backups)["encrypted"] is False

    def test_a_failed_dump_publishes_nothing_and_is_recorded(self, sidecar, pair):
        base, env = sidecar
        (base / "keys" / "backup-drill.key").write_text(os.urandom(32).hex())
        env["STUB_DUMP_FAIL"] = "1"

        result = _run(["bash", str(SIDECAR)], env=env)

        assert result.returncode != 0
        backups = base / "backups"
        assert not [p for p in backups.iterdir() if p.name.startswith("logbook_")]
        assert _status(backups)["ok"] is False

    def test_a_malformed_key_fails_the_run_instead_of_writing_plaintext(self, sidecar):
        base, env = sidecar
        (base / "keys" / "backup-drill.key").write_text("garbage")

        result = _run(["bash", str(SIDECAR)], env=env)

        assert result.returncode != 0
        assert not [
            p for p in (base / "backups").iterdir() if p.name.startswith("logbook_")
        ]

    def test_existing_plaintext_archives_are_converted_after_a_good_run(self, sidecar):
        base, env = sidecar
        old = base / "backups" / "logbook_backup_20250101_020000.tar.gz"
        old.write_text(SECRET)
        (base / "keys" / "backup-drill.key").write_text(os.urandom(32).hex())

        result = _run(["bash", str(SIDECAR)], env=env)

        assert result.returncode == 0, result.stderr
        assert not old.exists()
        assert (base / "backups" / f"{old.name}.enc").exists()

    def test_the_plaintext_archive_is_never_written_to_the_volume(self, sidecar):
        base, env = sidecar
        (base / "keys" / "backup-drill.key").write_text(os.urandom(32).hex())
        text = SIDECAR.read_text()

        assert 'plain="$workroot/$name.tar.gz"' in text
        assert 'tar -czf "$plain"' in text
        assert 'archive="$BACKUP_DIR/$name.tar.gz"\n    if ! tar' not in text


AWS_STUB = """#!/bin/bash
echo "aws $*" >> "$STUB_LOG"
"""


@pytest.fixture
def host(tmp_path: Path, pair):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name, body in (("aws", AWS_STUB),):
        stub = bin_dir / name
        stub.write_text(body)
        stub.chmod(0o755)
    (tmp_path / "keys").mkdir()
    (tmp_path / "project").mkdir()
    (tmp_path / "backups").mkdir()
    env = {
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "HOME": str(tmp_path),
        "STUB_LOG": str(tmp_path / "calls.log"),
        "BACKUP_KEYS_DIR": str(tmp_path / "keys"),
        "BACKUP_LOCATION": str(tmp_path / "backups"),
        "AWS_S3_BUCKET": "bucket",
        "TEST_BACKUP_NAME": f"logbook_test_{uuid.uuid4().hex}",
    }
    yield tmp_path, env
    shutil.rmtree(Path("/tmp") / env["TEST_BACKUP_NAME"], ignore_errors=True)
    for leftover in Path("/tmp").glob(f"{env['TEST_BACKUP_NAME']}*"):
        leftover.unlink(missing_ok=True)


def _backup_sh(env: dict[str, str], body: str) -> subprocess.CompletedProcess:
    script = (
        f'source "{BACKUP_SH}"\n'
        'BACKUP_NAME="$TEST_BACKUP_NAME"\n'
        'BACKUP_DIR="$BACKUP_LOCATION"\n'
        'mkdir -p "/tmp/$BACKUP_NAME"\n'
        'echo payload > "/tmp/$BACKUP_NAME/database.sql.gz"\n'
        f"{body}\n"
    )
    return _run(["bash", "-c", script], env=env)


@pytest.mark.unit
class TestBackupShEncryption:
    def test_with_keys_the_published_archive_is_ciphertext(self, host, pair):
        base, env = host
        (base / "keys" / "backup-drill.key").write_text(os.urandom(32).hex())

        result = _backup_sh(env, "compress_backup && echo $ARCHIVE_PATH")

        assert result.returncode == 0, result.stderr + result.stdout
        published = sorted(p.name for p in (base / "backups").iterdir())
        assert published == [
            f"{env['TEST_BACKUP_NAME']}.tar.gz.enc",
            f"{env['TEST_BACKUP_NAME']}.tar.gz.enc.key",
            f"{env['TEST_BACKUP_NAME']}.tar.gz.enc.sha256",
        ]

    def test_offsite_upload_sends_the_ciphertext_and_its_key_file(self, host, pair):
        base, env = host
        (base / "keys" / "backup-drill.key").write_text(os.urandom(32).hex())

        result = _backup_sh(env, "compress_backup && upload_to_s3")

        assert result.returncode == 0, result.stderr + result.stdout
        calls = (base / "calls.log").read_text()
        assert calls.count("aws s3 cp") == 3
        assert ".tar.gz.enc " in calls
        assert ".tar.gz.enc.key " in calls
        assert ".tar.gz.enc.sha256 " in calls

    def test_offsite_upload_refuses_a_plaintext_archive(self, host):
        base, env = host

        result = _backup_sh(env, "compress_backup && upload_to_s3")

        assert result.returncode != 0
        assert "Refusing to upload an unencrypted backup" in result.stdout
        assert not (base / "calls.log").exists()
        assert (base / "backups" / f"{env['TEST_BACKUP_NAME']}.tar.gz").exists()

    @pytest.mark.parametrize("function", ["upload_to_azure", "upload_to_gcs"])
    def test_every_provider_refuses_plaintext(self, host, function):
        base, env = host
        env.update(
            {
                "AZURE_STORAGE_CONTAINER": "c",
                "AZURE_STORAGE_ACCOUNT": "a",
                "GCS_BUCKET": "g",
            }
        )

        result = _backup_sh(env, f"compress_backup && {function}")

        assert result.returncode != 0
        assert "Refusing to upload an unencrypted backup" in result.stdout

    def test_restore_decrypts_with_the_private_key(self, host, pair):
        base, env = host
        shutil.copy(pair[0], base / "keys" / "backup-recipient.pem")
        (base / "keys" / "backup-drill.key").write_text(os.urandom(32).hex())
        name = env["TEST_BACKUP_NAME"]
        compress = _backup_sh(env, "compress_backup")
        assert compress.returncode == 0, compress.stderr + compress.stdout
        enc = base / "backups" / f"{name}.tar.gz.enc"
        # The restore must fail without a way to open the archive...
        (base / "keys" / "backup-drill.key").unlink()
        refused = _run(
            ["bash", str(BACKUP_SH), "--restore", str(enc)],
            env=env,
            stdin="yes\n",
        )
        assert refused.returncode != 0
        assert "Could not decrypt the backup" in refused.stdout
        # ...and get past decryption with the offline private key. This archive
        # has no database or uploads, so the restore ends at "completed".
        opened = _run(
            [
                "bash",
                str(BACKUP_SH),
                "--restore",
                str(enc),
                "--private-key",
                str(pair[1]),
            ],
            env=env,
            stdin="yes\n",
        )
        assert "Backup decrypted" in opened.stdout, opened.stdout + opened.stderr

    def test_listing_marks_plaintext_archives(self, host, pair):
        base, env = host
        (base / "backups" / "logbook_backup_20260101_020000.tar.gz").write_text("x")
        (base / "backups" / "logbook_backup_20260102_020000.tar.gz.enc").write_text("x")

        result = _backup_sh(env, "list_backups")

        assert "PLAINTEXT" in result.stdout
        assert "encrypted" in result.stdout

    def test_retention_prunes_the_encrypted_files_together(self, host):
        base, env = host
        old = base / "backups" / "logbook_backup_20200101_020000.tar.gz"
        files = [
            old.with_name(old.name + ext) for ext in (".enc", ".enc.key", ".enc.sha256")
        ]
        for f in files:
            f.write_text("x")
            os.utime(f, (1, 1))

        _backup_sh(env, "RETENTION_DAYS=1; cleanup_old_backups")

        assert not any(f.exists() for f in files)


@pytest.mark.unit
class TestKeygen:
    def _keygen(self, keys: Path, *args: str, stdin: str = "SAVED\n"):
        return _run(
            ["bash", str(KEYGEN), "--keys-dir", str(keys), *args],
            env={"PATH": os.environ["PATH"], "HOME": str(keys.parent)},
            stdin=stdin,
            timeout=120,
        )

    def test_creates_a_drill_key_and_certificate_and_prints_the_private_key(
        self, tmp_path
    ):
        keys = tmp_path / "keys"

        result = self._keygen(keys)

        assert result.returncode == 0, result.stderr + result.stdout
        assert (keys / "backup-drill.key").read_text().strip().__len__() == 64
        assert oct((keys / "backup-drill.key").stat().st_mode & 0o777) == "0o600"
        assert "BEGIN CERTIFICATE" in (keys / "backup-recipient.pem").read_text()
        assert "BEGIN PRIVATE KEY" in result.stdout
        for stored in keys.iterdir():
            assert "PRIVATE KEY" not in stored.read_text()

    def test_the_generated_pair_encrypts_and_decrypts(self, tmp_path):
        keys = tmp_path / "keys"
        out = tmp_path / "private.pem"
        self._keygen(keys, "--private-key-out", str(out))
        (tmp_path / "plain.tar.gz").write_text(SECRET)

        encrypted = _lib(
            tmp_path.parent,
            f'cd "{tmp_path}" && BACKUP_KEYS_DIR="{keys}" bk_encrypt_file plain.tar.gz o.enc',
        )
        (keys / "backup-drill.key").unlink()
        opened = _lib(
            tmp_path.parent,
            f'cd "{tmp_path}" && BACKUP_KEYS_DIR="{keys}" '
            f'bk_decrypt_file o.enc back.tar.gz "" "{out}"',
        )

        assert encrypted.returncode == 0, encrypted.stderr
        assert opened.returncode == 0, opened.stderr
        assert (tmp_path / "back.tar.gz").read_text() == SECRET

    def test_private_key_out_is_written_and_not_printed(self, tmp_path):
        keys = tmp_path / "keys"
        out = tmp_path / "elsewhere" / "private.pem"

        result = self._keygen(keys, "--private-key-out", str(out))

        assert result.returncode == 0, result.stderr
        assert "BEGIN PRIVATE KEY" not in result.stdout
        assert "BEGIN PRIVATE KEY" in out.read_text()
        assert oct(out.stat().st_mode & 0o777) == "0o600"

    def test_refuses_to_put_the_private_key_in_the_keys_directory(self, tmp_path):
        keys = tmp_path / "keys"

        result = self._keygen(keys, "--private-key-out", str(keys / "private.pem"))

        assert result.returncode != 0
        assert "outside" in result.stderr
        assert not (keys / "backup-drill.key").exists()

    def test_refuses_to_replace_keys_without_force(self, tmp_path):
        keys = tmp_path / "keys"
        assert self._keygen(keys).returncode == 0
        before = (keys / "backup-drill.key").read_text()

        again = self._keygen(keys)

        assert again.returncode != 0
        assert "already exists" in again.stderr
        assert (keys / "backup-drill.key").read_text() == before

    def test_force_replaces(self, tmp_path):
        keys = tmp_path / "keys"
        self._keygen(keys)
        before = (keys / "backup-drill.key").read_text()

        again = self._keygen(keys, "--force")

        assert again.returncode == 0, again.stderr
        assert (keys / "backup-drill.key").read_text() != before

    def test_declining_the_confirmation_removes_the_new_keys(self, tmp_path):
        keys = tmp_path / "keys"

        result = self._keygen(keys, stdin="no\n")

        assert result.returncode != 0
        assert not (keys / "backup-drill.key").exists()
        assert not (keys / "backup-recipient.pem").exists()

    def test_imports_a_certificate_without_a_private_key(self, tmp_path, pair):
        keys = tmp_path / "keys"

        result = self._keygen(keys, "--import-certificate", str(pair[0]), "--yes")

        assert result.returncode == 0, result.stderr + result.stdout
        assert "BEGIN PRIVATE KEY" not in result.stdout
        assert (keys / "backup-recipient.pem").read_text() == pair[0].read_text()

    def test_rejects_a_file_that_holds_a_private_key(self, tmp_path, pair):
        both = tmp_path / "both.pem"
        both.write_text(pair[0].read_text() + pair[1].read_text())

        result = self._keygen(
            tmp_path / "keys", "--import-certificate", str(both), "--yes"
        )

        assert result.returncode != 0
        assert "contains a private key" in result.stderr

    def test_rejects_something_that_is_not_a_certificate(self, tmp_path):
        junk = tmp_path / "junk.pem"
        junk.write_text("hello")

        result = self._keygen(
            tmp_path / "keys", "--import-certificate", str(junk), "--yes"
        )

        assert result.returncode != 0

    def test_drill_key_only_writes_no_certificate(self, tmp_path):
        keys = tmp_path / "keys"

        result = self._keygen(keys, "--drill-key-only", "--yes")

        assert result.returncode == 0, result.stderr
        assert (keys / "backup-drill.key").exists()
        assert not (keys / "backup-recipient.pem").exists()


MYSQL_STUB = """#!/bin/bash
args="$*"
case "$args" in
    *"COUNT(*) FROM information_schema"*) echo 60 ;;
    *"SELECT COUNT(*)"*) echo 3 ;;
    *) cat > /dev/null ;;
esac
exit 0
"""


@pytest.mark.unit
class TestVerifyBackup:
    def _setup(self, tmp_path: Path, pair):
        bin_dir = tmp_path / "bin"
        bin_dir.mkdir()
        stub = bin_dir / "mysql"
        stub.write_text(MYSQL_STUB)
        stub.chmod(0o755)
        keys = tmp_path / "keys"
        keys.mkdir()
        shutil.copy(pair[0], keys / "backup-recipient.pem")
        (keys / "backup-drill.key").write_text(os.urandom(32).hex())
        env = {
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
            "BACKUP_KEYS_DIR": str(keys),
            "DB_HOST": "127.0.0.1",
        }
        # A real archive: database.sql.gz inside logbook_backup_X/.
        top = tmp_path / "logbook_backup_20260101_020000"
        top.mkdir()
        sql = top / "database.sql"
        sql.write_text("SELECT 1;\n")
        _run(["gzip", str(sql)])
        plain = tmp_path / "logbook_backup_20260101_020000.tar.gz"
        _run(["tar", "-czf", str(plain), "-C", str(tmp_path), top.name])
        return env, plain, keys

    def test_an_encrypted_archive_is_restore_verified_with_the_drill_key(
        self, tmp_path, pair
    ):
        env, plain, keys = self._setup(tmp_path, pair)
        enc = plain.with_name(plain.name + ".enc")
        assert (
            _lib(
                tmp_path.parent,
                f'BACKUP_KEYS_DIR="{keys}" bk_encrypt_file "{plain}" "{enc}"',
            ).returncode
            == 0
        )
        (enc.with_name(enc.name + ".sha256")).write_text(f"{_sha(enc)}  {enc.name}\n")

        result = _run(["bash", str(VERIFY), str(enc)], env=env)

        assert "Archive decrypted" in result.stdout, result.stdout + result.stderr
        assert "RESTORE VERIFICATION PASSED" in result.stdout

    def test_without_the_drill_key_it_fails_and_names_the_alternative(
        self, tmp_path, pair
    ):
        env, plain, keys = self._setup(tmp_path, pair)
        enc = plain.with_name(plain.name + ".enc")
        _lib(
            tmp_path.parent,
            f'BACKUP_KEYS_DIR="{keys}" bk_encrypt_file "{plain}" "{enc}"',
        )
        (keys / "backup-drill.key").unlink()

        result = _run(["bash", str(VERIFY), str(enc)], env=env)

        assert result.returncode != 0
        assert "--private-key" in result.stderr

    def test_the_private_key_option_verifies_without_a_drill_key(self, tmp_path, pair):
        env, plain, keys = self._setup(tmp_path, pair)
        enc = plain.with_name(plain.name + ".enc")
        _lib(
            tmp_path.parent,
            f'BACKUP_KEYS_DIR="{keys}" bk_encrypt_file "{plain}" "{enc}"',
        )
        (keys / "backup-drill.key").unlink()

        result = _run(
            ["bash", str(VERIFY), str(enc), "--private-key", str(pair[1])], env=env
        )

        assert "RESTORE VERIFICATION PASSED" in result.stdout, (
            result.stdout + result.stderr
        )

    def test_a_tampered_archive_fails_verification(self, tmp_path, pair):
        env, plain, keys = self._setup(tmp_path, pair)
        enc = plain.with_name(plain.name + ".enc")
        _lib(
            tmp_path.parent,
            f'BACKUP_KEYS_DIR="{keys}" bk_encrypt_file "{plain}" "{enc}"',
        )
        data = bytearray(enc.read_bytes())
        data[40] ^= 0xFF
        enc.write_bytes(bytes(data))

        result = _run(["bash", str(VERIFY), str(enc)], env=env)

        assert result.returncode != 0
        assert "RESTORE VERIFICATION PASSED" not in result.stdout

    def test_a_plaintext_archive_still_verifies(self, tmp_path, pair):
        env, plain, _ = self._setup(tmp_path, pair)

        result = _run(["bash", str(VERIFY), str(plain)], env=env)

        assert "RESTORE VERIFICATION PASSED" in result.stdout, (
            result.stdout + result.stderr
        )
