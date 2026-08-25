"""Every configurable setting must have something that reads it.

This is the defect class this repo keeps producing. Pitfall #19 in CLAUDE.md
was written from the `notification_rules` incident — a chief could create
"Event reminders", see it listed as *Active*, toggle it off, and the reminders
kept going out, because nothing ever read the table. The rule it added is:
do not ship a setting whose only effect is being stored.

It happened again anyway. A 2026-08-24 review of the outreach request pipeline
found four more in one module: `min_lead_time_days` had a slider and gated
nothing, the `days_before_event` trigger shipped enabled with no sender, and
the email templates' `trigger` / `trigger_days_before` columns had a create
form and no scheduler. Documentation alone did not stop it; this is the check
that does.

**How a "reader" is recognised.** A key counts as read if its name appears —
quoted, or as a property access — anywhere under `backend/app` or
`frontend/src`, outside the module that defines the defaults and outside the
files that merely *declare* the shape. That last exclusion is the point:
`schemas/event.py` says which keys an admin may write and `types/event.ts`
says what the payload looks like, and neither is a consumer. Counting them is
what let `enabled_event_types` look wired while nothing consulted it.

The check is textual and therefore blunt in both directions, which is why the
exceptions below are enumerated with reasons rather than pattern-matched.
"""

import functools
import os
import re
from pathlib import Path

from app.api.v1.endpoints.events import EVENT_SETTINGS_DEFAULTS

_REPO = Path(__file__).resolve().parents[2]

# Files that describe the settings rather than consume them. A field in a
# Pydantic update schema or a TypeScript interface is a declaration; treating
# it as a reader is how a setting nothing consults looks wired.
_DECLARATION_ONLY = {
    _REPO / "backend" / "app" / "schemas" / "event.py",
    _REPO / "frontend" / "src" / "types" / "event.ts",
}

# Keys with no textual reader, each with the reason it is allowed to stay that
# way. Anything NOT in here that loses its reader fails the test; anything in
# here that GAINS one also fails, so the list cannot quietly rot.
_KNOWN_UNWIRED = {
    # Sent by `f"on_{new_status.value}"` in update_event_request_status, so the
    # literal never appears in the source. tests/test_event_request_pipeline_
    # review.py::test_every_trigger_the_code_sends_is_configurable proves these
    # three are genuinely reachable.
    "request_pipeline.email_triggers.on_in_progress": "sent via f-string",
    "request_pipeline.email_triggers.on_completed": "sent via f-string",
    "request_pipeline.email_triggers.on_declined": "sent via f-string",
    # Writable through EventSettingsUpdate and consulted by nothing. Reported
    # 2026-08-25; left as-is deliberately rather than widening that change.
    # Fixing means either wiring them or removing them from the update schema.
    "enabled_event_types": "UNWIRED: admin can save it; nothing reads it",
    "event_type_labels": "UNWIRED: admin can save it; nothing reads it",
    # Served in the settings response and typed on the client, but absent from
    # EventSettingsUpdate, so nobody can change them and no switch lies. Dead
    # defaults rather than an inert control.
    "qr_code.show_event_description": "dead default: not writable, not read",
    "qr_code.show_location_details": "dead default: not writable, not read",
    "cancellation": "dead default: not writable, not read",
    "cancellation.require_reason": "dead default: not writable, not read",
    "cancellation.notify_attendees": "dead default: not writable, not read",
}


@functools.lru_cache(maxsize=1)
def _corpus() -> str:
    texts = []
    for base, exts in (
        (_REPO / "backend" / "app", (".py",)),
        (_REPO / "frontend" / "src", (".ts", ".tsx")),
    ):
        for root, _dirs, files in os.walk(base):
            if "node_modules" in root:
                continue
            for name in files:
                if not name.endswith(exts):
                    continue
                path = Path(root) / name
                if path in _DECLARATION_ONLY:
                    continue
                texts.append(path.read_text(encoding="utf-8", errors="ignore"))
    return "\n".join(texts)


def _walk(node: dict, prefix: str = "") -> list[tuple[str, str]]:
    rows = []
    for key, value in node.items():
        rows.append((prefix + key, key))
        if isinstance(value, dict):
            rows.extend(_walk(value, prefix + key + "."))
    return rows


@functools.lru_cache(maxsize=1)
def _name_counts() -> dict:
    """Every quoted string and property access in the corpus, counted.

    One tokenizing pass rather than one regex sweep per settings key: at 69
    keys over a corpus this size the per-key form took 26 seconds, which is
    not a price a unit test should charge.
    """
    from collections import Counter

    counts: Counter = Counter()
    counts.update(re.findall(r"[\"']([A-Za-z_][A-Za-z0-9_]*)[\"']", _corpus()))
    counts.update(re.findall(r"\.([A-Za-z_][A-Za-z0-9_]*)\b", _corpus()))
    return counts


@functools.lru_cache(maxsize=1)
def _defaults_leaf_occurrences() -> dict:
    """How many times each leaf name appears in the defaults literal itself.

    Not always one. Ten triggers each carry an ``enabled``, nine carry a
    ``notify_requester``. Subtracting a flat 1 therefore compared a leaf that
    appears ten times against a threshold of one, so those twenty-one keys
    passed whether or not anything read them — a hole precisely where the
    email-trigger switches this suite exists to watch live.
    """
    from collections import Counter

    return Counter(leaf for _, leaf in _walk(EVENT_SETTINGS_DEFAULTS))


@functools.lru_cache(maxsize=1)
def _unread_keys() -> frozenset[str]:
    counts = _name_counts()
    in_defaults = _defaults_leaf_occurrences()
    # A reader is an occurrence beyond the ones the defaults literal itself
    # contributes.
    return frozenset(
        path
        for path, key in _walk(EVENT_SETTINGS_DEFAULTS)
        if counts[key] <= in_defaults[key]
    )


# Leaf names shared by more than one settings path. For these the check proves
# a reader exists for the *shape* — `trigger_config.get("notify_requester")`
# serves all nine triggers — but cannot prove any individual path is consumed.
# That is the right granularity here, because one generic reader is genuinely
# what reads them; what it does not cover is a new section reusing a name that
# already occurs. The set is pinned so adding such a name is a decision
# somebody makes on purpose rather than a silent free pass.
_AMBIGUOUS_LEAVES = {
    "enabled": "one per email trigger; read by send_request_notification",
    "notify_assignee": "read generically by send_request_notification",
    "notify_requester": "read generically by send_request_notification",
}


def test_ambiguous_leaf_names_are_declared():
    """A new duplicated leaf name has to be looked at, not just absorbed.

    Without this, adding `some_section.enabled` to the defaults would pass the
    reader check on the strength of an unrelated `enabled` elsewhere.
    """
    duplicated = {
        leaf for leaf, count in _defaults_leaf_occurrences().items() if count > 1
    }
    undeclared = sorted(duplicated - set(_AMBIGUOUS_LEAVES))

    assert undeclared == [], (
        "Settings key(s) whose leaf name is now shared by more than one path. "
        "The reader check cannot tell those paths apart, so confirm a reader "
        "really covers each and add the name to _AMBIGUOUS_LEAVES with the "
        "reader that serves it:\n" + "\n".join(f"  {leaf}" for leaf in undeclared)
    )


def test_the_ambiguous_list_does_not_rot():
    stale = sorted(
        leaf
        for leaf in _AMBIGUOUS_LEAVES
        if _defaults_leaf_occurrences().get(leaf, 0) <= 1
    )

    assert stale == [], (
        "These names are declared ambiguous but no longer appear more than "
        "once in the defaults. Remove them:\n" + "\n".join(f"  {s}" for s in stale)
    )


def test_no_new_setting_ships_without_a_reader():
    unread = _unread_keys()
    new = sorted(unread - set(_KNOWN_UNWIRED))

    assert new == [], (
        "Event settings key(s) that nothing reads — a switch wired to nothing "
        "(CLAUDE.md pitfall #19). Wire a reader in the same change, or add the "
        "key to _KNOWN_UNWIRED with the reason it is allowed to stay:\n"
        + "\n".join(f"  {k}" for k in new)
    )


def test_the_exception_list_does_not_rot():
    """A key that gains a reader must leave the list.

    Otherwise the exceptions accumulate until the check means nothing — which
    is exactly how the warning tier of other gates in this repo went stale.
    """
    unread = _unread_keys()
    now_wired = sorted(set(_KNOWN_UNWIRED) - unread)

    assert now_wired == [], (
        "These keys are listed in _KNOWN_UNWIRED but now have a reader. "
        "Remove them from the list:\n" + "\n".join(f"  {k}" for k in now_wired)
    )


def test_the_reader_search_actually_finds_readers():
    """Guard the guard: if the search broke, everything looks unread."""
    unread = _unread_keys()
    total = len(_walk(EVENT_SETTINGS_DEFAULTS))

    assert len(unread) < total / 2, (
        f"{len(unread)} of {total} keys look unread — the reader search is "
        f"probably broken rather than the settings all being dead."
    )
