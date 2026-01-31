# 🚀 The Logbook - Unraid Quick Start

**Updated: January 2026** - Includes automatic container cleanup and latest package updates!

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
- **Database** - MariaDB 10.11
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

# Rebuild containers
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

---

## Troubleshooting

### Frontend not loading

```bash
# Check if container is running
docker ps | grep logbook-frontend

# View frontend logs
docker-compose logs frontend

# Rebuild frontend
docker-compose stop frontend
docker-compose build --no-cache frontend
docker-compose up -d frontend
```

### Backend API errors

```bash
# Check backend health
curl http://localhost:7881/health

# View backend logs
docker-compose logs backend

# Restart backend
docker-compose restart backend
```

### Database connection issues

```bash
# Check database status
docker ps | grep logbook-db

# View database logs
docker-compose logs db

# Access database
docker exec -it logbook-db mysql -u root -p
# Enter password from .env MYSQL_ROOT_PASSWORD
```

### "Cannot connect to Docker daemon"

```bash
# Start Docker service on Unraid
/etc/rc.d/rc.docker start
```

### Port conflicts (7880 or 7881 in use)

Edit `.env` file:
```bash
nano /mnt/user/appdata/the-logbook/.env

# Change ports
FRONTEND_PORT=8880
BACKEND_PORT=8881

# Save and restart
docker-compose down
docker-compose up -d
```

---

## Backup & Restore

### Automatic Backups

Backups run daily at 2 AM to: `/mnt/user/backups/the-logbook/`

### Manual Backup

```bash
cd /mnt/user/appdata/the-logbook
docker-compose exec backend /app/scripts/backup.sh
```

### Restore from Backup

```bash
cd /mnt/user/appdata/the-logbook

# Stop services
docker-compose down

# Restore database
gunzip < /mnt/user/backups/the-logbook/backup_20260131.sql.gz | \
  docker exec -i logbook-db mysql -u logbook_user -p the_logbook

# Restore uploaded files
cp -r /mnt/user/backups/the-logbook/backup_20260131/uploads/* \
  /mnt/user/appdata/the-logbook/uploads/

# Start services
docker-compose up -d
```

---

## Package Updates (January 2026)

This version includes the latest package updates:

### Frontend
- ✅ **Vite 6.0.5** (fixed from incorrect 7.3.1)
- ✅ **React 18.3.1** (security updates)
- ✅ **axios 1.7.9** (security updates)
- ✅ **lucide-react 0.468.0** (was 150+ versions behind)
- ✅ **TypeScript 5.7.3**
- ✅ Plus 20+ other updated packages

### Backend
- ✅ **Python 3.13** (latest stable)
- ✅ **FastAPI** (latest)
- ✅ **Updated all dependencies**

### Benefits
- 🔒 Security vulnerability fixes
- ⚡ Better performance
- 🐛 Bug fixes
- 📚 Latest features

---

## Performance Tips

### Resource Allocation

For optimal performance on Unraid:

```yaml
# In docker-compose.yml, add under each service:
deploy:
  resources:
    limits:
      cpus: '2'
      memory: 2G
    reservations:
      cpus: '1'
      memory: 512M
```

### Database Optimization

Already configured in docker-compose:
- 512MB buffer pool
- UTF8MB4 encoding
- 200 max connections
- 256MB max packet size

---

## Unraid Community App

The Logbook will be available in Unraid Community Apps soon!

For now, use this installation method.

---

## Getting Help

### Check Logs First

```bash
docker-compose logs -f
```

### Documentation
- [Full Unraid Guide](/mnt/user/appdata/the-logbook/docs/deployment/unraid.md)
- [Troubleshooting Guide](/mnt/user/appdata/the-logbook/docs/troubleshooting/README.md)
- [Main README](/mnt/user/appdata/the-logbook/README.md)

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
- [ ] API docs work: `http://YOUR-IP:7881/docs`
- [ ] No errors in logs: `docker-compose logs --tail=50`
- [ ] Can complete onboarding wizard
- [ ] Database persists after restart

---

**Questions?** Check the [Troubleshooting Guide](../docs/troubleshooting/README.md) or open a GitHub issue!

🚒 **Happy logging!**
