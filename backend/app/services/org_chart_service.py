"""
Organizational Chart Service

Maintains the department's hand-curated chain of command and resolves it into
the flat, depth-first list the chart screen renders.

The *shape* of the chart is not derived from positions or permissions — see the
model docstring for why those two hierarchies genuinely disagree — so
everything about the tree here is about keeping a leadership-edited structure
well-formed: no cycles, no runaway nesting, contiguous sibling ordering, and no
seat that outlives its parent by disappearing with it.

*Who fills* a seat is resolved at read time. A seat may be linked to a
corporate position or an operational rank, and whoever holds it in the
application is listed in the box — read from the roster on every request rather
than copied into the chart, because a copy is a second answer to "who is the
Chief" that goes stale the day after an election and gives nobody a reason to
suspect it.

The link supplements the seat's own list rather than replacing it: a linked
seat still shows the people leadership typed in, so a department can put the
Chief's role on the Chief's box and still name an auxiliary co-chair who has no
login. That is the whole distinction — the application supports the chart, it
does not define it.
"""

from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.operational_rank import OperationalRank
from app.models.org_chart import OrgChartNode, OrgChartNodeHolder
from app.models.user import Position, User, UserStatus, user_positions
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

# Mirrors MAX_HOLDERS_PER_NODE in the schema. Enforced here as well because the
# service is also reached by onboarding and by tests, which do not go through
# the request schema.
MAX_HOLDERS_PER_NODE = 25

# Namespace prefixes for the editor's single "which role is this?" list, which
# offers corporate positions and operational ranks together. Kept here rather
# than in the schema because the service is what builds the options.
LINK_POSITION_PREFIX = "position:"
LINK_RANK_PREFIX = "rank:"


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

    async def _manual_holder_rows(
        self, node_ids: Sequence[str]
    ) -> Dict[str, List[OrgChartNodeHolder]]:
        """Hand-listed people, grouped by seat, in the order leadership set."""
        if not node_ids:
            return {}
        result = await self.db.execute(
            select(OrgChartNodeHolder)
            .where(OrgChartNodeHolder.node_id.in_(list(node_ids)))
            .order_by(OrgChartNodeHolder.sort_order, OrgChartNodeHolder.id)
        )
        grouped: Dict[str, List[OrgChartNodeHolder]] = {}
        for row in result.scalars().all():
            grouped.setdefault(str(row.node_id), []).append(row)
        return grouped

    async def _member_names(
        self, organization_id: str, user_ids: Set[str]
    ) -> Dict[str, str]:
        """Resolve member ids to names, in one query."""
        if not user_ids:
            return {}
        result = await self.db.execute(
            select(User).where(
                User.id.in_(list(user_ids)),
                User.organization_id == organization_id,
                # A removed member is soft-deleted (DELETE /users/{id} sets
                # deleted_at and leaves the row), so without this filter their
                # name keeps being published as a seat's holder to the whole
                # membership indefinitely. Dropping them here resolves the seat
                # as vacant, which is what it is.
                User.deleted_at.is_(None),
            )
        )
        return {str(u.id): _member_name(u) for u in result.scalars().all()}

    async def _position_holders(
        self, organization_id: str, position_ids: Set[str]
    ) -> Dict[str, List[Dict[str, Any]]]:
        """Active members currently holding each of ``position_ids``."""
        if not position_ids:
            return {}
        result = await self.db.execute(
            select(user_positions.c.position_id, User)
            .join(User, User.id == user_positions.c.user_id)
            .where(
                user_positions.c.position_id.in_(list(position_ids)),
                User.organization_id == organization_id,
                User.status == UserStatus.ACTIVE,
                User.deleted_at.is_(None),
            )
        )
        grouped: Dict[str, List[Dict[str, Any]]] = {}
        for position_id, user in result.all():
            grouped.setdefault(str(position_id), []).append(
                {"user_id": str(user.id), "name": _member_name(user), "from_link": True}
            )
        for holders in grouped.values():
            holders.sort(key=lambda h: str(h["name"]).lower())
        return grouped

    async def _rank_holders(
        self, organization_id: str, rank_codes: Set[str]
    ) -> Dict[str, List[Dict[str, Any]]]:
        """Active members currently carrying each of ``rank_codes``."""
        if not rank_codes:
            return {}
        result = await self.db.execute(
            select(User).where(
                User.rank.in_(list(rank_codes)),
                User.organization_id == organization_id,
                User.status == UserStatus.ACTIVE,
                User.deleted_at.is_(None),
            )
        )
        grouped: Dict[str, List[Dict[str, Any]]] = {}
        for user in result.scalars().all():
            grouped.setdefault(str(user.rank), []).append(
                {"user_id": str(user.id), "name": _member_name(user), "from_link": True}
            )
        for holders in grouped.values():
            holders.sort(key=lambda h: str(h["name"]).lower())
        return grouped

    async def _position_names(
        self, organization_id: str, position_ids: Set[str]
    ) -> Dict[str, str]:
        if not position_ids:
            return {}
        result = await self.db.execute(
            select(Position).where(
                Position.id.in_(list(position_ids)),
                Position.organization_id == organization_id,
            )
        )
        return {str(p.id): p.name for p in result.scalars().all()}

    async def _rank_names(
        self, organization_id: str, rank_codes: Set[str]
    ) -> Dict[str, str]:
        if not rank_codes:
            return {}
        result = await self.db.execute(
            select(OperationalRank).where(
                OperationalRank.rank_code.in_(list(rank_codes)),
                OperationalRank.organization_id == organization_id,
            )
        )
        return {str(r.rank_code): r.display_name for r in result.scalars().all()}

    async def _resolve_holders(
        self, organization_id: str, nodes: Sequence[OrgChartNode]
    ) -> Tuple[Dict[str, List[Dict[str, Any]]], Dict[str, Optional[str]]]:
        """Resolve every seat's people and its link label, in a fixed number of
        queries regardless of how many seats the chart has."""
        node_ids = [str(n.id) for n in nodes]
        manual_rows = await self._manual_holder_rows(node_ids)

        linked_user_ids = {
            str(row.user_id)
            for rows in manual_rows.values()
            for row in rows
            if row.user_id
        }
        names = await self._member_names(organization_id, linked_user_ids)

        position_ids = {str(n.position_id) for n in nodes if n.position_id}
        rank_codes = {str(n.rank_code) for n in nodes if n.rank_code}

        by_position = await self._position_holders(organization_id, position_ids)
        by_rank = await self._rank_holders(organization_id, rank_codes)
        position_names = await self._position_names(organization_id, position_ids)
        rank_names = await self._rank_names(organization_id, rank_codes)

        holders: Dict[str, List[Dict[str, Any]]] = {}
        labels: Dict[str, Optional[str]] = {}

        for node in nodes:
            node_id = str(node.id)

            if node.position_id:
                linked = list(by_position.get(str(node.position_id), []))
                labels[node_id] = position_names.get(str(node.position_id))
            elif node.rank_code:
                linked = list(by_rank.get(str(node.rank_code), []))
                labels[node_id] = rank_names.get(str(node.rank_code))
            else:
                linked = []
                labels[node_id] = None

            typed: List[Dict[str, Any]] = []
            for row in manual_rows.get(node_id, []):
                member_name = names.get(str(row.user_id)) if row.user_id else None
                # The typed override wins: it is how a department announces a
                # holder the member record cannot express, and how it corrects
                # one it can. A linked member who has since been removed and has
                # no override drops out entirely rather than publishing a blank
                # line in the box.
                name = row.display_name or member_name
                if not name:
                    continue
                typed.append(
                    {
                        "user_id": (
                            str(row.user_id) if row.user_id and member_name else None
                        ),
                        "name": name,
                        "from_link": False,
                    }
                )

            holders[node_id] = _merge_holders(linked, typed)

        return holders, labels

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
        holders, labels = await self._resolve_holders(organization_id, nodes)

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
                ordered.append(
                    _serialize(
                        node,
                        holders.get(node_id, []),
                        labels.get(node_id),
                        depth,
                    )
                )
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

    async def list_link_options(
        self, organization_id: str
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """The roles and ranks a seat can be linked to, each with who holds it.

        Returned as ``(roles, ranks)`` for the editor's single "which role is
        this?" list. The holders travel with the option so that choosing a role
        can name its current holder immediately — that confirmation is what the
        officer is linking *for*, and fetching it afterwards would deliver the
        answer late enough to be missed.

        Deactivated ranks are left out of the picker but keep resolving on a
        seat that already names one: dropping a seat's holders because somebody
        retired a rank from the settings screen would rewrite the published
        chart as a side effect of an unrelated edit.
        """
        positions = await self.db.execute(
            select(Position).where(Position.organization_id == organization_id)
        )
        position_rows = list(positions.scalars().all())
        by_position = await self._position_holders(
            organization_id, {str(p.id) for p in position_rows}
        )
        roles = [
            {
                "value": f"{LINK_POSITION_PREFIX}{p.id}",
                "label": p.name,
                "holders": by_position.get(str(p.id), []),
            }
            for p in position_rows
        ]
        roles.sort(key=lambda o: str(o["label"]).lower())

        rank_result = await self.db.execute(
            select(OperationalRank)
            .where(
                OperationalRank.organization_id == organization_id,
                OperationalRank.is_active.is_(True),
            )
            .order_by(OperationalRank.sort_order, OperationalRank.display_name)
        )
        rank_rows = list(rank_result.scalars().all())
        by_rank = await self._rank_holders(
            organization_id, {str(r.rank_code) for r in rank_rows}
        )
        ranks = [
            {
                "value": f"{LINK_RANK_PREFIX}{r.rank_code}",
                "label": r.display_name,
                "holders": by_rank.get(str(r.rank_code), []),
            }
            for r in rank_rows
        ]

        return roles, ranks

    # ------------------------------------------------------------------
    # Writes
    # ------------------------------------------------------------------

    async def _validate_references(
        self,
        organization_id: str,
        *,
        parent_id: Optional[str] = None,
        position_id: Optional[str] = None,
        rank_code: Optional[str] = None,
        holders: Optional[Sequence[Dict[str, Any]]] = None,
    ) -> None:
        """Every client-supplied reference must name a row in the caller's org.

        pitfall #14c: an org-stamped write is not enough — an unvalidated
        ``user_id`` would pin another department's member to this chart, an
        unvalidated ``parent_id`` would splice this seat into their tree, and
        an unvalidated ``position_id`` would publish their roster into this
        department's chart on every read.
        """
        if parent_id:
            await assert_in_org(
                self.db,
                OrgChartNode,
                parent_id,
                organization_id,
                label="parent position",
            )
        if position_id:
            await assert_in_org(
                self.db, Position, position_id, organization_id, label="role"
            )
        if rank_code:
            result = await self.db.execute(
                select(OperationalRank.id).where(
                    OperationalRank.rank_code == rank_code,
                    OperationalRank.organization_id == organization_id,
                )
            )
            if result.scalar_one_or_none() is None:
                raise ValueError("Invalid rank")
        for holder in holders or []:
            user_id = holder.get("user_id")
            if user_id:
                await assert_in_org(
                    self.db, User, user_id, organization_id, label="member"
                )

    async def _replace_holders(
        self, node: OrgChartNode, holders: Sequence[Dict[str, Any]]
    ) -> None:
        """Swap a seat's hand-listed people for the ones just submitted.

        A whole-collection replace rather than a diff: the editor owns the list
        and its order, and reconciling by id would have to invent identity for
        rows the editor never sees.
        """
        if len(holders) > MAX_HOLDERS_PER_NODE:
            raise ValueError(
                f"A position can list at most {MAX_HOLDERS_PER_NODE} people"
            )

        existing = await self.db.execute(
            select(OrgChartNodeHolder).where(OrgChartNodeHolder.node_id == node.id)
        )
        for row in existing.scalars().all():
            await self.db.delete(row)
        # Flushed before the inserts so the deletes land first; otherwise the
        # unit of work is free to order them the other way round.
        await self.db.flush()

        for order, holder in enumerate(holders):
            self.db.add(
                OrgChartNodeHolder(
                    node_id=node.id,
                    user_id=holder.get("user_id"),
                    display_name=holder.get("display_name"),
                    sort_order=order,
                )
            )
        await self.db.flush()

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
        position_id = payload.get("position_id")
        rank_code = payload.get("rank_code")
        holders = list(payload.get("holders") or [])

        if position_id and rank_code:
            raise ValueError("A position can follow a role or a rank, not both")

        await self._validate_references(
            organization_id,
            parent_id=parent_id,
            position_id=position_id,
            rank_code=rank_code,
            holders=holders,
        )

        if parent_id and await self._depth_of(organization_id, parent_id) >= MAX_DEPTH:
            raise ValueError("The chart is nested too deeply")

        node = OrgChartNode(
            organization_id=organization_id,
            parent_id=parent_id,
            title=payload["title"],
            responsibility=payload.get("responsibility"),
            position_id=position_id,
            rank_code=rank_code,
            contact_email=payload.get("contact_email"),
            contact_phone=payload.get("contact_phone"),
            is_published=payload.get("is_published", True),
            sort_order=await self._next_sort_order(organization_id, parent_id),
            updated_by=updated_by,
        )
        self.db.add(node)
        await self.db.flush()

        # Only the hand-listed people are stored. Whoever the link supplies is
        # resolved from the roster on every read, so keeping a copy here would
        # be a second answer to the same question.
        if holders:
            await self._replace_holders(node, holders)
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

        holders = updates.pop("holders", None)

        # Read against the row's state after the payload is applied, not before:
        # an update that sets a rank on a seat that already has a role has to be
        # refused, and one that swaps a role for a rank must not be.
        next_position = (
            updates["position_id"] if "position_id" in updates else node.position_id
        )
        next_rank = updates["rank_code"] if "rank_code" in updates else node.rank_code
        if next_position and next_rank:
            raise ValueError("A position can follow a role or a rank, not both")

        await self._validate_references(
            organization_id,
            position_id=updates.get("position_id"),
            rank_code=updates.get("rank_code"),
            holders=holders,
        )

        # apply_updates, not a `if value is not None` loop: an explicit null
        # here is a seat being unlinked from a role, and dropping it would
        # acknowledge the change with a 200 and leave the old link in place.
        apply_updates(
            node,
            updates,
            skip={"id", "organization_id", "parent_id", "sort_order"},
        )
        node.updated_by = updated_by
        await self.db.flush()

        # Unlinking never touches the typed list, and linking never replaces it.
        # The two coexist by design: an officer who links the Chief's role to
        # the Chief's box has not asked for the auxiliary co-chair they typed in
        # last year to disappear.
        if holders is not None:
            await self._replace_holders(node, holders)

        return node

    async def move_node(
        self,
        organization_id: str,
        node_id: str,
        *,
        parent_id: Optional[str],
        position: int,
        updated_by: Optional[str] = None,
    ) -> Tuple[OrgChartNode, Optional[str]]:
        """Re-parent and/or reorder a seat, renumbering the siblings on both
        sides of the move.

        Returns the seat and the id of the parent it left, which the endpoint
        needs to record what actually changed in the audit log.
        """
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

        previous_parent_id = str(node.parent_id) if node.parent_id else None

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

        # The parent this seat left keeps a hole in its ordering otherwise, and
        # `_next_sort_order` counts siblings rather than reading the highest —
        # so the next seat added there would be handed a sort_order an existing
        # sibling already holds, and the tie would be broken by title rather
        # than by "appended last".
        if previous_parent_id != parent_id:
            await self._renumber(organization_id, previous_parent_id)

        return node, previous_parent_id

    async def _renumber(self, organization_id: str, parent_id: Optional[str]) -> None:
        """Make one parent's children contiguous from zero again."""
        for order, sibling in enumerate(
            await self._siblings(organization_id, parent_id)
        ):
            sibling.sort_order = order
        await self.db.flush()

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

        # The seat's people go with it. Deleted explicitly rather than left to
        # the FK's ON DELETE CASCADE so the rows are gone within this
        # transaction, which is what the response built after it reads.
        await self._replace_holders(node, [])
        await self.db.delete(node)
        await self.db.flush()

        # Renumber what is left where the seat used to sit, so the next insert
        # position is not competing with a hole in the sequence.
        await self._renumber(organization_id, promoted_to)

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


def _merge_holders(
    linked: List[Dict[str, Any]], typed: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """Everyone in a seat: the link's holders, then the ones typed in.

    A member who appears in both is listed once, in the linked position, using
    the typed entry — that entry exists precisely to say how this department
    announces them ("Chief Ramirez" rather than "Miguel Ramirez"), and the link
    is what put them in the box, so it decides where they sit.
    """
    overrides = {h["user_id"]: h for h in typed if h.get("user_id")}
    merged = [overrides.get(h["user_id"], h) for h in linked]
    claimed = {h["user_id"] for h in linked if h.get("user_id")}
    merged.extend(h for h in typed if h.get("user_id") not in claimed)
    return merged


def _serialize(
    node: OrgChartNode,
    holders: List[Dict[str, Any]],
    link_label: Optional[str],
    depth: int,
) -> Dict[str, Any]:
    return {
        "id": str(node.id),
        "parent_id": str(node.parent_id) if node.parent_id else None,
        "title": node.title,
        "responsibility": node.responsibility,
        "holders": holders,
        "position_id": str(node.position_id) if node.position_id else None,
        "rank_code": node.rank_code,
        "link_label": link_label,
        "contact_email": node.contact_email,
        "contact_phone": node.contact_phone,
        "sort_order": node.sort_order or 0,
        "is_published": bool(node.is_published),
        "depth": depth,
    }


__all__ = [
    "OrgChartService",
    "MAX_DEPTH",
    "MAX_NODES",
    "MAX_HOLDERS_PER_NODE",
    "LINK_POSITION_PREFIX",
    "LINK_RANK_PREFIX",
]
