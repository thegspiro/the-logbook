"""
Operational Rank Service

Business logic for per-organization operational rank management.
"""

from typing import List, Optional
from uuid import UUID

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.operational_rank import OperationalRank
from app.schemas.operational_rank import RankCreate, RankUpdate


# Default ranks seeded for new organizations.
DEFAULT_RANKS = [
    ("fire_chief", "Fire Chief", 0),
    ("deputy_chief", "Deputy Chief", 1),
    ("assistant_chief", "Assistant Chief", 2),
    ("captain", "Captain", 3),
    ("lieutenant", "Lieutenant", 4),
    ("engineer", "Engineer", 5),
    ("firefighter", "Firefighter", 6),
]


class OperationalRankService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Seed
    # ------------------------------------------------------------------

    async def seed_defaults(self, organization_id: str) -> List[OperationalRank]:
        """Insert the default rank set for an organization if none exist."""
        result = await self.db.execute(
            select(func.count(OperationalRank.id)).where(
                OperationalRank.organization_id == organization_id,
            )
        )
        if result.scalar() > 0:
            return []

        ranks = []
        for code, label, order in DEFAULT_RANKS:
            rank = OperationalRank(
                organization_id=organization_id,
                rank_code=code,
                display_name=label,
                sort_order=order,
            )
            self.db.add(rank)
            ranks.append(rank)

        await self.db.flush()
        return ranks

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------

    async def list_ranks(
        self,
        organization_id: str,
        is_active: Optional[bool] = None,
    ) -> List[OperationalRank]:
        query = (
            select(OperationalRank)
            .where(OperationalRank.organization_id == organization_id)
        )
        if is_active is not None:
            query = query.where(OperationalRank.is_active == is_active)
        query = query.order_by(OperationalRank.sort_order, OperationalRank.display_name)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_rank(
        self, rank_id: UUID, organization_id: str,
    ) -> Optional[OperationalRank]:
        result = await self.db.execute(
            select(OperationalRank).where(
                OperationalRank.id == str(rank_id),
                OperationalRank.organization_id == organization_id,
            )
        )
        return result.scalar_one_or_none()

    async def create_rank(
        self,
        data: RankCreate,
        organization_id: str,
    ) -> OperationalRank:
        # Duplicate check on rank_code
        existing = await self.db.execute(
            select(OperationalRank).where(
                OperationalRank.organization_id == organization_id,
                OperationalRank.rank_code == data.rank_code,
            )
        )
        if existing.scalar_one_or_none():
            raise ValueError(f"Rank code '{data.rank_code}' already exists")

        rank = OperationalRank(
            organization_id=organization_id,
            **data.model_dump(),
        )
        self.db.add(rank)
        await self.db.commit()
        await self.db.refresh(rank)
        return rank

    async def update_rank(
        self,
        rank_id: UUID,
        data: RankUpdate,
        organization_id: str,
    ) -> Optional[OperationalRank]:
        rank = await self.get_rank(rank_id, organization_id)
        if not rank:
            return None

        update_data = data.model_dump(exclude_unset=True)

        # If rank_code is being changed, check for duplicates
        if "rank_code" in update_data and update_data["rank_code"] != rank.rank_code:
            dup = await self.db.execute(
                select(OperationalRank).where(
                    OperationalRank.organization_id == organization_id,
                    OperationalRank.rank_code == update_data["rank_code"],
                    OperationalRank.id != str(rank_id),
                )
            )
            if dup.scalar_one_or_none():
                raise ValueError(
                    f"Rank code '{update_data['rank_code']}' already exists"
                )

        for field, value in update_data.items():
            setattr(rank, field, value)

        await self.db.commit()
        await self.db.refresh(rank)
        return rank

    async def delete_rank(
        self,
        rank_id: UUID,
        organization_id: str,
    ) -> bool:
        rank = await self.get_rank(rank_id, organization_id)
        if not rank:
            return False
        await self.db.delete(rank)
        await self.db.commit()
        return True

    async def reorder_ranks(
        self,
        organization_id: str,
        items: List[dict],
    ) -> List[OperationalRank]:
        """Batch-update sort_order for multiple ranks."""
        for item in items:
            rank = await self.get_rank(item["id"], organization_id)
            if rank:
                rank.sort_order = item["sort_order"]
        await self.db.commit()
        return await self.list_ranks(organization_id)
