# Unraid Setup Guide

Complete guide for installing and running The Logbook on Unraid.

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
- [Troubleshooting](#troubleshooting)
- [Common Commands](#common-commands)

---

## Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| Unraid | 6.9.0+ | 6.12.0+ |
| RAM | 4 GB free | 8 GB free |
| Disk | 20 GB | 50 GB+ |
| CPU | 2 cores | 4+ cores |

Docker must be enabled on your Unraid server (Settings > Docker > Enable Docker: Yes).

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
- Build and start all containers (frontend, backend, MySQL, Redis)
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
ALLOWED_ORIGINS=http://YOUR-UNRAID-IP:7880
TZ=America/New_York  # Your timezone
```

Create directories and start:

```bash
mkdir -p mysql redis data uploads logs
mkdir -p /mnt/user/backups/the-logbook
chown -R 99:100 mysql redis data uploads logs

docker-compose build
docker-compose up -d
```

---

## Post-Install Setup

Once the containers are running, open your browser:

- **Frontend:** `http://YOUR-UNRAID-IP:7880`
- **API Docs:** `http://YOUR-UNRAID-IP:7881/docs`
- **Health Check:** `http://YOUR-UNRAID-IP:7881/health`

Complete the onboarding wizard to configure your organization, create the admin account, and enable the modules you need.

---

## Configuration

All settings live in `/mnt/user/appdata/the-logbook/.env`. After editing, restart with:

```bash
cd /mnt/user/appdata/the-logbook
docker-compose restart
```

### Ports

| Service | Default Port | Purpose |
|---------|-------------|---------|
| Frontend | 7880 | Web interface |
| Backend API | 7881 | API endpoint |
| MySQL | 3306 (internal) | Database (not exposed to host) |
| Redis | 6379 (internal) | Cache (not exposed to host) |

To change ports, edit `FRONTEND_PORT` and `BACKEND_PORT` in `.env` and update `ALLOWED_ORIGINS` to match.

### Modules

Enable or disable features in `.env`:

```bash
MODULE_TRAINING_ENABLED=true
MODULE_COMPLIANCE_ENABLED=true
MODULE_SCHEDULING_ENABLED=true
MODULE_ELECTIONS_ENABLED=true
```

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

Enabled by default. Runs daily at 2 AM. Stored in `/mnt/user/backups/the-logbook/`.

Configure in `.env`:

```bash
BACKUP_ENABLED=true
BACKUP_SCHEDULE=0 2 * * *
BACKUP_RETENTION_DAYS=30
```

### Manual Backup

```bash
cd /mnt/user/appdata/the-logbook
docker-compose exec backend /app/scripts/backup.sh
```

### Restore

```bash
cd /mnt/user/appdata/the-logbook
docker-compose down

# Restore database
gunzip < /mnt/user/backups/the-logbook/backup_YYYYMMDD.sql.gz | \
  docker exec -i logbook-db mysql -u logbook_user -p the_logbook

# Restore uploads
cp -r /mnt/user/backups/the-logbook/backup_YYYYMMDD/uploads/* uploads/

docker-compose up -d
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
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

Back up before updating:

```bash
docker-compose exec backend /app/scripts/backup.sh
```

---

## Troubleshooting

### Container Conflicts

If you see `Error: The container name "/logbook-redis" is already in use`:

```bash
cd /mnt/user/appdata/the-logbook
docker-compose down --remove-orphans
docker-compose up -d
```

Or remove containers manually:

```bash
docker stop logbook-frontend logbook-backend logbook-db logbook-redis 2>/dev/null
docker rm -f logbook-frontend logbook-backend logbook-db logbook-redis 2>/dev/null
docker-compose up -d
```

### Port Conflicts

```bash
# Check what is using a port
netstat -tuln | grep 7880

# Change ports in .env
nano /mnt/user/appdata/the-logbook/.env
# Update FRONTEND_PORT, BACKEND_PORT, and ALLOWED_ORIGINS

docker-compose down
docker-compose up -d
```

### Frontend Not Loading

```bash
docker ps | grep logbook-frontend
docker-compose logs frontend

# Rebuild if needed
docker-compose build --no-cache frontend
docker-compose up -d frontend
```

### Backend Errors

```bash
curl http://localhost:7881/health
docker-compose logs backend
docker-compose restart backend
```

### Database Connection Issues

```bash
docker ps | grep logbook-db
docker-compose logs db

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
docker-compose down
docker system prune -a
docker-compose build --no-cache
docker-compose up -d
```

---

## Common Commands

```bash
cd /mnt/user/appdata/the-logbook

# Status
docker-compose ps

# Logs (all services)
docker-compose logs -f

# Logs (single service)
docker-compose logs -f backend

# Restart
docker-compose restart

# Stop
docker-compose down

# Start
docker-compose up -d

# Rebuild
docker-compose build --no-cache && docker-compose up -d

# Database shell
docker exec -it logbook-db mysql -u logbook_user -p

# Resource usage
docker stats --filter name=logbook
```

---

## More Information

- [Unraid Quick Start](../../unraid/QUICK-START-UPDATED.md) - condensed setup steps
- [Unraid Docker Compose](../../unraid/docker-compose-unraid.yml) - the Unraid-optimized compose file
- [Full Installation Guide](../../unraid/UNRAID-INSTALLATION.md) - Community Apps template details
- [Main README](../../README.md) - project overview
- [GitHub Issues](https://github.com/thegspiro/the-logbook/issues) - bug reports and support
