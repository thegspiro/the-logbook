"""Write the nginx security-headers snippet with the site's inline-script hashes.

Material for MkDocs puts a few small scripts inline in every page (the
theme's storage helpers and colour-scheme switch). A CSP of script-src 'self'
blocks them, which breaks search and the theme toggle, and 'unsafe-inline'
would let any injected script run too. So after each build this lists the
SHA-256 of every distinct inline script in the site and allows exactly those.
They differ only by how deep a page sits, so there are a handful, not one per
page.

Usage: python3 docs-site/csp.py SITE_DIR TEMPLATE OUTPUT
"""

from __future__ import annotations

import base64
import hashlib
import pathlib
import re
import sys

PLACEHOLDER = "__INLINE_SCRIPT_HASHES__"
# Scripts with a src= are covered by 'self'; JSON data blocks are never run.
INLINE_SCRIPT_RE = re.compile(
    r"<script(?![^>]*\bsrc\s*=)([^>]*)>(.*?)</script>", re.DOTALL | re.IGNORECASE
)
NON_EXECUTABLE_TYPES = ("application/json", "application/ld+json")


def inline_script_hashes(html: str) -> set[str]:
    hashes = set()
    for attrs, body in INLINE_SCRIPT_RE.findall(html):
        if any(kind in attrs.lower() for kind in NON_EXECUTABLE_TYPES):
            continue
        digest = hashlib.sha256(body.encode("utf-8")).digest()
        hashes.add("'sha256-" + base64.b64encode(digest).decode("ascii") + "'")
    return hashes


def site_hashes(site_dir: pathlib.Path) -> list[str]:
    hashes: set[str] = set()
    for page in site_dir.rglob("*.html"):
        hashes |= inline_script_hashes(page.read_text(encoding="utf-8"))
    return sorted(hashes)


def render(template: str, hashes: list[str]) -> str:
    if PLACEHOLDER not in template:
        raise ValueError(f"the template has no {PLACEHOLDER} placeholder")
    return template.replace(PLACEHOLDER, " ".join(hashes))


def main(argv: list[str]) -> int:
    if len(argv) != 4:
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        return 2
    site_dir, template, output = (pathlib.Path(arg) for arg in argv[1:])
    hashes = site_hashes(site_dir)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(render(template.read_text(encoding="utf-8"), hashes))
    print(f"csp.py: allowed {len(hashes)} inline script(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
