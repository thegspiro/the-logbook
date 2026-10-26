"""Encrypt email addresses at rest

Email addresses were stored as plain text, so a database dump or backup
carried every member's, applicant's and outside contact's address readable.
They are now AES-256-GCM ciphertext through the ``EncryptedText`` and
``EncryptedJSON`` column types: the addresses of members, applicants, guests,
storefront customers and payers, donors, officers, facility contacts,
contractors, insurance agents, vendor contact people and public event
requesters, the copies in email and notification logs, and the recipient lists
of scheduled emails, reports and alerts.

Left plain on purpose, as a department's or business's own published details
rather than a person's: the organization's address, facility and vendor
company addresses, utility-company and service-provider contacts, the org
chart's office addresses and the store's PayPal address. Election
``email_recipients`` and ``email_skipped_details`` hold user ids and names, not
addresses, and are untouched.

**Fingerprints.** Ciphertext differs on every write, so SQL can no longer
compare an address. Where the application matches one, a keyed HMAC of the
normalized address (``email_fingerprint`` in ``app.core.security``) is stored
beside it: ``users.email_hash``, ``prospective_members.email_hash``,
``event_external_attendees.email_hash``, ``store_orders.customer_email_hash``
and ``donors.email_hash``, plus ``message_history.recipient_fingerprints``, one
per To address. The uniqueness rules move with them:

- one member per address per organization: ``(organization_id, email_hash)``;
- one active application per address per organization: the generated
  ``active_email_hash`` column, which replaces ``active_email``.

Before changing anything, the upgrade checks that no two members of one
organization, and no two active applications, share an address once it is
trimmed and lower-cased. The old indexes compared case-blind and ignored
trailing spaces but not leading ones, so " a@x.org" and "a@x.org" could both
exist. If any pair does, it stops with the row ids and changes nothing.

Older message history rows summarised a large batch as "a@x, b@y… (+N more)";
only the addresses kept in that summary get a fingerprint, so search finds an
old batch by those addresses alone. New rows fingerprint every recipient.

The backfill encrypts every existing value in place and is safe to run twice:
a value already carrying the ciphertext prefix is decrypted to compute its
fingerprint and is not encrypted again. With rows to encrypt,
``ENCRYPTION_KEY`` must be set; the migration refuses rather than write
ciphertext nobody can read back.

The downgrade decrypts every value, drops the fingerprints and restores the
original types and indexes. The old unique indexes compared under the
accent- and case-insensitive collation, so two addresses written after the
upgrade that differ only by an accent ("é@x.org", "e@x.org") stop the
downgrade at the index rebuild, after the values are decrypted.

Revision ID: b8236e29ec44
Revises: 1ad0b594f3fb
Create Date: 2026-10-26 12:11:03.218374

"""

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b8236e29ec44"
down_revision: Union[str, None] = "1ad0b594f3fb"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# table -> [(column, type before, nullable)]: single addresses.
_SCALAR = {
    "users": [
        ("email", sa.String(255), False),
        ("personal_email", sa.String(255), True),
    ],
    "prospects": [("email", sa.String(255), True)],
    "prospective_members": [("email", sa.String(255), False)],
    "event_external_attendees": [("email", sa.String(255), True)],
    "store_orders": [("customer_email", sa.String(255), True)],
    "store_payment_events": [("payer_email", sa.String(255), True)],
    "directory_account_provisions": [("primary_email", sa.String(255), False)],
    "message_history": [("to_email", sa.String(320), False)],
    "donors": [("email", sa.String(255), True)],
    "donations": [("donor_email", sa.String(255), True)],
    "external_user_mappings": [("external_email", sa.String(255), True)],
    "xapi_statements": [("actor_email", sa.String(255), True)],
    "onboarding_status": [("admin_email", sa.String(255), True)],
    "organization_officers": [("email", sa.String(320), True)],
    "facility_emergency_contacts": [("email", sa.String(200), True)],
    "facility_capital_projects": [("contractor_email", sa.String(200), True)],
    "facility_insurance_policies": [("agent_email", sa.String(200), True)],
    "inventory_vendor_contacts": [("email", sa.String(255), True)],
    "form_submissions": [("submitter_email", sa.String(255), True)],
    "notification_logs": [("recipient_email", sa.String(255), True)],
    "event_requests": [("contact_email", sa.String(255), False)],
}

# table -> [(column, nullable)]: JSON lists of addresses.
_JSON = {
    "scheduled_emails": [
        ("to_emails", False),
        ("cc_emails", True),
        ("bcc_emails", True),
    ],
    "message_history": [("cc_emails", True), ("bcc_emails", True)],
    "compliance_configs": [("report_email_recipients", True)],
    "compliance_reports": [("emailed_to", True)],
    "approval_chain_steps": [("notification_emails", True)],
    "saved_reports": [("email_recipients", True)],
    "forms": [("notification_emails", True)],
    "apparatus_report_configs": [("email_recipients", True)],
}

# table -> (address column, fingerprint column)
_FINGERPRINTS = {
    "users": ("email", "email_hash"),
    "prospective_members": ("email", "email_hash"),
    "event_external_attendees": ("email", "email_hash"),
    "store_orders": ("customer_email", "customer_email_hash"),
    "donors": ("email", "email_hash"),
}

# table -> [(name, columns, unique)], created once the fingerprints exist.
_NEW_INDEXES = {
    "users": [("idx_user_org_email_hash", ["organization_id", "email_hash"], True)],
    "prospective_members": [
        ("idx_prospect_org_email_hash", ["organization_id", "email_hash"], False)
    ],
    "event_external_attendees": [
        ("ix_ext_attendees_email_hash", ["email_hash"], False)
    ],
    "store_orders": [
        (
            "ix_store_orders_org_customer_email_hash",
            ["organization_id", "customer_email_hash"],
            False,
        )
    ],
    "donors": [("idx_donors_email_hash", ["organization_id", "email_hash"], False)],
}

# table -> [(name, columns, unique)], recreated by the downgrade. The upgrade
# drops whatever index covers an address column, whatever it is called, since
# an older installation's names need not match these.
_OLD_INDEXES = {
    "users": [
        ("idx_user_email", ["email"], False),
        ("idx_user_org_email", ["organization_id", "email"], True),
    ],
    "prospects": [("idx_prospect_org_email", ["organization_id", "email"], False)],
    "prospective_members": [
        ("idx_prospect_org_email", ["organization_id", "email"], False)
    ],
    "event_external_attendees": [("ix_ext_attendees_email", ["email"], False)],
    "donors": [("idx_donors_email", ["organization_id", "email"], False)],
    "xapi_statements": [("idx_xapi_actor", ["actor_email"], False)],
}

_MESSAGE_HISTORY = "message_history"
_PROSPECTS = "prospective_members"
_ACTIVE_OLD = ("active_email", "uq_prospect_org_active_email")
_ACTIVE_NEW = ("active_email_hash", "uq_prospect_org_active_email_hash")

# (table, scope columns, extra SQL condition) whose fingerprint must be unique.
_UNIQUE_CHECKS = [
    ("users", ["organization_id"], None),
    ("prospective_members", ["organization_id"], "status = 'active'"),
]

# Frozen on purpose: a migration must keep transforming rows the way it did the
# day it ran, so it does not import the application's prefix constant.
_CIPHERTEXT_PREFIXES = ("$gcm1$", "$gcm2$")
_PAGE = 500


def _is_ciphertext(value: str) -> bool:
    return value.startswith(_CIPHERTEXT_PREFIXES)


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(table: str) -> bool:
    """Several of these tables (``prospects``, ``event_requests`` and others)
    are built only by ``create_all`` at startup, so they are absent from the
    empty database CI migrates. Skipping is correct: ``create_all`` builds them
    from the models, already in their new shape."""
    return table in _inspector().get_table_names()


def _columns(table: str) -> set[str]:
    return {c["name"] for c in _inspector().get_columns(table)}


def _require_key() -> None:
    from app.core.config import settings

    if not settings.ENCRYPTION_KEY:
        raise RuntimeError(
            "ENCRYPTION_KEY must be set to encrypt email addresses; refusing to "
            "write ciphertext that cannot be read back."
        )


def _plain(value: str) -> str:
    from app.core.security import decrypt_data

    return decrypt_data(value) if _is_ciphertext(value) else value


def _summary_addresses(summary: str) -> list[str]:
    """The addresses written into a message history ``to_email`` summary."""
    head = summary.split("…", 1)[0]
    return [part.strip() for part in head.split(",") if "@" in part]


def _rows(table: str, columns: list[str]):
    """Every row's id and ``columns``, a page at a time, in id order."""
    conn = op.get_bind()
    last = ""
    while True:
        page = conn.execute(
            sa.text(
                f"SELECT id, {', '.join(columns)} FROM {table} "
                "WHERE id > :last ORDER BY id LIMIT :limit"
            ),
            {"last": last, "limit": _PAGE},
        ).fetchall()
        if not page:
            return
        yield from page
        last = page[-1][0]


def _check_unique_fingerprints() -> None:
    from app.core.security import normalize_email

    clashes = []
    for table, scope, condition in _UNIQUE_CHECKS:
        if not _has_table(table):
            continue
        address = _FINGERPRINTS[table][0]
        where = f" WHERE {condition}" if condition else ""
        rows = (
            op.get_bind()
            .execute(
                sa.text(f"SELECT id, {', '.join(scope)}, {address} FROM {table}{where}")
            )
            .fetchall()
        )
        seen: dict[tuple, str] = {}
        for row in rows:
            value = row[-1]
            if value is None or not str(value).strip():
                continue
            key = (*row[1:-1], normalize_email(_plain(str(value))))
            if key in seen:
                clashes.append(f"{table}: {seen[key]} and {row[0]}")
            else:
                seen[key] = row[0]
    if clashes:
        raise RuntimeError(
            "These rows share an email address once it is trimmed and "
            "lower-cased, which the new uniqueness rule cannot allow. Correct "
            "one address in each pair and start again; nothing has been "
            "changed. " + "; ".join(clashes)
        )


def _drop_address_indexes(table: str, columns: set[str]) -> None:
    for index in _inspector().get_indexes(table):
        if columns & set(index["column_names"]):
            op.drop_index(index["name"], table_name=table)


def _encrypt_rows(table: str) -> None:
    from app.core.security import email_fingerprint, encrypt_data

    scalar = [c for c, _t, _n in _SCALAR.get(table, []) if c in _columns(table)]
    as_json = [c for c, _n in _JSON.get(table, []) if c in _columns(table)]
    fingerprint = _FINGERPRINTS.get(table)
    read = scalar + as_json
    if not read:
        return
    conn = op.get_bind()
    for row in _rows(table, read):
        values = dict(zip(read, row[1:]))
        updates = {}
        for column in read:
            value = values[column]
            if value is None or str(value) == "":
                continue
            if not _is_ciphertext(str(value)):
                _require_key()
                updates[column] = encrypt_data(str(value))
        if fingerprint and values.get(fingerprint[0]):
            updates[fingerprint[1]] = email_fingerprint(
                _plain(str(values[fingerprint[0]]))
            )
        if table == _MESSAGE_HISTORY and values.get("to_email"):
            summary = _plain(str(values["to_email"]))
            prints = [
                fp
                for fp in (email_fingerprint(a) for a in _summary_addresses(summary))
                if fp
            ]
            updates["recipient_fingerprints"] = json.dumps(list(dict.fromkeys(prints)))
        if updates:
            sets = ", ".join(f"{c} = :{c}" for c in updates)
            conn.execute(
                sa.text(f"UPDATE {table} SET {sets} WHERE id = :row_id"),
                {**updates, "row_id": row[0]},
            )


def _require_key_if_rows() -> None:
    """Refuse before any DDL, so a missing key leaves the schema untouched."""
    from app.core.config import settings

    if settings.ENCRYPTION_KEY:
        return
    conn = op.get_bind()
    for table in sorted(set(_SCALAR) | set(_JSON)):
        if not _has_table(table):
            continue
        present = _columns(table)
        columns = [c for c, _t, _n in _SCALAR.get(table, []) if c in present] + [
            c for c, _n in _JSON.get(table, []) if c in present
        ]
        if not columns:
            continue
        has_any = " OR ".join(f"{c} IS NOT NULL" for c in columns)
        if conn.execute(
            sa.text(f"SELECT 1 FROM {table} WHERE {has_any} LIMIT 1")
        ).first():
            _require_key()


def upgrade() -> None:
    _require_key_if_rows()
    _check_unique_fingerprints()

    tables = sorted(set(_SCALAR) | set(_JSON))
    for table in tables:
        if not _has_table(table):
            continue
        present = _columns(table)
        address_columns = {c for c, _t, _n in _SCALAR.get(table, [])} | {
            c for c, _n in _JSON.get(table, [])
        }
        if table == _PROSPECTS:
            address_columns.add(_ACTIVE_OLD[0])
        _drop_address_indexes(table, address_columns & present)
        if table == _PROSPECTS and _ACTIVE_OLD[0] in present:
            op.drop_column(table, _ACTIVE_OLD[0])

        for column, before, nullable in _SCALAR.get(table, []):
            if column in present:
                op.alter_column(
                    table,
                    column,
                    existing_type=before,
                    type_=sa.Text(),
                    existing_nullable=nullable,
                )
        for column, nullable in _JSON.get(table, []):
            if column in present:
                # Altered unconditionally: on MariaDB a JSON column reflects as
                # LONGTEXT with a json_valid() check that would reject
                # ciphertext; converting it to TEXT drops the check.
                op.alter_column(
                    table,
                    column,
                    existing_type=sa.JSON(),
                    type_=sa.Text(),
                    existing_nullable=nullable,
                )

        if table in _FINGERPRINTS and _FINGERPRINTS[table][1] not in present:
            op.add_column(
                table,
                sa.Column(_FINGERPRINTS[table][1], sa.String(64), nullable=True),
            )
        if table == _MESSAGE_HISTORY and "recipient_fingerprints" not in present:
            op.add_column(
                table, sa.Column("recipient_fingerprints", sa.JSON(), nullable=True)
            )

        _encrypt_rows(table)

        existing = {index["name"] for index in _inspector().get_indexes(table)}
        for name, columns, unique in _NEW_INDEXES.get(table, []):
            if name not in existing:
                op.create_index(name, table, columns, unique=unique)
        if table == _PROSPECTS:
            if _ACTIVE_NEW[0] not in _columns(table):
                op.execute(
                    f"ALTER TABLE {table} ADD COLUMN {_ACTIVE_NEW[0]} VARCHAR(64) "
                    "GENERATED ALWAYS AS ("
                    "  CASE WHEN status = 'active' THEN email_hash ELSE NULL END"
                    ") STORED"
                )
            if _ACTIVE_NEW[1] not in existing:
                op.create_index(
                    _ACTIVE_NEW[1],
                    table,
                    ["organization_id", _ACTIVE_NEW[0]],
                    unique=True,
                )


def _decrypt_rows(table: str) -> None:
    from app.core.security import decrypt_data

    scalar = [c for c, _t, _n in _SCALAR.get(table, []) if c in _columns(table)]
    as_json = [c for c, _n in _JSON.get(table, []) if c in _columns(table)]
    read = scalar + as_json
    if not read:
        return
    conn = op.get_bind()
    for row in _rows(table, read):
        updates = {
            column: decrypt_data(str(value))
            for column, value in zip(read, row[1:])
            if value is not None and _is_ciphertext(str(value))
        }
        if updates:
            sets = ", ".join(f"{c} = :{c}" for c in updates)
            conn.execute(
                sa.text(f"UPDATE {table} SET {sets} WHERE id = :row_id"),
                {**updates, "row_id": row[0]},
            )


def downgrade() -> None:
    tables = sorted(set(_SCALAR) | set(_JSON), reverse=True)
    for table in tables:
        if not _has_table(table):
            continue
        existing = {index["name"] for index in _inspector().get_indexes(table)}
        for name, _columns_, _unique in _NEW_INDEXES.get(table, []):
            if name in existing:
                op.drop_index(name, table_name=table)
        if table == _PROSPECTS:
            if _ACTIVE_NEW[1] in existing:
                op.drop_index(_ACTIVE_NEW[1], table_name=table)
            if _ACTIVE_NEW[0] in _columns(table):
                op.drop_column(table, _ACTIVE_NEW[0])

        _decrypt_rows(table)

        present = _columns(table)
        if table in _FINGERPRINTS and _FINGERPRINTS[table][1] in present:
            op.drop_column(table, _FINGERPRINTS[table][1])
        if table == _MESSAGE_HISTORY and "recipient_fingerprints" in present:
            op.drop_column(table, "recipient_fingerprints")

        for column, before, nullable in _SCALAR.get(table, []):
            if column in present:
                op.alter_column(
                    table,
                    column,
                    existing_type=sa.Text(),
                    type_=before,
                    existing_nullable=nullable,
                )
        for column, nullable in _JSON.get(table, []):
            if column in present:
                op.alter_column(
                    table,
                    column,
                    existing_type=sa.Text(),
                    type_=sa.JSON(),
                    existing_nullable=nullable,
                )

        existing = {index["name"] for index in _inspector().get_indexes(table)}
        for name, columns, unique in _OLD_INDEXES.get(table, []):
            if name not in existing and set(columns) <= _columns(table):
                op.create_index(name, table, columns, unique=unique)
        if table == _PROSPECTS:
            if _ACTIVE_OLD[0] not in _columns(table):
                op.execute(
                    f"ALTER TABLE {table} ADD COLUMN {_ACTIVE_OLD[0]} VARCHAR(255) "
                    "GENERATED ALWAYS AS ("
                    "  CASE WHEN status = 'active' THEN email ELSE NULL END"
                    ") STORED"
                )
            if _ACTIVE_OLD[1] not in existing:
                op.create_index(
                    _ACTIVE_OLD[1],
                    table,
                    ["organization_id", _ACTIVE_OLD[0]],
                    unique=True,
                )
