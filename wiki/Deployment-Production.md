# Production Deployment

What a deployment needs before members use it: hardened configuration, HTTPS,
off-host backups, monitoring and a safe update routine. Installing the stack is
covered on [Docker Deployment](Deployment-Docker) and
[Unraid Deployment](Deployment-Unraid).

---

## Pre-Production Checklist

### Configuration

- [ ] Production override in use: `COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml`
      in `.env` ([Docker → Compose Files](Deployment-Docker#compose-files))
- [ ] Unique `SECRET_KEY` (`openssl rand -hex 32`), `ENCRYPTION_KEY`
      (`openssl rand -hex 32`) and `ENCRYPTION_SALT` (`openssl rand -hex 16`)
- [ ] Strong `DB_PASSWORD`, `MYSQL_ROOT_PASSWORD` and `REDIS_PASSWORD`
- [ ] `ENCRYPTION_KEY` and `ENCRYPTION_SALT` copied somewhere other than the
      server and its backups
- [ ] `ALLOWED_ORIGINS` and `FRONTEND_URL` set to the public `https://` origin
- [ ] `SECURITY_REQUIRE_TLS` decided: TLS to the database and Redis, or an
      explicit `false` for the bundled services
- [ ] `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` set if the `with-s3` profile runs
- [ ] SMTP configured if the department will use email
      ([Environment Variables → Email](Configuration-Environment#email--smtp))
- [ ] Preflight passes ([Updating in Production](#updating-in-production))
- [ ] `.env` stays out of version control (the repository's `.gitignore`
      already excludes it)

### Infrastructure

- [ ] Memory per [Docker → Memory Profiles](Deployment-Docker#memory-profiles),
      2+ CPU cores, SSD storage
- [ ] HTTPS reverse proxy with a valid certificate
- [ ] Firewall open only for 22 (from admin addresses), 80 and 443; never
      publish 3000, 3001, 3306 or 6379
- [ ] Backups copied off the host, and a restore drill scheduled
- [ ] Monitoring of `/health` and the backup sidecar's log

---

## Startup Security Gate

With `ENVIRONMENT=production` (or `staging`) the backend checks its
configuration at startup and **refuses to start** on any blocking item. `docker-compose.prod.yml` sets
`ENVIRONMENT=production`, `DEBUG=false`, `ENABLE_DOCS=false` and
`SECURITY_ENFORCE_HTTPS=true`, defaults `SECURITY_REQUIRE_TLS` to `true`,
trusts the private Docker ranges in `TRUSTED_PROXY_IPS`, and stops publishing
the backend port.

Blocking items include:

- a missing or placeholder (`CHANGE_ME`) `SECRET_KEY`, `ENCRYPTION_KEY` or
  `DB_PASSWORD`, either key under 32 characters, or no `ENCRYPTION_SALT` or
  `REDIS_PASSWORD`;
- `DEBUG`, `DB_ECHO` or `ENABLE_DOCS` enabled;
- `SECURITY_ENFORCE_HTTPS` not `true`. This is an attestation that TLS
  terminates in front of the app; it does not redirect HTTP or send HSTS;
- `DB_SSL` or `REDIS_SSL` off while `SECURITY_REQUIRE_TLS=true`, or either on
  without its CA file (`DB_SSL_CA`, `REDIS_SSL_CA`);
- a `FRONTEND_URL` that points at the local machine while `ALLOWED_ORIGINS`
  has no public address to use instead (production only);
- a wildcard in `ALLOWED_ORIGINS`.

Auth cookies are always `Secure` in production unless `COOKIE_SECURE` says
otherwise, so logins work only over HTTPS. Run the
[preflight check](Configuration-Environment#check-the-configuration-before-you-restart-2026-08-18)
to see the blocking and advisory items without restarting.

---

## HTTPS and Reverse Proxy

With the production override the frontend container is the only published
port (3000). Its nginx forwards `/api` (including WebSocket upgrades) and
`/health` to the backend over the internal network, so a reverse proxy sends
**everything** to port 3000 — there is no separate backend port to route.

After the proxy works, set `FRONTEND_URL` and `ALLOWED_ORIGINS` to the
`https://` origin and run `docker compose up -d`.

### Nginx on the host

```nginx
server {
    listen 80;
    server_name logbook.example.org;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name logbook.example.org;

    ssl_certificate     /etc/letsencrypt/live/logbook.example.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/logbook.example.org/privkey.pem;

    # The backend's own ceiling (MAX_REQUEST_BODY_SIZE); nginx defaults to 1M
    client_max_body_size 60M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Issue the certificate with Certbot's nginx plugin:

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d logbook.example.org
sudo certbot renew --dry-run
```

The AWS guide's version of this config also keeps anonymous suggestion-box
submissions out of the access log:
[aws.md → Step 4](https://github.com/thegspiro/the-logbook/blob/main/docs/deployment/aws.md#step-4-set-up-nginx-reverse-proxy).

If you add `limit_conn` or `limit_req`, size them for a station whose members
share one public address: one dashboard load is about 20 API calls, and HTTP/2
counts every request in flight. The bundled configs use `limit_conn 400` and
50 requests a second with `burst=600 delay=100` for the API, and keep sign-in
at 5 a minute.

### Caddy

```
logbook.example.org {
    request_body {
        max_size 60MB
    }
    reverse_proxy 127.0.0.1:3000
}
```

Caddy obtains and renews the certificate itself.

### Bundled nginx

The stack can run its own nginx (`infrastructure/nginx/docker.conf`), which
terminates TLS on 443, redirects 80 and applies the same rate limits. Add
`docker-compose.proxy.yml` after the production override; it also stops
publishing port 3000, so nginx is the only way in:

```bash
COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml:docker-compose.proxy.yml
```

nginx will not start without `fullchain.pem` and `privkey.pem` in
`infrastructure/nginx/ssl/`, and the installers stop before building if they
are missing. The `production` profile (`--profile production`) also starts
nginx but leaves port 3000 published as a plain-HTTP second entrance; use it
only when something outside the stack must still reach port 3000.

Bootstrap with a temporary self-signed certificate, then issue a Let's
Encrypt certificate through the webroot nginx serves on port 80:

```bash
mkdir -p infrastructure/nginx/ssl infrastructure/nginx/certbot
openssl req -x509 -newkey rsa:2048 -nodes -days 7 -subj "/CN=localhost" \
  -keyout infrastructure/nginx/ssl/privkey.pem \
  -out infrastructure/nginx/ssl/fullchain.pem
docker compose up -d

DOMAIN=logbook.example.org
sudo certbot certonly --webroot -w "$PWD/infrastructure/nginx/certbot" -d "$DOMAIN" \
  --deploy-hook "cp -L /etc/letsencrypt/live/$DOMAIN/fullchain.pem /etc/letsencrypt/live/$DOMAIN/privkey.pem $PWD/infrastructure/nginx/ssl/ && docker exec intranet-nginx nginx -s reload"
```

Certbot reruns the deploy hook on every renewal. `cp -L` matters: the files
under `live/` are symlinks the container cannot follow. Full details:
[DEPLOYMENT.md → Docker Compose production profile](https://github.com/thegspiro/the-logbook/blob/main/docs/DEPLOYMENT.md#docker-compose-production-profile).

`scripts/setup-ssl.sh <domain> <email>` sets up an nginx installed on the
host, with a Let's Encrypt certificate, in front of either install. For the
Compose stack it sends everything to the frontend on port 3000 (which forwards
`/api` itself); for a traditional install it serves `frontend/dist` and sends
`/api` to `127.0.0.1:3001`. It detects which one it is on, or takes `--docker`
/ `--traditional`. Details:
[DEPLOYMENT.md → Automatic SSL Setup](https://github.com/thegspiro/the-logbook/blob/main/docs/DEPLOYMENT.md#automatic-ssl-setup-lets-encrypt).

---

## Environment Configuration

A production `.env` built from `.env.example`, bundled database and Redis:

```bash
ENVIRONMENT=production
DEBUG=false
ENABLE_DOCS=false
COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml

SECRET_KEY=<openssl rand -hex 32>
ENCRYPTION_KEY=<openssl rand -hex 32>
ENCRYPTION_SALT=<openssl rand -hex 16>

MYSQL_ROOT_PASSWORD=<strong password>
DB_PASSWORD=<strong password>
REDIS_PASSWORD=<strong password>

# Comma-separated; also the source of the Host-header allowlist
ALLOWED_ORIGINS=https://logbook.example.org
# Every link in outgoing email is built from it
FRONTEND_URL=https://logbook.example.org

# Bundled MySQL/Redis speak plaintext on the internal network
SECURITY_REQUIRE_TLS=false

TZ=America/New_York   # container clock; the department's timezone is set in the app
```

Recommended additions the backend warns about when missing:
`VOTE_SIGNING_KEY` (elections) and `AUDIT_LOG_SIGNING_KEY`. All variables:
[Environment Variables](Configuration-Environment).

---

## Backup and Recovery

### Backup sidecar

`docker-compose.prod.yml` runs a `backup` service
(`scripts/backup-sidecar.sh`). Nightly at `BACKUP_TIME` it writes the database,
uploads and audit archives to the `backups` volume as a checksummed
`logbook_backup_YYYYmmdd_HHMMSS.tar.gz`, and prunes archives older than
`BACKUP_RETENTION_DAYS`. Every `VERIFY_EVERY_N_BACKUPS` runs it restores the
fresh dump into a throwaway schema and checks it; a failed drill keeps failing
loudly every night until fixed.

| Variable                 | Default | Meaning                             |
| ------------------------ | ------- | ----------------------------------- |
| `BACKUP_TIME`            | `02:00` | Daily run time, UTC, `HH:MM`        |
| `BACKUP_RETENTION_DAYS`  | `30`    | Prune archives older than this      |
| `VERIFY_EVERY_N_BACKUPS` | `7`     | Restore-drill cadence; `0` disables |

There is no on/off switch: backups run whenever the service runs.
`BACKUP_ENABLED` and `BACKUP_SCHEDULE` in `.env.example` are not read by
either backup script.

```bash
docker compose logs backup

# Drill any archive by hand
docker compose exec backup bash /scripts/verify_backup.sh \
  /backups/logbook_backup_YYYYmmdd_HHMMSS.tar.gz

# Where the volume lives on disk (project name = directory name by default)
docker volume inspect the-logbook_backups -f '{{ .Mountpoint }}'
```

### Manual backup and restore

`scripts/backup.sh` runs on the host from the install directory:

```bash
./scripts/backup.sh                    # archive into ./backups (BACKUP_LOCATION overrides)
./scripts/backup.sh --destination s3   # also upload: s3, azure or gcs
./scripts/backup.sh --list
./scripts/backup.sh --restore backups/logbook_backup_YYYYmmdd_HHMMSS.tar.gz
```

It reaches MySQL through the running database container. Restore into a
running stack with the same `.env` secrets, then verify by logging in, opening
an encrypted record and an uploaded file.

### Off-host copies and keys

- The `backups` volume is on the same host. Sync it elsewhere (S3, rsync
  target, NAS) — a backup that dies with the host is not a backup.
- The archive contains a values-stripped `.env` template, not your secrets.
  Keep `ENCRYPTION_KEY`, `ENCRYPTION_SALT`, `SECRET_KEY` and the database
  passwords offline in at least two places: a database backup is unreadable
  without the keys in use when it was written.
- With the external-services override the sidecar does not run; use the
  provider's database backups and copy the `uploads` and `audit_archives`
  volumes yourself.

Restore drills, RTO/RPO targets and the total-loss runbook:
[BACKUP.md](https://github.com/thegspiro/the-logbook/blob/main/docs/BACKUP.md).

---

## Monitoring

```bash
curl -s https://logbook.example.org/health   # {"status":"healthy","ready":true}
docker compose ps
docker stats
docker compose logs --tail=100 backend
docker compose logs backup
```

`/health` answers `healthy`, `degraded` (Redis unavailable, HTTP 200) or
`unhealthy` (database or startup failure, HTTP 503); point an uptime monitor
at it. While the backend is starting it also reports its startup phase and the
database and Redis checks; once ready it reports nothing more, by design.

Security status and audit-log integrity are API endpoints that need a signed-in
user with `audit.view`: `GET /api/v1/security/status` and
`GET /api/v1/security/audit-log/integrity`. See
[Security Audit Logging](Security-Audit-Logging).

Error tracking: set `SENTRY_ENABLED=true` and `SENTRY_DSN`.

---

## Scaling

The production override runs the backend as one uvicorn worker. For more,
add an override file and include it in `COMPOSE_FILE` — a pinned
`COMPOSE_FILE` stops Compose from loading `docker-compose.override.yml`
automatically:

```yaml
# docker-compose.override.yml
services:
  backend:
    command:
      [
        "uvicorn",
        "main:app",
        "--host",
        "0.0.0.0",
        "--port",
        "3001",
        "--workers",
        "4",
      ]
```

```bash
COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml:docker-compose.override.yml
```

Workers serialize startup migrations with a database lock and share rate-limit
state through Redis. Raise the backend's 768 MB memory limit to match. MySQL's
`max_connections` is 200 (`command:` in `docker-compose.yml`).

---

## Cloud Platforms

Every cloud option runs the Docker Compose stack on a VM; there is no Helm
chart or Kubernetes manifest. Size the VM at 4 GB RAM or more.

| Platform     | Typical VM                         | Guide                                                                                                                 |
| ------------ | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| AWS EC2      | `t3.medium` (4 GB), Ubuntu 22.04   | [aws.md](https://github.com/thegspiro/the-logbook/blob/main/docs/deployment/aws.md) — single VM, or RDS + ElastiCache |
| Azure        | 4 GB VM, Ubuntu 22.04              | Universal installer on the VM                                                                                         |
| Google Cloud | 4 GB Compute Engine VM             | Universal installer on the VM                                                                                         |
| DigitalOcean | 4 GB Droplet                       | Universal installer on the Droplet                                                                                    |
| Synology NAS | DSM 7.2+, Container Manager or SSH | [synology.md](https://github.com/thegspiro/the-logbook/blob/main/docs/deployment/synology.md)                         |
| Proxmox      | LXC container with Docker          | [proxmox.md](https://github.com/thegspiro/the-logbook/blob/main/docs/deployment/proxmox.md)                           |
| Unraid       | —                                  | [Unraid Deployment](Deployment-Unraid)                                                                                |

On any VM: open only 22, 80 and 443 in the provider's firewall, install with
the [universal installer](Deployment-Docker#universal-installer) or
[manually](Deployment-Docker#install-manually), then add
[HTTPS](#https-and-reverse-proxy).

Managed MySQL and Redis (RDS and ElastiCache, Azure Database for MySQL and
Azure Cache for Redis, and similar) go through
[Docker → External Database and Redis](Deployment-Docker#external-database-and-redis).
Use MySQL 8.0 with `utf8mb4` / `utf8mb4_unicode_ci`, Redis 7 with a password,
and TLS to both.

---

## Updating in Production

```bash
cd /path/to/the-logbook

# 1. Back up (the sidecar's last archive may be up to a day old)
./scripts/backup.sh

# 2. Pull and repair build contexts
git pull
./scripts/sync-compose-build-context.sh --fix -f docker-compose.yml

# 3. Check the new version's configuration before restarting
docker compose run --rm --build backend python -m app.preflight

# 4. Rebuild and recreate; migrations run as the backend starts
docker compose up -d --build

# 5. Verify
docker compose ps
curl -s https://logbook.example.org/health
```

Read [UPGRADING.md](https://github.com/thegspiro/the-logbook/blob/main/docs/UPGRADING.md)
before pulling: it lists every change that can stop an existing deployment
from starting. Never downgrade to repair a migration problem — several
migrations do not reverse.

---

**See also:** [Docker Deployment](Deployment-Docker) | [Security Configuration](Configuration-Security) | [Environment Variables](Configuration-Environment)
