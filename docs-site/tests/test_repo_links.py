"""Tests for docs-site/hooks/repo_links.py.

Run from the repository root: python -m pytest docs-site/tests
"""

import importlib.util
import pathlib

import markdown
import pytest
from mkdocs.exceptions import PluginError

HOOK = pathlib.Path(__file__).resolve().parents[1] / "hooks" / "repo_links.py"
_spec = importlib.util.spec_from_file_location("repo_links", HOOK)
repo_links = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(repo_links)

PUBLISHED = {
    "index.md",
    "faq.md",
    "docs/README.md",
    "docs/UPGRADING.md",
    "docs/TROUBLESHOOTING.md",
    "docs/training/README.md",
    "docs/training/02-training.md",
    "docs/training/images/shot.png",
    "wiki/Home.md",
    "wiki/Module-Training.md",
}
GITHUB = "https://github.com/thegspiro/the-logbook"


def run(text, page="docs/training/02-training.md"):
    return repo_links.transform(text, page, PUBLISHED.__contains__)


class TestRelativeLinks:
    def test_a_published_sibling_is_left_pointing_at_itself(self):
        assert run("[x](./README.md)") == "[x](README.md)"

    def test_the_anchor_survives(self):
        assert run("[x](../UPGRADING.md#step-2)") == "[x](../UPGRADING.md#step-2)"

    def test_an_unpublished_repository_file_goes_to_github(self):
        assert (
            run("[x](../../backend/app/main.py#L10)")
            == f"[x]({GITHUB}/blob/main/backend/app/main.py#L10)"
        )

    def test_an_unpublished_directory_goes_to_a_github_tree(self):
        assert run("[x](../../unraid/)") == f"[x]({GITHUB}/tree/main/unraid)"

    def test_an_excluded_doc_goes_to_github(self):
        assert (
            run("[x](../security-review/AUTH.md)")
            == f"[x]({GITHUB}/blob/main/docs/security-review/AUTH.md)"
        )

    def test_an_extensionless_file_is_a_blob(self):
        assert run("[l](../../LICENSE)") == f"[l]({GITHUB}/blob/main/LICENSE)"

    def test_an_unpublished_image_uses_the_raw_file(self):
        assert (
            run("![shot](../../static/logo.png)")
            == f"![shot]({GITHUB}/blob/main/static/logo.png?raw=true)"
        )

    def test_a_published_image_stays_relative(self):
        assert run("![a](./images/shot.png)") == "![a](images/shot.png)"

    def test_a_link_above_the_repository_is_left_alone(self):
        assert run("[x](../../../outside.md)") == "[x](../../../outside.md)"

    def test_an_in_page_anchor_is_left_alone(self):
        assert run("[x](#section)") == "[x](#section)"

    def test_external_and_absolute_links_are_left_alone(self):
        text = "[a](https://example.com/x.md) [b](mailto:a@b.c) [c](/root.md)"
        assert run(text) == text

    def test_a_title_is_kept(self):
        assert run('[x](./README.md "Guides")') == '[x](README.md "Guides")'

    def test_a_directory_link_opens_its_readme(self):
        assert run("[x](./training/)", page="docs/UPGRADING.md") == (
            "[x](training/README.md)"
        )

    def test_link_text_that_wraps_onto_the_next_line(self):
        text = "see [the long\nname](../../CLAUDE.md#rules) here"
        assert run(text) == (
            f"see [the long\nname]({GITHUB}/blob/main/CLAUDE.md#rules) here"
        )

    def test_link_text_holding_inline_code(self):
        assert run("[`main.py`](../../backend/main.py)") == (
            f"[`main.py`]({GITHUB}/blob/main/backend/main.py)"
        )


class TestSiteContentPages:
    def test_a_site_page_resolves_links_from_docs_site_content(self):
        assert (
            run("[g](../../docs/training/README.md)", page="index.md")
            == "[g](docs/training/README.md)"
        )

    def test_a_site_page_links_to_another_site_page(self):
        assert run("[f](faq.md)", page="index.md") == "[f](faq.md)"

    def test_a_site_page_link_to_source_goes_to_github(self):
        assert run("[c](../mkdocs.yml)", page="faq.md") == (
            f"[c]({GITHUB}/blob/main/docs-site/mkdocs.yml)"
        )


class TestGitHubLinks:
    def test_a_github_link_to_a_published_doc_stays_on_the_site(self):
        assert (
            run(
                f"[u]({GITHUB}/blob/main/docs/UPGRADING.md#before)", page="wiki/Home.md"
            )
            == "[u](../docs/UPGRADING.md#before)"
        )

    def test_a_github_tree_link_opens_the_readme(self):
        assert run(f"[t]({GITHUB}/tree/main/docs/training)", page="wiki/Home.md") == (
            "[t](../docs/training/README.md)"
        )

    def test_a_github_link_to_an_unpublished_file_is_kept(self):
        url = f"{GITHUB}/blob/main/backend/app/main.py"
        assert run(f"[m]({url})") == f"[m]({url})"

    def test_a_github_wiki_link_stays_on_the_site(self):
        assert run(f"[w]({GITHUB}/wiki/Module-Training)") == (
            "[w](../../wiki/Module-Training.md)"
        )

    def test_the_wiki_root_is_home(self):
        assert run(f"[w]({GITHUB}/wiki)", page="index.md") == "[w](wiki/Home.md)"

    def test_another_repository_is_left_alone(self):
        text = "[o](https://github.com/someone/else/blob/main/docs/UPGRADING.md)"
        assert run(text) == text


class TestWikiPageNames:
    def test_an_extensionless_wiki_link_gets_its_extension(self):
        assert run("[t](Module-Training#x)", page="wiki/Home.md") == (
            "[t](Module-Training.md#x)"
        )

    def test_outside_the_wiki_a_bare_name_is_not_a_page(self):
        assert run("[t](Module-Training)") == (
            f"[t]({GITHUB}/blob/main/docs/training/Module-Training)"
        )

    def test_a_generated_wiki_page_opens_its_source_doc(self):
        assert run("[t](Troubleshooting#container)", page="wiki/Home.md") == (
            "[t](../docs/TROUBLESHOOTING.md#container)"
        )


class TestCode:
    def test_links_in_fenced_code_are_not_touched(self):
        text = "```\n[x](../../backend/main.py)\n```"
        assert run(text) == text

    def test_a_longer_fence_is_closed_only_by_a_matching_one(self):
        text = "````\n```\n[x](../../a.py)\n```\n````\n[y](../../b.py)"
        assert run(text) == (
            "````\n```\n[x](../../a.py)\n```\n````\n" f"[y]({GITHUB}/blob/main/b.py)"
        )

    def test_a_link_inside_inline_code_is_not_touched(self):
        text = "write `[x](../../a.py)` like this"
        assert run(text) == text

    def test_html_comments_are_not_touched(self):
        text = "<!--\n!youtube BAD\n[x](../../a.py)\n-->"
        assert run(text) == text


class TestYouTube:
    def test_a_video_line_becomes_a_privacy_enhanced_player(self):
        out = run("!youtube dQw4w9WgXcQ Installing on Unraid")
        assert 'src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"' in out
        assert 'title="Installing on Unraid"' in out
        assert 'class="video-embed"' in out

    def test_a_short_gets_the_vertical_frame(self):
        out = run("!youtube-short dQw4w9WgXcQ RSVP")
        assert 'class="video-embed video-embed--short"' in out

    def test_the_title_is_escaped(self):
        out = run('!youtube dQw4w9WgXcQ <b>"x"</b>')
        assert 'title="&lt;b&gt;&quot;x&quot;&lt;/b&gt;"' in out

    def test_a_missing_title_gets_a_generic_one(self):
        assert 'title="Video"' in run("!youtube dQw4w9WgXcQ")

    @pytest.mark.parametrize(
        "line",
        [
            "!youtube",
            "!youtube short",
            '!youtube abc"><script>x',
            "!youtube dQw4w9WgXcQQ",
        ],
    )
    def test_a_bad_video_id_fails_the_build(self, line):
        with pytest.raises(PluginError):
            run(line)

    def test_the_line_must_stand_alone(self):
        text = "Watch !youtube dQw4w9WgXcQ now"
        assert run(text) == text


class TestHeadingAnchors:
    def test_repeated_headings_are_numbered_like_github(self):
        html = markdown.markdown(
            "# Release map\n\n# Release map\n\n# Release map",
            extensions=["toc"],
        )
        assert 'id="release-map"' in html
        assert 'id="release-map-1"' in html
        assert 'id="release-map-2"' in html
