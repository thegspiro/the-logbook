"""
The number a generated document carries, so a printed page can be traced back
to the export that made it (owner decision, 2026-11-21).

``RPT-YYYYMMDD-XXXX``: the department's local date, then four characters drawn
from Crockford's base32, which leaves out I, L, O and U so a number read off a
photocopy or over the phone is not misheard. The number is recorded in the
export's audit row, which is what makes it traceable; it is not stored anywhere
else and is not sequential, by owner decision, so no counter table, migration or
locked increment is needed. With 32^4 codes per day, two exports on one day
sharing a number is a one-in-a-million event per pair, and even then the audit
rows still tell them apart by time and member.
"""

import secrets
from datetime import date

_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
REPORT_NUMBER_PATTERN = r"RPT-\d{8}-[0-9A-HJKMNP-TV-Z]{4}"


def new_report_number(local_day: date) -> str:
    suffix = "".join(secrets.choice(_ALPHABET) for _ in range(4))
    return f"RPT-{local_day:%Y%m%d}-{suffix}"
