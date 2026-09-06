"""Regression tests for the documentation link checker's image handling.

Image targets were excluded from this checker by a `(?<!\\!)` lookbehind until
2026-09-06, at the same time as `wiki/setup-wiki.sh` was not copying
`wiki/images/` at all. The two gaps hid each other: every relative image
reference a wiki page could have made was already broken, and nothing looked.

These cases pin the parts of that fix that a future edit could quietly undo.
The exclusions matter as much as the inclusion — the repository documents its
own image syntax with `![alt](./images/....png)` examples, so a checker that
stopped honouring fences or inline code would report three findings that are
not defects, and the fastest way to silence those is to restore the lookbehind.

Run:  python -m unittest discover -s scripts -p 'test_*.py'
"""

import os
import tempfile
import unittest

from check_docs_links import links_in


def targets(markdown: str) -> list[str]:
    """Every internal target `links_in` finds in a scratch file."""
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "page.md")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(markdown)
        return [target for _lineno, target, _is_image in links_in(path)]


class ImageTargetsAreChecked(unittest.TestCase):
    def test_image_target_is_returned(self):
        assert targets("![shot](images/dash.png)\n") == ["images/dash.png"]

    def test_ordinary_link_still_returned(self):
        assert targets("[Guide](Module-Training)\n") == ["Module-Training"]

    def test_image_and_link_on_one_line_both_returned(self):
        found = targets("![a](images/a.png) and [b](Module-Events)\n")
        assert found == ["images/a.png", "Module-Events"]

    def test_line_number_is_the_image_line(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "page.md")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("# Title\n\ntext\n\n![shot](images/x.png)\n")
            assert links_in(path) == [(5, "images/x.png", True)]


class ExamplesAreNotFindings(unittest.TestCase):
    """The three `![alt](./images/....png)` examples in the tree live in these
    two constructs. Were either to stop being stripped, they would be reported
    as broken and the fix would look like re-excluding images."""

    def test_image_inside_a_fence_is_ignored(self):
        assert targets("```markdown\n![example](images/example.png)\n```\n") == []

    def test_image_inside_an_inline_code_span_is_ignored(self):
        assert targets("Replace it with `![Alt](./images/filename.png)`.\n") == []

    def test_tilde_fence_is_honoured_too(self):
        assert targets("~~~\n![example](images/example.png)\n~~~\n") == []


class OptionalTitlesAreParsed(unittest.TestCase):
    """Markdown allows a title after the destination. The earlier pattern only
    permitted whitespace there, so the whole reference failed to match and a
    broken target wearing a title was reported as nothing at all. No file in
    the tree uses the form yet — which is why the gap would have surfaced as
    the first author of one silently getting no check."""

    def test_double_quoted_title(self):
        assert targets('![shot](images/a.png "Dashboard")\n') == ["images/a.png"]

    def test_single_quoted_title(self):
        assert targets("[Guide](Module-Training 'Training')\n") == ["Module-Training"]

    def test_parenthesised_title(self):
        assert targets("[Guide](Module-Training (Training))\n") == ["Module-Training"]

    def test_title_containing_a_close_paren(self):
        assert targets('![a](images/a.png "Ladder (aerial)")\n') == ["images/a.png"]


class ImageFlagIsCarried(unittest.TestCase):
    """`main` needs to tell an image from a link, because a wiki page's images
    have a stricter rule than its links: only wiki/images/ is published."""

    def test_image_is_flagged(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "page.md")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("![a](images/a.png)\n[b](Module-Events)\n")
            assert links_in(path) == [
                (1, "images/a.png", True),
                (2, "Module-Events", False),
            ]


class ExternalImagesAreOutOfScope(unittest.TestCase):
    """No network access is the deliberate design: a third-party outage must
    not fail the build, so only file targets are resolved."""

    def test_https_image_is_ignored(self):
        assert targets("![badge](https://img.shields.io/badge/a-b.svg)\n") == []

    def test_data_uri_image_is_ignored(self):
        assert targets("![inline](data:image/png;base64,iVBORw0KGgo=)\n") == []

    def test_protocol_relative_image_is_ignored(self):
        assert targets("![cdn](//cdn.example.com/a.png)\n") == []


if __name__ == "__main__":
    unittest.main()
