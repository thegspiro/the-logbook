"""A shot the harness rejects must not replace the image already in the guide.

`capture.mjs` checks each capture after taking it: the subject is in frame, the
page is not an error page, the app did not crash, the screen is not an empty
state. Every one of those checks needs the page as it was photographed, so the
image exists before the verdict does.

It used to be written straight to `docs/training/images/<id>.png`. A shot that
then failed a check reported `!` and left the rejected frame where the
committed image had been, and an empty state reported `~` and did the same. On
the run that found this, 52 committed images were replaced that way, and
nothing but a `git diff` showed it: the report listed them as failed or held
back, which reads as "nothing written".

So the capture goes to `<id>.capturing.png` and is moved over the image only
after every check has passed. This test reads the shot loop and holds that
order. It is a source check rather than a run because the harness needs the
whole application up to execute.
"""

from __future__ import annotations

import re
from pathlib import Path

CAPTURE = Path(__file__).resolve().parent / "screenshots" / "capture.mjs"

# The checks a capture has to pass before it may replace an image.
CHECKS = (
    "detectSubjectOutOfFrame(",
    "detectEmptyState(",
    "detectCrash(",
    "detectPageError(",
)


def _source() -> str:
    return CAPTURE.read_text(encoding="utf-8")


def test_screenshots_are_taken_into_the_pending_file() -> None:
    paths = re.findall(r"screenshot\(\{\s*path:\s*(\w+)", _source())
    assert paths, "no screenshot call found in capture.mjs"
    assert set(paths) == {"pending"}, (
        "a screenshot is written somewhere other than the pending file, "
        "so a rejected capture can replace the committed image"
    )


def test_the_image_is_replaced_only_after_every_check() -> None:
    source = _source()
    move = source.find("await rename(pending, target)")
    assert move != -1, "the pending capture is never moved into place"
    for check in CHECKS:
        at = source.find(check, source.find("const pending"))
        assert at != -1, f"{check} is not called in the shot loop"
        assert at < move, (
            f"{check} runs after the image is replaced, so its rejection "
            "comes too late to keep the committed image"
        )


def test_a_failed_shot_discards_its_pending_capture() -> None:
    source = _source()
    catch = source.find("} catch (error) {", source.find("const pending"))
    assert catch != -1
    assert (
        "await rm(pending, { force: true });" in source[catch : catch + 200]
    ), "a failed shot leaves its rejected capture beside the image"


def test_an_empty_state_keeps_an_existing_image() -> None:
    assert re.search(
        r"const keptExisting = Boolean\(emptyState\) && existsSync\(target\);",
        _source(),
    )
