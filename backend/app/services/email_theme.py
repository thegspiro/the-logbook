"""
Email Theme — the one place the outgoing mail's look is defined.

Every email the platform sends renders into the same chrome: a centred
masthead (the department's logo above its name) on a light grey page, a
solid tab in the notice's accent naming its category and, on the right, the
one piece of urgency it carries, a card tinted with the accent holding the
title, the white body card, any callout cards stacked under it, and a centred
footer.  The stylesheet below is what makes that chrome look the way it does,
and the accent constants are the only colours a template should put on a
notice.

The layout follows published guidance for transactional mail rather than a
house style: body text is left-aligned, key facts are set with each label
above its value so they can be found without reading prose, body copy is
16px, and the button spans the card and is at least 44px tall. There are no
rules or rails between blocks; spacing separates them.

The accent appears in these places, all of them inline so one shell serves
every category:

====================  =================================
Element               Inline override
====================  =================================
``.tab``              ``background-color`` (and ``bgcolor``)
``.summary``          ``background-color`` — the accent's tint
``.cta-cell``         ``background-color`` (and ``bgcolor``)
``.tile-count``       ``background-color``
====================  =================================

:func:`build_shell` and :func:`colourway_context` write all of them from one
accent, so a notice names its category and gets the colourway; nothing
downstream repeats a hex.

**Dark mode** is a second stylesheet, :data:`DARK_CSS`, kept out of the
inliner's way; see :func:`_dark_css`.

**The classes the previous shells used are still defined.** ``.header``,
``.status-line``, ``.lockup``, ``.logomark``, ``.chip``, ``.action`` and
``.button`` stay in the sheet because a template a department edited carries
the old markup in its stored body, and that body renders against *this*
stylesheet. It keeps working and picks up the new body card, spacing and
footer; it keeps its own header until the template is reset.

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
   property ``.content td`` / ``.content p`` / ``.content table`` set, and so
   do ``.facts-panel``, ``.fact-boxed``, ``.cta`` and ``.cta-cell``. In the
   tinted card, ``.summary-fact-label`` and ``.summary-fact-value`` name every
   property ``.summary p`` sets, for the same reason. Class rules are applied before any ``.parent tag`` rule and therefore win
   where they speak; where they are silent, the content rule leaks through.
"""

import html as _html
import re

# Accents.  White text on each of these clears WCAG 2.1 AA (4.5:1):
# red 6.5:1, amber 5.0:1, green 5.5:1, blue 6.7:1, indigo 7.9:1,
# violet 7.1:1, slate 10.3:1.  That is what lets the solid tab keep its accent
# in both colour schemes, and the same figures hold for the accent-coloured
# countdown tile and the accent-coloured value in a summary box.
ACCENT_RED = "#b91c1c"
ACCENT_AMBER = "#b45309"
ACCENT_GREEN = "#047857"
ACCENT_BLUE = "#1d4ed8"
ACCENT_INDIGO = "#4338ca"
ACCENT_VIOLET = "#6d28d9"
ACCENT_SLATE = "#334155"

# The four shapes a callout card takes, plus a neutral one for the "didn't ask
# for this?" line. Deliberately *not* the accents: a callout's colour says what
# kind of message it is (a warning is amber on a blue event notice too), so
# tying it to the notice's colourway would make an election's warning purple.
# The shades are one step darker than the accents so no body ever carries an
# ACCENT_* hex — the colourway column must stay the only place those come from.
# Title on tint: info 8.6:1, success 7.7:1, warning 7.6:1, critical 8.0:1.
CALLOUT_KINDS = {
    # kind: (surface, title, text, dark surface, dark title)
    "info": ("#eff6ff", "#1e40af", "#1e3a8a", "#18223d", "#93b4ff"),
    "success": ("#f0fdf4", "#065f46", "#064e3b", "#142a22", "#6ee7b7"),
    "warning": ("#fffbeb", "#92400e", "#78350f", "#2b2414", "#f5b454"),
    "critical": ("#fef2f2", "#991b1b", "#7f1d1d", "#361a1c", "#fca5a5"),
    "neutral": ("#ffffff", "#0f172a", "#334155", "#1c1f24", "#f3f4f6"),
}


def _callout_css() -> str:
    """One container and two paragraph classes per callout kind.

    Generated rather than typed out because the three rules per kind differ
    only in their colours, and fifteen hand-written lines are fifteen chances
    for one kind's title to drift from the others. Each paragraph names every
    property it sets: the callouts sit outside ``.content``, so nothing leaks
    in, but a department that pastes one inside the body card would otherwise
    inherit ``.content p``'s colour.
    """
    lines = []
    for kind, (surface, title, text, _dark, _dark_title) in CALLOUT_KINDS.items():
        lines.append(
            f".callout-title-{kind} {{ margin: 0 0 2px 0; font-size: 15px; "
            f"line-height: 1.4; font-weight: 700; color: {title}; }}"
        )
        lines.append(
            f".callout-text-{kind} {{ margin: 0; font-size: 15px; "
            f"line-height: 1.5; font-weight: 400; color: {text}; }}"
        )
        border = "border: 1px solid #e2e8f0; " if kind == "neutral" else ""
        lines.append(
            f".callout-{kind} {{ background-color: {surface}; {border}"
            "border-radius: 12px; padding: 16px 24px; margin: 12px 0 0 0; }"
        )
    return "\n".join(lines) + "\n"


# Body copy on white is 10.4:1, muted footer text on the page grey is 6.9:1.
#
# .muted keeps #4b5563 rather than the #94a3b8 the 1b spec names. At 11px it
# carries the department's phone number and mailing address — email_footers
# applies it to the contact line — and #94a3b8 is 2.6:1 on the white card,
# well under the 4.5:1 AA floor for small text. The spec picked it to sit
# quietly under the footer; it sits too quietly to read.
#
# The rules from ``.header`` to ``.chip``, and ``.action`` / ``.button``, are
# the previous shells' classes. Nothing this module builds uses them any more;
# they stay because an edited body carries that markup and renders against
# this sheet (see the module docstring).
DEFAULT_CSS = (
    """
body { margin: 0; padding: 0; background-color: #eef0f3; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.6; color: #334155; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; -webkit-font-smoothing: antialiased; }
.container { max-width: 600px; margin: 0 auto; padding: 24px 16px 24px 16px; }
.logo { text-align: center; padding: 0 0 20px 0; }
.logo img { max-height: 72px; max-width: 200px; }
.masthead p { margin: 8px 0 0 0; font-size: 14px; line-height: 1.35; font-weight: 700; color: #0f172a; }
.masthead { text-align: center; padding: 0 0 16px 0; }
.tab-label { padding: 11px 0 11px 24px; font-size: 12px; line-height: 1.2; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: #ffffff; text-align: left; }
.tab-note { padding: 11px 24px 11px 12px; font-size: 13px; line-height: 1.2; font-weight: 600; color: #ffffff; text-align: right; }
.tab { width: 100%; border-collapse: collapse; border-radius: 12px 12px 0 0; }
.tile-count-num { padding: 10px 0 0 0; text-align: center; font-size: 26px; line-height: 1; font-weight: 800; color: #ffffff; }
.tile-count-unit { padding: 4px 0 9px 0; text-align: center; font-size: 11px; line-height: 1.2; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #ffffff; }
.tile-count { width: 72px; border-collapse: separate; border-radius: 8px; }
.tile-date-month { padding: 4px 0; text-align: center; font-size: 11px; line-height: 1.2; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #ffffff; border-radius: 8px 8px 0 0; }
.tile-date-day { padding: 6px 0 8px 0; text-align: center; font-size: 30px; line-height: 1; font-weight: 800; color: #0f172a; }
.tile-date { width: 72px; border-collapse: separate; background-color: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; }
.summary-lead { width: 72px; padding: 0 18px 0 0; vertical-align: top; }
.summary-text { vertical-align: top; }
.summary-row { width: 100%; border-collapse: collapse; }
.summary-fact-label { margin: 0 0 3px 0; font-size: 12px; line-height: 1.3; font-weight: 600; color: #4b5563; }
.summary-fact-value { margin: 0; font-size: 18px; line-height: 1.3; font-weight: 700; color: #0f172a; }
.summary-fact { background-color: #ffffff; border-radius: 8px; padding: 12px 14px; vertical-align: top; text-align: left; }
.summary-gap { width: 10px; font-size: 0; line-height: 0; }
.summary-facts { width: 100%; border-collapse: separate; margin: 16px 0 0 0; }
.summary h1 { margin: 0; font-size: 24px; line-height: 1.25; font-weight: 700; letter-spacing: -0.01em; color: #0f172a; }
.summary p { margin: 6px 0 0 0; font-size: 16px; line-height: 1.4; font-weight: 600; color: #334155; }
.summary { padding: 20px 24px 22px 24px; }
.status-mark { width: 8px; height: 8px; padding: 0; border-radius: 2px; font-size: 0; line-height: 0; }
.status-text { padding: 0 0 0 8px; font-size: 13px; line-height: 1.3; font-weight: 600; }
.status-line { border-collapse: collapse; margin: 0 0 10px 0; }
.header h1 { margin: 0; font-size: 24px; line-height: 1.25; font-weight: 700; letter-spacing: -0.01em; color: #0f172a; }
.header p { margin: 6px 0 0 0; font-size: 16px; line-height: 1.4; font-weight: 600; color: #475569; }
.header { background-color: #ffffff; border: none; border-radius: 12px 12px 0 0; padding: 26px 24px 0 24px; }
.lockup img { display: block; max-width: 36px; max-height: 36px; width: auto; height: auto; border: 0; }
.lockup td { vertical-align: middle; font-size: 13px; font-weight: 600; color: #0f172a; }
.lockup { width: 100%; border-collapse: collapse; margin: 0 0 16px 0; }
.logomark { background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 3px; width: 36px; text-align: center; }
.chip { display: inline-block; background-color: #f1f5f9; color: #334155; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; padding: 5px 10px; border-radius: 20px; }
.details p { margin: 0 0 12px 0; font-size: 15px; line-height: 1.5; color: #0f172a; }
.details td { padding: 0 0 12px 0; font-size: 15px; line-height: 1.5; color: #0f172a; vertical-align: top; background-color: transparent; border-bottom: none; }
.details th { padding: 0 0 12px 0; font-size: 13px; line-height: 1.5; font-weight: 600; color: #4b5563; text-align: left; width: 38%; vertical-align: top; background-color: transparent; text-transform: none; letter-spacing: 0; border-bottom: none; }
.details table { width: 100%; border-collapse: collapse; margin: 0; font-size: 15px; }
.details { background-color: #f5f6f8; border: none; border-radius: 8px; padding: 16px 18px 4px 18px; margin: 0 0 22px 0; }
.fact-label { margin: 0 0 3px 0; font-size: 12px; line-height: 1.3; font-weight: 600; color: #4b5563; }
.fact-value { margin: 0; font-size: 16px; line-height: 1.4; font-weight: 600; color: #0f172a; }
.fact-mono { margin: 0; font-size: 17px; line-height: 1.4; font-weight: 700; letter-spacing: 0.04em; color: #0f172a; font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, 'Courier New', monospace; }
.fact-boxed { padding: 12px 16px; vertical-align: top; text-align: left; color: #0f172a; background-color: transparent; border-bottom: none; }
.fact { padding: 0 16px 16px 0; vertical-align: top; text-align: left; color: #0f172a; background-color: transparent; border-bottom: none; }
.facts-panel { width: 100%; border-collapse: separate; margin: 0 0 22px 0; font-size: 16px; background-color: #f5f6f8; border-radius: 8px; }
.facts { width: 100%; border-collapse: collapse; margin: 0 0 6px 0; font-size: 16px; background-color: transparent; border-radius: 0; }
.alert p { margin: 0; font-size: 15px; line-height: 1.5; color: #78350f; }
.alert { background-color: #fffbeb; border: none; border-radius: 8px; padding: 14px 18px; margin: 0 0 22px 0; }
.cta-link { display: block; padding: 15px 12px; font-size: 16px; line-height: 1.2; font-weight: 700; color: #ffffff; text-decoration: none; text-align: center; border-radius: 8px; }
.cta-cell { padding: 0; border-radius: 8px; border-bottom: none; color: #ffffff; text-align: center; }
.cta { width: 100%; border-collapse: separate; margin: 24px 0 0 0; font-size: 16px; }
.action { margin: 26px 0 0 0; text-align: center; }
.action-link { margin: 12px 0 18px 0; font-size: 12px; line-height: 1.5; color: #4b5563; text-align: left; word-break: break-all; }
.content h2 { margin: 24px 0 10px 0; padding: 0 0 8px 0; font-size: 16px; font-weight: 700; letter-spacing: 0; text-transform: none; color: #0f172a; border-bottom: 1px solid #e5e7eb; }
.content-digest h2 { margin: 24px 0 10px 0; padding: 0 0 8px 0; font-size: 16px; font-weight: 700; letter-spacing: 0; text-transform: none; color: #0f172a; border-bottom: 1px solid #e5e7eb; }
.content-receipt h2 { margin: 24px 0 10px 0; padding: 0 0 8px 0; font-size: 16px; font-weight: 700; letter-spacing: 0; text-transform: none; color: #0f172a; border-bottom: 1px solid #e5e7eb; }
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
.content-digest { background-color: #ffffff; border: none; border-radius: 0 0 12px 12px; padding: 22px 24px 24px 24px; }
.content-receipt { background-color: #ffffff; border: none; border-radius: 0 0 12px 12px; padding: 22px 14px 24px 14px; }
.content { background-color: #ffffff; border: none; border-radius: 0 0 12px 12px; padding: 22px 24px 24px 24px; }
.button { display: inline-block; padding: 14px 36px; background-color: #b91c1c; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: 600; line-height: 1.2; }
.fineprint { margin: 14px 0 0 0; font-size: 13px; line-height: 1.6; color: #64748b; }
"""
    + _callout_css()
    + """.footer p { margin: 0 0 6px 0; font-size: 12px; line-height: 1.6; color: #4b5563; }
.footer { padding: 18px 8px 4px 8px; text-align: center; font-size: 12px; line-height: 1.6; color: #4b5563; }
.muted { font-size: 11px; line-height: 1.6; color: #4b5563; }
"""
)

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

# The summary card's tint, per accent. A notice names its category once and
# :func:`build_shell` writes both halves of the pair; before this map the
# bodies each carried the tint as a literal, which is how a header and its
# chip drifted onto two different reds the first time an accent was
# corrected. (Named for the pill the tint first sat under; the column and the
# ``{{chip_tint}}`` token keep the name so stored bodies keep rendering.)
CHIP_TINTS = {
    ACCENT_RED: "#fef2f2",
    ACCENT_AMBER: "#fffbeb",
    ACCENT_GREEN: "#f0fdf4",
    ACCENT_BLUE: "#eff6ff",
    ACCENT_INDIGO: "#eef2ff",
    ACCENT_VIOLET: "#faf5ff",
    ACCENT_SLATE: "#f1f5f9",
}

# Dark mode, per accent: the deep version of each tint, and the 300-weight
# version of the accent for text that sits on it. White on the tab is
# unchanged in the dark, because it already clears AA on every accent.
DARK_TINTS = {
    ACCENT_RED: "#361a1c",
    ACCENT_AMBER: "#2b2414",
    ACCENT_GREEN: "#142a22",
    ACCENT_BLUE: "#18223d",
    ACCENT_INDIGO: "#1f1d3d",
    ACCENT_VIOLET: "#27193b",
    ACCENT_SLATE: "#232830",
}
ACCENTS_ON_DARK = {
    ACCENT_RED: "#fca5a5",
    ACCENT_AMBER: "#f5b454",
    ACCENT_GREEN: "#6ee7b7",
    ACCENT_BLUE: "#93b4ff",
    ACCENT_INDIGO: "#a5b4fc",
    ACCENT_VIOLET: "#c4b5fd",
    ACCENT_SLATE: "#cbd5e1",
}

# The dark palette's neutrals: page, card, rule, heading, body, label.
_DARK_PAGE = "#121417"
_DARK_CARD = "#1c1f24"
_DARK_RULE = "#2a2e35"
_DARK_HEADING = "#f3f4f6"
_DARK_BODY = "#c3c8d0"
_DARK_LABEL = "#9aa3af"


def _dark_css() -> str:
    """The ``prefers-color-scheme: dark`` rendering, as a stylesheet of its own.

    This is **not** part of ``DEFAULT_CSS`` and never goes through the
    inliner: an ``@media`` block cannot be written onto a ``style=""``
    attribute, so it is emitted in a second ``<style data-inline="false">``
    that ``inline_email_css`` leaves in place. Clients that honour it (Apple
    Mail on every platform, Outlook.com) render the dark palette; Gmail strips
    it along with every other ``<style>``, which leaves the inlined light
    rendering — the same as before.

    Every declaration is ``!important`` because it has to beat an inline
    style, and the inline styles are the whole of the light rendering.

    Two techniques, for two kinds of markup:

    * **The shell's own blocks are addressed by class.** The inliner keeps
      ``class`` attributes, so ``.summary``, ``.fact-value``, the callouts
      and the rest can each be given their exact dark colours. The summary
      card's tint is set inline from ``{{chip_tint}}``, so its dark version is
      picked by matching that value inside the style attribute — one rule
      per accent, generated from :data:`DARK_TINTS`.
    * **Everything else inside the body card is flattened.** Services inject
      fragments with their own inline colours and no classes (a pink
      property-return panel, grey table-header rows, an accent-filled
      banner). Forcing light text onto those while leaving their light
      backgrounds in place would make them unreadable, and there is no way
      to enumerate them. So an unclassed element inside the card loses its
      background and takes the dark body colour: the colour coding of those
      islands is lost in the dark, and every word of them stays legible.
    """
    cards = (".content", ".content-digest", ".content-receipt")

    def each(suffix: str) -> str:
        return ", ".join(f"{card} {suffix}" for card in cards)

    rules = [
        ":root { color-scheme: light dark; supported-color-schemes: light dark; }",
        f"body, .container {{ background-color: {_DARK_PAGE} !important; }}",
        f".masthead p {{ color: {_DARK_HEADING} !important; }}",
        f".content, .content-digest, .content-receipt, .header "
        f"{{ background-color: {_DARK_CARD} !important; }}",
        # Flatten the unclassed islands first, so the classed rules below win.
        f"{each('[style*=background]:not([class])')} "
        "{ background-color: transparent !important; background-image: none !important; }",
        f"{each(':not([class])')} {{ color: {_DARK_BODY} !important; "
        f"border-color: {_DARK_RULE} !important; }}",
        f"{each('h1:not([class])')}, {each('h2:not([class])')}, "
        f"{each('h3:not([class])')}, {each('strong:not([class])')}, "
        f"{each('b:not([class])')}, {each('td:not([class])')} "
        f"{{ color: {_DARK_HEADING} !important; }}",
        f"{each('th:not([class])')} {{ background-color: #23272e !important; "
        f"color: {_DARK_LABEL} !important; }}",
        f"{each('a:not([class])')} {{ color: {ACCENTS_ON_DARK[ACCENT_BLUE]} !important; }}",
        f".summary h1, .header h1 {{ color: {_DARK_HEADING} !important; }}",
        f".summary p, .header p {{ color: {_DARK_BODY} !important; }}",
        f".fact-label, .summary-fact-label {{ color: {_DARK_LABEL} !important; }}",
        f".fact-value, .fact-mono, .summary-fact-value "
        f"{{ color: {_DARK_HEADING} !important; }}",
        f".facts-panel, .details {{ background-color: {_DARK_PAGE} !important; }}",
        f".details p, .details td {{ color: {_DARK_HEADING} !important; }}",
        f".details th {{ color: {_DARK_LABEL} !important; background-color: transparent !important; }}",
        f".summary-fact {{ background-color: {_DARK_CARD} !important; }}",
        f".tile-date {{ background-color: {_DARK_CARD} !important; "
        f"border-color: {_DARK_RULE} !important; }}",
        f".tile-date-day {{ color: {_DARK_HEADING} !important; }}",
        f".alert {{ background-color: {DARK_TINTS[ACCENT_AMBER]} !important; }}",
        f".alert p {{ color: {_DARK_HEADING} !important; }}",
        f".action-link, .fineprint, .footer p, .footer, .muted "
        f"{{ color: {_DARK_LABEL} !important; }}",
        f".footer a {{ color: {_DARK_LABEL} !important; }}",
    ]
    for accent, tint in CHIP_TINTS.items():
        rules.append(
            f'.summary[style*="{tint}"] '
            f"{{ background-color: {DARK_TINTS[accent]} !important; }}"
        )
        # Anchored to the end of the attribute (``$=``), not a substring:
        # the inliner merges ``.summary p`` in front, and its colour is
        # slate's hex, so a substring match would paint every value slate.
        # The element's own inline colour is always what the attribute ends
        # with, because the inliner puts class styles first.
        rules.append(
            f'.summary-fact-value[style$="color: {accent};"] '
            f"{{ color: {ACCENTS_ON_DARK[accent]} !important; }}"
        )
    for kind, (_surface, _title, _text, dark, dark_title) in CALLOUT_KINDS.items():
        rules.append(f".callout-{kind} {{ background-color: {dark} !important; ")
        rules[-1] += (
            f"border-color: {_DARK_RULE} !important; }}" if kind == "neutral" else "}"
        )
        rules.append(f".callout-title-{kind} {{ color: {dark_title} !important; }}")
        rules.append(f".callout-text-{kind} {{ color: #e5e7eb !important; }}")
    return "@media (prefers-color-scheme: dark) {\n" + "\n".join(rules) + "\n}"


DARK_CSS = _dark_css()

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
    height would stretch it. Classic Outlook ignores CSS sizing on images
    altogether and would show the file at its natural size, so the ``width``
    attribute is set as well: Outlook reads it, and every other client lets
    the inline ``width:auto`` override it. Data URIs are skipped, as in
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
        '<img src="' + safe_url + '" alt="' + safe_name + '" width="48" '
        'style="display:block;max-width:48px;max-height:48px;width:auto;'
        'height:auto;border:0;" /></td></tr></table>'
    )


def fact(label: str, value: str, mono: bool = False) -> tuple:
    """One label/value pair for :func:`facts` or :func:`summary_facts`.

    *mono* sets the value in a fixed-width face, for values a member has to
    type back exactly — a username or a temporary password, where ``l``/``1``
    and ``O``/``0`` must be told apart.
    """
    return (label, value, mono)


def facts(rows: list, panel: bool = False) -> str:
    """The key facts: labels above values, one or two facts per row.

    *rows* is a list of rows, each a list of one or two :func:`fact` pairs.
    Which facts share a row is the caller's decision, per template, rather
    than something worked out here: only the author knows that "Start" and
    "End" are short and belong together, and that "Reason" is free text a
    department types and can run to a paragraph. A lone fact spans the row.

    The facts sit directly on the body card, separated by spacing alone.
    *panel* puts them on a grey panel instead — for credentials, which are
    the one set of facts a member copies out of the email rather than reads,
    and which the panel sets apart from the prose around them.

    Returned as literal markup, so the stored body carries exactly what an
    admin will see and can edit in the template editor — there is no macro
    for the editor to expand.
    """
    table_class, cell_class = (
        ("facts-panel", "fact-boxed") if panel else ("facts", "fact")
    )
    lines = [
        f'        <table class="{table_class}" role="presentation" cellpadding="0" '
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
                f'<td class="{cell_class}"{span}><p class="fact-label">{label}</p>'
                f'<p class="{value_class}">{value}</p></td>'
            )
        lines.append("            <tr>" + "".join(cells) + "</tr>")
    lines.append("        </table>")
    return "\n".join(lines) + "\n"


def summary_facts(pairs: list, emphasis: int = -1) -> str:
    """One or two facts in white boxes on the tinted summary card.

    For the figure a notice is about — a return deadline and the value at
    stake, an amount due and the date it is due — lifted out of the body so
    it is read before anything else. *emphasis* is the index of the one value
    set in the accent (the deadline, never the amount), or ``-1`` for none.

    The gap between the boxes is a cell of its own because Outlook's Word
    engine ignores ``border-spacing``.
    """
    if not 1 <= len(pairs) <= 2:
        raise ValueError("a summary holds one or two facts")
    cells = []
    for index, (label, value, _mono) in enumerate(pairs):
        if index:
            cells.append('<td class="summary-gap">&nbsp;</td>')
        colour = ' style="color: {accent};"' if index == emphasis else ""
        width = ' width="50%"' if len(pairs) == 2 else ""
        cells.append(
            f'<td class="summary-fact"{width}><p class="summary-fact-label">{label}</p>'
            f'<p class="summary-fact-value"{colour}>{value}</p></td>'
        )
    return (
        '        <table class="summary-facts" role="presentation" cellpadding="0" '
        'cellspacing="0"><tr>' + "".join(cells) + "</tr></table>"
    )


def countdown_tile(value: str, unit: str) -> str:
    """The accent-filled tile that leads a summary with a number: ``12 DAYS``.

    For a notice whose point is how long is left — an expiring
    certification. The accent is the fill, so a department that recolours
    the notice recolours the tile with it.
    """
    return (
        '<table class="tile-count" role="presentation" cellpadding="0" '
        'cellspacing="0" style="background-color: {accent};">'
        f'<tr><td class="tile-count-num">{value}</td></tr>'
        f'<tr><td class="tile-count-unit">{unit}</td></tr></table>'
    )


def date_tile(month: str, day: str) -> str:
    """The calendar-page tile: an accent strip with the month over the day.

    Takes the month and the day separately, because a sender passes each
    date to a template as one pre-formatted string and there is nothing to
    split reliably across locales. No shipped template uses it yet: it is here
    for the first template whose sender supplies the two parts.
    """
    return (
        '<table class="tile-date" role="presentation" cellpadding="0" '
        'cellspacing="0">'
        f'<tr><td class="tile-date-month" style="background-color: {{accent}};">{month}</td></tr>'
        f'<tr><td class="tile-date-day">{day}</td></tr></table>'
    )


def callout(kind: str, title: str, text: str) -> str:
    """A tinted card stacked under the body card: a heading and one line.

    For the thing a member must not miss, set apart from the notice itself —
    "change your password", "don't forward this link", "didn't ask for
    this?". *kind* is one of :data:`CALLOUT_KINDS` and says what sort of
    message it is; the colour does not follow the notice's accent, because
    a warning is amber on an election notice too.

    Pass the result to :func:`build_shell` as *after*, not inside the body:
    the design stacks callouts as separate cards below it.
    """
    if kind not in CALLOUT_KINDS:
        raise ValueError(
            f"unknown callout kind {kind!r}; expected one of {sorted(CALLOUT_KINDS)}"
        )
    return (
        f'    <div class="callout-{kind}">'
        f'<p class="callout-title-{kind}">{title}</p>'
        f'<p class="callout-text-{kind}">{text}</p></div>'
    )


def action(url: str, label: str) -> str:
    """The full-width button and, under it, the same link as plain text.

    The plain link is not decoration: a client that strips styling, a
    screen reader user skipping between links, and a member reading on a
    device where the button will not open all need the address itself.

    *url* is a template variable name, written as ``{{name}}`` by the
    caller. ``{accent}`` is left for :func:`build_shell` to turn into the
    colourway token.

    The button is a table cell filled with the accent, holding a block link
    — the arrangement every client, classic Outlook included, renders as a
    button. ``bgcolor`` is for Outlook, which ignores a CSS background on a
    cell in some versions. The link carries a border in its own colour
    because Outlook's Word engine ignores padding on an ``<a>`` without one,
    which would shrink the tap target to the height of the label.
    """
    return (
        '        <table class="cta" role="presentation" cellpadding="0" '
        'cellspacing="0"><tr>'
        '<td class="cta-cell" bgcolor="{accent}" style="background-color: {accent};">'
        f'<a href="{url}" class="cta-link" '
        'style="border: 1px solid {accent};">'
        f"{label}</a></td></tr></table>\n"
        f'        <p class="action-link">Or open this link: {url}</p>\n'
    )


_FACT_VALUE = re.compile(
    r'<p class="(?:summary-)?fact-(?:value|mono)"[^>]*>(.*?)</p>', re.S
)
_FACT_ROW = re.compile(r"<tr>(.*?)</tr>", re.S)
_FACT_TABLE = re.compile(r'class="(?:facts|facts-panel|summary-facts)"')

# The conventional filler after preview text: characters clients render as
# nothing but count toward the preview, so it is not topped up with the start
# of the body. &#847;&zwnj;&nbsp; is Litmus's published sequence; &#8199;&shy;
# was added after iOS 16.4 and Yahoo stopped counting the first three.
_PREHEADER_FILLER = "&#847;&zwnj;&nbsp;&#8199;&shy;" * 30


def _first_fact_row(content: str) -> str:
    """The values in the first row of facts, joined, with markup removed.

    The first row is where each template puts the fact a member opens the
    email for (the start time, the expiry date, the return deadline), so it
    doubles as the inbox preview without every template restating it. The
    summary card's facts come first when there are any, because that is
    where a template lifts the one it most wants read.
    """
    panel = _FACT_TABLE.search(content)
    if not panel:
        return ""
    row = _FACT_ROW.search(content, panel.start())
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
    tab_note: str = "",
    lead: str = "",
    summary: str = "",
    after: str = "",
) -> str:
    """Build the chrome every notice renders into.

    Top to bottom: the masthead (the department's logo on a white plate
    above its name), a solid tab in the notice's accent naming its category
    on the left and one piece of urgency on the right, a card tinted with
    the accent holding the title, then the white body card, any callout
    cards stacked beneath it, and the centred footer. Only the body and the
    stacked cards change from notice to notice; everything above them is the
    same shell, so a member learns to read the category and the urgency
    before the words.

    One function, because there is no import path between the two modules
    that need it: ``email_template_service`` owns the platform's copy and
    ``email_templates_storefront`` owns the store's, and the storefront
    cannot import the service because the service imports *it*. Before this
    existed the two files each carried their own copy of the layout, and the
    store's mail drifted a header at a time.

    *accent* drives every accented element; the tint is looked up in
    :data:`CHIP_TINTS` rather than passed, so the two halves of a colourway
    cannot disagree.

    *chip* is the category the tab names. The tab is drawn whatever it
    holds: with the chip cleared it is a plain accent band, which still
    carries the colour. *tab_note* is the right-hand side — a deadline or a
    time limit, written with the template's own variables (``Due
    {{approval_deadline}}``) — and is left out of the markup when empty.

    *subtitle* is the line under the title. It is HTML-escaped here, unlike
    *title* — every current caller passes *title* as either a trusted literal
    or already escapes it before calling in (``wrap_email_body``), but
    *subtitle* has no such caller-side guarantee, so it is escaped at the one
    place every caller goes through. *tab_note*, like *title*, is written by
    the template author and not escaped.

    *lead* is an optional tile set to the left of the title
    (:func:`countdown_tile`, :func:`date_tile`), and *summary* optional
    :func:`summary_facts` under it — both inside the tinted card. *after* is
    markup stacked under the body card, normally :func:`callout` cards.

    *brand* is the masthead's name line. The store passes ``{{store_name}}``;
    everything else takes the department.

    *preheader* is the line an inbox shows beside the subject. Phones show
    only 30–55 characters of it, so it should lead with the fact the member
    opened the email for. Left empty it defaults to *subtitle* — the line an
    author already chose to put under the title — then to the first row of
    facts (the summary card's, if it has any); with neither, no preheader is
    written. The text is followed by invisible filler so a client that runs
    out of preheader does not continue into the masthead and show the
    department name twice.

    ``{accent}`` inside *content*, *lead*, *summary* and *after* is
    substituted with the accent token, so a body writes
    ``background-color: {accent};`` on its button and cannot disagree with
    its own tab. A single brace is safe to use for this: template variables
    are doubled (``{{name}}``), and the substitution is a plain string
    replace rather than ``str.format``, so a stray brace in prose is left
    alone instead of raising.

    **The accent and the chip text are emitted as template variables, not
    hexes.** Every place the colourway appears becomes ``{{header_accent}}``
    / ``{{chip_tint}}`` / ``{{status_chip}}``, which the renderer fills from
    the template's own ``header_accent`` and ``status_chip`` columns. That is
    what makes a colourway something an officer can change from the screen
    rather than something only a deploy can change — and it keeps one
    canonical stored shape, because a body never carries a hex for the
    renderer and a column to disagree with it.

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

    def tokens(markup: str) -> str:
        return markup.replace("{accent}", "{{header_accent}}")

    content, lead, summary, after = (
        tokens(content),
        tokens(lead),
        tokens(summary),
        tokens(after),
    )

    head = []
    teaser = preheader or _html.escape(subtitle) or _first_fact_row(summary + content)
    if teaser:
        head.append(_preheader(teaser))

    note = f'<td class="tab-note">{tab_note}</td>' if tab_note else ""
    heading = ["            <h1>" + title + "</h1>"]
    if subtitle:
        heading.append("            <p>" + _html.escape(subtitle) + "</p>")
    if lead:
        # The tile and the title side by side. A table, because a floated or
        # inline-block tile collapses under the title in Outlook.
        heading = [
            '        <table class="summary-row" role="presentation" cellpadding="0" '
            'cellspacing="0"><tr>',
            '            <td class="summary-lead">' + lead + "</td>",
            '            <td class="summary-text">',
            *heading,
            "            </td>",
            "        </tr></table>",
        ]
    else:
        heading = [line[4:] for line in heading]

    # Classic Outlook ignores max-width on a div and would stretch the card
    # across the whole reading pane; this table, which only Outlook's Word
    # engine sees, holds it at the 600px every other client gets.
    head += [
        '<!--[if mso]><table role="presentation" align="center" width="600" '
        'cellpadding="0" cellspacing="0"><tr><td><![endif]-->',
        '<div class="container">',
        '    <div class="masthead">',
        "        {{organization_logo_block}}",
        "        <p>" + brand + "</p>",
        "    </div>",
        '    <table class="tab" role="presentation" cellpadding="0" cellspacing="0" '
        'width="100%" bgcolor="{{header_accent}}" '
        'style="background-color: {{header_accent}};"><tr>'
        '<td class="tab-label">{{status_chip}}</td>' + note + "</tr></table>",
        '    <div class="summary" style="background-color: {{chip_tint}};">',
        *heading,
    ]
    if summary:
        head.append(summary.rstrip("\n"))

    shell = "\n".join(
        [
            *head,
            "    </div>",
            '    <div class="{{content_class}}">',
            content.rstrip("\n"),
            "    </div>",
            *([after.rstrip("\n")] if after else []),
            "    {{footer_html}}",
            "</div>",
            "<!--[if mso]></td></tr></table><![endif]-->",
        ]
    )
    if cache:
        _SHELL_COLOURWAYS[shell] = {
            "accent": accent,
            "chip": chip,
            "layout": layout,
        }
    return shell


# ---------------------------------------------------------------------------
# Reading the message back out of a stored body
# ---------------------------------------------------------------------------


def find_element_end(html: str, start: int, tag_name: str) -> int:
    """Return the offset of the ``</tag_name>`` that closes an open element.

    *start* is the offset just past the element's opening tag.  Nested
    elements of the same name are counted so the first ``</div>`` inside a
    ``<div>`` does not end it.  An unbalanced document ends at EOF rather
    than raising — malformed HTML in an admin-edited template must still
    send.
    """
    token = re.compile(rf"<(/?){re.escape(tag_name)}\b[^>]*?(/?)>", re.IGNORECASE)
    depth = 1
    pos = start
    while True:
        match = token.search(html, pos)
        if not match:
            return len(html)
        if match.group(1) == "/":
            depth -= 1
            if depth == 0:
                return match.start()
        elif match.group(2) != "/":
            depth += 1
        pos = match.end()


_BODY_CONTENT = re.compile(
    r"<body\b[^>]*>(.*?)(?:</body\s*>|\Z)", re.IGNORECASE | re.DOTALL
)
_PAGE_ONLY = re.compile(
    r"<!DOCTYPE[^>]*>|<head\b.*?</head\s*>|<style\b.*?</style\s*>|</?html\b[^>]*>",
    re.IGNORECASE | re.DOTALL,
)
_CONTENT_OPEN = re.compile(
    r'<div\b[^>]*\bclass="(?:\{\{content_class\}\}|content(?:-digest|-receipt)?)"[^>]*>'
)
_H1 = re.compile(r"(<h1\b[^>]*>)(.*?)(</h1\s*>)", re.IGNORECASE | re.DOTALL)
_CALLOUT_OPEN = re.compile(r'<div class="callout-[a-z]+">')


def page_content(html: str) -> str:
    """*html* without any page around it.

    A fragment comes back unchanged apart from any ``<style>`` block. A whole
    page (``<html>``, ``<head>``, ``<body>``) comes back as what its
    ``<body>`` held, with the page's own head and stylesheet removed: the
    shell supplies the page, and a second stylesheet would fight the house
    one.
    """
    match = _BODY_CONTENT.search(html)
    if match:
        html = match.group(1)
    return _PAGE_ONLY.sub("", html).strip()


def title_and_message(html: str) -> tuple:
    """The title and the message section of a stored body, whatever it was.

    A body built by any version of the shell carries its message in the
    content card (``class="{{content_class}}"``, or a literal ``content``
    class from before that token existed) and its title in the ``<h1>``
    above it. A body written by hand has neither: all of it is the message,
    minus any page around it. The title is ``""`` when there is none.
    """
    opener = _CONTENT_OPEN.search(html)
    if not opener:
        message = page_content(html)
        return "", message
    end = find_element_end(html, opener.end(), "div")
    heading = _H1.search(html, 0, opener.start())
    title = heading.group(2).strip() if heading else ""
    return title, html[opener.end() : end].strip("\n")


def with_message(shell_html: str, title: str, message: str) -> str:
    """*shell_html* with its title and message replaced.

    For putting a department's own wording back into a body built by the
    current :func:`build_shell`. The callout cards the shipped default stacks
    under the message are dropped: the department's message said what it
    wanted to say, and a default callout beside it would repeat or contradict
    it. The tab, the summary card and the footer are the shell's and stay.
    """
    opener = _CONTENT_OPEN.search(shell_html)
    if not opener:
        raise ValueError("not a body built by build_shell: it has no content card")
    end = find_element_end(shell_html, opener.end(), "div")
    close = shell_html.index(">", end) + 1
    rest = shell_html[close:]
    while True:
        stripped = rest.lstrip()
        callout = _CALLOUT_OPEN.match(stripped)
        if not callout:
            break
        callout_end = find_element_end(stripped, callout.end(), "div")
        rest = stripped[stripped.index(">", callout_end) + 1 :]
        rest = "\n" + rest if not rest.startswith("\n") else rest
    body = (
        shell_html[: opener.end()]
        + "\n"
        + message.strip("\n")
        + "\n    "
        + shell_html[end:close]
        + rest
    )
    if title:
        body = _H1.sub(lambda m: m.group(1) + title + m.group(3), body, count=1)
    return body


def uses_default_stylesheet(css: str) -> bool:
    """Is *css* the built-in stylesheet (or no stylesheet at all)?

    The dark rendering is written against the classes and colours of
    ``DEFAULT_CSS``. A department that wrote its own stylesheet chose its own
    colours, and forcing ours over them in the dark would undo that work — so
    only the built-in sheet gets the dark block.
    """
    return not css or css == DEFAULT_CSS


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
    * ``color-scheme`` — ``light dark`` with the built-in stylesheet, because
      :data:`DARK_CSS` supplies the dark rendering; a client that sees the
      declaration uses our dark colours instead of inverting the light ones.
      ``light only`` with a department's own stylesheet, which has no dark
      rendering: Apple Mail leaves a page that declares it supports light
      only alone rather than auto-inverting it. The ``only`` matters: plain
      ``light`` is a preference, not a refusal. Gmail's apps and classic
      Outlook repaint regardless, which the logo plate is for.
    * The dark block is its own ``<style data-inline="false">`` because the
      inliner removes the stylesheet it inlines; that attribute is what tells
      it to leave this one in the document.
    * The ``mso`` block pins Outlook's DPI, which otherwise scales the card up
      by 25% on high-DPI Windows. It is Office XML, so it only takes effect
      with the ``o:`` and ``v:`` namespaces declared on ``<html>``.
    """
    safe_subject = _html.escape(subject)
    safe_subject_attr = _html.escape(subject, quote=True)
    dark = uses_default_stylesheet(css)
    scheme = "light dark" if dark else "light only"
    dark_block = f'<style data-inline="false">\n{DARK_CSS}\n</style>\n' if dark else ""
    return f"""<!DOCTYPE html>
<html lang="en" dir="ltr" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="{scheme}" />
<meta name="supported-color-schemes" content="{scheme}" />
<title>{safe_subject}</title>
<style>
{css or DEFAULT_CSS}
</style>
{dark_block}<!--[if mso]>
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
