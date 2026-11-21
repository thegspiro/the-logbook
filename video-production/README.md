# Video Production

Turns the YouTube scripts in [`docs/youtube-scripts/`](../docs/youtube-scripts/)
into finished videos: the real app recorded on a phone-sized screen, a synthetic
voiceover, burned-in captions, branding and an end card, rendered as a 9:16
Short and a 16:9 video.

## Not part of the application

Nothing here is installed, built or run by The Logbook. It is kept apart in
three ways:

| Route by which the repository reaches someone          | What happens to this folder                                          |
| ------------------------------------------------------ | -------------------------------------------------------------------- |
| Docker image builds (all compose files, `docker-bake`) | Excluded by the root `.dockerignore`; never in an image              |
| GitHub release / branch tarballs, `git archive`        | Excluded by `export-ignore` in `.gitattributes`                      |
| `git clone`, `git pull`, `unraid/update.sh`            | **Downloaded**, about 40 KB of source. Git has no per-folder opt-out |

So an update by `git pull` puts these files on disk but never builds or runs
them. Everything this tool generates (renders, frames, narration, the Python
environment and the 110 MB voice model) goes under `build/`, which is
gitignored and created only on a machine that runs the tool.

## Requirements

- The repository's Node dependencies (`npm install` at the root). The capture
  reuses the E2E suite's mocked API (`frontend/src/e2e/helpers.ts`), so no
  backend or database is needed.
- A Chromium that the root Playwright can drive: either `npx playwright install
chromium`, or point `PLAYWRIGHT_CHROMIUM_PATH` at an existing one.
- Python 3.12 or newer (the pinned numpy needs it), `ffmpeg` built with `libx264`, `curl`, and `sha256sum`
  or `shasum`.
- The Inter font installed for the overlays (falls back to DejaVu Sans).

Python packages are installed into `build/.venv` on first run, from
[`requirements.txt`](./requirements.txt). They are not backend dependencies.

## Making a short

```bash
video-production/make-short.sh 8a-rsvp
```

Every narrated line is checked as it is made: it is transcribed by a small
speech model (downloaded on first use) and re-taken, up to six times, until
the transcript matches the script. The run prints each line's score and what
was heard, and warns about any line with no clear take. Add `--check` to also
transcribe the finished vertical render, which shows when each line lands.

The frontend dev server is started automatically if nothing is listening on
port 3000. Output:

```
video-production/build/8a-rsvp/render/8a-rsvp-vertical.mp4    1080x1920
video-production/build/8a-rsvp/render/8a-rsvp-horizontal.mp4  1920x1080
video-production/build/8a-rsvp/stills/                         one PNG per shot
```

A run takes about two minutes, most of it compositing.

## Adding a short

Create `shorts/<id>/` (lowercase letters, digits and hyphens) with two files.

**`shots.json`**: the title, the closing callout, the end card, and one entry
per shot with what the voice says and the caption shown while it does. Copy
[`shorts/8a-rsvp/shots.json`](./shorts/8a-rsvp/shots.json). Narration should
describe what is on screen, using the app's own labels. Where the script's
wording no longer matches the UI, follow the UI and update the script.

**Phone for shorts, tablet for the full videos.** A short is recorded on a
390×640 phone screen, the default. The full-length videos, and a short whose
screen the app does not offer on a phone, are recorded on a portrait tablet:
name the size in `shots.json` (`"screen": { "width": 820, "height": 1180 }`)
and set the same viewport in the capture's `test.use`. The frame around the
recording is sized to fit. 8E is the one tablet short so far, because the
election page sends setup to "a tablet or computer".

**`capture.spec.ts`**: signs in with the E2E fixtures, mocks whatever data the
short needs that the fixtures do not serve, and performs the shots:

```ts
await recordShots(page, "<id>", async (shot) => {
  await shot("hook", async () => {
    /* first screen */
  });
  await shot("events", async () => {
    await tap(
      page,
      await bottomMost(
        page.getByRole("button", { name: "Events", exact: true }),
      ),
    );
    await settle(page);
  });
});
```

Each `shot` id must match `shots.json`. A shot is held until its narration has
finished, so actions can be quick. `tap` shows a touch marker and scrolls its
target clear of the header and tab bar first; `bottomMost` picks the phone's
tab-bar copy of a control the layout renders twice; `centre` smooth-scrolls
something into view; `choose` picks an option in a native dropdown, whose own
popup a recording never shows.

**Never show a scannable QR code.** The app's codes encode live links, and a
viewer can scan one straight off the video. `prepare()` hides every QR code
from its first paint (anything in a `.qr-container`, and any qrcode.react SVG
wherever it sits), and a shot that shows one calls `decoyQr` on the code's
parent element to swap in a pattern that looks like a code and decodes to
nothing, as 8D and 8G do. A setup key or link printed beside the code should
be invalid as well: 8G's is not base32, so no authenticator accepts it. For
8D and 8G, two decoders (OpenCV and zbar) read a real code of the same size
and found nothing in any frame sampled while the decoy was on screen.

Two things that cost time on 8B:

- **Scope a locator to where the viewer is looking.** The closed navigation
  drawer keeps its items in the page, slid off-screen, and Playwright counts
  them as visible. "Submit Training" matched the drawer's copy before the
  page's button; `page.getByRole('main')` (or the drawer's own
  `getByRole('navigation', { name: 'Side navigation' })`) picks the right one.
  The drawer's items are buttons, not links.
- **`tap` refuses a target something else would receive** (an off-screen copy,
  an item behind an overlay) rather than pressing the wrong thing, and scrolls
  an item below the fold of a nested scroll area such as the drawer.

Write narration for the ear. The voice slurs some pairings whatever the take:
"Tap Submit" reliably became "tax submit", so 8B says "Tap the Submit Training
button". If a line warns, reword it.

A word the voice cannot say at all, in any wording, gets a respelling. Put the
line as it should be heard in `say`, which captions nothing but is what the
check scores against, and the respelt line in `speak`, which is what the voice
reads. "Schedule" is the one so far: across five takes each, "Schedule" was
heard right once and "Sked-yool" four times, so 8H's line speaks the second.

To see what a capture sends while it runs, set `VIDEO_DEBUG=1`: the 8E
capture logs each request that changes something and each console error.

## How it works

| Stage       | File                                                 | Produces                                              |
| ----------- | ---------------------------------------------------- | ----------------------------------------------------- |
| Narration   | `lib/narrate.py` with `lib/speech.py`                | a checked WAV per shot and its length (Piper)         |
| Capture     | `shorts/<id>/capture.spec.ts` with `lib/recorder.ts` | screencast frames and each shot's start time          |
| Overlays    | `lib/overlays.cjs`                                   | background, captions, callout and end card, from HTML |
| Compositing | `lib/compose.py`                                     | the two MP4s (ffmpeg), audio normalized to −14 LUFS   |
| Check       | `lib/transcribe.py`                                  | a timed transcript (faster-whisper)                   |

Two details that look removable and are not:

- **`--force-device-scale-factor`** in `playwright.config.ts`. Without it
  Chromium's screencast returns frames at CSS size (390×640) regardless of the
  context's scale factor, and the video is a soft upscale.
- **The two ffmpeg passes in `compose.py`**. Frames arrive only when the screen
  changes, so one can be held for several seconds. Fed straight into the
  overlay graph, that stalls ffmpeg's input scheduler indefinitely; normalizing
  to constant 30 fps first avoids it.

## Voice licensing

A synthetic voice is trained on recordings, and those recordings' licence
decides whether its output can be published. Check before adding one to
[`voices.txt`](./voices.txt), which pins each voice to a fixed revision and a
SHA-256.

| Voice                                                    | Training data                   | Usable here                                    |
| -------------------------------------------------------- | ------------------------------- | ---------------------------------------------- |
| `en_US-ljspeech-high` (default)                          | LJ Speech, public domain        | Yes                                            |
| `en_US-joe-medium`, `bryce`, `norman`, `john`, `kristin` | CC0 / public domain             | Yes, if added to `voices.txt`                  |
| `en_US-libritts_r-medium`                                | CC BY 4.0                       | Yes, with attribution in the video description |
| `en_US-lessac-*`                                         | Blizzard 2013, research licence | **No** — excludes any commercial use           |
| `en_US-ryan-*`, `hfc_*`                                  | CC BY-NC-SA 4.0                 | **No** — non-commercial                        |

The tools carry their own licences: Piper (`piper-tts`) is GPL-3.0-or-later and
faster-whisper is MIT. Both run only on the machine making a video; neither is
linked into or shipped with the application, whose licence is unaffected.

Piper randomizes every take slightly. `lib/narrate.py` runs it at half the
default noise, because at the default the LJ Speech voice dropped the H of
"Here's how" in about one take in eight, and checks every take as above. The
check uses the same speech model as `--check`, which has limits of its own: on
a short line with no context it hears "certs" as "search" every time, so a
line can warn when the voice is fine. The transcript of the full render,
which has context, is the better judge.

## Limitations

- The voice is synthetic and sounds it. It is suited to short how-to clips, less
  so to the 20-minute deep dives.
- Scenes with nothing in the app to show (hardware, a terminal on another
  machine, a person on camera) need their own capture or a slide.
- Data comes from the E2E fixtures plus each short's mocks, so a screen that
  needs realistic volumes of records needs them mocked.
- Uploading to YouTube is manual.
