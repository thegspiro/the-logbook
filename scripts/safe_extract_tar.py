#!/usr/bin/env python3
"""Extract a tar archive with Python's traversal/link safety filter."""

import argparse
import tarfile
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("archive", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()

    args.destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(args.archive, mode="r:*") as archive:
        archive.extractall(args.destination, filter="data")


if __name__ == "__main__":
    main()
