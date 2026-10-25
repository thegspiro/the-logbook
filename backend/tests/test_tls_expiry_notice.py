"""The administrator notice for database and cache TLS certificates that are
close to, or past, their expiry.

The backend mounts the certificates scripts/tls-setup.sh wrote; the notice
reads their public halves and says so before the connections start failing.
"""

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

from app.services import system_notices


def _certificate(days_left: int) -> bytes:
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "test")])
    now = datetime.now(timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=400))
        .not_valid_after(now + timedelta(days=days_left, hours=1))
        .sign(key, hashes.SHA256())
    )
    return cert.public_bytes(serialization.Encoding.PEM)


@pytest.fixture
def cert_dir(tmp_path: Path, monkeypatch) -> Path:
    monkeypatch.setattr(system_notices, "TLS_CERTIFICATE_DIR", tmp_path)
    return tmp_path


def _notice():
    matches = [
        n
        for n in system_notices.current_notices()
        if n.key == system_notices.TLS_CERTIFICATES_EXPIRING
    ]
    assert len(matches) <= 1
    return matches[0] if matches else None


@pytest.mark.unit
class TestTlsCertificatesExpiringNotice:
    def test_healthy_certificates_raise_nothing(self, cert_dir):
        (cert_dir / "client.pem").write_bytes(_certificate(200))
        (cert_dir / "mysql-server.pem").write_bytes(_certificate(31))

        assert _notice() is None

    def test_a_certificate_inside_the_window_is_a_warning_that_names_it(self, cert_dir):
        (cert_dir / "client.pem").write_bytes(_certificate(200))
        (cert_dir / "redis-server.pem").write_bytes(_certificate(12))

        notice = _notice()

        assert notice is not None
        assert notice.severity == "warning"
        assert "redis-server.pem (12 days left)" in notice.detail
        assert "client.pem" not in notice.detail
        assert "tls-setup.sh --renew" in notice.detail

    def test_the_window_is_thirty_days_inclusive(self, cert_dir):
        (cert_dir / "a.pem").write_bytes(_certificate(30))

        assert _notice() is not None

    def test_an_expired_certificate_is_critical(self, cert_dir):
        (cert_dir / "mysql-server.pem").write_bytes(_certificate(-3))

        notice = _notice()

        assert notice is not None
        assert notice.severity == "critical"
        assert "mysql-server.pem (expired)" in notice.detail

    def test_a_missing_directory_means_tls_is_not_set_up(self, tmp_path, monkeypatch):
        monkeypatch.setattr(system_notices, "TLS_CERTIFICATE_DIR", tmp_path / "absent")

        assert _notice() is None

    def test_files_that_are_not_certificates_are_skipped(self, cert_dir):
        (cert_dir / "notes.pem").write_text("not a certificate")
        (cert_dir / "empty.pem").write_bytes(b"")
        (cert_dir / "client.key").write_text("-----BEGIN PRIVATE KEY-----\n")

        assert _notice() is None

    def test_a_bundle_is_judged_certificate_by_certificate(self, cert_dir):
        (cert_dir / "bundle.pem").write_bytes(_certificate(300) + _certificate(5))

        notice = _notice()

        assert notice is not None
        assert "bundle.pem (5 days left)" in notice.detail

    def test_a_key_file_is_never_opened(self, cert_dir):
        key = cert_dir / "client.key"
        key.write_text("secret")
        key.chmod(0)

        assert _notice() is None
