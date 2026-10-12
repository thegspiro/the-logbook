# Unraid Deployment

Install, update and maintain The Logbook on Unraid with Docker Compose. The
scripts and compose files live in the repository's
[`unraid/`](https://github.com/thegspiro/the-logbook/tree/main/unraid)
directory; the longer reference is
[docs/deployment/unraid.md](https://github.com/thegspiro/the-logbook/blob/main/docs/deployment/unraid.md).

The Logbook is not yet published to Unraid Community Applications, so the Apps
tab will not find it. Docker Compose is the supported install path.

---

## Requirements

| Component | Minimum   | Recommended |
| --------- | --------- | ----------- |
| Unraid    | 6.9.0     | 6.12.0+     |
| RAM       | 4 GB free | 8 GB free   |
| Disk      | 20 GB     | 50 GB+      |
| CPU       | 2 cores   | 4+ cores    |

- Docker enabled (**Settings → Docker → Enable Docker: Yes**).
- The **Docker Compose Manager** plugin from Community Applications. The setup
  script uses `docker compose`, or a standalone `docker-compose` binary if that
  is what is installed, and stops if neither exists.
- A root shell on the server (`ssh root@YOUR-UNRAID-IP`).
- **An HTTPS reverse proxy and hostname, set up first** — see below.

### Why HTTPS comes first

The stack runs with `ENVIRONMENT=production`. Auth cookies are therefore
`Secure`, and browsers will not send them over plain `http://`: logins through
`http://YOUR-UNRAID-IP:7880` fail. The setup script requires the public
`https://` URL members will use, writes it to `ALLOWED_ORIGINS` and
`FRONTEND_URL`, and offers no plain-HTTP mode. Configure SWAG or Nginx Proxy
Manager ([HTTPS Reverse Proxy](#https-reverse-proxy)) before running it.

---

## Install

### With the setup script

```bash
ssh root@YOUR-UNRAID-IP
bash <(curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/unraid/unraid-setup.sh)
```

Or from a clone:

```bash
cd /mnt/user/appdata
git clone https://github.com/thegspiro/the-logbook.git
cd the-logbook/unraid
./unraid-setup.sh
```

The script prompts for an option and, on a fresh install, for the public HTTPS
URL (or reads it from `HTTPS_ORIGIN`, e.g.
`HTTPS_ORIGIN=https://logbook.example.org ./unraid-setup.sh`):

| Option | Action                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------- |
| 1      | Fresh installation                                                                                |
| 2      | Update an existing installation — see [Update](#update)                                           |
| 3      | Clean install: moves the existing directory to `the-logbook.old.<timestamp>`, then installs fresh |
| 4      | Uninstall — see [Uninstall](#uninstall)                                                           |

A fresh install:

1. Stops and removes any existing `logbook-*` containers and the
   `the-logbook_logbook-internal` network.
2. Clones the repository to `/mnt/user/appdata/the-logbook`.
3. Creates `mysql/`, `redis/`, `data/`, `uploads/`, `logs/` and
   `/mnt/user/backups/the-logbook`, owned by `nobody:users` (99:100).
4. Writes `.env` (mode `600`) with generated secrets and passwords, the HTTPS
   URL as `ALLOWED_ORIGINS` and `FRONTEND_URL`, `ENVIRONMENT=production`,
   `SECURITY_ENFORCE_HTTPS=true`, `SECURITY_REQUIRE_TLS=false` (the bundled
   MySQL and Redis are plaintext on the internal network), `ENABLE_DOCS=false`,
   ports 7880/7881 and `TZ=America/New_York`.
5. Copies `unraid/docker-compose-unraid.yml` to `docker-compose.yml`.
6. Builds the images with `--no-cache` (5–10 minutes the first time) and
   starts the stack.
7. Checks the containers, the local ports and whether the HTTPS URL answers.

At the end it reminds you to copy `ENCRYPTION_KEY` and `ENCRYPTION_SALT` from
`.env` somewhere other than the server and `/mnt/user/backups` — without them
no backup can be decrypted.

### Manually

```bash
cd /mnt/user/appdata
git clone https://github.com/thegspiro/the-logbook.git
cd the-logbook
cp unraid/docker-compose-unraid.yml docker-compose.yml
cp unraid/.env.example .env
```

Replace every `CHANGE_ME` value in `.env` and set the public origin:

```bash
openssl rand -hex 32   # SECRET_KEY
openssl rand -hex 32   # ENCRYPTION_KEY
openssl rand -hex 16   # ENCRYPTION_SALT
# MYSQL_ROOT_PASSWORD, DB_PASSWORD, REDIS_PASSWORD: strong passwords

ALLOWED_ORIGINS=https://logbook.example.org
FRONTEND_URL=https://logbook.example.org
```

Then create the data directories and start:

```bash
mkdir -p mysql redis data uploads logs /mnt/user/backups/the-logbook
chown -R 99:100 mysql redis data uploads logs /mnt/user/backups/the-logbook
docker compose build
docker compose up -d
```

---

## Verify

```bash
cd /mnt/user/appdata/the-logbook

docker compose ps                       # all containers Up
curl -s http://localhost:7881/health    # {"status":"healthy","ready":true}
docker compose logs --tail=50           # look for ERROR / CRITICAL

# Scripted checks; --diagnose-frontend and --rebuild-frontend are also available
./unraid/validate-deployment.sh http://YOUR-UNRAID-IP:7880 http://YOUR-UNRAID-IP:7881
```

Then open your HTTPS URL and complete the [onboarding wizard](Onboarding).
ClamAV needs a few minutes on first start before uploads are accepted.

---

## Configuration

All settings are in `/mnt/user/appdata/the-logbook/.env`. Apply a change with:

```bash
cd /mnt/user/appdata/the-logbook
docker compose up -d
```

`up -d` recreates the containers whose configuration changed;
`docker compose restart` keeps the old environment. Every backend setting can be
set from `.env`, except `DB_HOST`, `DB_PORT`, `REDIS_HOST`, `REDIS_PORT` and
`PORT`, which stay pinned to the bundled containers. Variable reference:
[Environment Variables](Configuration-Environment).

| Setting                           | Default / note                                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `FRONTEND_PORT`                   | `7880` — web interface                                                                                                         |
| `BACKEND_PORT`                    | `7881` — backend, published for health checks                                                                                  |
| `BIND_ADDRESS`                    | `0.0.0.0` — set `127.0.0.1` (or one host IP) once the proxy works, so LAN clients cannot bypass HTTPS                          |
| `ALLOWED_ORIGINS`, `FRONTEND_URL` | Your public `https://` origin; email links are built from `FRONTEND_URL`                                                       |
| `TRUSTED_PROXY_IPS`               | Empty. Set it to the proxy's address only when a reverse proxy fronts the app; otherwise clients could spoof `X-Forwarded-For` |
| `TZ`                              | `America/New_York` — container clock only; the department's timezone is set in **Settings → Organization → Profile**           |
| `EMAIL_ENABLED`, `SMTP_*`         | Off by default ([Email / SMTP](Configuration-Environment#email--smtp))                                                         |
| `ENABLE_DOCS`                     | `false` — enabling it stops a production backend from starting                                                                 |

---

## HTTPS Reverse Proxy

Forward all traffic for your hostname to `YOUR-UNRAID-IP:7880`. The frontend
container forwards `/api` and `/health` to the backend itself, so no second
upstream is needed. Allow uploads of at least 60 MB.

**SWAG** — create `/mnt/user/appdata/swag/nginx/proxy-confs/logbook.subdomain.conf`:

```nginx
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name logbook.*;

    include /config/nginx/ssl.conf;
    client_max_body_size 60M;

    location / {
        include /config/nginx/proxy.conf;
        proxy_pass http://YOUR-UNRAID-IP:7880;
    }
}
```

Restart SWAG.

**Nginx Proxy Manager** — add a Proxy Host for `logbook.example.org`
forwarding to `YOUR-UNRAID-IP:7880`, enable WebSockets support, and request a
Let's Encrypt certificate.

Then set `ALLOWED_ORIGINS` and `FRONTEND_URL` to the `https://` origin if they
are not already, set `BIND_ADDRESS` if appropriate, and run `docker compose up
-d`.

---

## What Gets Installed

| Container          | Service    | Purpose                                                |
| ------------------ | ---------- | ------------------------------------------------------ |
| `logbook-frontend` | `frontend` | Web interface on `FRONTEND_PORT` (7880)                |
| `logbook-backend`  | `backend`  | FastAPI on `BACKEND_PORT` (7881)                       |
| `logbook-db`       | `db`       | MySQL 8.0, internal only                               |
| `logbook-redis`    | `redis`    | Redis 7, internal only                                 |
| `logbook-clamav`   | `clamav`   | Malware scanner ([memory](Deployment-Docker#services)) |
| `logbook-backup`   | `backup`   | Nightly backups with restore drills                    |

```
/mnt/user/appdata/the-logbook/
├── mysql/      database files
├── redis/      cache data
├── data/       application data
├── uploads/    uploaded files
├── logs/       application logs
└── .env        configuration

/mnt/user/backups/the-logbook/
├── logbook_backup_YYYYmmdd_HHMMSS.tar.gz   nightly sidecar archives (+ .sha256)
└── backup_YYYYmmdd_HHMMSS/                 copies made by setup option 2/3
```

ClamAV's signatures live in the Docker volume `clamav_data`, not under
`appdata`.

---

## Backups and Restore

The `backup` container archives the database and uploads nightly at
`BACKUP_TIME` (container `TZ`) into `/mnt/user/backups/the-logbook/`. Settings,
the restore drill and off-host copies work as described in
[Production → Backup and Recovery](Deployment-Production#backup-and-recovery);
sync the backups share off the array.

```bash
cd /mnt/user/appdata/the-logbook
docker compose logs backup               # sidecar status and drill results

./scripts/backup.sh                      # manual backup, from the install directory
./scripts/backup.sh --list
./scripts/backup.sh --restore /mnt/user/backups/the-logbook/logbook_backup_YYYYmmdd_HHMMSS.tar.gz
docker compose restart
```

---

## Update

Back up first (`./scripts/backup.sh` from the install directory).

**With the setup script** (option 2):

```bash
cd /mnt/user/appdata/the-logbook/unraid
./unraid-setup.sh     # choose 2
```

It stops the containers, copies `mysql/`, `data/`, `uploads/` and `.env` to
`/mnt/user/backups/the-logbook/backup_<timestamp>/`, pulls the code, re-copies
the Unraid compose file, rebuilds and restarts. If the pull fails it prints
"Could not update from git" and rebuilds the code already there — use the
manual update below in that case. It keeps your `.env`, but if
that file still allows plain HTTP (an `http://` origin or `COOKIE_SECURE=false`)
it asks for the HTTPS URL and migrates it; set `ALLOW_INSECURE_HTTP=yes` to
keep the old settings. It stops before restarting anything if `FRONTEND_URL`
still points at `localhost`.

**Manually:**

```bash
cd /mnt/user/appdata/the-logbook

# docker-compose.yml is a copy of the Unraid template over a tracked file;
# restore the tracked file so the pull cannot conflict, then re-copy it
git checkout -- docker-compose.yml
git pull origin main
cp unraid/docker-compose-unraid.yml docker-compose.yml

# Repair the build contexts if a pulled Dockerfile outgrew them; skipping this
# produces '"/frontend/nginx.conf": not found' minutes into the rebuild
./scripts/sync-compose-build-context.sh --fix -f docker-compose.yml

docker compose build --no-cache
docker compose up -d
```

Migrations run when the backend starts. Then [verify](#verify).

**`unraid/update.sh`** is the safe updater for the build-from-source layout
(`unraid/docker-compose-build-from-source.yml` copied to `docker-compose.yml`):
it takes a verified `mysqldump`, fast-forwards the checkout, repairs build
contexts, rebuilds and prints rollback steps on failure. It refuses to run when
`docker-compose.yml` is anything other than that template, so it does not
apply to an install made by `unraid-setup.sh`. Options: `--no-cache`, `-y`,
`--branch <name>`, `--skip-backup`. See
[BUILD-FROM-SOURCE-ON-UNRAID.md](https://github.com/thegspiro/the-logbook/blob/main/unraid/BUILD-FROM-SOURCE-ON-UNRAID.md).

---

## Common Commands

```bash
cd /mnt/user/appdata/the-logbook

docker compose ps                       # status
docker compose logs -f                  # all logs
docker compose logs -f backend          # one service
docker compose restart                  # restart (keeps the old environment)
docker compose up -d                    # start, or apply .env changes
docker compose down                     # stop and remove containers
docker compose build --no-cache && docker compose up -d   # rebuild
docker exec -it logbook-db mysql -u logbook_user -p       # database shell
docker stats --filter name=logbook      # resource usage
```

---

## Troubleshooting

General diagnostics: [Troubleshooting Guide](Troubleshooting).

### Container name already in use

`Error: The container name "/logbook-redis" is already in use`:

```bash
cd /mnt/user/appdata/the-logbook
docker compose down --remove-orphans
docker compose up -d
```

If that is not enough, remove the containers by name and start again:

```bash
docker rm -f logbook-frontend logbook-backend logbook-db logbook-redis logbook-clamav logbook-backup
docker compose up -d
```

Setup option 2 also clears old containers before rebuilding.

### Port conflicts

```bash
netstat -tuln | grep 7880
```

Change `FRONTEND_PORT` / `BACKEND_PORT` in `.env`, point the reverse proxy at
the new port, then `docker compose up -d`.

### Logins fail

Browser access must go through the HTTPS URL. Check that `ALLOWED_ORIGINS`
and `FRONTEND_URL` are exactly that origin and that `.env` has no
`COOKIE_SECURE=false` line.

### Frontend not loading

```bash
docker compose logs frontend
docker compose build --no-cache frontend && docker compose up -d frontend
./unraid/validate-deployment.sh --diagnose-frontend
```

### Backend errors

```bash
curl -s http://localhost:7881/health
docker compose logs backend
```

A `CRITICAL:` line at startup names the setting that blocked the boot — see
[Production → Startup Security Gate](Deployment-Production#startup-security-gate).

### Database

```bash
docker compose logs db
docker exec -it logbook-db mysql -u logbook_user -p
```

### Docker not running

```bash
/etc/rc.d/rc.docker start
```

### Full rebuild

```bash
cd /mnt/user/appdata/the-logbook
docker compose down
docker system prune -a      # removes ALL unused images on the server
docker compose build --no-cache
docker compose up -d
```

---

## Uninstall

```bash
cd /mnt/user/appdata/the-logbook/unraid
./unraid-setup.sh     # choose 4
```

| Sub-option | Removes                                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1          | Containers and networks; data stays in `/mnt/user/appdata/the-logbook` for a reinstall                                                                                          |
| 2          | Also the images and the `mysql/`, `redis/`, `data/`, `uploads/` and `logs/` directories, after saving a final copy to `/mnt/user/backups/the-logbook/backup_final_<timestamp>/` |

To remove everything afterwards, including the checkout, `.env` and backups:

```bash
rm -rf /mnt/user/appdata/the-logbook /mnt/user/backups/the-logbook
docker volume rm the-logbook_clamav_data
```

---

## Getting Help

- [GitHub Issues](https://github.com/thegspiro/the-logbook/issues) — include
  your Unraid version, `docker compose logs --tail=50` and steps to reproduce
- [Unraid Community Forums](https://forums.unraid.net/) — Docker Containers
  section
