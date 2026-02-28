"""Add security_alerts table for persistent alert storage

Revision ID: 20260228_0100
Revises: 20260227_0300
Create Date: 2026-02-28

Persists security alerts to the database so they survive server
restarts. Supports acknowledge/resolve workflows with actor tracking.
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers
revision = "20260228_0100"
down_revision = "20260227_0300"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "security_alerts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "alert_type",
            sa.Enum(
                "brute_force",
                "session_hijack",
                "data_exfiltration",
                "log_tampering",
                "anomaly_detected",
                "unauthorized_access",
                "privilege_escalation",
                "suspicious_activity",
                "external_data_transfer",
                "rate_limit_exceeded",
                name="alerttype",
            ),
            nullable=False,
        ),
        sa.Column(
            "threat_level",
            sa.Enum("low", "medium", "high", "critical", name="threatlevel"),
            nullable=False,
        ),
        sa.Column(
            "timestamp",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("source_ip", sa.String(45), nullable=True),
        sa.Column("user_id", sa.String(36), nullable=True),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("acknowledged", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("acknowledged_by", sa.String(255), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("resolved_by", sa.String(255), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )

    op.create_index("idx_security_alert_timestamp", "security_alerts", ["timestamp"])
    op.create_index(
        "idx_security_alert_type_level",
        "security_alerts",
        ["alert_type", "threat_level"],
    )
    op.create_index(
        "ix_security_alerts_alert_type", "security_alerts", ["alert_type"]
    )
    op.create_index(
        "ix_security_alerts_threat_level", "security_alerts", ["threat_level"]
    )
    op.create_index("ix_security_alerts_user_id", "security_alerts", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_security_alerts_user_id", table_name="security_alerts")
    op.drop_index("ix_security_alerts_threat_level", table_name="security_alerts")
    op.drop_index("ix_security_alerts_alert_type", table_name="security_alerts")
    op.drop_index("idx_security_alert_type_level", table_name="security_alerts")
    op.drop_index("idx_security_alert_timestamp", table_name="security_alerts")
    op.drop_table("security_alerts")
    op.execute("DROP TYPE IF EXISTS alerttype")
    op.execute("DROP TYPE IF EXISTS threatlevel")
