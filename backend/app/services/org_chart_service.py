"""
Organizational Chart Service

Maintains the department's hand-curated chain of command and resolves it into
the flat, depth-first list the chart screen renders.

The chart is not derived from positions or permissions — see the model
docstring for why those two hierarchies genuinely disagree — so everything here
is about keeping a leadership-edited tree well-formed: no cycles, no runaway
nesting, contiguous sibling ordering, and no seat that outlives its parent by
disappearing with it.
"""

from typing import Any, Dict, List, Optional, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.org_chart import OrgChartNode
from app.models.user import User, UserStatus
from app.utils.model_updates import apply_updates
from app.utils.org_scoping import assert_in_org

# A fire department's real chain of command is a handful of levels deep. The
# cap is not about storage — it stops an accidental re-parent from producing a
# chart the page indents off the side of a phone, and bounds the ancestor walk
# below.
MAX_DEPTH = 8

# Guards a single organization's chart against becoming unrenderable. Well
# above any real department's structure; a request past it is a mistake.
MAX_NODES = 500


class OrgChartService:
    """Reads and edits one organization's org chart."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Reads
    # ------------------------------------------------------------------

    async def _all_nodes(self, organization_id: str) -> List[OrgChartNode]:
        result = await self.db.execute(
            select(OrgChartNode)
            .where(OrgChartNode.organization_id == organization_id)
            .order_by(OrgChartNode.sort_order, OrgChartNode.title)
        )
        return list(result.scalars().all())

    async def _get_node(
        self, organization_id: str, node_id: str
    ) -> Optional[OrgChartNode]:
        """Fetch one seat, always scoped to the caller's org (pitfall #14a)."""
        result = await self.db.execute(
            select(OrgChartNode).where(
                OrgChartNode.id == node_id,
                OrgChartNode.organization_id == organization_id,
            )
        )
        return result.scalar_one_or_none()

    async def _require_node(self, organization_id: str, node_id: str) -> OrgChartNode:
        node = await self._get_node(organization_id, node_id)
        if node is None:
            raise ValueError("That position is not on this chart")
        return node

    async def _holder_names(
        self, organization_id: str, nodes: Sequence[OrgChartNode]
    ) -> Dict[str, str]:
        """Resolve linked members to names, in one query."""
        user_ids = {str(n.user_id) for n in nodes if n.user_id}
        if not user_ids:
            return {}
        result = await self.db.execute(
            select(User).where(
                User.id.in_(user_ids),
                User.organization_id == organization_id,
            )
        )
        return {str(u.id): _member_name(u) for u in result.scalars().all()}

    async def get_chart(
        self, organization_id: str, *, include_unpublished: bool
    ) -> List[Dict[str, Any]]:
        """Return the chart depth-first: each parent immediately before its
        children, siblings in ``sort_order``.

        Unpublished seats are dropped along with their descendants. Hiding a
        branch's root while still listing what reports into it would leave the
        membership a set of orphans with no chain of command, which is worse
        than not showing the branch at all.
        """
        nodes = await self._all_nodes(organization_id)
        names = await self._holder_names(organization_id, nodes)

        by_parent: Dict[Optional[str], List[OrgChartNode]] = {}
        known_ids = {str(n.id) for n in nodes}
        for node in nodes:
            # A parent_id that no longer resolves (its row was removed by a
            # path that bypassed delete_node, so MySQL's SET NULL never ran)
            # would otherwise strand the seat in a bucket nothing walks.
            parent = str(node.parent_id) if node.parent_id else None
            if parent is not None and parent not in known_ids:
                parent = None
            by_parent.setdefault(parent, []).append(node)

        for siblings in by_parent.values():
            siblings.sort(key=lambda n: (n.sort_order or 0, (n.title or "").lower()))

        ordered: List[Dict[str, Any]] = []
        visited: set = set()

        def walk(parent_id: Optional[str], depth: int) -> None:
            for node in by_parent.get(parent_id, []):
                node_id = str(node.id)
                # Defensive: a cycle can only exist if a row was written
                # outside move_node, and an unguarded walk would hang the
                # request rather than degrade.
                if node_id in visited or depth > MAX_DEPTH:
                    continue
                visited.add(node_id)
                if not include_unpublished and not node.is_published:
                    continue
                ordered.append(_serialize(node, names, depth))
                walk(node_id, depth + 1)

        walk(None, 0)
        return ordered

    async def list_member_options(self, organization_id: str) -> List[Dict[str, str]]:
        """Members who can be linked to a seat, for the editor's picker."""
        result = await self.db.execute(
            select(User).where(
                User.organization_id == organization_id,
                User.status == UserStatus.ACTIVE,
                User.deleted_at.is_(None),
            )
        )
        options = [
            {"id": str(u.id), "name": _member_name(u)} for u in result.scalars().all()
        ]
        options.sort(key=lambda o: o["name"].lower())
        return options

    # ------------------------------------------------------------------
    # Writes
    # ------------------------------------------------------------------

    async def _validate_references(
        self,
        organization_id: str,
        *,
        parent_id: Optional[str],
        user_id: Optional[str],
    ) -> None:
        """Both client-supplied FKs must name rows in the caller's org.

        pitfall #14c: an org-stamped write is not enough — an unvalidated
        ``user_id`` would pin another department's member to this chart, and an
        unvalidated ``parent_id`` would splice this seat into their tree.
        """
        if parent_id:
            await assert_in_org(
                self.db,
                OrgChartNode,
                parent_id,
                organization_id,
                label="parent position",
            )
        if user_id:
            await assert_in_org(self.db, User, user_id, organization_id, label="member")

    async def _next_sort_order(
        self, organization_id: str, parent_id: Optional[str]
    ) -> int:
        siblings = await self._siblings(organization_id, parent_id)
        return len(siblings)

    async def _siblings(
        self, organization_id: str, parent_id: Optional[str]
    ) -> List[OrgChartNode]:
        query = select(OrgChartNode).where(
            OrgChartNode.organization_id == organization_id
        )
        if parent_id:
            query = query.where(OrgChartNode.parent_id == parent_id)
        else:
            query = query.where(OrgChartNode.parent_id.is_(None))
        result = await self.db.execute(
            query.order_by(OrgChartNode.sort_order, OrgChartNode.title)
        )
        return list(result.scalars().all())

    async def _depth_of(self, organization_id: str, node_id: Optional[str]) -> int:
        """Depth of ``node_id``, walking up. A root is depth 0."""
        depth = 0
        current = node_id
        seen: set = set()
        while current:
            if current in seen:
                raise ValueError("That would create a reporting loop")
            seen.add(current)
            node = await self._get_node(organization_id, current)
            if node is None or not node.parent_id:
                break
            current = str(node.parent_id)
            depth += 1
            if depth > MAX_DEPTH:
                raise ValueError("The chart is nested too deeply")
        return depth

    async def _subtree_height(self, organization_id: str, node_id: str) -> int:
        """Levels below ``node_id``; a leaf is 0."""
        nodes = await self._all_nodes(organization_id)
        children: Dict[str, List[str]] = {}
        for node in nodes:
            if node.parent_id:
                children.setdefault(str(node.parent_id), []).append(str(node.id))

        height = 0
        frontier = [node_id]
        seen = {node_id}
        while frontier and height <= MAX_DEPTH:
            next_frontier = [
                child
                for parent in frontier
                for child in children.get(parent, [])
                if child not in seen
            ]
            seen.update(next_frontier)
            if not next_frontier:
                break
            height += 1
            frontier = next_frontier
        return height

    async def create_node(
        self,
        organization_id: str,
        *,
        payload: Dict[str, Any],
        updated_by: Optional[str] = None,
    ) -> OrgChartNode:
        existing = await self._all_nodes(organization_id)
        if len(existing) >= MAX_NODES:
            raise ValueError(
                f"An organizational chart is limited to {MAX_NODES} positions"
            )

        parent_id = payload.get("parent_id")
        user_id = payload.get("user_id")
        await self._validate_references(
            organization_id, parent_id=parent_id, user_id=user_id
        )

        if parent_id and await self._depth_of(organization_id, parent_id) >= MAX_DEPTH:
            raise ValueError("The chart is nested too deeply")

        node = OrgChartNode(
            organization_id=organization_id,
            parent_id=parent_id,
            title=payload["title"],
            responsibility=payload.get("responsibility"),
            user_id=user_id,
            display_name=payload.get("display_name"),
            contact_email=payload.get("contact_email"),
            contact_phone=payload.get("contact_phone"),
            is_published=payload.get("is_published", True),
            sort_order=await self._next_sort_order(organization_id, parent_id),
            updated_by=updated_by,
        )
        self.db.add(node)
        await self.db.flush()
        return node

    async def update_node(
        self,
        organization_id: str,
        node_id: str,
        *,
        updates: Dict[str, Any],
        updated_by: Optional[str] = None,
    ) -> OrgChartNode:
        # Resolved through an org-scoped fetch, not by primary key alone: the
        # permission dependency asserts the caller may edit *their* chart, not
        # that this row is on it (pitfall #14b).
        node = await self._require_node(organization_id, node_id)

        if "user_id" in updates and updates["user_id"]:
            await assert_in_org(
                self.db, User, updates["user_id"], organization_id, label="member"
            )

        # apply_updates, not a `if value is not None` loop: an explicit null
        # here is a holder being cleared out of a seat, and dropping it would
        # acknowledge the change with a 200 and leave the old name published.
        apply_updates(
            node,
            updates,
            skip={"id", "organization_id", "parent_id", "sort_order"},
        )
        node.updated_by = updated_by
        await self.db.flush()
        return node

    async def move_node(
        self,
        organization_id: str,
        node_id: str,
        *,
        parent_id: Optional[str],
        position: int,
        updated_by: Optional[str] = None,
    ) -> OrgChartNode:
        """Re-parent and/or reorder a seat, renumbering its new siblings."""
        node = await self._require_node(organization_id, node_id)

        if parent_id:
            await assert_in_org(
                self.db,
                OrgChartNode,
                parent_id,
                organization_id,
                label="parent position",
            )
            if parent_id == node_id:
                raise ValueError("A position cannot report to itself")
            if await self._is_descendant(organization_id, parent_id, node_id):
                raise ValueError(
                    "A position cannot report to one of its own subordinates"
                )
            new_depth = await self._depth_of(organization_id, parent_id) + 1
            if (
                new_depth + await self._subtree_height(organization_id, node_id)
                > MAX_DEPTH
            ):
                raise ValueError("The chart is nested too deeply")

        node.parent_id = parent_id
        node.updated_by = updated_by
        await self.db.flush()

        siblings = [
            s
            for s in await self._siblings(organization_id, parent_id)
            if str(s.id) != node_id
        ]
        index = max(0, min(position, len(siblings)))
        siblings.insert(index, node)
        for order, sibling in enumerate(siblings):
            sibling.sort_order = order
        await self.db.flush()
        return node

    async def delete_node(
        self,
        organization_id: str,
        node_id: str,
        *,
        updated_by: Optional[str] = None,
    ) -> None:
        """Remove a seat, promoting anyone who reported to it.

        Deleting the subtree instead would let one click erase a whole branch
        of the department — including seats whose holders and responsibilities
        nobody intended to touch — and there is no undo on this screen.
        """
        node = await self._require_node(organization_id, node_id)
        children = await self._siblings(organization_id, node_id)
        promoted_to = str(node.parent_id) if node.parent_id else None

        base = len(await self._siblings(organization_id, promoted_to))
        for offset, child in enumerate(children):
            child.parent_id = promoted_to
            child.sort_order = base + offset
            child.updated_by = updated_by

        await self.db.delete(node)
        await self.db.flush()

        # Renumber what is left where the seat used to sit, so the next insert
        # position is not competing with a hole in the sequence.
        for order, sibling in enumerate(
            await self._siblings(organization_id, promoted_to)
        ):
            sibling.sort_order = order
        await self.db.flush()

    async def _is_descendant(
        self, organization_id: str, candidate_id: str, ancestor_id: str
    ) -> bool:
        """True if ``candidate_id`` sits somewhere under ``ancestor_id``."""
        current: Optional[str] = candidate_id
        seen: set = set()
        while current:
            if current == ancestor_id:
                return True
            if current in seen:
                # Pre-existing loop: report it as a descendant so the move is
                # refused rather than adding a second edge to a broken tree.
                return True
            seen.add(current)
            node = await self._get_node(organization_id, current)
            if node is None or not node.parent_id:
                return False
            current = str(node.parent_id)
        return False


def _member_name(user: User) -> str:
    """Best available display name for a member record.

    Built from the columns rather than ``User.full_name``, which interpolates
    unconditionally and yields the literal "None None" for a member with no
    recorded name.
    """
    joined = " ".join(
        part
        for part in (
            getattr(user, "first_name", "") or "",
            getattr(user, "last_name", "") or "",
        )
        if part
    ).strip()
    return joined or (getattr(user, "username", "") or "")


def _serialize(node: OrgChartNode, names: Dict[str, str], depth: int) -> Dict[str, Any]:
    linked = names.get(str(node.user_id)) if node.user_id else None
    return {
        "id": str(node.id),
        "parent_id": str(node.parent_id) if node.parent_id else None,
        "title": node.title,
        "responsibility": node.responsibility,
        "user_id": str(node.user_id) if node.user_id else None,
        # The typed override wins: it is how a department announces a holder
        # the member record cannot express, and how it corrects one it can.
        "holder_name": node.display_name or linked,
        "display_name": node.display_name,
        "contact_email": node.contact_email,
        "contact_phone": node.contact_phone,
        "sort_order": node.sort_order or 0,
        "is_published": bool(node.is_published),
        "depth": depth,
    }


__all__ = ["OrgChartService", "MAX_DEPTH", "MAX_NODES"]
