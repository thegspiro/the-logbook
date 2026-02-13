"""
Core Utilities

Shared helper functions used across the application.
"""

import uuid


def generate_uuid() -> str:
    """Generate a UUID string for MySQL compatibility"""
    return str(uuid.uuid4())
