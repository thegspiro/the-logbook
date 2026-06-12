"""
Guard against active/is_active column-name mismatches.

Several models expose an ``active`` flag and several expose ``is_active``;
referencing the wrong one (e.g. ``TrainingRequirement.is_active`` when the
column is ``active``) is not a typo any normal test catches — it raises
AttributeError only when that query path runs. This happened in
compliance_config_service and broke the requirement-selection UI.

This test builds the real column map from the ORM and scans the source for
any ``<Model>.<wrong_flag>`` reference, failing with the offending lines.
"""

import importlib
import os
import pkgutil
import re
import sys

from sqlalchemy import inspect as sa_inspect

import app.models as models_pkg

BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_DIR = os.path.join(BACKEND_ROOT, "app")


def _xor_flag_map():
    """Map model class name -> the flag it has, for models with exactly one
    of {active, is_active}."""
    for m in pkgutil.iter_modules(models_pkg.__path__):
        try:
            importlib.import_module(f"app.models.{m.name}")
        except Exception:
            pass

    flag_by_model = {}
    for modname, mod in list(sys.modules.items()):
        if not modname.startswith("app.models") or mod is None:
            continue
        for name in dir(mod):
            obj = getattr(mod, name)
            if not isinstance(obj, type) or name in flag_by_model:
                continue
            try:
                cols = {c.key for c in sa_inspect(obj).columns}
            except Exception:
                continue
            has_active, has_is_active = "active" in cols, "is_active" in cols
            if has_active ^ has_is_active:
                flag_by_model[name] = "active" if has_active else "is_active"
    return flag_by_model


def _iter_source_lines():
    for root, _dirs, files in os.walk(APP_DIR):
        for fname in files:
            if not fname.endswith(".py"):
                continue
            path = os.path.join(root, fname)
            with open(path, encoding="utf-8") as fh:
                for lineno, line in enumerate(fh, 1):
                    yield path, lineno, line


def test_no_active_is_active_reference_mismatches():
    flag_by_model = _xor_flag_map()
    assert flag_by_model, "expected to discover model active flags"

    # Build one regex per model matching the WRONG attribute with a word
    # boundary so `.active` doesn't match inside `.is_active`.
    wrong = {
        model: re.compile(
            rf"\b{model}\.{'is_active' if flag == 'active' else 'active'}\b"
        )
        for model, flag in flag_by_model.items()
    }

    violations = []
    for path, lineno, line in _iter_source_lines():
        for model, pattern in wrong.items():
            if pattern.search(line):
                rel = os.path.relpath(path, BACKEND_ROOT)
                violations.append(f"{rel}:{lineno}: {line.strip()}")

    assert not violations, "Wrong active/is_active column references:\n" + "\n".join(
        violations
    )
