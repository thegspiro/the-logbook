"""Speech recognition shared by the narration self-check and transcribe.py."""

import re
import subprocess
from difflib import SequenceMatcher

import numpy as np
from faster_whisper import WhisperModel

_ONES = (
    "zero one two three four five six seven eight nine ten eleven twelve thirteen "
    "fourteen fifteen sixteen seventeen eighteen nineteen"
).split()
_TENS = "twenty thirty forty fifty sixty seventy eighty ninety".split()


def load_model() -> WhisperModel:
    return WhisperModel("base.en", device="cpu", compute_type="int8")


def decode(media: str) -> np.ndarray:
    """Any audio or video file as 16 kHz mono float samples.

    Decoded by ffmpeg rather than faster-whisper's own PyAV path, whose
    keyword arguments have drifted from the PyAV releases pip resolves.
    """
    pcm = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", media, "-ac", "1", "-ar", "16000"]
        + ["-f", "s16le", "-"],
        check=True,
        capture_output=True,
    ).stdout
    return np.frombuffer(pcm, np.int16).astype(np.float32) / 32768


def _number_words(n: int) -> list[str]:
    if n < 20:
        return [_ONES[n]]
    if n < 100:
        tens, ones = divmod(n, 10)
        return [_TENS[tens - 2]] + ([_ONES[ones]] if ones else [])
    return [str(n)]


def words(text: str, join_hyphens: bool = False) -> list[str]:
    """Lowercase words with punctuation dropped and small numbers spelled out,
    so a script's "thirty" matches a transcript's "30". A hyphen splits a word
    by default; with join_hyphens it is dropped, so "run-offs" reads as
    "runoffs"."""
    out: list[str] = []
    hyphen = "" if join_hyphens else " "
    for token in re.findall(r"[a-z0-9']+", text.lower().replace("-", hyphen)):
        token = token.strip("'")
        if token.isdigit():
            out.extend(_number_words(int(token)))
        elif token:
            out.append(token)
    return out


def match(expected: str, heard: str) -> float:
    """How closely a transcript follows the script, 0 to 1, word by word.

    Scored with hyphens both splitting and joining words, keeping the better:
    the transcriber writes "runoffs" as "run-offs" and "Check-In" as "check
    in", and neither is a mistake by the voice.
    """
    return max(
        SequenceMatcher(None, words(expected, j), words(heard, j)).ratio()
        for j in (False, True)
    )
