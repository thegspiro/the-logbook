"""
Documents Service

Business logic for document management including folders,
document CRUD, and file handling.

This is a thin wrapper around DocumentService that provides the
interface used by the documents API endpoint (using direct returns
and HTTPException-style error handling rather than tuple returns).
"""

import asyncio
import os
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple
from uuid import UUID

from loguru import logger
from sqlalchemy import case
from sqlalchemy import delete as sa_delete
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import FOLDER_EVENTS, FOLDER_FACILITIES
from app.core.permissions import (
    get_rank_default_permissions,
    permission_matches_any,
    permission_matches_any_write,
)
from app.models.document import (
    Document,
    DocumentFolder,
    DocumentStatus,
    FolderVisibility,
)
from app.models.facilities import FacilityDocument, FacilityPhoto
from app.models.user import Organization, User
from app.utils.model_updates import apply_updates
from app.utils.org_scoping import assert_in_org
from app.utils.sql_search import LIKE_ESCAPE_CHAR, like_pattern

# Permissions that grant leadership-level access to all folders
LEADERSHIP_PERMISSIONS = {"documents.manage", "members.manage", "*"}

# The facilities module gates its sensitive records — access codes, utility
# accounts, capital projects, insurance policies, lease terms — on this set,
# and the facility file tree stores the bytes behind those records. It has to
# carry the same gate or the record is protected and the file it points at is
# not. Kept identical to _SENSITIVE_READ_PERMISSIONS in the facilities
# endpoint; tests/test_facility_folder_access.py asserts the two agree.
FACILITY_SENSITIVE_PERMISSIONS = [
    "facilities.view_sensitive",
    "facilities.edit",
    "facilities.manage",
]

# ============================================================================
# FAC-35: canonical lock order for facility document/photo references
# ============================================================================
# Three independent code paths mutate the same three resources concurrently
# -- facilities.py's ``_validate_shared_document_reference`` (the creator
# path, reached from ``create_facility_document``/``create_facility_photo``),
# this file's ``delete_folder`` (the deletion cascade), and this file's
# ``update_document`` (the generic ``PATCH /documents/{id}`` move, FAC-36).
# Any path that needs more than one of these locked at once MUST acquire
# them in exactly this order -- a total order across all three, not just the
# pair a given change happens to touch:
#
#   1. DocumentFolder   -- e.g. ``ensure_facility_folder``,
#                           ``_lock_subtree_folders``,
#                           ``_lock_destination_folder``
#   2. Document          -- e.g. ``get_document_by_id(for_update=True)``,
#                           ``_lock_subtree_documents``
#   3. FacilityDocument / FacilityPhoto reference table -- e.g. the caller's
#                           insert after ``_validate_shared_document_reference``
#                           returns, or ``_match_facility_document_references``/
#                           ``_delete_facility_document_references``
#
# FAC-29/31/32/34/36 each closed one *pairwise* conflict between two of these
# three resources without checking the fix against every other path that
# touches the same state, and each reordering opened a new conflict with the
# pair it hadn't considered (FAC-32 vs FAC-34: Document/reference-table vs
# Document/DocumentFolder; FAC-34 vs the creator path: DocumentFolder/Document
# ordered oppositely by the two sides; FAC-35's fixed creator path vs
# ``update_document``: the same DocumentFolder/Document pair, ordered
# oppositely yet again by a third site nobody had touched). FAC-35
# (docs/security-review/FAC-12-facilities.md) is the total-order fix that
# supersedes the pairwise ones above it; FAC-36 is the third call site that
# fix's own write-up flagged as needing a revisit "if a third site...
# appears." A new call site touching two or more of these three resources
# follows this order, it does not invent its own -- and does not assume the
# two documented here are exhaustive; grep this file and facilities.py for
# ``with_for_update``/``for_update=True`` against these three models before
# trusting this comment's site list over the code.
# ============================================================================


def _get_user_permissions(user: User) -> Set[str]:
    """Collect a user's effective permissions.

    Must resolve them the same way the HTTP layer does
    (``_collect_user_permissions`` in api/dependencies.py): positions **and**
    operational-rank defaults. Reading positions alone refused a chief whose
    facilities grants come from their rank — the endpoint admitted them and
    then the folder gate turned them away, so the file they were entitled to
    was unreachable with no indication why.
    """
    perms: Set[str] = set()
    for role in user.roles:
        perms.update(role.permissions or [])
    if user.rank:
        perms.update(get_rank_default_permissions(user.rank))
    return perms


def _get_user_role_slugs(user: User) -> Set[str]:
    """Collect role slugs from a user's roles."""
    return {role.slug for role in user.roles}


def _is_leadership(user_permissions: Set[str]) -> bool:
    """Check if the user has any leadership-level permission."""
    return bool(user_permissions & LEADERSHIP_PERMISSIONS)


class DocumentsService:
    """Service for document management used by the documents endpoint"""

    UPLOAD_DIR = "/app/uploads/documents"

    def __init__(self, db: AsyncSession):
        self.db = db

    # ============================================
    # Folder Management
    # ============================================

    async def create_folder(
        self, organization_id: UUID, folder_data: Dict[str, Any], created_by: UUID
    ) -> DocumentFolder:
        """Create a new document folder. Raises on failure."""
        # DOC-6 (XC-1): validate client-supplied FKs are in-org before storing.
        await assert_in_org(
            self.db,
            DocumentFolder,
            folder_data.get("parent_id"),
            organization_id,
            allow_none=True,
            label="parent folder",
        )
        await assert_in_org(
            self.db,
            User,
            folder_data.get("owner_user_id"),
            organization_id,
            allow_none=True,
            label="owner",
        )
        folder = DocumentFolder(
            organization_id=organization_id, created_by=created_by, **folder_data
        )
        self.db.add(folder)
        await self.db.commit()
        await self.db.refresh(folder)
        return folder

    async def get_folders(
        self,
        organization_id: UUID,
        parent_id: Optional[UUID] = None,
        current_user: Optional[User] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> Tuple[List[DocumentFolder], int]:
        """
        Get one page of the folders the user is allowed to see, and the total.

        Access rules:
        - visibility='organization' → visible to all org members
        - visibility='leadership'   → only users with leadership permissions
        - visibility='owner'        → only the owner_user_id + leadership
        - allowed_roles (if set)    → only users with a matching role slug
        - required_permissions      → only users holding one of them

        A folder is admitted only if every folder on its path to the root
        admits the user, so the set comes from accessible_folder_ids rather
        than a per-row check here: a restriction lives on the ancestor, and a
        query filtered to one parent level cannot see it. Delegating also
        keeps this listing's answer equal to the by-id fetch's, which is what
        the two copies of the rule failed to do before.

        Ordering carries DocumentFolder.id as a final tie-breaker. Without it
        two folders sharing a sort_order and name order arbitrarily, and a row
        can appear on two pages or on neither while the caller walks them.
        """
        query = select(DocumentFolder).where(
            DocumentFolder.organization_id == str(organization_id)
        )

        if parent_id:
            query = query.where(DocumentFolder.parent_id == parent_id)
        else:
            query = query.where(DocumentFolder.parent_id.is_(None))

        if current_user is not None:
            accessible = await self.accessible_folder_ids(organization_id, current_user)
            if not accessible:
                return [], 0
            query = query.where(DocumentFolder.id.in_(accessible))

        total = (
            await self.db.execute(select(func.count()).select_from(query.subquery()))
        ).scalar_one()
        if total == 0 or skip >= total:
            return [], total

        # One grouped subquery instead of a count per folder. The previous
        # per-folder loop issued a query for every row on the page, so a
        # department with a wide folder tree paid a round trip per card.
        counts = (
            select(
                Document.folder_id,
                func.count(Document.id).label("document_count"),
            )
            .where(Document.status == DocumentStatus.ACTIVE)
            .group_by(Document.folder_id)
            .subquery()
        )
        page = (
            query.add_columns(func.coalesce(counts.c.document_count, 0))
            .outerjoin(counts, counts.c.folder_id == DocumentFolder.id)
            .order_by(
                DocumentFolder.sort_order,
                DocumentFolder.name,
                DocumentFolder.id,
            )
            .offset(skip)
            .limit(limit)
        )
        folders: List[DocumentFolder] = []
        for folder, document_count in (await self.db.execute(page)).all():
            folder.document_count = document_count
            folders.append(folder)

        return folders, total

    async def get_folder_by_id(
        self, folder_id: UUID, organization_id: UUID
    ) -> Optional[DocumentFolder]:
        """Get a folder by ID"""
        result = await self.db.execute(
            select(DocumentFolder)
            .where(DocumentFolder.id == str(folder_id))
            .where(DocumentFolder.organization_id == str(organization_id))
        )
        return result.scalar_one_or_none()

    @staticmethod
    def _folder_admits_user(
        folder: DocumentFolder, user: User, *, require_write: bool = False
    ) -> bool:
        """Apply one folder's restrictions, without considering its parent.

        ``required_permissions`` is checked *before* the leadership bypass and
        is the one rule leadership does not override. Every other restriction
        here answers "is this person senior enough", which documents.manage
        legitimately settles. This one answers "does this person hold the
        module grant the data is gated on" — a facility's insurance policies
        and lease terms are readable with facilities.view_sensitive and not
        otherwise, and a documents administrator holding no facilities grant is
        exactly who that contract excludes. Letting the bypass win here would
        reopen the leak this field exists to close, one module at a time.

        ``require_write``: ``required_permissions`` lists every permission
        that admits a *reader* — for a sensitive facility folder, that
        includes the read-only ``facilities.view_sensitive`` alongside
        ``facilities.edit``/``facilities.manage``. A mutation (rename,
        delete, move a document in or out) is a different question, and
        answering it with the same OR-of-any-admitting-permission check lets
        a caller who holds only the read-tier permission from the list —
        e.g. the seeded treasurer, who has ``facilities.view_sensitive`` and
        no facilities write grant at all — pass a check that was supposed to
        gate writing. The source module's own mutation routes never accept a
        view-only permission for a write (see ``facilities.py``'s
        ``.edit``/``.delete``/``.manage`` requirements); a generic document
        mutation reusing this folder's ACL must hold the caller to the same
        bar.
        """
        user_perms = _get_user_permissions(user)

        if folder.required_permissions:
            # permission_matches_any, not a raw set intersection: a member
            # granted `facilities.*` holds every facilities permission, and an
            # intersection sees none of them. It also subsumes the global "*"
            # case this previously special-cased by hand.
            matcher = (
                permission_matches_any_write
                if require_write
                else permission_matches_any
            )
            if not matcher(folder.required_permissions, user_perms):
                return False

        if _is_leadership(user_perms):
            return True

        vis = folder.visibility or FolderVisibility.ORGANIZATION

        if vis == FolderVisibility.LEADERSHIP:
            return False

        if vis == FolderVisibility.OWNER:
            return folder.owner_user_id is not None and str(
                folder.owner_user_id
            ) == str(user.id)

        # organization visibility - check allowed_roles if set
        if folder.allowed_roles:
            user_roles = _get_user_role_slugs(user)
            return bool(user_roles & set(folder.allowed_roles))

        return True

    async def can_access_folder(
        self,
        folder: DocumentFolder,
        organization_id: UUID,
        user: User,
        folders_by_id: Optional[Dict[str, DocumentFolder]] = None,
        *,
        require_write: bool = False,
    ) -> bool:
        """Authorize a folder by evaluating it and every ancestor.

        Restrictions compose with logical AND: every folder from the requested
        folder through the root must admit the caller.  Missing ancestors,
        ancestors belonging to another organization, and ancestry cycles all
        fail closed.  The per-folder leadership bypass still cannot override
        ``required_permissions``.

        ``folders_by_id`` may contain an already org-scoped folder snapshot for
        callers authorizing many folders.  A missing id in such a snapshot is
        treated as corrupt ancestry rather than triggering an unscoped lookup.

        ``require_write`` asks a stricter question at every level of the
        chain: not "can this caller read this far", but "can this caller
        write here" — see ``_folder_admits_user``. Callers authorizing a
        mutation (rename, delete, file into, move out of) must pass this.
        """
        expected_org = str(organization_id)
        current: Optional[DocumentFolder] = folder
        seen: Set[str] = set()

        while current is not None:
            current_id = str(current.id)
            if current_id in seen:
                return False
            seen.add(current_id)

            if str(current.organization_id) != expected_org:
                return False
            if not self._folder_admits_user(current, user, require_write=require_write):
                return False

            parent_id = current.parent_id
            if parent_id is None:
                return True

            if folders_by_id is not None:
                current = folders_by_id.get(str(parent_id))
            else:
                current = await self.get_folder_by_id(parent_id, organization_id)
            if current is None:
                return False

        return False

    async def can_access_document(
        self,
        document: Document,
        organization_id: UUID,
        user: User,
        *,
        require_write: bool = False,
    ) -> bool:
        """Whether a user may view (or, with ``require_write``, mutate) a
        specific document.

        Access is governed by the document's containing folder — the same
        boundary the folder/document list enforces — so a direct by-id fetch
        cannot bypass a leadership-only, owner-only (a member's personal files),
        or role-restricted folder. Documents with no folder are organization
        level and visible to anyone holding documents.view.
        """
        if not document.folder_id:
            return True
        folder = await self.get_folder_by_id(document.folder_id, organization_id)
        if folder is None:
            # Fail closed: a document that references a folder we can't resolve
            # must not become readable by falling through the ACL.
            return False
        return await self.can_access_folder(
            folder, organization_id, user, require_write=require_write
        )

    async def accessible_folder_ids(
        self, organization_id: UUID, user: User
    ) -> Set[str]:
        """Return exactly the folder ids whose complete hierarchy is accessible.

        An explicit set is returned even for leadership because corrupt or
        cross-organization ancestry must never be converted into an unrestricted
        document query. This keeps unfiltered listings consistent with direct
        folder and document authorization.
        """
        result = await self.db.execute(
            select(DocumentFolder).where(
                DocumentFolder.organization_id == str(organization_id)
            )
        )
        folders = result.scalars().all()
        folders_by_id = {str(folder.id): folder for folder in folders}
        accessible = set()
        for folder in folders:
            if await self.can_access_folder(
                folder, organization_id, user, folders_by_id
            ):
                accessible.add(folder.id)
        return accessible

    @staticmethod
    def _document_access_predicate(accessible_folder_ids: Optional[Set[str]]):
        """SQL predicate shared by browse and aggregate document queries."""
        if accessible_folder_ids is None:
            return None
        return or_(
            Document.folder_id.in_(accessible_folder_ids),
            Document.folder_id.is_(None),
        )

    async def _creates_cycle(
        self, folder_id: UUID, candidate_parent_id: Any, organization_id: UUID
    ) -> bool:
        """True if *candidate_parent_id* is *folder_id* itself or one of its
        own descendants — i.e. re-parenting under it would make the folder its
        own ancestor.

        `assert_in_org` only proves the candidate parent exists in the org; it
        has no way to know it is the folder being moved (self-parenting) or
        already sits underneath it (a cycle), either of which drops the folder
        out of root-based navigation and can break cascade delete. Walks the
        candidate's ancestor chain rather than the folder's descendants,
        because the chain to the root is bounded by tree depth, while the
        descendant subtree can be arbitrarily wide.
        """
        target = str(folder_id)
        current: Optional[str] = str(candidate_parent_id)
        seen: Set[str] = set()
        while current:
            if current == target:
                return True
            if current in seen:
                # A pre-existing cycle we didn't create — stop rather than
                # loop forever; it is not this call's job to repair it.
                break
            seen.add(current)
            result = await self.db.execute(
                select(DocumentFolder.parent_id).where(
                    DocumentFolder.id == current,
                    DocumentFolder.organization_id == str(organization_id),
                )
            )
            current = result.scalar_one_or_none()
        return False

    async def update_folder(
        self, folder_id: UUID, organization_id: UUID, update_data: Dict[str, Any]
    ) -> Optional[DocumentFolder]:
        """Update a folder. Returns None if not found."""
        folder = await self.get_folder_by_id(folder_id, organization_id)
        if not folder:
            return None

        # FAC-23 (Codex, on top of FAC-22): a system folder's location is a
        # documented invariant ("system folders cannot be deleted",
        # docs/TROUBLESHOOTING.md, docs/changelog/2026-02.md) that a bare
        # is_system check on delete_folder doesn't fully protect --
        # reparenting a system folder underneath an ordinary, freely
        # deletable folder and then deleting that folder reaches the same
        # cascade FAC-22 closed, one step removed. Refuse the move itself,
        # at the same layer as the other folder-specific validation below.
        if folder.is_system and "parent_id" in update_data:
            raise ValueError("Cannot move a system folder")

        # DOC-6 (XC-1): validate re-pointed FKs are in-org before applying.
        if "parent_id" in update_data:
            new_parent_id = update_data["parent_id"]
            await assert_in_org(
                self.db,
                DocumentFolder,
                new_parent_id,
                organization_id,
                allow_none=True,
                label="parent folder",
            )
            if new_parent_id and await self._creates_cycle(
                folder_id, new_parent_id, organization_id
            ):
                raise ValueError(
                    "A folder cannot be moved into itself or one of its own "
                    "descendants"
                )
        if "owner_user_id" in update_data:
            await assert_in_org(
                self.db,
                User,
                update_data["owner_user_id"],
                organization_id,
                allow_none=True,
                label="owner",
            )

        # DOC-20 (Codex round-2 on #1826): color/icon are DB-nullable (the
        # column predates the "#3B82F6"/"folder" defaults) but
        # DocumentFolderResponse declares both as plain, non-Optional str.
        # apply_updates only rejects a null against a NOT NULL column, so an
        # explicit `{"color": null}` would sail through, commit, and only
        # fail when this (or any later) response tries to serialize the row
        # -- a 500 after the bad value is already persisted, and a folder
        # listing that happens to include this row breaks too. Reject the
        # clear here, at the same layer as the other folder-specific
        # validation above, rather than letting a DB-level nullable column
        # stand in for a response-schema contract it doesn't enforce.
        for _field in ("color", "icon"):
            if _field in update_data and update_data[_field] is None:
                raise ValueError(f"'{_field}' cannot be cleared; provide a value")

        apply_updates(folder, update_data)

        await self.db.commit()
        await self.db.refresh(folder)
        return folder

    async def delete_folder(
        self,
        folder_id: UUID,
        organization_id: UUID,
        current_user: Optional[User] = None,
    ) -> bool:
        """Delete a folder, its subtree, and all their documents.

        Returns False if not found. The ORM cascade removes the descendant
        folder + document rows, but that would leave every document's backing
        file orphaned on disk (potentially sensitive uploads) — so we gather the
        subtree's file paths first and remove them after the delete, mirroring
        ``delete_document`` (DOC-1 continuation).

        ``current_user`` is optional only so this signature doesn't break a
        caller with no user in scope (there are none client-facing today);
        every route that lets a caller choose *which* folder to delete must
        pass it, or the descendant-ACL check below silently no-ops.
        """
        folder = await self.get_folder_by_id(folder_id, organization_id)
        if not folder:
            return False

        # FAC-22 (Codex): FAC-16 corrected the self-referential `children`
        # relationship so `cascade="all, delete-orphan"` genuinely deletes a
        # folder's subtree instead of merely orphaning it (nulling
        # descendants' parent_id). Before that fix, an unchecked is_system
        # here was latent -- the delete didn't destroy anything. Now it does,
        # so a documents.manage holder (org-wide, broadly held) could delete
        # a system root like "Member Files" outright and cascade-destroy
        # every member's subfolder and document beneath it. Documented as
        # never possible (docs/TROUBLESHOOTING.md, docs/changelog/2026-02.md)
        # but never actually enforced anywhere in this service.
        if folder.is_system:
            raise PermissionError("Cannot delete a system folder")

        # Walk the folder subtree (this folder + all descendants via
        # parent_id) *without* an organization_id filter, then check each row
        # found. The ORM's ``children`` cascade (``cascade="all,
        # delete-orphan"``) will itself load descendants by ``parent_id``
        # alone when ``self.db.delete`` runs below, with no org awareness at
        # all. ``parent_id`` carries no same-org DB constraint --
        # assert_in_org (DOC-6) is an application-level guard on
        # create_folder/update_folder, the only two client-facing writers of
        # this column, not a schema constraint -- so a row written before
        # that guard existed, or by any future writer that forgets it, could
        # carry a cross-organization parent_id. If the cascade were to reach
        # such a row, it would delete another tenant's folder and documents.
        # Failing closed here, before the delete, means this can't happen
        # even if the guard upstream is ever wrong: any descendant outside
        # the caller's org aborts the whole delete rather than silently
        # being swept in.
        #
        # The endpoint's own can_access_folder check authorizes only the
        # folder being deleted (and, via that call's own ancestor walk,
        # everything *above* it) -- never anything *below* it.
        # required_permissions can differ folder-to-folder (nothing forces a
        # descendant to be at least as permissive as its parent), so a caller
        # admitted at the root of a subtree is not necessarily admitted at
        # every node inside it. Checking each descendant's own restrictions
        # here -- not a full ancestor re-walk, which would be redundant: this
        # loop already visits every folder between the (already-authorized)
        # root and each descendant, so the AND of every _folder_admits_user
        # result along the way is exactly what can_access_folder computes.
        subtree_ids = {str(folder_id)}
        frontier = {str(folder_id)}
        while frontier:
            child_rows = await self.db.execute(
                select(DocumentFolder).where(
                    DocumentFolder.parent_id.in_(frontier),
                )
            )
            rows = child_rows.scalars().all()
            for child in rows:
                if str(child.organization_id) != str(organization_id):
                    raise ValueError(
                        "Folder subtree contains a cross-organization "
                        "reference and cannot be deleted"
                    )
                # FAC-23 (Codex, on top of FAC-22): the root-level is_system
                # check above only inspects the folder passed in. A system
                # folder reparented beneath an ordinary, freely deletable
                # folder (update_folder now refuses this move, but a row
                # could already carry one from before that fix, or from a
                # future writer that misses it) would reach this loop as a
                # descendant and be cascade-deleted with everything above
                # it -- the same catastrophic, unrecoverable data loss
                # FAC-22 closed at the root, just one hop down. Failing
                # closed here holds regardless of how the descendant got
                # there.
                if child.is_system:
                    raise ValueError(
                        "Folder subtree contains a system folder and "
                        "cannot be deleted"
                    )
                # require_write=True: a delete is a write, so a descendant
                # folder whose required_permissions admit this caller only at
                # its read-only tier (e.g. facilities.view_sensitive, with no
                # facilities write grant) must not let the cascade through it
                # either -- the same treasurer-shaped gap this predicate's
                # top-level caller (the documents.py endpoint) is guarded
                # against, one level down the tree.
                if current_user is not None and not self._folder_admits_user(
                    child, current_user, require_write=True
                ):
                    raise ValueError(
                        "Folder subtree contains a folder this caller cannot "
                        "access and cannot be deleted"
                    )
            children = {str(child.id) for child in rows}
            new_ids = children - subtree_ids
            subtree_ids |= new_ids
            frontier = new_ids

        # FAC-34 (Codex, on top of FAC-32): lock the subtree's DocumentFolder
        # rows themselves *first* -- before the Document lock below, not
        # after. At the time this was fixed, filing a folderless document
        # (facilities.py, _validate_shared_document_reference) locked the
        # Document row, then (ensure_facility_folder) the destination
        # DocumentFolder, and only then flushed `document.folder_id` onto it
        # -- the opposite order from this cascade, below. FAC-35 (see the
        # module-level "canonical lock order" note above) reordered that
        # creator path to match this one -- DocumentFolder, then Document,
        # then the reference table -- rather than reordering this cascade
        # again; this comment keeps the original mechanism explanation
        # because the *reason* the folder has to come first is unchanged,
        # only which side conformed to it. That flush is an UPDATE
        # against the `folder_id` secondary index -- and a concurrent
        # locking SELECT filtered on that same column (the FAC-32
        # Document-lock query below) can take a gap/next-key lock at the
        # target value, or block outright on any other row of this
        # organization's it happens to examine first (the exact locking
        # behaviour depends on which index MySQL/MariaDB's optimizer
        # chooses for the query, which is itself a function of the subtree's
        # size and the table's statistics -- not something this code
        # controls). Either way, if this cascade's Document-lock query
        # starts before the creator's flush completes, the flush can block
        # on it -- while the creator is still holding the destination
        # folder's own lock from ensure_facility_folder. This cascade's
        # later, implicit need for that same folder lock (the final
        # `db.delete(folder)`, at commit) then blocks right back on the
        # creator: a genuine two-way deadlock that ordering *only* the
        # Document/reference-table pair (FAC-32's fix) does not touch,
        # because whatever traps the creator is a side effect of this
        # cascade's Document query itself, before this cascade ever reaches
        # a reference-table or explicit-folder lock. Locking the destination
        # folder(s) here, first, removes the dependency on that query's plan
        # entirely: this cascade either wins the folder race outright
        # (nothing below has run yet, so it cannot be holding anything the
        # creator needs) or loses it and blocks immediately, before ever
        # issuing the Document-lock query that would otherwise trap the
        # creator's flush. Verified empirically with two real,
        # independently-committing sessions -- see
        # TestDeleteFolderLocksTheDestinationFolderBeforeAnyDocumentQuery in
        # tests/test_facility_document_reference_race.py, which patches
        # _lock_subtree_documents (below) to prove this cascade never issues
        # it while blocked on the folder lock.
        await self._lock_subtree_folders(subtree_ids)

        file_rows = await self._lock_subtree_documents(subtree_ids, organization_id)
        document_ids: Set[str] = set()
        file_paths: List[str] = []
        for document_id, file_path in file_rows:
            document_ids.add(document_id)
            if file_path:
                file_paths.append(file_path)

        # A facility record can reference one of these documents without a
        # foreign key (see _delete_facility_document_references) -- clean
        # that up in the same transaction as the cascade delete, not after.
        # Runs after the FAC-34 DocumentFolder lock and the FAC-32 Document
        # lock above -- see those comments for why the order matters.
        await self._delete_facility_document_references(
            document_ids, organization_id, current_user
        )

        # FAC-40 (Codex): explicitly delete exactly the Document rows the
        # locking scan above found, rather than relying on the ORM's
        # ``documents`` cascade (triggered by ``db.delete(folder)`` below) to
        # independently rediscover the same set. That cascade lazy-loads
        # ``folder.documents`` via a *plain* SELECT, which -- unlike
        # ``_lock_subtree_documents`` above -- answers from this
        # transaction's REPEATABLE READ snapshot (established at
        # ``get_folder_by_id``, this method's first read), not the latest
        # committed state. A document moved into this folder by a
        # concurrent, already-committed transaction after that snapshot was
        # taken is invisible to the ORM's lazy-load, so it is never queued
        # for cascade deletion -- yet it *is* visible to the locking scan
        # (locking reads always see latest committed), so its file was
        # already removed and its facility reference already stripped
        # above. ``Document.folder_id`` is ``ondelete="SET NULL"`` at the DB
        # level (not CASCADE), so once the folder row itself is deleted,
        # that orphaned survivor's ``folder_id`` is simply set to NULL by
        # the database -- a live, unreferenced, file-less "document" row
        # left behind. Reproduced live with two real, independently
        # -committing sessions (move a document into the folder between the
        # deleter's first read and its locking scan): the row survived,
        # `folder_id` NULL, exactly this defect. Deleting explicitly here,
        # from the same authoritative set the file/reference cleanup above
        # already used, closes it regardless of what the ORM's own
        # (possibly stale) view of ``folder.documents`` contains -- see
        # ``DocumentFolder.documents``'s ``passive_deletes=True`` (models/
        # document.py) for the other half: without it, that same staleness
        # can cut the other way too (a document that *moved out* of this
        # folder after the snapshot, and so is correctly absent from
        # ``document_ids`` here, would otherwise still be cascade-deleted by
        # the ORM's own stale collection -- deleting a live document that no
        # longer belongs to this folder at all).
        if document_ids:
            await self.db.execute(
                sa_delete(Document).where(Document.id.in_(document_ids))
            )

        await self.db.delete(folder)
        await self.db.commit()

        # Best-effort file cleanup — a missing file is not an error, and the DB
        # rows are already gone.
        for file_path in file_paths:
            try:
                await asyncio.to_thread(os.remove, file_path)
            except OSError:
                logger.warning(
                    "Could not remove backing file for a document in deleted "
                    f"folder {folder_id}: {file_path}"
                )
        return True

    async def _lock_subtree_folders(self, subtree_ids: Set[str]) -> None:
        """FAC-34: lock every ``DocumentFolder`` row in the subtree being
        deleted, for_update. A standalone method purely so tests can patch
        it -- see ``delete_folder``'s FAC-34 comment for why this has to run
        before ``_lock_subtree_documents`` below, and
        ``TestDeleteFolderLocksTheDestinationFolderBeforeAnyDocumentQuery``
        in tests/test_facility_document_reference_race.py for the proof.
        """
        await self.db.execute(
            select(DocumentFolder.id)
            .where(DocumentFolder.id.in_(subtree_ids))
            .with_for_update()
        )

    async def _lock_subtree_documents(
        self, subtree_ids: Set[str], organization_id: UUID
    ) -> List[Tuple[str, Optional[str]]]:
        """FAC-32: lock the subtree's ``Document`` rows, for_update, and
        return their ``(id, file_path)`` pairs.

        A standalone method (like ``_lock_subtree_folders`` above) so tests
        can patch it and prove ``delete_folder`` never issues this query
        while still blocked on the FAC-34 folder lock -- this is the query
        whose locking behaviour is what a concurrent creator's
        ``document.folder_id`` flush can be trapped by (see the FAC-34
        comment on the call site in ``delete_folder``).
        """
        rows = await self.db.execute(
            select(Document.id, Document.file_path)
            .where(
                Document.organization_id == str(organization_id),
                Document.folder_id.in_(subtree_ids),
            )
            .with_for_update()
        )
        return rows.all()

    async def _delete_facility_document_references(
        self,
        document_ids: Set[str],
        organization_id: UUID,
        current_user: Optional[User] = None,
    ) -> None:
        """Delete any facility_documents rows pointing at these documents.

        A facility record references a shared document by a plain
        ``"document:<uuid>"`` string in ``FacilityDocument.file_path`` (see
        ``_validate_shared_document_reference`` in ``facilities.py``), not a
        foreign key. Deleting the referenced ``Document`` without this leaves a
        facility document entry that can never be downloaded again -- a
        dangling reference with nothing to surface it.

        FAC-26 (Codex): this used to run unconditionally, so a caller reaching
        it through the generic ``documents.manage``-gated endpoints (or a
        folder cascade) could delete a facility's own document reference
        without holding ``facilities.delete``/``.manage`` -- the permission
        the facility API's own ``delete_facility_document`` route reserves
        for exactly this action. ``current_user`` is optional only so this
        signature doesn't break a caller with no user in scope (there are
        none client-facing today); every route that lets a caller delete a
        document or folder must pass it, or this check fails closed below
        rather than silently skipping.

        FAC-27 (Codex): matching used to be an exact string comparison
        against a canonical ``document:{document_id}`` (lowercase, no
        braces) this method built itself. ``_validate_shared_document_reference``
        (facilities.py) validates a caller-supplied reference's UUID suffix
        with ``UUID(...)`` but stores the *original* string unchanged, so a
        valid, resolving reference in any other form ``UUID(...)`` accepts
        (uppercase, brace-wrapped, ...) never matched here and was left
        dangling after the document it pointed at was deleted. Re-parsing
        each stored reference's UUID suffix and comparing the parsed value
        -- via ``_match_facility_document_references`` below -- covers every
        accepted form rather than only the one this method used to build.

        FAC-28 (Codex): ``FacilityPhoto.file_path`` is validated and stored
        through the exact same path as ``FacilityDocument``
        (``create_facility_photo`` -> ``_validate_shared_document_reference``),
        so a deleted document can dangle a photo reference the same way.
        Swept in the same transaction, gated by the same permission.
        """
        if not document_ids:
            return
        target_ids = set(document_ids)
        document_matches = await self._match_facility_document_references(
            FacilityDocument, target_ids, organization_id
        )
        photo_matches = await self._match_facility_document_references(
            FacilityPhoto, target_ids, organization_id
        )
        if not document_matches and not photo_matches:
            # No facility reference exists -- nothing to protect, so the
            # delete proceeds regardless of this permission.
            return
        granted = _get_user_permissions(current_user) if current_user else set()
        if not permission_matches_any(
            ["facilities.delete", "facilities.manage"], granted
        ):
            raise PermissionError(
                "Cannot delete a document referenced by a facility without "
                "facilities.delete or facilities.manage permission"
            )
        if document_matches:
            await self.db.execute(
                sa_delete(FacilityDocument).where(
                    FacilityDocument.id.in_(document_matches)
                )
            )
        if photo_matches:
            await self.db.execute(
                sa_delete(FacilityPhoto).where(FacilityPhoto.id.in_(photo_matches))
            )

    async def _match_facility_document_references(
        self,
        model: type,
        target_document_ids: Set[str],
        organization_id: UUID,
    ) -> List[str]:
        """Row ids of ``model`` (``FacilityDocument`` or ``FacilityPhoto``)
        whose ``file_path`` resolves to one of ``target_document_ids``.

        Matches by *parsed* UUID, not the stored string (FAC-27): a
        ``"document:<uuid>"`` reference validates as long as ``UUID(...)``
        accepts the suffix, which is looser than the single canonical
        lowercase, unbraced form an exact-string match would require.

        FAC-29 (Codex): ``with_for_update()`` -- a plain SELECT answers from
        the snapshot taken at this transaction's *first* read (InnoDB
        REPEATABLE READ), and the caller of ``delete_document`` (the
        endpoint) already reads the document once before this ever runs, so
        that snapshot can predate a reference someone else just committed.
        A locking read always reads the latest committed version regardless
        of when the snapshot was taken -- the same fix this codebase already
        applies to every capacity check (CLAUDE.md Pitfall #27) -- so a
        reference filed a moment ago is never missed here.
        """
        rows = await self.db.execute(
            select(model.id, model.file_path)
            .where(
                model.organization_id == str(organization_id),
                model.file_path.like("document:%", escape=LIKE_ESCAPE_CHAR),
            )
            .with_for_update()
        )
        matched_ids: List[str] = []
        for row_id, file_path in rows.all():
            suffix = file_path[len("document:") :]
            try:
                parsed_id = str(UUID(suffix))
            except (ValueError, AttributeError, TypeError):
                continue
            if parsed_id in target_document_ids:
                matched_ids.append(row_id)
        return matched_ids

    # ============================================
    # Document Management
    # ============================================

    async def create_document(
        self,
        organization_id: UUID,
        doc_data: Dict[str, Any],
        uploaded_by: UUID,
    ) -> Document:
        """Create a new document record. Raises on failure."""
        document = Document(
            organization_id=organization_id, uploaded_by=uploaded_by, **doc_data
        )
        self.db.add(document)
        await self.db.commit()
        await self.db.refresh(document)
        return document

    async def get_documents(
        self,
        organization_id: UUID,
        folder_id: Optional[UUID] = None,
        search: Optional[str] = None,
        status: Optional[DocumentStatus] = None,
        skip: int = 0,
        limit: int = 100,
        accessible_folder_ids: Optional[Set[str]] = None,
    ) -> Tuple[List[Document], int]:
        """Get documents with filtering and pagination.

        When *accessible_folder_ids* is provided (non-leadership callers), the
        result is restricted to documents in those folders (or with no folder),
        so an unfiltered listing can't leak documents from restricted folders.
        Pass None to impose no folder restriction (leadership).
        """
        query = select(Document).where(Document.organization_id == str(organization_id))

        if folder_id:
            query = query.where(Document.folder_id == str(folder_id))

        access_predicate = self._document_access_predicate(accessible_folder_ids)
        if access_predicate is not None:
            query = query.where(access_predicate)

        if status:
            query = query.where(Document.status == status)
        else:
            query = query.where(Document.status == DocumentStatus.ACTIVE)

        if search:
            search_term = like_pattern(search)
            query = query.where(
                Document.name.ilike(search_term, escape=LIKE_ESCAPE_CHAR)
                | Document.description.ilike(search_term, escape=LIKE_ESCAPE_CHAR)
                | Document.tags.ilike(search_term, escape=LIKE_ESCAPE_CHAR)
            )

        # Count
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await self.db.execute(count_query)
        total = total_result.scalar()

        # Paginated results
        query = query.order_by(Document.updated_at.desc()).offset(skip).limit(limit)
        result = await self.db.execute(query)
        documents = result.scalars().all()

        return documents, total

    async def get_document_by_id(
        self,
        document_id: UUID,
        organization_id: UUID,
        for_update: bool = False,
    ) -> Optional[Document]:
        """Get a document by ID.

        ``for_update`` locks the row for the caller's transaction (FAC-29):
        deleting a document and filing a facility reference to it
        (``_validate_shared_document_reference``, facilities.py) are a
        read-then-write racing on the same row from two directions, and
        acquiring the lock here is what serializes them -- see
        ``delete_document`` and ``_validate_shared_document_reference`` for
        the two call sites that need it.
        """
        query = (
            select(Document)
            .where(Document.id == str(document_id))
            .where(Document.organization_id == str(organization_id))
        )
        if for_update:
            query = query.with_for_update()
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def attach_document_names(
        self, organization_id: UUID, documents: List[Document]
    ) -> None:
        """Populate uploader_name / folder_name on document responses, in place.

        `DocumentResponse` declares both and `DocumentsPage` renders
        "Uploaded by {uploader_name}", but the ORM row carries neither attribute
        — so without this the uploader attribution never appears (the field is
        always null). Resolves both org-scoped, one batch query each, and sets
        plain instance attributes Pydantic reads via `from_attributes` (not
        mapped columns; never persisted). A missing/out-of-org id simply yields
        None, so a name never crosses an org boundary.
        """
        if not documents:
            return
        user_ids = {d.uploaded_by for d in documents if d.uploaded_by}
        folder_ids = {d.folder_id for d in documents if d.folder_id}

        uploader_names: Dict[str, str] = {}
        if user_ids:
            rows = await self.db.execute(
                select(User.id, User.first_name, User.last_name).where(
                    User.id.in_(user_ids),
                    User.organization_id == str(organization_id),
                )
            )
            uploader_names = {
                uid: f"{first or ''} {last or ''}".strip()
                for uid, first, last in rows.all()
            }

        folder_names: Dict[str, str] = {}
        if folder_ids:
            rows = await self.db.execute(
                select(DocumentFolder.id, DocumentFolder.name).where(
                    DocumentFolder.id.in_(folder_ids),
                    DocumentFolder.organization_id == str(organization_id),
                )
            )
            folder_names = {fid: fname for fid, fname in rows.all()}

        for d in documents:
            d.uploader_name = (
                uploader_names.get(d.uploaded_by) if d.uploaded_by else None
            )
            d.folder_name = folder_names.get(d.folder_id) if d.folder_id else None

    async def update_document(
        self, document_id: UUID, organization_id: UUID, update_data: Dict[str, Any]
    ) -> Optional[Document]:
        """Update a document. Returns None if not found."""
        document = await self.get_document_by_id(document_id, organization_id)
        if not document:
            return None

        # DOC-6 (XC-1): a reassigned folder_id is client-supplied — validate it
        # is in-org so a document can't be moved into another org's folder.
        # None is allowed (moves the document to org level).
        if "folder_id" in update_data:
            new_folder_id = update_data["folder_id"]
            await assert_in_org(
                self.db,
                DocumentFolder,
                new_folder_id,
                organization_id,
                allow_none=True,
                label="folder",
            )
            if new_folder_id:
                # FAC-36 (Codex, on top of FAC-35): moving a document into a
                # folder writes an FK onto the Document row -- a "canonical
                # lock order" resource pair, see the module-level note above.
                # Lock the destination DocumentFolder first, or this flush
                # can deadlock against _validate_shared_document_reference
                # (facilities.py), which always locks the destination folder
                # before it ever locks the Document row.
                await self._lock_destination_folder(new_folder_id)
                # Re-fetch under lock now that the folder is locked first --
                # the plain read above is stale for locking purposes.
                document = await self.get_document_by_id(
                    document_id, organization_id, for_update=True
                )
                if not document:
                    return None

        apply_updates(document, update_data)

        await self.db.commit()
        await self.db.refresh(document)
        return document

    async def _lock_destination_folder(self, folder_id: UUID) -> None:
        """FAC-36: lock a single ``DocumentFolder`` row, for_update.

        A standalone method -- like ``_lock_subtree_folders`` above -- purely
        so a test can patch-and-track it. See ``update_document``'s FAC-36
        comment for why this has to run before the Document row is ever
        locked.
        """
        await self.db.execute(
            select(DocumentFolder.id)
            .where(DocumentFolder.id == str(folder_id))
            .with_for_update()
        )

    async def delete_document(
        self,
        document_id: UUID,
        organization_id: UUID,
        current_user: Optional[User] = None,
    ) -> bool:
        """Delete a document. Returns False if not found.

        ``current_user`` is optional only so this signature doesn't break a
        caller with no user in scope (there are none client-facing today);
        every route that lets a caller delete a document must pass it, or
        the facility-reference permission check below fails closed rather
        than silently skipping (FAC-26).

        FAC-29 (Codex): locks the document row (``for_update=True``) so a
        concurrent ``_validate_shared_document_reference`` (facilities.py)
        filing a reference to this same document -- which takes the same
        lock -- serializes against this delete rather than racing it.
        """
        document = await self.get_document_by_id(
            document_id, organization_id, for_update=True
        )
        if not document:
            return False

        file_path = document.file_path
        # A facility record can reference this document without a foreign
        # key (see _delete_facility_document_references) -- clean that up in
        # the same transaction as the delete, not after.
        await self._delete_facility_document_references(
            {str(document_id)}, organization_id, current_user
        )
        await self.db.delete(document)
        await self.db.commit()

        # Remove the backing file so a delete doesn't leave the (potentially
        # sensitive) upload orphaned on disk. Best-effort — a missing file is
        # not an error, and the DB row is already gone.
        if file_path:
            try:
                await asyncio.to_thread(os.remove, file_path)
            except OSError:
                logger.warning(
                    f"Could not remove backing file for deleted document "
                    f"{document_id}: {file_path}"
                )
        return True

    # ============================================
    # Per-Member Folder Management
    # ============================================

    async def ensure_member_folder(
        self, organization_id: UUID, user: User
    ) -> DocumentFolder:
        """
        Get or create a personal folder for a member under the
        'Member Files' system folder.  The folder is access-controlled
        so only the member and leadership can see it.

        Folder hierarchy:
          Member Files/              (system, visibility=organization)
            └── Last, First/         (owner=user, visibility=owner)
        """
        # Find the 'members' system folder
        result = await self.db.execute(
            select(DocumentFolder)
            .where(DocumentFolder.organization_id == str(organization_id))
            .where(DocumentFolder.slug == "members")
            .where(DocumentFolder.is_system.is_(True))
        )
        members_root = result.scalar_one_or_none()

        if not members_root:
            # Auto-create if missing (e.g. org created before this feature)
            from app.models.document import SYSTEM_FOLDERS

            members_def = next(s for s in SYSTEM_FOLDERS if s["slug"] == "members")
            members_root = DocumentFolder(
                organization_id=organization_id,
                name=members_def["name"],
                slug=members_def["slug"],
                description=members_def["description"],
                icon=members_def["icon"],
                color=members_def["color"],
                sort_order=members_def["sort_order"],
                is_system=True,
                visibility=FolderVisibility.ORGANIZATION,
            )
            self.db.add(members_root)
            await self.db.flush()
            await self.db.refresh(members_root)

        # Check if user already has a personal folder
        user_id_str = str(user.id)
        result = await self.db.execute(
            select(DocumentFolder)
            .where(DocumentFolder.parent_id == members_root.id)
            .where(DocumentFolder.owner_user_id == user_id_str)
        )
        member_folder = result.scalar_one_or_none()

        if not member_folder:
            folder_name = f"{user.last_name}, {user.first_name}"
            member_folder = DocumentFolder(
                organization_id=organization_id,
                parent_id=members_root.id,
                name=folder_name,
                icon="user",
                color="text-emerald-400",
                visibility=FolderVisibility.OWNER,
                owner_user_id=user_id_str,
                is_system=False,
            )
            self.db.add(member_folder)
            await self.db.flush()
            await self.db.refresh(member_folder)
            logger.info(f"Created member folder '{folder_name}' for user {user_id_str}")

        return member_folder

    # ============================================
    # Per-Apparatus Folder Management
    # ============================================

    async def ensure_apparatus_folder(
        self, organization_id: UUID, apparatus_id: str, apparatus_unit_number: str
    ) -> DocumentFolder:
        """
        Get or create a hierarchical folder structure for an apparatus
        under the 'Apparatus Files' system folder.

        Folder hierarchy:
          Apparatus Files/                      (system, visibility=leadership)
            └── Engine 1 (unit_number)/         (visibility=organization)
                ├── Photos/
                ├── Registration & Insurance/
                ├── Maintenance Records/
                ├── Inspection & Compliance/
                └── Manuals & References/
        """
        # Find the 'apparatus' system folder
        result = await self.db.execute(
            select(DocumentFolder)
            .where(DocumentFolder.organization_id == str(organization_id))
            .where(DocumentFolder.slug == "apparatus")
            .where(DocumentFolder.is_system.is_(True))
        )
        apparatus_root = result.scalar_one_or_none()

        if not apparatus_root:
            # Auto-create if missing (e.g. org created before this feature)
            from app.models.document import SYSTEM_FOLDERS

            apparatus_def = next(s for s in SYSTEM_FOLDERS if s["slug"] == "apparatus")
            apparatus_root = DocumentFolder(
                organization_id=organization_id,
                name=apparatus_def["name"],
                slug=apparatus_def["slug"],
                description=apparatus_def["description"],
                icon=apparatus_def["icon"],
                color=apparatus_def["color"],
                sort_order=apparatus_def["sort_order"],
                is_system=True,
                visibility=FolderVisibility.LEADERSHIP,
            )
            self.db.add(apparatus_root)
            await self.db.flush()
            await self.db.refresh(apparatus_root)

        # Check if this apparatus already has a folder
        apparatus_id_str = str(apparatus_id)
        result = await self.db.execute(
            select(DocumentFolder)
            .where(DocumentFolder.parent_id == apparatus_root.id)
            .where(DocumentFolder.slug == f"apparatus-{apparatus_id_str}")
        )
        vehicle_folder = result.scalar_one_or_none()

        if not vehicle_folder:
            vehicle_folder = DocumentFolder(
                organization_id=organization_id,
                parent_id=apparatus_root.id,
                name=apparatus_unit_number,
                slug=f"apparatus-{apparatus_id_str}",
                icon="truck",
                color="text-orange-400",
                visibility=FolderVisibility.ORGANIZATION,
                is_system=False,
            )
            self.db.add(vehicle_folder)
            await self.db.flush()
            await self.db.refresh(vehicle_folder)
            logger.info(
                f"Created apparatus folder '{apparatus_unit_number}' for apparatus {apparatus_id_str}"
            )

            # Create standard sub-folders
            from app.models.document import APPARATUS_SUB_FOLDERS

            for sub_def in APPARATUS_SUB_FOLDERS:
                sub_folder = DocumentFolder(
                    organization_id=organization_id,
                    parent_id=vehicle_folder.id,
                    name=sub_def["name"],
                    slug=f"apparatus-{apparatus_id_str}-{sub_def['slug']}",
                    description=sub_def["description"],
                    icon=sub_def["icon"],
                    color=sub_def["color"],
                    sort_order=sub_def["sort_order"],
                    visibility=FolderVisibility.ORGANIZATION,
                    is_system=False,
                )
                self.db.add(sub_folder)

            await self.db.flush()
            logger.info(
                f"Created {len(APPARATUS_SUB_FOLDERS)} sub-folders for apparatus '{apparatus_unit_number}'"
            )

        return vehicle_folder

    async def get_apparatus_sub_folders(
        self, organization_id: UUID, apparatus_id: str, current_user: User
    ) -> List[DocumentFolder]:
        """
        Get the sub-folders for a specific apparatus.
        Returns an empty list if the apparatus folder doesn't exist.
        """
        # Find the apparatus root
        result = await self.db.execute(
            select(DocumentFolder)
            .where(DocumentFolder.organization_id == str(organization_id))
            .where(DocumentFolder.slug == "apparatus")
            .where(DocumentFolder.is_system.is_(True))
        )
        apparatus_root = result.scalar_one_or_none()
        if not apparatus_root:
            return []

        # Find the vehicle folder
        apparatus_id_str = str(apparatus_id)
        result = await self.db.execute(
            select(DocumentFolder)
            .where(DocumentFolder.parent_id == apparatus_root.id)
            .where(DocumentFolder.slug == f"apparatus-{apparatus_id_str}")
        )
        vehicle_folder = result.scalar_one_or_none()
        if not vehicle_folder:
            return []

        # Get sub-folders with document counts
        result = await self.db.execute(
            select(DocumentFolder)
            .where(DocumentFolder.parent_id == vehicle_folder.id)
            .order_by(DocumentFolder.sort_order, DocumentFolder.name)
        )
        sub_folders = list(result.scalars().all())
        sub_folders = [
            folder
            for folder in sub_folders
            if await self.can_access_folder(folder, organization_id, current_user)
        ]

        for folder in sub_folders:
            count_result = await self.db.execute(
                select(func.count(Document.id))
                .where(Document.folder_id == folder.id)
                .where(Document.status == DocumentStatus.ACTIVE)
            )
            folder.document_count = count_result.scalar() or 0

        return sub_folders

    # ============================================
    # Per-Facility Folder Management
    # ============================================

    async def _lock_facilities_root(
        self, organization_id: UUID
    ) -> Optional[DocumentFolder]:
        """Locking read for the org's 'Facility Files' system folder.

        A standalone method purely so ``ensure_facility_folder`` can call it
        from both its fast (no creation needed) and slow (creation-guarded)
        paths without duplicating the query, and so a test can
        patch-and-track it.
        """
        result = await self.db.execute(
            select(DocumentFolder)
            .where(DocumentFolder.organization_id == str(organization_id))
            .where(DocumentFolder.slug == FOLDER_FACILITIES)
            .where(DocumentFolder.is_system.is_(True))
            .order_by(DocumentFolder.id)
            .limit(1)
            .with_for_update()
        )
        return result.scalar_one_or_none()

    async def _lock_facility_folder(
        self, facilities_root_id: str, facility_id_str: str
    ) -> Optional[DocumentFolder]:
        """Locking read for one facility's own folder, under the root above.

        Same reuse/testability rationale as ``_lock_facilities_root``.
        """
        result = await self.db.execute(
            select(DocumentFolder)
            .where(DocumentFolder.parent_id == facilities_root_id)
            .where(DocumentFolder.slug == f"facility-{facility_id_str}")
            .order_by(DocumentFolder.id)
            .limit(1)
            .with_for_update()
        )
        return result.scalar_one_or_none()

    async def _peek_facilities_root(
        self, organization_id: UUID
    ) -> Optional[DocumentFolder]:
        """Non-locking read for the org's 'Facility Files' system folder.

        FAC-43 (Codex, on top of FAC-42): used only by
        ``ensure_facility_folder``'s fast path, in place of
        ``_lock_facilities_root``. Safe as a plain read specifically because
        the root is a system folder: ``update_folder`` refuses to move one
        (``"Cannot move a system folder"``) and ``delete_folder`` refuses to
        delete one (``"Cannot delete a system folder"``) -- so once this row
        is visible to any snapshot, it stays visible, at the same id,
        forever. There is no "moved" or "deleted" state for a later locking
        read to catch that this peek could miss.

        The only thing this method's caller reads off the result is
        ``.id`` -- a facility folder's ``parent_id`` -- which never changes
        once assigned. A stale peek can therefore only under-report
        existence (the root was created and committed by another
        transaction after this one's snapshot was taken, not yet visible
        here), never return a wrong id for one that does exist. An
        under-report just falls through to the slow path below, which
        re-resolves the root with a genuine locking read under the
        organization lock -- so this cannot admit a false "no folder yet"
        past the point where that would matter (a create).
        """
        result = await self.db.execute(
            select(DocumentFolder)
            .where(DocumentFolder.organization_id == str(organization_id))
            .where(DocumentFolder.slug == FOLDER_FACILITIES)
            .where(DocumentFolder.is_system.is_(True))
            .order_by(DocumentFolder.id)
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def ensure_facility_folder(
        self, organization_id: UUID, facility_id: str, facility_display_name: str
    ) -> DocumentFolder:
        """
        Get or create a hierarchical folder structure for a facility
        under the 'Facility Files' system folder.

        Folder hierarchy:
          Facility Files/                           (organization visibility,
                                                     facility permission gate)
            └── Station 1 - Main St (display_name)/ (visibility=organization)
                ├── Photos/
                ├── Blueprints & Permits/
                ├── Maintenance Records/
                ├── Inspection Reports/
                ├── Insurance & Leases/
                └── Capital Projects/

        The whole get-or-create is a read-then-write with no uniqueness
        constraint behind it (Pitfall #27 shape): two requests that both see
        "no folder yet" would otherwise both insert a facility folder (and
        its sub-folders), and every later read would break with
        MultipleResultsFound. Locking the organization row for the duration
        serializes concurrent first-accesses across the org's facilities —
        cheap, since this only runs once per facility ever.

        The lock alone is not sufficient (Pitfall #27's second half): the
        caller (``GET /facilities/{id}/folders``) reads the ``Facility`` row
        before this method ever runs, which under this app's default
        REPEATABLE READ establishes the transaction's snapshot before the
        organization lock is acquired. A plain ``SELECT`` for
        ``facilities_root``/``facility_folder`` after that would still
        answer from that earlier snapshot and could report "no folder yet"
        even though a concurrent transaction already created and committed
        one while this one waited for the lock. Both existence checks below
        are therefore locking reads too, not just the organization row.

        FAC-42 (Codex): the organization lock above is genuinely needed only
        while something might still need creating -- every call after a
        facility's folder already exists (the overwhelming majority, since
        this only creates once per facility ever) does not touch a single
        new row, yet used to take an *exclusive* lock on the org's one
        ``Organization`` row regardless, unconditionally, before ever
        checking whether creation was needed. Per FAC-31, the caller
        (``_validate_shared_document_reference``) holds whatever this method
        returns/locks until its own reference insert commits -- so every
        facility document/photo upload in an organization was briefly
        serializing on that single row, even for completely unrelated
        facilities and documents, a real lock-wait risk under concurrent
        bulk uploads.

        Fixed with a fast/slow split: the fast path takes the same *folder*
        locking reads as before (still required -- see the paragraph above;
        this is not new locking, it is the pre-existing per-folder lock),
        without ever touching the organization row, and returns immediately
        if both already exist. Only when something is actually missing does
        this fall through to the slow path, which locks the organization row
        and re-checks both folders *again* under that lock (double-checked
        locking) before creating -- a concurrent transaction may have
        created what was missing while this one computed the fast path.
        That re-check is why the org lock's own safety property is
        unchanged: any two callers that could actually race on a *create*
        still serialize on it exactly as before; only callers who need
        nothing built at all now skip it entirely.

        FAC-43 (Codex, on top of FAC-42): the fast path above still called
        ``_lock_facilities_root`` -- an exclusive lock on the org's single
        "Facility Files" root row -- unconditionally, even though the fast
        path never writes to it. Two concurrent reference creations for two
        *different* facilities in the same organization therefore still
        serialized on that one shared row before either could reach its own,
        genuinely distinct, facility folder. The fast path now peeks at the
        root with a plain read (``_peek_facilities_root``) instead: that
        method's own docstring is the safety argument (a system folder can
        be neither moved nor deleted, so a stale peek can only under-report
        existence, never hand back a wrong id, and an under-report safely
        falls through to the slow path's locking re-check). The per-facility
        lock below -- the one two callers *for the same facility* actually
        need to serialize on -- is unchanged.
        """
        facility_id_str = str(facility_id)

        facilities_root = await self._peek_facilities_root(organization_id)
        if facilities_root is not None:
            facility_folder = await self._lock_facility_folder(
                facilities_root.id, facility_id_str
            )
            if facility_folder is not None:
                return facility_folder

        org = await self.db.scalar(
            select(Organization)
            .where(Organization.id == str(organization_id))
            .with_for_update()
        )
        if org is None:
            raise ValueError("Organization not found")

        # Re-check under the org lock -- a concurrent transaction may have
        # created either row between the fast-path check above and here.
        facilities_root = await self._lock_facilities_root(organization_id)

        if not facilities_root:
            from app.models.document import SYSTEM_FOLDERS

            facilities_def = next(
                s for s in SYSTEM_FOLDERS if s["slug"] == FOLDER_FACILITIES
            )
            facilities_root = DocumentFolder(
                organization_id=organization_id,
                name=facilities_def["name"],
                slug=facilities_def["slug"],
                description=facilities_def["description"],
                icon=facilities_def["icon"],
                color=facilities_def["color"],
                sort_order=facilities_def["sort_order"],
                is_system=True,
                visibility=FolderVisibility.ORGANIZATION,
                required_permissions=list(FACILITY_SENSITIVE_PERMISSIONS),
            )
            self.db.add(facilities_root)
            await self.db.flush()
            await self.db.refresh(facilities_root)

        facility_folder = await self._lock_facility_folder(
            facilities_root.id, facility_id_str
        )

        if not facility_folder:
            facility_folder = DocumentFolder(
                organization_id=organization_id,
                parent_id=facilities_root.id,
                name=facility_display_name,
                slug=f"facility-{facility_id_str}",
                icon="building",
                color="text-indigo-400",
                visibility=FolderVisibility.ORGANIZATION,
                required_permissions=list(FACILITY_SENSITIVE_PERMISSIONS),
                is_system=False,
            )
            self.db.add(facility_folder)
            await self.db.flush()
            await self.db.refresh(facility_folder)
            logger.info(
                f"Created facility folder '{facility_display_name}' for facility {facility_id_str}"
            )

            # Create standard sub-folders
            from app.models.document import FACILITY_SUB_FOLDERS

            for sub_def in FACILITY_SUB_FOLDERS:
                sub_folder = DocumentFolder(
                    organization_id=organization_id,
                    parent_id=facility_folder.id,
                    name=sub_def["name"],
                    slug=f"facility-{facility_id_str}-{sub_def['slug']}",
                    description=sub_def["description"],
                    icon=sub_def["icon"],
                    color=sub_def["color"],
                    sort_order=sub_def["sort_order"],
                    visibility=FolderVisibility.ORGANIZATION,
                    # Matches migration a9c4e7b2f631, which stamped the whole
                    # facility tree (slug 'facilities' or 'facility-%') on
                    # existing installs. Without it here, every facility
                    # created after that deploy reopens the same leak.
                    required_permissions=list(FACILITY_SENSITIVE_PERMISSIONS),
                    is_system=False,
                )
                self.db.add(sub_folder)

            await self.db.flush()
            logger.info(
                f"Created {len(FACILITY_SUB_FOLDERS)} sub-folders for facility '{facility_display_name}'"
            )

        return facility_folder

    async def get_facility_sub_folders(
        self, organization_id: UUID, facility_id: str, current_user: User
    ) -> List[DocumentFolder]:
        """
        Get the sub-folders for a specific facility.
        Returns an empty list if the facility folder doesn't exist.

        Uses ``limit(1)`` rather than ``scalar_one_or_none()`` on both lookups
        so a pre-existing duplicate row (from a race predating the lock in
        ``ensure_facility_folder``) degrades to picking one deterministically
        instead of a persistent 500 on every read.
        """
        result = await self.db.execute(
            select(DocumentFolder)
            .where(DocumentFolder.organization_id == str(organization_id))
            .where(DocumentFolder.slug == FOLDER_FACILITIES)
            .where(DocumentFolder.is_system.is_(True))
            .order_by(DocumentFolder.id)
            .limit(1)
        )
        facilities_root = result.scalar_one_or_none()
        if not facilities_root:
            return []

        facility_id_str = str(facility_id)
        result = await self.db.execute(
            select(DocumentFolder)
            .where(DocumentFolder.parent_id == facilities_root.id)
            .where(DocumentFolder.slug == f"facility-{facility_id_str}")
            .order_by(DocumentFolder.id)
            .limit(1)
        )
        facility_folder = result.scalar_one_or_none()
        if not facility_folder:
            return []

        result = await self.db.execute(
            select(DocumentFolder)
            .where(DocumentFolder.parent_id == facility_folder.id)
            .order_by(DocumentFolder.sort_order, DocumentFolder.name)
        )
        sub_folders = list(result.scalars().all())
        sub_folders = [
            folder
            for folder in sub_folders
            if await self.can_access_folder(folder, organization_id, current_user)
        ]

        for folder in sub_folders:
            count_result = await self.db.execute(
                select(func.count(Document.id))
                .where(Document.folder_id == folder.id)
                .where(Document.status == DocumentStatus.ACTIVE)
            )
            folder.document_count = count_result.scalar() or 0

        return sub_folders

    # ============================================
    # Per-Event Folder Management
    # ============================================

    async def ensure_event_folder(
        self, organization_id: UUID, event_id: str, event_title: str
    ) -> DocumentFolder:
        """
        Get or create a folder for an event under the 'Event Attachments'
        system folder. Events get a single folder (no sub-folders) since
        their attachments are simpler.

        Folder hierarchy:
          Event Attachments/                  (system, visibility=organization)
            └── Monthly Meeting - Feb 2026/   (per-event folder)
        """
        # Find the 'events' system folder
        result = await self.db.execute(
            select(DocumentFolder)
            .where(DocumentFolder.organization_id == str(organization_id))
            .where(DocumentFolder.slug == FOLDER_EVENTS)
            .where(DocumentFolder.is_system.is_(True))
        )
        events_root = result.scalar_one_or_none()

        if not events_root:
            from app.models.document import SYSTEM_FOLDERS

            events_def = next(s for s in SYSTEM_FOLDERS if s["slug"] == FOLDER_EVENTS)
            events_root = DocumentFolder(
                organization_id=organization_id,
                name=events_def["name"],
                slug=events_def["slug"],
                description=events_def["description"],
                icon=events_def["icon"],
                color=events_def["color"],
                sort_order=events_def["sort_order"],
                is_system=True,
                visibility=FolderVisibility.ORGANIZATION,
            )
            self.db.add(events_root)
            await self.db.flush()
            await self.db.refresh(events_root)

        # Check if this event already has a folder
        event_id_str = str(event_id)
        result = await self.db.execute(
            select(DocumentFolder)
            .where(DocumentFolder.parent_id == events_root.id)
            .where(DocumentFolder.slug == f"event-{event_id_str}")
        )
        event_folder = result.scalar_one_or_none()

        if not event_folder:
            event_folder = DocumentFolder(
                organization_id=organization_id,
                parent_id=events_root.id,
                name=event_title,
                slug=f"event-{event_id_str}",
                icon="calendar",
                color="text-rose-400",
                visibility=FolderVisibility.ORGANIZATION,
                is_system=False,
            )
            self.db.add(event_folder)
            await self.db.flush()
            await self.db.refresh(event_folder)
            logger.info(
                f"Created event folder '{event_title}' for event {event_id_str}"
            )

        return event_folder

    # ============================================
    # Summary & Reporting
    # ============================================

    async def get_summary(
        self, organization_id: UUID, current_user: User
    ) -> Dict[str, Any]:
        """Get statistics for the folders and active documents a caller can browse."""
        accessible_ids = await self.accessible_folder_ids(organization_id, current_user)
        access_predicate = self._document_access_predicate(accessible_ids)
        first_of_month = date.today().replace(day=1)
        month_start = datetime.combine(
            first_of_month, datetime.min.time(), tzinfo=timezone.utc
        )

        document_aggregates = select(
            func.count(Document.id),
            func.coalesce(func.sum(Document.file_size), 0),
            func.coalesce(
                func.sum(case((Document.created_at >= month_start, 1), else_=0)), 0
            ),
        ).where(
            Document.organization_id == str(organization_id),
            Document.status == DocumentStatus.ACTIVE,
        )
        if access_predicate is not None:
            document_aggregates = document_aggregates.where(access_predicate)
        aggregate_result = await self.db.execute(document_aggregates)
        total_documents, total_size, documents_this_month = aggregate_result.one()

        accessible_folders = select(DocumentFolder.id).where(
            DocumentFolder.organization_id == str(organization_id)
        )
        if accessible_ids is not None:
            accessible_folders = accessible_folders.where(
                DocumentFolder.id.in_(accessible_ids)
            )
        folder_result = await self.db.execute(
            select(func.count()).select_from(accessible_folders.subquery())
        )
        total_folders = folder_result.scalar_one()

        return {
            "total_documents": total_documents or 0,
            "total_folders": total_folders,
            "total_size_bytes": total_size or 0,
            "documents_this_month": documents_this_month or 0,
        }
