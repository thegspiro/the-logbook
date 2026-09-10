"""Every new screenshot must assert it landed on the screen it names.

A capture that navigates, renders *something* and writes a PNG reports success.
Nothing in that sequence checks the picture is of the screen the shot claims,
and three images shipped wrong before this test existed:

    #2320  a stale bundle — the browser held JS from before the change
    #2341  a dead route — /scheduling?tab=equipment-checks renders the Schedule
           tab, and the shot had no prepare step, so it photographed whatever
           loaded and was captioned "Equipment checks tab"
    #2449  03-69 satisfied its own wait, because the catalog matches were in the
           DOM, and framed them off the bottom of a 390px page

The URL cannot catch the second one. Measured against this build,
``/scheduling?tab=totally-bogus`` keeps the bogus parameter in the address bar
and renders the schedule underneath it, so a route comparison passes while the
picture is wrong. Only page content distinguishes them, which is what
``expect`` declares and ``capture.mjs`` enforces at capture time.

This test is the other half: it stops the *next* shot from being added with no
assertion at all. The baseline freezes the shots that predate the rule, so the
list can only shrink.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MANIFEST = REPO_ROOT / "scripts" / "screenshots" / "manifest.mjs"
BASELINE = REPO_ROOT / "scripts" / "screenshots" / "landing_assertion_baseline.txt"


def _load_shots() -> list[dict]:
    """Read the manifest by importing it, not by matching text against it.

    The manifest imports nothing, so node can evaluate it standalone. Parsing
    it with a regex instead reports objects that are not shots at all — a
    nested ``id:`` inside a fixture reads as one — and a guard that miscounts
    its own subject is worse than no guard.
    """
    node = shutil.which("node")
    if node is None:  # pragma: no cover - CI images all ship node
        raise unittest.SkipTest("node is required to read the screenshot manifest")
    script = (
        f"import {{ SHOTS }} from {json.dumps(str(MANIFEST))};"
        "console.log(JSON.stringify(SHOTS.map((s) => ({"
        "  id: s.id,"
        "  hasExpect: s.expect !== undefined,"
        "  capturedElsewhere: Boolean(s.capturedElsewhere),"
        "}))));"
    )
    proc = subprocess.run(
        [node, "--input-type=module", "-e", script],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
        check=True,
    )
    return json.loads(proc.stdout)


def _load_baseline() -> list[str]:
    lines = BASELINE.read_text(encoding="utf-8").splitlines()
    return [ln.strip() for ln in lines if ln.strip() and not ln.startswith("#")]


class ScreenshotLandingAssertionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.shots = _load_shots()
        self.baseline = _load_baseline()

    def test_baseline_has_no_duplicates(self) -> None:
        dupes = sorted({e for e in self.baseline if self.baseline.count(e) > 1})
        assert not dupes, f"the baseline lists these shots twice: {dupes}"

    def test_every_new_shot_asserts_where_it_landed(self) -> None:
        """A shot added since the freeze must declare `expect`."""
        exempt = set(self.baseline)
        missing = sorted(
            shot["id"]
            for shot in self.shots
            if not shot["hasExpect"]
            and not shot["capturedElsewhere"]
            and shot["id"] not in exempt
        )
        assert not missing, (
            "These shots have no `expect`, so nothing checks they landed on the "
            "screen they name — a capture of the wrong screen would report "
            "success:\n  "
            + "\n  ".join(missing)
            + "\n\nAdd `expect: \"<text on that screen>\"` (or "
            "`expect: { selector: … }`) to each. It is asserted visible AND "
            "inside the captured frame, so it catches both a wrong screen and "
            "a subject framed out of shot."
        )

    def test_baseline_has_no_stale_entries(self) -> None:
        """Leaving the list means deleting the line, so the list shrinks."""
        by_id = {shot["id"]: shot for shot in self.shots}
        gone = sorted(sid for sid in self.baseline if sid not in by_id)
        now_asserted = sorted(
            sid for sid in self.baseline if sid in by_id and by_id[sid]["hasExpect"]
        )
        problems = []
        if gone:
            problems.append(
                "These ids are in the baseline but no longer in the manifest:\n  "
                + "\n  ".join(gone)
            )
        if now_asserted:
            problems.append(
                "These shots now declare `expect` — delete their baseline "
                "lines so the exemption list keeps shrinking:\n  "
                + "\n  ".join(now_asserted)
            )
        assert not problems, "\n\n".join(problems)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
