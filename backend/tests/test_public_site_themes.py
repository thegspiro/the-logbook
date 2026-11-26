"""Every theme of the public website clears WCAG AAA contrast.

The pairs are read out of the stylesheet the site serves, so a theme added
there is measured the day it is added, and one that names a colour this test
cannot read fails loudly instead of being skipped.
"""

import re
from pathlib import Path

import pytest

from app.models.public_site import PublicSiteTheme

pytestmark = pytest.mark.unit

_CSS = (
    Path(__file__).resolve().parents[1]
    / "app"
    / "templates"
    / "public_site"
    / "site.css"
).read_text(encoding="utf-8")

#: (text, background) custom properties that are painted together.
_PAIRS = (
    ("page-text", "page-bg"),
    ("muted-text", "page-bg"),
    ("accent", "page-bg"),
    ("surface-text", "surface-bg"),
    ("accent", "surface-bg"),
    ("header-text", "header-bg"),
    ("hero-text", "hero-bg"),
    ("notice-text", "notice-bg"),
)

_AAA = 7.0


def _themes() -> dict[str, dict[str, str]]:
    themes = {}
    for name, block in re.findall(r"\.theme-([a-z]+)\s*\{([^}]*)\}", _CSS):
        themes[name] = dict(re.findall(r"--([a-z-]+):\s*([^;]+);", block))
    return themes


def _luminance(colour: str) -> float:
    match = re.fullmatch(r"#([0-9a-f]{6})", colour.strip())
    assert match, f"not a six-digit hex colour: {colour!r}"
    channels = []
    for i in (0, 2, 4):
        value = int(match.group(1)[i : i + 2], 16) / 255
        channels.append(
            value / 12.92 if value <= 0.03928 else ((value + 0.055) / 1.055) ** 2.4
        )
    red, green, blue = channels
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue


def _contrast(first: str, second: str) -> float:
    lighter, darker = sorted((_luminance(first), _luminance(second)), reverse=True)
    return (lighter + 0.05) / (darker + 0.05)


def test_the_stylesheet_defines_exactly_the_themes_on_offer():
    assert set(_themes()) == {theme.value for theme in PublicSiteTheme}


def test_the_measure_itself():
    assert _contrast("#000000", "#ffffff") == pytest.approx(21.0)
    assert _contrast("#777777", "#ffffff") < _AAA


@pytest.mark.parametrize("theme", [theme.value for theme in PublicSiteTheme])
@pytest.mark.parametrize(("text", "background"), _PAIRS)
def test_every_pair_a_theme_paints_clears_aaa(theme, text, background):
    properties = _themes()[theme]
    ratio = _contrast(properties[text], properties[background])
    assert ratio >= _AAA, f"{theme}: --{text} on --{background} is {ratio:.2f}:1"


def test_nothing_below_the_themes_names_a_colour():
    rules = _CSS[_CSS.index("*,\n*::before") :]
    assert not re.search(r"#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(", rules)
