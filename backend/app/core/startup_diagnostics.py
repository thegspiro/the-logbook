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

import inspect
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
        default = type(settings).model_fields[name].default
        if name in os.environ:
            shown = "(value hidden)" if _is_secret(name) else repr(os.environ[name])
            lines.append(f"  {name:<32} set in environment  {shown}")
        elif getattr(settings, name, default) != default:
            # Settings declares env_file=".env", and pydantic reads that file
            # without exporting into os.environ. Absent-from-environ is
            # therefore not the same as defaulted: reporting this as missing
            # would tell an operator their .env is being ignored at the very
            # moment it is being honoured — the exact false claim this report
            # exists to prevent.
            lines.append(f"  {name:<32} set from a .env file read by the application")
        else:
            missing.append(name)
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


def boot_blocking_setting_names(settings: "Settings") -> list[str]:
    """Every setting the security validators can name in a blocking message.

    Read out of the validators' own source rather than kept as a list, because
    a list is exactly the thing that goes stale: the failure this guards
    against is a new gate landing upstream while a hand-maintained compose
    file knows nothing about it. Source is the one place a new check cannot
    be added without appearing.

    Over-inclusion is deliberately safe here — a name picked up from a comment
    costs one unnecessary passthrough, while a name missed costs a boot.
    """
    source = ""
    for method in ("validate_security_config", "validate_cors_config"):
        try:
            source += inspect.getsource(getattr(type(settings), method))
        except (OSError, TypeError):  # pragma: no cover - source always available
            pass
    return sorted(
        name
        for name in type(settings).model_fields
        if re.search(rf"\b{re.escape(name)}\b", source)
    )


def _strip_comments(text: str) -> str:
    """Drop YAML comments so a name mentioned only in prose is not counted."""
    out = []
    for line in text.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("#"):
            continue
        out.append(line.split(" #", 1)[0])
    return "\n".join(out)


def missing_from_compose(compose_text: str, names: list[str]) -> list[str]:
    """Names absent from a compose file entirely.

    Deliberately a presence test over the whole file rather than a parse of
    one service's `environment:` mapping: this has to run inside the backend
    image, where a YAML library is not a guaranteed dependency, and an absent
    name is conclusive on its own. A name present but attached to the wrong
    service is not detected — the report says so rather than implying a
    completeness it does not have.
    """
    body = _strip_comments(compose_text)
    return [name for name in names if not re.search(rf"\b{re.escape(name)}\b", body)]
