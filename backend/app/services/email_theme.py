"""
Email Theme — the one place the outgoing mail's look is defined.

Every email the platform sends renders into the same chrome: a header whose
only colour is a 5px accent rule and a tinted status chip, a white content
card, and a muted footer.  The stylesheet below is what makes that chrome
look the way it does, and the accent constants are the only colours a
template should put on a notice.

The accent appears in exactly four places, all of them inline-overridable so
one shell serves every category:

===============  =================================
Element          Inline override
===============  =================================
``.header``      ``border-top-color``
``.chip``        ``background-color`` + ``color``
``.details``     ``border-left-color``
``.button``      ``background-color``
===============  =================================

:func:`build_shell` writes all four from one accent, so a notice names its
category and gets the colourway; nothing downstream repeats a hex.

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

``.chip``, ``.alert``, ``.lockup``, ``.logomark`` and ``.fineprint`` are the
classes 1b added.  Nothing that existed before was renamed, so a department
that has already customised a body keeps rendering — it simply does not get
the accent rule or the chip until it resets that template.
"""

# Header accents.  White text on each of these clears WCAG 2.1 AA (4.5:1):
# red 6.5:1, amber 5.0:1, green 5.5:1, blue 6.7:1, indigo 7.9:1,
# violet 7.1:1, slate 10.3:1.
ACCENT_RED = "#b91c1c"
ACCENT_AMBER = "#b45309"
ACCENT_GREEN = "#047857"
ACCENT_BLUE = "#1d4ed8"
ACCENT_INDIGO = "#4338ca"
ACCENT_VIOLET = "#6d28d9"
ACCENT_SLATE = "#334155"

# Body copy on white is 14.7:1, muted footer text on the page grey is 6.9:1.
DEFAULT_CSS = """
body { margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.6; color: #334155; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; -webkit-font-smoothing: antialiased; }
.container { width: 100%; max-width: 600px; margin: 0 auto; padding: 24px 12px; }
.logo { text-align: center; padding: 0 0 20px 0; }
.logo img { max-height: 72px; max-width: 200px; }
.header h1 { margin: 20px 0 0 0; font-size: 27px; line-height: 1.22; font-weight: 700; letter-spacing: -0.02em; color: #0f172a; }
.header p { margin: 8px 0 0 0; font-size: 16px; line-height: 1.4; font-weight: 600; color: #475569; }
.header { background-color: #ffffff; border: 1px solid #e5e7eb; border-top: 5px solid #b91c1c; border-bottom: none; border-radius: 12px 12px 0 0; padding: 24px 28px 0 28px; }
.lockup img { display: block; max-width: 36px; max-height: 36px; width: auto; height: auto; border: 0; }
.lockup td { vertical-align: middle; font-size: 13px; font-weight: 600; color: #0f172a; }
.lockup { width: 100%; border-collapse: collapse; }
.logomark { background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 3px; width: 36px; text-align: center; }
.chip { display: inline-block; background-color: #f1f5f9; color: #334155; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; padding: 5px 10px; border-radius: 20px; }
.details p { margin: 0 0 12px 0; font-size: 15px; line-height: 1.5; color: #0f172a; }
.details td { padding: 0 0 12px 0; font-size: 15px; line-height: 1.5; color: #0f172a; vertical-align: top; background-color: transparent; border-bottom: none; }
.details th { padding: 0 0 12px 0; font-size: 13px; line-height: 1.5; font-weight: 400; color: #64748b; text-align: left; width: 38%; vertical-align: top; background-color: transparent; text-transform: none; letter-spacing: 0; border-bottom: none; }
.details table { width: 100%; border-collapse: collapse; margin: 0; font-size: 15px; }
.details { background-color: #f8fafc; border: 1px solid #e2e8f0; border-left: 3px solid #b91c1c; border-radius: 8px; padding: 18px 20px; margin: 0 0 22px 0; }
.alert p { margin: 0; font-size: 15px; line-height: 1.5; color: #92400e; }
.alert { background-color: #fffbeb; border: 1px solid #fde68a; border-left: 4px solid #d97706; border-radius: 8px; padding: 14px 16px; margin: 0 0 22px 0; }
.content h2 { margin: 24px 0 10px 0; padding: 0 0 8px 0; font-size: 13px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #64748b; border-bottom: 1px solid #e5e7eb; }
.content-digest h2 { margin: 16px 0 10px 0; padding: 0 0 8px 0; font-size: 13px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #64748b; border-bottom: 1px solid #e5e7eb; }
.content-receipt h2 { margin: 24px 0 10px 0; padding: 0 0 8px 0; font-size: 13px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #64748b; border-bottom: 1px solid #e5e7eb; }
.content h3 { margin: 20px 0 8px 0; font-size: 16px; font-weight: 600; color: #0f172a; }
.content-digest h3 { margin: 20px 0 8px 0; font-size: 16px; font-weight: 600; color: #0f172a; }
.content-receipt h3 { margin: 20px 0 8px 0; font-size: 16px; font-weight: 600; color: #0f172a; }
.content p { margin: 0 0 18px 0; font-size: 16px; line-height: 1.6; color: #334155; }
.content-digest p { margin: 0 0 18px 0; font-size: 16px; line-height: 1.6; color: #334155; }
.content-receipt p { margin: 0 0 18px 0; font-size: 16px; line-height: 1.6; color: #334155; }
.content li { margin: 0 0 8px 0; font-size: 15px; line-height: 1.6; color: #334155; }
.content-digest li { margin: 0 0 8px 0; font-size: 15px; line-height: 1.6; color: #334155; }
.content-receipt li { margin: 0 0 8px 0; font-size: 15px; line-height: 1.6; color: #334155; }
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
.content-digest { background-color: #ffffff; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; padding: 18px 28px 30px 28px; }
.content-receipt { background-color: #ffffff; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; padding: 18px 14px 30px 14px; }
.content { background-color: #ffffff; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; padding: 18px 28px 30px 28px; }
.button { display: inline-block; padding: 15px 32px; background-color: #b91c1c; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 17px; font-weight: 700; line-height: 1.2; }
.fineprint { margin: 14px 0 18px 0; font-size: 13px; line-height: 1.6; color: #64748b; }
.footer p { margin: 0 0 6px 0; font-size: 12px; line-height: 1.6; color: #4b5563; }
.footer { padding: 22px 16px 4px 16px; text-align: center; font-size: 12px; line-height: 1.6; color: #4b5563; }
.muted { font-size: 11px; line-height: 1.6; color: #94a3b8; }
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
_SHELL_COLOURWAYS: dict = {}


def colourway_for(html: str) -> dict:
    """The accent, chip and layout :func:`build_shell` built *html* with.

    Empty for a body this module did not produce — a department's own edit,
    or a template written before the shell existed. Callers stamp nothing in
    that case, which is the right answer: nobody knows what colourway that
    body is using, and guessing one would overwrite it.
    """
    return dict(_SHELL_COLOURWAYS.get(html, {}))


def colourway_context(accent: str, chip: str) -> dict:
    """The three variables :func:`build_shell` leaves for the renderer.

    One place, so a caller cannot fill two of the three and leave the chip
    reading ``{{status_chip}}`` in somebody's inbox. An accent outside the
    map takes the slate tint, which reads as deliberate rather than broken.
    """
    return {
        "header_accent": accent,
        "chip_tint": CHIP_TINTS.get(accent, CHIP_TINTS[ACCENT_SLATE]),
        "status_chip": chip,
    }


def build_logo_cell(logo_url: str, organization_name: str) -> str:
    """Build the lockup's logo cell, or an empty string when there is no logo.

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


def build_shell(
    title: str,
    content: str,
    accent: str = ACCENT_RED,
    chip: str = "",
    subtitle: str = "",
    brand: str = "{{organization_name}}",
    layout: str = DEFAULT_LAYOUT,
) -> str:
    """Build the chrome every notice renders into.

    One function, because there is no import path between the two modules
    that need it: ``email_template_service`` owns the platform's copy and
    ``email_templates_storefront`` owns the store's, and the storefront
    cannot import the service because the service imports *it*. Before this
    existed the two files each carried their own copy of the layout, and the
    store's mail drifted a header at a time.

    *accent* drives all four accented elements; the chip's tint is looked up
    in :data:`CHIP_TINTS` rather than passed, so the two halves of a
    colourway cannot disagree. An accent outside the map falls back to the
    slate tint, which reads as deliberate rather than broken.

    *chip* and *subtitle* are omitted from the markup entirely when empty —
    an empty chip would otherwise render as a bare tinted pill, and an empty
    subline as 8px of dead space under the title.

    *brand* is the lockup's name cell. The store passes ``{{store_name}}``;
    everything else takes the department.

    ``{accent}`` inside *content* is substituted with the accent token, so a
    body writes ``border-left-color: {accent};`` on its panel and
    ``background-color: {accent};`` on its button and cannot disagree with
    its own header. A single brace is safe to use for this: template
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
    """
    if layout not in _LAYOUT_CONTENT_CLASS:
        raise ValueError(f"unknown layout {layout!r}; expected one of {LAYOUTS}")
    content = content.replace("{accent}", "{{header_accent}}")

    cells = [
        "            {{organization_logo_cell}}",
        '            <td style="padding-left: 10px;">' + brand + "</td>",
    ]
    if chip:
        cells.append(
            '            <td style="text-align: right;">'
            '<span class="chip" style="background-color: {{chip_tint}}; '
            'color: {{header_accent}};">{{status_chip}}</span></td>'
        )

    head = [
        '<div class="container">',
        '    <div class="header" style="border-top-color: {{header_accent}};">',
        '        <table class="lockup"><tr>',
        *cells,
        "        </tr></table>",
        "        <h1>" + title + "</h1>",
    ]
    if subtitle:
        head.append('        <p style="color: {{header_accent}};">' + subtitle + "</p>")

    shell = "\n".join(
        [
            *head,
            "    </div>",
            '    <div class="' + _LAYOUT_CONTENT_CLASS[layout] + '">',
            content.rstrip("\n"),
            "    </div>",
            "    {{footer_html}}",
            "</div>",
        ]
    )
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
