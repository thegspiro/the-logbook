"""A swallowed `.catch` in the screenshot pipeline reports a wrong picture as a good one.

The capture pipeline has no assertions of its own: it drives the real app, takes
an image, and writes a report saying which shots succeeded. Every check that a
published image is the image the caption promises lives in `capture.mjs`, and
every one of them is reached through a Playwright call that can reject. So a
`.catch` that converts a rejection into a plausible-looking value does not
degrade gracefully — it manufactures a pass:

    pageText()                  -> ""     no crash, no error, no empty state
    detectHorizontalOverflow()  -> null   measured, and it is fine
    scrollIntoView()            -> ()     framed as asked

None of those are visible downstream. The page really is populated, the report
really says `+`, the exit code really is 0, and the wrong picture lands in a
training guide as though it were the feature.

This has been fixed one instance at a time five times (PRs #2419 twice, #2433,
and twice inside #2419's own review rounds), each time in the same two files,
twice by the commit that removed the previous one. This sweep is the thing that
stops the sixth: a new swallowing `.catch` in `scripts/screenshots/` fails here.

**It is a ratchet, not a rule.** `FROZEN` carries the swallowing sites that
existed when this was written, so the sweep reports new ones without demanding
that a backlog in per-shot `prepare` steps be cleared first. A green run means
"no new ones", not "none". Clearing a frozen entry means removing its `.catch`
and deleting its line here.
"""

from __future__ import annotations

import hashlib
import re
import unittest
from pathlib import Path

SCREENSHOTS = Path(__file__).resolve().parent / "screenshots"

CATCH = re.compile(r"\.catch\(")

# The value a swallowing handler hands back in place of the failure. A handler
# with real statements in it is a recovery path and is not this pattern.
SWALLOW_ARG = re.compile(
    r"^\.catch\(\(\)\s*=>\s*(\{\}|''|\"\"|``|null|false|\[\])\s*\)"
)

# Asking a question, where "it is not there" is a real answer rather than a
# hidden failure. `isVisible` on a control that may not exist is the whole
# point of calling it, and every call site guards on the result.
#
# Deliberately keyed on the predicate, not on the receiver: `innerText()` is a
# candidate scan in the manifest and the input to three checks in `capture.mjs`,
# so "which method was called" cannot tell the two apart. A `.then(() => true)`
# immediately before the catch is the other unambiguous probe shape.
PROBE_RECEIVERS = ("isVisible", "isChecked", "isEnabled", "isHidden")
PROBE_THEN = re.compile(r"\.then\(\(\)\s*=>\s*true\)\s*\.catch\(")

# Statement starters, for walking back from a `.catch` to the head of its chain.
STATEMENT_START = re.compile(
    r"^\s*(await|return|const|let|var|if|\}|for|while)\b|^\s*\w+\("
)


def strip_comments(lines: list[str]) -> list[str]:
    """Blank out comment text, preserving line count so numbers stay true.

    Needed because this file's own prose quotes the pattern it bans, and so does
    every comment in `capture.mjs` explaining why a catch was removed — scanning
    raw text reports those as live code.
    """
    out: list[str] = []
    in_block = False
    for line in lines:
        kept, i = [], 0
        while i < len(line):
            two = line[i : i + 2]
            if in_block:
                if two == "*/":
                    in_block = False
                    i += 2
                    continue
                i += 1
            elif two == "/*":
                in_block = True
                i += 2
            elif two == "//":
                break
            else:
                kept.append(line[i])
                i += 1
        out.append("".join(kept))
    return out


def statement_for(lines: list[str], index: int) -> str:
    """The chain the `.catch` on `lines[index]` terminates, whitespace-normalized.

    Hashed rather than line-numbered so an edit elsewhere in a 10,000-line
    manifest does not invalidate every frozen entry — only changing the
    statement itself does, which is exactly when it wants re-reading.
    """
    start = index
    for back in range(index, max(-1, index - 12), -1):
        if STATEMENT_START.match(lines[back]):
            start = back
            break
    return re.sub(r"\s+", " ", " ".join(lines[start : index + 1])).strip()


def signature(name: str, statement: str, occurrence: int = 1) -> str:
    """`file:hash` for a statement, plus `#n` when a file repeats it verbatim.

    The occurrence suffix matters: four statements appear twice in the manifest
    (two day-cell scans, two `scrollIntoViewIfNeeded` helpers), and without it
    one set entry would cover both — so removing one would leave the sweep
    silent about the other still being there.
    """
    digest = hashlib.sha1(statement.encode()).hexdigest()[:12]
    return f"{name}:{digest}" + (f"#{occurrence}" if occurrence > 1 else "")


def swallowing_sites() -> list[tuple[str, int, str, str]]:
    """Every `.catch` that replaces a failure with a plausible value."""
    found: list[tuple[str, int, str, str]] = []
    for path in sorted(SCREENSHOTS.glob("*.mjs")):
        lines = strip_comments(path.read_text().split("\n"))
        seen: dict[str, int] = {}
        for i, line in enumerate(lines):
            for match in CATCH.finditer(line):
                tail = line[match.start() :]
                if not SWALLOW_ARG.match(tail):
                    continue  # a recovery handler, or a multi-line body
                statement = statement_for(lines, i)
                if any(f".{probe}()" in statement for probe in PROBE_RECEIVERS):
                    continue
                if PROBE_THEN.search(statement):
                    continue
                seen[statement] = seen.get(statement, 0) + 1
                found.append(
                    (
                        path.name,
                        i + 1,
                        statement,
                        signature(path.name, statement, seen[statement]),
                    )
                )
    return found


# Swallowing sites as of 2026-09-10, after the three in `capture.mjs`'s detector
# layer were removed. Each is a per-shot `prepare` step: the blast radius is one
# image rather than every check in the run, which is why they are frozen here
# instead of changed blind. Roughly a dozen of them look like genuine instances
# of the #2433 defect — a framing scroll or a state-setting click whose failure
# the shot's own caption depends on — but deciding that per shot needs the
# capture pipeline actually run (a dev server, the seeded demo database and a
# browser), and a wrong guess turns a working shot red. See the pull request for
# the annotated inventory.
FROZEN = {
    # capture.mjs — all three load-bearing, verified rather than assumed.
    #   117  networkidle never settles on a page that polls; a 700ms wait and a
    #        spinner wait sit behind it.
    #   130  the spinner wait's own comment: "a page that legitimately spins
    #        forever should still produce an image to look at".
    #   536  runs while the page is still about:blank, where touching
    #        localStorage throws SecurityError. Removing this catch breaks the
    #        first shot of every auth mode.
    "capture.mjs:26ac4221c48e",  # :117 other — await page.waitForLoadState("networkidle").catch(() => {});
    "capture.mjs:3348621a68b3",  # :130 other — await page .waitForFunction( () => document.querySelectorAll("
    "capture.mjs:284b3168c192",  # :536 framing — await page .evaluate(() => localStorage.removeItem("navigation
    # inventory-setup.mjs — optional work, both correct.
    #   50   pngquant is an optimisation; an unoptimised PNG is still the image.
    #   443  unrouteAll teardown, on a context that may define no routes.
    "inventory-setup.mjs:ef35bc7e79c4",  # :50 other — await run("pngquant", [ "--quality=70-92", "--speed", "1", "--
    "inventory-setup.mjs:78507bc8be00",  # :443 other — await context.unrouteAll?.().catch(() => {});
    # manifest.mjs — 39 per-shot `prepare` steps, grouped by what the catch
    # hides. `framing` and `action` are where the #2433 defect lives: a scroll
    # that is the last thing the step does, or a click/fill/check the caption
    # depends on. Each needs the pipeline run against the seeded demo database
    # to judge, so none is changed here.
    "manifest.mjs:3fb92721c482",  # :131 framing — await control.scrollIntoViewIfNeeded({ timeout: 10_000 }).catc
    "manifest.mjs:b1364c01dcfe",  # :209 framing — await header.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch
    "manifest.mjs:770a61e00c81",  # :234 framing — await button.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch
    "manifest.mjs:9483c17a54e3",  # :1158 read — const text = (await cell.innerText().catch(() => "")) ?? "";
    "manifest.mjs:d9b8c624b32e",  # :1160 action — await cell.click({ timeout: 5_000 }).catch(() => {});
    "manifest.mjs:9483c17a54e3#2",  # :1168 read — const text = (await cell.innerText().catch(() => "")) ?? "";
    "manifest.mjs:d9b8c624b32e#2",  # :1170 action — await cell.click({ timeout: 5_000 }).catch(() => {});
    "manifest.mjs:24796621747b",  # :1300 action — await days .nth(i) .click({ timeout: 5_000 }) .catch(() => {})
    "manifest.mjs:8f4f2e2b8a72",  # :2535 action — await dialog .getByPlaceholder(/e\.g\.|name/i) .first() .fill(
    "manifest.mjs:989eec230cff",  # :2580 framing — await toggles .first() .scrollIntoViewIfNeeded({ timeout: 10_0
    "manifest.mjs:a1c05b257eee",  # :2662 action — await page .getByRole("button", { name: size, exact: true }) .
    "manifest.mjs:fa8fc4cae78e",  # :2669 action — await page .getByRole("button", { name: style, exact: true })
    "manifest.mjs:f53834541c01",  # :3022 framing — await picker.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch
    "manifest.mjs:4c12d07e8041",  # :3065 action — await page .getByRole("button", { name: /^All Time$/ }) .click
    "manifest.mjs:770a61e00c81#2",  # :3068 framing — await button.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch
    "manifest.mjs:e13fc4d5a2c6",  # :3337 action — await dialog .getByText(/#0\d\d/) .nth(index) .click() .catch(
    "manifest.mjs:6f634384404c",  # :3598 action — await page .getByText(/^Structure Fire$|^EMS$/) .first() .clic
    "manifest.mjs:10ba3baf1dea",  # :3610 action — await page .locator("button", { hasText: /@/ }) .first() .clic
    "manifest.mjs:5dd155665adf",  # :3860 framing — await page .locator("main, [role='main']") .first() .evaluate(
    "manifest.mjs:71899c8aa0ce",  # :3904 framing — await panel.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(
    "manifest.mjs:379ee3960d1c",  # :4014 framing — await page .locator("button:visible") .filter({ hasText: /\d+(
    "manifest.mjs:ca8f11408727",  # :4087 action — await page .locator('input[type="password"]') .nth(1) .fill("O
    "manifest.mjs:d8254ba50452",  # :4148 action — await page .getByRole("button", { name: new RegExp(`^${group}$
    "manifest.mjs:fcad5d9e0900",  # :4172 action — await page .getByRole("button", { name: /^Members$/ }) .last()
    "manifest.mjs:50b460f3ad6a",  # :4180 framing — await page .locator("nav") .first() .evaluate((el) => { el.scr
    "manifest.mjs:faff0d9cd178",  # :4289 action — await page .getByRole("button", { name: /select all/i }) .firs
    "manifest.mjs:7f16d8786245",  # :4309 framing — await card.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch((
    "manifest.mjs:3221094dc6bb",  # :4996 framing — await page .getByText("Stage Type *", { exact: true }) .scroll
    "manifest.mjs:2216cbc32c1e",  # :5043 framing — await page .getByText("Email Subject", { exact: false }) .firs
    "manifest.mjs:2a5b663d561a",  # :5759 framing — await body.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch((
    "manifest.mjs:8a23c84cd6d7",  # :5797 framing — await page .getByRole("button", { name: /Send Test to Me/i })
    "manifest.mjs:981ccc2defc2",  # :5950 framing — await select.scrollIntoViewIfNeeded().catch(() => {});
    "manifest.mjs:dc2c5f347033",  # :5994 framing — await page .getByText(/automated message from|Sent by/i) .firs
    "manifest.mjs:a148a9549951",  # :7651 toast — await page .getByText(/display style updated/i) .first() .wait
    "manifest.mjs:7f16d8786245#2",  # :7854 framing — await card.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch((
    "manifest.mjs:c60a5a5c042d",  # :8289 action — await page .getByRole("checkbox") .first() .check({ timeout: 1
    "manifest.mjs:ec2a5d98f6cd",  # :9354 action — await page .getByRole("button", { name: /expand details/i }) .
    "manifest.mjs:90f0ef8678d9",  # :10060 toast — await page .getByText(/Ballots sent to \d+ voter/) .waitFor({
    "manifest.mjs:d14d95138791",  # :10789 read — const value = await select .locator("option") .nth(1) .getAttr
}


class TestNoNewSwallowedCatches(unittest.TestCase):
    def test_no_unfrozen_swallowing_catch(self):
        unfrozen = [s for s in swallowing_sites() if s[3] not in FROZEN]
        detail = "\n".join(
            f"  {name}:{line}\n    {statement[:160]}\n    signature: {sig}"
            for name, line, statement, sig in unfrozen
        )
        assert not unfrozen, (
            "New swallowing `.catch` in scripts/screenshots/.\n\n"
            f"{detail}\n\n"
            "A rejection here becomes a plausible value, so the run reports a wrong\n"
            "picture as a good one and exits 0. Either let it reject -- the per-shot\n"
            "try/catch records the shot as failed, which is what surfaces the fault --\n"
            "or, if the failure genuinely is the answer, add the signature to FROZEN\n"
            "with a comment saying why."
        )

    def test_frozen_entries_all_still_exist(self):
        """A frozen entry whose site is gone is stale and should be deleted.

        Without this the allowlist silently accumulates signatures for code that
        no longer exists, and the next reader cannot tell which entries are real.
        """
        live = {sig for _, _, _, sig in swallowing_sites()}
        stale = sorted(FROZEN - live)
        assert (
            not stale
        ), f"FROZEN names sites that no longer exist -- delete these: {stale}"

    def test_the_sweep_detects_a_reintroduced_swallow(self):
        """The sweep is worthless if it cannot see the defect it exists to catch.

        The shape is the one removed from `pageText`, which cleared the crash,
        page-error and empty-state checks at once. Driven through the real
        `statement_for`/`signature` path rather than asserting on the regex
        alone, so a change that broke statement extraction would fail here.
        """
        lines = [
            "async function pageText(page) {",
            '  return page.locator("main, body").first().innerText().catch(() => "");',
            "}",
        ]
        statement = statement_for(lines, 1)
        assert SWALLOW_ARG.match(lines[1][lines[1].index(".catch(") :])
        assert "innerText" in statement, statement
        assert signature("capture.mjs", statement) not in FROZEN

    def test_a_probe_is_not_reported(self):
        """`isVisible()` answering false is the call's purpose, not a swallow."""
        statement = statement_for(
            ["      if (await pause.isVisible().catch(() => false)) {"], 0
        )
        assert any(f".{probe}()" in statement for probe in PROBE_RECEIVERS)

    def test_a_then_true_probe_is_not_reported(self):
        """`.then(() => true).catch(() => false)` is a visibility question."""
        statement = statement_for(
            [
                "        const shown = await url",
                '          .waitFor({ state: "visible", timeout: 2_000 })',
                "          .then(() => true)",
                "          .catch(() => false);",
            ],
            3,
        )
        assert PROBE_THEN.search(statement), statement

    def test_a_recovery_handler_is_not_reported(self):
        """A `.catch` with a real body is a fallback path, not a swallow."""
        assert SWALLOW_ARG.match(".catch(async () => {") is None
        assert SWALLOW_ARG.match(".catch((err) => { throw err; })") is None

    def test_comments_are_not_scanned_as_code(self):
        """This file and `capture.mjs` both quote the banned pattern in prose.

        Scanning raw text reported those quotations as live swallows -- which is
        how the first run of this sweep "found" a defect inside its own comment.
        """
        stripped = strip_comments(
            [
                "// a comment mentioning .catch(() => {}) in prose",
                "/* a block comment with .catch(() => '') inside */",
                "const real = thing().catch(() => {});",
            ]
        )
        assert ".catch(" not in stripped[0], stripped[0]
        assert ".catch(" not in stripped[1], stripped[1]
        assert ".catch(() => {})" in stripped[2], stripped[2]
        assert len(stripped) == 3, "line numbering must survive stripping"


if __name__ == "__main__":
    unittest.main()
