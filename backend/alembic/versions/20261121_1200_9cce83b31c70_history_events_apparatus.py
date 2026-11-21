"""History phase 5: events, timelines and historical apparatus

New tables:

- ``history_stations``, ``history_apparatus_types`` and
  ``history_event_types``: three managed lists, kept like sources.
- ``history_apparatus``: a historical apparatus and its catalogue, with the
  same publication and revision columns as ``history_media``. Research notes
  are encrypted text. ``fleet_apparatus_id`` points at the Apparatus-module
  truck it was made from, if any (SET NULL), and is unique per department.
- ``history_apparatus_designations``: a truck's unit numbers over time.
- ``history_events``: an event, published like the other records. Its start
  date is required: an undated event cannot be placed on a timeline.
- ``history_event_members`` (with a role), ``history_event_apparatus``,
  ``history_event_media`` and ``history_event_documents``: what an event
  links to.
- ``history_media_apparatus_tags`` and ``history_document_apparatus_tags``:
  apparatus tagged on photos and documents.

Columns added to existing tables:

- ``history_titles.show_on_timeline``: NOT NULL with a server default of 0,
  so every existing title is off, which is the owner's default.
- ``historical_member_period_titles``: ``held_from_*`` and ``held_to_*``. The
  dates are nullable and every existing row simply has none; the precision
  columns are NOT NULL with a server default of ``year`` and the circa flags
  default to 0, so the rows already there are settled by the defaults
  (pitfall #35). Nothing is backfilled: a title's dates are never guessed
  from its service period.

Every step is skipped when its table or column already exists, so a database
``create_all`` built first upgrades cleanly (pitfall #26).

Downgrade drops the new tables and columns and everything recorded in them:
every event, apparatus record and their links, the station and type lists,
the timeline switch on titles and the dates entered on titles. Take a database
backup (``scripts/backup.sh``) before downgrading past this revision.

Revision ID: 9cce83b31c70
Revises: 1a5c18b46791
Create Date: 2026-11-21 12:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "9cce83b31c70"
down_revision: Union[str, None] = "1a5c18b46791"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Frozen copies of the enum values at this revision.
_PRECISION = ("day", "month", "year")
_LEVEL = ("draft", "members", "public")
_DISPOSITION = (
    "in_service",
    "sold",
    "traded",
    "scrapped",
    "preserved",
    "museum",
    "unknown",
)

# Table and key names, as module constants so the migration test can run it
# on prefixed scratch tables in the real database.
ORGANIZATIONS = "organizations"
USERS = "users"
FLEET = "apparatus"
MEMBERS = "historical_members"
SOURCES = "history_sources"
MEDIA = "history_media"
DOCUMENTS = "history_documents"
TITLES = "history_titles"
PERIOD_TITLES = "historical_member_period_titles"

STATIONS = "history_stations"
APPARATUS_TYPES = "history_apparatus_types"
EVENT_TYPES = "history_event_types"
APPARATUS = "history_apparatus"
DESIGNATIONS = "history_apparatus_designations"
EVENTS = "history_events"
EVENT_MEMBERS = "history_event_members"
EVENT_APPARATUS = "history_event_apparatus"
EVENT_MEDIA = "history_event_media"
EVENT_DOCUMENTS = "history_event_documents"
MEDIA_APPARATUS = "history_media_apparatus_tags"
DOCUMENT_APPARATUS = "history_document_apparatus_tags"

UQ_STATION_KEY = "uq_history_station_key"
UQ_APPARATUS_TYPE_KEY = "uq_history_apparatus_type_key"
UQ_EVENT_TYPE_KEY = "uq_history_event_type_key"
UQ_APPARATUS_FLEET = "uq_history_apparatus_fleet"
IX_APPARATUS_ORG_LEVEL = "ix_history_apparatus_org_level"
IX_APPARATUS_ORG_TYPE = "ix_history_apparatus_org_type"
IX_APPARATUS_ORG_IN_SERVICE = "ix_history_apparatus_org_in_service"
IX_APPARATUS_SOURCE = "ix_history_apparatus_source"
IX_DESIGNATIONS_APPARATUS = "ix_history_designations_apparatus"
IX_DESIGNATIONS_STATION = "ix_history_designations_station"
IX_EVENTS_ORG_LEVEL = "ix_history_events_org_level"
IX_EVENTS_ORG_START = "ix_history_events_org_start"
IX_EVENTS_ORG_TYPE = "ix_history_events_org_type"
IX_EVENTS_STATION = "ix_history_events_station"
IX_EVENTS_SOURCE = "ix_history_events_source"
IX_EVENT_MEMBERS_MEMBER = "ix_history_event_members_member"
IX_EVENT_APPARATUS_APPARATUS = "ix_history_event_apparatus_apparatus"
IX_EVENT_MEDIA_MEDIA = "ix_history_event_media_media"
IX_EVENT_DOCUMENTS_DOCUMENT = "ix_history_event_documents_document"
IX_MEDIA_APPARATUS_APPARATUS = "ix_history_media_apparatus_apparatus"
IX_DOCUMENT_APPARATUS_APPARATUS = "ix_history_document_apparatus_apparatus"

#: Columns added to existing tables, in the order they are added.
TITLE_COLUMNS = ("show_on_timeline",)
PERIOD_TITLE_COLUMNS = (
    "held_from_date",
    "held_from_precision",
    "held_from_circa",
    "held_to_date",
    "held_to_precision",
    "held_to_circa",
)


def _has_table(table: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table)


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _org() -> sa.Column:
    return sa.Column(
        "organization_id",
        sa.String(36),
        sa.ForeignKey(f"{ORGANIZATIONS}.id", ondelete="CASCADE"),
        nullable=False,
    )


def _user_fk(name: str) -> sa.Column:
    return sa.Column(
        name,
        sa.String(36),
        sa.ForeignKey(f"{USERS}.id", ondelete="SET NULL"),
        nullable=True,
    )


def _nullable_fk(name: str, target: str) -> sa.Column:
    return sa.Column(
        name,
        sa.String(36),
        sa.ForeignKey(target, ondelete="SET NULL"),
        nullable=True,
    )


def _key(name: str, target: str) -> sa.Column:
    return sa.Column(
        name,
        sa.String(36),
        sa.ForeignKey(target, ondelete="CASCADE"),
        primary_key=True,
    )


def _created_at() -> sa.Column:
    return sa.Column(
        "created_at",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    )


def _updated_at() -> sa.Column:
    return sa.Column(
        "updated_at",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    )


def _flag(name: str) -> sa.Column:
    return sa.Column(name, sa.Boolean(), nullable=False, server_default="0")


def _precision(name: str) -> sa.Column:
    return sa.Column(
        name,
        sa.Enum(*_PRECISION, name="dateprecision"),
        nullable=False,
        server_default="year",
    )


def _partial_date(prefix: str, *, required: bool = False) -> list[sa.Column]:
    return [
        sa.Column(f"{prefix}_date", sa.Date(), nullable=not required),
        _precision(f"{prefix}_precision"),
        _flag(f"{prefix}_circa"),
    ]


def _publication() -> list[sa.Column]:
    return [
        sa.Column(
            "publication_level",
            sa.Enum(*_LEVEL, name="publicationlevel"),
            nullable=False,
            server_default="draft",
        ),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        _user_fk("published_by"),
        sa.Column("public_snapshot", sa.JSON(), nullable=True),
        sa.Column("public_revision_number", sa.Integer(), nullable=True),
        sa.Column(
            "substantial_revision_number",
            sa.Integer(),
            nullable=False,
            server_default="1",
        ),
        sa.Column("revision_number", sa.Integer(), nullable=False, server_default="1"),
        _user_fk("created_by"),
        _user_fk("updated_by"),
        _created_at(),
        _updated_at(),
    ]


def _managed_list(table: str, unique_name: str) -> None:
    if _has_table(table):
        return
    op.create_table(
        table,
        sa.Column("id", sa.String(36), primary_key=True),
        _org(),
        sa.Column("name", sa.String(150), nullable=False),
        sa.Column("name_key", sa.String(150), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        _flag("is_retired"),
        _user_fk("created_by"),
        _created_at(),
        _updated_at(),
        sa.UniqueConstraint("organization_id", "name_key", name=unique_name),
    )


def _upgrade_existing_tables() -> None:
    if _has_table(TITLES) and not _has_column(TITLES, "show_on_timeline"):
        op.add_column(TITLES, _flag("show_on_timeline"))
    if _has_table(PERIOD_TITLES):
        for column in [*_partial_date("held_from"), *_partial_date("held_to")]:
            if not _has_column(PERIOD_TITLES, column.name):
                op.add_column(PERIOD_TITLES, column)


def upgrade() -> None:
    _upgrade_existing_tables()

    _managed_list(STATIONS, UQ_STATION_KEY)
    _managed_list(APPARATUS_TYPES, UQ_APPARATUS_TYPE_KEY)
    _managed_list(EVENT_TYPES, UQ_EVENT_TYPE_KEY)

    if not _has_table(APPARATUS):
        op.create_table(
            APPARATUS,
            sa.Column("id", sa.String(36), primary_key=True),
            _org(),
            sa.Column("name", sa.String(200), nullable=False),
            _nullable_fk("apparatus_type_id", f"{APPARATUS_TYPES}.id"),
            sa.Column("year", sa.Integer(), nullable=True),
            sa.Column("make", sa.String(100), nullable=True),
            sa.Column("model", sa.String(100), nullable=True),
            sa.Column("body_builder", sa.String(100), nullable=True),
            sa.Column("pump_gpm", sa.Integer(), nullable=True),
            sa.Column("tank_gallons", sa.Integer(), nullable=True),
            sa.Column("ladder_feet", sa.Integer(), nullable=True),
            *_partial_date("in_service"),
            *_partial_date("out_of_service"),
            sa.Column(
                "disposition",
                sa.Enum(*_DISPOSITION, name="apparatusdisposition"),
                nullable=False,
                server_default="unknown",
            ),
            sa.Column("current_location", sa.String(255), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            # Encrypted text.
            sa.Column("research_notes", sa.Text(), nullable=True),
            _nullable_fk("source_id", f"{SOURCES}.id"),
            sa.Column("accession_number", sa.String(100), nullable=True),
            _nullable_fk("fleet_apparatus_id", f"{FLEET}.id"),
            *_publication(),
            sa.UniqueConstraint(
                "organization_id", "fleet_apparatus_id", name=UQ_APPARATUS_FLEET
            ),
        )
        op.create_index(
            IX_APPARATUS_ORG_LEVEL, APPARATUS, ["organization_id", "publication_level"]
        )
        op.create_index(
            IX_APPARATUS_ORG_TYPE, APPARATUS, ["organization_id", "apparatus_type_id"]
        )
        op.create_index(
            IX_APPARATUS_ORG_IN_SERVICE,
            APPARATUS,
            ["organization_id", "in_service_date"],
        )
        op.create_index(IX_APPARATUS_SOURCE, APPARATUS, ["source_id"])

    if not _has_table(DESIGNATIONS):
        op.create_table(
            DESIGNATIONS,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column(
                "apparatus_id",
                sa.String(36),
                sa.ForeignKey(f"{APPARATUS}.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("designation", sa.String(100), nullable=False),
            _nullable_fk("station_id", f"{STATIONS}.id"),
            *_partial_date("start"),
            *_partial_date("end"),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            _created_at(),
        )
        op.create_index(IX_DESIGNATIONS_APPARATUS, DESIGNATIONS, ["apparatus_id"])
        op.create_index(IX_DESIGNATIONS_STATION, DESIGNATIONS, ["station_id"])

    if not _has_table(EVENTS):
        op.create_table(
            EVENTS,
            sa.Column("id", sa.String(36), primary_key=True),
            _org(),
            sa.Column("title", sa.String(200), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            *_partial_date("start", required=True),
            *_partial_date("end"),
            sa.Column("place", sa.String(255), nullable=True),
            _nullable_fk("station_id", f"{STATIONS}.id"),
            _nullable_fk("event_type_id", f"{EVENT_TYPES}.id"),
            # Encrypted text.
            sa.Column("research_notes", sa.Text(), nullable=True),
            _nullable_fk("source_id", f"{SOURCES}.id"),
            *_publication(),
        )
        op.create_index(
            IX_EVENTS_ORG_LEVEL, EVENTS, ["organization_id", "publication_level"]
        )
        op.create_index(IX_EVENTS_ORG_START, EVENTS, ["organization_id", "start_date"])
        op.create_index(
            IX_EVENTS_ORG_TYPE, EVENTS, ["organization_id", "event_type_id"]
        )
        op.create_index(IX_EVENTS_STATION, EVENTS, ["station_id"])
        op.create_index(IX_EVENTS_SOURCE, EVENTS, ["source_id"])

    if not _has_table(EVENT_MEMBERS):
        op.create_table(
            EVENT_MEMBERS,
            _key("event_id", f"{EVENTS}.id"),
            _key("member_id", f"{MEMBERS}.id"),
            sa.Column("role", sa.String(100), nullable=True),
            _user_fk("created_by"),
            _created_at(),
        )
        op.create_index(IX_EVENT_MEMBERS_MEMBER, EVENT_MEMBERS, ["member_id"])

    if not _has_table(EVENT_APPARATUS):
        op.create_table(
            EVENT_APPARATUS,
            _key("event_id", f"{EVENTS}.id"),
            _key("apparatus_id", f"{APPARATUS}.id"),
            _created_at(),
        )
        op.create_index(IX_EVENT_APPARATUS_APPARATUS, EVENT_APPARATUS, ["apparatus_id"])

    if not _has_table(EVENT_MEDIA):
        op.create_table(
            EVENT_MEDIA,
            _key("event_id", f"{EVENTS}.id"),
            _key("media_id", f"{MEDIA}.id"),
            sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
            _created_at(),
        )
        op.create_index(IX_EVENT_MEDIA_MEDIA, EVENT_MEDIA, ["media_id"])

    if not _has_table(EVENT_DOCUMENTS):
        op.create_table(
            EVENT_DOCUMENTS,
            _key("event_id", f"{EVENTS}.id"),
            _key("document_id", f"{DOCUMENTS}.document_id"),
            sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
            _created_at(),
        )
        op.create_index(IX_EVENT_DOCUMENTS_DOCUMENT, EVENT_DOCUMENTS, ["document_id"])

    if not _has_table(MEDIA_APPARATUS):
        op.create_table(
            MEDIA_APPARATUS,
            _key("media_id", f"{MEDIA}.id"),
            _key("apparatus_id", f"{APPARATUS}.id"),
            _user_fk("created_by"),
            _created_at(),
        )
        op.create_index(IX_MEDIA_APPARATUS_APPARATUS, MEDIA_APPARATUS, ["apparatus_id"])

    if not _has_table(DOCUMENT_APPARATUS):
        op.create_table(
            DOCUMENT_APPARATUS,
            _key("document_id", f"{DOCUMENTS}.document_id"),
            _key("apparatus_id", f"{APPARATUS}.id"),
            _user_fk("created_by"),
            _created_at(),
        )
        op.create_index(
            IX_DOCUMENT_APPARATUS_APPARATUS, DOCUMENT_APPARATUS, ["apparatus_id"]
        )


def downgrade() -> None:
    # Children before parents, so no foreign key blocks a drop.
    for table in (
        DOCUMENT_APPARATUS,
        MEDIA_APPARATUS,
        EVENT_DOCUMENTS,
        EVENT_MEDIA,
        EVENT_APPARATUS,
        EVENT_MEMBERS,
        EVENTS,
        DESIGNATIONS,
        APPARATUS,
        EVENT_TYPES,
        APPARATUS_TYPES,
        STATIONS,
    ):
        if _has_table(table):
            op.drop_table(table)
    if _has_table(PERIOD_TITLES):
        for column in reversed(PERIOD_TITLE_COLUMNS):
            if _has_column(PERIOD_TITLES, column):
                op.drop_column(PERIOD_TITLES, column)
    if _has_table(TITLES):
        for column in TITLE_COLUMNS:
            if _has_column(TITLES, column):
                op.drop_column(TITLES, column)
