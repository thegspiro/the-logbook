# 🚀 The Logbook - Unraid Quick Start

> **Canonical source.** A condensed copy of this guide is published to the
> GitHub Wiki from [`wiki/Unraid-Quick-Start.md`](../wiki/Unraid-Quick-Start.md).
> The two are not synced automatically — if you change this file, update the
> wiki page too.

## One-Line Installation

SSH into your Unraid server and run:

```bash
curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/unraid/unraid-setup.sh | bash
```

That's it! The script will:

- ✅ Clean up any existing containers (fixes the conflict error)
- ✅ Clone the repository
- ✅ Generate secure passwords
- ✅ Build and start all containers
- ✅ Verify deployment

## Manual Installation (Step by Step)

### 1. SSH into Unraid

```bash
ssh root@YOUR-UNRAID-IP
```

### 2. Clone Repository

```bash
cd /mnt/user/appdata
git clone https://github.com/thegspiro/the-logbook.git
cd the-logbook
```

### 3. Run Setup Script

```bash
cd unraid
chmod +x unraid-setup.sh
./unraid-setup.sh
```

Choose option:

- **1** - Fresh Installation (recommended for first time)
- **2** - Update Existing Installation
- **3** - Clean Install (removes all data)

### 4. Access Application

Open browser: `http://YOUR-UNRAID-IP:7880`

---

## Fixing Container Conflicts

If you get the error:

```
Error: The container name "/logbook-redis" is already in use
```

**Quick Fix:**

```bash
cd /mnt/user/appdata/the-logbook
docker-compose down --remove-orphans
docker-compose up -d
```

**Or use the cleanup script:**

```bash
cd /mnt/user/appdata/the-logbook/unraid
./unraid-setup.sh
# Choose option 2 (Update)
```

---

## Manual Cleanup (if needed)

```bash
# Stop all containers
docker stop logbook-frontend logbook-backend logbook-db logbook-redis 2>/dev/null || true

# Remove all containers
docker rm -f logbook-frontend logbook-backend logbook-db logbook-redis 2>/dev/null || true

# Remove network
docker network rm the-logbook_logbook-internal 2>/dev/null || true

# Now rebuild
cd /mnt/user/appdata/the-logbook
docker-compose build --no-cache
docker-compose up -d
```

---

## What's Included

The setup script automatically:

### 🔐 Security

- Generates unique `SECRET_KEY` and `ENCRYPTION_KEY`
- Creates strong database passwords
- Sets proper Unraid permissions (nobody:users)

### 📦 Containers

- **Frontend** - React/Vite app (Port 7880)
- **Backend** - FastAPI (Port 7881)
- **Database** - MySQL 8.0
- **Cache** - Redis 7

### 📁 Directory Structure

```
/mnt/user/appdata/the-logbook/
├── mysql/           # Database files
├── redis/           # Cache data
├── data/            # Application data
├── uploads/         # File uploads
├── logs/            # Application logs
└── .env             # Configuration (auto-generated)

/mnt/user/backups/the-logbook/
└── backup_YYYYMMDD_HHMMSS/  # Automatic backups
```

---

## Configuration

All settings are in `.env` file at: `/mnt/user/appdata/the-logbook/.env`

### Important Settings

```bash
# Your Unraid IP (auto-detected)
ALLOWED_ORIGINS=http://192.168.1.10:7880

# Ports (change if needed)
FRONTEND_PORT=7880
BACKEND_PORT=7881

# Timezone
TZ=America/New_York
```

After changing `.env`, restart:

```bash
docker-compose restart
```

---

## Security Note

This stack runs in **production posture**, which enforces a startup security
gate:

- **API docs (`/docs`) are OFF by default** and enabling them blocks boot in
  production.
- **HTTPS is required** — the app refuses to start unless strong secrets are
  set, `DEBUG=false`, docs are disabled, and `SECURITY_ENFORCE_HTTPS=true`. Front
  the app with an HTTPS reverse proxy (SWAG / Nginx Proxy Manager / Cloudflare
  Tunnel) and point `ALLOWED_ORIGINS` at your `https://` origin.
- **Leave `TRUSTED_PROXY_IPS` empty** — the compose publishes the backend port
  directly, so the connecting peer is the real client. Only set it if you add a
  reverse proxy.

See the [Security Hardening](./UNRAID-INSTALLATION.md#security-hardening)
section of the installation guide for full details.

---

## Common Commands

```bash
# Navigate to app directory
cd /mnt/user/appdata/the-logbook

# View all logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f backend
docker-compose logs -f frontend

# Restart services
docker-compose restart

# Stop everything
docker-compose down

# Start everything
docker-compose up -d

# Rebuild after updates
docker-compose build --no-cache
docker-compose up -d

# Check status
docker-compose ps

# Access database
docker exec -it logbook-db mysql -u logbook_user -p
```

---

## Updating The Logbook

### Automatic Update

```bash
cd /mnt/user/appdata/the-logbook/unraid
./unraid-setup.sh
# Choose option 2 (Update)
```

### Manual Update

```bash
cd /mnt/user/appdata/the-logbook

# Pull latest code
git pull

# Repair the build contexts if a pulled Dockerfile outgrew them
./scripts/sync-compose-build-context.sh --fix -f docker-compose.yml

# Rebuild containers
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

> `./unraid/update.sh` does all of this — plus a verified database dump and
> rollback instructions — in one command. Prefer it over the manual sequence.

---

## Troubleshooting, Backups & Everything Else

This quick start deliberately stops here. Deeper topics are covered once, in
the **[full Unraid guide](../docs/deployment/unraid.md)**:

- [Troubleshooting](../docs/deployment/unraid.md#troubleshooting) — frontend
  not loading, backend errors, database connection issues, port conflicts,
  full rebuild
- [Backup and Restore](../docs/deployment/unraid.md#backup-and-restore) —
  automated daily backups with restore drills, manual backup and restore
- [HTTPS with Reverse Proxy](../docs/deployment/unraid.md#https-with-reverse-proxy)
  — required in production; Swag and Nginx Proxy Manager examples
- [Performance](../docs/deployment/unraid.md#performance) — container resource
  limits

---

## Unraid Community App

The Logbook is **not yet published** to Unraid Community Applications —
searching the Apps tab will not find it. The Docker Compose method on this
page is the supported install path today. (The CA template and its
[installation guide](./UNRAID-INSTALLATION.md) are ready in this directory,
awaiting publication — see [README.md](./README.md) for status.)

---

## Getting Help

### Check Logs First

```bash
docker-compose logs -f
```

### Documentation

These live inside your appdata share on the server, not on this site:

- Full Unraid Guide — `/mnt/user/appdata/the-logbook/docs/deployment/unraid.md`
- Troubleshooting Guide — `/mnt/user/appdata/the-logbook/docs/TROUBLESHOOTING.md`
- Main README — `/mnt/user/appdata/the-logbook/README.md`

### Support

- **GitHub Issues**: https://github.com/thegspiro/the-logbook/issues
- **Unraid Forums**: Post in Docker Support

### Diagnostic Info for Support

When asking for help, include:

```bash
# System info
uname -a
docker --version

# Container status
docker-compose ps

# Recent logs
docker-compose logs --tail=50

# Config (redact passwords!)
cat .env | grep -v PASSWORD | grep -v KEY
```

---

## Quick Reference Card

```bash
# Installation
curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/unraid/unraid-setup.sh | bash

# Access
http://YOUR-UNRAID-IP:7880

# Logs
cd /mnt/user/appdata/the-logbook && docker-compose logs -f

# Restart
cd /mnt/user/appdata/the-logbook && docker-compose restart

# Update
cd /mnt/user/appdata/the-logbook && git pull && docker-compose build --no-cache && docker-compose up -d

# Stop
cd /mnt/user/appdata/the-logbook && docker-compose down

# Start
cd /mnt/user/appdata/the-logbook && docker-compose up -d

# Cleanup conflicts
cd /mnt/user/appdata/the-logbook && docker-compose down --remove-orphans && docker-compose up -d
```

---

## Success Checklist

After installation, verify:

- [ ] All 4 containers running: `docker-compose ps`
- [ ] Frontend accessible: `http://YOUR-IP:7880`
- [ ] Backend healthy: `curl http://localhost:7881/health`
- [ ] API docs are OFF by default (`/docs` disabled in production; see Security Note)
- [ ] No errors in logs: `docker-compose logs --tail=50`
- [ ] Can complete onboarding wizard
- [ ] Database persists after restart

---

**Questions?** Check the [Troubleshooting Guide](../docs/TROUBLESHOOTING.md) or open a GitHub issue!

🚒 **Happy logging!**
