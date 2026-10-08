"""Org-scoped containment for event attachment files (EV-17).

Event attachments are uploaded through ``POST /events/{id}/attachments``,
which writes the bytes to ``<uploads>/<organization_id>/event-attachments/
<event_id>/<uuid><ext>`` (``FileStorageService``) and appends server-authored
metadata — including ``file_path`` — to the event's ``attachments`` JSON
column. That column is
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
* **Read side** — ``is_path_in_org`` confines download/delete to that same
  subtree. Confining to a shared root is not enough: every organization's
  files live under it, so a root-level check passes a path pointing at
  *another* organization's subdirectory. This
  mirrors the identical fix already made for documents (DOC-24) in
  ``api/v1/endpoints/documents.py``.

The org subdirectory has been part of the save path since the upload endpoint
was written, so no stored attachment predates the layout this confines to.
Copying an attachment between events of the *same* organization stays legal —
recurring-occurrence generation and event duplication both do it deliberately.
"""

from typing import Any, Iterable, Optional

from app.services.file_storage_service import StorageArea, resolve


def is_path_in_org(file_path: Any, organization_id: Any) -> bool:
    """Return True iff *file_path* resolves inside the org's own attachment
    storage — the org-first layout or the legacy
    ``event-attachments/<org>/`` tree (``FileStorageService.resolve``).

    Fails **closed**: an empty path, a missing organization, a value that is
    not a string, or anything that resolves outside the subtree (``..``
    traversal included, since the comparison is on the realpath) all return
    False.

    The type check is load-bearing, not defensive noise. ``attachments`` is
    typed ``List[Dict[str, Any]]`` — it has to be, because the upload handler
    writes ``file_size`` as an int and ``description`` as None — so a create
    request may legitimately reach here carrying ``{"file_path": 1}``. Without
    it, path resolution raises ``TypeError``, which the event endpoints do not
    catch (they translate ``ValueError`` to a 400), and a malformed request
    became a 500 instead of a validation error.
    """
    return (
        resolve(file_path, organization_id, StorageArea.EVENT_ATTACHMENTS) is not None
    )


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
