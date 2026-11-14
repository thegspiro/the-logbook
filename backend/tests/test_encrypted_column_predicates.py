"""No query compares an encrypted column: it would silently match nothing.

`EncryptedText`, `EncryptedJSON` and `EncryptedDate` store ciphertext. The
encryption is randomised (the same address encrypts to different bytes each
time), so `WHERE users.email = 'a@b.org'` compares the plaintext to ciphertext
and matches no row, ever. Nothing raises: a login, a duplicate check or a
search simply finds nobody. The failure only shows in a department that has
the data, which no test database does.

The repository's answer is a keyed fingerprint column beside the encrypted one
(`email_hash`, `customer_email_hash`, ...), matched with `email_fingerprints()`.
Encrypting a column is therefore a two-part change -- the type, and every
predicate that used to read it -- and the second half is easy to miss because
it fails by returning nothing. 91 columns were encrypted in October 2026 and
more are expected.

This sweep reads the encrypted types from `app/core/encrypted_types.py`, finds
every model column declared with one, and fails on any comparison, `IN`,
`LIKE`, `BETWEEN`, SQL function, `filter_by` or `ORDER BY` against it anywhere
under `app/`. `IS NULL` is allowed: a NULL stays NULL under encryption.

What it does not see: a column reached through an alias (`aliased(User)`) or a
variable, and raw SQL text. The detector is checked against a synthetic tree
below, so a green run on the real code means the shapes it knows are absent,
not that the class is closed.
"""

import ast
import collections
import pathlib

import pytest

pytestmark = pytest.mark.unit

APP = pathlib.Path(__file__).resolve().parents[1] / "app"

_COMPARISONS = (ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE)
_METHODS = {
    "in_",
    "notin_",
    "not_in",
    "like",
    "ilike",
    "notlike",
    "notilike",
    "contains",
    "startswith",
    "endswith",
    "between",
    "asc",
    "desc",
    "regexp_match",
}


def _encrypted_types(root: pathlib.Path) -> set[str]:
    tree = ast.parse((root / "core" / "encrypted_types.py").read_text())
    return {
        node.name
        for node in tree.body
        if isinstance(node, ast.ClassDef) and node.name.startswith("Encrypted")
    }


def _encrypted_columns(root: pathlib.Path) -> dict[str, set[str]]:
    """Attribute name -> the model classes that declare it as encrypted."""
    types = _encrypted_types(root)
    columns: dict[str, set[str]] = collections.defaultdict(set)
    for path in (root / "models").rglob("*.py"):
        for cls in [
            node
            for node in ast.parse(path.read_text()).body
            if isinstance(node, ast.ClassDef)
        ]:
            for statement in cls.body:
                if (
                    isinstance(statement, (ast.AnnAssign, ast.Assign))
                    and statement.value is not None
                ):
                    used = {
                        n.id
                        for n in ast.walk(statement.value)
                        if isinstance(n, ast.Name)
                    }
                    target = (
                        statement.target
                        if isinstance(statement, ast.AnnAssign)
                        else statement.targets[0]
                    )
                    if used & types and isinstance(target, ast.Name):
                        columns[target.id].add(cls.name)
    return columns


def _scan_source(source: str, columns: dict[str, set[str]]) -> list[tuple[int, str]]:
    def is_encrypted(node: ast.AST) -> bool:
        return (
            isinstance(node, ast.Attribute)
            and isinstance(node.value, ast.Name)
            and node.value.id in columns.get(node.attr, ())
        )

    found: list[tuple[int, str]] = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Compare) and any(
            isinstance(op, _COMPARISONS) for op in node.ops
        ):
            if is_encrypted(node.left) or any(
                is_encrypted(c) for c in node.comparators
            ):
                found.append((node.lineno, ast.unparse(node)[:100]))
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            func = node.func
            if func.attr in _METHODS and is_encrypted(func.value):
                found.append((node.lineno, ast.unparse(node)[:100]))
            elif (
                isinstance(func.value, ast.Name)
                and func.value.id == "func"
                and any(is_encrypted(arg) for arg in node.args)
            ):
                found.append((node.lineno, ast.unparse(node)[:100]))
            elif func.attr == "filter_by" and any(
                kw.arg in columns for kw in node.keywords
            ):
                names = ",".join(kw.arg for kw in node.keywords if kw.arg in columns)
                found.append((node.lineno, f"filter_by({names}=...)"))
            elif func.attr == "order_by" and any(is_encrypted(a) for a in node.args):
                found.append((node.lineno, ast.unparse(node)[:100]))
    return found


def _sweep(
    root: pathlib.Path,
) -> tuple[dict[str, set[str]], list[tuple[str, int, str]]]:
    columns = _encrypted_columns(root)
    hits: list[tuple[str, int, str]] = []
    for path in sorted(root.rglob("*.py")):
        if "models" in path.parts:
            continue
        for line, text in _scan_source(path.read_text(), columns):
            hits.append((str(path.relative_to(root)), line, text))
    return columns, hits


@pytest.fixture(scope="module")
def real_sweep():
    return _sweep(APP)


class TestTheRealTree:
    def test_no_query_compares_an_encrypted_column(self, real_sweep):
        _, hits = real_sweep
        assert not hits, (
            "These compare, match or order by an encrypted column, which can "
            "never match (the ciphertext is randomised). Match the fingerprint "
            "column with email_fingerprints() instead, or look the row up by "
            "another key and compare in Python:\n"
            + "\n".join(f"  app/{path}:{line}  {text}" for path, line, text in hits)
        )

    def test_the_sweep_knows_the_columns_it_is_guarding(self, real_sweep):
        columns, _ = real_sweep
        for attribute, model in [
            ("email", "User"),
            ("customer_email", "StoreOrder"),
            ("recipient_email", "NotificationLog"),
            ("payer_email", "StorePaymentEvent"),
        ]:
            assert model in columns.get(attribute, ()), (
                f"{model}.{attribute} is encrypted but the sweep does not know it; "
                "the parser has stopped recognising a declaration style, and a "
                "clean result would mean nothing"
            )
        assert sum(len(models) for models in columns.values()) >= 80

    def test_the_encrypted_types_are_read_from_the_module(self):
        assert {"EncryptedText", "EncryptedJSON", "EncryptedDate"} <= _encrypted_types(
            APP
        )


def _fake_app(root: pathlib.Path, service_source: str) -> pathlib.Path:
    (root / "core").mkdir(parents=True)
    (root / "models").mkdir()
    (root / "core" / "encrypted_types.py").write_text(
        "class EncryptedText: ...\nclass EncryptedDate: ...\n"
    )
    (root / "models" / "person.py").write_text(
        "class Person:\n"
        "    email = mapped_column(EncryptedText)\n"
        "    born = mapped_column(EncryptedDate)\n"
        "    email_hash = mapped_column(String)\n"
        "    name = mapped_column(String)\n"
    )
    (root / "service.py").write_text(service_source)
    return root


@pytest.mark.parametrize(
    "predicate",
    [
        "Person.email == address",
        "Person.email != address",
        "Person.born < cutoff",
        "address == Person.email",
        "Person.email.in_(addresses)",
        "Person.email.ilike(pattern)",
        "Person.born.between(a, b)",
        "func.lower(Person.email) == address",
        "session.query(Person).filter_by(email=address)",
        "select(Person).order_by(Person.born)",
        "select(Person).order_by(Person.email.desc())",
    ],
)
def test_each_shape_of_comparison_is_caught(tmp_path, predicate):
    root = _fake_app(tmp_path / "app", f"x = {predicate}\n")
    _, hits = _sweep(root)
    assert hits, f"{predicate!r} compares an encrypted column and was not flagged"


@pytest.mark.parametrize(
    "predicate",
    [
        "Person.email.is_(None)",
        "Person.email.isnot(None)",
        "Person.email_hash.in_(fingerprints)",
        "Person.name == name",
        "Other.email == address",
        "func.lower(Person.name) == name",
    ],
)
def test_what_is_safe_is_left_alone(tmp_path, predicate):
    root = _fake_app(tmp_path / "app", f"x = {predicate}\n")
    _, hits = _sweep(root)
    assert not hits, f"{predicate!r} is safe but was flagged: {hits}"
