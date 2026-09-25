"""
Email Theme — the one place the outgoing mail's look is defined.

Every email the platform sends renders into the same chrome: a centred
masthead (the department's logo above its name) on a light grey page, then a
white card holding a small status line, the title and the body, and a
left-aligned footer under the card.  The stylesheet below is what makes that
chrome look the way it does, and the accent constants are the only colours a
template should put on a notice.

The layout follows published guidance for transactional mail rather than a
house style: body text is left-aligned (centring is kept to the two short
blocks at either end of the card — the masthead and the action), key facts
sit in a panel with each label above its value so they can be found without
reading prose, body copy is 16px, and the button is at least 44px tall. There
are no rules or rails between blocks; spacing separates them.

The accent appears in these places, all of them inline so one shell serves
every category:

=================  =================================
Element            Inline override
=================  =================================
``.status-mark``   ``background-color``
``.status-text``   ``color``
``.header p``      ``color`` (the optional subtitle)
``.button``        ``background-color``
=================  =================================

:func:`build_shell` and :func:`colourway_context` write all of them from one
accent, so a notice names its category and gets the colourway; nothing
downstream repeats a hex.

**The classes the previous shell used are still defined.** ``.lockup``,
``.logomark``, ``.chip`` and a restyled ``.details`` stay in the sheet
because a template a department edited carries the old markup in its stored
body, and that body renders against *this* stylesheet. It keeps working and
picks up the new card, spacing and footer; it keeps its own header lockup
until the template is reset.

**Why this is its own module.** ``email_template_service`` owns the copy and
``email_templates_storefront`` owns the store's copy; the storefront module
cannot import the service (the service imports *it*), so before this module
existed the two files each carried their own hex codes and drifted — the same
"warning amber" was ``#d97706`` in one file and ``#b45309`` in the other.

Two constraints on ``DEFAULT_CSS`` that are easy to violate by accident:

1. **No comments, no ``@media`` blocks, and no double quotes in values.**
   Gmail strips ``<style>``, so ``inline_email_css`` re-writes these rules
   onto ``style=""`` attributes before sending.  Its parser understands
   ``body``, ``.class`` and ``.class tag`` selectors only; a ``/* comment */``
   becomes part of the next selector and silently drops that rule.  Quote font
   names with ``'`` — the inliner normalises stray double quotes, but writing
   them here is asking a font stack to close the attribute it lives in.
   Explanations belong here, in Python.
2. **More specific selectors come first.**  The inliner merges a later rule
   *behind* what an element already carries, so for two rules that hit the same
   element the earlier one wins.  ``.details p`` is therefore written above
   ``.content p`` — reversing them makes every panel line take the body
   paragraph's spacing.  The same ordering carries the header lockup:
   ``.lockup img`` and ``.lockup td`` sit above ``.lockup``, and ``.logomark``
   below them, because the logo cell needs the lockup's vertical alignment
   *and* its own white background.

   Writing a rule earlier is not on its own enough, because the merge is
   per *declaration*: a property the earlier rule never mentions is not
   overridden, it is simply inherited from the later one. ``.details`` sits
   inside ``.content``, so ``.details th`` has to name
   ``background-color``, ``text-transform``, ``letter-spacing`` and
   ``border-bottom`` — and ``.details table`` its ``margin`` — purely to
   cancel the data-table styling ``.content th`` / ``.content table`` would
   otherwise leak into a label/value panel. Delete one of those and the
   panel's labels come back grey, uppercase and underlined.

   The fact panel relies on the same property: ``.fact``, ``.fact-label``,
   ``.fact-value`` and ``.facts`` sit inside ``.content``, so each names every
   property ``.content td`` / ``.content p`` / ``.content table`` set.
   Class rules are applied before any ``.parent tag`` rule and therefore win
   where they speak; where they are silent, the content rule leaks through.
"""

import html as _html
import re

# Accents.  White text on each of these clears WCAG 2.1 AA (4.5:1):
# red 6.5:1, amber 5.0:1, green 5.5:1, blue 6.7:1, indigo 7.9:1,
# violet 7.1:1, slate 10.3:1.  Contrast is symmetric, so the same figures hold
# for the accent-coloured status text and subtitle on the white card.
ACCENT_RED = "#b91c1c"
ACCENT_AMBER = "#b45309"
ACCENT_GREEN = "#047857"
ACCENT_BLUE = "#1d4ed8"
ACCENT_INDIGO = "#4338ca"
ACCENT_VIOLET = "#6d28d9"
ACCENT_SLATE = "#334155"

# Body copy on white is 14.7:1, muted footer text on the page grey is 6.9:1.
#
# .muted keeps #4b5563 rather than the #94a3b8 the 1b spec names. At 11px it
# carries the department's phone number and mailing address — email_footers
# applies it to the contact line — and #94a3b8 is 2.6:1 on the white card,
# well under the 4.5:1 AA floor for small text. The spec picked it to sit
# quietly under the footer; it sits too quietly to read.
DEFAULT_CSS = """
body { margin: 0; padding: 0; background-color: #eef0f3; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.6; color: #334155; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; -webkit-font-smoothing: antialiased; }
.container { max-width: 600px; margin: 0 auto; padding: 28px 12px 24px 12px; }
.logo { text-align: center; padding: 0 0 20px 0; }
.logo img { max-height: 72px; max-width: 200px; }
.masthead p { margin: 10px 0 0 0; font-size: 15px; line-height: 1.35; font-weight: 700; color: #0f172a; }
.masthead { text-align: center; padding: 0 0 18px 0; }
.status-mark { width: 8px; height: 8px; padding: 0; border-radius: 2px; font-size: 0; line-height: 0; }
.status-text { padding: 0 0 0 8px; font-size: 13px; line-height: 1.3; font-weight: 600; }
.status-line { border-collapse: collapse; margin: 0 0 10px 0; }
.header h1 { margin: 0; font-size: 24px; line-height: 1.25; font-weight: 700; letter-spacing: -0.01em; color: #0f172a; }
.header p { margin: 6px 0 0 0; font-size: 16px; line-height: 1.4; font-weight: 600; color: #475569; }
.header { background-color: #ffffff; border: none; border-radius: 8px 8px 0 0; padding: 26px 24px 0 24px; }
.lockup img { display: block; max-width: 36px; max-height: 36px; width: auto; height: auto; border: 0; }
.lockup td { vertical-align: middle; font-size: 13px; font-weight: 600; color: #0f172a; }
.lockup { width: 100%; border-collapse: collapse; margin: 0 0 16px 0; }
.logomark { background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 3px; width: 36px; text-align: center; }
.chip { display: inline-block; background-color: #f1f5f9; color: #334155; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; padding: 5px 10px; border-radius: 20px; }
.details p { margin: 0 0 12px 0; font-size: 15px; line-height: 1.5; color: #0f172a; }
.details td { padding: 0 0 12px 0; font-size: 15px; line-height: 1.5; color: #0f172a; vertical-align: top; background-color: transparent; border-bottom: none; }
.details th { padding: 0 0 12px 0; font-size: 13px; line-height: 1.5; font-weight: 600; color: #4b5563; text-align: left; width: 38%; vertical-align: top; background-color: transparent; text-transform: none; letter-spacing: 0; border-bottom: none; }
.details table { width: 100%; border-collapse: collapse; margin: 0; font-size: 15px; }
.details { background-color: #f5f6f8; border: none; border-radius: 6px; padding: 16px 18px 4px 18px; margin: 0 0 22px 0; }
.fact-label { margin: 0 0 3px 0; font-size: 12px; line-height: 1.3; font-weight: 600; color: #4b5563; }
.fact-value { margin: 0; font-size: 16px; line-height: 1.4; font-weight: 600; color: #0f172a; }
.fact-mono { margin: 0; font-size: 16px; line-height: 1.4; font-weight: 500; letter-spacing: 0.02em; color: #0f172a; font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, 'Courier New', monospace; }
.fact { padding: 12px 16px; vertical-align: top; text-align: left; color: #0f172a; background-color: transparent; border-bottom: none; }
.facts { width: 100%; border-collapse: separate; margin: 0 0 22px 0; font-size: 16px; background-color: #f5f6f8; border-radius: 6px; }
.alert p { margin: 0; font-size: 15px; line-height: 1.5; color: #7c2d12; }
.alert { background-color: #fff7ed; border: none; border-radius: 6px; padding: 12px 16px; margin: 0 0 22px 0; }
.action { margin: 26px 0 0 0; text-align: center; }
.action-link { margin: 10px 0 18px 0; font-size: 12px; line-height: 1.5; color: #4b5563; text-align: center; word-break: break-all; }
.content h2 { margin: 24px 0 10px 0; padding: 0 0 8px 0; font-size: 13px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #64748b; border-bottom: 1px solid #e5e7eb; }
.content-digest h2 { margin: 16px 0 10px 0; padding: 0 0 8px 0; font-size: 13px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #64748b; border-bottom: 1px solid #e5e7eb; }
.content-receipt h2 { margin: 24px 0 10px 0; padding: 0 0 8px 0; font-size: 13px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #64748b; border-bottom: 1px solid #e5e7eb; }
.content h3 { margin: 20px 0 8px 0; font-size: 16px; font-weight: 600; color: #0f172a; }
.content-digest h3 { margin: 20px 0 8px 0; font-size: 16px; font-weight: 600; color: #0f172a; }
.content-receipt h3 { margin: 20px 0 8px 0; font-size: 16px; font-weight: 600; color: #0f172a; }
.content p { margin: 0 0 18px 0; font-size: 16px; line-height: 1.6; color: #334155; }
.content-digest p { margin: 0 0 18px 0; font-size: 16px; line-height: 1.6; color: #334155; }
.content-receipt p { margin: 0 0 18px 0; font-size: 16px; line-height: 1.6; color: #334155; }
.content li { margin: 0 0 8px 0; font-size: 16px; line-height: 1.6; color: #334155; }
.content-digest li { margin: 0 0 8px 0; font-size: 16px; line-height: 1.6; color: #334155; }
.content-receipt li { margin: 0 0 8px 0; font-size: 16px; line-height: 1.6; color: #334155; }
.content ul { margin: 0 0 22px 0; padding-left: 22px; }
.content-digest ul { margin: 0 0 22px 0; padding-left: 22px; }
.content-receipt ul { margin: 0 0 22px 0; padding-left: 22px; }
.content th { padding: 10px 12px; background-color: #f8fafc; color: #475569; font-size: 12px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; border-bottom: 1px solid #e2e8f0; text-align: left; }
.content-digest th { padding: 10px 12px; background-color: #f8fafc; color: #475569; font-size: 12px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; border-bottom: 1px solid #e2e8f0; text-align: left; }
.content-receipt th { padding: 10px 12px; background-color: #f8fafc; color: #475569; font-size: 12px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; border-bottom: 1px solid #e2e8f0; text-align: left; }
.content td { padding: 12px; border-bottom: 1px solid #f1f5f9; color: #0f172a; }
.content-digest td { padding: 12px; border-bottom: 1px solid #f1f5f9; color: #0f172a; }
.content-receipt td { padding: 12px; border-bottom: 1px solid #f1f5f9; color: #0f172a; }
.content table { width: 100%; border-collapse: collapse; margin: 0 0 22px 0; font-size: 14px; }
.content-digest table { width: 100%; border-collapse: collapse; margin: 0 0 22px 0; font-size: 14px; }
.content-receipt table { width: 100%; border-collapse: collapse; margin: 0 0 22px 0; font-size: 14px; }
.content-digest { background-color: #ffffff; border: none; border-radius: 0 0 8px 8px; padding: 16px 24px 28px 24px; }
.content-receipt { background-color: #ffffff; border: none; border-radius: 0 0 8px 8px; padding: 16px 14px 28px 14px; }
.content { background-color: #ffffff; border: none; border-radius: 0 0 8px 8px; padding: 16px 24px 28px 24px; }
.button { display: inline-block; padding: 14px 36px; background-color: #b91c1c; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: 600; line-height: 1.2; }
.fineprint { margin: 14px 0 18px 0; font-size: 13px; line-height: 1.6; color: #64748b; }
.footer p { margin: 0 0 6px 0; font-size: 12px; line-height: 1.6; color: #4b5563; }
.footer { padding: 18px 8px 4px 8px; text-align: left; font-size: 12px; line-height: 1.6; color: #4b5563; }
.muted { font-size: 11px; line-height: 1.6; color: #4b5563; }
"""

# The chip's tint, per accent. A notice names its category once and
# :func:`build_shell` writes both halves of the pair; before this map the
# seven bodies each carried the tint as a literal, which is how the header
# and its chip drifted onto two different reds the first time an accent
# was corrected.
# The three shapes a notice takes. The stylesheet carries a .content class
# per layout, because ``inline_email_css`` keys off a single-token class
# attribute — a variant has to be its own class name, not a second one.
LAYOUTS = ("notice", "receipt", "digest")
DEFAULT_LAYOUT = "notice"

_LAYOUT_CONTENT_CLASS = {
    "notice": "content",
    "receipt": "content-receipt",
    "digest": "content-digest",
}

CHIP_TINTS = {
    ACCENT_RED: "#fef2f2",
    ACCENT_AMBER: "#fffbeb",
    ACCENT_GREEN: "#f0fdf4",
    ACCENT_BLUE: "#eff6ff",
    ACCENT_INDIGO: "#eef2ff",
    ACCENT_VIOLET: "#faf5ff",
    ACCENT_SLATE: "#f1f5f9",
}

# Table styling for the tables services inject into templates as raw HTML
# (outstanding property, election results, skipped voters, store orders).
# These cannot use the stylesheet's classes: the inliner keys off a
# single-token ``class`` attribute on markup that exists at render time,
# and these fragments are built afterwards, so every cell carries its own
# style. Constants keep the tables in four services looking like one table,
# and match ``.content table`` above so a service-built table and a
# template-built one are indistinguishable in the same email.
TABLE_STYLE = "width:100%;border-collapse:collapse;margin:0 0 22px 0;font-size:14px;"
TH_STYLE = (
    "padding:10px 12px;background-color:#f8fafc;color:#475569;font-size:12px;"
    "font-weight:600;letter-spacing:0.03em;text-transform:uppercase;"
    "border-bottom:1px solid #e2e8f0;text-align:left;"
)
TD_STYLE = "padding:12px;border-bottom:1px solid #f1f5f9;color:#0f172a;"
TFOOT_STYLE = (
    "padding:12px;background-color:#f8fafc;font-weight:600;color:#0f172a;"
    "border-top:1px solid #e2e8f0;"
)


# What each shipped body was built with, keyed by the body itself.
#
# Recorded here rather than repeated in the two DEFAULT_TEMPLATE_DEFS lists
# because those lists and build_shell would otherwise be two places naming a
# notice's accent, and the pair only has to disagree once for a template to
# be stamped with a colourway its own markup does not use. Keying on the html
# is safe: every body differs, and this is the call that produced it.
#
# No cap or eviction (Pitfall #9 would otherwise apply): this dict is meant
# to hold exactly the bounded set of shipped default-template constants
# built at import time. build_shell()'s `cache` parameter is what keeps it
# bounded — per-send runtime callers (wrap_email_body) pass cache=False so
# their one-off, never-looked-up shells don't accumulate here forever.
_SHELL_COLOURWAYS: dict = {}


def colourway_for(html: str) -> dict:
    """The accent, chip and layout :func:`build_shell` built *html* with.

    Empty for a body this module did not produce — a department's own edit,
    or a template written before the shell existed. Callers stamp nothing in
    that case, which is the right answer: nobody knows what colourway that
    body is using, and guessing one would overwrite it.
    """
    return dict(_SHELL_COLOURWAYS.get(html, {}))


def colourway_context(accent: str, chip: str, layout: str = DEFAULT_LAYOUT) -> dict:
    """Every variable :func:`build_shell` leaves for the renderer.

    One place, so a caller cannot fill three of them and leave a fourth
    reading ``{{status_chip_cell}}`` in somebody's inbox. An accent outside
    the map takes the slate tint, and an unrecognised layout the default
    content class — both read as deliberate rather than broken, which
    matters because ``wrap_email_body`` callers pass hexes that are not
    ``ACCENT_*`` constants.

    ``status_line`` is the current shell's category marker — a small accent
    square and the chip's wording above the title — built whole for the
    same reason the logo block is: the template system has no conditionals,
    so markup written around an empty ``{{status_chip}}`` would render a
    coloured square labelling nothing. An empty chip produces no line.

    ``status_chip_cell`` is the previous shell's pill, still produced because
    a template a department edited before this shell carries
    ``{{status_chip_cell}}`` in its stored body and renders it forever.

    ``content_class`` is what makes ``layout`` a setting rather than a
    stored value nobody reads: the class has to be chosen when the mail is
    rendered, from the column, not frozen into the body the day it was
    written.
    """
    tint = CHIP_TINTS.get(accent, CHIP_TINTS[ACCENT_SLATE])
    cell = ""
    line = ""
    if chip:
        safe_chip = _html.escape(str(chip))
        cell = (
            '<td style="text-align: right;">'
            f'<span class="chip" style="background-color: {tint}; '
            f'color: {accent};">{safe_chip}</span></td>'
        )
        # A table rather than an inline-block span: Outlook's Word engine
        # ignores inline-block, and a table cell is the one box it will
        # reliably size and fill.
        line = (
            '<table class="status-line" role="presentation" cellpadding="0" '
            'cellspacing="0"><tr>'
            f'<td class="status-mark" style="background-color: {accent};">&nbsp;</td>'
            f'<td class="status-text" style="color: {accent};">{safe_chip}</td>'
            "</tr></table>"
        )
    return {
        "header_accent": accent,
        "chip_tint": tint,
        "status_chip": chip,
        "status_chip_cell": cell,
        "status_line": line,
        "content_class": _LAYOUT_CONTENT_CLASS.get(
            layout or DEFAULT_LAYOUT, _LAYOUT_CONTENT_CLASS[DEFAULT_LAYOUT]
        ),
    }


def build_logo_cell(logo_url: str, organization_name: str) -> str:
    """Build the previous shell's logo cell, or an empty string when there is no logo.

    Still produced because a template a department edited before the
    centred-masthead shell carries ``{{organization_logo_cell}}`` in its
    stored body. The current shell uses :func:`build_logo_block`.

    This returns the whole ``<td>`` rather than a bare ``<img>`` for one
    reason: the template system substitutes ``{{name}}`` and has no
    conditionals, so a cell written into the shell around an empty
    ``{{organization_logo_img}}`` renders as a 36px white box with a border
    and nothing in it. Returning the cell lets a department with no logo
    drop it entirely and lead with its name, which is what the design asks
    for.

    The image is sized inline as well as by ``.lockup img`` because the
    inliner merges a class rule *behind* whatever the element already
    carries: the legacy ``{{organization_logo_img}}`` ships a hard-coded
    ``max-height:72px``, and an element that arrives already sized cannot be
    talked down to 36px by the stylesheet. Building the cell here is what
    makes the lockup's size the one that applies.

    Base64 data URIs are skipped for the same reason the legacy builder skips
    them: they embed the full image payload and push the message past Gmail's
    102 KB clipping threshold.
    """
    import html as _html

    url = str(logo_url or "")
    if not url or url.startswith("data:"):
        return ""
    safe_url = _html.escape(url)
    safe_name = _html.escape(str(organization_name or "Organization"))
    return (
        '<td class="logomark"><img src="' + safe_url + '" alt="' + safe_name + '" '
        'style="display:block;max-width:36px;max-height:36px;width:auto;'
        'height:auto;border:0;" /></td>'
    )


def build_logo_block(logo_url: str, organization_name: str) -> str:
    """The masthead's centred logo, or an empty string when there is no logo.

    The current shell's counterpart to :func:`build_logo_cell`, which stays
    for bodies written against the previous shell. Returned whole for the
    same reason: with no conditionals in the template system, a plate written
    around an empty image renders as a white square with nothing on it.

    The logo sits on a small white plate. Gmail's apps and Outlook repaint
    mail in dark colours whatever the message declares, and a crest drawn in
    dark ink on a transparent background disappears into that; the plate
    keeps its edges visible either way.

    Sized with ``max-width``/``max-height`` rather than fixed dimensions
    because a department's logo can be any aspect ratio, and fixed width and
    height would stretch it. Data URIs are skipped, as in
    :func:`build_logo_cell`.
    """
    url = str(logo_url or "")
    if not url or url.startswith("data:"):
        return ""
    safe_url = _html.escape(url)
    safe_name = _html.escape(str(organization_name or "Organization"))
    return (
        '<table role="presentation" align="center" cellpadding="0" '
        'cellspacing="0" style="margin:0 auto;"><tr>'
        '<td style="background-color:#ffffff;border-radius:10px;padding:5px;">'
        '<img src="' + safe_url + '" alt="' + safe_name + '" '
        'style="display:block;max-width:48px;max-height:48px;width:auto;'
        'height:auto;border:0;" /></td></tr></table>'
    )


def fact(label: str, value: str, mono: bool = False) -> tuple:
    """One label/value pair for :func:`facts`.

    *mono* sets the value in a fixed-width face, for values a member has to
    type back exactly — a username or a temporary password, where ``l``/``1``
    and ``O``/``0`` must be told apart.
    """
    return (label, value, mono)


def facts(rows: list) -> str:
    """The key-facts panel: labels above values, one or two facts per row.

    *rows* is a list of rows, each a list of one or two :func:`fact` pairs.
    Which facts share a row is the caller's decision, per template, rather
    than something worked out here: only the author knows that "Start" and
    "End" are short and belong together, and that "Reason" is free text a
    department types and can run to a paragraph. A lone fact spans the row.

    Returned as literal markup, so the stored body carries exactly what an
    admin will see and can edit in the template editor — there is no macro
    for the editor to expand.
    """
    lines = [
        '        <table class="facts" role="presentation" cellpadding="0" '
        'cellspacing="0">'
    ]
    for row in rows:
        if not 1 <= len(row) <= 2:
            raise ValueError("a facts row holds one or two facts")
        cells = []
        for label, value, mono in row:
            span = ' colspan="2"' if len(row) == 1 else ' width="50%"'
            value_class = "fact-mono" if mono else "fact-value"
            cells.append(
                f'<td class="fact"{span}><p class="fact-label">{label}</p>'
                f'<p class="{value_class}">{value}</p></td>'
            )
        lines.append("            <tr>" + "".join(cells) + "</tr>")
    lines.append("        </table>")
    return "\n".join(lines) + "\n"


def action(url: str, label: str) -> str:
    """The centred button and, under it, the same link as plain text.

    The plain link is not decoration: a client that strips styling, a
    screen reader user skipping between links, and a member reading on a
    device where the button will not open all need the address itself.

    *url* is a template variable name, written as ``{{name}}`` by the
    caller. ``{accent}`` is left for :func:`build_shell` to turn into the
    colourway token.
    """
    return (
        f'        <p class="action"><a href="{url}" class="button" '
        f'style="background-color: {{accent}};">{label}</a></p>\n'
        f'        <p class="action-link">Or open this link: {url}</p>\n'
    )


_FACT_VALUE = re.compile(r'<p class="fact-(?:value|mono)">(.*?)</p>', re.S)
_FACT_ROW = re.compile(r"<tr>(.*?)</tr>", re.S)

# Zero-width non-joiner and a no-break space, repeated: the conventional
# filler that clients render as nothing but count as preview text.
_PREHEADER_FILLER = "&zwnj;&nbsp;" * 40


def _first_fact_row(content: str) -> str:
    """The values in the fact panel's first row, joined, with markup removed.

    The first row is where each template puts the fact a member opens the
    email for (the start time, the expiry date, the return deadline), so it
    doubles as the inbox preview without every template restating it.
    """
    panel = content.find('class="facts"')
    if panel == -1:
        return ""
    row = _FACT_ROW.search(content, panel)
    if not row:
        return ""
    values = [
        re.sub(r"\s+", " ", re.sub(r"<br\s*/?>", ", ", v)).strip()
        for v in _FACT_VALUE.findall(row.group(1))
    ]
    values = [re.sub(r"<[^>]+>", "", v) for v in values if v]
    return " · ".join(values)


def _preheader(text: str) -> str:
    """The hidden preview line, first thing in the body.

    Hidden with every property clients are known to honour between them —
    ``mso-hide`` for Outlook, ``max-height``/``overflow`` for the clients that
    ignore ``display:none`` on a div — and coloured like the page so a client
    that shows it anyway shows nothing legible.
    """
    return (
        '<div style="display:none;font-size:1px;line-height:1px;max-height:0;'
        'max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#eef0f3;">'
        + text
        + _PREHEADER_FILLER
        + "</div>"
    )


def build_shell(
    title: str,
    content: str,
    accent: str = ACCENT_RED,
    chip: str = "",
    subtitle: str = "",
    brand: str = "{{organization_name}}",
    layout: str = DEFAULT_LAYOUT,
    cache: bool = True,
    preheader: str = "",
) -> str:
    """Build the chrome every notice renders into.

    One function, because there is no import path between the two modules
    that need it: ``email_template_service`` owns the platform's copy and
    ``email_templates_storefront`` owns the store's, and the storefront
    cannot import the service because the service imports *it*. Before this
    existed the two files each carried their own copy of the layout, and the
    store's mail drifted a header at a time.

    *accent* drives every accented element; the chip's tint is looked up
    in :data:`CHIP_TINTS` rather than passed, so the two halves of a
    colourway cannot disagree. An accent outside the map falls back to the
    slate tint, which reads as deliberate rather than broken.

    *chip* and *subtitle* are omitted from the markup entirely when empty —
    an empty chip would otherwise render as a coloured square labelling
    nothing, and an empty subline as dead space under the title.

    *subtitle* is HTML-escaped here, unlike *title* — every current caller
    passes *title* as either a trusted literal or already escapes it before
    calling in (``wrap_email_body``), but *subtitle* has no such caller-side
    guarantee, so it is escaped at the one place every caller goes through.

    *brand* is the masthead's name line. The store passes ``{{store_name}}``;
    everything else takes the department.

    *preheader* is the line an inbox shows beside the subject. Phones show
    only 30–55 characters of it, so it should lead with the fact the member
    opened the email for. Left empty it defaults to *subtitle* — the line an
    author already chose to put under the title — then to the first row of
    the fact panel; with neither, no preheader is written.
    The text is followed by invisible filler so a client that runs out of
    preheader does not continue into the masthead and show the department
    name twice.

    ``{accent}`` inside *content* is substituted with the accent token, so a
    body writes ``background-color: {accent};`` on its button and cannot
    disagree with its own status line. A single brace is safe to use for this: template
    variables are doubled (``{{name}}``), and the substitution is a plain
    string replace rather than ``str.format``, so a stray brace in prose is
    left alone instead of raising.

    **The accent and the chip text are emitted as template variables, not
    hexes.** Every place the colourway appears becomes
    ``{{header_accent}}`` / ``{{chip_tint}}`` / ``{{status_chip}}``, which
    the renderer fills from the template's own ``header_accent`` and
    ``status_chip`` columns. That is what makes a colourway something an
    officer can change from the screen rather than something only a deploy
    can change — and it keeps one canonical stored shape, because a body
    never carries a hex for the renderer and a column to disagree with it.

    *accent* and *chip* are still taken: they are what a newly created or
    reset template's columns are stamped with, and callers that do not go
    through the template system at all (``wrap_email_body``) substitute the
    tokens themselves.

    *cache* records the shell in :data:`_SHELL_COLOURWAYS` for later
    :func:`colourway_for` lookups (Pitfall #9: the module-level dict has no
    cap or eviction, so it must stay populated only by the bounded set of
    shipped default-template constants this module defines at import time).
    ``wrap_email_body`` builds one unique shell per send with no caller that
    ever reads its entry back — pass ``cache=False`` there so per-send
    traffic does not grow the dict forever.
    """
    if layout not in _LAYOUT_CONTENT_CLASS:
        raise ValueError(f"unknown layout {layout!r}; expected one of {LAYOUTS}")
    content = content.replace("{accent}", "{{header_accent}}")

    # The logo block and the status line are render-time tokens rather than
    # markup decided here: each is optional, and which of them a given send
    # actually has is not knowable when the body is written.
    head = []
    teaser = preheader or _html.escape(subtitle) or _first_fact_row(content)
    if teaser:
        head.append(_preheader(teaser))
    head += [
        '<div class="container">',
        '    <div class="masthead">',
        "        {{organization_logo_block}}",
        "        <p>" + brand + "</p>",
        "    </div>",
        '    <div class="header">',
        "        {{status_line}}",
        "        <h1>" + title + "</h1>",
    ]
    if subtitle:
        head.append(
            '        <p style="color: {{header_accent}};">'
            + _html.escape(subtitle)
            + "</p>"
        )

    shell = "\n".join(
        [
            *head,
            "    </div>",
            '    <div class="{{content_class}}">',
            content.rstrip("\n"),
            "    </div>",
            "    {{footer_html}}",
            "</div>",
        ]
    )
    if cache:
        _SHELL_COLOURWAYS[shell] = {
            "accent": accent,
            "chip": chip,
            "layout": layout,
        }
    return shell


def build_email_document(subject: str, body_html: str, css: str = "") -> str:
    """Wrap a rendered body in the full HTML document every client expects.

    The three render paths (a stored template, the code defaults behind it,
    and the one-off bodies scheduled tasks build inline) all go through here
    so a fix to the document shell reaches all of them.  Each element carries
    weight:

    * ``lang``/``dir`` — screen readers announce the message in the right
      language (WCAG 3.1.1).
    * ``meta charset`` — without it Outlook and several webmail clients decode
      the body as Windows-1252 and the em dashes in almost every subject line
      arrive as ``â€"``.
    * ``meta viewport`` — stops mobile Safari shrinking the 600px card to fit.
    * ``color-scheme: light`` — clients that auto-invert for dark mode leave a
      page declaring its scheme alone, so the header accent survives.
    * The ``mso`` block pins Outlook's DPI, which otherwise scales the card up
      by 25% on high-DPI Windows.
    """
    import html as _html

    safe_subject = _html.escape(subject)
    safe_subject_attr = _html.escape(subject, quote=True)
    return f"""<!DOCTYPE html>
<html lang="en" dir="ltr" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>{safe_subject}</title>
<style>
{css or DEFAULT_CSS}
</style>
<!--[if mso]>
<noscript>
<xml>
<o:OfficeDocumentSettings>
<o:PixelsPerInch>96</o:PixelsPerInch>
</o:OfficeDocumentSettings>
</xml>
</noscript>
<![endif]-->
</head>
<body>
<div role="article" aria-roledescription="email" aria-label="{safe_subject_attr}">
{body_html}
</div>
</body>
</html>"""
