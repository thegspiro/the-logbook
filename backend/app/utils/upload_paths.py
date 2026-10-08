"""Org-scoped containment for stored upload files.

Every module that writes uploads lays them out as
``<module upload root>/<organization_id>/...``. Confining a stored path to the
module root alone is not enough: every organization's files live under that
root, so a root-level check still accepts a path pointing at *another*
organization's subdirectory. The events (EV-17) and documents (DOC-24) fixes
established the per-org rule; this module is the shared form of it, so the
remaining modules apply the same check instead of each re-deriving a weaker
one.

The check runs on reads **and** deletes. A delete that trusts a stored path is
an arbitrary unlink, which is the same defect in the destructive direction.
"""

import os
from typing import Any, Iterable, Optional

# Characters that never belong in a filename offered to a browser. Path
# separators would let a stored name suggest a directory; control characters
# (CR/LF above all) have no meaning in a filename and are what header
# injection is built from. Starlette percent-encodes the header value, so this
# is about the name the user sees, not the only line of defence.
_UNSAFE_FILENAME_CHARS = {"/", "\\", "\x00"} | {chr(c) for c in range(0x20)} | {"\x7f"}
MAX_DOWNLOAD_FILENAME_LENGTH = 200


def org_upload_root(base_dir: str, organization_id: Any) -> Optional[str]:
    """Resolved directory holding *organization_id*'s files under *base_dir*.

    Returns None when there is no organization to scope to, so a caller that
    lost the org id fails closed instead of falling back to the shared root.
    """
    if not organization_id or not str(organization_id).strip():
        return None
    org = str(organization_id)
    # An org id that is itself a path segment would widen the subtree.
    if os.sep in org or org in (".", ".."):
        return None
    return os.path.realpath(os.path.join(base_dir, org))


def resolve_in_org(
    file_path: Any, base_dir: str, organization_id: Any
) -> Optional[str]:
    """Real path of *file_path* if it resolves inside the org's subtree.

    Fails **closed**: a non-string or empty path, a missing organization, and
    anything resolving outside ``<base_dir>/<organization_id>/`` (``..``
    traversal and symlinks included, since the comparison is on the realpath)
    all return None.
    """
    if not isinstance(file_path, str) or not file_path:
        return None
    root = org_upload_root(base_dir, organization_id)
    if root is None:
        return None
    resolved = os.path.realpath(file_path)
    if resolved.startswith(root + os.sep):
        return resolved
    return None


def resolve_in_any_org_root(
    file_path: Any, base_dirs: Iterable[str], organization_id: Any
) -> Optional[str]:
    """``resolve_in_org`` against several module roots; first match wins."""
    for base_dir in base_dirs:
        resolved = resolve_in_org(file_path, base_dir, organization_id)
        if resolved:
            return resolved
    return None


def safe_download_filename(name: Any, fallback: str = "download") -> str:
    """A filename safe to offer in ``Content-Disposition``.

    The stored name is the uploader's original filename and is otherwise
    unvalidated. Directory components are dropped, unsafe characters removed,
    and the result capped in length while keeping its extension.
    """
    if not isinstance(name, str):
        return fallback
    # Take the last component under either separator convention: a name
    # uploaded from Windows can arrive as ``C:\\Users\\x\\cert.pdf``.
    base = name.replace("\\", "/").rsplit("/", 1)[-1]
    cleaned = "".join(ch for ch in base if ch not in _UNSAFE_FILENAME_CHARS).strip()
    cleaned = cleaned.strip(".").strip()
    if not cleaned:
        return fallback
    if len(cleaned) > MAX_DOWNLOAD_FILENAME_LENGTH:
        stem, ext = os.path.splitext(cleaned)
        if len(ext) > 16:
            ext = ""
        cleaned = stem[: MAX_DOWNLOAD_FILENAME_LENGTH - len(ext)] + ext
    return cleaned
