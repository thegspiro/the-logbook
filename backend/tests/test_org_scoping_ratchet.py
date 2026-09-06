"""A ratchet on unscoped by-id queries (CLAUDE.md pitfall #14).

Pitfall #14 — every by-id read, update and delete filters ``organization_id``,
or resolves the row through a parent that was already org-scoped — is the
dominant finding class in the 2026-07 module audit and the highest-severity
rule in the backend. It is also, uniquely among the rules of that weight, one
nothing enforced.

**This is a ratchet, not a rule.** It does not decide whether an existing query
is safe; ``docs/ORG_SCOPING_SWEEP.md`` records why nothing reasonably can. It
freezes the set that exists today and fails on anything new, so the count can
only go down. Two precedents in this repository work the same way:
``test_endpoint_auth_coverage.py``'s ``ALLOWLISTED_PUBLIC`` and the screenshot
audit's ``audit_baseline.txt`` — and like the latter, a baselined entry that
stops flagging fails too, so the list shrinks rather than growing into a
blanket suppression.

Scope, and its limits — read these before trusting a green run:

* **Only ids that are bare names.** An id read off another object
  (``rsvp.user_id``) is excluded: it was almost always read from a row the
  caller already resolved in-org, and including that class made 68% of the
  findings noise, which is how a guard stops guarding.
* **Only models that carry ``organization_id``.** 48 of the 263 mapped models
  do not, and for those the rule's second shape — resolve the parent in-org,
  constrain the child by its parent FK — is the *only* legal one. Verifying
  that shape statically is beyond this file, so ``Candidate``, ``FormField``,
  ``ApprovalChainStep`` and their kind are **not covered here at all**.
* **Line numbers are not part of the key.** An edit anywhere above a query
  would otherwise rewrite the baseline and hide a real change inside the churn.

Burn the baseline down in the order given in ``docs/ORG_SCOPING_SWEEP.md``:
the parameter-fed sites first, since those are the ones a client-supplied id
can reach.
"""

import ast
import pathlib
import re

BACKEND = pathlib.Path(__file__).resolve().parents[1]
APP = BACKEND / "app"
BASELINE = pathlib.Path(__file__).with_name("org_scoping_baseline.txt")

#: ``Model.id == <rhs>``, with the rhs taken up to the first comma or paren.
ID_COMPARISON = re.compile(r"\b([A-Z]\w+)\.id\s*==\s*([^)\n,]+)")


def _models_with_organization_id():
    """Mapped classes declaring an ``organization_id`` column."""
    found = set()
    for path in sorted((APP / "models").rglob("*.py")):
        lines = path.read_text(encoding="utf-8").splitlines()
        for node in ast.walk(ast.parse("\n".join(lines))):
            if not isinstance(node, ast.ClassDef):
                continue
            body = "\n".join(lines[node.lineno - 1 : (node.end_lineno or node.lineno)])
            if "__tablename__" in body and "organization_id" in body:
                found.add(node.name)
    return found


def _enclosing_functions(tree):
    """Line number -> innermost enclosing function name."""
    at_line = {}
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for line in range(node.lineno, (node.end_lineno or node.lineno) + 1):
                at_line[line] = node.name
    return at_line


def scan_source(text, rel_path, org_models):
    """Keys for every reviewable unscoped by-id query in one module.

    A key is ``path::function::Model::id`` — deliberately free of line numbers,
    so the baseline survives edits above a query.
    """
    keys = []
    if "select(" not in text:
        return keys
    lines = text.splitlines()
    tree = ast.parse(text)
    functions = _enclosing_functions(tree)

    for node in ast.walk(tree):
        if not isinstance(node, (ast.Assign, ast.Expr, ast.Return, ast.AnnAssign)):
            continue
        statement = "\n".join(lines[node.lineno - 1 : (node.end_lineno or node.lineno)])
        if "select(" not in statement:
            continue
        # An org filter anywhere in the statement is what makes it safe; the
        # chained .where() forms all land inside the same statement.
        if "organization_id" in statement:
            continue
        match = ID_COMPARISON.search(statement)
        if not match:
            continue
        model, raw_rhs = match.group(1), match.group(2).strip()
        if model not in org_models:
            continue
        identifier = re.sub(r"^str\(", "", raw_rhs).rstrip(")").strip()
        # Read off another object, or subscripted: the id came from a row the
        # caller already resolved. Out of scope — see the module docstring.
        if "." in identifier or "[" in identifier or not identifier.isidentifier():
            continue
        function = functions.get(node.lineno, "<module>")
        keys.append(f"{rel_path}::{function}::{model}::{identifier}")
    return keys


def current_findings():
    org_models = _models_with_organization_id()
    keys = []
    for path in sorted(APP.rglob("*.py")):
        if "__pycache__" in str(path):
            continue
        keys.extend(
            scan_source(
                path.read_text(encoding="utf-8"),
                path.relative_to(BACKEND).as_posix(),
                org_models,
            )
        )
    return set(keys)


def read_baseline():
    entries = set()
    for line in BASELINE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            entries.add(line)
    return entries


def test_no_new_unscoped_by_id_query():
    added = sorted(current_findings() - read_baseline())
    assert added == [], (
        "New by-id query with no organization_id filter. A bare "
        "select(Model).where(Model.id == x) on a client-supplied id is an "
        "IDOR (CLAUDE.md pitfall #14). Filter organization_id, or resolve the "
        "row through a parent that was already org-scoped. If it is genuinely "
        "safe, add it to tests/org_scoping_baseline.txt WITH A REASON — that "
        "line is the security decision, so make it reviewable:\n  " + "\n  ".join(added)
    )


def test_baseline_has_no_stale_entries():
    """The list may only shrink.

    Without this a fixed query leaves its entry behind, the baseline stops
    describing the code, and it drifts into a blanket suppression — which is
    the failure mode the screenshot audit's baseline documents.
    """
    stale = sorted(read_baseline() - current_findings())
    assert stale == [], (
        "These baseline entries no longer flag. If you fixed them, delete "
        "the lines; if you renamed something, update them:\n  " + "\n  ".join(stale)
    )


class TestTheDetectionItself:
    """A ratchet that quietly stopped detecting would pass forever."""

    ORG = {"Apparatus"}

    def _scan(self, source):
        return scan_source(source, "probe.py", self.ORG)

    def test_an_unscoped_by_id_query_is_flagged(self):
        assert self._scan(
            "async def f(db, apparatus_id):\n"
            "    r = await db.execute(select(Apparatus)"
            ".where(Apparatus.id == apparatus_id))\n"
        ) == ["probe.py::f::Apparatus::apparatus_id"]

    def test_a_str_wrapped_id_normalizes_to_the_same_key(self):
        assert self._scan(
            "async def f(db, apparatus_id):\n"
            "    r = await db.execute(select(Apparatus)"
            ".where(Apparatus.id == str(apparatus_id)))\n"
        ) == ["probe.py::f::Apparatus::apparatus_id"]

    def test_an_org_filtered_query_is_not_flagged(self):
        assert not self._scan(
            "async def f(db, apparatus_id, org):\n"
            "    r = await db.execute(\n"
            "        select(Apparatus)\n"
            "        .where(Apparatus.id == str(apparatus_id))\n"
            "        .where(Apparatus.organization_id == str(org))\n"
            "    )\n"
        )

    def test_an_id_read_off_another_object_is_out_of_scope(self):
        assert not self._scan(
            "async def f(db, rsvp):\n"
            "    r = await db.execute(select(Apparatus)"
            ".where(Apparatus.id == rsvp.apparatus_id))\n"
        )

    def test_a_model_without_organization_id_is_out_of_scope(self):
        assert not self._scan(
            "async def f(db, candidate_id):\n"
            "    r = await db.execute(select(Candidate)"
            ".where(Candidate.id == candidate_id))\n"
        )

    def test_the_key_carries_the_innermost_function(self):
        keys = self._scan(
            "async def outer(db, apparatus_id):\n"
            "    async def inner():\n"
            "        return await db.execute(select(Apparatus)"
            ".where(Apparatus.id == apparatus_id))\n"
            "    return inner\n"
        )
        assert keys == ["probe.py::inner::Apparatus::apparatus_id"]

    def test_the_key_has_no_line_number(self):
        """Otherwise an edit above a query rewrites the baseline."""
        one = self._scan(
            "async def f(db, apparatus_id):\n"
            "    r = await db.execute(select(Apparatus)"
            ".where(Apparatus.id == apparatus_id))\n"
        )
        two = self._scan(
            "# a new comment\n"
            "\n"
            "async def f(db, apparatus_id):\n"
            "    r = await db.execute(select(Apparatus)"
            ".where(Apparatus.id == apparatus_id))\n"
        )
        assert one == two
