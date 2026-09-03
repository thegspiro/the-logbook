"""Names and limits shared across the MCP package."""

# The integration catalog row that switches the whole feature on and off.
MCP_INTEGRATION_TYPE = "claude-mcp"

# Mounted under ``/api/`` deliberately: every reverse-proxy configuration this
# project ships or documents already routes ``/api/`` to the backend, and
# nginx is often managed outside the repository, so a new top-level path
# would need a proxy change the operator may not be able to make.
MCP_MOUNT_PATH = "/api/mcp"

# Plaintext keys start with this so a pasted value is recognisable and so
# the endpoint can reject anything else before touching the database.
KEY_PREFIX = "logbook_mcp_"
# Characters of the plaintext kept for display ("logbook_mcp_" + 8).
KEY_DISPLAY_PREFIX_LEN = 20

# Per-key request budget. Each tool call is one HTTP request, and an agent
# working through a question makes a burst of them; this is generous for a
# human-driven session and still bounds a runaway loop.
RATE_LIMIT_REQUESTS = 240
RATE_LIMIT_WINDOW_SECONDS = 60
# Authentication attempts per client address, counted before the key is
# looked up. A real client authenticates once per call and never nears
# this; a guesser does.
AUTH_RATE_LIMIT_ATTEMPTS = 60

# Refresh ``last_used_at`` at most this often, so a busy key does not force a
# row write on every call (the public portal does the same).
LAST_USED_THROTTLE_SECONDS = 60

# Largest page any list tool returns. A model reading a roster does not need
# more than this in one call, and it bounds the response size.
MAX_PAGE_SIZE = 200
DEFAULT_PAGE_SIZE = 50
