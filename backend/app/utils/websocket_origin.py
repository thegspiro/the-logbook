"""Origin validation for cookie- or token-authenticated WebSockets."""

from urllib.parse import urlsplit


def is_websocket_origin_allowed(
    origin: str | None, host: str | None, allowed_origins: list[str]
) -> bool:
    """Allow non-browser clients, configured origins, and same-host browsers.

    CORS middleware does not apply to WebSocket scopes. Browsers include an
    Origin header, so it must be checked explicitly to prevent a stolen query
    token (or browser cookie behavior changes) from enabling a cross-site
    WebSocket connection.
    """
    if origin is None:
        return True
    if origin == "null" or not host:
        return False

    try:
        parsed = urlsplit(origin)
    except ValueError:
        return False
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return False

    normalized_origin = origin.rstrip("/").lower()
    normalized_allowed = {value.rstrip("/").lower() for value in allowed_origins}
    if normalized_origin in normalized_allowed:
        return True

    return parsed.netloc.lower() == host.lower()
