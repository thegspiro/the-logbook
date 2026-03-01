#!/usr/bin/env python3
"""
Training Registry Generator

Standalone tool for generating training requirement registry JSON files
compatible with The Logbook's import system.

Supports:
  - Interactive mode: prompts you for each requirement field
  - CSV mode: reads requirements from a CSV file
  - List mode: shows all existing registries and their requirements
  - Any source type: state, national, or department
  - Auto-registration: patches the backend endpoint to include the new registry

Usage:
  # Interactive mode
  python generate_registry.py

  # CSV mode
  python generate_registry.py --csv requirements.csv

  # With auto-registration into the backend
  python generate_registry.py --register

  # Specify output directory
  python generate_registry.py --output ./my_output_dir

  # List all existing registries and their requirements
  python generate_registry.py --list

  # With a citation URL
  python generate_registry.py --csv reqs.csv --source state --name nj --description "New Jersey DFRS" --url "https://nj.gov/dfrs/requirements"

  # Non-interactive: just provide source and name
  python generate_registry.py --csv reqs.csv --source state --name nj --description "New Jersey DFRS"

CSV Format:
  name,description,registry_code,requirement_type,training_type,required_hours,frequency,applies_to_all,required_positions,is_editable,time_limit_days,checklist_items,required_courses,required_shifts,required_calls

  - required_positions: semicolon-separated (e.g., "firefighter;driver;officer")
  - checklist_items: semicolon-separated
  - required_courses: semicolon-separated
  - applies_to_all: true/false
  - is_editable: true/false (default: true)
"""

import argparse
import csv
from datetime import date
import json
import os
import re
import sys
from pathlib import Path

# ── Valid enum values (must match backend/app/models/training.py) ──

VALID_REQUIREMENT_TYPES = [
    "hours",
    "courses",
    "certification",
    "shifts",
    "calls",
    "skills_evaluation",
    "checklist",
    "knowledge_test",
]

VALID_FREQUENCIES = [
    "annual",
    "biannual",
    "quarterly",
    "monthly",
    "one_time",
]

VALID_TRAINING_TYPES = [
    "certification",
    "continuing_education",
    "skills_practice",
    "orientation",
    "refresher",
    "specialty",
]

VALID_SOURCES = ["state", "national", "department"]

# ── Validation helpers ──


def validate_requirement_type(value: str) -> str:
    v = value.strip().lower()
    if v not in VALID_REQUIREMENT_TYPES:
        raise ValueError(
            f"Invalid requirement_type '{value}'. "
            f"Must be one of: {', '.join(VALID_REQUIREMENT_TYPES)}"
        )
    return v


def validate_frequency(value: str) -> str:
    v = value.strip().lower()
    if v not in VALID_FREQUENCIES:
        raise ValueError(
            f"Invalid frequency '{value}'. "
            f"Must be one of: {', '.join(VALID_FREQUENCIES)}"
        )
    return v


def validate_training_type(value: str) -> str:
    v = value.strip().lower()
    if not v:
        return ""
    if v not in VALID_TRAINING_TYPES:
        raise ValueError(
            f"Invalid training_type '{value}'. "
            f"Must be one of: {', '.join(VALID_TRAINING_TYPES)} (or empty)"
        )
    return v


def validate_source(value: str) -> str:
    v = value.strip().lower()
    if v not in VALID_SOURCES:
        raise ValueError(
            f"Invalid source '{value}'. "
            f"Must be one of: {', '.join(VALID_SOURCES)}"
        )
    return v


def parse_bool(value: str) -> bool:
    return value.strip().lower() in ("true", "yes", "1", "y")


def parse_semicolon_list(value: str) -> list:
    if not value.strip():
        return []
    return [item.strip() for item in value.split(";") if item.strip()]


def parse_float_or_none(value: str):
    v = value.strip()
    if not v:
        return None
    return float(v)


def parse_int_or_none(value: str):
    v = value.strip()
    if not v:
        return None
    return int(v)


# ── Build a single requirement dict ──


def build_requirement(data: dict) -> dict:
    """Validate and build a requirement dict from raw input data."""
    req = {}

    # Required fields
    name = data.get("name", "").strip()
    if not name:
        raise ValueError("Requirement 'name' is required")
    req["name"] = name

    req["requirement_type"] = validate_requirement_type(
        data.get("requirement_type", "")
    )
    req["frequency"] = validate_frequency(data.get("frequency", "annual"))

    # Optional string fields
    description = data.get("description", "").strip()
    if description:
        req["description"] = description

    registry_code = data.get("registry_code", "").strip()
    if registry_code:
        req["registry_code"] = registry_code

    training_type = validate_training_type(data.get("training_type", ""))
    if training_type:
        req["training_type"] = training_type

    # Numeric fields
    required_hours = parse_float_or_none(data.get("required_hours", ""))
    if required_hours is not None:
        req["required_hours"] = required_hours

    required_shifts = parse_int_or_none(data.get("required_shifts", ""))
    if required_shifts is not None:
        req["required_shifts"] = required_shifts

    required_calls = parse_int_or_none(data.get("required_calls", ""))
    if required_calls is not None:
        req["required_calls"] = required_calls

    time_limit_days = parse_int_or_none(data.get("time_limit_days", ""))
    if time_limit_days is not None:
        req["time_limit_days"] = time_limit_days

    # Boolean fields
    applies_to_all = parse_bool(data.get("applies_to_all", "false"))
    req["applies_to_all"] = applies_to_all

    is_editable = parse_bool(data.get("is_editable", "true"))
    req["is_editable"] = is_editable

    # List fields
    positions = parse_semicolon_list(data.get("required_positions", ""))
    if positions:
        req["required_positions"] = positions

    checklist = parse_semicolon_list(data.get("checklist_items", ""))
    if checklist:
        req["checklist_items"] = checklist

    courses = parse_semicolon_list(data.get("required_courses", ""))
    if courses:
        req["required_courses"] = courses

    call_types = parse_semicolon_list(data.get("required_call_types", ""))
    if call_types:
        req["required_call_types"] = call_types

    skills = parse_semicolon_list(data.get("required_skills", ""))
    if skills:
        req["required_skills"] = skills

    return req


# ── Interactive mode ──


def prompt_choice(prompt_text: str, choices: list, allow_empty: bool = False) -> str:
    """Prompt the user to pick from a list of valid choices."""
    choices_str = ", ".join(choices)
    while True:
        value = input(f"{prompt_text} [{choices_str}]: ").strip().lower()
        if allow_empty and not value:
            return ""
        if value in choices:
            return value
        print(f"  Invalid. Choose from: {choices_str}")


def prompt_str(prompt_text: str, required: bool = False, default: str = "") -> str:
    """Prompt for a string value."""
    suffix = f" [{default}]" if default else ""
    while True:
        value = input(f"{prompt_text}{suffix}: ").strip()
        if not value and default:
            return default
        if not value and required:
            print("  This field is required.")
            continue
        return value


def prompt_float(prompt_text: str) -> float | None:
    """Prompt for an optional float."""
    value = input(f"{prompt_text} (or Enter to skip): ").strip()
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        print("  Invalid number, skipping.")
        return None


def prompt_int(prompt_text: str) -> int | None:
    """Prompt for an optional int."""
    value = input(f"{prompt_text} (or Enter to skip): ").strip()
    if not value:
        return None
    try:
        return int(value)
    except ValueError:
        print("  Invalid number, skipping.")
        return None


def prompt_bool(prompt_text: str, default: bool = False) -> bool:
    """Prompt for a boolean."""
    default_str = "Y/n" if default else "y/N"
    value = input(f"{prompt_text} [{default_str}]: ").strip().lower()
    if not value:
        return default
    return value in ("y", "yes", "true", "1")


def prompt_list(prompt_text: str) -> list:
    """Prompt for a semicolon-separated list."""
    value = input(f"{prompt_text} (semicolon-separated, or Enter to skip): ").strip()
    return parse_semicolon_list(value)


def interactive_requirement() -> dict:
    """Interactively build a single requirement."""
    print("\n--- New Requirement ---")
    data = {}
    data["name"] = prompt_str("Name", required=True)
    data["description"] = prompt_str("Description")
    data["registry_code"] = prompt_str("Registry code (e.g., 'FF-I', 'EMT')")
    data["requirement_type"] = prompt_choice(
        "Requirement type", VALID_REQUIREMENT_TYPES
    )
    data["training_type"] = prompt_choice(
        "Training type", VALID_TRAINING_TYPES, allow_empty=True
    )
    data["frequency"] = prompt_choice("Frequency", VALID_FREQUENCIES)

    hours = prompt_float("Required hours")
    data["required_hours"] = str(hours) if hours is not None else ""

    shifts = prompt_int("Required shifts")
    data["required_shifts"] = str(shifts) if shifts is not None else ""

    calls = prompt_int("Required calls")
    data["required_calls"] = str(calls) if calls is not None else ""

    time_limit = prompt_int("Time limit (days)")
    data["time_limit_days"] = str(time_limit) if time_limit is not None else ""

    data["applies_to_all"] = "true" if prompt_bool("Applies to all members?") else "false"
    data["is_editable"] = "true" if prompt_bool("Editable by department?", default=True) else "false"

    positions = prompt_list("Required positions")
    data["required_positions"] = ";".join(positions)

    checklist = prompt_list("Checklist items")
    data["checklist_items"] = ";".join(checklist)

    courses = prompt_list("Required courses")
    data["required_courses"] = ";".join(courses)

    return build_requirement(data)


def interactive_mode() -> tuple:
    """Run fully interactive mode. Returns (registry_name, description, source, source_url, requirements)."""
    print("=" * 60)
    print("  Training Registry Generator - Interactive Mode")
    print("=" * 60)

    source = prompt_choice("\nSource type", VALID_SOURCES)
    registry_name = prompt_str("Registry name (e.g., 'nj', 'nfpa', 'my_dept')", required=True)
    description = prompt_str("Registry description", required=True)
    source_url = prompt_str("Source URL (citation link, or Enter to skip)")

    requirements = []
    while True:
        try:
            req = interactive_requirement()
            requirements.append(req)
            print(f"  Added: {req['name']}")
        except ValueError as e:
            print(f"  Error: {e}")
            if not prompt_bool("Try again?", default=True):
                break
            continue

        if not prompt_bool("\nAdd another requirement?", default=True):
            break

    return registry_name, description, source, source_url, requirements


# ── CSV mode ──


def csv_mode(csv_path: str) -> list:
    """Read requirements from a CSV file. Returns list of requirement dicts."""
    requirements = []
    errors = []

    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader, start=2):  # row 1 is header
            try:
                req = build_requirement(row)
                requirements.append(req)
            except ValueError as e:
                errors.append(f"Row {i}: {e}")

    if errors:
        print(f"\nValidation errors in {csv_path}:")
        for err in errors:
            print(f"  {err}")
        if not requirements:
            print("\nNo valid requirements found. Aborting.")
            sys.exit(1)
        print(f"\n{len(requirements)} valid, {len(errors)} skipped.")

    return requirements


# ── File naming ──


def make_filename(source: str, registry_name: str) -> str:
    """Generate the JSON filename based on source and name."""
    name = registry_name.strip().lower().replace(" ", "_")
    name = re.sub(r"[^a-z0-9_]", "", name)

    if source == "state":
        return f"state_{name}_requirements.json"
    elif source == "national":
        return f"{name}_requirements.json"
    else:
        return f"dept_{name}_requirements.json"


def make_registry_key(source: str, registry_name: str) -> str:
    """Generate the registry key used in the endpoint map."""
    name = registry_name.strip().lower().replace(" ", "_")
    name = re.sub(r"[^a-z0-9_]", "", name)

    if source == "state":
        return f"state_{name}"
    elif source == "department":
        return f"dept_{name}"
    else:
        return name


# ── Auto-registration ──


def find_repo_root() -> Path | None:
    """Walk up from CWD to find the repo root (has backend/ and frontend/ dirs)."""
    current = Path.cwd()
    for parent in [current] + list(current.parents):
        if (parent / "backend" / "app").is_dir() and (parent / "frontend").is_dir():
            return parent
    return None


def register_in_endpoint(registry_key: str, json_filename: str, repo_root: Path) -> bool:
    """Patch training_programs.py to add the new registry to the endpoint."""
    endpoint_file = (
        repo_root / "backend" / "app" / "api" / "v1" / "endpoints" / "training_programs.py"
    )

    if not endpoint_file.exists():
        print(f"  Warning: Could not find {endpoint_file}")
        return False

    content = endpoint_file.read_text()

    # Check if already registered
    if f'"{registry_key}"' in content:
        print(f"  Registry '{registry_key}' is already registered in the endpoint.")
        return True

    # 1. Add to registry_files dict
    # Find the closing brace of the registry_files dict
    dict_pattern = r"(registry_files\s*=\s*\{[^}]*)(})"
    match = re.search(dict_pattern, content, re.DOTALL)
    if not match:
        print("  Warning: Could not find registry_files dict in endpoint file.")
        return False

    json_path = f"backend/app/data/registries/{json_filename}"
    new_entry = f'        "{registry_key}": "{json_path}",\n    '
    content = content[: match.end(1)] + "\n" + new_entry + content[match.start(2) :]

    # 2. Update the docstring
    docstring_pattern = r"(Available registries:\s*)([^\n]*)"
    doc_match = re.search(docstring_pattern, content)
    if doc_match:
        existing = doc_match.group(2).strip()
        new_list = f"{existing}, {registry_key}"
        content = (
            content[: doc_match.start(2)] + new_list + content[doc_match.end(2) :]
        )

    endpoint_file.write_text(content)
    print(f"  Registered '{registry_key}' in {endpoint_file.relative_to(repo_root)}")
    return True


# ── List existing registries ──


def list_registries(repo_root: Path) -> None:
    """Scan the registries directory and display all existing registries."""
    registries_dir = repo_root / "backend" / "app" / "data" / "registries"

    if not registries_dir.exists():
        print("No registries directory found.")
        return

    json_files = sorted(registries_dir.glob("*_requirements.json"))
    if not json_files:
        print("No registry files found.")
        return

    print("=" * 70)
    print("  Existing Registries")
    print("=" * 70)

    for filepath in json_files:
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            print(f"\n  {filepath.name}: (error reading: {e})")
            continue

        name = data.get("registry_name", filepath.stem)
        description = data.get("registry_description", "")
        source = data.get("source", "unknown")
        last_updated = data.get("last_updated", "unknown")
        source_url = data.get("source_url", "")
        requirements = data.get("requirements", [])

        print(f"\n  {name}")
        print(f"  {'─' * (len(name))}")
        print(f"  File:         {filepath.name}")
        print(f"  Source:       {source}")
        print(f"  Description:  {description}")
        print(f"  Last updated: {last_updated}")
        if source_url:
            print(f"  Citation URL: {source_url}")
        print(f"  Requirements: {len(requirements)}")

        if requirements:
            for req in requirements:
                req_type = req.get("requirement_type", "?")
                freq = req.get("frequency", "?")
                code = req.get("registry_code", "")
                hours = req.get("required_hours")
                parts = [req_type, freq]
                if hours:
                    parts.append(f"{hours}h")
                if code:
                    parts.append(f"code: {code}")
                print(f"    - {req.get('name', '?')} ({', '.join(parts)})")

    print(f"\n{'=' * 70}")
    print(f"  Total: {len(json_files)} registries")
    print(f"{'=' * 70}")


# ── Main ──


def main():
    parser = argparse.ArgumentParser(
        description="Generate training requirement registry JSON files for The Logbook"
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="List all existing registries and their requirements",
    )
    parser.add_argument(
        "--csv", metavar="FILE", help="Path to CSV file with requirements"
    )
    parser.add_argument(
        "--source",
        choices=VALID_SOURCES,
        help="Source type (state, national, department)",
    )
    parser.add_argument(
        "--name",
        help="Registry name (e.g., 'nj', 'ca', 'ifsac')",
    )
    parser.add_argument(
        "--description",
        help="Registry description",
    )
    parser.add_argument(
        "--url",
        help="Source URL for citation (e.g., 'https://nj.gov/dfrs/requirements')",
    )
    parser.add_argument(
        "--output",
        metavar="DIR",
        default=".",
        help="Output directory (default: current directory)",
    )
    parser.add_argument(
        "--register",
        action="store_true",
        help="Auto-register the new registry in the backend endpoint",
    )

    args = parser.parse_args()

    if args.list:
        repo_root = find_repo_root()
        if not repo_root:
            print("Could not find repo root. Run from inside the-logbook repo.")
            sys.exit(1)
        list_registries(repo_root)
        sys.exit(0)

    if args.csv:
        # CSV mode
        requirements = csv_mode(args.csv)
        if not requirements:
            print("No requirements loaded from CSV.")
            sys.exit(1)

        # Get metadata from args or prompt
        source = args.source
        if not source:
            source = prompt_choice("Source type", VALID_SOURCES)
        else:
            source = validate_source(source)

        registry_name = args.name
        if not registry_name:
            registry_name = prompt_str(
                "Registry name (e.g., 'nj', 'nfpa')", required=True
            )

        description = args.description
        if not description:
            description = prompt_str("Registry description", required=True)

        source_url = args.url or ""

    else:
        # Interactive mode
        registry_name, description, source, source_url, requirements = interactive_mode()

    if not requirements:
        print("No requirements to write. Exiting.")
        sys.exit(0)

    # Build the registry object
    # Use a display name for the registry_name field in the JSON
    display_name = registry_name.upper() if source in ("state", "national") else registry_name
    registry = {
        "registry_name": display_name,
        "registry_description": description,
        "last_updated": date.today().isoformat(),
        "source": source,
    }
    if source_url:
        registry["source_url"] = source_url
    registry["requirements"] = requirements

    # Write the file
    filename = make_filename(source, registry_name)
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / filename

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(registry, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"\nGenerated: {output_path}")
    print(f"  Registry: {display_name}")
    print(f"  Source: {source}")
    if source_url:
        print(f"  Citation URL: {source_url}")
    print(f"  Requirements: {len(requirements)}")

    # Auto-register
    if args.register:
        repo_root = find_repo_root()
        if not repo_root:
            print(
                "\n  Warning: Could not find repo root. "
                "Run from inside the-logbook repo to use --register."
            )
        else:
            registry_key = make_registry_key(source, registry_name)

            # Also copy the file into the registries directory
            registries_dir = repo_root / "backend" / "app" / "data" / "registries"
            target_path = registries_dir / filename
            if output_path.resolve() != target_path.resolve():
                registries_dir.mkdir(parents=True, exist_ok=True)
                target_path.write_text(output_path.read_text())
                print(f"  Copied to: {target_path.relative_to(repo_root)}")

            register_in_endpoint(registry_key, filename, repo_root)

    # Print summary
    print("\nRequirements summary:")
    for req in requirements:
        req_type = req.get("requirement_type", "?")
        freq = req.get("frequency", "?")
        hours = req.get("required_hours")
        hours_str = f", {hours}h" if hours else ""
        print(f"  - {req['name']} ({req_type}, {freq}{hours_str})")


if __name__ == "__main__":
    main()
