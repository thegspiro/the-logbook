"""Assemble a short from its capture, narration and overlays.

Usage: python compose.py <short-dir> <build-dir> <v|h> <out.mp4>

Reads from <build-dir>: frames.json and frames/ (the capture),
audio/durations.json and audio/<shot>.wav (the narration), and
overlays/<v|h>/*.png with overlays/layout.json (the branding).
"""

import json
import subprocess
import sys
from pathlib import Path

FPS = 30
CALLOUT_MIN = 2.0  # seconds the closing callout stays up
END_CARD = 2.5  # the script's production notes ask for about two seconds
VOICE_LEAD = 0.12  # a line starts just after its cut, not on it


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

    # Caption windows: each line from its shot's start to the next shot's
    # start; the last gives way to the callout.
    windows = []
    for i, s in enumerate(shots):
        end = at[shots[i + 1]] if i + 1 < len(shots) else callout_start
        windows.append((f"cap-{s}.png", at[s], end))
    windows.append(("callout.png", callout_start, main_end))

    inputs = [
        *looped(ov / "bg.png", total),
        "-i",
        str(screen),
        *looped(ov / "mask.png", total),
    ]
    for name, _, _ in windows:
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
    for i, (_, a, b) in enumerate(windows):
        g.append(f"[{3 + i}:v]format=rgba,fade=in:st={a:.3f}:d=0.15:alpha=1[c{i}]")
        g.append(
            f"[{cur}][c{i}]overlay={C['x']}:{C['y']}"
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

    print(json.dumps({"out": str(out), "seconds": round(total, 2)}))


if __name__ == "__main__":
    if len(sys.argv) != 5 or sys.argv[3] not in ("v", "h"):
        sys.exit(__doc__)
    main(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3], Path(sys.argv[4]))
