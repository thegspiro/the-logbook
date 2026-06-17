"""
Guard against eager-load references to non-existent relationships.

selectinload(Model.attr) / joinedload(Model.attr) raise AttributeError at
query-build time if ``attr`` is not a real mapped attribute — a runtime 500
that no normal unit test exercises. This happened with
RequirementProgress.requirement (the relationship lived on ProgramRequirement),
which 500'd both the progress endpoint and the shift-completion path.

This test configures the ORM, then scans app/ source for every
selectinload/joinedload/subqueryload/contains_eager(<Model>.<attr>) reference
and fails with the offending file:line if any target attribute is missing.
"""

import glob
import os
import re
import sys

from sqlalchemy.orm import configure_mappers

import app.models  # noqa: F401 — ensure all models are imported/mapped

BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_DIR = os.path.join(BACKEND_ROOT, "app")

_LOADER_RE = re.compile(
    r"(?:selectinload|joinedload|subqueryload|contains_eager|lazyload)"
    r"\(\s*([A-Z]\w+)\.(\w+)"
)


def _model_classes():
    configure_mappers()
    classes = {}
    for modname, mod in list(sys.modules.items()):
        if not modname.startswith("app.models") or mod is None:
            continue
        for attr in dir(mod):
            obj = getattr(mod, attr, None)
            if isinstance(obj, type) and hasattr(obj, "__mapper__"):
                classes.setdefault(attr, obj)
    return classes


def test_all_eager_load_targets_exist():
    models = _model_classes()
    assert models, "expected to discover mapped model classes"

    violations = []
    for path in glob.glob(os.path.join(APP_DIR, "**", "*.py"), recursive=True):
        with open(path, encoding="utf-8") as fh:
            for lineno, line in enumerate(fh, 1):
                for match in _LOADER_RE.finditer(line):
                    cls, attr = match.group(1), match.group(2)
                    if cls in models and not hasattr(models[cls], attr):
                        rel = os.path.relpath(path, BACKEND_ROOT)
                        violations.append(
                            f"{rel}:{lineno}: {cls}.{attr} does not exist"
                        )

    assert not violations, "Eager-load to non-existent relationship:\n" + "\n".join(
        violations
    )
