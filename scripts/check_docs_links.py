#!/usr/bin/env python3
"""
Verify that every internal link in the repository's Markdown resolves.

Why this exists
---------------
A table of contents is the part of a document readers actually navigate with,
and it is the part that rots first: a heading gains a date suffix
(``## Manual Shift Report Entry _(2026-04-11)_``) and every link to it breaks
silently. Nothing renders an error — the anchor simply does nothing when
clicked. Four such links were sitting in the tree when this script was written,
the oldest predating the training guides' current structure.

Prettier does not check links, and no other CI job opens a Markdown file, so
this is the only thing standing between a renamed heading and a dead
cross-reference.

What it checks
--------------
* **In-page anchors** — ``[text](#some-heading)`` resolves to a heading in the
  same file.
* **Relative file links** — ``[text](../other/doc.md)`` points at a file that
  exists.
* **Cross-file anchors** — ``[text](./doc.md#section)`` resolves to a heading in
  *that* file.

Deliberately **not** checked: external URLs. Verifying those means network calls
from CI, which turns an unrelated outage into a failed build.

**Known limitation — reference-style links and images are not resolved.**
``![diagram][arch]`` with a separate ``[arch]: images/x.png`` definition is
ignored entirely, for links as much as for images, so a broken one passes. This
is a gap, not a decision: resolving it means parsing definitions and the full,
collapsed and shortcut reference forms, which is a feature rather than a fix.
Nothing in the tree uses the syntax today. If that changes, close this before
relying on the checker for those pages — a check that silently covers only one
of two spellings is worse than one whose limits are written down.

Slug rules
----------
GitHub's heading-to-anchor conversion, which is what the rendered docs and the
published wiki both use: lowercase, strip formatting markers and punctuation,
spaces to hyphens. Underscores survive (``skill_tests`` stays ``skill_tests``),
which is why emphasis is unwrapped before punctuation is stripped rather than
deleting ``_`` wholesale — doing it the other way turns every table name in
DATABASE_SCHEMA.md into an unreachable anchor.

Usage:

    python scripts/check_docs_links.py                 # whole repository
    python scripts/check_docs_links.py docs/README.md  # specific files
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from collections import defaultdict

# Paths whose contents are generated or vendored. A generated file's links are
# its generator's problem, and node_modules is not ours at all.
EXCLUDED_PREFIXES = (
    "node_modules/",
    "frontend/node_modules/",
    "frontend/dist/",
    "frontend/coverage/",
)

# Fenced code blocks hold example markdown often enough that linting their
# links produces noise rather than findings.
FENCE_RE = re.compile(r"^\s*(```|~~~)")

# GitHub Wikis address pages by bare title — `[Training](Module-Training)`, no
# `.md` — so inside wiki/ an extensionless, slashless target is a page
# reference, not a missing file. Resolving it against wiki/<target>.md is what
# lets this script check the sidebar, which is where dead wiki links accumulate.
WIKI_DIR = "wiki"

# Published by wiki/setup-wiki.sh but not present as files here: generated at
# publish time from docs/TROUBLESHOOTING.md and docs/ERROR_CODES.md, so links
# to them are correct even though nothing in wiki/ matches.
WIKI_GENERATED_PAGES = {"Troubleshooting", "Error-Codes"}

HEADING_RE = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
# An explicit anchor: <a name="..."> or <a id="...">, which several older docs
# use to keep a stable target across heading rewrites.
EXPLICIT_ANCHOR_RE = re.compile(r"<a\s+(?:name|id)=[\"']([^\"']+)[\"']", re.I)
# Matches both `[label](target)` and `![alt](target)`, capturing the leading
# `!` so an image can be told from a link, and tolerating Markdown's optional
# title — `[a](b.md "Title")`, `'Title'` or `(Title)`.
#
# A bare destination admits one level of balanced parentheses, so
# `images/pump(1).png` — an unremarkable filename a screenshot tool produces on
# its own — is captured whole rather than truncated at the first `)` and then
# reported as a file that does not exist. A false positive there would block
# the documentation job over a correct page, which is worse than the miss it
# sits beside. `<...>` handles anything more nested, or containing a space.
#
# Without the title branch the whole reference silently does not match, so a
# broken target wearing a title is not reported at all. Nothing in the tree uses
# the form today, which is exactly why it would have gone unnoticed: the first
# person to write one would get no check on it.
#
# Images were excluded by a `(?<!\!)` lookbehind until 2026-09-06. That left
# the one link class with no safety net anywhere: a dead `[page](Page)` is
# visible as unlinked text, while a dead image renders as a broken-image icon
# that reads as a slow load, and the file it points at is a binary nobody
# greps. wiki/setup-wiki.sh had never copied `wiki/images/` at all, so every
# relative image reference a wiki page could have made was already broken —
# undetected, because of this lookbehind.
#
# Enabling it found zero pre-existing violations across 520 local image
# references. The three that a naive scan flags are `![alt](./images/....png)`
# syntax examples inside fenced blocks and inline code spans, which `links_in`
# strips before matching.
LINK_RE = re.compile(
    r"(!?)\[[^\]]*\]\("
    r"\s*(?:<([^<>]*)>|((?:[^()\s]|\([^()\s]*\))+))\s*"
    r"""(?:"[^"]*"|'[^']*'|\([^)]*\))?\s*"""
    r"\)"
)

# A wiki page's images must resolve inside this directory: wiki/setup-wiki.sh
# publishes wiki/images/ and nothing else, so an image anywhere else in the
# repository exists here, passes a plain file check, and is still a broken image
# on the published wiki. That is the failure this checker exists to stop, so it
# is checked rather than left to the README's word.
WIKI_IMAGES_DIR = os.path.join(WIKI_DIR, "images")


def slugify(heading: str) -> str:
    """Render a heading the way GitHub renders it into an anchor."""
    text = heading
    # Inline code keeps its contents: `skill_tests` -> skill_tests
    text = re.sub(r"`([^`]*)`", r"\1", text)
    # Images contribute nothing to the slug; links contribute their label.
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    # Unwrap emphasis before stripping punctuation, so that a literal
    # underscore inside an identifier is not mistaken for an emphasis marker.
    text = re.sub(r"\*\*([^*]*)\*\*", r"\1", text)
    text = re.sub(r"\*([^*]*)\*", r"\1", text)
    text = re.sub(r"(?<!\w)_([^_]+)_(?!\w)", r"\1", text)
    text = text.strip().lower()
    # Everything that is not a word character, whitespace or hyphen goes.
    text = re.sub(r"[^\w\s\-]", "", text)
    return re.sub(r"\s", "-", text)


def anchors_for(path: str, cache: dict[str, set[str]]) -> set[str]:
    """Every anchor a file offers, with duplicate headings numbered as GitHub does."""
    if path in cache:
        return cache[path]

    found: set[str] = set()
    try:
        with open(path, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
    except (OSError, UnicodeDecodeError):
        cache[path] = found
        return found

    seen: defaultdict[str, int] = defaultdict(int)
    in_fence = False
    for line in lines:
        if FENCE_RE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue

        for m in EXPLICIT_ANCHOR_RE.finditer(line):
            found.add(m.group(1).lower())

        m = HEADING_RE.match(line)
        if not m:
            continue
        base = slugify(m.group(2))
        if not base:
            continue
        # Two identical headings in one file: the second is `-1`, third `-2`.
        n = seen[base]
        seen[base] += 1
        found.add(base if n == 0 else f"{base}-{n}")

    cache[path] = found
    return found


def links_in(path: str) -> list[tuple[int, str, bool]]:
    """Every internal link target in a file: line number, target, is-image.

    The is-image flag is carried rather than discarded because a wiki page's
    images have a stricter rule than its links — see WIKI_IMAGES_DIR.
    """
    out: list[tuple[int, str, bool]] = []
    in_fence = False
    with open(path, encoding="utf-8") as fh:
        lines = fh.read().splitlines()
    for lineno, line in enumerate(lines, start=1):
        if FENCE_RE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        # A link inside an inline code span is a printed example, not a link —
        # the docs describe their own cross-reference syntax that way.
        line = re.sub(r"`[^`]*`", lambda m: " " * len(m.group(0)), line)
        for m in LINK_RE.finditer(line):
            is_image = bool(m.group(1))
            # `<...>` wins when present: it is the only form that can carry a
            # space, which is exactly what a filename with a space needs — and
            # the publisher goes out of its way to support those. Group 2 can
            # be the empty string for `<>`, so test against None, not falsity.
            target = m.group(2) if m.group(2) is not None else m.group(3)
            # External and non-file schemes are out of scope on purpose.
            if re.match(r"^(https?:|mailto:|tel:|data:|//)", target):
                continue
            out.append((lineno, target, is_image))
    return out


def tracked_markdown() -> list[str]:
    files = subprocess.run(
        ["git", "ls-files", "*.md"], capture_output=True, text=True, check=True
    ).stdout.split()
    return [f for f in files if not f.startswith(EXCLUDED_PREFIXES)]


def main(argv: list[str]) -> int:
    files = [a for a in argv if a.endswith(".md")] or tracked_markdown()
    cache: dict[str, set[str]] = {}
    problems: list[str] = []

    for path in files:
        if not os.path.exists(path):
            continue
        base_dir = os.path.dirname(path)

        for lineno, target, is_image in links_in(path):
            file_part, _, anchor = target.partition("#")

            if not file_part:
                # Same-page anchor.
                if anchor and anchor.lower() not in anchors_for(path, cache):
                    problems.append(
                        f"{path}:{lineno}: no heading matches anchor '#{anchor}'"
                    )
                continue

            in_wiki = path.split(os.sep)[0] == WIKI_DIR
            # An image is never a wiki page reference, however bare its target
            # looks. `![diagram](Home)` would otherwise be classified as a page,
            # pass because wiki/Home.md exists, and publish an <img> pointing at
            # a page of HTML — slipping past the wiki-images rule below, which
            # only the non-page branch reaches.
            wiki_page = (
                in_wiki
                and not is_image
                and "/" not in file_part
                and "." not in file_part
            )

            if wiki_page:
                if file_part in WIKI_GENERATED_PAGES:
                    continue
                resolved = os.path.join(WIKI_DIR, f"{file_part}.md")
                if not os.path.exists(resolved):
                    problems.append(
                        f"{path}:{lineno}: wiki page '{file_part}' does not exist "
                        f"(expected {resolved})"
                    )
                    continue
            else:
                resolved = os.path.normpath(os.path.join(base_dir, file_part))
                if not os.path.exists(resolved):
                    problems.append(
                        f"{path}:{lineno}: link target not found: {file_part}"
                    )
                    continue

                # An existing file is not enough for a wiki image: only
                # wiki/images/ is published, so anything else is a broken
                # image on the live wiki no matter what it resolves to here.
                if (
                    in_wiki
                    and is_image
                    and not resolved.startswith(WIKI_IMAGES_DIR + os.sep)
                ):
                    problems.append(
                        f"{path}:{lineno}: wiki image '{file_part}' resolves "
                        f"outside {WIKI_IMAGES_DIR}/, which setup-wiki.sh does "
                        f"not publish"
                    )
                    continue

            if anchor and resolved.endswith(".md"):
                if anchor.lower() not in anchors_for(resolved, cache):
                    problems.append(
                        f"{path}:{lineno}: {file_part} has no heading matching "
                        f"'#{anchor}'"
                    )

    for p in problems:
        print(p)

    print(
        f"\nChecked {len(files)} Markdown files — "
        f"{len(problems)} broken link{'' if len(problems) == 1 else 's'}."
    )
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
