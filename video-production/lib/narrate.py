"""Synthesize each shot's narration with Piper, checking every take.

Usage: python narrate.py <short-dir> <build-dir> <voice.onnx>

Writes <build-dir>/audio/<shot-id>.wav and audio/durations.json, which the
capture reads to hold each shot for as long as its line takes to say.

Piper randomizes every take, and a take now and then slurs a word: "Tap
Submit" came out as "tax submit", "expired" as "expire". So each line is
transcribed as soon as it is spoken and re-taken until the transcript matches
the script, keeping the closest take if none does.
"""

import json
import sys
import wave
from pathlib import Path

from piper import PiperVoice
from piper.config import SynthesisConfig

sys.path.insert(0, str(Path(__file__).resolve().parent))
from speech import decode, load_model, match

# A touch quicker than Piper's default reads better against quick cuts. The
# noise settings are half Piper's defaults: at the defaults LJSpeech dropped
# the H of "Here's how" in about one take in eight ("Ears how").
SYNTHESIS = SynthesisConfig(length_scale=0.92, noise_scale=0.333, noise_w_scale=0.333)
MAX_TAKES = 6
GOOD_ENOUGH = 1.0  # every word heard as written
WARN_BELOW = 0.9


def main(short_dir: Path, build_dir: Path, voice_path: Path) -> None:
    shots = json.loads((short_dir / "shots.json").read_text(encoding="utf-8"))["shots"]
    out = build_dir / "audio"
    out.mkdir(parents=True, exist_ok=True)
    voice = PiperVoice.load(str(voice_path))
    model = load_model()

    durations = {}
    unclear = []
    for shot in shots:
        path = out / f"{shot['id']}.wav"
        take = out / f"{shot['id']}.take.wav"
        best = -1.0
        best_heard = ""
        for n in range(1, MAX_TAKES + 1):
            with wave.open(str(take), "wb") as w:
                # "speak", when given, is what the voice reads: a respelling of
                # a word it garbles. The take is still scored against "say".
                voice.synthesize_wav(
                    shot.get("speak", shot["say"]), w, syn_config=SYNTHESIS
                )
            segments, _ = model.transcribe(decode(str(take)))
            heard = " ".join(s.text.strip() for s in segments)
            score = match(shot["say"], heard)
            if score > best:
                best = score
                take.replace(path)
                best_heard = heard
            if best >= GOOD_ENOUGH:
                break
        take.unlink(missing_ok=True)
        print(f"  {shot['id']}: {best:.2f} after {n} take(s)  heard: {best_heard}")
        if best < WARN_BELOW:
            unclear.append(shot["id"])
        with wave.open(str(path)) as w:
            durations[shot["id"]] = round(w.getnframes() / w.getframerate(), 3)

    (out / "durations.json").write_text(
        json.dumps(durations, indent=2), encoding="utf-8"
    )
    if unclear:
        print(
            f"WARNING: no clear take of {', '.join(unclear)}; "
            "consider rewording those lines in shots.json",
            file=sys.stderr,
        )


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
