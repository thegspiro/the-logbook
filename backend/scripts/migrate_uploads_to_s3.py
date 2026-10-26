#!/usr/bin/env python3
"""
The former name of ``scripts/migrate_uploads_to_remote.py``, kept so commands
written before 2026-10-25 still work: runbooks, shell history, and the
``backup.sh`` on a host that has not been updated, which calls this name inside
the backend container. It takes the same options, ``--buckets`` included, and
behaves exactly the same.
"""

import os
import runpy

if __name__ == "__main__":
    runpy.run_path(
        os.path.join(os.path.dirname(__file__), "migrate_uploads_to_remote.py"),
        run_name="__main__",
    )
