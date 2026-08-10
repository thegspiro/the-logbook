"""
Email Footers — the closing block, as a small library a department edits once.

Before this, every default template carried its own copy of the footer: 32
copies of "This is an automated message from …" and 25 of the contact line.
Changing the wording meant opening 35 templates one at a time, and once a
template had been edited by hand the only way back was Reset, which throws
away the rest of that template's edits too.

A footer is a *named* block rather than a single global one, because a
department does not want to say the same thing to everybody. The notice that
goes to a member of the public who asked the station to visit their school
should not read "Please do not reply to this email" — they may well need to
reply — and it is the one that most wants a mailing address on it. The notice
that goes to a member being dropped wants to say it is an official record.
So the department keeps a handful of footers and each template names the one
it uses; ``footer_key`` on ``email_templates`` holds that choice, and NULL
means "whichever footer is marked default".

**Why this lives in ``Organization.settings``** rather than a table of its
own: rendering is synchronous and already receives the organization, so a
settings blob needs no extra query on any send path. That is the same reason
the officer directory is stored there — see ``OfficerService`` — and the same
shape other admin-managed lists in this codebase use (outreach event types,
the request pipeline).

**Why the lines are rendered here** rather than left as ``{{variables}}`` in
the footer text: template rendering is a single ``re.sub`` pass, so anything
substituted *in* is not re-scanned. A ``{{organization_name}}`` sitting inside
an already-substituted ``{{footer_html}}`` would mail as those literal
braces. The footer is therefore resolved against the same context, one step
before it is handed to the template.
"""

import copy
import html as _html
import re
from typing import Any, Dict, List, Optional

# Key under ``Organization.settings`` holding the footer library.
ORG_SETTINGS_FOOTER_KEY = "email_footers"

# A footer's own text may use any variable the renderer offers, but only the
# organization-wide ones make sense in a block shared across notices — a
# footer cannot know the recipient's name. Restricting the set is also what
# stops a hand-edited settings blob from reaching into a template's own
# variables.
FOOTER_VARIABLE_NAMES: frozenset = frozenset(
    {
        "organization_name",
        "organization_phone",
        "organization_email",
        "organization_website",
        "organization_mailing_address",
        "organization_physical_address",
        "login_url",
    }
)

_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")

# Seeded on first use. Three footers rather than one because the three
# audiences genuinely differ; a department that wants a single footer can
# delete the two it does not use.
DEFAULT_FOOTERS: List[Dict[str, Any]] = [
    {
        "key": "internal",
        "name": "Internal — members",
        "description": "Routine automated mail to members. The default.",
        "lines": [
            "This is an automated message from {{organization_name}}.",
            "Please do not reply to this email.",
        ],
        "show_contact": True,
        "show_mailing_address": False,
    },
    {
        "key": "public",
        "name": "Public — outside the department",
        "description": (
            "Mail to people who are not members: event requesters, applicants. "
            "Invites a reply and carries the mailing address."
        ),
        "lines": [
            "Sent by {{organization_name}}.",
            "Replies to this message reach the department office.",
        ],
        "show_contact": True,
        "show_mailing_address": True,
    },
    {
        "key": "official",
        "name": "Official notice — on the record",
        "description": (
            "Notices that form part of a member's record: separations, "
            "property return, election results."
        ),
        "lines": [
            "This is an official department notice from {{organization_name}}.",
            "Please retain this notice for your records.",
        ],
        "show_contact": True,
        "show_mailing_address": True,
    },
]

DEFAULT_FOOTER_KEY = "internal"


def default_library() -> Dict[str, Any]:
    """A fresh copy of the seeded library."""
    return {
        "default_key": DEFAULT_FOOTER_KEY,
        "footers": copy.deepcopy(DEFAULT_FOOTERS),
    }


def read_library(organization: Optional[Any]) -> Dict[str, Any]:
    """Return an organization's footer library, seeded if it has none.

    Never raises on a malformed blob: a department must keep receiving mail
    even if its settings were hand-edited into nonsense, so anything
    unreadable falls back to the seeded library.
    """
    settings = getattr(organization, "settings", None) or {}
    if not isinstance(settings, dict):
        return default_library()
    stored = settings.get(ORG_SETTINGS_FOOTER_KEY)
    if not isinstance(stored, dict):
        return default_library()

    footers = [f for f in stored.get("footers", []) if _is_valid(f)]
    if not footers:
        return default_library()

    keys = {f["key"] for f in footers}
    default_key = stored.get("default_key")
    if default_key not in keys:
        default_key = footers[0]["key"]
    return {"default_key": default_key, "footers": footers}


def _is_valid(footer: Any) -> bool:
    return (
        isinstance(footer, dict)
        and isinstance(footer.get("key"), str)
        and bool(_KEY_RE.match(footer["key"]))
        and isinstance(footer.get("name"), str)
        and isinstance(footer.get("lines"), list)
        and all(isinstance(line, str) for line in footer["lines"])
    )


def resolve(
    organization: Optional[Any], footer_key: Optional[str] = None
) -> Dict[str, Any]:
    """Pick the footer a template asked for, or the department's default.

    An unknown key resolves to the default rather than to nothing: a footer
    deleted while templates still name it should cost those templates their
    choice, not their footer.
    """
    library = read_library(organization)
    by_key = {f["key"]: f for f in library["footers"]}
    if footer_key and footer_key in by_key:
        return by_key[footer_key]
    return by_key.get(library["default_key"], library["footers"][0])


def render_html(footer: Dict[str, Any], context: Dict[str, Any]) -> str:
    """Build the ``<div class="footer">`` block for a resolved footer.

    Line text is admin-entered, so it is escaped before its variables are
    substituted — and the substituted values are escaped too. Nothing an
    admin can type into a footer becomes markup.
    """
    parts: List[str] = [
        f"<p>{_substitute(line, context, escape=True)}</p>"
        for line in footer.get("lines", [])
        if line.strip()
    ]

    if footer.get("show_mailing_address"):
        address = str(context.get("organization_mailing_address", "") or "").strip()
        if address:
            parts.append(
                '<p class="muted">'
                + "<br />".join(_html.escape(line) for line in address.splitlines())
                + "</p>"
            )

    if footer.get("show_contact", True):
        contact = " | ".join(
            _html.escape(str(context.get(name, "") or "").strip())
            for name in (
                "organization_phone",
                "organization_email",
                "organization_website",
            )
            if str(context.get(name, "") or "").strip()
        )
        if contact:
            parts.append(f'<p class="muted">{contact}</p>')

    if not parts:
        return ""
    return '<div class="footer">' + "".join(parts) + "</div>"


def render_text(footer: Dict[str, Any], context: Dict[str, Any]) -> str:
    """Build the plain-text footer, opened by the usual ``---`` rule."""
    lines: List[str] = [
        _substitute(line, context, escape=False)
        for line in footer.get("lines", [])
        if line.strip()
    ]

    if footer.get("show_mailing_address"):
        address = str(context.get("organization_mailing_address", "") or "").strip()
        if address:
            lines.extend(address.splitlines())

    if footer.get("show_contact", True):
        contact = " | ".join(
            str(context.get(name, "") or "").strip()
            for name in (
                "organization_phone",
                "organization_email",
                "organization_website",
            )
            if str(context.get(name, "") or "").strip()
        )
        if contact:
            lines.append(contact)

    if not lines:
        return ""
    return "---\n" + "\n".join(lines)


def _substitute(text: str, context: Dict[str, Any], escape: bool) -> str:
    """Replace the organization variables a footer is allowed to use.

    Unknown or disallowed names are left alone rather than blanked, so a typo
    is visible to whoever wrote it instead of silently deleting a line's
    subject.
    """
    source = _html.escape(text) if escape else text

    def replacer(match: "re.Match") -> str:
        name = match.group(1).strip()
        if name not in FOOTER_VARIABLE_NAMES or name not in context:
            return match.group(0)
        value = str(context[name] or "")
        return _html.escape(value) if escape else value

    return re.sub(r"\{\{(\s*\w+\s*)\}\}", replacer, source)
