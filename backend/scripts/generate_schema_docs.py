#!/usr/bin/env python3
"""
Database Schema Reference Generator

Renders ``docs/DATABASE_SCHEMA.md`` from ``Base.metadata`` — every table,
column, type, nullability, foreign key, index and constraint the ORM defines.

The models are the right source for this document rather than a live database
or the migration chain: ``main.py`` builds a fresh install with
``Base.metadata.create_all()`` (see ``_fast_path_init``), so the models *are*
the schema a new deployment gets. Migrations only patch databases that already
exist.

Usage:
    cd backend
    python scripts/generate_schema_docs.py            # write the doc
    python scripts/generate_schema_docs.py --check    # CI: fail if stale
"""

import argparse
import re
import sys
from collections import defaultdict
from enum import Enum
from pathlib import Path

from sqlalchemy.sql.expression import ClauseElement

BACKEND_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(BACKEND_DIR))

OUTPUT_PATH = BACKEND_DIR.parent / "docs" / "DATABASE_SCHEMA.md"

# Model module -> the domain heading its tables are grouped under. Anything not
# listed falls back to a title-cased version of the module name.
DOMAIN_TITLES = {
    "admin_hours": "Administrative Hours",
    "analytics": "Analytics",
    "apparatus": "Apparatus",
    "audit": "Audit & Compliance Logging",
    "compliance_config": "Compliance Configuration",
    "consent": "Consent",
    "document": "Documents",
    "election": "Elections",
    "email_template": "Email Templates",
    "error_log": "Error Logging",
    "event": "Events",
    "event_request": "Event Requests",
    "facilities": "Facilities",
    "finance": "Finance",
    "forms": "Forms",
    "grant": "Grants & Fundraising",
    "integration": "Integrations",
    "inventory": "Inventory",
    "ip_security": "IP Security",
    "location": "Locations",
    "medical_screening": "Medical Screening",
    "meeting": "Meetings",
    "membership_pipeline": "Membership Pipeline",
    "minute": "Meeting Minutes",
    "notification": "Notifications",
    "onboarding": "Onboarding",
    "operational_rank": "Operational Ranks",
    "public_portal": "Public Portal",
    "security_alert": "Security Alerts",
    "skills_testing": "Skills Testing",
    "storefront": "Storefront",
    "training": "Training",
    "user": "Users, Organizations & Access Control",
}


def anchor(text: str) -> str:
    """GitHub-flavoured markdown heading anchor (underscores are preserved)."""
    return re.sub(r"[^a-z0-9\s_-]", "", text.lower()).replace(" ", "-")


def summarize(model) -> str:
    """First line of a model docstring, as a one-line purpose blurb."""
    if not model or not model.__doc__:
        return ""
    for line in model.__doc__.strip().splitlines():
        line = line.strip()
        # Many models lead with a title line repeating the class name; the
        # sentence after it is the useful description.
        if line and line.lower().replace(" ", "") != model.__name__.lower():
            return line[:110]
    return ""


def render_type(col) -> str:
    """Compact, readable rendering of a column type."""
    # str() on an Enum column renders the backing VARCHAR, which hides the
    # allowed values — the part that actually matters when writing code
    # against the column.
    values = getattr(col.type, "enums", None)
    if values:
        return "ENUM(" + ", ".join(f"`{v}`" for v in values) + ")"
    try:
        return str(col.type)
    except Exception:  # pragma: no cover - dialect-specific types
        return col.type.__class__.__name__


def render_default(col) -> str:
    if col.server_default is not None:
        arg = getattr(col.server_default, "arg", None)
        if arg is not None:
            return f"`{str(arg).strip()}`"
        return "server default"
    if col.default is not None:
        if col.default.is_callable:
            fn = getattr(col.default, "arg", None)
            name = getattr(fn, "__name__", None) or getattr(
                getattr(fn, "func", None), "__name__", ""
            )
            # Column(default=...) wraps plain callables in a lambda taking a
            # context arg, so unwrap to the underlying name where we can.
            return f"`{name}()`" if name and name != "<lambda>" else "generated"
        arg = col.default.arg
        if isinstance(arg, Enum):
            return f"`{arg.value!r}`"
        if isinstance(arg, ClauseElement):
            # repr() of a SQL element embeds its memory address, which would
            # make the rendered doc differ on every run.
            return f"`{arg}`"
        return f"`{arg!r}`"
    return ""


def column_flags(table, col) -> str:
    flags = []
    if col.primary_key:
        flags.append("PK")
    for fk in col.foreign_keys:
        flags.append("FK")
        break
    if col.unique:
        flags.append("UQ")
    # table.indexes is a set — decide from the whole set rather than whichever
    # member happens to come first, or the rendered doc is non-deterministic
    # and --check reports a false "stale".
    leading = [
        idx
        for idx in table.indexes
        if list(idx.columns) and list(idx.columns)[0].name == col.name
    ]
    if leading:
        flags.append("UQ-IDX" if any(i.unique for i in leading) else "IDX")
    elif col.index:
        flags.append("IDX")
    return ", ".join(dict.fromkeys(flags))


def fk_target(col) -> str:
    parts = []
    for fk in col.foreign_keys:
        target = fk.target_fullname
        rule = fk.ondelete
        parts.append(f"→ `{target}`" + (f" ON DELETE {rule.upper()}" if rule else ""))
    return " ".join(parts)


def collect(metadata):
    """Group tables by the model module that defines them."""
    from app.core.database import Base

    table_to_model = {}
    for mapper in Base.registry.mappers:
        cls = mapper.class_
        tablename = getattr(cls, "__tablename__", None)
        if tablename and tablename not in table_to_model:
            table_to_model[tablename] = cls

    domains = defaultdict(list)
    for name, table in sorted(metadata.tables.items()):
        model = table_to_model.get(name)
        module = model.__module__.rsplit(".", 1)[-1] if model else "user"
        domains[module].append((name, table, model))
    return domains


def build(metadata) -> str:
    domains = collect(metadata)
    total_tables = len(metadata.tables)
    total_columns = sum(len(t.columns) for t in metadata.tables.values())
    total_fks = sum(
        len(c.foreign_keys) for t in metadata.tables.values() for c in t.columns
    )

    ordered = sorted(
        domains.items(), key=lambda kv: DOMAIN_TITLES.get(kv[0], kv[0].title())
    )

    out = []
    w = out.append

    w("# Database Schema Reference")
    w("")
    w(
        "Complete reference for every table, column, key and index defined by the "
        "SQLAlchemy models. **Generated — do not edit by hand.**"
    )
    w("")
    w("```bash")
    w("cd backend && python scripts/generate_schema_docs.py")
    w("```")
    w("")
    w(f"**{total_tables} tables · {total_columns} columns · {total_fks} foreign keys**")
    w("")
    w("---")
    w("")
    w("## How the schema is materialized")
    w("")
    w(
        "A **fresh install** does not replay the migration chain. `main.py`'s "
        "`_fast_path_init()` calls `Base.metadata.create_all()` and then stamps "
        "Alembic at head, so **the models in `app/models/` are the schema** a new "
        "deployment receives. Alembic migrations exist to patch databases that "
        "already exist."
    )
    w("")
    w("Two consequences worth internalising before changing anything:")
    w("")
    w(
        "1. **A model change alone changes the schema of every new install.** "
        "Widening or narrowing a column type in a model is a schema change even "
        "with no migration attached."
    )
    w(
        "2. **A migration alone changes nothing for new installs.** Any migration "
        "must be paired with the equivalent model change, or fresh and upgraded "
        "databases diverge."
    )
    w("")
    w(
        "Some tables are *model-only*: they are created by `create_all()` and no "
        "migration ever creates them. A migration that alters one must guard with "
        "`sa.inspect(op.get_bind()).has_table(...)`, because on a fresh chain the "
        "table does not yet exist. See `20260802_0001_add_dues_payments_ledger.py` "
        "for the established pattern."
    )
    w("")
    w("---")
    w("")
    w("## Conventions")
    w("")
    w("| Aspect | Convention |")
    w("|---|---|")
    w(
        "| Primary key | `id VARCHAR(36)`, application-generated UUID "
        "(`default=generate_uuid`). No auto-increment integers. |"
    )
    w(
        "| Tenant scope | `organization_id VARCHAR(36)` → `organizations.id`, "
        "almost always `ON DELETE CASCADE`. Every by-id query must filter it "
        "(see CLAUDE.md pitfall #14). |"
    )
    w(
        "| Timestamps | `DateTime(timezone=True)`, stored **UTC**. `created_at` "
        "defaults to `now()`; `updated_at` uses `onupdate=now()`. Conversion to "
        "local time happens in the frontend only. |"
    )
    w(
        "| Actor columns | `created_by` / `updated_by` / `*_by` → `users.id`, "
        "nullable, usually `ON DELETE SET NULL` so records outlive the member. |"
    )
    w(
        "| Enums | Python `(str, Enum)` with **lowercase** values. Stored as "
        "MySQL `ENUM` or `VARCHAR` depending on the column. |"
    )
    w(
        "| `SET NULL` FKs | Must be `nullable=True` — MySQL error 1830 rejects "
        "`SET NULL` on a `NOT NULL` column. |"
    )
    w("| Naming | `plural_snake_case` tables, `snake_case` columns. |")
    w("")
    w("**Key flags used in the column tables below:**")
    w("")
    w(
        "`PK` primary key · `FK` foreign key · `UQ` unique constraint · "
        "`IDX` indexed · `UQ-IDX` unique index"
    )
    w("")
    w("---")
    w("")
    w("## Table index")
    w("")

    for module, entries in ordered:
        title = DOMAIN_TITLES.get(module, module.title())
        w(f"### {title}")
        w("")
        w(f"<sub>`app/models/{module}.py`</sub>")
        w("")
        w("| Table | Model | Columns | Purpose |")
        w("|---|---|---|---|")
        for name, table, model in entries:
            doc = summarize(model)
            model_name = f"`{model.__name__}`" if model else "_(association table)_"
            w(
                f"| [`{name}`](#{anchor(name)}) | {model_name} "
                f"| {len(table.columns)} | {doc} |"
            )
        w("")

    w("---")
    w("")
    w("## Tables")
    w("")

    for module, entries in ordered:
        title = DOMAIN_TITLES.get(module, module.title())
        w(f"## {title}")
        w("")
        for name, table, model in entries:
            w(f"### `{name}`")
            w("")
            meta_bits = [f"`app/models/{module}.py`"]
            if model:
                meta_bits.insert(0, f"**{model.__name__}**")
            w(" · ".join(meta_bits))
            w("")
            if model and model.__doc__:
                w(f"> {' '.join(model.__doc__.split())}")
                w("")

            w("| Column | Type | Null | Key | Default | References |")
            w("|---|---|---|---|---|---|")
            for col in table.columns:
                w(
                    f"| `{col.name}` | {render_type(col)} "
                    f"| {'yes' if col.nullable else 'no'} "
                    f"| {column_flags(table, col)} "
                    f"| {render_default(col)} | {fk_target(col)} |"
                )
            w("")

            idxs = sorted(table.indexes, key=lambda i: i.name or "")
            if idxs:
                w("**Indexes**")
                w("")
                for idx in idxs:
                    cols = ", ".join(f"`{c.name}`" for c in idx.columns)
                    kind = "UNIQUE " if idx.unique else ""
                    w(f"- {kind}`{idx.name}` ({cols})")
                w("")

            extra = sorted(
                (
                    c
                    for c in table.constraints
                    if type(c).__name__ in ("UniqueConstraint", "CheckConstraint")
                ),
                key=lambda c: c.name or "",
            )
            if extra:
                w("**Constraints**")
                w("")
                for c in extra:
                    if type(c).__name__ == "UniqueConstraint":
                        cols = ", ".join(f"`{cc.name}`" for cc in c.columns)
                        w(f"- UNIQUE `{c.name}` ({cols})")
                    else:
                        w(f"- CHECK `{c.name}`: `{c.sqltext}`")
                w("")

    # ---- Cross-cutting reference sections -------------------------------
    w("---")
    w("")
    w("## Foreign key reference")
    w("")
    w(
        "Every foreign key in the schema, grouped by the table it points at — the "
        "map of which id lives where."
    )
    w("")

    by_target = defaultdict(list)
    for tname, table in sorted(metadata.tables.items()):
        for col in table.columns:
            for fk in col.foreign_keys:
                target_table = fk.target_fullname.split(".")[0]
                by_target[target_table].append(
                    (tname, col.name, fk.ondelete or "NO ACTION", col.nullable)
                )

    for target in sorted(by_target, key=lambda t: (-len(by_target[t]), t)):
        refs = by_target[target]
        w(f"### → `{target}` ({len(refs)} references)")
        w("")
        w("| From table | Column | On delete | Nullable |")
        w("|---|---|---|---|")
        for tname, cname, rule, nullable in sorted(refs):
            w(
                f"| `{tname}` | `{cname}` | {rule.upper()} "
                f"| {'yes' if nullable else 'no'} |"
            )
        w("")

    w("---")
    w("")
    w("## Tables without `organization_id`")
    w("")
    w(
        "These tables are not directly tenant-scoped. Each must reach its "
        "organization through a parent row, so **every query against one has to "
        "join through an org-scoped parent** (CLAUDE.md pitfall #14a). This list "
        "is the review checklist for multi-tenant isolation."
    )
    w("")
    no_org = []
    for tname, table in sorted(metadata.tables.items()):
        if "organization_id" in table.columns:
            continue
        parents = sorted(
            {
                fk.target_fullname.split(".")[0]
                for col in table.columns
                for fk in col.foreign_keys
            }
        )
        no_org.append((tname, parents))

    w("| Table | Scoped via |")
    w("|---|---|")
    for tname, parents in no_org:
        via = ", ".join(f"`{p}`" for p in parents) if parents else "— _(root table)_"
        w(f"| `{tname}` | {via} |")
    w("")

    return "\n".join(out) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Exit non-zero if the committed doc is out of date.",
    )
    args = parser.parse_args()

    import app.models  # noqa: F401 - populates Base.metadata
    from app.core.database import Base

    content = build(Base.metadata)

    if args.check:
        if not OUTPUT_PATH.exists():
            print(f"MISSING: {OUTPUT_PATH} has not been generated.")
            return 1
        if OUTPUT_PATH.read_text() != content:
            print(
                f"STALE: {OUTPUT_PATH.name} does not match the current models.\n"
                "Regenerate with: cd backend && "
                "python scripts/generate_schema_docs.py"
            )
            return 1
        print(f"OK: {OUTPUT_PATH.name} is up to date.")
        return 0

    OUTPUT_PATH.write_text(content)
    tables = len(Base.metadata.tables)
    columns = sum(len(t.columns) for t in Base.metadata.tables.values())
    print(f"Wrote {OUTPUT_PATH} ({tables} tables, {columns} columns)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
