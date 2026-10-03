"""A local import must never shadow a name a function already relies on.

Python scopes an import like any other assignment: binding a name anywhere in
a function body — including a nested ``if``, deep inside the function — makes
that name local to the *entire* function, even before the binding statement
runs. ``create_member`` in ``app/api/v1/endpoints/users.py`` already used the
module-level ``OrganizationService`` import earlier in the function body, then
re-imported the same name locally further down (to generate a membership
number when the caller supplied none). That local import made the name local
for the whole function, so the earlier, module-level-relying use raised
``UnboundLocalError: cannot access local variable 'OrganizationService'`` —
every time a caller supplied ``membership_number``, which is the common case
for a manually-entered member. ``POST /users`` 500ed outright, and the
demo-data seeder could not create a single member until it was fixed.

The fix was simply deleting the redundant local import — the module-level one
already covers the whole file. This sweep catches the general shape of the
mistake (a local import of a name also bound at module level, where the
function reads that name before the local import executes) anywhere in the
backend, rather than only in the one function that happened to trip over it.

Reading is unaffected: a local import that comes *before* every use in the
same function is completely normal in this codebase (lazy imports to dodge a
circular import, or to avoid importing something heavy on a cold path) and is
not flagged — only a use that executes before the local import can bind the
name is a hazard.
"""

import ast
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
APP = BACKEND / "app"


def _module_level_import_names(tree: ast.Module) -> set[str]:
    names: set[str] = set()
    for node in ast.iter_child_nodes(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                names.add(alias.asname or alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                names.add(alias.asname or alias.name)
    return names


def _shadow_hazards_in_function(fn, module_level_names: set[str]):
    """Names the function re-imports locally after already reading them.

    Walks the function body but stops at a nested function/lambda/class —
    those open their own scope, so an import inside one cannot shadow
    anything in the enclosing function.
    """
    local_import_first_line: dict[str, int] = {}
    loads: list[tuple[str, int]] = []

    def visit(node):
        for child in ast.iter_child_nodes(node):
            if isinstance(
                child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef)
            ):
                continue
            if isinstance(child, ast.Import):
                for alias in child.names:
                    name = alias.asname or alias.name.split(".")[0]
                    local_import_first_line[name] = min(
                        local_import_first_line.get(name, child.lineno), child.lineno
                    )
            elif isinstance(child, ast.ImportFrom):
                for alias in child.names:
                    name = alias.asname or alias.name
                    local_import_first_line[name] = min(
                        local_import_first_line.get(name, child.lineno), child.lineno
                    )
            elif isinstance(child, ast.Name) and isinstance(child.ctx, ast.Load):
                loads.append((child.id, child.lineno))
            visit(child)

    visit(fn)

    hazards = []
    for name, import_line in local_import_first_line.items():
        if name not in module_level_names:
            continue
        earlier_uses = [ln for (n, ln) in loads if n == name and ln < import_line]
        if earlier_uses:
            hazards.append((fn.name, name, import_line, earlier_uses))
    return hazards


def _sweep(source: str, filename: str = "<test>"):
    tree = ast.parse(source, filename=filename)
    module_level_names = _module_level_import_names(tree)
    hazards = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            hazards.extend(_shadow_hazards_in_function(node, module_level_names))
    return hazards


def _backend_sources():
    return sorted(APP.rglob("*.py"))


def test_no_function_reads_a_name_before_shadowing_it_with_a_local_import():
    offenders = []
    for path in _backend_sources():
        hazards = _sweep(path.read_text(), filename=str(path))
        for fn_name, name, import_line, earlier_uses in hazards:
            offenders.append(
                f"{path.relative_to(BACKEND)}:{import_line} {fn_name}() reads "
                f"'{name}' at line(s) {earlier_uses} before a local import on "
                f"that line rebinds it for the whole function"
            )
    assert not offenders, "\n".join(offenders)


class TestTheSweepItself:
    """Pinned against small fixtures so the sweep's own logic is checked,
    not just today's state of the backend."""

    def test_flags_a_use_before_the_local_import(self):
        source = (
            "import app.x as Thing\n"
            "def f():\n"
            "    y = Thing(1)\n"
            "    if True:\n"
            "        import app.x as Thing\n"
            "    return y\n"
        )
        hazards = _sweep(source)
        assert hazards == [("f", "Thing", 5, [3])]

    def test_a_local_import_used_only_afterward_is_not_flagged(self):
        """The ordinary, safe shape: import first, then use it."""
        source = (
            "from app.services.x import Thing\n"
            "def f():\n"
            "    if condition():\n"
            "        from app.services.x import Thing\n"
            "        return Thing()\n"
            "    return None\n"
        )
        assert not _sweep(source)

    def test_a_local_import_with_no_module_level_counterpart_is_not_flagged(self):
        """Lazy-importing something that was never imported at module scope
        cannot shadow anything — there is nothing to shadow."""
        source = "def f():\n    from app.services.x import Thing\n    return Thing()\n"
        assert not _sweep(source)

    def test_a_nested_function_has_its_own_scope(self):
        """An inner function's local import cannot shadow the outer one; it
        opens a fresh scope, so the outer function's earlier use is reading
        the module-level name exactly as written."""
        source = (
            "import app.x as Thing\n"
            "def outer():\n"
            "    y = Thing(1)\n"
            "    def inner():\n"
            "        import app.x as Thing\n"
            "        return Thing()\n"
            "    return y, inner()\n"
        )
        assert not _sweep(source)

    def test_the_actual_users_py_bug_is_reproduced(self):
        """A minimal reconstruction of the exact shape this sweep exists for."""
        source = (
            "from app.services.organization_service import OrganizationService\n"
            "async def create_member(user_data, db):\n"
            "    if user_data.membership_number:\n"
            "        await OrganizationService(db).ensure_membership_number_available(\n"
            "            user_data.membership_number\n"
            "        )\n"
            "    membership_number = user_data.membership_number\n"
            "    if not membership_number:\n"
            "        from app.services.organization_service import OrganizationService\n"
            "\n"
            "        org_service = OrganizationService(db)\n"
            "        membership_number = await org_service.generate_next_membership_id()\n"
        )
        hazards = _sweep(source)
        assert len(hazards) == 1
        fn_name, name, import_line, earlier_uses = hazards[0]
        assert (fn_name, name) == ("create_member", "OrganizationService")
