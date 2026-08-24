"""
Network label printer configuration.

An organization registers each physical label printer once — where it is on
the network, its resolution, and the label stock loaded in it — so printing is
a choice between named printers ("Quartermaster Zebra") rather than a host and
port typed at every print.

Stored per organization rather than per position: the printer is a shared
device on a station's network, and two people in the same role at different
stations still print to whichever printer they pick. The *preferred label
size* stays a per-position preference (see ``label_presets`` in
``positions.settings``), because that is a per-person workflow choice.
"""

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.utils import generate_uuid


class LabelPrinter(Base):
    """A ZPL-capable network label printer belonging to an organization."""

    __tablename__ = "label_printers"
    __table_args__ = (
        UniqueConstraint("organization_id", "name", name="uq_label_printer_org_name"),
    )

    id = Column(String(36), primary_key=True, default=generate_uuid)
    organization_id = Column(
        String(36),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    name = Column(String(100), nullable=False)
    location = Column(String(200), nullable=True)

    # Which command language this printer speaks. Not cosmetic: the renderer,
    # the stock sizes on offer, and the status query all branch on it, and
    # sending one language's bytes to the other prints pages of garbage.
    language = Column(String(20), nullable=False, default="zpl")

    # Hostname or IP. The port is constrained to the raw-print range by
    # app.utils.printer_transport, not by the column.
    host = Column(String(255), nullable=False)
    port = Column(Integer, nullable=False, default=9100)

    # 203 or 300 on desktop units, 600 on some industrial models. Wrong dpi
    # prints a label at the wrong physical size, so it is configured per
    # printer rather than guessed. ESC/POS printers in this class are all
    # 203 dpi and size their output from the paper width instead.
    dpi = Column(Integer, nullable=False, default=203)

    # The stock actually loaded in this printer, used as the default when
    # someone prints to it.
    label_format = Column(String(50), nullable=False, default="zebra_2x1")
    custom_width = Column(Float, nullable=True)
    custom_height = Column(Float, nullable=True)

    # ^MD relative darkness (-30..30). Null leaves the printer's own setting
    # alone, which is the right default for a printer someone already tuned.
    darkness = Column(Integer, nullable=True)

    is_default = Column(Boolean, nullable=False, default=False)
    is_active = Column(Boolean, nullable=False, default=True)

    created_by_id = Column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    def __repr__(self) -> str:
        return f"<LabelPrinter {self.name} ({self.host}:{self.port})>"
