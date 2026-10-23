"""What every remote place a department can keep its files in provides.

A department picks a File Storage platform; the ones this installation can
actually connect to are listed by :func:`platforms`, keyed by that setting's
value. ``file_storage_service`` works only through this interface — the
connection test, where a new file goes, how a stored reference is read — so a
platform is added by implementing it, never by teaching each caller about it.

**A stored reference** names its platform by scheme (``s3://``, …) and carries
the same org-first key the uploads volume uses, ``<org>/<area>/<record>/<name>``:
``file_storage_service.resolve`` confines a reference to its organization and
area by that key, whichever platform holds it.

**Every platform stores what ``file_encryption`` produced**, so its operator
never holds plaintext; a backend encrypts in :meth:`RemoteBackend.put` and
decrypts on every read.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Iterator, Mapping, Optional


class RemoteStorageError(Exception):
    """The remote store could not be reached, or refused the request. Never
    carries credentials in its message."""


@dataclass(frozen=True)
class RemoteRef:
    """What a stored reference names: the platform, the container on it (a
    bucket, a shared drive) and the org-first key of the file."""

    platform: str
    container: str
    key: str


class RemoteConfig(ABC):
    """One department's saved settings for a platform."""

    @property
    @abstractmethod
    def container(self) -> str:
        """The bucket, drive or library new files go into."""

    @abstractmethod
    def fingerprint(self) -> str:
        """A keyed digest of every setting that decides where files go and
        who writes them. A passed connection test records it; a later edit to
        any of those settings no longer matches, so new files stop going
        somewhere nobody has tested."""

    @abstractmethod
    def describe(self) -> Mapping[str, Any]:
        """What the Storage screen and the activation record show about where
        files go: never a secret."""


class RemoteBackend(ABC):
    """One department's store on a platform. Every method blocks: callers run
    it through ``asyncio.to_thread``. A failure to reach the store raises
    :class:`RemoteStorageError`; a missing file raises ``FileNotFoundError``."""

    config: RemoteConfig

    @abstractmethod
    def ref_for(self, key: str) -> str:
        """The reference a new file stored under *key* will have."""

    @abstractmethod
    def put(self, ref: str, plaintext: bytes) -> None:
        """Encrypt *plaintext* and store it as *ref*."""

    @abstractmethod
    def exists(self, ref: str) -> bool:
        """Whether *ref* is stored."""

    @abstractmethod
    def read_bytes(self, ref: str) -> bytes:
        """The stored file's plaintext."""

    @abstractmethod
    def plaintext_size(self, ref: str) -> int:
        """The plaintext's size, without reading all of it."""

    @abstractmethod
    def open_plaintext(self, ref: str) -> tuple[int, Iterator[bytes]]:
        """``(plaintext size, chunk iterator)`` for a streamed download."""

    @abstractmethod
    def delete(self, ref: str) -> bool:
        """True when *ref* is gone afterwards; a failure is logged, never
        raised."""

    @abstractmethod
    def key_id(self, ref: str) -> Optional[bytes]:
        """The file key *ref* was encrypted under; None for a plain file."""


class RemotePlatform(ABC):
    """A platform a department can switch its files to."""

    #: The File Storage ``platform`` setting that selects it.
    name: str
    #: How the Storage screen names it.
    label: str
    #: The shorter name buttons use ("Test and switch to S3").
    short_label: str
    #: What one container is called on it ("bucket").
    container_noun: str
    #: The reference prefix, ``<scheme>://``.
    scheme: str

    def is_ref(self, ref: Any) -> bool:
        return isinstance(ref, str) and ref.startswith(self.scheme)

    @abstractmethod
    def parse_ref(self, ref: Any) -> Optional[RemoteRef]:
        """What *ref* names, or None when it is not a valid reference."""

    @abstractmethod
    def config_from_settings(
        self, file_storage: Optional[Mapping[str, Any]]
    ) -> Optional[RemoteConfig]:
        """The platform's configuration in a department's decrypted
        ``file_storage`` settings, or None when it is incomplete."""

    @abstractmethod
    def check_config(self, config: RemoteConfig) -> None:
        """Refuse a configuration no request should be made with, with a
        message an administrator can act on. Blocking (it may resolve a
        host): call it through ``asyncio.to_thread``."""

    @abstractmethod
    def backend(self, config: RemoteConfig) -> RemoteBackend:
        """A store for *config*, already checked."""

    #: What the connection test's failure tells an administrator to check.
    test_failure_hint: str = "Check the settings and the account's permissions."
    #: What is missing when :meth:`config_from_settings` returns None.
    incomplete_hint: str = "Save every required setting first."


def platforms() -> Mapping[str, RemotePlatform]:
    """Every platform this installation can connect to, by setting value.
    Imported here rather than at module level: each platform's module
    imports this one for the interface."""
    from app.services import s3_storage

    return {platform.name: platform for platform in (s3_storage.PLATFORM,)}


def platform_for_ref(ref: Any) -> Optional[RemotePlatform]:
    """The platform whose reference *ref* is, or None for a local path."""
    for platform in platforms().values():
        if platform.is_ref(ref):
            return platform
    return None


def is_remote_ref(ref: Any) -> bool:
    return platform_for_ref(ref) is not None


def parse_remote_ref(ref: Any) -> Optional[RemoteRef]:
    platform = platform_for_ref(ref)
    return platform.parse_ref(ref) if platform is not None else None


def labels() -> dict[str, str]:
    return {name: platform.label for name, platform in platforms().items()}
