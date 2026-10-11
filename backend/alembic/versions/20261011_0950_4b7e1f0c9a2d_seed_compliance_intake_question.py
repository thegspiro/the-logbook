"""Give the seeded Compliance boxes their default intake question

New departments get the question at onboarding
(``SuggestionService.seed_compliance_box``). This adds it to existing
departments' Compliance boxes: a required "What kind of concern is this?",
plus "Is anyone at immediate risk?" shown only for a safety concern. Neither
routes anywhere.

**Only a box that is still exactly what the seed wrote gets it**, by the same
signature ``7d2b4e8a1c35`` used, because this is an addition and an addition
needs positive evidence that nobody has shaped the box:

* named ``Compliance`` with the seeded description and no creator;
* ``updated_at`` still equals ``created_at``, so no administrator has saved it
  (``7d2b4e8a1c35``'s own UPDATE is raw SQL and does not move ``updated_at``);
* no questions yet.

If this is wrong about a box, the cost is a question an administrator can
remove. It discloses nothing.

The downgrade removes the question only where it is still exactly the frozen
copy below on a still-unedited seeded box, and leaves anything else alone.

Revision ID: 4b7e1f0c9a2d
Revises: 778c3de73086
Create Date: 2026-10-11 09:50:00.000000

"""

import json
from typing import Any, Dict, List, Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "4b7e1f0c9a2d"
down_revision: Union[str, None] = "778c3de73086"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Frozen copy of what 3c918c06466d wrote.
_BOX_NAME = "Compliance"
_BOX_DESCRIPTION = (
    "Report a compliance concern: a policy, safety, training-record or "
    "regulatory issue. Reviewed by the Compliance Officer."
)

# Frozen copy of COMPLIANCE_INTAKE_QUESTIONS as it read when this revision was
# written. The service constant is free to change; this must not.
_QUESTIONS: List[Dict[str, Any]] = [
    {
        "id": "compliance_concern_type",
        "label": "What kind of concern is this?",
        "help_text": None,
        "type": "radio",
        "required": True,
        "options": [
            {
                "value": "policy",
                "label": "Policy or procedure",
                "route_to_box_id": None,
            },
            {"value": "safety", "label": "Safety", "route_to_box_id": None},
            {
                "value": "training_record",
                "label": "Training record",
                "route_to_box_id": None,
            },
            {
                "value": "regulatory",
                "label": "Regulatory or legal",
                "route_to_box_id": None,
            },
            {"value": "other", "label": "Other", "route_to_box_id": None},
        ],
        "condition_question_id": None,
        "condition_operator": None,
        "condition_value": None,
    },
    {
        "id": "compliance_immediate_risk",
        "label": "Is anyone at immediate risk?",
        "help_text": (
            "This box is not watched around the clock. If someone is in danger "
            "now, contact the officer on duty or emergency services directly."
        ),
        "type": "radio",
        "required": True,
        "options": [
            {"value": "yes", "label": "Yes", "route_to_box_id": None},
            {"value": "no", "label": "No", "route_to_box_id": None},
        ],
        "condition_question_id": "compliance_concern_type",
        "condition_operator": "equals",
        "condition_value": "safety",
    },
]

_UNEDITED_SEED = (
    "name = :name AND description = :description "
    "AND created_by IS NULL AND updated_at = created_at"
)


def _ready() -> bool:
    # Defensive only: the table is created by 80e2004cd691 and the column by
    # 778c3de73086.
    inspector = sa.inspect(op.get_bind())
    if "suggestion_boxes" not in inspector.get_table_names():
        return False
    columns = {c["name"] for c in inspector.get_columns("suggestion_boxes")}
    return "intake_questions" in columns


def _seed_params() -> Dict[str, str]:
    return {"name": _BOX_NAME, "description": _BOX_DESCRIPTION}


def upgrade() -> None:
    if not _ready():
        return
    op.get_bind().execute(
        sa.text(
            "UPDATE suggestion_boxes SET intake_questions = :questions "
            f"WHERE intake_questions IS NULL AND {_UNEDITED_SEED}"
        ).bindparams(sa.bindparam("questions", type_=sa.JSON)),
        {**_seed_params(), "questions": _QUESTIONS},
    )


def downgrade() -> None:
    if not _ready():
        return
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, intake_questions FROM suggestion_boxes "
            f"WHERE intake_questions IS NOT NULL AND {_UNEDITED_SEED}"
        ),
        _seed_params(),
    ).all()
    for box_id, stored in rows:
        # JSON arrives decoded or as text depending on the driver and server.
        value = json.loads(stored) if isinstance(stored, (str, bytes)) else stored
        if value == _QUESTIONS:
            bind.execute(
                sa.text(
                    "UPDATE suggestion_boxes SET intake_questions = NULL "
                    "WHERE id = :id"
                ),
                {"id": box_id},
            )
