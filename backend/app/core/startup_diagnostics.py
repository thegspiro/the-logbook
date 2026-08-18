"""Diagnostics for configuration that blocks startup.

A setting that never reached the process is indistinguishable, once pydantic
has applied defaults, from one an operator deliberately set to the default
value. That ambiguity is what makes a dropped variable so expensive: the boot
log reports the *effective* value and says nothing about where it came from,
so an operator editing a .env file sees their change have no effect and no
explanation why.

The information is not actually lost — ``os.environ`` still knows whether a
name arrived. These helpers surface it, so a blocked startup names the cause
("this value is not reaching the process") instead of only the symptom.

The motivating case: a Docker Compose ``environment:`` block is a whitelist,
and a variable missing from it cannot be set from .env at all. Nothing in
Compose or the application reports the drop.
"""

import os
import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover - typing only
    from app.core.config import Settings

# Substrings marking a setting whose value must never be written to a log.
# Presence is still reported; only the value is withheld.
_SECRET_MARKERS = ("KEY", "PASSWORD", "SALT", "SECRET", "TOKEN", "DSN")

_BLOCKING_ENVIRONMENTS = ("production", "staging")


def _is_secret(name: str) -> bool:
    return any(marker in name for marker in _SECRET_MARKERS)


def settings_named_in(message: str, settings: "Settings") -> list[str]:
    """Return the setting names a warning message refers to.

    Derived from the model's own fields rather than a hand-kept list, so a
    newly added check that names its setting is reported without anyone
    remembering to register it here. Word-boundary matching keeps DB_SSL from
    swallowing DB_SSL_CA.
    """
    return [
        name
        for name in type(settings).model_fields
        if re.search(rf"\b{re.escape(name)}\b", message)
    ]


def would_block_startup(criticals: list[str], settings: "Settings") -> bool:
    """Whether these criticals stop this deployment from booting.

    Mirrors main.validate_security_configuration so the preflight check cannot
    disagree with the real gate; a test asserts the two stay in step.
    """
    if not criticals:
        return False
    return (
        settings.ENVIRONMENT in _BLOCKING_ENVIRONMENTS
        or settings.SECURITY_BLOCK_INSECURE_DEFAULTS
    )


def env_presence_report(criticals: list[str], settings: "Settings") -> list[str]:
    """Report whether each setting behind a blocking critical actually arrived.

    Returns log-ready lines, or an empty list when there is nothing to report.
    """
    names: list[str] = []
    for message in criticals:
        for name in settings_named_in(message, settings):
            if name not in names:
                names.append(name)
    if not names:
        return []

    lines = ["CONFIGURATION SOURCE CHECK — did these values reach this process?"]
    missing: list[str] = []
    for name in sorted(names):
        if name in os.environ:
            if _is_secret(name):
                shown = "(value hidden)"
            else:
                shown = repr(os.environ[name])
            lines.append(f"  {name:<32} set in environment  {shown}")
        else:
            missing.append(name)
            default = type(settings).model_fields[name].default
            lines.append(
                f"  {name:<32} NOT PRESENT — using built-in default {default!r}"
            )

    if missing:
        lines.append("")
        lines.append(
            f"{len(missing)} blocking setting(s) are absent from this process's "
            "environment. If you set them in a .env file, the value is NOT "
            "reaching the container."
        )
        lines.append(
            "A Docker Compose `environment:` block is a whitelist — a variable "
            "missing from it cannot be set from .env at all. Add the missing "
            "name(s) to the backend service's `environment:` block, then "
            "confirm with: docker compose config | grep <NAME>"
        )
    return lines
