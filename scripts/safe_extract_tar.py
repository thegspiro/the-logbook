#!/usr/bin/env python3
"""Extract a tar archive with traversal/link safety checks.

Prefers the stdlib "data" extraction filter (Python >= 3.12, also present in
the 3.8+ security backports). Older interpreters whose ``extractall`` has no
``filter`` parameter raise ``TypeError`` before extracting anything; for those
we validate every member by hand — rejecting absolute paths, ``..`` traversal,
links, and special files — before extracting.
"""

import argparse
import sys
import tarfile
from pathlib import Path, PurePosixPath


def validate_member(member: tarfile.TarInfo) -> None:
    """Raise ValueError if extracting *member* could escape the destination."""
    name = member.name
    # Tar member names use forward slashes; also reject backslashes so a
    # Windows extraction cannot be steered outside the destination.
    if name.startswith("/") or "\\" in name:
        raise ValueError(f"absolute or non-portable path in archive: {name!r}")
    parts = PurePosixPath(name).parts
    if ".." in parts or (parts and parts[0].endswith(":")):
        raise ValueError(f"path traversal in archive: {name!r}")
    if member.islnk() or member.issym():
        raise ValueError(f"link member in archive: {name!r}")
    if not (member.isreg() or member.isdir()):
        raise ValueError(f"special (non file/dir) member in archive: {name!r}")


def extract_validated(archive: tarfile.TarFile, destination: Path) -> None:
    """Manual-validation fallback for Pythons without extraction filters.

    Validates ALL members before extracting any, so a malicious member late
    in the archive cannot leave a partial extraction behind.
    """
    members = archive.getmembers()
    for member in members:
        validate_member(member)
    archive.extractall(destination, members=members)


def extract(archive_path: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive_path, mode="r:*") as archive:
        try:
            archive.extractall(destination, filter="data")
        except TypeError:
            # Python < 3.12 without the filter backport: ``filter`` is an
            # unexpected keyword, raised before anything is written.
            extract_validated(archive, destination)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("archive", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()

    try:
        extract(args.archive, args.destination)
    except (ValueError, tarfile.TarError) as exc:
        sys.exit(f"refusing to extract {args.archive}: {exc}")


if __name__ == "__main__":
    main()
