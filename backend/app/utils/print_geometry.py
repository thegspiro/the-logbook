"""
Where ink may go on a generated PDF, and what the PDF asks the print dialog.

Departments print on whatever office laser, copier or inkjet the station has,
mostly from a browser or Acrobat, and file the result in binders. Three facts
about that set these numbers:

* **Printers cannot mark the paper's edge.** A laser leaves roughly 0.17–0.2"
  at every edge unprinted; many inkjet drivers leave 0.25", more at the bottom.
  Ink placed there is clipped, or the viewer's "Fit" setting shrinks the whole
  page to keep it. Nothing on a document comes closer than ``SAFE_EDGE``.
* **Records are three-hole punched.** Hole centres sit about 0.5" from the
  edge and the holes reach about 0.65" in, so the binding (left) edge is
  ``BINDING_EDGE``. A landscape page goes into a portrait binder with its top
  edge at the rings, so a landscape page binds along the top instead.
* **US Letter only** (owner decision, 2026-11-09). A Letter page printed on A4
  at actual size loses about 0.12" at each side; ``SAFE_EDGE`` already clears
  that, so the same PDF prints whole on either.

Label sheets and ID-card stock are the opposite case: their ink must land on a
die-cut position to within a few hundredths of an inch, so any scaling ruins
them. Those PDFs ask the viewer to print at actual size (``/PrintScaling
/None``). Documents leave scaling to the viewer: a page shrunk to 97% by a
"Fit" setting is still readable, a label sheet shrunk to 97% is not.
"""

from typing import Any

from reportlab.lib.units import inch

SAFE_EDGE = 0.5 * inch
BINDING_EDGE = 0.75 * inch


def print_at_actual_size(canvas: Any) -> None:
    """Ask the viewer not to scale this PDF when printing.

    For label sheets and card stock only. Acrobat honours it; most browser
    viewers ignore it, which is why the label pages also tell the user to
    print at 100%. ``/PickTrayByPDFSize`` is not set: reportlab's checked
    viewer-preference dictionary rejects that key.
    """
    canvas.setViewerPreference("PrintScaling", "None")
