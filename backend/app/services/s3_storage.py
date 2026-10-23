"""A department's own S3 or MinIO bucket as the place its files live.

Decision 31 in ``docs/FILE_STORAGE_HARDENING.md``. The bucket, credentials and
endpoint are the department's, from its File Storage settings — never an
installation-wide setting. ``file_storage_service`` decides when this backend
is used; this module only knows how to talk to a bucket.

**A stored reference** is ``s3://<bucket>/<organization_id>/<area>/…``: the
same org-first layout as the uploads volume, with the bucket in front. The
bucket is part of the reference so a file stays findable after a department
points its settings at a different bucket. ``file_storage_service.resolve``
confines a reference to its organization and area by the key's leading
segments, exactly as it does a local path by its directory.

**Objects are encrypted before they leave the server** (``file_encryption``,
the same format as the uploads volume), so the bucket's operator never holds
plaintext and a leaked bucket gives nothing away without the installation's
file key.

**The endpoint is checked before any request** (``check_endpoint``). A
department administrator types it, so without the check the server's signed
requests could be pointed at an internal service. Private addresses and plain
HTTP need the operator's ``S3_ALLOW_PRIVATE_ENDPOINT``; cloud-metadata hosts
are refused regardless. botocore resolves the host again when it connects, so
a DNS-rebinding window remains between the check and the request — the same
as the other integrations' save-time checks, narrowed by re-checking each
time ``file_storage_service`` builds a client (its config cache is short).
"""

import hashlib
import hmac
import json
import re
from dataclasses import dataclass
from typing import Any, Iterator, Mapping, Optional
from urllib.parse import urlparse, urlunparse

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import BotoCoreError, ClientError
from loguru import logger

from app.core import file_encryption
from app.core.config import settings
from app.utils.url_validator import BLOCKED_HOSTNAMES, assert_outbound_url_safe

SCHEME = "s3://"

# S3's own naming rule: 3–63 characters, lowercase letters, digits, dots and
# hyphens, starting and ending with a letter or digit. Checked here because a
# bucket name is the first segment of every stored reference.
_BUCKET_NAME = re.compile(r"^[a-z0-9][a-z0-9.\-]{1,61}[a-z0-9]$")

# Without an endpoint and a region botocore cannot sign a request at all;
# this is AWS's own default.
DEFAULT_REGION = "us-east-1"

_CLIENT_CONFIG = BotoConfig(
    signature_version="s3v4",
    connect_timeout=5,
    read_timeout=30,
    retries={"max_attempts": 3, "mode": "standard"},
)

# Object-store error codes that mean "not there", as opposed to "could not ask".
_MISSING_CODES = frozenset({"404", "NoSuchKey", "NotFound"})


class S3StorageError(Exception):
    """The bucket could not be reached, or refused the request."""


@dataclass(frozen=True)
class S3Location:
    bucket: str
    key: str


def is_ref(ref: Any) -> bool:
    return isinstance(ref, str) and ref.startswith(SCHEME)


def parse_ref(ref: Any) -> Optional[S3Location]:
    """The bucket and key a stored reference names, or None if it is not one."""
    if not is_ref(ref):
        return None
    bucket, _, key = ref[len(SCHEME) :].partition("/")
    if not _BUCKET_NAME.match(bucket) or not key:
        return None
    return S3Location(bucket, key)


def make_ref(bucket: str, key: str) -> str:
    return f"{SCHEME}{bucket}/{key}"


@dataclass(frozen=True)
class S3Config:
    """What one department's settings say about its bucket."""

    bucket: str
    access_key_id: str
    secret_access_key: str
    region: Optional[str] = None
    endpoint_url: Optional[str] = None

    def fingerprint(self) -> str:
        """A keyed digest of everything that decides where files go and who
        writes them. Recorded when a connection test passes; a later change to
        any of these no longer matches, so new uploads stop going to a bucket
        nobody has tested. Keyed with SECRET_KEY so neither the secret access
        key nor a matching record can be derived from what is stored."""
        canonical = json.dumps(
            [
                self.bucket,
                self.region or "",
                self.endpoint_url or "",
                self.access_key_id,
                self.secret_access_key,
            ],
            separators=(",", ":"),
        )
        return hmac.new(
            settings.SECRET_KEY.encode(), canonical.encode(), hashlib.sha256
        ).hexdigest()


def config_from_settings(
    file_storage: Optional[Mapping[str, Any]],
) -> Optional[S3Config]:
    """The S3 configuration in a department's (decrypted) ``file_storage``
    settings, or None when the bucket or either key is missing. The platform
    choice itself is not judged here: a file already in the bucket is read
    with these credentials whatever the department now picks for new files.
    """
    if not isinstance(file_storage, Mapping):
        return None

    def text(name: str) -> Optional[str]:
        value = file_storage.get(name)
        return value.strip() if isinstance(value, str) and value.strip() else None

    bucket = text("s3_bucket_name")
    key_id = text("s3_access_key_id")
    secret = text("s3_secret_access_key")
    if not bucket or not key_id or not secret:
        return None
    return S3Config(
        bucket=bucket,
        access_key_id=key_id,
        secret_access_key=secret,
        region=text("s3_region"),
        endpoint_url=text("s3_endpoint_url"),
    )


def check_config(config: S3Config) -> None:
    """Refuse a configuration no request should be made with. Raises
    ValueError with a message an administrator can act on. Blocking (DNS):
    call it through ``asyncio.to_thread``."""
    if not _BUCKET_NAME.match(config.bucket):
        raise ValueError(
            "The bucket name is not a valid S3 bucket name (3–63 lowercase "
            "letters, digits, dots or hyphens)."
        )
    if config.endpoint_url:
        check_endpoint(config.endpoint_url)


def check_endpoint(url: str) -> None:
    allow_private = settings.S3_ALLOW_PRIVATE_ENDPOINT
    parsed = urlparse(url.strip())
    if parsed.scheme == "http":
        if not allow_private:
            raise ValueError(
                "The S3 endpoint must use HTTPS. A plain-HTTP endpoint on a "
                "private network (such as the bundled MinIO) needs the "
                "operator to set S3_ALLOW_PRIVATE_ENDPOINT=true."
            )
        # The shared guard requires HTTPS outside development; the operator
        # has accepted plain HTTP here, so run its remaining checks
        # (hostname present, metadata hosts blocked) on the same address.
        parsed = parsed._replace(scheme="https")
    if parsed.hostname in BLOCKED_HOSTNAMES:
        raise ValueError("The S3 endpoint address is not allowed.")
    try:
        assert_outbound_url_safe(urlunparse(parsed), allow_private=allow_private)
    except ValueError as exc:
        if allow_private:
            raise ValueError(f"The S3 endpoint is not allowed: {exc}") from exc
        raise ValueError(
            f"The S3 endpoint is not allowed: {exc}. An endpoint on a private "
            "network needs the operator to set S3_ALLOW_PRIVATE_ENDPOINT=true."
        ) from exc


def _error_code(exc: ClientError) -> str:
    error = exc.response.get("Error") or {}
    return str(error.get("Code") or "")


class S3Backend:
    """One department's bucket. Every method is blocking: callers run it
    through ``asyncio.to_thread``. Failures surface as :class:`S3StorageError`
    with the underlying error logged, never with credentials in the message.
    """

    def __init__(self, config: S3Config, client: Any = None):
        self.config = config
        self._client = client or boto3.client(
            "s3",
            endpoint_url=config.endpoint_url,
            region_name=config.region or DEFAULT_REGION,
            aws_access_key_id=config.access_key_id,
            aws_secret_access_key=config.secret_access_key,
            config=_CLIENT_CONFIG.merge(
                # MinIO and most S3-compatible stores serve buckets by path,
                # not by a bucket subdomain that would need its own DNS.
                BotoConfig(s3={"addressing_style": "path"})
                if config.endpoint_url
                else BotoConfig()
            ),
        )

    def _fail(
        self, action: str, location: S3Location, exc: Exception
    ) -> S3StorageError:
        logger.error(
            f"S3 {action} failed for s3://{location.bucket}/{location.key}: "
            f"{type(exc).__name__}: {exc}"
        )
        return S3StorageError(f"S3 {action} failed")

    def put(self, location: S3Location, plaintext: bytes) -> None:
        """Encrypt *plaintext* and store it at *location*."""
        body = file_encryption.encrypt_bytes(plaintext)
        try:
            self._client.put_object(
                Bucket=location.bucket,
                Key=location.key,
                Body=body,
                ContentType="application/octet-stream",
            )
        except (BotoCoreError, ClientError) as exc:
            raise self._fail("upload", location, exc) from exc

    def exists(self, location: S3Location) -> bool:
        try:
            self._client.head_object(Bucket=location.bucket, Key=location.key)
        except ClientError as exc:
            if _error_code(exc) in _MISSING_CODES:
                return False
            raise self._fail("existence check", location, exc) from exc
        except BotoCoreError as exc:
            raise self._fail("existence check", location, exc) from exc
        return True

    def _get(self, location: S3Location, **kwargs: Any) -> Mapping[str, Any]:
        try:
            response: Mapping[str, Any] = self._client.get_object(
                Bucket=location.bucket, Key=location.key, **kwargs
            )
        except ClientError as exc:
            if _error_code(exc) in _MISSING_CODES:
                raise FileNotFoundError(
                    f"s3://{location.bucket}/{location.key}"
                ) from exc
            raise self._fail("read", location, exc) from exc
        except BotoCoreError as exc:
            raise self._fail("read", location, exc) from exc
        return response

    def read_bytes(self, location: S3Location) -> bytes:
        size, chunks = self.open_plaintext(location)
        data = b"".join(chunks)
        if len(data) != size:
            raise file_encryption.FileDecryptionError("The file is truncated")
        return data

    def _head_bytes(self, location: S3Location) -> tuple[bytes, Mapping[str, Any]]:
        response = self._get(
            location, Range=f"bytes=0-{file_encryption.HEADER_SIZE - 1}"
        )
        body = response["Body"]
        try:
            head: bytes = body.read()
        except (BotoCoreError, ClientError) as exc:
            raise self._fail("read", location, exc) from exc
        finally:
            body.close()
        return head, response

    def key_id(self, location: S3Location) -> Optional[bytes]:
        """The key the object was encrypted under; None for a plain object."""
        head, _response = self._head_bytes(location)
        return file_encryption.key_id_from_head(head)

    def plaintext_size(self, location: S3Location) -> int:
        head, response = self._head_bytes(location)
        # A ranged response's ContentLength is the range's; the whole object's
        # length is the figure after the slash in ContentRange.
        content_range = str(response.get("ContentRange") or "")
        _, _, total = content_range.rpartition("/")
        stored_size = int(total) if total.isdigit() else len(head)
        return file_encryption.plaintext_size_from_head(head, stored_size)

    def open_plaintext(self, location: S3Location) -> tuple[int, Iterator[bytes]]:
        """``(plaintext size, chunk iterator)``; the body is closed when the
        iterator finishes or is discarded."""
        response = self._get(location)
        body = response["Body"]
        try:
            size, chunks = file_encryption.open_plaintext_reader(
                body, int(response.get("ContentLength") or 0)
            )
        except BaseException:
            body.close()
            raise

        def closing() -> Iterator[bytes]:
            try:
                yield from chunks
            except (BotoCoreError, ClientError) as exc:
                raise self._fail("read", location, exc) from exc
            finally:
                body.close()

        return size, closing()

    def delete(self, location: S3Location) -> bool:
        """True when the object is gone afterwards; S3 reports success for a
        key that was already absent, which is the same outcome."""
        try:
            self._client.delete_object(Bucket=location.bucket, Key=location.key)
        except (BotoCoreError, ClientError) as exc:
            logger.warning(
                f"Could not remove s3://{location.bucket}/{location.key}: "
                f"{type(exc).__name__}: {exc}"
            )
            return False
        return True
