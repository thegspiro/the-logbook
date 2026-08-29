"""Org-scoped containment for event attachment files (EV-17).

Event attachments are uploaded through ``POST /events/{id}/attachments``,
which writes the bytes to ``<ATTACHMENT_UPLOAD_DIR>/<organization_id>/
<event_id>/<uuid><ext>`` and appends server-authored metadata — including
``file_path`` — to the event's ``attachments`` JSON column. That column is
also writable by the *generic* event create/update payloads
(``EventCreate``/``EventUpdate``/``RecurringEventCreate`` all declare
``attachments: List[Dict[str, str]]``), and those paths stored whatever
dictionary the client sent.

Two independent halves are needed, and only having one of them is what made
this exploitable:

* **Write side** — ``validate_attachments_for_org`` rejects a client-supplied
  ``file_path`` that is not inside the caller's own upload subtree, so a
  foreign path never reaches the column (CLAUDE.md pitfall #14c: validate
  client-supplied references against the caller's org *before* persisting).
* **Read side** — ``assert_attachment_in_org`` confines download/delete to that
  same subtree. Confining to the shared ``ATTACHMENT_UPLOAD_DIR`` root is not
  enough: every organization's files live under that root, so a root-level
  check passes a path pointing at *another* organization's subdirectory. This
  mirrors the identical fix already made for documents (DOC-24) in
  ``api/v1/endpoints/documents.py``.

The org subdirectory has been part of the save path since the upload endpoint
was written, so no stored attachment predates the layout this confines to.
Copying an attachment between events of the *same* organization stays legal —
recurring-occurrence generation and event duplication both do it deliberately.
"""

import os
from typing import Any, Iterable, Optional

ATTACHMENT_UPLOAD_DIR = "/app/uploads/event-attachments"


def org_attachment_root(organization_id: Any) -> str:
    """Resolved filesystem root that holds *organization_id*'s attachments."""
    return os.path.realpath(os.path.join(ATTACHMENT_UPLOAD_DIR, str(organization_id)))


def is_path_in_org(file_path: Optional[str], organization_id: Any) -> bool:
    """Return True iff *file_path* resolves inside the org's own upload subtree.

    Fails **closed**: an empty path, a missing organization, or anything that
    resolves outside the subtree (``..`` traversal included, since the
    comparison is on the realpath) all return False.
    """
    if not file_path or not organization_id:
        return False
    root = org_attachment_root(organization_id)
    resolved = os.path.realpath(file_path)
    return resolved == root or resolved.startswith(root + os.sep)


def validate_attachments_for_org(
    attachments: Optional[Iterable[Any]], organization_id: Any
) -> None:
    """Raise ``ValueError`` unless every entry is an in-org attachment.

    Called from the event create/update service paths, whose callers translate
    ``ValueError`` into a 400. ``None`` means "the payload did not set the
    field" and is a no-op; an explicit empty list clears the column and is
    likewise fine.
    """
    if attachments is None:
        return
    for entry in attachments:
        if not isinstance(entry, dict):
            raise ValueError("Each attachment must be an object")
        if not is_path_in_org(entry.get("file_path"), organization_id):
            # Deliberately does not echo the rejected path: the message is
            # returned to the caller, and repeating a probe back confirms
            # whether a guessed path was well-formed.
            raise ValueError(
                "Attachment file_path must reference a file uploaded to this "
                "organization. Upload attachments via "
                "POST /events/{event_id}/attachments."
            )
