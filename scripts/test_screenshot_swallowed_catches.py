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

**A gate that cannot be bypassed is the only kind worth having**, and the first
cut of this file could be, four ways — every one found in review, and every one
would have left the sweep green while the defect shipped:

  `.catch(() => undefined)`      six literal spellings were matched; this is not
                                 one of them, nor is `async () => null`, nor a
                                 block that returns a constant. Classified by
                                 what the handler *yields* now, failing closed:
                                 anything that is not demonstrably a recovery
                                 path (it throws, or does real work) is a
                                 swallow.
  `.isVisible().catch(() => [])` exempted as a "probe" though `[]` is truthy and
                                 takes the present branch on failure. The
                                 exemption now needs the probe directly attached
                                 AND a `false` fallback.
  a statement merely *mentioning* a probe was exempt wholesale, so a swallowed
                                 action beside one was skipped.
  an identical statement in a different shot inherited its exemption, because a
                                 signature was only (file, statement). It now
                                 carries the enclosing shot id or declaration.
"""

from __future__ import annotations

import hashlib
import re
import unittest
from pathlib import Path

SCREENSHOTS = Path(__file__).resolve().parent / "screenshots"

CATCH = re.compile(r"\.catch\(")

# A value that carries no information about the failure. `.catch(() => false)`
# and `.catch(() => undefined)` are the same defect wearing different clothes,
# which is why this is a value set rather than a handful of literal spellings:
# the first cut of this file matched six exact strings, so `() => undefined`,
# `async () => null` and `() => { return null; }` all walked through the gate.
SWALLOW_VALUES = {
    "",
    "{}",
    "[]",
    "''",
    '""',
    "``",
    "null",
    "undefined",
    "false",
    "true",
    "0",
    "-1",
}

# Probes, and the only fallback that makes one a question rather than a swallow.
# `.isVisible().catch(() => [])` is NOT a probe: `[]` is truthy, so a failure
# takes the *present* branch. Matched as a direct attachment — `probe().catch(`
# — because searching the whole statement for `.isVisible()` exempted any
# compound statement that merely mentioned one.
PROBE = re.compile(
    r"\.(?:isVisible|isChecked|isEnabled|isHidden)\(\s*\)\s*\.?$|"
    r"\.then\(\s*\(\)\s*=>\s*true\s*\)\s*\.?$"
)


def is_false_fallback(argument: str) -> bool:
    """`() => false` exactly — the only fallback that keeps a probe a question."""
    return (
        re.fullmatch(r"(?:async\s+)?\(\s*\)\s*=>\s*false", argument.strip()) is not None
    )


# A function declaration or a shot's `id:`, for naming the site a frozen
# signature belongs to.
CONTEXT = re.compile(
    r"""^\s*id:\s*["']([^"']+)["']|"""
    r"^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)|"
    r"^\s*(?:export\s+)?const\s+(\w+)\s*="
)


# Statement starters, for walking back from a `.catch` to the head of its chain.
STATEMENT_START = re.compile(
    r"^\s*(await|return|const|let|var|if|\}|for|while)\b|^\s*\w+\("
)


def strip_comments(lines: list[str]) -> list[str]:
    """Blank out comment text, preserving line count so line numbers stay true.

    Needed because this file's own prose quotes the pattern it bans, and so does
    every comment in `capture.mjs` explaining why a catch was removed — scanning
    raw text reported those quotations as live code, which is how the first run
    of this sweep "found" a defect inside its own docstring.

    String-aware, and not as tidiness. Two real cases, one found by proving the
    doubt and one by review:

      capture.mjs:36          "http://localhost:3000"   the `//` ended the line
      inventory-setup.mjs:444 "**/api/v1/**"            the `/*` opened a block

    The second is worse: with no `*/` on that line the block ran on for 35 lines,
    so any swallow in that window was invisible. Nothing was actually hidden —
    the only `.catch` past it is a recovery handler — but a guard with a silent
    blind spot is the failure this file exists to prevent.

    Quote state resets per line. A template literal spanning lines is therefore
    scanned as if each line opened fresh; none of the three files has one, and
    carrying state across lines mis-reads a stray backtick in prose far more
    often than it helps. Regex literals are not tracked either: none in these
    files contains `//` or `/*`, and a `/` is too ambiguous to guess at.
    """
    out: list[str] = []
    in_block = False
    for line in lines:
        kept: list[str] = []
        quote: str | None = None
        i = 0
        while i < len(line):
            char, pair = line[i], line[i : i + 2]
            if in_block:
                if pair == "*/":
                    in_block = False
                    i += 2
                else:
                    i += 1
                continue
            if quote is not None:
                kept.append(char)
                if char == "\\" and i + 1 < len(line):
                    kept.append(line[i + 1])
                    i += 2
                    continue
                if char == quote:
                    quote = None
                i += 1
                continue
            if char in ("'", '"', "`"):
                quote = char
                kept.append(char)
                i += 1
                continue
            if pair == "/*":
                in_block = True
                i += 2
                continue
            if pair == "//":
                break
            kept.append(char)
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


def catch_argument(lines: list[str], index: int, column: int) -> str:
    """The text inside `.catch(...)`, paren-balanced, across lines if need be.

    Taken by balancing rather than by regex so a block body and a multi-line
    handler are both readable — the two forms the first version could not see.
    """
    text = "\n".join(lines[index : index + 6])
    start = text.index(".catch(", column) + len(".catch(")
    depth, i = 1, start
    while i < len(text) and depth:
        if text[i] == "(":
            depth += 1
        elif text[i] == ")":
            depth -= 1
        i += 1
    return text[start : i - 1]


def is_swallow(argument: str) -> bool:
    """True when the handler discards the failure and yields a bare value.

    Fails closed on the arrow forms and open on everything else: a handler that
    is not a simple arrow (a named function, a `.catch(handleIt)`) is left to
    review rather than guessed at, and one whose body does real work — throws,
    calls something, assigns — is a recovery path.
    """
    body = argument.strip()
    match = re.match(r"^(?:async\s+)?\(?[\w\s,]*\)?\s*=>\s*(.*)$", body, re.S)
    if not match:
        return False
    rhs = match.group(1).strip()
    if rhs.startswith("{"):
        inner = (rhs[1:-1] if rhs.endswith("}") else rhs[1:]).strip()
        if not inner:
            return True  # `() => {}`
        if re.search(r"\bthrow\b", inner):
            return False  # re-raises: the failure still reaches the caller
        # Any block that ends by handing back a bare value is a swallow, even if
        # it logs on the way. Logging is not reporting: the caller still receives
        # a value indistinguishable from success, which is the whole defect.
        returned = re.search(r"return\s*([^;}]*)\s*;?\s*$", inner, re.S)
        return bool(returned) and returned.group(1).strip() in SWALLOW_VALUES
    return rhs.rstrip(";").strip() in SWALLOW_VALUES


def context_for(lines: list[str], index: int) -> str:
    """The nearest enclosing shot id or declaration name above `index`.

    Without this a signature is (file, statement), so deleting a frozen catch
    and adding the identical statement to a different shot in the same file
    keeps the signature and silently inherits the exemption — and the manifest
    has four statements that already appear twice, which is exactly where that
    would happen.
    """
    for back in range(index, -1, -1):
        found = CONTEXT.match(lines[back])
        if found:
            return next(g for g in found.groups() if g)
    return "?"


def signature(name: str, context: str, statement: str, occurrence: int = 1) -> str:
    digest = hashlib.sha1(f"{context}|{statement}".encode()).hexdigest()[:12]
    suffix = f"#{occurrence}" if occurrence > 1 else ""
    return f"{name}:{context}:{digest}{suffix}"


def swallowing_sites() -> list[tuple[str, int, str, str]]:
    """Every `.catch` that replaces a failure with a plausible value."""
    found: list[tuple[str, int, str, str]] = []
    for path in sorted(SCREENSHOTS.glob("*.mjs")):
        lines = strip_comments(path.read_text().split("\n"))
        seen: dict[str, int] = {}
        for i, line in enumerate(lines):
            for match in CATCH.finditer(line):
                argument = catch_argument(lines, i, match.start())
                if not is_swallow(argument):
                    continue
                statement = statement_for(lines, i)
                # Directly attached, judged on the normalized statement rather
                # than on this line: a probe chain is usually broken over four
                # lines, so the text before `.catch(` on its own line is just
                # whitespace. Searching the *whole* statement would be the other
                # error — it exempts any compound statement that merely mentions
                # a probe — so the prefix up to this catch must END with one.
                prefix = re.sub(r"\s+", " ", statement[: statement.rfind(".catch(")])
                if PROBE.search(prefix) and is_false_fallback(argument):
                    continue
                context = context_for(lines, i)
                key = f"{context}|{statement}"
                seen[key] = seen.get(key, 0) + 1
                found.append(
                    (
                        path.name,
                        i + 1,
                        statement,
                        signature(path.name, context, statement, seen[key]),
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
    # capture.mjs — all three load-bearing, verified not assumed.
    #   117  networkidle never settles on a page that polls; a 700ms wait and a
    #        spinner wait sit behind it.
    #   130  the spinner wait's own comment: "a page that legitimately spins
    #        forever should still produce an image to look at".
    #   538  runs while the page is still about:blank, where touching
    #        localStorage throws SecurityError. Removing this catch breaks the
    #        first shot of every auth mode.
    "capture.mjs:settle:c86bb2d6fa11",  # :117 other
    "capture.mjs:settle:16041cdf492c",  # :130 other
    "capture.mjs:page:ab5c6e059388",  # :538 framing
    # inventory-setup.mjs — optional work, both correct.
    #   50   pngquant is an optimisation; an unoptimised PNG is still the image.
    #   443  unrouteAll teardown, on a context that may define no routes.
    "inventory-setup.mjs:optimize:b4e03584a18b",  # :50 other
    "inventory-setup.mjs:installRoutes:506ee5ec7058",  # :443 other
    # manifest.mjs — 39 per-shot `prepare` steps, grouped by what the catch
    # hides. `framing` and `action` are where the #2433 defect lives: a scroll
    # that is the last thing a step does, or a click/fill/check the caption
    # depends on. Judging one needs the pipeline run against the seeded demo
    # database and a browser, so none is changed here.
    "manifest.mjs:control:bdf8c5426fbe",  # :131 framing
    "manifest.mjs:header:8fd3973404b2",  # :209 framing
    "manifest.mjs:button:bd468a1f0431",  # :234 framing
    "manifest.mjs:text:661040eb2ac0",  # :1158 read
    "manifest.mjs:text:8f97a7480c45",  # :1160 action
    "manifest.mjs:text:661040eb2ac0#2",  # :1168 read
    "manifest.mjs:text:8f97a7480c45#2",  # :1170 action
    "manifest.mjs:total:5562d3e147cc",  # :1300 action
    "manifest.mjs:dialog:ea1a89b29f1e",  # :2535 action
    "manifest.mjs:count:06d770d3e588",  # :2580 framing
    "manifest.mjs:options:3d4c4b666086",  # :2662 action
    "manifest.mjs:options:272bb5c889a0",  # :2669 action
    "manifest.mjs:picker:e622cca48045",  # :3022 framing
    "manifest.mjs:withFile:7788c5b6e608",  # :3065 action
    "manifest.mjs:button:bd468a1f0431#2",  # :3068 framing
    "manifest.mjs:dialog:c84a4901557e",  # :3337 action
    "manifest.mjs:next:282f04691771",  # :3598 action
    "manifest.mjs:search:1b2583065287",  # :3610 action
    "manifest.mjs:05-59-impact-planner-results:8d062bf3a840",  # :3860 framing
    "manifest.mjs:panel:2595e8bf27ba",  # :3904 framing
    "manifest.mjs:03-49-report-card-names:af27e4619669",  # :4014 framing
    "manifest.mjs:00-19-change-password:33a5b3b98233",  # :4087 action
    "manifest.mjs:00-15-sidebar-member:48dc35beca5f",  # :4148 action
    "manifest.mjs:00-16-sidebar-admin:00d4a3e50d9a",  # :4172 action
    "manifest.mjs:00-16-sidebar-admin:311c65b0f5be",  # :4180 framing
    "manifest.mjs:row:d735ecaf519e",  # :4289 action
    "manifest.mjs:card:c7e06061204b",  # :4309 framing
    "manifest.mjs:add:fd29a77a32d1",  # :4996 framing
    "manifest.mjs:add:0e31a84966ce",  # :5043 framing
    "manifest.mjs:body:b21093097440",  # :5759 framing
    "manifest.mjs:08-58-template-send-test:e8a025c27831",  # :5797 framing
    "manifest.mjs:select:b6a5f4395f70",  # :5950 framing
    "manifest.mjs:08-67-email-preview-design:12fc434515ee",  # :5994 framing
    "manifest.mjs:03-37-settings-rating-scale:c07e519d612b",  # :7651 toast
    "manifest.mjs:card:c7e06061204b#2",  # :7854 framing
    "manifest.mjs:02-30-shift-reports:26793f8cac6f",  # :8289 action
    "manifest.mjs:01-08-member-audit-history:c3b00dcab664",  # :9354 action
    "manifest.mjs:banner:17977b4ca06d",  # :10060 toast
    "manifest.mjs:value:50ec95f10a7c",  # :10789 read
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
        """A frozen entry whose site is gone is stale and should be deleted."""
        live = {sig for _, _, _, sig in swallowing_sites()}
        stale = sorted(FROZEN - live)
        assert (
            not stale
        ), f"FROZEN names sites that no longer exist -- delete these: {stale}"

    # --- the gate must not be bypassable: one case per review finding ---

    def test_equivalent_swallows_are_all_caught(self):
        """Six literal spellings was the first cut, and three forms walked past it.

        `() => undefined`, `async () => null` and a block returning a constant
        are the same defect as `() => {}`; a gate that takes only the spellings
        it has seen before is a gate that reports nothing and looks clean.
        """
        for argument in (
            "() => {}",
            "() => undefined",
            "async () => null",
            "() => { return null; }",
            "() => { return undefined }",
            "(e) => null",
            "() => []",
            "() => 0",
            '() => ""',
            "() => { log(e); return null; }",
        ):
            assert is_swallow(argument), argument

    def test_a_handler_that_does_work_is_not_a_swallow(self):
        """Re-raising or recovering keeps the failure reachable."""
        for argument in (
            "(err) => { throw err; }",
            "async () => { await fallback(); }",
            "handleIt",
        ):
            assert not is_swallow(argument), argument

    def test_a_probe_exemption_requires_a_false_fallback(self):
        """`.isVisible().catch(() => [])` is not a probe: `[]` is truthy.

        The exemption used to fire on any statement that merely mentioned a
        probe, so a truthy fallback took the *present* branch on failure and a
        swallowed action in a compound statement was skipped outright.
        """
        assert is_false_fallback("() => false")
        assert not is_false_fallback("() => []")
        assert not is_false_fallback("() => null")
        assert not is_false_fallback("() => true")

    def test_probe_must_be_directly_attached(self):
        """The chain up to the catch has to END with the probe.

        Judged on the normalized statement, not the catch's own line: a probe
        chain is usually broken over four lines, so the line-local text before
        `.catch(` is just whitespace and three real probes were reported.
        """
        attached = "if (await pause.isVisible().catch(() => false)) {"
        assert PROBE.search(attached[: attached.rfind(".catch(")])
        multiline = statement_for(
            [
                "        const shown = await url",
                '          .waitFor({ state: "visible", timeout: 2_000 })',
                "          .then(() => true)",
                "          .catch(() => false);",
            ],
            3,
        )
        assert PROBE.search(multiline[: multiline.rfind(".catch(")])
        # A compound statement that merely mentions a probe is not exempt.
        unrelated = "await thing.isVisible(); await other.click().catch(() => {});"
        assert not PROBE.search(unrelated[: unrelated.rfind(".catch(")])

    def test_a_signature_is_bound_to_its_site(self):
        """Identical statements in different shots must not share an exemption.

        Without the enclosing context a frozen catch could be deleted and the
        same statement added to a different shot, silently inheriting the
        exemption -- and four statements already appear twice in the manifest.
        """
        statement = (
            "await card.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(() => {});"
        )
        first = signature("manifest.mjs", "04-34-applicant-drawer", statement)
        second = signature("manifest.mjs", "19-07-prospect-detail", statement)
        assert first != second, "same statement in two shots must differ"
        assert signature("manifest.mjs", "x", statement, 2).endswith("#2")

    def test_comments_are_not_scanned_as_code(self):
        """This file and `capture.mjs` both quote the banned pattern in prose."""
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

    def test_a_string_is_not_read_as_a_comment(self):
        """Both real cases: a `//` in a URL and a `/*` in a route glob.

        The glob is the worse of the two — with no `*/` on the line the block
        ran on for 35 lines of `inventory-setup.mjs`, so any swallow in that
        window was invisible to the gate.
        """
        url = 'await page.goto("http://localhost:3000").catch(() => {});'
        assert ".catch(() => {})" in strip_comments([url])[0]
        glob = 'await context.route("**/api/v1/**", handler);'
        assert strip_comments([glob])[0].rstrip().endswith(";"), "glob truncated"
        # And the block state must not leak into the next line.
        assert strip_comments([glob, "const x = y().catch(() => {});"])[1].strip()

    def test_the_sweep_detects_a_reintroduced_swallow(self):
        """The shape removed from `pageText`, driven through the real path."""
        lines = [
            "async function pageText(page) {",
            '  return page.locator("main, body").first().innerText().catch(() => "");',
            "}",
        ]
        statement = statement_for(lines, 1)
        assert is_swallow(catch_argument(lines, 1, lines[1].index(".catch(")))
        assert signature("capture.mjs", context_for(lines, 1), statement) not in FROZEN


if __name__ == "__main__":
    unittest.main()
