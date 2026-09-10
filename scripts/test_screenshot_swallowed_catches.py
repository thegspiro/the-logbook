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

**A gate that can be bypassed is worse than no gate**, because it answers the
question "are there new swallows?" with a confident no. Every bypass below was
found after this file was first written, most of them in review, and every one
would have left the sweep green while the defect shipped.

Five were the same mistake: the scanner read raw text, so a character inside a
string or a comment was indistinguishable from syntax.

    .catch(() => { log(")"); return null; })   the `)` ended the argument early
    .catch(() => { warn("throw"); ... })       `throw` inside a string passed
                                               for a rethrow, exempting the
                                               swallow under it
    "http://localhost:3000"                    the `//` ended the line
    `...                                       a `/*` on a template's second
      **/api/v1/**`                            line opened a comment to EOF
    "write .catch(() => null)"                 and the reverse: prose in a
                                               string reported as code

So the text is no longer read raw. `scan_source` walks it once as JavaScript and
returns two views of identical length: `code`, with comments blanked, and `mask`,
with the *contents* of comments, strings, template literals and regex literals
blanked as well. Structure — finding `.catch`, balancing its parentheses,
spotting a `throw` — is read off `mask`, where no datum can impersonate syntax.
Statement text for signatures is read off `code`, so a signature still says what
the code says.

The rest were each their own mistake, and each has a test:

  `.catch(() => undefined)`      six literal spellings were matched; this is not
                                 one of them, nor is `async () => null`, nor a
                                 block that returns a constant. Classified by
                                 what the handler *yields* now, failing closed.
  `.isVisible().catch(() => [])` exempted as a "probe" though `[]` is truthy and
                                 takes the present branch on failure. The
                                 exemption needs a `false` fallback.
  a statement merely *mentioning* a probe was exempt wholesale, so a swallowed
                                 action beside one was skipped.
  `.click().then(() => true)`    looked like a probe because the chain ended in
                                 a promise mapped to `true`. The exemption now
                                 requires an actual observation underneath.
  `.catch (() => null)`          a legal space — or newline — before the call
                                 parens, which nothing here normalizes.
  a handler past six lines       the argument was read through a fixed window,
                                 so a block that logged before returning a
                                 constant was classified on a truncated slice.
  `.catch(() => (null))`         a redundant paren round the value, and `({})` —
                                 the only legal concise arrow returning an empty
                                 object — failed the same way.
  two catches in one statement   the prefix was sliced at the *last* `.catch`, so
                                 an action beside a probe inherited its
                                 exemption. Sliced at the current one now.
  an identical statement in a    a signature was only (file, statement). It now
  different shot                 carries the enclosing shot id — and a local
                                 `const`, of which the manifest has 473, no
                                 longer passes for one.
"""

from __future__ import annotations

import hashlib
import re
import unittest
from pathlib import Path

SCREENSHOTS = Path(__file__).resolve().parent / "screenshots"

# `\s*` because JavaScript allows whitespace, including a newline, between the
# property and its call parentheses: `.catch (() => null)` is the same code and
# these files are not run through the frontend's Prettier hook, so nothing
# normalizes the spelling for us.
CATCH = re.compile(r"\.catch\s*\(")

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

# An observation asks a question; an action changes something. Only the first can
# legitimately answer "no" by rejecting, which is what makes `() => false` a
# recovery there and a swallow anywhere else.
OBSERVATION = r"\.(?:isVisible|isChecked|isEnabled|isHidden|waitFor)\([^()]*\)"

# `.then(() => true)` is how the two real probe chains in `manifest.mjs` turn a
# `waitFor` into a boolean, so it has to be allowed — but only sitting on top of
# an observation. On its own it exempted `page.click().then(() => true)`, where
# the swallowed failure is a click that never happened.
PROBE = re.compile(OBSERVATION + r"(?:\s*\.then\(\s*\(\)\s*=>\s*true\s*\))?\s*\.?$")

# After a value a `/` is division; after an operator or at the start of an
# expression it opens a regex literal. Guessing wrong the other way is the
# dangerous direction — mistaking division for a regex blanks real code — so
# this lists the positions where a regex is certain and treats everything else
# as division.
REGEX_OPENERS = set("(,=:[!&|?{};+-*%~^<>")
REGEX_KEYWORD = re.compile(
    r"\b(?:return|typeof|case|in|of|delete|void|instanceof|new|do|else|yield"
    r"|await)$"
)


def _starts_regex(tail: str) -> bool:
    """True when the `/` about to be read opens a regex rather than divides.

    Looks at the preceding *token*, not just the preceding character. `n++ / x`
    ends in `+`, which is otherwise an operator and so would open a regex — and
    guessing that way round is the costly one: it blanks real code until the next
    `/`, which is a blind spot rather than a miss.
    """
    stripped = tail.rstrip()
    if not stripped:
        return True
    if stripped.endswith("++") or stripped.endswith("--"):
        return False  # a postfix or prefix update yields a value
    if stripped[-1] in REGEX_OPENERS:
        return True
    return REGEX_KEYWORD.search(stripped) is not None


def scan_source(text: str) -> tuple[str, str]:
    """One JavaScript-aware pass returning (code, mask), both as long as `text`.

    `code` blanks comment text. `mask` blanks the contents of comments, strings,
    template literals and regex literals too, keeping their delimiters. Both
    preserve every newline and every byte offset, so a position found in one view
    means the same position in the other and in the original file.

    Two views rather than one because they answer different questions. Structure
    is read off `mask`, where a `)` or a `/*` or the word `throw` can only be
    syntax — the six bypasses in this file's header were all a datum read as
    syntax. Statement text for a signature is read off `code`, because a
    signature naming `page.goto("")` instead of `page.goto("/login")` would
    collide across shots that differ only in the URL.

    Template literals carry state across lines (they are the one literal that
    legally spans them, and `${...}` returns to code, nested). An unterminated
    quote or regex at a newline returns to code rather than running on: that is a
    syntax error in the source, and a scanner that assumes it continues blanks
    real code after it.
    """
    code: list[str] = []
    mask: list[str] = []
    state = "code"
    frames: list[int] = []
    depth = 0
    in_class = False
    tail = ""
    i, n = 0, len(text)
    while i < n:
        char = text[i]
        pair = text[i : i + 2]

        if state == "code":
            if pair == "//":
                state = "line"
                code.append("  ")
                mask.append("  ")
                i += 2
                continue
            if pair == "/*":
                state = "block"
                code.append("  ")
                mask.append("  ")
                i += 2
                continue
            if char in ("'", '"'):
                state = "single" if char == "'" else "double"
                code.append(char)
                mask.append(char)
                i += 1
                continue
            if char == "`":
                state = "template"
                code.append(char)
                mask.append(char)
                i += 1
                continue
            if char == "/" and _starts_regex(tail):
                state = "regex"
                in_class = False
                code.append(char)
                mask.append(char)
                i += 1
                continue
            if char == "{":
                depth += 1
            elif char == "}":
                if frames and depth == 0:
                    depth = frames.pop()
                    state = "template"
                    code.append(char)
                    mask.append(char)
                    i += 1
                    continue
                depth -= 1
            code.append(char)
            mask.append(char)
            tail = (tail + char)[-32:]
            i += 1
            continue

        if state == "line":
            if char == "\n":
                state = "code"
                code.append("\n")
                mask.append("\n")
            else:
                code.append(" ")
                mask.append(" ")
            i += 1
            continue

        if state == "block":
            if pair == "*/":
                state = "code"
                code.append("  ")
                mask.append("  ")
                i += 2
                continue
            code.append("\n" if char == "\n" else " ")
            mask.append("\n" if char == "\n" else " ")
            i += 1
            continue

        if state in ("single", "double", "template", "regex"):
            if char == "\\" and i + 1 < n:
                # A backslash-newline continuation keeps the string open, so the
                # escape has to be consumed here rather than falling through to
                # the newline branch below — otherwise a `/*` on the continued
                # line is read as a comment opener and blanks the rest of the
                # file. The newline is still emitted, to keep both views aligned
                # with the original.
                if text[i + 1] == "\n":
                    code.append("\\\n")
                    mask.append(" \n")
                else:
                    code.append(text[i : i + 2])
                    mask.append("  ")
                i += 2
                continue
            if char == "\n":
                code.append("\n")
                mask.append("\n")
                if state != "template":
                    state = "code"
                i += 1
                continue
            if state == "template" and pair == "${":
                frames.append(depth)
                depth = 0
                state = "code"
                code.append("${")
                mask.append("${")
                tail = (tail + "${")[-32:]
                i += 2
                continue
            closed = (
                (state == "single" and char == "'")
                or (state == "double" and char == '"')
                or (state == "template" and char == "`")
                or (state == "regex" and char == "/" and not in_class)
            )
            if closed:
                state = "code"
                code.append(char)
                mask.append(char)
                tail = (tail + char)[-32:]
                i += 1
                continue
            if state == "regex" and char == "[":
                in_class = True
            elif state == "regex" and char == "]":
                in_class = False
            code.append(char)
            mask.append(" ")
            i += 1
            continue

        raise AssertionError(f"unreachable scanner state {state!r}")

    return "".join(code), "".join(mask)


def line_starts_for(text: str) -> list[int]:
    """Offset of each line's first character, for turning an offset into a line."""
    starts = [0]
    for i, char in enumerate(text):
        if char == "\n":
            starts.append(i + 1)
    return starts


def line_of(starts: list[int], offset: int) -> int:
    """The 0-based line containing `offset`."""
    low, high = 0, len(starts) - 1
    while low < high:
        mid = (low + high + 1) // 2
        if starts[mid] <= offset:
            low = mid
        else:
            high = mid - 1
    return low


def unwrap_parens(value: str) -> str:
    """Strip parentheses that only wrap the whole expression.

    `() => ({})` is the one legal way to write a concise arrow returning an empty
    object, and `() => (null)` is the same value as `() => null`. Comparing the
    raw right-hand side let both past.
    """
    text = value.strip()
    while text.startswith("(") and text.endswith(")"):
        depth = 0
        for i, char in enumerate(text):
            if char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
                if depth == 0 and i != len(text) - 1:
                    return text
        text = text[1:-1].strip()
    return text


def normalize_value(value: str) -> str:
    """Collapse a masked string literal to its empty form.

    In the masked view a literal's contents are spaces, so `"a fallback"` arrives
    as `"          "`. Returning a constant string on failure is the same swallow
    as returning `""` — the caller cannot tell it from a real read — so they are
    compared as one value.
    """
    text = re.sub(r"(['\"`])\s*\1", r"\1\1", value.strip()).strip()
    # `void 0` and `void(0)` evaluate to `undefined`, so they are the same
    # swallow as writing it out. Only the `0` form — `void doWork()` runs the
    # call, which is a recovery path and must stay unclassified.
    if re.fullmatch(r"void\s*\(?\s*0\s*\)?", text):
        return "undefined"
    return text


def is_false_fallback(argument: str) -> bool:
    """`() => false` exactly — the only fallback that keeps a probe a question."""
    return (
        re.fullmatch(r"(?:async\s+)?\(\s*\)\s*=>\s*false", argument.strip()) is not None
    )


# A shot's `id:`, or a top-level declaration. Deliberately NOT any `const`: the
# manifest has 473 indented ones, so a catch inside a shot was keyed to whichever
# local happened to sit above it (`card`, `text`, `button`) rather than to the
# shot. Two shots sharing a local name then shared a signature, which is the
# inheritance this is meant to prevent.
SHOT_ID = re.compile(r"""^(\s*)id:\s*["']([^"']+)["']""")
TOP_LEVEL_DECL = re.compile(
    r"^(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|(?:const|let|var)\s+(\w+))"
)


def shot_id_indent(lines: list[str]) -> int | None:
    """The indentation at which this file declares a shot id, or None.

    Self-calibrating rather than hardcoded to four spaces: the shallowest `id:`
    in the file is the shot list's own, and anything deeper is data inside a shot
    (`manifest.mjs` has exactly one, `id: "item-1"` at twelve spaces, which must
    not be mistaken for a shot).
    """
    indents = [len(m.group(1)) for m in (SHOT_ID.match(ln) for ln in lines) if m]
    return min(indents) if indents else None


# Statement starters, for walking back from a `.catch` to the head of its chain.
STATEMENT_START = re.compile(
    r"^\s*(await|return|const|let|var|if|\}|for|while)\b|^\s*\w+\("
)


def statement_start_line(lines: list[str], index: int) -> int:
    """The line the chain ending on `lines[index]` begins on."""
    for back in range(index, max(-1, index - 12), -1):
        if STATEMENT_START.match(lines[back]):
            return back
    return index


def statement_for(lines: list[str], index: int) -> str:
    """The chain the `.catch` on `lines[index]` terminates, whitespace-normalized.

    Hashed rather than line-numbered so an edit elsewhere in a 10,000-line
    manifest does not invalidate every frozen entry — only changing the
    statement itself does, which is exactly when it wants re-reading.
    """
    start = statement_start_line(lines, index)
    return re.sub(r"\s+", " ", " ".join(lines[start : index + 1])).strip()


def catch_argument(mask: str, open_paren: int) -> str:
    """The text inside `.catch(...)`, balanced on the masked view.

    Balanced to the matching parenthesis however far that is, on the masked view.
    The previous version balanced raw text inside a six-line window, which failed
    in two directions at once: a `)` inside a logged string ended the argument
    early, and a handler that logged for more than six lines before returning a
    constant was classified on a slice that stopped mid-statement. Neither
    reported anything — both just stopped seeing.
    """
    depth, i = 1, open_paren + 1
    while i < len(mask) and depth:
        if mask[i] == "(":
            depth += 1
        elif mask[i] == ")":
            depth -= 1
        i += 1
    return first_argument(mask[open_paren + 1 : i - 1])


# A handler that only writes the failure somewhere and falls through returns
# `undefined` implicitly, which is a swallow. A handler that does anything else
# without returning may be recovering, so it is left unclassified.
LOG_CALL = re.compile(
    r"^(?:await\s+)?(?:(?:console|logger|log)\s*\.\s*\w+"
    r"|log|warn|error|debug|info|trace)\s*\("
)


def split_at_depth(text: str, separator: str) -> tuple[str, str] | None:
    """Split at the first `separator` that is not inside brackets."""
    depth = 0
    i = 0
    while i < len(text):
        char = text[i]
        if char in "([{":
            depth += 1
        elif char in ")]}":
            depth -= 1
        elif depth == 0 and text.startswith(separator, i):
            return text[:i], text[i + len(separator) :]
        i += 1
    return None


def first_argument(text: str) -> str:
    """The first argument of a call, from the text between its parentheses.

    JavaScript allows a trailing comma after the last argument, and Prettier
    writes one whenever it breaks a call across lines. Without this,
    `.catch(() => null,)` yields `() => null,` and the comma alone made the
    fallback match nothing.
    """
    split = split_at_depth(text, ",")
    return split[0] if split else text


def split_arrow(argument: str) -> tuple[str, str] | None:
    """(parameters, body) split at the arrow, or None if this is not an arrow.

    The parameter list is balanced rather than matched against a character class.
    `({ message }) => null` and `(error = undefined) => null` are ordinary
    handlers whose parameters contain braces and an `=`, and restricting them
    to word characters, whitespace and commas rejected both before their
    fallback was ever examined.
    """
    body = argument.strip()
    body = re.sub(r"^async\s+", "", body)
    split = split_at_depth(body, "=>")
    if not split:
        return None
    params, rest = split[0].strip(), split[1].strip()
    if params.startswith("(") and params.endswith(")"):
        return params, rest
    if re.fullmatch(r"\w*", params):
        return params, rest
    return None


def returned_expression(block: str) -> str | None:
    """What a block hands back, or None if it returns nothing.

    The expression is balanced to its terminating `;`. Excluding `}` instead —
    which is what this did — meant `return {};` stopped at the object's own brace
    and matched nothing, so the block spelling of a listed swallow value was
    invisible.
    """
    depth = 0
    found: int | None = None
    for match in re.finditer(r"\breturn\b|[([{)\]}]", block):
        token = match.group(0)
        if token in "([{":
            depth += 1
        elif token in ")]}":
            depth -= 1
        elif depth == 0:
            found = match.end()
    if found is None:
        return None
    rest = block[found:]
    split = split_at_depth(rest, ";")
    return (split[0] if split else rest).strip()


def is_log_only(block: str) -> bool:
    """True when every statement in the block merely records the failure."""
    statements = []
    rest = block
    while True:
        split = split_at_depth(rest, ";")
        if not split:
            statements.append(rest)
            break
        statements.append(split[0])
        rest = split[1]
    live = [s.strip() for s in statements if s.strip()]
    return bool(live) and all(LOG_CALL.match(s) for s in live)


def is_swallow(argument: str) -> bool:
    """True when the handler discards the failure and yields a bare value.

    Fails closed on the arrow forms and open on everything else: a handler that
    is not a simple arrow (a named function, a `.catch(handleIt)`) is left to
    review rather than guessed at, and one whose body does real work — throws,
    calls something, assigns — is a recovery path.
    """
    arrow = split_arrow(argument)
    if not arrow:
        return False
    rhs = unwrap_parens(arrow[1])
    if rhs.startswith("{"):
        inner = (rhs[1:-1] if rhs.endswith("}") else rhs[1:]).strip()
        if not inner:
            return True  # `() => {}`
        # `\bthrow\b` on the masked body, so a `warn("throw failed")` inside it
        # cannot pass for a rethrow and exempt the swallow underneath.
        if re.search(r"\bthrow\b", inner):
            return False  # re-raises: the failure still reaches the caller
        returned = returned_expression(inner)
        if returned is None:
            # No `return` means an implicit `undefined`. That is a swallow when
            # the block only logs, and unclassified otherwise — `async () => {
            # await fallback(); }` reaches no return either and is a recovery
            # path, so this cannot key on the missing return alone.
            return is_log_only(inner)
        # Any block that ends by handing back a bare value is a swallow, even if
        # it logs on the way. Logging is not reporting: the caller still receives
        # a value indistinguishable from success, which is the whole defect.
        return normalize_value(unwrap_parens(returned)) in SWALLOW_VALUES
    return normalize_value(rhs.rstrip(";")) in SWALLOW_VALUES


def context_for(lines: list[str], index: int, shot_indent: int | None) -> str:
    """The nearest enclosing shot id or top-level declaration above `index`.

    Without this a signature is (file, statement), so deleting a frozen catch
    and adding the identical statement to a different shot in the same file
    keeps the signature and silently inherits the exemption — and the manifest
    has four statements that already appear twice, which is exactly where that
    would happen.
    """
    for back in range(index, -1, -1):
        shot = SHOT_ID.match(lines[back])
        if shot and shot_indent is not None and len(shot.group(1)) == shot_indent:
            return shot.group(2)
        decl = TOP_LEVEL_DECL.match(lines[back])
        if decl:
            return next(g for g in decl.groups() if g)
    return "?"


def signature(name: str, context: str, statement: str, occurrence: int = 1) -> str:
    digest = hashlib.sha1(f"{context}|{statement}".encode()).hexdigest()[:12]
    suffix = f"#{occurrence}" if occurrence > 1 else ""
    return f"{name}:{context}:{digest}{suffix}"


def sites_in(name: str, text: str) -> list[tuple[str, int, str, str]]:
    """Every `.catch` in one module that replaces a failure with a plausible value.

    Split out from `swallowing_sites` so the bypass tests below can drive the real
    path — scanner, balancer, classifier, probe exemption and signature together —
    on a synthetic module. Testing the pieces in isolation is what let the
    compound-statement and whitespace bypasses through: each part was right on its
    own and the composition was not.
    """
    found: list[tuple[str, int, str, str]] = []
    code, mask = scan_source(text)
    code_lines = code.split("\n")
    starts = line_starts_for(mask)
    shot_indent = shot_id_indent(code_lines)
    seen: dict[str, int] = {}
    for match in CATCH.finditer(mask):
        argument = catch_argument(mask, match.end() - 1)
        if not is_swallow(argument):
            continue
        index = line_of(starts, match.start())
        # The prefix runs from the head of the chain to THIS catch. Sliced at the
        # last `.catch` in the statement, an action beside a probe —
        # `await act().catch(() => false) || seen.isVisible().catch(...)` — was
        # handed the probe's prefix and exempted. Read off the mask so a
        # `.isVisible()` quoted in a string cannot fake one.
        start = starts[statement_start_line(code_lines, index)]
        prefix = re.sub(r"\s+", " ", mask[start : match.start()])
        if PROBE.search(prefix) and is_false_fallback(argument):
            continue
        statement = statement_for(code_lines, index)
        context = context_for(code_lines, index, shot_indent)
        key = f"{context}|{statement}"
        seen[key] = seen.get(key, 0) + 1
        found.append(
            (name, index + 1, statement, signature(name, context, statement, seen[key]))
        )
    return found


def swallowing_sites() -> list[tuple[str, int, str, str]]:
    """Every swallowing `.catch` across `scripts/screenshots/`."""
    found: list[tuple[str, int, str, str]] = []
    for path in sorted(SCREENSHOTS.glob("*.mjs")):
        found.extend(sites_in(path.name, path.read_text()))
    return found


# Swallowing sites as of 2026-09-10, after the three in `capture.mjs`'s detector
# layer were removed. Each manifest entry is a per-shot `prepare` step: the blast
# radius is one image rather than every check in the run, which is why they are
# frozen here instead of changed blind. Roughly a dozen of them look like genuine
# instances of the #2433 defect — a framing scroll or a state-setting click whose
# failure the shot's own caption depends on — but deciding that per shot needs the
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
    "capture.mjs:main:26e6327a849d",  # :538 framing
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
    "manifest.mjs:clickByName:02fb03831282",  # :131 framing
    "manifest.mjs:expandFirstReportCard:1e9e24c76476",  # :209 framing
    "manifest.mjs:clickSettingsSection:6ad163beb4ac",  # :234 framing
    "manifest.mjs:selectClaimableBoardDay:04e6bbb08456",  # :1158 read
    "manifest.mjs:selectClaimableBoardDay:0ee2b3dfa473",  # :1160 action
    "manifest.mjs:selectClaimableBoardDay:04e6bbb08456#2",  # :1168 read
    "manifest.mjs:selectClaimableBoardDay:0ee2b3dfa473#2",  # :1170 action
    "manifest.mjs:openStandingShiftDialog:9e2edc12cb65",  # :1300 action
    "manifest.mjs:03-53-template-position-required:26cc5879bf8d",  # :2535 action
    "manifest.mjs:03-53-template-position-required:b1eec9bd1366",  # :2580 framing
    "manifest.mjs:05-62-generate-variants:79e008176e18",  # :2662 action
    "manifest.mjs:05-62-generate-variants:c78ee68ad6a7",  # :2669 action
    "manifest.mjs:02-84-record-category-field:00d5412fc2da",  # :3022 framing
    "manifest.mjs:02-79-training-attachments:fe1b0586b040",  # :3065 action
    "manifest.mjs:02-79-training-attachments:3822b30dc79e",  # :3068 framing
    "manifest.mjs:02-96-bulk-enroll-picker:79cba5a0f412",  # :3337 action
    "manifest.mjs:02-97-manual-entry-apparatus:ef291d7a4413",  # :3598 action
    "manifest.mjs:02-97-manual-entry-apparatus:df14e0332d9a",  # :3610 action
    "manifest.mjs:05-59-impact-planner-results:8d062bf3a840",  # :3860 framing
    "manifest.mjs:08-60-dashboard-notification-cards:8b93abd14c2f",  # :3904 framing
    "manifest.mjs:03-49-report-card-names:af27e4619669",  # :4014 framing
    "manifest.mjs:00-19-change-password:33a5b3b98233",  # :4087 action
    "manifest.mjs:00-15-sidebar-member:48dc35beca5f",  # :4148 action
    "manifest.mjs:00-16-sidebar-admin:00d4a3e50d9a",  # :4172 action
    "manifest.mjs:00-16-sidebar-admin:311c65b0f5be",  # :4180 framing
    "manifest.mjs:05-58-return-items-modal:c256153f3960",  # :4289 action
    "manifest.mjs:15-14-applicant-drawer-overview:e6fe70147a39",  # :4309 framing
    "manifest.mjs:01-27-stage-type-picker:cb127cccb47d",  # :4996 framing
    "manifest.mjs:01-28-stage-email-config:5344053f36ec",  # :5043 framing
    "manifest.mjs:08-56-template-discard:f63637715a8d",  # :5759 framing
    "manifest.mjs:08-58-template-send-test:e8a025c27831",  # :5797 framing
    "manifest.mjs:08-65-template-footer-selector:ab955e36080d",  # :5950 framing
    "manifest.mjs:08-67-email-preview-design:12fc434515ee",  # :5994 framing
    "manifest.mjs:03-37-settings-rating-scale:c07e519d612b",  # :7651 toast
    "manifest.mjs:04-34-guest-prospect-card:74227377751c",  # :7854 framing
    "manifest.mjs:02-30-shift-reports:26793f8cac6f",  # :8289 action
    "manifest.mjs:01-08-member-audit-history:c3b00dcab664",  # :9354 action
    "manifest.mjs:14-24-ballot-send-skipped:69301d678074",  # :10060 toast
    "manifest.mjs:09-12-template-linked-requirement:4b1110d66d66",  # :10789 read
}


def caught(source: str) -> list[int]:
    """Line numbers the gate reports for a synthetic module."""
    return [line for _, line, _, _ in sites_in("t.mjs", source)]


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

    def test_a_parenthesized_value_is_still_a_bare_value(self):
        """`() => ({})` is the only legal concise arrow returning an empty object.

        Its right-hand side is `({})`, which matched no entry in the value set, so
        the one spelling a developer would actually reach for was the one the gate
        could not see. `() => (null)` failed the same way.
        """
        assert is_swallow("() => ({})")
        assert is_swallow("() => (null)")
        assert is_swallow("() => ((false))")
        assert caught("await thing().catch(() => ({}));") == [1]
        # Unwrapping must not flatten an expression that does work.
        assert not is_swallow("() => (a || b)")
        assert not is_swallow("() => (await retry())")

    def test_a_constant_string_fallback_is_a_swallow(self):
        """Returning fixed prose on failure is `""` with extra steps.

        The caller cannot tell `"unknown"` from a real read, which is the whole
        defect; in the masked view both arrive as an empty literal.
        """
        assert caught('await read().catch(() => "unknown");') == [1]
        assert caught("await read().catch(() => '');") == [1]

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
        """The chain up to the catch has to END with the probe."""
        assert not caught("if (await pause.isVisible().catch(() => false)) {")
        assert not caught(
            "\n".join(
                [
                    "        const shown = await url",
                    '          .waitFor({ state: "visible", timeout: 2_000 })',
                    "          .then(() => true)",
                    "          .catch(() => false);",
                ]
            )
        )
        # A compound statement that merely mentions a probe is not exempt.
        assert caught(
            "await thing.isVisible(); await other.click().catch(() => {});"
        ) == [1]

    def test_then_true_alone_does_not_make_a_probe(self):
        """`page.click().then(() => true)` is an action wearing a probe's clothes.

        Matching any promise mapped to `true` exempted every action that bothered
        to report whether it worked — a swallowed click is exactly the #2433
        defect, and this spelling made it invisible.
        """
        assert caught("await page.click().then(() => true).catch(() => false);") == [1]
        assert not caught(
            "await x.waitFor({ timeout: 10 }).then(() => true).catch(() => false);"
        )

    def test_the_current_catch_owns_its_prefix(self):
        """Two catches in one statement: each is judged on its own chain.

        The prefix was sliced at the statement's LAST `.catch`, so the action on
        the left was handed the probe's prefix on the right and exempted.
        """
        compound = (
            "const ok = await action.catch(() => false) || "
            "pause.isVisible().catch(() => false);"
        )
        assert caught(compound) == [1], "the action's catch must still be reported"

    def test_a_signature_is_bound_to_its_site(self):
        """Identical statements in different shots must not share an exemption."""
        statement = (
            "await card.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(() => {});"
        )
        first = signature("manifest.mjs", "04-34-applicant-drawer", statement)
        second = signature("manifest.mjs", "19-07-prospect-detail", statement)
        assert first != second, "same statement in two shots must differ"
        assert signature("manifest.mjs", "x", statement, 2).endswith("#2")

    def test_a_signature_names_the_shot_not_a_local_const(self):
        """A local `const` above the catch is not the site.

        With every `const` eligible, a catch inside a shot was keyed to whichever
        local sat above it. The manifest has 473 indented ones and only 4 spaces
        of indent separate them from a shot id, so two shots that each declared
        `const card` shared a signature — and moving a frozen statement from one
        to the other inherited its exemption, which is the hole the context was
        added to close.
        """
        source = "\n".join(
            [
                "export const SHOTS = [",
                "  {",
                '    id: "04-34-guest-prospect-card",',
                "    async prepare(page) {",
                '      const card = page.getByText("x");',
                "      await card.scrollIntoViewIfNeeded().catch(() => {});",
                "    },",
                "  },",
                "];",
            ]
        )
        sites = sites_in("manifest.mjs", source)
        assert len(sites) == 1, sites
        assert ":04-34-guest-prospect-card:" in sites[0][3], sites[0][3]
        assert ":card:" not in sites[0][3], sites[0][3]

    def test_nested_data_ids_are_not_mistaken_for_shots(self):
        """`id: "item-1"` inside a shot's data is deeper than the shot list's own."""
        source = "\n".join(
            [
                "export const SHOTS = [",
                "  {",
                '    id: "05-02-inventory",',
                "    async prepare(page) {",
                "      const rows = [",
                '        { id: "item-1", qty: 2 },',
                "      ];",
                "      await rows.at(0).show().catch(() => {});",
                "    },",
                "  },",
                "];",
            ]
        )
        sites = sites_in("manifest.mjs", source)
        assert len(sites) == 1, sites
        assert ":05-02-inventory:" in sites[0][3], sites[0][3]

    # --- the scanner must not confuse data for syntax ---

    def test_comments_are_not_scanned_as_code(self):
        """This file and `capture.mjs` both quote the banned pattern in prose."""
        code, _ = scan_source(
            "\n".join(
                [
                    "// a comment mentioning .catch(() => {}) in prose",
                    "/* a block comment with .catch(() => '') inside */",
                    "const real = thing().catch(() => {});",
                ]
            )
        )
        lines = code.split("\n")
        assert ".catch(" not in lines[0], lines[0]
        assert ".catch(" not in lines[1], lines[1]
        assert ".catch(() => {})" in lines[2], lines[2]
        assert len(lines) == 3, "line numbering must survive stripping"

    def test_a_string_is_not_read_as_a_comment(self):
        """Both real cases: a `//` in a URL and a `/*` in a route glob."""
        assert caught('await page.goto("http://localhost:3000").catch(() => {});') == [
            1
        ]
        glob = 'await context.route("**/api/v1/**", handler);'
        code, _ = scan_source(glob)
        assert code.rstrip().endswith(";"), "glob truncated"
        assert caught(f"{glob}\nconst x = y().catch(() => {{}});") == [2]

    def test_a_template_literal_carries_state_across_lines(self):
        """A `/*` on a template's second line opened a comment that ran to EOF.

        Quote state used to reset per line, so the glob inside this template was
        read as code and its `/*` blanked everything after it — two swallows in
        the window, neither reported, the gate green.
        """
        source = "\n".join(
            [
                "const query = `first line",
                "  second line **/api/v1/** tail`;",
                "await one().catch(() => null);",
                "await two().catch(() => null);",
            ]
        )
        assert caught(source) == [3, 4]

    def test_a_paren_inside_a_string_does_not_end_the_argument(self):
        """Balancing over raw text stopped at the `)` in the logged message."""
        source = 'await x.catch(() => { log(")"); return null; });'
        assert caught(source) == [1]

    def test_a_catch_quoted_in_a_string_is_not_code(self):
        """The masked view also removes false positives, not just blind spots."""
        assert not caught('const help = "write .catch(() => null) and it fails";')

    def test_whitespace_before_the_call_parens_still_matches(self):
        """`.catch (…)` and `.catch\\n(…)` are the same code.

        These files are not run through the frontend's Prettier hook, so nothing
        normalizes the spelling and the gate cannot require one.
        """
        assert caught("await x.catch (() => null);") == [1]
        assert caught("await x.catch\n  (() => null);") == [1]

    def test_a_handler_longer_than_the_old_window_is_classified(self):
        """A six-line read window truncated the handler before its `return`."""
        source = "\n".join(
            [
                "await x.catch(() => {",
                "  a();",
                "  b();",
                "  c();",
                "  d();",
                "  e();",
                "  f();",
                "  return null;",
                "});",
            ]
        )
        assert caught(source) == [1]

    def test_the_word_throw_in_a_string_is_not_a_rethrow(self):
        """A diagnostic message must not exempt the swallow underneath it."""
        source = 'await x.catch(() => { warn("throw failed"); return null; });'
        assert caught(source) == [1]
        assert not caught("await x.catch((e) => { throw new Error(e); });")

    def test_a_regex_literal_does_not_open_a_string(self):
        """Real regexes here hold escaped slashes, braces and a `;`.

        Untracked, a `/` is just a character — harmless until a regex holds a
        quote or a `//`, at which point the scanner opens a literal or a comment
        over real code.
        """
        source = "\n".join(
            [
                'const key = path.replace(/^\\/api\\/v1/, "").replace(/\\/$/, "");',
                "const csrf = document.cookie.match(/(?:^|;\\s*)t=([^;]*)/);",
                "await one().catch(() => null);",
            ]
        )
        assert caught(source) == [3]

    def test_division_is_not_read_as_a_regex(self):
        """Blanking real code as a regex body would be a blind spot, not a miss."""
        source = "\n".join(
            [
                "const half = total / count;",
                "await one().catch(() => null);",
            ]
        )
        assert caught(source) == [2]

    def test_a_postfix_update_is_not_a_regex_opener(self):
        """`n++ / x` divides. Reading it as a regex blanks code until the next `/`.

        This is the costly direction of the regex guess: a missed swallow is a
        miss, but code blanked as regex contents is a blind spot — every catch in
        the window disappears and the gate still reports clean.
        """
        source = "\n".join(
            [
                "let n = 0;",
                "const r = n++ / action.catch(() => null) / total;",
            ]
        )
        assert caught(source) == [2]
        assert not _starts_regex("n++")
        assert not _starts_regex("i--")
        assert _starts_regex("const x = ")
        assert not _starts_regex("total")

    def test_a_backslash_newline_keeps_a_string_open(self):
        """A line continuation is still inside the string.

        Resetting to code at that newline let the continued line's `/*` open a
        block comment, which blanked every catch after it — the same EOF blind
        spot the template-literal fix closed, reached through a different escape.
        """
        source = "\n".join(
            [
                'const s = "start\\',
                '  **/api/v1/** tail";',
                "await one().catch(() => null);",
                "await two().catch(() => null);",
            ]
        )
        assert caught(source) == [3, 4]

    def test_destructured_and_defaulted_parameters_are_parsed(self):
        """A parameter list is balanced, not matched against a character class.

        `({ message }) => null` is an ordinary handler; a class of `[\\w\\s,]`
        rejected it before its fallback was ever looked at.
        """
        assert is_swallow("({ message }) => null")
        assert is_swallow("(error = undefined) => null")
        assert is_swallow("([first]) => null")
        assert caught("await x.catch(({ message }) => null);") == [1]
        # Not an arrow at all: still left to review rather than guessed at.
        assert not is_swallow("handleIt")
        assert not is_swallow("thing.handle")

    def test_void_zero_is_undefined(self):
        """`void 0` yields `undefined`, so it is the same swallow."""
        assert is_swallow("() => void 0")
        assert is_swallow("() => void(0)")
        assert caught("await x.catch(() => void 0);") == [1]
        # `void doWork()` runs the call — a recovery path, left unclassified.
        assert not is_swallow("() => void doWork()")

    def test_a_block_returning_an_object_literal_is_caught(self):
        """`return {};` — the returned expression is balanced, not brace-excluded.

        Excluding `}` meant the expression stopped at the object's own brace, so
        the block spelling of a value already in SWALLOW_VALUES was invisible.
        """
        assert is_swallow("() => { return {}; }")
        assert is_swallow("() => { log(e); return {}; }")
        assert is_swallow("() => { return ({}); }")
        assert caught("await x.catch(() => { return {}; });") == [1]

    def test_a_log_only_block_is_a_swallow(self):
        """No `return` is an implicit `undefined`, and logging is not reporting.

        It cannot key on the missing return alone: `async () => { await
        fallback(); }` also reaches no return and is a recovery path. The
        distinction is whether the block does anything but record the failure.
        """
        assert is_swallow("(e) => { console.warn(e); }")
        assert is_swallow("(e) => { logger.error(e); }")
        assert caught("await x.catch((e) => { console.warn(e); });") == [1]
        assert not is_swallow("async () => { await fallback(); }")
        assert not is_swallow("(e) => { process.exit(1); }")

    def test_a_trailing_comma_after_the_handler_is_ignored(self):
        """JavaScript allows it, and Prettier writes one when it breaks a call."""
        assert caught("await x.catch(() => null,);") == [1]
        assert caught("await x.catch(\n  () => null,\n);") == [1]
        # A second argument must not be read as part of the first.
        assert first_argument("() => null, other") == "() => null"
        assert first_argument("(a, b) => null") == "(a, b) => null"

    def test_the_sweep_detects_a_reintroduced_swallow(self):
        """The shape removed from `pageText`, driven through the real path."""
        source = "\n".join(
            [
                "async function pageText(page) {",
                '  return page.locator("main, body").first().innerText()',
                '    .catch(() => "");',
                "}",
            ]
        )
        sites = sites_in("capture.mjs", source)
        assert len(sites) == 1, sites
        assert ":pageText:" in sites[0][3], sites[0][3]
        assert sites[0][3] not in FROZEN


if __name__ == "__main__":
    unittest.main()
