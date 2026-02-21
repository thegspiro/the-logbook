"""
Core Utilities

Shared helper functions used across the application.
"""

import uuid
import secrets
import string


def generate_uuid() -> str:
    """Generate a UUID string for MySQL compatibility"""
    return str(uuid.uuid4())


def generate_display_code(length: int = 8) -> str:
    """Generate a short, URL-safe, non-guessable display code for public kiosk URLs.

    Uses lowercase alphanumeric characters excluding ambiguous chars (0, o, l, 1)
    for readability when displayed on screen or typed manually.
    """
    alphabet = string.ascii_lowercase + string.digits
    # Remove ambiguous characters
    alphabet = alphabet.replace('0', '').replace('o', '').replace('l', '').replace('1', '')
    return ''.join(secrets.choice(alphabet) for _ in range(length))
