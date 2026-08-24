"""
Module-neutral model for a printed document.

The label path already works this way: a domain builds neutral
:class:`~app.utils.label_renderer.LabelSpec` objects and the renderers turn
them into PDF, ZPL or ESC/POS without knowing what a helmet or an applicant is.
This is the same idea for the things a station prints on paper rather than on a
sticker — a shift roster, an apparatus check sheet — so that adding a third
document is a builder, not a renderer change.

Deliberately poorer than a layout language. There is a title, optional
sections, and rows that are one or two columns wide, because that is what
survives a 32-character receipt. Anything richer would render on 80mm paper and
fall apart on 58mm, and a document that only prints correctly on some of a
department's printers is worse than one that is plain everywhere.
"""

from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class DocumentRow:
    """One line. ``right`` is pushed to the right margin when it fits.

    ``checkbox`` prefixes an empty box: a check sheet printed for someone to
    carry round the truck needs somewhere to make a mark, which is the whole
    reason it is on paper rather than on the phone that is already in their
    pocket.
    """

    left: str
    right: Optional[str] = None
    emphasis: bool = False
    checkbox: bool = False
    indent: int = 0


@dataclass
class DocumentSection:
    heading: Optional[str] = None
    rows: List[DocumentRow] = field(default_factory=list)


@dataclass
class PrintDocument:
    """A document ready to render: already resolved, already in local time."""

    title: str
    subtitle: Optional[str] = None
    sections: List[DocumentSection] = field(default_factory=list)
    footer: Optional[str] = None

    def is_empty(self) -> bool:
        return not any(section.rows for section in self.sections)

    def to_dict(self) -> dict:
        """Serialize for the on-screen preview.

        The preview reads the same structure the printer gets, so what someone
        sees before pressing print is what comes out of it rather than a
        second rendering free to disagree.
        """
        return {
            "title": self.title,
            "subtitle": self.subtitle,
            "footer": self.footer,
            "sections": [
                {
                    "heading": section.heading,
                    "rows": [
                        {
                            "left": row.left,
                            "right": row.right,
                            "emphasis": row.emphasis,
                            "checkbox": row.checkbox,
                            "indent": row.indent,
                        }
                        for row in section.rows
                    ],
                }
                for section in self.sections
            ],
        }
