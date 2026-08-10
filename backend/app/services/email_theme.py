"""
Email Theme — the one place the outgoing mail's look is defined.

Every email the platform sends renders into the same chrome: an optional
logo, a coloured header band, a white content card and a muted footer.  The
stylesheet below is what makes that chrome look the way it does, and the
accent constants are the only colours a template should put on a header.

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
   paragraph's spacing.
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
body { margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.6; color: #1f2937; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; -webkit-font-smoothing: antialiased; }
.container { width: 100%; max-width: 600px; margin: 0 auto; padding: 24px 12px; }
.logo { text-align: center; padding: 0 0 20px 0; }
.logo img { max-height: 72px; max-width: 200px; }
.header { background-color: #b91c1c; color: #ffffff; padding: 28px 24px; text-align: center; border-radius: 12px 12px 0 0; }
.header h1 { margin: 0; font-size: 22px; line-height: 1.3; font-weight: 600; letter-spacing: -0.01em; color: #ffffff; }
.details p { margin: 0 0 10px 0; font-size: 15px; line-height: 1.5; color: #374151; }
.details { background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 18px 20px; margin: 20px 0; }
.content { background-color: #ffffff; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; padding: 32px 28px; }
.content p { margin: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: #1f2937; }
.content h2 { margin: 28px 0 12px 0; padding: 0 0 8px 0; font-size: 13px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #6b7280; border-bottom: 1px solid #e5e7eb; }
.content h3 { margin: 20px 0 8px 0; font-size: 16px; font-weight: 600; color: #1f2937; }
.content li { margin: 0 0 8px 0; font-size: 16px; line-height: 1.6; color: #1f2937; }
.content ul { margin: 0 0 16px 0; padding-left: 22px; }
.content table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; }
.button { display: inline-block; padding: 14px 28px; background-color: #1d4ed8; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: 600; line-height: 1.2; margin: 8px 0; }
.footer p { margin: 0 0 6px 0; font-size: 12px; line-height: 1.6; color: #4b5563; }
.footer { padding: 24px 16px 8px 16px; text-align: center; font-size: 12px; line-height: 1.6; color: #4b5563; }
.muted { font-size: 11px; line-height: 1.6; color: #4b5563; }
"""


# Table styling for the tables services inject into templates as raw HTML
# (outstanding property, election results, skipped voters, store orders).
# These cannot use the stylesheet's classes: the inliner keys off a
# single-token ``class`` attribute on markup that exists at render time,
# and these fragments are built afterwards, so every cell carries its own
# style. Constants keep the tables in four services looking like one table.
TABLE_STYLE = "width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;"
TH_STYLE = (
    "padding:10px 12px;background-color:#f3f4f6;color:#374151;font-size:12px;"
    "font-weight:600;letter-spacing:0.03em;text-transform:uppercase;"
    "border-bottom:1px solid #e5e7eb;"
)
TD_STYLE = "padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#1f2937;"
TFOOT_STYLE = (
    "padding:12px;background-color:#f9fafb;font-weight:600;color:#1f2937;"
    "border-top:1px solid #e5e7eb;"
)


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
