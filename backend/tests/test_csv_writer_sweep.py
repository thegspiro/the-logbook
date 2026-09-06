"""Every CSV that leaves the system is written by ``SafeCsvWriter``.

Exported CSVs are opened in Excel and Google Sheets, which **execute** any cell
whose value begins with ``=``, ``+``, ``-``, ``@`` or a leading tab/CR. The
free-text fields that go into an export — member names, notes, item
descriptions, memos — are attacker-influenceable, so a member named ``=cmd|…``
runs a formula on whatever staff member opens the file. The 2026-07 module
audit found this live in **six** exporters at once, all of which had reached
for ``csv.writer`` because it is the obvious thing to reach for.

``app/utils/csv_export.py`` owns the fix (``SafeCsvWriter`` /
``SafeDictCsvWriter``, drop-in and same interface). ``tests/test_csv_export.py``
proves those two neutralize a formula cell. Neither of them notices a seventh
exporter that never called them, which is the failure mode that actually
recurs — so this file is the sweep, in the manner of
``test_like_escaping.py::test_wildcard_escaping_lives_only_in_sql_search``.

Reading is untouched: ``csv.reader`` and ``csv.DictReader`` parse input and
cannot inject a formula into anything. Only the writers are banned.

Matching is done on the AST rather than on lines, deliberately. The correct
guidance names the banned call — ``csv_export.py``'s own docstrings say "use
this instead of ``csv.writer``", and so do comments at half the call sites — so
a line-based sweep would flag the documentation telling you to comply.
"""

import ast
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
APP = BACKEND / "app"
SCRIPTS = BACKEND / "scripts"

#: The one module allowed to construct a raw writer: it wraps them.
CSV_EXPORT = APP / "utils" / "csv_export.py"

#: ``csv``'s writing entry points. Readers are fine and are not listed.
BANNED = {"writer", "DictWriter"}


def _python_sources():
    """`app/` and `scripts/`. An ops script that dumps a CSV a human opens in
    Excel carries exactly the risk an endpoint export does."""
    return sorted(
        path for root in (APP, SCRIPTS) if root.is_dir() for path in root.rglob("*.py")
    )


def _raw_csv_writers(tree):
    """Yield ``(lineno, rendering)`` for each raw csv writer reference.

    Catches the attribute form (``csv.writer(...)``) and the import form
    (``from csv import writer``), which is the way round the first one.
    """
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute) and node.attr in BANNED:
            value = node.value
            if isinstance(value, ast.Name) and value.id == "csv":
                yield node.lineno, f"csv.{node.attr}"
        elif isinstance(node, ast.ImportFrom) and node.module == "csv":
            for alias in node.names:
                if alias.name in BANNED:
                    yield node.lineno, f"from csv import {alias.name}"


def test_raw_csv_writers_live_only_in_csv_export():
    offenders = []
    for path in _python_sources():
        if path == CSV_EXPORT:
            continue
        source = path.read_text(encoding="utf-8")
        if "csv" not in source:
            continue
        for lineno, rendering in _raw_csv_writers(ast.parse(source)):
            offenders.append(f"{path.relative_to(BACKEND)}:{lineno} ({rendering})")

    assert not offenders, (
        "A raw csv writer here writes cells straight through, so a member "
        "named '=cmd|...' executes when staff open the export. Use "
        "SafeCsvWriter / SafeDictCsvWriter from app.utils.csv_export — they "
        "are drop-in and take the same arguments:\n  " + "\n  ".join(offenders)
    )


def test_the_sweep_actually_looks_at_the_exporters():
    """A sweep that silently stopped finding files would pass forever.

    Anchored on the writers known to exist rather than on a count, so adding
    an exporter does not fail this and deleting the sweep's reach does.
    """
    seen = {
        path.relative_to(BACKEND).as_posix()
        for path in _python_sources()
        if "SafeCsvWriter" in path.read_text(encoding="utf-8")
        or "SafeDictCsvWriter" in path.read_text(encoding="utf-8")
    }
    for expected in (
        "app/services/finance_service.py",
        "app/services/storefront_service.py",
        "app/api/v1/endpoints/inventory.py",
        "app/services/integration_services/nfirs_service.py",
    ):
        assert expected in seen, (
            f"{expected} is no longer reached by the sweep. Either it moved "
            "or _python_sources() stopped covering it — the second would make "
            "the ban silently unenforced."
        )


class TestTheDetectionItself:
    """The sweep passes because the tree is clean, not because it is blind."""

    @staticmethod
    def _offenders(source):
        return list(_raw_csv_writers(ast.parse(source)))

    def test_an_attribute_call_is_flagged(self):
        assert self._offenders("import csv\nw = csv.writer(out)\n")

    def test_a_dictwriter_is_flagged(self):
        assert self._offenders("import csv\nw = csv.DictWriter(out, fieldnames=f)\n")

    def test_the_import_form_is_flagged(self):
        assert self._offenders("from csv import writer\nw = writer(out)\n")

    def test_an_unbound_reference_is_flagged(self):
        """``w = csv.writer`` then ``w(out)`` never calls the attribute."""
        assert self._offenders("import csv\nw = csv.writer\nw(out)\n")

    def test_readers_are_not_flagged(self):
        assert not self._offenders("import csv\nr = csv.DictReader(io.StringIO(t))\n")
        assert not self._offenders("import csv\nr = csv.reader(fh)\n")

    def test_the_safe_wrappers_are_not_flagged(self):
        assert not self._offenders(
            "from app.utils.csv_export import SafeCsvWriter\nw = SafeCsvWriter(out)\n"
        )

    def test_an_unrelated_writer_attribute_is_not_flagged(self):
        """``self.writer`` and ``xlsx.writer`` are not ``csv``'s."""
        assert not self._offenders("w = self.writer(out)\n")
        assert not self._offenders("import xlsx\nw = xlsx.writer(out)\n")

    def test_prose_naming_the_banned_call_is_not_flagged(self):
        """The reason this is an AST sweep and not a grep."""
        assert not self._offenders('"""Use SafeCsvWriter instead of csv.writer."""\n')
        assert not self._offenders("# never csv.writer here\nx = 1\n")
