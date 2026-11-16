"""Transcribe a rendered video, as a check on the synthetic narration.

Usage: python transcribe.py <video.mp4>

Prints each spoken segment with its start and end time, so the words and the
moment they land can be compared with shots.json without listening.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from speech import decode, load_model


def main(media: str) -> None:
    segments, _ = load_model().transcribe(decode(media))
    for seg in segments:
        print(f"{seg.start:6.2f}-{seg.end:6.2f}  {seg.text.strip()}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
