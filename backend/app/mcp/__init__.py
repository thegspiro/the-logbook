"""
The Logbook's MCP (Model Context Protocol) server.

An opt-in add-on, off by default, that lets an MCP client such as Claude Code,
Claude Desktop or the Messages API connector ask questions of a department's
data. It is mounted inside the existing FastAPI process at ``/api/mcp`` so
every deployment shape — Unraid, Docker, a cloud host — gets it without a new
container, port or proxy rule.

Package layout:

* ``principal``  — who is calling: the organization behind the service key
  and what the department has allowed it (read/write, finance, medical).
* ``keys``       — minting, revoking and authenticating service keys.
* ``redaction``  — the personal-information boundary, applied to every tool
  result on the way out.
* ``registry``   — the decorator every tool goes through: gating, a database
  session, redaction, audit.
* ``server``     — the MCP server object and its tool registrations.
* ``transport``  — the pure-ASGI endpoint: bearer auth, rate limit, hand-off
  to the SDK's streamable-HTTP session manager.
"""
