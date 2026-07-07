"""
Department Template Export/Import — Engine (Phase 1: export)

Serializes an organization's *structural template* — the definitional/config
records enumerated in :mod:`app.services.org_template_registry` — into a
portable ``.zip`` archive that can later be imported into another instance.

Structure-only guarantees enforced here (see plan §8):
- **Allowlist:** only tables with a :class:`TableSpec` are touched.
- **No member identity:** every FK-to-``users`` column and every ``*_by`` /
  ``*_user_id`` column is nulled automatically; PII-bearing JSON keys are
  stripped recursively.
- **No secrets:** secret columns live only in EXCLUDE tables and are asserted
  absent from the INCLUDE set by a unit test; the ``organizations`` row (which
  holds encrypted email/storage credentials in ``settings``) is never exported.
"""

import enum
import hashlib
import io
import json
import re
import uuid
import zipfile
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import Organization
from app.services.org_template_registry import (
    INCLUDED_TABLES,
    SPEC_BY_TABLE,
    USERS_TABLE,
    TableSpec,
    modules,
    specs_for_modules,
)

FORMAT_NAME = "logbook-department-template"
FORMAT_VERSION = 1

# JSON object keys whose values are stripped recursively from any exported JSON
# column. Defense-in-depth for PII/secrets embedded below the column level
# (e.g. ``allowed_evaluators.user_ids``, nested recipient emails).
_SENSITIVE_JSON_KEYS: tuple[str, ...] = (
    "password",
    "secret",
    "token",
    "api_key",
    "apikey",
    "private",
    "salt",
    "credential",
    "encrypted",
    "key_hash",
    "ssn",
    "email",
    "phone",
    "mobile",
    "user_id",
    "user_ids",
    "recipient",
    "date_of_birth",
    "dob",
    "first_name",
    "last_name",
)

_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-" r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


def _json_default(obj: Any) -> Any:
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return str(obj)
    if isinstance(obj, uuid.UUID):
        return str(obj)
    if isinstance(obj, enum.Enum):
        return obj.value
    if isinstance(obj, (bytes, bytearray)):
        return None
    return str(obj)


def _sensitive_key(key: Any) -> bool:
    kl = str(key).lower()
    return any(p in kl for p in _SENSITIVE_JSON_KEYS)


def _scrub_json(value: Any) -> Any:
    """Recursively drop PII/secret keys from a JSON structure."""
    if isinstance(value, dict):
        return {k: _scrub_json(v) for k, v in value.items() if not _sensitive_key(k)}
    if isinstance(value, list):
        return [_scrub_json(v) for v in value]
    return value


def _looks_like_pii(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    return "@" in value or bool(_UUID_RE.match(value))


def user_ref_columns(model: type) -> set[str]:
    """Columns on ``model`` that reference member identity (nulled on export).

    Detected structurally (FK → ``users``) *and* by naming convention
    (``*_by``, ``user_id``, ``*_user_id``) so plain-string user references
    without a declared FK are still caught.
    """
    cols: set[str] = set()
    for col in model.__table__.columns:
        for fk in col.foreign_keys:
            if fk.column.table.name == USERS_TABLE:
                cols.add(col.name)
        name = col.name
        if name.endswith("_by") or name == "user_id" or name.endswith("_user_id"):
            cols.add(name)
    return cols


def null_columns_for(spec: TableSpec) -> set[str]:
    """All columns forced to NULL on export for ``spec``."""
    return user_ref_columns(spec.model) | set(spec.null_columns) | set(spec.regenerate)


def _parent_table(spec: TableSpec) -> str:
    """Resolve the parent table a parent-scoped spec hangs off, via its FK."""
    col = spec.model.__table__.c[spec.parent_fk]
    fk = next(iter(col.foreign_keys))
    return fk.column.table.name


def _expand_closure(base: list[TableSpec]) -> list[TableSpec]:
    """Add every INCLUDE table referenced (transitively) by ``base``.

    Guarantees a subset export is referentially self-consistent: if a selected
    table FKs into another structural table (including its parent), that table
    travels too, so no reference dangles. (Plan §5.)
    """
    selected: dict[str, TableSpec] = {s.tablename: s for s in base}
    queue = list(base)
    while queue:
        spec = queue.pop()
        for col in spec.model.__table__.columns:
            for fk in col.foreign_keys:
                target = fk.column.table.name
                if target in INCLUDED_TABLES and target not in selected:
                    nxt = SPEC_BY_TABLE[target]
                    selected[target] = nxt
                    queue.append(nxt)
    return list(selected.values())


def _ordered(specs: list[TableSpec]) -> list[TableSpec]:
    """Parent-scoped specs after their parents (depth-first)."""
    by_table = {s.tablename: s for s in specs}
    visited: set[str] = set()
    ordered: list[TableSpec] = []

    def visit(spec: TableSpec) -> None:
        if spec.tablename in visited:
            return
        visited.add(spec.tablename)
        if spec.parent_fk:
            parent = by_table.get(_parent_table(spec))
            if parent is not None:
                visit(parent)
        ordered.append(spec)

    for spec in specs:
        visit(spec)
    return ordered


class OrgTemplateService:
    """Builds a department-template archive for one organization."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def export_template(
        self,
        organization_id: str,
        module_names: Optional[set[str]] = None,
    ) -> tuple[bytes, str, dict[str, Any]]:
        """Export the org's structural template.

        Returns ``(zip_bytes, filename, manifest)``.

        Raises ``ValueError`` if the organization does not exist.
        """
        org = await self._get_org(organization_id)
        if org is None:
            raise ValueError("Organization not found")

        specs = _ordered(_expand_closure(specs_for_modules(module_names)))

        selected_ids: dict[str, set[str]] = {}
        data: dict[str, list[dict[str, Any]]] = {}

        for spec in specs:
            rows = await self._select_rows(spec, organization_id, selected_ids)
            if spec.row_filter is not None:
                rows = [r for r in rows if spec.row_filter(r)]
            selected_ids[spec.tablename] = {str(r.id) for r in rows}
            if rows:
                data[spec.tablename] = [self._serialize_row(spec, r) for r in rows]

        data_bytes = json.dumps(data, default=_json_default, sort_keys=True).encode(
            "utf-8"
        )

        manifest = {
            "format": FORMAT_NAME,
            "format_version": FORMAT_VERSION,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "schema_revision": await self._schema_revision(),
            "source_org": {"name": org.name, "slug": org.slug},
            "modules": modules() if module_names is None else sorted(module_names),
            "tables": {name: len(rows) for name, rows in sorted(data.items())},
            "data_sha256": hashlib.sha256(data_bytes).hexdigest(),
        }
        manifest_bytes = json.dumps(
            manifest, default=_json_default, sort_keys=True, indent=2
        ).encode("utf-8")

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("manifest.json", manifest_bytes)
            archive.writestr("data.json", data_bytes)

        filename = f"{org.slug or 'department'}-template.zip"
        return buffer.getvalue(), filename, manifest

    # -- internals ---------------------------------------------------------

    async def _get_org(self, organization_id: str) -> Optional[Organization]:
        result = await self.db.execute(
            select(Organization).where(Organization.id == organization_id)
        )
        return result.scalar_one_or_none()

    async def _select_rows(
        self,
        spec: TableSpec,
        organization_id: str,
        selected_ids: dict[str, set[str]],
    ) -> list[Any]:
        model = spec.model
        if spec.parent_fk is None:
            stmt = select(model).where(model.organization_id == organization_id)
        else:
            parent_ids = selected_ids.get(_parent_table(spec), set())
            if not parent_ids:
                return []
            stmt = select(model).where(getattr(model, spec.parent_fk).in_(parent_ids))
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    def _serialize_row(self, spec: TableSpec, row: Any) -> dict[str, Any]:
        null_set = null_columns_for(spec)
        out: dict[str, Any] = {}
        for col in spec.model.__table__.columns:
            name = col.name
            if name in null_set:
                out[name] = None
                continue
            value = getattr(row, name, None)
            if name in spec.pii_scrub_columns and _looks_like_pii(value):
                out[name] = None
                continue
            if isinstance(value, (dict, list)):
                value = _scrub_json(value)
            out[name] = value
        return out

    async def _schema_revision(self) -> Optional[str]:
        try:
            result = await self.db.execute(
                text("SELECT version_num FROM alembic_version")
            )
            row = result.first()
            return row[0] if row else None
        except Exception:
            # No alembic_version table (e.g. tests on a fresh schema) — the
            # revision is a compatibility hint, never a hard dependency here.
            return None
