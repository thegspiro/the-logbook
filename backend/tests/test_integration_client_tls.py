"""The integration client loads a client certificate without httpx's
deprecated `cert=` path, and keeps every behaviour that path had.

Pinned httpx 0.28.1 warns on `AsyncHTTPTransport(cert=...)` and wants a
prebuilt `verify=<ssl.SSLContext>` with the chain loaded instead.
`_tls_verify` builds that context the way httpx would have, so these tests
check both halves: the warning is gone, and nothing the old argument did —
loading the chain, failing loudly on a bad file, honouring or ignoring
SSL_CERT_FILE per `trust_env` — was lost with it.
"""

import datetime
import os
import ssl
import warnings
from pathlib import Path
from unittest.mock import patch

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

from app.services.integration_services.base import (
    MAX_RESPONSE_SIZE,
    _environment_proxy_mounts,
    _tls_verify,
    create_integration_client,
)

pytestmark = pytest.mark.unit


def _write_key_and_cert(directory: Path, name: str) -> tuple[str, str]:
    key = ec.generate_private_key(ec.SECP256R1())
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, name)])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=1))
        .not_valid_after(now + datetime.timedelta(days=1))
        .sign(key, hashes.SHA256())
    )
    cert_path = directory / f"{name}.crt"
    key_path = directory / f"{name}.key"
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    return str(cert_path), str(key_path)


@pytest.fixture
def client_cert(tmp_path) -> tuple[str, str]:
    return _write_key_and_cert(tmp_path, "client")


@pytest.fixture
def combined_pem(tmp_path, client_cert) -> str:
    cert_path, key_path = client_cert
    combined = tmp_path / "combined.pem"
    combined.write_text(Path(cert_path).read_text() + Path(key_path).read_text())
    return str(combined)


def _pool_contexts(client) -> list[ssl.SSLContext]:
    transports = [client._transport] + [
        t for t in client._mounts.values() if t is not None
    ]
    return [t._transport._pool._ssl_context for t in transports]


class TestNoDeprecationWarning:
    async def test_cert_pair_builds_the_client_without_warning(self, client_cert):
        with warnings.catch_warnings():
            warnings.simplefilter("error", DeprecationWarning)
            client = create_integration_client(cert=client_cert)
        await client.aclose()

    async def test_combined_pem_builds_the_client_without_warning(self, combined_pem):
        with warnings.catch_warnings():
            warnings.simplefilter("error", DeprecationWarning)
            client = create_integration_client(cert=combined_pem)
        await client.aclose()

    async def test_explicit_and_environment_proxies_build_without_warning(
        self, client_cert
    ):
        with warnings.catch_warnings():
            warnings.simplefilter("error", DeprecationWarning)
            proxied = create_integration_client(
                cert=client_cert, proxy="http://proxy.example:8080"
            )
            with patch.dict(
                os.environ,
                {"HTTP_PROXY": "http://proxy.example:8080", "HTTPS_PROXY": ""},
                clear=False,
            ):
                mounts = _environment_proxy_mounts(MAX_RESPONSE_SIZE, cert=client_cert)
        await proxied.aclose()
        assert mounts["http://"] is not None


class TestTheChainStillReachesEveryTransport:
    async def test_direct_and_proxy_transports_share_the_loaded_context(
        self, client_cert
    ):
        client = create_integration_client(
            cert=client_cert, proxy="http://proxy.example:8080"
        )
        try:
            contexts = _pool_contexts(client)
            assert len(contexts) == 2
            assert all(isinstance(c, ssl.SSLContext) for c in contexts)
            assert contexts[0] is contexts[1]
        finally:
            await client.aclose()

    def test_a_mismatched_key_is_rejected(self, tmp_path, client_cert):
        # load_cert_chain checks the key against the certificate, so this
        # only raises if the pair actually reached it.
        cert_path, _ = client_cert
        _, other_key = _write_key_and_cert(tmp_path, "other")
        with pytest.raises(ssl.SSLError):
            _tls_verify((cert_path, other_key), trust_env=True)

    def test_a_missing_file_still_fails_at_construction(self):
        with pytest.raises(FileNotFoundError):
            create_integration_client(cert="/nonexistent/path/to/cert.pem")


class TestVerificationIsUnchanged:
    def test_no_cert_leaves_httpx_to_build_its_default(self):
        assert _tls_verify(None, trust_env=True) is True
        assert _tls_verify(None, trust_env=False) is True

    def test_context_verifies_hostnames_and_certificates(self, client_cert):
        ctx = _tls_verify(client_cert, trust_env=True)
        assert ctx.check_hostname is True
        assert ctx.verify_mode == ssl.CERT_REQUIRED

    def test_trust_env_false_ignores_ssl_cert_file(self, client_cert):
        with patch.dict(
            os.environ, {"SSL_CERT_FILE": "/nonexistent/ca.pem"}, clear=False
        ):
            assert isinstance(_tls_verify(client_cert, trust_env=False), ssl.SSLContext)

    def test_trust_env_true_honours_ssl_cert_file(self, client_cert):
        with patch.dict(
            os.environ, {"SSL_CERT_FILE": "/nonexistent/ca.pem"}, clear=False
        ):
            with pytest.raises(FileNotFoundError):
                _tls_verify(client_cert, trust_env=True)
