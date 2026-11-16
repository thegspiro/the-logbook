"""Transcribe a rendered video, as a check on the synthetic narration.

Usage: python transcribe.py <video.mp4>

Prints each spoken segment with its start and end time, so the words and the
moment they land can be compared with shots.json without listening.
"""

import subprocess
import sys

import numpy as np
from faster_whisper import WhisperModel


def main(media: str) -> None:
    # Decoded by ffmpeg rather than faster-whisper's own PyAV path, whose
    # keyword arguments have drifted from the PyAV releases pip resolves.
    pcm = subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            media,
            "-ac",
            "1",
            "-ar",
            "16000",
            "-f",
            "s16le",
            "-",
        ],
        check=True,
        capture_output=True,
    ).stdout
    audio = np.frombuffer(pcm, np.int16).astype(np.float32) / 32768
    model = WhisperModel("base.en", device="cpu", compute_type="int8")
    segments, _ = model.transcribe(audio)
    for seg in segments:
        print(f"{seg.start:6.2f}-{seg.end:6.2f}  {seg.text.strip()}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
