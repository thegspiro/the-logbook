# Unraid Setup Guide

Complete guide for installing and running The Logbook on Unraid.

> **This is the canonical Unraid guide** for the Docker Compose deployment —
> the supported install path today. The condensed
> [Quick Start](../../unraid/QUICK-START.md) and the wiki pages defer to this
> document; the separate [UNRAID-INSTALLATION.md](../../unraid/UNRAID-INSTALLATION.md)
> covers the Community Applications template, which is not yet published to
> the CA catalog.

## Table of Contents

- [Requirements](#requirements)
- [Installation](#installation)
  - [Automated Install (Recommended)](#automated-install-recommended)
  - [Manual Install](#manual-install)
- [Post-Install Setup](#post-install-setup)
- [Configuration](#configuration)
- [HTTPS with Reverse Proxy](#https-with-reverse-proxy)
- [Backup and Restore](#backup-and-restore)
- [Updating](#updating)
- [Performance](#performance)
- [Troubleshooting](#troubleshooting)
- [Common Commands](#common-commands)

---

## Requirements

| Component | Minimum   | Recommended |
| --------- | --------- | ----------- |
| Unraid    | 6.9.0+    | 6.12.0+     |
| RAM       | 4 GB free | 8 GB free   |
| Disk      | 20 GB     | 50 GB+      |
| CPU       | 2 cores   | 4+ cores    |

Docker must be enabled on your Unraid server (Settings > Docker > Enable
Docker: Yes), and Docker Compose must be available — install the **Docker
Compose Manager** plugin from Community Applications (Apps tab), which
provides the `docker compose` command. The setup script detects either
`docker compose` (v2) or a legacy standalone `docker-compose` binary.

---

## Installation

### Automated Install (Recommended)

SSH into your Unraid server and run the setup script:

```bash
ssh root@YOUR-UNRAID-IP

curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/unraid/unraid-setup.sh | bash
```

The script will:

- Clone the repository to `/mnt/user/appdata/the-logbook`
- Generate secure passwords and encryption keys
- Create the directory structure with correct Unraid permissions
- Build and start all containers (frontend, backend, MySQL, Redis, nightly backup sidecar)
- Verify the deployment

When prompted, choose:

- **1** for a fresh installation
- **2** to update an existing installation
- **3** for a clean install (removes all data)

### Manual Install

```bash
ssh root@YOUR-UNRAID-IP

# Clone the repository
cd /mnt/user/appdata
git clone https://github.com/thegspiro/the-logbook.git
cd the-logbook

# Copy the Unraid-specific docker-compose file
cp unraid/docker-compose-unraid.yml docker-compose.yml

# Create environment file
cp unraid/.env.example .env
```

Generate and set security keys:

```bash
# Generate keys
openssl rand -hex 32   # Use for SECRET_KEY
openssl rand -hex 32   # Use for ENCRYPTION_KEY
openssl rand -hex 16   # Use for ENCRYPTION_SALT

# Edit .env with the generated values
nano .env
```

Required `.env` values to change:

```bash
SECRET_KEY=<paste generated value>
ENCRYPTION_KEY=<paste generated value>
ENCRYPTION_SALT=<paste generated value>
MYSQL_ROOT_PASSWORD=<strong password>
DB_PASSWORD=<strong password>
REDIS_PASSWORD=<strong password>
# The public HTTPS URL of your reverse proxy (see "HTTPS with Reverse
# Proxy" below). Production marks auth cookies Secure, and browsers refuse
# to send Secure cookies over plain http:// — so logins only work through
# the HTTPS origin named here.
ALLOWED_ORIGINS=https://logbook.example.com
TZ=America/New_York  # Your timezone
```

Create directories and start:

```bash
mkdir -p mysql redis data uploads logs
mkdir -p /mnt/user/backups/the-logbook
chown -R 99:100 mysql redis data uploads logs

docker compose build
docker compose up -d
```

---

## Post-Install Setup

Once the containers are running, open your browser:

- **Frontend:** your public HTTPS URL (e.g. `https://logbook.example.com`) —
  browser access must go through the reverse proxy; logins over the plain-HTTP
  port fail because auth cookies are marked `Secure`
- **Health Check:** `http://YOUR-UNRAID-IP:7881/health`
- **API Docs:** `http://YOUR-UNRAID-IP:7881/docs` — **off by default** (the
  production security gate blocks startup with docs enabled). Set
  `ENABLE_DOCS=true` only to view them temporarily on a trusted network.

Complete the onboarding wizard to configure your organization, create the admin account, and enable the modules you need.

---

## Configuration

All settings live in `/mnt/user/appdata/the-logbook/.env`. After editing, restart with:

```bash
cd /mnt/user/appdata/the-logbook
docker compose restart
```

### Ports

| Service     | Default Port    | Purpose                        |
| ----------- | --------------- | ------------------------------ |
| Frontend    | 7880            | Web interface                  |
| Backend API | 7881            | API endpoint                   |
| MySQL       | 3306 (internal) | Database (not exposed to host) |
| Redis       | 6379 (internal) | Cache (not exposed to host)    |

To change ports, edit `FRONTEND_PORT` and `BACKEND_PORT` in `.env` and update `ALLOWED_ORIGINS` to match.

### Modules

Modules are enabled or disabled per organization from inside the app, under Organization/Admin Settings > Modules (`enabled_modules`) — not through `.env`. All API routers register unconditionally, so there are no deployment-level module flags to set here.

### Email Notifications

```bash
EMAIL_ENABLED=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM_EMAIL=noreply@yourdomain.com
```

### Data Directories

```
/mnt/user/appdata/the-logbook/
  mysql/       Database files
  redis/       Cache data
  data/        Application data
  uploads/     User-uploaded files
  logs/        Application logs
  .env         Configuration

/mnt/user/backups/the-logbook/
               Automated backups
```

---

## HTTPS with Reverse Proxy

> **Required for real use — logins depend on it.** Two separate mechanisms are
> at work:
>
> 1. **The startup gate.** The Unraid compose runs with
>    `ENVIRONMENT=production`, and the app refuses to boot unless strong
>    secrets are set, `DEBUG=false`, API docs are disabled, and
>    `SECURITY_ENFORCE_HTTPS=true`.
> 2. **Secure cookies.** In production the app marks auth cookies `Secure`,
>    and browsers refuse to send `Secure` cookies over plain `http://` — so
>    without HTTPS, **logins fail silently** even on a booted stack.
>
> The setup script therefore **requires the public HTTPS URL of a reverse
> proxy** before it will generate `.env`, writes it into `ALLOWED_ORIGINS`,
> and never disables secure cookies — there is no plain-HTTP trial mode,
> because session cookies over cleartext HTTP are readable by anyone on the
> network path. Set the proxy up first (either option below), then run the
> installer. Two related settings: **API docs (`/docs`) are OFF by default**
> (enabling them blocks boot), and **leave `TRUSTED_PROXY_IPS` empty** unless
> you actually add a proxy — the compose publishes the backend port directly,
> so the connecting peer is the real client, and setting it otherwise lets
> clients spoof `X-Forwarded-For`.

### Using Swag

1. Install Swag from Community Apps.
2. Create `/mnt/user/appdata/swag/nginx/proxy-confs/logbook.subdomain.conf`:

```nginx
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name logbook.*;

    include /config/nginx/ssl.conf;

    location / {
        include /config/nginx/proxy.conf;
        proxy_pass http://YOUR-UNRAID-IP:7880;
    }

    location /api {
        include /config/nginx/proxy.conf;
        proxy_pass http://YOUR-UNRAID-IP:7881;
    }
}
```

3. Restart Swag. Access at `https://logbook.yourdomain.com`.

### Using Nginx Proxy Manager

1. Add a Proxy Host.
2. Domain: `logbook.yourdomain.com`
3. Forward to: `YOUR-UNRAID-IP:7880`
4. Enable SSL with Let's Encrypt.

---

## Backup and Restore

### Automated Backups

The Unraid compose file includes a `backup` sidecar service that runs a
nightly `mysqldump` + uploads archive at `BACKUP_TIME` (default 02:00, in the
container's `TZ`), writing `logbook_backup_TIMESTAMP.tar.gz` archives directly
to `/mnt/user/backups/the-logbook/`. There is no on/off env flag — backups run
whenever that service is up.

Configure in `.env`:

```bash
BACKUP_TIME=02:00            # Daily run time, UTC HH:MM
BACKUP_RETENTION_DAYS=30     # Prune archives older than this
VERIFY_EVERY_N_BACKUPS=7     # Automated restore-drill cadence; 0 disables
```

Every seventh backup runs an automated restore drill: the fresh dump is loaded
into a throwaway schema, verified, and dropped. Check `docker compose logs
backup` — a failed drill repeats loudly every night until fixed. Remember to
sync the backups share off the array, and keep
`ENCRYPTION_KEY`/`ENCRYPTION_SALT` somewhere separate: a backup without its
era's keys cannot decrypt encrypted fields. _(2026-07-31)_

### Manual Backup

`backup.sh` is a host-side script (it is not shipped inside the backend
image) — run it from the install directory:

```bash
cd /mnt/user/appdata/the-logbook
./scripts/backup.sh
```

### Restore

```bash
cd /mnt/user/appdata/the-logbook

# List available archives
./scripts/backup.sh --list
ls -lh /mnt/user/backups/the-logbook/

# Restore (verifies the checksum, then restores database + uploads)
./scripts/backup.sh --restore /mnt/user/backups/the-logbook/logbook_backup_TIMESTAMP.tar.gz

docker compose restart
```

To restore the database by hand instead, extract the archive and pipe the dump
through the DB container (MySQL's port is not published to the host):

```bash
tar -xzf logbook_backup_TIMESTAMP.tar.gz
gunzip < logbook_backup_TIMESTAMP/database.sql.gz | \
  docker exec -i logbook-db mysql -u logbook_user -p the_logbook
```

---

## Updating

### Using the Setup Script

```bash
cd /mnt/user/appdata/the-logbook/unraid
./unraid-setup.sh
# Choose option 2 (Update)
```

### Manual Update

```bash
cd /mnt/user/appdata/the-logbook
git pull origin main

# Reconcile the compose build contexts with the Dockerfiles that were just
# pulled. Skipping this is what produces `"/frontend/nginx.conf": not found`
# minutes into the rebuild, with the stack already down.
./scripts/sync-compose-build-context.sh --fix -f docker-compose.yml

docker compose down
docker compose build --no-cache
docker compose up -d
```

> **Why the extra step:** a pull can change what a Dockerfile copies out of its
> build context, and `docker compose config` never opens the Dockerfile — so a
> stale context passes validation and fails the build. If you maintain your own
> compose file (custom volume paths, service names, pinned tags), the pull does
> not correct it for you. `./unraid/update.sh` runs this automatically.

Back up before updating:

```bash
./scripts/backup.sh   # host-side script, run from the install directory
```

---

## Performance

### Resource Limits

To cap container resource usage on a busy Unraid server, add under each
service in `docker-compose.yml`:

```yaml
deploy:
  resources:
    limits:
      cpus: "2"
      memory: 2G
    reservations:
      cpus: "1"
      memory: 512M
```

### Database

The Unraid compose file already tunes MySQL: 512MB buffer pool, UTF8MB4
encoding, 200 max connections, 256MB max packet size.

---

## Troubleshooting

### Container Conflicts

If you see `Error: The container name "/logbook-redis" is already in use`:

```bash
cd /mnt/user/appdata/the-logbook
docker compose down --remove-orphans
docker compose up -d
```

Or remove containers manually:

```bash
docker stop logbook-frontend logbook-backend logbook-db logbook-redis 2>/dev/null
docker rm -f logbook-frontend logbook-backend logbook-db logbook-redis 2>/dev/null
docker compose up -d
```

### Port Conflicts

```bash
# Check what is using a port
netstat -tuln | grep 7880

# Change ports in .env
nano /mnt/user/appdata/the-logbook/.env
# Update FRONTEND_PORT, BACKEND_PORT, and ALLOWED_ORIGINS

docker compose down
docker compose up -d
```

### Frontend Not Loading

```bash
docker ps | grep logbook-frontend
docker compose logs frontend

# Rebuild if needed
docker compose build --no-cache frontend
docker compose up -d frontend
```

### Backend Errors

```bash
curl http://localhost:7881/health
docker compose logs backend
docker compose restart backend
```

### Database Connection Issues

```bash
docker ps | grep logbook-db
docker compose logs db

# Access the database directly
docker exec -it logbook-db mysql -u logbook_user -p
```

If the database does not exist:

```sql
CREATE DATABASE the_logbook CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'logbook_user'@'%' IDENTIFIED BY 'your_password';
GRANT ALL PRIVILEGES ON the_logbook.* TO 'logbook_user'@'%';
FLUSH PRIVILEGES;
```

### Docker Not Running

```bash
/etc/rc.d/rc.docker start
```

### Full Rebuild

```bash
cd /mnt/user/appdata/the-logbook
docker compose down
docker system prune -a
docker compose build --no-cache
docker compose up -d
```

---

## Common Commands

```bash
cd /mnt/user/appdata/the-logbook

# Status
docker compose ps

# Logs (all services)
docker compose logs -f

# Logs (single service)
docker compose logs -f backend

# Restart
docker compose restart

# Stop
docker compose down

# Start
docker compose up -d

# Rebuild
docker compose build --no-cache && docker compose up -d

# Database shell
docker exec -it logbook-db mysql -u logbook_user -p

# Resource usage
docker stats --filter name=logbook
```

---

## More Information

- [Unraid Quick Start](../../unraid/QUICK-START.md) - condensed setup steps
- [Unraid Docker Compose](../../unraid/docker-compose-unraid.yml) - the Unraid-optimized compose file
- [Full Installation Guide](../../unraid/UNRAID-INSTALLATION.md) - Community Apps template details
- [Main README](../../README.md) - project overview
- [GitHub Issues](https://github.com/thegspiro/the-logbook/issues) - bug reports and support
