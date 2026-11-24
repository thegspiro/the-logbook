"""The stored Documents a member erasure has to deal with (LIFE-11).

Two kinds, by owner decision of 2026-11-23:

* **Separation letters** — the property-return letter filed in the
  leadership-only Member Separations folder when the member was dropped. It
  may be a record the department must keep, because it states what is owed
  for unreturned property, so it is **redacted, not deleted**: the member's
  home address and the stated reason for leaving are removed from the stored
  HTML, and the item list and values stay. The letter is rewritten in place
  rather than regenerated, because a regenerated letter would list the
  member's property as it stands today, not as it stood on the day of the
  drop.
* **The personal Member Files folder** — every folder under the Member Files
  root owned by the member is deleted with its subtree and documents, through
  the same code ``DocumentsService.delete_folder`` runs. The files are queued
  on ``pending_file_deletions`` in the caller's transaction; the processing
  keeps any file another row still names.

Both erasures (anonymisation and permanent delete) call
:func:`erase_member_documents` before they change or remove the users row,
because finding the letters reads the member's name, address, membership
number and status reason.
"""

import re
from dataclasses import dataclass, field
from html import escape
from typing import Iterable, Optional

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.document import Document, DocumentFolder
from app.models.user import User
from app.services import file_storage_service as file_storage
from app.services.file_storage_service import StorageArea
from app.utils.sql_search import LIKE_ESCAPE_CHAR, like_pattern

#: ``Document.source_type`` of a property-return letter.
LETTER_SOURCE_TYPE = "property_return_report"
#: Slug of the Member Separations system folder the letters are filed in.
SEPARATIONS_FOLDER_SLUG = "member-separations"
#: Slug of the Member Files system folder the personal folders sit under.
MEMBERS_FOLDER_SLUG = "members"

ADDRESS_REMOVED = "(Address removed)"
TEXT_REMOVED = "[removed]"

# The letter's address block, as PropertyReturnService._render_html writes
# it: a marker comment, then one div holding the name paragraph and the
# address paragraph.
_ADDRESS_BLOCK = re.compile(
    r"(<!-- Member address block \(for window envelope\) -->\s*<div[^>]*>)"
    r"(.*?)(</div>)",
    re.DOTALL,
)
_FIRST_PARAGRAPH = re.compile(r"\s*<p\b[^>]*>.*?</p>", re.DOTALL)
_REASON_PARAGRAPH = re.compile(
    r"\s*<p\b[^>]*>\s*<strong>Reason:</strong>.*?</p>", re.DOTALL
)


@dataclass
class MemberDocumentErasure:
    """What :func:`erase_member_documents` did, as counts and file paths."""

    separation_letters_redacted: int = 0
    personal_folders_deleted: int = 0
    personal_documents_deleted: int = 0
    #: Each confined stored file of the deleted documents, for
    #: ``pending_file_deletions.enqueue``.
    document_paths: dict[str, StorageArea] = field(default_factory=dict)


def redact_separation_letter(
    html: str, *, street: Optional[str], reason: Optional[str]
) -> str:
    """*html* without the member's home address or reason for leaving.

    Structural first: the address block keeps the member's name paragraph and
    replaces the address with :data:`ADDRESS_REMOVED`, and the "Reason:"
    paragraph goes. Then, for a letter written by an older template whose
    markup did not match, any remaining occurrence of the member's street
    line or stored reason, as the template escaped it, becomes
    :data:`TEXT_REMOVED`. The city, state and ZIP are left to the structural
    pass alone: the department's own letterhead often shares them.
    """

    def _address(match: re.Match[str]) -> str:
        name = _FIRST_PARAGRAPH.match(match.group(2))
        kept = name.group(0) if name else ""
        return (
            f"{match.group(1)}{kept}\n"
            f'            <p style="margin:0;color:#6b7280;font-style:italic;">'
            f"{ADDRESS_REMOVED}</p>\n        {match.group(3)}"
        )

    redacted = _ADDRESS_BLOCK.sub(_address, html)
    redacted = _REASON_PARAGRAPH.sub("", redacted)
    for value in (street, reason):
        text = (value or "").strip()
        if text:
            redacted = redacted.replace(escape(text), TEXT_REMOVED)
    return redacted


async def _system_folder_id(
    db: AsyncSession, organization_id: str, slug: str
) -> Optional[str]:
    result = await db.execute(
        select(DocumentFolder.id)
        .where(
            DocumentFolder.organization_id == organization_id,
            DocumentFolder.slug == slug,
            DocumentFolder.is_system.is_(True),
        )
        .order_by(DocumentFolder.id)
        .limit(1)
    )
    folder_id = result.scalar_one_or_none()
    return str(folder_id) if folder_id is not None else None


def _membership_numbers(user: User) -> list[str]:
    return [
        str(n) for n in (user.membership_number, user.previous_membership_number) if n
    ]


async def _member_letters(
    db: AsyncSession, user: User, organization_id: str
) -> list[Document]:
    """The member's separation letters, locked for the rewrite.

    A letter saved since this module exists carries the member's id in
    ``source_id``. One saved before carries no link at all, only the name
    ``save_as_document`` gave it ("Property Return - <legal name> - <date>"),
    so it is matched by that name inside the Member Separations folder. When
    the member has a membership number, an unlinked letter must also print
    it, so a different member who shares the name is not redacted.
    """
    linked = Document.source_id == str(user.id)
    conditions = [linked]
    separations_id = await _system_folder_id(
        db, organization_id, SEPARATIONS_FOLDER_SLUG
    )
    if separations_id is not None and user.full_name.strip():
        conditions.append(
            (Document.source_id.is_(None))
            & (Document.folder_id == separations_id)
            & Document.name.like(
                like_pattern(f"Property Return - {user.full_name} - ", prefix=True),
                escape=LIKE_ESCAPE_CHAR,
            )
        )
    result = await db.execute(
        select(Document)
        .where(
            Document.organization_id == organization_id,
            Document.source_type == LETTER_SOURCE_TYPE,
            or_(*conditions),
        )
        .order_by(Document.id)
        .with_for_update()
    )
    numbers = _membership_numbers(user)
    letters = []
    for document in result.scalars().all():
        if str(document.source_id or "") != str(user.id) and numbers:
            body = document.content_html or ""
            if not any(f"Member #{escape(n)}" in body for n in numbers):
                continue
        letters.append(document)
    return letters


async def _personal_folders(
    db: AsyncSession, user: User, organization_id: str
) -> list[DocumentFolder]:
    members_root = await _system_folder_id(db, organization_id, MEMBERS_FOLDER_SLUG)
    if members_root is None:
        return []
    result = await db.execute(
        select(DocumentFolder)
        .where(
            DocumentFolder.organization_id == organization_id,
            DocumentFolder.parent_id == members_root,
            DocumentFolder.owner_user_id == str(user.id),
        )
        .order_by(DocumentFolder.id)
    )
    return list(result.scalars().all())


def _confined(paths: Iterable[str], organization_id: str) -> dict[str, StorageArea]:
    found: dict[str, StorageArea] = {}
    for path in paths:
        confined = file_storage.resolve(path, organization_id, StorageArea.DOCUMENTS)
        if confined:
            found[confined] = StorageArea.DOCUMENTS
    return found


async def erase_member_documents(
    db: AsyncSession, user: User, organization_id: str
) -> MemberDocumentErasure:
    """Redact the member's separation letters and delete their personal
    Member Files folders. Flushes; never commits.

    Call it before the users row is scrubbed or deleted. Raises
    ``ValueError`` when a personal document cannot go, for the reasons
    ``DocumentsService.delete_folder`` refuses (a document catalogued in
    History, a receipt a submitted finance record relies on); the caller's
    transaction then rolls back with nothing erased.
    """
    from app.services.documents_service import DocumentsService

    org_id = str(organization_id)
    erasure = MemberDocumentErasure()

    for letter in await _member_letters(db, user, org_id):
        redacted = redact_separation_letter(
            letter.content_html or "",
            street=user.address_street,
            reason=user.status_change_reason,
        )
        if redacted != (letter.content_html or ""):
            letter.content_html = redacted
        erasure.separation_letters_redacted += 1

    documents = DocumentsService(db)
    paths: list[str] = []
    for folder in await _personal_folders(db, user, org_id):
        document_ids, file_paths = await documents._delete_folder_subtree(
            folder, org_id
        )
        erasure.personal_documents_deleted += len(document_ids)
        paths.extend(file_paths)
        erasure.personal_folders_deleted += 1
    erasure.document_paths = _confined(paths, org_id)
    await db.flush()
    return erasure
