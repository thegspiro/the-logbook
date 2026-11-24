"""MkDocs hook that lets the repository's Markdown build into the site unedited.

The guides, the wiki and the site's own pages are written to read correctly on
GitHub, and they stay that way: nothing in docs/ or wiki/ is edited for the
site. This hook translates at build time instead.

* A relative link is resolved where its file lives in the repository, then
  pointed at the same file in the site. Every page keeps its repository path
  in the site (docs/ and wiki/ are staged as they are), except the site's own
  pages, which live in docs-site/content/ and are served from the root.
* A link to https://github.com/thegspiro/the-logbook/blob/main/... or to the
  GitHub wiki becomes a link inside the site when the target is published.
  The wiki links to the guides that way, and readers should not be sent to
  GitHub for a page this site already has.
* A link to a file the site does not publish (source code, an excluded review
  file) becomes a GitHub link, so it still works instead of 404ing.
* Inside wiki/, an extensionless page name ([Training](Module-Training)) is a
  GitHub-wiki page reference and gets its .md back.
* A line holding only ``!youtube VIDEO_ID Title`` (or ``!youtube-short`` for a
  vertical Short) becomes a privacy-enhanced YouTube embed.

Fenced code blocks and inline code are left alone, since their links are
examples rather than navigation.
"""

from __future__ import annotations

import html
import posixpath
import re
from typing import Optional

import markdown.extensions.toc
from mkdocs.exceptions import PluginError

REPO_URL = "https://github.com/thegspiro/the-logbook"
GITHUB_FILE_RE = re.compile(
    r"^https://github\.com/thegspiro/the-logbook/(?:blob|tree)/main/([^?#]*)$"
)
GITHUB_WIKI_RE = re.compile(
    r"^https://github\.com/thegspiro/the-logbook/wiki/?([^/?#]*)$"
)

# Wiki pages that wiki/setup-wiki.sh generates from a doc at publish time, so
# no file in wiki/ matches them (scripts/check_docs_links.py lists the same
# two). On the site the link opens the doc they are generated from.
WIKI_GENERATED_PAGES = {
    "wiki/Troubleshooting.md": "docs/TROUBLESHOOTING.md",
    "wiki/Error-Codes.md": "docs/ERROR_CODES.md",
}

# Repository directories staged into the site under the same path.
MIRRORED_DIRS = ("docs/", "wiki/")
# The site's own pages: served from the root, kept here in the repository.
SITE_CONTENT_DIR = "docs-site/content/"

FENCE_RE = re.compile(r"^\s{0,3}(`{3,}|~{3,})")
INLINE_CODE_RE = re.compile(r"(`+)(?:.+?)\1")
LINK_RE = re.compile(
    r"(!?)\[((?:[^\[\]]|\[[^\[\]]*\])*)\]\(([^()\s]+)(\s+\"[^\"]*\")?\)"
)
SCHEME_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*:")
YOUTUBE_RE = re.compile(r"^!youtube(-short)?(?:\s+(\S+))?(?:\s+(.*?))?\s*$")
YOUTUBE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


def github_unique(id: str, ids, counters=None) -> str:
    """Python-Markdown's toc.unique(), numbered the way GitHub numbers.

    A repeated heading is ``name-1``, ``name-2`` on GitHub and ``name_1``,
    ``name_2`` in Python-Markdown. The docs link to repeated headings by their
    GitHub anchors (``#release-map-7``), so the site has to number them the
    same way. ``counters`` is accepted for Python-Markdown's signature and not
    needed here.
    """
    base = id
    count = 0
    while id in ids or not id:
        count += 1
        id = f"{base}-{count}"
    ids.add(id)
    return id


# TocTreeprocessor looks unique() up in its module on every heading, so
# replacing the module attribute is enough. Hooks load before any page renders.
markdown.extensions.toc.unique = github_unique


def staged_to_repo(staged_path: str) -> str:
    """Return the repository path of a file at ``staged_path`` in the site."""
    if staged_path.startswith(MIRRORED_DIRS):
        return staged_path
    return SITE_CONTENT_DIR + staged_path


def repo_to_staged(repo_path: str) -> Optional[str]:
    """Return where a repository file is staged, or None when it is not."""
    if repo_path.startswith(MIRRORED_DIRS):
        return repo_path
    if repo_path.startswith(SITE_CONTENT_DIR):
        return repo_path[len(SITE_CONTENT_DIR) :]
    return None


def github_url(repo_path: str, is_image: bool, is_directory: bool) -> str:
    kind = "tree" if is_directory else "blob"
    url = f"{REPO_URL}/{kind}/main/{repo_path}"
    # A blob page is HTML, which an <img> cannot show.
    return url + "?raw=true" if is_image else url


def _split_anchor(target: str) -> tuple[str, str]:
    path, sep, anchor = target.partition("#")
    return path, sep + anchor


class LinkRewriter:
    """Rewrites the links of one page. ``published`` says whether a staged
    path is a file the site serves."""

    def __init__(self, page_src: str, published):
        self.page_src = page_src
        self.page_repo = staged_to_repo(page_src)
        self.published = published

    def _published_target(self, staged: str) -> Optional[str]:
        """The staged file a link to ``staged`` should open, if any."""
        if self.published(staged):
            return staged
        for index in ("README.md", "index.md"):
            candidate = posixpath.join(staged.rstrip("/"), index) if staged else index
            if self.published(candidate):
                return candidate
        return None

    def _repo_target(self, path: str) -> Optional[str]:
        """Resolve a link path to a repository path, or None to leave it be."""
        match = GITHUB_FILE_RE.match(path)
        if match:
            return match.group(1).rstrip("/")
        match = GITHUB_WIKI_RE.match(path)
        if match:
            return f"wiki/{match.group(1) or 'Home'}.md"
        if SCHEME_RE.match(path) or path.startswith(("/", "//")):
            return None
        page_dir = posixpath.dirname(self.page_repo)
        if (
            self.page_repo.startswith("wiki/")
            and "/" not in path
            and not posixpath.splitext(path)[1]
        ):
            path += ".md"
        resolved = posixpath.normpath(posixpath.join(page_dir, path))
        if resolved == ".." or resolved.startswith("../"):
            return None
        return "" if resolved == "." else resolved

    def rewrite_target(self, target: str, is_image: bool) -> str:
        path, anchor = _split_anchor(target)
        if not path:
            return target
        repo_target = self._repo_target(path)
        if repo_target is None:
            return target
        repo_target = WIKI_GENERATED_PAGES.get(repo_target, repo_target)
        staged = repo_to_staged(repo_target)
        found = self._published_target(staged) if staged is not None else None
        if found is None:
            # The build has no repository checkout to ask, so a directory is
            # recognised by how the link was written: a trailing slash, a
            # GitHub tree URL, or a link to the repository root.
            is_directory = (
                path.endswith("/") or "/tree/main/" in path or repo_target == ""
            )
            return github_url(repo_target, is_image, is_directory) + anchor
        relative = posixpath.relpath(found, posixpath.dirname(self.page_src) or ".")
        return relative + anchor

    def rewrite_text(self, line: str) -> str:
        def replace(match: re.Match) -> str:
            bang, text, target, title = match.groups()
            new_target = self.rewrite_target(target, is_image=bool(bang))
            return f"{bang}[{text}]({new_target}{title or ''})"

        code_spans = [m.span() for m in INLINE_CODE_RE.finditer(line)]

        def replace_outside_code(match: re.Match) -> str:
            # A link may wrap inline code ([`file.py`](../file.py)), so the
            # whole match is kept; only a link that starts inside a code span
            # is an example rather than a link.
            if any(start < match.start() < end for start, end in code_spans):
                return match.group(0)
            return replace(match)

        return LINK_RE.sub(replace_outside_code, line)


def youtube_embed(line: str, page_src: str) -> Optional[str]:
    """Return the embed HTML for a ``!youtube`` line, or None for other lines.

    A malformed line fails the build rather than publishing a broken player,
    and the id is checked against YouTube's alphabet because it is placed in a
    URL.
    """
    match = YOUTUBE_RE.match(line.strip())
    if not match:
        return None
    short, video_id, title = match.groups()
    if not video_id or not YOUTUBE_ID_RE.match(video_id):
        raise PluginError(
            f"{page_src}: '!youtube' needs an 11-character YouTube video id, "
            f"got {video_id!r}"
        )
    label = html.escape(title or "Video", quote=True)
    css = "video-embed video-embed--short" if short else "video-embed"
    return (
        f'<div class="{css}"><iframe '
        f'src="https://www.youtube-nocookie.com/embed/{video_id}" '
        f'title="{label}" loading="lazy" '
        'allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; '
        'web-share" referrerpolicy="strict-origin-when-cross-origin" '
        "allowfullscreen></iframe></div>"
    )


def transform(markdown: str, page_src: str, published) -> str:
    """Apply the link rewriting and video embeds to one page's Markdown."""
    rewriter = LinkRewriter(page_src, published)
    out: list[str] = []
    # Prose is rewritten a run of lines at a time, because a link's text may
    # wrap onto the next line.
    prose: list[str] = []
    fence: Optional[str] = None
    in_comment = False

    def flush() -> None:
        if prose:
            out.append(rewriter.rewrite_text("\n".join(prose)))
            prose.clear()

    for line in markdown.split("\n"):
        # An HTML comment is a note to whoever edits the file (videos.md shows
        # the !youtube syntax in one), so it is passed through untouched.
        if in_comment:
            in_comment = "-->" not in line
            out.append(line)
            continue
        if fence is None and line.lstrip().startswith("<!--"):
            flush()
            in_comment = "-->" not in line[line.index("<!--") + 4 :]
            out.append(line)
            continue
        opening = FENCE_RE.match(line)
        if fence is not None:
            if (
                opening
                and opening.group(1)[0] == fence[0]
                and len(opening.group(1)) >= len(fence)
            ):
                fence = None
            out.append(line)
            continue
        if opening:
            flush()
            fence = opening.group(1)
            out.append(line)
            continue
        embed = youtube_embed(line, page_src)
        if embed is not None:
            flush()
            out.append(embed)
            continue
        prose.append(line)
    flush()
    return "\n".join(out)


def on_page_markdown(markdown, page, config, files, **kwargs):
    def published(staged_path: str) -> bool:
        found = files.get_file_from_path(staged_path)
        return found is not None and not found.inclusion.is_excluded()

    return transform(markdown, page.file.src_uri, published)
