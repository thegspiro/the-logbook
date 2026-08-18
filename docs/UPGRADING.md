# Upgrading

Read this before pulling a new version into a running deployment.

## Check the configuration before you restart

A configuration problem is normally discovered when the container refuses to
boot — which means finding it by losing the service. Ask first:

```bash
docker compose run --rm backend python -m app.preflight
```

Exit `0` means the configuration starts, `1` means it does not and the
blocking items are listed, `2` means a value is malformed.

Blocking checks only run for `production` and `staging`, so a run in
development reports nothing regardless of how broken a production
configuration is. To test production values from elsewhere:

```bash
docker compose run --rm backend python -m app.preflight --as production
```

### "I set it in .env and nothing changed"

A Docker Compose `environment:` block is a **whitelist**. A variable missing
from it cannot be set from `.env` at all — Compose does not warn, and the
application sees only its built-in default. When a blocking check fires,
preflight and the startup log both report whether each setting actually
reached the process:

```
SECURITY_REQUIRE_TLS   NOT PRESENT — using built-in default True
```

That line means the value is not arriving. Add the name to the backend
service's `environment:` block and confirm it lands:

```bash
docker compose config | grep SECURITY_REQUIRE_TLS
```

This applies to any hand-maintained compose file — including one managed by
Unraid's Compose Manager plugin, which keeps its own file under
`/boot/config/plugins/compose.manager/projects/<name>/`. Such a file does not
receive changes made to the compose files in this repository, so a setting
added upstream has to be added there by hand.

## Changes that can stop an existing deployment from starting

Newest first. Every entry here is a change that was safe on a fresh install
and refused to boot an existing one.

### `SECURITY_REQUIRE_TLS` defaults to `true` (2026-08-13)

Absent transport TLS was previously a warning. It is now a **blocking**
critical in production and staging, so a deployment whose MySQL and Redis
speak plaintext stops booting on the next restart after this upgrade — which
may be long after the upgrade itself, making the connection easy to miss.

Choose one:

- **The data services have TLS:** set `DB_SSL=true` and `REDIS_SSL=true`, plus
  `DB_SSL_CA` / `REDIS_SSL_CA` pointing at the CA **inside the container**
  (`/etc/ssl/logbook/...`; put the PEM in `./infrastructure/certs`). Enabling
  TLS without a CA is itself blocking — an encrypted channel that authenticates
  nobody is indistinguishable from a correct one.
- **They do not, and the network protects that traffic** (the bundled MySQL and
  Redis on a private Docker network are this case): set
  `SECURITY_REQUIRE_TLS=false` as an explicit risk acceptance.

`SECURITY_ENFORCE_HTTPS` must also be `true` in production. It has no waiver
flag. It currently gates no behaviour — nothing emits HSTS and nothing
redirects HTTP — so setting it true cannot cause a redirect loop behind a
reverse proxy or CDN. To control the `Secure` flag on auth cookies, use
`COOKIE_SECURE`.

### `RATE_LIMIT_ENABLED` is enforced (2026-08-01)

The flag previously gated nothing. Production and staging now refuse to start
with it disabled, since turning it off removes brute-force protection from
every authentication and public endpoint at once.

## When adding a change that can block startup

Anything that can stop an existing deployment from booting — a new critical, a
default flipped toward fail-closed, a newly enforced flag — needs an entry in
this file naming the setting and both ways out, plus the usual `CHANGELOG.md`
entry. A fresh install passing is not evidence: these failures only ever
appear on installations that already existed.
