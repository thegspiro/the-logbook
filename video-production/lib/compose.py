"""Assemble a short or a guide from its capture, narration and overlays.

Usage: python compose.py <video-dir> <build-dir> <v|h> <out.mp4>

Reads from <build-dir>: frames.json and frames/ (the capture),
audio/durations.json and audio/<shot>.wav (the narration), and
overlays/<v|h>/*.png with overlays/layout.json (the branding).

A guide ("kind": "guide" in shots.json) also writes <out>.chapters.txt, the
section start times in YouTube's chapter format, and <out>.srt, the narration
as subtitles.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

FPS = 30
CALLOUT_MIN = 2.0  # seconds the closing callout stays up
END_CARD = 2.5  # the script's production notes ask for about two seconds
VOICE_LEAD = 0.12  # a line starts just after its cut, not on it
TITLE_CARD = 3.0  # a guide opens on its chapter title over the first line
BANNER = 3.5  # seconds a guide's section banner stays over the screen


def ffmpeg(*args: str) -> None:
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True
    )


def concat_path(path: Path) -> str:
    # The concat list quotes paths in single quotes; ffmpeg reads '\'' as a
    # literal quote inside one.
    return "'" + path.as_posix().replace("'", "'\\''") + "'"


def looped(path: Path, total: float) -> list[str]:
    return ["-loop", "1", "-framerate", str(FPS), "-t", f"{total:.3f}", "-i", str(path)]


def main(short_dir: Path, build: Path, fmt: str, out: Path) -> None:
    spec = json.loads((short_dir / "shots.json").read_text(encoding="utf-8"))
    cap = json.loads((build / "frames.json").read_text(encoding="utf-8"))
    dur = json.loads((build / "audio" / "durations.json").read_text(encoding="utf-8"))
    layout = json.loads(
        (build / "overlays" / "layout.json").read_text(encoding="utf-8")
    )[fmt]
    ov = build / "overlays" / fmt

    shots = [s["id"] for s in spec["shots"]]
    t0 = cap["marks"][shots[0]]
    at = {k: v - t0 for k, v in cap["marks"].items()}

    last = shots[-1]
    callout_start = at[last] + dur[last] + 0.15
    main_end = max(at["end"], callout_start + CALLOUT_MIN)
    total = main_end + END_CARD

    # The screencast is variable-rate: a frame arrives only when the screen
    # changes, so each one is held until the next frame's timestamp.
    frames = cap["frames"]
    before = [i for i, f in enumerate(frames) if f["t"] <= t0]
    first = before[-1] if before else 0
    lines = []
    for i in range(first, len(frames)):
        start = max(frames[i]["t"], t0) - t0
        nxt = frames[i + 1]["t"] - t0 if i + 1 < len(frames) else total
        lines.append(f"file {concat_path(build / frames[i]['file'])}")
        lines.append(f"duration {max(nxt - start, 0.001):.4f}")
    # The concat demuxer drops the last entry's duration unless it is repeated.
    lines.append(f"file {concat_path(build / frames[-1]['file'])}")
    concat = build / "concat.txt"
    concat.write_text("\n".join(lines) + "\n", encoding="utf-8")

    S, C = layout["screen"], layout["caption"]

    # Pass 1: normalize to constant frame rate. Feeding the concat demuxer
    # straight into the overlay graph stalls ffmpeg's input scheduler on a
    # long-held frame while the looped image inputs run ahead of it.
    screen = build / f"screen-{fmt}.mp4"
    ffmpeg(
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(concat),
        "-vf",
        f"fps={FPS},scale={S['w']}:{S['h']}:flags=lanczos",
        "-t",
        f"{total:.3f}",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "12",
        "-pix_fmt",
        "yuv444p",
        str(screen),
    )

    # Overlay windows: (layer, from, to, x, y, fades out). A short captions
    # each line from its shot's start to the next shot's start, the last giving
    # way to the callout. A guide opens on its title card and announces each
    # section with a banner instead; its narration goes to the .srt.
    windows: list[tuple[str, float, float, int, int, bool]] = []
    guide = spec.get("kind") == "guide"
    if guide:
        B = layout["banner"]
        windows.append(("title.png", 0.0, TITLE_CARD, 0, 0, True))
        for s in spec["shots"]:
            if s.get("section"):
                a = max(at[s["id"]], TITLE_CARD)
                windows.append(
                    (f"sec-{s['id']}.png", a, a + BANNER, B["x"], B["y"], True)
                )
        windows.append(("callout.png", callout_start, main_end, B["x"], B["y"], False))
    else:
        for i, s in enumerate(shots):
            end = at[shots[i + 1]] if i + 1 < len(shots) else callout_start
            windows.append((f"cap-{s}.png", at[s], end, C["x"], C["y"], False))
        windows.append(("callout.png", callout_start, main_end, C["x"], C["y"], False))

    inputs = [
        *looped(ov / "bg.png", total),
        "-i",
        str(screen),
        *looped(ov / "mask.png", total),
    ]
    for name, *_ in windows:
        inputs += looped(ov / name, total)
    end_idx = 3 + len(windows)
    inputs += looped(ov / "end.png", total)
    audio_idx = end_idx + 1
    for s in shots:
        inputs += ["-i", str(build / "audio" / f"{s}.wav")]

    g = [
        "[1:v]format=rgba[scr]",
        "[2:v]format=gray[msk]",
        "[scr][msk]alphamerge[scrm]",
        f"[0:v][scrm]overlay={S['x']}:{S['y']}:shortest=1[v0]",
    ]
    cur = "v0"
    for i, (_, a, b, x, y, fades) in enumerate(windows):
        fade = f"fade=in:st={a:.3f}:d=0.15:alpha=1"
        if fades:
            fade += f",fade=out:st={b - 0.4:.3f}:d=0.4:alpha=1"
        g.append(f"[{3 + i}:v]format=rgba,{fade}[c{i}]")
        g.append(
            f"[{cur}][c{i}]overlay={x}:{y}"
            f":enable='between(t,{a:.3f},{b:.3f})'[v{i + 1}]"
        )
        cur = f"v{i + 1}"
    g.append(f"[{end_idx}:v]format=rgba,fade=in:st={main_end:.3f}:d=0.35:alpha=1[endc]")
    g.append(
        f"[{cur}][endc]overlay=0:0:enable='gte(t,{main_end:.3f})',format=yuv420p[vout]"
    )

    for i, s in enumerate(shots):
        ms = int(round((at[s] + VOICE_LEAD) * 1000))
        g.append(f"[{audio_idx + i}:a]aresample=48000,adelay={ms}|{ms}[a{i}]")
    # -14 LUFS is YouTube's playback loudness, so it is neither turned down
    # nor left quieter than the videos around it.
    g.append(
        "".join(f"[a{i}]" for i in range(len(shots)))
        + f"amix=inputs={len(shots)}:normalize=0,apad,atrim=0:{total:.3f},"
        + "loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]"
    )

    out.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg(
        *inputs,
        "-filter_complex",
        ";".join(g),
        "-map",
        "[vout]",
        "-map",
        "[aout]",
        "-r",
        str(FPS),
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        "-t",
        f"{total:.3f}",
        str(out),
    )

    if guide:
        write_chapters(spec, at, out.with_suffix(".chapters.txt"))
        write_srt(spec, at, dur, out.with_suffix(".srt"))
    print(json.dumps({"out": str(out), "seconds": round(total, 2)}))


def clock(t: float) -> str:
    m, s = divmod(int(t), 60)
    return f"{m}:{s:02d}"


def write_chapters(spec: dict, at: dict, path: Path) -> None:
    """Section starts as YouTube reads them from a description: one per line,
    the first at 0:00, at least three, each at least ten seconds long."""
    rows = [(at[s["id"]], s["section"]) for s in spec["shots"] if s.get("section")]
    if rows:
        rows[0] = (0.0, rows[0][1])
    path.write_text("".join(f"{clock(t)} {title}\n" for t, title in rows), "utf-8")


def srt_time(t: float) -> str:
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def write_srt(spec: dict, at: dict, dur: dict, path: Path) -> None:
    """Each line's sentences, timed across its narration in proportion to
    their length. The voice keeps an even pace, so this lands within a beat of
    the speech without a second transcription pass."""
    cues = []
    for s in spec["shots"]:
        sentences = [x for x in re.split(r"(?<=[.!?])\s+", s["say"].strip()) if x]
        start = at[s["id"]] + VOICE_LEAD
        span = dur[s["id"]]
        total_chars = sum(len(x) for x in sentences) or 1
        for text in sentences:
            length = span * len(text) / total_chars
            cues.append((start, start + length, text))
            start += length
    path.write_text(
        "".join(
            f"{i}\n{srt_time(a)} --> {srt_time(b)}\n{text}\n\n"
            for i, (a, b, text) in enumerate(cues, 1)
        ),
        "utf-8",
    )


if __name__ == "__main__":
    if len(sys.argv) != 5 or sys.argv[3] not in ("v", "h"):
        sys.exit(__doc__)
    main(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3], Path(sys.argv[4]))
