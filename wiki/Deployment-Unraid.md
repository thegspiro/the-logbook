# Unraid Deployment & Updates

> **Published copy — not the canonical source.** The maintained originals are
> [`docs/deployment/unraid.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/deployment/unraid.md)
> (full guide) and the
> [`unraid/`](https://github.com/thegspiro/the-logbook/tree/main/unraid)
> directory (scripts and compose files) in the repository. This page is a
> condensed overview and may lag behind them.

## Install

SSH into your Unraid server and run:

```bash
curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/unraid/unraid-setup.sh | bash
```

The script clones the repository to `/mnt/user/appdata/the-logbook`, generates
secure credentials, sets Unraid permissions, and builds and starts all
containers (frontend, backend, MySQL 8.0, Redis 7). When prompted, choose
**1** for a fresh installation.

Then open `http://YOUR-UNRAID-IP:7880` and complete the onboarding wizard.

For manual installation steps, configuration, HTTPS setup, and backups, see
the [full Unraid guide](https://github.com/thegspiro/the-logbook/blob/main/docs/deployment/unraid.md)
and the [Unraid Quick Start](Unraid-Quick-Start).

> **Note:** The Logbook is not yet published to Unraid Community Applications —
> searching the Apps tab will not find it. Docker Compose (above) is the
> supported install path today.

## Update

Preferred — the update script handles a verified database dump, build-context
repair, rebuild, and rollback instructions:

```bash
cd /mnt/user/appdata/the-logbook/unraid
./update.sh
```

Or use the setup script's update mode:

```bash
cd /mnt/user/appdata/the-logbook/unraid
./unraid-setup.sh
# Choose option 2 (Update)
```

Manual update, if you prefer to run each step yourself:

```bash
cd /mnt/user/appdata/the-logbook
git pull origin main

# Repair the compose build contexts if a pulled Dockerfile outgrew them.
# Skipping this is what produces '"/frontend/nginx.conf": not found'
# minutes into the rebuild, with the stack already down.
./scripts/sync-compose-build-context.sh --fix -f docker-compose.yml

docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

Back up before updating:

```bash
docker-compose exec backend /app/scripts/backup.sh
```

## Verify after install or update

```bash
# All containers running?
docker-compose ps

# Backend healthy?
curl http://localhost:7881/health

# Any errors in the logs?
docker-compose logs --tail=50
```

Then open `http://YOUR-UNRAID-IP:7880` in a browser.

## Security posture

The Unraid stack runs with `ENVIRONMENT=production`, which enforces a startup
security gate:

- **API docs (`/docs`) are OFF by default** — enabling them blocks boot.
- **HTTPS is required** — the app refuses to start unless strong secrets are
  set, `DEBUG=false`, docs are disabled, and `SECURITY_ENFORCE_HTTPS=true`.
  Front the app with an HTTPS reverse proxy (Swag, Nginx Proxy Manager) and
  point `ALLOWED_ORIGINS` at your `https://` origin.
- **Leave `TRUSTED_PROXY_IPS` empty** unless you add a reverse proxy — the
  compose publishes the backend port directly, so the connecting peer is the
  real client.

Reverse-proxy configuration examples are in the
[full guide](https://github.com/thegspiro/the-logbook/blob/main/docs/deployment/unraid.md#https-with-reverse-proxy).

## Troubleshooting

Common issues (container name conflicts, port conflicts, database connection
errors, full rebuild) are covered in the
[full guide's troubleshooting section](https://github.com/thegspiro/the-logbook/blob/main/docs/deployment/unraid.md#troubleshooting).

The fastest fix for the frequent `container name "/logbook-redis" is already
in use` error:

```bash
cd /mnt/user/appdata/the-logbook
docker-compose down --remove-orphans
docker-compose up -d
```

## Getting help

- [GitHub Issues](https://github.com/thegspiro/the-logbook/issues) — include
  your Unraid version, container logs (`docker-compose logs --tail=50`), and
  steps to reproduce
- [Unraid Community Forums](https://forums.unraid.net/) — Docker Containers
  section
