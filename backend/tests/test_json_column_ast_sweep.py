"""
Tests for scripts/json_column_ast_sweep.py.

This sweep exists to enumerate every JSON-shaped model column so pitfall #12
(shallow-copy-then-reassign) can be checked against the *real* set, not a
remembered one. It is a reporting tool with no CI gate behind it (its own
docstring: "0 always"), so a regression in its matching logic has no other
backstop — it silently prints a smaller (or zero) count instead of erroring.

That happened: the script only recognized `Column(...)` calls, and every
model in this tree has since moved to SQLAlchemy 2.0's `mapped_column(...)`
declarative style, so a real run returned "0 distinct attribute names, 0
declarations" against a tree that has over 200 (security-review Feature 00,
pass 8). Pure AST-level tests here pin both call styles so the next
declaration-style migration fails loudly instead of quietly.
"""

import ast
import importlib.util
import pathlib

_SCRIPT = (
    pathlib.Path(__file__).resolve().parents[1] / "scripts" / "json_column_ast_sweep.py"
)
_spec = importlib.util.spec_from_file_location("_json_sweep", _SCRIPT)
sweep_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sweep_module)


def _names_in(source: str) -> set[str]:
    tree = ast.parse(source)
    found: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            found.update(name for name, _ in sweep_module._json_columns_in_class(node))
    return found


class TestRecognizesBothDeclarationStyles:
    def test_legacy_column_style(self):
        src = """
class Foo(Base):
    settings = Column(JSON, nullable=True)
"""
        assert _names_in(src) == {"settings"}

    def test_modern_mapped_column_style(self):
        src = """
class Foo(Base):
    settings: Mapped[dict] = mapped_column(JSON, nullable=True)
"""
        assert _names_in(src) == {"settings"}

    def test_mapped_column_with_mutable_dict_wrapper(self):
        src = """
class Foo(Base):
    settings: Mapped[dict] = mapped_column(
        MutableDict.as_mutable(JSON), nullable=True
    )
"""
        assert _names_in(src) == {"settings"}

    def test_mapped_column_with_encrypted_json(self):
        src = """
class Foo(Base):
    result_data: Mapped[dict] = mapped_column(EncryptedJSON, nullable=True)
"""
        assert _names_in(src) == {"result_data"}

    def test_non_json_mapped_column_is_not_matched(self):
        src = """
class Foo(Base):
    name: Mapped[str] = mapped_column(String(100), nullable=False)
"""
        assert _names_in(src) == set()


class TestRealModelTree:
    """The regression guard: a declaration-style migration that this
    script's matching logic doesn't follow must not silently zero the
    count out, since nothing else checks this tool's own output."""

    def test_sweep_finds_a_plausible_nonzero_count(self):
        by_name = sweep_module.sweep()
        total_declarations = sum(len(locs) for locs in by_name.values())
        assert len(by_name) > 100
        assert total_declarations > 100

    def test_known_json_columns_are_found(self):
        by_name = sweep_module.sweep()
        assert "settings" in by_name
        assert "result_data" in by_name
