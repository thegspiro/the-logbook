#!/usr/bin/env python3
"""Generate a VAPID keypair for Web Push (RFC 8292).

Prints the two env vars to paste into the deployment's .env. Run once per
deployment and keep the pair stable: rotating it invalidates every existing
device subscription, and browsers give no way to notify members of that — they
each have to re-enable push by hand.

Key formats are dictated by what consumes them, not by preference:

  VAPID_PRIVATE_KEY  the raw 32-octet private scalar, base64url, unpadded.
                     ``pywebpush`` hands this to ``py_vapid.Vapid.from_string``,
                     which switches on decoded length — 32 bytes is read as a
                     raw scalar, anything else as DER.
  VAPID_PUBLIC_KEY   the uncompressed P-256 point (65 octets, 0x04-prefixed),
                     base64url, unpadded. This is served to the browser as the
                     ``applicationServerKey`` for ``pushManager.subscribe()``,
                     which rejects any other encoding.

Usage:
    cd backend && python scripts/generate_vapid_keys.py
"""

import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def b64url(raw: bytes) -> str:
    """Base64url without padding, as the Web Push specs require."""
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def generate() -> tuple[str, str]:
    """Return (private_key, public_key) as base64url strings."""
    key = ec.generate_private_key(ec.SECP256R1())
    private = b64url(key.private_numbers().private_value.to_bytes(32, "big"))
    public = b64url(
        key.public_key().public_bytes(
            serialization.Encoding.X962,
            serialization.PublicFormat.UncompressedPoint,
        )
    )
    return private, public


def main() -> None:
    private, public = generate()
    print("# Add to your .env — the private key must never leave the server.")
    print(f"VAPID_PUBLIC_KEY={public}")
    print(f"VAPID_PRIVATE_KEY={private}")
    print("VAPID_SUBJECT=mailto:admin@yourdepartment.org")


if __name__ == "__main__":
    main()
