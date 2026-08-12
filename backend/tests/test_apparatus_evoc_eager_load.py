"""
Apparatus responses must eager-load `required_evoc_level`.

Both `ApparatusResponse` and `ApparatusListItem` project the relationship, but
neither the detail query, the list query, nor the update path loaded it. The
gap was invisible for as long as every apparatus had a NULL
`required_evoc_level_id` — SQLAlchemy returns None for a null foreign key
without touching the database — so nothing failed while the feature was unused.

Setting a requirement on one apparatus broke three endpoints at once: the
update itself 500'd after committing (so the value was stored while the caller
was told it failed), the detail endpoint 500'd for that apparatus, and the
*fleet list* 500'd for every apparatus, because one unloaded row is enough to
fail response validation for the whole page.

Source assertions — reproducing MissingGreenlet needs a real async session,
and the defect is a missing option on three queries.
"""

import inspect

import pytest

from app.models.apparatus import Apparatus
from app.schemas.apparatus import ApparatusListItem, ApparatusResponse
from app.services.apparatus_service import ApparatusService


@pytest.mark.parametrize("schema", [ApparatusResponse, ApparatusListItem])
def test_both_schemas_project_the_relationship(schema):
    """If either stops projecting it, the eager load below can go — not before."""
    assert "required_evoc_level" in schema.model_fields


def test_the_relationship_exists_on_the_model():
    assert hasattr(Apparatus, "required_evoc_level")


@pytest.mark.parametrize("method", ["get_apparatus", "list_apparatus"])
def test_read_paths_eager_load_the_evoc_level(method):
    source = inspect.getsource(getattr(ApparatusService, method))
    assert (
        "selectinload(Apparatus.required_evoc_level)" in source
    ), f"{method} does not eager-load required_evoc_level"


def test_update_reloads_with_relations_rather_than_refreshing():
    source = inspect.getsource(ApparatusService.update_apparatus)
    assert "include_relations=True" in source, "update_apparatus does not reload"
    assert (
        "db.refresh(apparatus)" not in source
    ), "update_apparatus still relies on refresh(), which leaves relationships unloaded"
