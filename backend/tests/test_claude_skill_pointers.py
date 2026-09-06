"""Guard the CLAUDE.md -> docs/rules -> .claude/skills pointer chain.

A project skill in this repository is deliberately thin: it names when to load
and then points at the real prose under ``docs/rules/``. The prose lives there,
not inside the skill, because ``AGENTS.md`` makes these repository rules and
the other agents working this repo cannot read ``.claude/skills/``.

That arrangement has one silent failure mode, and it is the reason for this
file. Three separate edits break it without breaking anything else:

* a malformed or missing frontmatter block, which stops the skill loading at
  all -- nothing errors, the skill simply never triggers;
* a ``name`` that no longer matches its directory, same outcome;
* deleting the link out of ``CLAUDE.md``, which strands the rules file with
  nothing pointing at it while every reader still sees a one-line rule and no
  way to reach the rest of it.

``scripts/check_docs_links.py`` covers link *resolution*; none of the above is
a broken link, so none of it is covered there.
"""

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SKILLS_DIR = REPO_ROOT / ".claude" / "skills"

FRONTMATTER_RE = re.compile(r"\A---\n(.*?)\n---\n", re.DOTALL)
MARKDOWN_LINK_RE = re.compile(r"\[[^\]]*\]\(([^)#]+)(?:#[^)]*)?\)")


def _skill_files() -> list[Path]:
    if not SKILLS_DIR.is_dir():
        return []
    return sorted(SKILLS_DIR.glob("*/SKILL.md"))


def _frontmatter(path: Path) -> dict[str, str]:
    """Parse the leading YAML block. Only flat ``key: value`` pairs are used
    by these skills, so a full YAML parser would be a dependency for nothing.
    """
    match = FRONTMATTER_RE.match(path.read_text(encoding="utf-8"))
    assert match is not None, (
        f"{path.relative_to(REPO_ROOT)} has no frontmatter block. A skill "
        "without one does not load, and nothing reports that it did not."
    )
    fields: dict[str, str] = {}
    for line in match.group(1).splitlines():
        if line.startswith((" ", "\t")) or ":" not in line:
            continue
        key, _, value = line.partition(":")
        fields[key.strip()] = value.strip()
    return fields


def test_at_least_one_skill_is_present():
    """The suite would pass vacuously if .claude/skills stopped being tracked.

    It is re-included in .gitignore by an explicit negation, which is exactly
    the kind of line a later edit drops by accident.
    """
    assert _skill_files(), (
        "No .claude/skills/*/SKILL.md found. Check that the "
        "`!.claude/skills/` negation is still in .gitignore."
    )


def test_every_skill_declares_a_name_matching_its_directory():
    mismatches = []
    for path in _skill_files():
        name = _frontmatter(path).get("name", "")
        if name != path.parent.name:
            mismatches.append(
                f"{path.relative_to(REPO_ROOT)}: name={name!r} "
                f"but directory is {path.parent.name!r}"
            )

    assert mismatches == [], "Skill name does not match its directory:\n" + "\n".join(
        f"  - {m}" for m in mismatches
    )


def test_every_skill_declares_a_description():
    """The description is the whole triggering mechanism -- an empty one means
    the skill is present and never selected."""
    missing = [
        str(path.relative_to(REPO_ROOT))
        for path in _skill_files()
        if not _frontmatter(path).get("description")
    ]

    assert (
        missing == []
    ), "Skill has no description, so it can never trigger:\n" + "\n".join(
        f"  - {m}" for m in missing
    )


def test_every_relative_link_in_a_skill_resolves():
    broken = []
    for path in _skill_files():
        for target in MARKDOWN_LINK_RE.findall(path.read_text(encoding="utf-8")):
            if target.startswith(("http://", "https://", "mailto:")):
                continue
            if not (path.parent / target).resolve().exists():
                broken.append(f"{path.relative_to(REPO_ROOT)} -> {target}")

    assert broken == [], "Skill points at a file that does not exist:\n" + "\n".join(
        f"  - {b}" for b in broken
    )


def test_claude_md_still_links_every_rules_file():
    """A rules file nothing links to is unreachable prose.

    CLAUDE.md keeps the one-line rule and the link; dropping the link leaves a
    reader with a rule they cannot look up, and nothing else notices.
    """
    rules_dir = REPO_ROOT / "docs" / "rules"
    if not rules_dir.is_dir():
        return

    claude_md = (REPO_ROOT / "CLAUDE.md").read_text(encoding="utf-8")
    unlinked = [
        rules_file.name
        for rules_file in sorted(rules_dir.glob("*.md"))
        if f"docs/rules/{rules_file.name}" not in claude_md
    ]

    assert unlinked == [], (
        "docs/rules file is not linked from CLAUDE.md, so the rule it holds "
        "is unreachable:\n" + "\n".join(f"  - {u}" for u in unlinked)
    )
