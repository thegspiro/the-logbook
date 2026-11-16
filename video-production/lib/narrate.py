"""Synthesize each shot's narration with Piper.

Usage: python narrate.py <short-dir> <build-dir> <voice.onnx>

Writes <build-dir>/audio/<shot-id>.wav and audio/durations.json, which the
capture reads to hold each shot for as long as its line takes to say.
"""

import json
import sys
import wave
from pathlib import Path

from piper import PiperVoice
from piper.config import SynthesisConfig

# A touch quicker than Piper's default reads better against quick cuts. The
# noise settings are half Piper's defaults: every take is randomized, and at
# the defaults LJSpeech dropped the H of "Here's how" in about one take in
# eight ("Ears how"). At these, eight takes in eight came out clean.
SYNTHESIS = SynthesisConfig(length_scale=0.92, noise_scale=0.333, noise_w_scale=0.333)


def main(short_dir: Path, build_dir: Path, voice_path: Path) -> None:
    shots = json.loads((short_dir / "shots.json").read_text(encoding="utf-8"))["shots"]
    out = build_dir / "audio"
    out.mkdir(parents=True, exist_ok=True)
    voice = PiperVoice.load(str(voice_path))

    durations = {}
    for shot in shots:
        path = out / f"{shot['id']}.wav"
        with wave.open(str(path), "wb") as w:
            voice.synthesize_wav(shot["say"], w, syn_config=SYNTHESIS)
        with wave.open(str(path)) as w:
            durations[shot["id"]] = round(w.getnframes() / w.getframerate(), 3)

    (out / "durations.json").write_text(
        json.dumps(durations, indent=2), encoding="utf-8"
    )
    print(json.dumps(durations))


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
