"""
Guards the built-in registry catalog: every registry registered in
``_REGISTRY_FILES`` must resolve to a real, well-formed JSON file with importable
requirements. This catches the class of bug where a registry import silently
returns 0 (missing file / wrong path / bad JSON).
"""

import json

from app.api.v1.endpoints.training_programs import _REGISTRY_DIR, _REGISTRY_FILES

VALID_REQUIREMENT_TYPES = {
    "hours",
    "courses",
    "certification",
    "shifts",
    "calls",
    "skills_evaluation",
    "checklist",
    "knowledge_test",
}

# The NREMT provider levels and each level's national-component registry code.
EMS_LEVEL_CODES = {
    "emr": "NREMR",
    "emt": "NREMT",
    "aemt": "NRAEMT",
    "paramedic": "NRP",
}


def _load(key: str) -> dict:
    path = _REGISTRY_DIR / _REGISTRY_FILES[key]
    assert path.exists(), f"Registry file missing for '{key}': {path}"
    with open(path) as f:
        return json.load(f)


def test_expected_registries_registered():
    assert set(_REGISTRY_FILES) == {
        "nfpa",
        "proboard",
        "emr",
        "emt",
        "aemt",
        "paramedic",
    }


def test_every_registry_file_loads_with_importable_requirements():
    for key in _REGISTRY_FILES:
        data = _load(key)
        assert data.get("registry_name"), f"{key} missing registry_name"
        requirements = data.get("requirements", [])
        assert requirements, f"{key} has no requirements — import would be a no-op"
        for req in requirements:
            assert req.get("name"), f"{key} requirement missing name"
            assert req.get("frequency"), f"{key} requirement missing frequency"
            assert (
                req.get("requirement_type") in VALID_REQUIREMENT_TYPES
            ), f"{key} bad requirement_type: {req.get('requirement_type')}"


def test_each_ems_level_has_its_national_component_scoped_to_that_level():
    for level, code in EMS_LEVEL_CODES.items():
        data = _load(level)
        national = [
            r for r in data["requirements"] if r.get("registry_code") == code
        ]
        assert len(national) == 1, f"{level} should have exactly one {code} component"
        comp = national[0]
        assert comp["requirement_type"] == "hours"
        assert comp["required_positions"] == [level]
        # Recert is a repeating (biannual) continuing-education requirement.
        assert comp["frequency"] == "biannual"
