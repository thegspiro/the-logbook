# Docker Deployment

Install and operate The Logbook with Docker Compose on Linux, macOS or Windows
(WSL2). Unraid has its own compose file and scripts — see
[Unraid Deployment](Deployment-Unraid). HTTPS, backups, monitoring and cloud
hosting are on [Production Deployment](Deployment-Production).

---

## Requirements

- Docker Engine with the Compose plugin, **Compose v2.24.4 or later**
  (`docker compose version`). The production override uses `!override` and
  `!reset`, which older Compose rejects — upgrade Compose rather than editing
  the tags out.
- 4 GB RAM; the floor is set by ClamAV — see [Memory Profiles](#memory-profiles).
- Git, and OpenSSL for generating secrets.

---

## Compose Files

The stack is assembled from a base file plus overrides. Always run `docker
compose` from the repository root.

| File                                   | Purpose                                                                                                                            |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `docker-compose.yml`                   | Base. On its own it is a **development** configuration: `uvicorn --reload`, source bind mount, backend port published, API docs on |
| `docker-compose.prod.yml`              | Production override: backend production image, no `--reload`, docs off, backend port unpublished, backup sidecar                   |
| `docker-compose.proxy.yml`             | Bundled nginx as the only entrance; stops publishing the frontend port                                                             |
| `docker-compose.external-services.yml` | Use a MySQL and Redis outside the stack                                                                                            |
| `docker-compose.minimal.yml`           | Lower memory limits for small hosts                                                                                                |
| `docker-compose.arm.yml`               | ARM64 platform; MariaDB 10.11 in place of MySQL                                                                                    |

Pin the files a deployment uses in `.env` so every bare `docker compose ...`
command applies them:

```bash
COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml
```

Both installers write this line. What the production override enforces at
startup is described in
[Production → Startup Security Gate](Deployment-Production#startup-security-gate).

---

## Install with a Script

### Universal installer

For Debian/Ubuntu/Raspberry Pi OS, Fedora/RHEL/Rocky/Alma/Amazon Linux, Alpine,
Arch, macOS and WSL2, on x86_64, ARM64 or ARMv7. It has no interactive prompts,
so it can be piped to `bash`:

```bash
curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/scripts/universal-install.sh \
  | bash -s -- --public-url https://logbook.example.org --dir "$HOME/the-logbook"
```

| Option               | Effect                                                                                                                                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--public-url <url>` | Required. Written to `FRONTEND_URL`. Also read from `LOGBOOK_PUBLIC_URL`. Must start with `http://` or `https://`; `localhost`/`127.*` is refused. May be omitted only when an existing `.env` already has a public `FRONTEND_URL` |
| `--dir <path>`       | Install directory. Default: the current directory, which must be empty or an existing checkout                                                                                                                                     |
| `--profile <name>`   | `minimal`, `standard` (default), `full` or `auto` — see below                                                                                                                                                                      |
| `--arm`              | Force ARM handling (normally detected)                                                                                                                                                                                             |
| `--no-docker`        | Do not install Docker                                                                                                                                                                                                              |
| `--help`             | Show usage                                                                                                                                                                                                                         |

What it does:

1. Installs Docker and the Compose plugin if `docker compose` is missing
   (Homebrew's Docker Desktop on macOS — start it, then re-run), and Git.
2. Clones the repository into `--dir`, or pulls it if a checkout is there.
3. Writes `.env` (mode `600`) with generated secrets, `ENVIRONMENT=production`,
   the `COMPOSE_FILE` pin above, `SECURITY_REQUIRE_TLS=false` for the bundled
   plaintext MySQL/Redis, `FRONTEND_URL`, `ALLOWED_ORIGINS` (the origin of
   `--public-url`, e.g. `https://logbook.example.org`) and `TZ` (your shell's,
   or `UTC`). An existing `.env` is kept: the installer only appends a missing
   `COMPOSE_FILE`, fills in a missing or `localhost` `FRONTEND_URL`, and adds
   the `FRONTEND_URL` origin to `ALLOWED_ORIGINS` when that list names only
   `localhost` addresses. A list that already has a public address is left
   alone.
4. Builds and starts the base and production files (plus
   `docker-compose.proxy.yml` when `.env` pins it — and stops first if the
   certificate it needs is missing), then runs `alembic upgrade head`.

Profiles:

| Profile    | Effect                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| `minimal`  | Writes smaller MySQL/Redis tuning values to `.env`                                                     |
| `standard` | Default tuning values                                                                                  |
| `full`     | Larger tuning values, and also starts the `with-search` (Elasticsearch) and `with-s3` (MinIO) profiles |
| `auto`     | Picks by RAM: under 2 GB `minimal`, under 6 GB `standard`, otherwise `full`                            |

The tuning values (`MYSQL_BUFFER_POOL_SIZE`, `MYSQL_MAX_CONNECTIONS`) are read
only by `docker-compose.arm.yml`; the installer does not apply
`docker-compose.minimal.yml` or `docker-compose.arm.yml`. To use them, pin them
in `COMPOSE_FILE` after installing (see [Memory Profiles](#memory-profiles) and
[ARM and Raspberry Pi](#arm-and-raspberry-pi)).

**Finish the install:**

1. Put an HTTPS reverse proxy in front of port 3000 —
   [Production → HTTPS and Reverse Proxy](Deployment-Production#https-and-reverse-proxy).
2. If members will reach the site at an address other than `--public-url`
   (another hostname, or `https://` where you gave `http://`), set
   `FRONTEND_URL` and `ALLOWED_ORIGINS` in `.env` to it and run
   `docker compose up -d`. The backend only answers requests addressed to a
   hostname in `ALLOWED_ORIGINS` (plus `localhost`).
3. Log out and back in if the installer added you to the `docker` group.

If the installer ends with "Services may still be starting", check
`curl -s http://localhost:3000/health` and `docker compose ps`; the first build
and ClamAV's first signature download take several minutes.

### install.sh (Ubuntu/Debian)

Run from a clone, as a regular user with `sudo` (it refuses to run as root):

```bash
git clone https://github.com/thegspiro/the-logbook.git
cd the-logbook
./install.sh --docker --public-url https://logbook.example.org
```

It installs Docker, copies `.env.example` to `.env` with generated secrets,
`ENVIRONMENT=production`, the `COMPOSE_FILE` pin and
`SECURITY_REQUIRE_TLS=false`, then builds, starts and migrates the production
stack. Without `--public-url` (or `LOGBOOK_PUBLIC_URL`) it asks when run from a
terminal. Run with no arguments for an interactive menu.

Unlike the universal installer, `install.sh` leaves `ALLOWED_ORIGINS` at the
`localhost` values from `.env.example`. Set it in `.env` to the same public
origin as `FRONTEND_URL` and run `docker compose up -d`: the backend derives
both its CORS list and its Host-header allowlist from this value, so requests
addressed to your public hostname are rejected until it is set. Then add the
HTTPS reverse proxy as above.

`./install.sh --traditional` installs MySQL, Redis, nginx and the backend
directly on the host under systemd instead of Docker. It needs Python 3.13 or
newer (Debian 13, Ubuntu 25.04+, or installed beforehand) and stops before
installing anything if it cannot find one; see
[DEPLOYMENT.md → Traditional Server Deployment](https://github.com/thegspiro/the-logbook/blob/main/docs/DEPLOYMENT.md#option-2-traditional-server-deployment).

---

## Install Manually

```bash
git clone https://github.com/thegspiro/the-logbook.git
cd the-logbook
cp .env.example .env
```

Replace every `CHANGE_ME` value in `.env`:

```bash
openssl rand -hex 32   # SECRET_KEY
openssl rand -hex 32   # ENCRYPTION_KEY
openssl rand -hex 16   # ENCRYPTION_SALT
openssl rand -base64 24 | tr -d '=+/'   # MYSQL_ROOT_PASSWORD, DB_PASSWORD, REDIS_PASSWORD (one each)
```

**Local trial (development configuration):**

```bash
docker compose up -d
```

Frontend `http://localhost:3000`, backend `http://localhost:3001`, API docs
`http://localhost:3001/docs`.

**Production:** also set these in `.env`, then start:

```bash
ENVIRONMENT=production
DEBUG=false
ENABLE_DOCS=false
ALLOWED_ORIGINS=https://logbook.example.org
FRONTEND_URL=https://logbook.example.org
# The bundled MySQL and Redis do not terminate TLS; the production override
# requires TLS to both unless this records the decision
SECURITY_REQUIRE_TLS=false
COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml
```

```bash
docker compose up -d --build
docker compose ps
curl -s http://localhost:3000/health
```

The backend is not published in production; the frontend's nginx forwards
`/api` and `/health` to it. Put HTTPS in front of port 3000 —
[Production → HTTPS and Reverse Proxy](Deployment-Production#https-and-reverse-proxy).
The backend applies database migrations itself when it starts.

---

## Configuration

### Environment templates

| Template            | Contents                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `.env.example`      | About 40 variables: secrets, database, Redis, CORS, `FRONTEND_URL`, ports, timezone, email. Defaults to `ENVIRONMENT=development`    |
| `.env.example.full` | About 180 variables: adds storage, SSO, SMS, HIPAA and security tuning, and development tools. Defaults to `ENVIRONMENT=development` |

Start from `.env.example` and copy individual settings from
`.env.example.full` as needed. Do not copy `.env.example.full` wholesale for
the bundled stack: its `DB_HOST=localhost` is ignored there (see below), and
would point the backend at its own container if you later add the
external-services override. Every variable is described in
[Environment Variables](Configuration-Environment); check a configuration
before restarting with the
[preflight command](Configuration-Environment#check-the-configuration-before-you-restart-2026-08-18).

### How `.env` reaches the backend

`.env` is read by Docker Compose, not copied into the image. Compose passes the
backend the variables named in the backend service's `environment:` block,
which lists every backend setting with the application's default, so any
backend setting can be set from `.env`.

Exceptions pinned by the compose file: `DB_HOST`, `DB_PORT`, `REDIS_HOST` and
`REDIS_PORT` always point at the bundled `mysql` and `redis` services (use the
[external-services override](#external-database-and-redis) to change them),
and `docker-compose.prod.yml` fixes `ENVIRONMENT`, `DEBUG`, `ENABLE_DOCS` and
`SECURITY_ENFORCE_HTTPS`. Variables that are not backend settings
(`MYSQL_ROOT_PASSWORD`, `MINIO_*`, `ELASTIC_PASSWORD`) go only to their own
services.

Apply a change with `docker compose up -d`, which recreates the containers
whose configuration changed. `docker compose restart` keeps the old
environment. To see what a service will receive:

```bash
docker compose config | grep SMTP_HOST
```

### Frontend build settings

`VITE_API_URL` is passed as a build argument (`/api/v1`) in
`docker-compose.yml`; Vite bakes it into the bundle, so a change needs
`docker compose build frontend`. No `frontend/.env` is needed for Docker.

---

## Services

| Service    | Container           | Port                                    | Notes                                                |
| ---------- | ------------------- | --------------------------------------- | ---------------------------------------------------- |
| `frontend` | `intranet-frontend` | `FRONTEND_PORT` (3000) → 80             | nginx; serves the app, forwards `/api` and `/health` |
| `backend`  | `intranet-backend`  | `BACKEND_PORT` (3001), development only | FastAPI; not published with the production override  |
| `mysql`    | `intranet-mysql`    | internal                                | MySQL 8.0                                            |
| `redis`    | `intranet-redis`    | internal                                | Redis 7, password required                           |
| `clamav`   | `intranet-clamav`   | internal (3310)                         | Malware scanner, always started                      |
| `backup`   | (Compose default)   | —                                       | Production override only; nightly backups            |

Optional services, started by profile (`docker compose --profile <name> up -d`):

| Service         | Profile       | Notes                                                                                                                                           |
| --------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `nginx`         | `production`  | TLS on `NGINX_HTTP_PORT`/`NGINX_HTTPS_PORT` (80/443); prefer `docker-compose.proxy.yml` — see [Production](Deployment-Production#bundled-nginx) |
| `elasticsearch` | `with-search` | No backend setting connects to it; needs `ELASTIC_PASSWORD`                                                                                     |
| `minio`         | `with-s3`     | S3-compatible storage; set `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD`                                                                          |
| `mailhog`       | `development` | Mail catcher; UI on `127.0.0.1:8025`, SMTP on `127.0.0.1:1025`                                                                                  |

**ClamAV** scans every upload before it is stored. It needs 1.5–3 GB of RAM,
keeps signatures in the `clamav_data` volume and takes a few minutes to become
healthy on first start; until then uploads get a retryable 503. Configuration
and the consequences of `CLAMAV_ENABLED=false`:
[Security Configuration → Malware scanning](Configuration-Security#malware-scanning-of-uploads).

Named volumes (prefixed with the Compose project name, by default the
directory name, e.g. `the-logbook_uploads`): `mysql_data`, `redis_data`,
`uploads`, `clamav_data`; with the production override also `backups` and
`audit_archives`.

---

## Common Operations

```bash
docker compose up -d                 # start, or apply .env changes
docker compose down                  # stop and remove containers (volumes kept)
docker compose restart backend       # restart one service
docker compose ps                    # status

docker compose logs -f               # follow all logs
docker compose logs --tail=50 backend

docker compose up -d --build         # rebuild images and recreate
docker compose exec backend alembic upgrade head   # migrations by hand (normally run at startup)
```

Backups: [Production → Backup and Recovery](Deployment-Production#backup-and-recovery).

---

## Updating

Back up first ([Production → Backup and Recovery](Deployment-Production#backup-and-recovery)),
then from the install directory:

```bash
git pull

# Repair compose build contexts if a pulled Dockerfile now copies files from
# outside them. `docker compose config` never opens the Dockerfile, so a stale
# context passes validation and fails the build. Needed mainly when you run
# your own compose file; drop --fix to report without changing anything.
./scripts/sync-compose-build-context.sh --fix -f docker-compose.yml

docker compose up -d --build
docker compose ps
```

The backend runs pending migrations when it starts. For a production
deployment, also run the preflight check before the restart —
[Production → Updating in Production](Deployment-Production#updating-in-production).

---

## Memory Profiles

Memory limits set in the compose files (`deploy.resources.limits`):

| Service    | Base                           | With `docker-compose.minimal.yml`       |
| ---------- | ------------------------------ | --------------------------------------- |
| `mysql`    | 1024 MB                        | 256 MB                                  |
| `backend`  | 768 MB                         | 384 MB (single worker)                  |
| `redis`    | 128 MB                         | 96 MB (64 MB maxmemory, no persistence) |
| `frontend` | 128 MB                         | 128 MB                                  |
| `clamav`   | no limit, 1.5–3 GB in practice | unchanged                               |

The minimal override shrinks the application to about 1 GB, but ClamAV is
unchanged, so plan for at least 3 GB in total. To use it in production:

```bash
COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml:docker-compose.minimal.yml
```

---

## ARM and Raspberry Pi

`docker-compose.arm.yml` builds and runs every service for `linux/arm64` and
replaces MySQL with MariaDB 10.11 (tuned by `MYSQL_BUFFER_POOL_SIZE`, default
256M, and `MYSQL_MAX_CONNECTIONS`, default 100). It suits Raspberry Pi 4/5,
Apple Silicon and AWS Graviton.

Raspberry Pi: use a Pi 4 or 5 with 4 GB or more, a **64-bit** OS and, ideally,
a USB 3 SSD instead of the SD card. The overrides target `linux/arm64`, and the
ClamAV image is not published for 32-bit ARM.

```bash
git clone https://github.com/thegspiro/the-logbook.git
cd the-logbook
cp .env.example .env    # complete it as in "Install Manually"

# in .env:
COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml:docker-compose.minimal.yml:docker-compose.arm.yml

docker compose up -d --build
```

Drop `docker-compose.minimal.yml` on an 8 GB board.

---

## External Database and Redis

To use a MySQL and Redis this stack does not start — Amazon RDS and
ElastiCache, another managed service, or servers elsewhere on your network —
layer `docker-compose.external-services.yml` last (after
`docker-compose.proxy.yml` if you use it):

```bash
COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml:docker-compose.external-services.yml
```

The override:

- passes `DB_HOST`, `DB_PORT`, `REDIS_HOST` and `REDIS_PORT` from `.env` to
  the backend, with no defaults — a missing one stops `docker compose` with a
  message naming it. Set the real endpoints: `localhost`, `mysql` or `redis`
  would name the backend's own container or services that no longer start;
- drops the backend's dependency on the bundled `mysql` and `redis`;
- keeps `mysql`, `redis` and the production `backup` sidecar from starting.
  Never start them by name (`docker compose up -d mysql`). Back the database up
  with the provider's backups, and the `uploads` and `audit_archives` volumes
  separately ([AWS guide → Backups](https://github.com/thegspiro/the-logbook/blob/main/docs/deployment/aws.md#method-2-rds)).

`MYSQL_ROOT_PASSWORD` still needs a value, because Compose reads the unused
`mysql` definition. `REDIS_PASSWORD` is sent to the external Redis, so it must
require one (an AUTH token on ElastiCache). Use TLS to both: `DB_SSL=true`,
`REDIS_SSL=true`, `SECURITY_REQUIRE_TLS=true`, and CA files `DB_SSL_CA` /
`REDIS_SSL_CA` given as container paths under `/etc/ssl/logbook`, which mounts
`./infrastructure/certs` (or `SSL_CERTS_DIR`). The backend migrates the
external database on start with the same TLS settings.

Check what will start with `docker compose config --services`: `backend`,
`frontend` and `clamav`, plus `nginx` if you use the proxy override.

Full AWS walkthrough:
[AWS Deployment Guide, Method 2](https://github.com/thegspiro/the-logbook/blob/main/docs/deployment/aws.md#method-2-ec2--rds--elasticache-production).

---

## Docker Image Publishing

To build and push images to GitHub Container Registry, log in with a token
that has `write:packages`, then use the script (optional tag argument, default
`latest`):

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u thegspiro --password-stdin
./scripts/build-and-push-images.sh [tag]
```

or build each image by hand, from the repository root:

```bash
docker build --target production -t ghcr.io/thegspiro/the-logbook-backend:latest ./backend
# The frontend's build context is the repository root (it needs the workspace lockfile)
docker build -f frontend/Dockerfile --target production -t ghcr.io/thegspiro/the-logbook-frontend:latest .
docker push ghcr.io/thegspiro/the-logbook-backend:latest
docker push ghcr.io/thegspiro/the-logbook-frontend:latest
```

Full procedure, including making the packages public:
[DOCKER-BUILD-PUBLISH.md](https://github.com/thegspiro/the-logbook/blob/main/docs/DOCKER-BUILD-PUBLISH.md).

---

**See also:** [Installation](Installation) | [Unraid Deployment](Deployment-Unraid) | [Production Deployment](Deployment-Production) | [Environment Variables](Configuration-Environment)
