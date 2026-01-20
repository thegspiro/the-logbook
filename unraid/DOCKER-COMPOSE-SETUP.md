# The Logbook - Docker Compose Setup Guide for Unraid

Complete step-by-step guide for deploying The Logbook on Unraid using Docker Compose.

## What You'll Get

This setup includes:
- ✅ **MariaDB Database** - Your data storage (internal only, port 3306)
- ✅ **Redis Cache** - Performance optimization (internal only, port 6379)
- ✅ **Backend API** - FastAPI server (port 7881)
- ✅ **Frontend** - React web interface (port 7880)
- ✅ **Automated Backups** - Daily backups to `/mnt/user/backups/`
- ✅ **Health Checks** - Automatic container health monitoring

**Everything runs in isolated containers with automatic restarts!**

---

## Prerequisites

### 1. Unraid Version

- Unraid **6.9.0 or later** (6.12+ recommended)
- Docker service enabled (default on Unraid)

### 2. System Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| RAM | 8 GB | 16 GB |
| Storage | 20 GB free | 50 GB+ free |
| CPU | 2 cores | 4+ cores |

### 3. Knowledge Required

- Basic command line usage (we'll guide you!)
- Access to Unraid terminal (via SSH or web terminal)
- Text editor basics (nano or vi)

---

## Step 1: Access Unraid Terminal

### Option A: Web Terminal (Easiest)

1. Open Unraid web interface
2. Click **Settings** → **User Utilities**
3. Enable **User Scripts** plugin (if not already enabled)
4. Or use **Console** icon in top-right corner (Unraid 6.12+)

### Option B: SSH (Recommended)

1. Enable SSH in Unraid:
   - Go to **Settings** → **Management Access**
   - Enable **Use SSH**: Yes
   - Click **Apply**

2. Connect from your computer:
   ```bash
   # Mac/Linux
   ssh root@YOUR-UNRAID-IP

   # Windows (PowerShell or use PuTTY)
   ssh root@YOUR-UNRAID-IP
   ```

3. Enter your Unraid root password

---

## Step 2: Create Project Directory

```bash
# Create directory for The Logbook
mkdir -p /mnt/user/appdata/the-logbook

# Navigate to it
cd /mnt/user/appdata/the-logbook

# Verify you're in the right place
pwd
# Should show: /mnt/user/appdata/the-logbook
```

---

## Step 3: Download Files

### Option A: Clone from GitHub (Recommended)

```bash
# Install git if not present
opkg update
opkg install git

# Clone the repository
cd /mnt/user/appdata/the-logbook
git clone https://github.com/thegspiro/the-logbook.git temp
mv temp/unraid/* .
rm -rf temp

# Verify files are present
ls -la
# You should see: docker-compose-unraid.yml, .env.example, etc.
```

### Option B: Manual Download

1. Download from GitHub:
   - Go to: https://github.com/thegspiro/the-logbook/tree/main/unraid
   - Download `docker-compose-unraid.yml`
   - Download `.env.example`

2. Upload to Unraid:
   - Use **Unraid File Manager** or **WinSCP**
   - Upload to `/mnt/user/appdata/the-logbook/`

---

## Step 4: Rename Docker Compose File

```bash
cd /mnt/user/appdata/the-logbook

# Rename to standard docker-compose.yml
mv docker-compose-unraid.yml docker-compose.yml

# Verify
ls -la docker-compose.yml
```

---

## Step 5: Create .env Configuration File

```bash
# Copy the example file
cp .env.example .env

# Open in text editor
nano .env
```

### 5.1: Generate Secret Keys

**CRITICAL: Don't skip this step!**

Open a **new terminal window** (keep nano open) and generate keys:

```bash
# Generate SECRET_KEY
openssl rand -hex 32

# Generate ENCRYPTION_KEY
openssl rand -hex 32

# Generate database passwords (stronger)
openssl rand -base64 32 | tr -d "=+/" | cut -c1-25
openssl rand -base64 32 | tr -d "=+/" | cut -c1-25
openssl rand -base64 32 | tr -d "=+/" | cut -c1-25
```

**Copy these outputs - you'll need them in the next step!**

### 5.2: Configure .env File

In your `nano .env` window, update these values:

```bash
# ============================================
# 1. SECRET KEYS (use values from step 5.1)
# ============================================
SECRET_KEY=paste_your_generated_secret_key_here
ENCRYPTION_KEY=paste_your_generated_encryption_key_here

# ============================================
# 2. DATABASE PASSWORDS (use values from step 5.1)
# ============================================
MYSQL_ROOT_PASSWORD=paste_first_password_here
DB_PASSWORD=paste_second_password_here
REDIS_PASSWORD=paste_third_password_here

# ============================================
# 3. NETWORK (IMPORTANT: Update with YOUR Unraid IP!)
# ============================================
ALLOWED_ORIGINS=http://192.168.1.10:7880
#                      ^^^^^^^^^^^
#                      Change to YOUR Unraid IP address
```

**How to find your Unraid IP:**
- Look at the top of Unraid web interface, or
- Run: `ip addr show | grep "inet " | grep -v 127.0.0.1`
- Use the IP starting with 192.168.x.x or 10.x.x.x

### 5.3: Optional - Configure Email

If you want email notifications (skip if not needed):

```bash
# Email Configuration
EMAIL_ENABLED=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM_EMAIL=noreply@yourdomain.com
```

**Gmail Users:** Generate an [App Password](https://myaccount.google.com/apppasswords)

### 5.4: Set Your Timezone

```bash
# Update timezone (find yours at: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)
TZ=America/New_York  # Change to your timezone
```

### 5.5: Save and Exit

```bash
# In nano:
# 1. Press Ctrl+O (to save)
# 2. Press Enter (to confirm)
# 3. Press Ctrl+X (to exit)
```

### 5.6: Verify Configuration

```bash
# Check that file was saved
cat .env | grep SECRET_KEY
# Should show your generated key, NOT "CHANGE_ME"

# Check permissions
chmod 600 .env
# This makes .env readable only by root for security
```

---

## Step 6: Create Required Directories

```bash
# Create all data directories
mkdir -p /mnt/user/appdata/the-logbook/mysql
mkdir -p /mnt/user/appdata/the-logbook/redis
mkdir -p /mnt/user/appdata/the-logbook/data
mkdir -p /mnt/user/appdata/the-logbook/uploads
mkdir -p /mnt/user/appdata/the-logbook/logs
mkdir -p /mnt/user/backups/the-logbook

# Set permissions (Unraid defaults: nobody:users = 99:100)
chown -R 99:100 /mnt/user/appdata/the-logbook
chown -R 99:100 /mnt/user/backups/the-logbook

# Verify
ls -la /mnt/user/appdata/the-logbook/
```

---

## Step 7: Start The Logbook

```bash
# Make sure you're in the right directory
cd /mnt/user/appdata/the-logbook

# Verify files are present
ls -la
# Should see: docker-compose.yml, .env

# Pull Docker images (this may take 5-10 minutes on first run)
docker-compose pull

# Start all services
docker-compose up -d
```

### What Happens:

1. **MariaDB** starts and initializes database (30-60 seconds)
2. **Redis** starts (5-10 seconds)
3. **Backend** waits for database, then starts (20-30 seconds)
4. **Frontend** starts after backend is ready (10-15 seconds)

**First-time startup can take 2-3 minutes total.**

---

## Step 8: Verify Installation

### 8.1: Check Container Status

```bash
# View running containers
docker-compose ps

# Expected output (all should show "Up" and "healthy"):
# NAME                  STATUS                    PORTS
# logbook-frontend      Up (healthy)              0.0.0.0:7880->3000/tcp
# logbook-backend       Up (healthy)              0.0.0.0:7881->3001/tcp
# logbook-redis         Up (healthy)
# logbook-db            Up (healthy)
```

### 8.2: Check Logs

```bash
# View all logs
docker-compose logs

# Follow logs in real-time (Ctrl+C to stop)
docker-compose logs -f

# View specific service logs
docker-compose logs backend
docker-compose logs frontend
docker-compose logs db
```

**Look for:**
- ✅ `Database connection successful`
- ✅ `Redis connected`
- ✅ `Server started on port 3001`
- ✅ No error messages

### 8.3: Test Health Endpoints

```bash
# Test backend health
curl http://localhost:7881/health

# Expected response: {"status":"healthy","checks":{...}}

# Test frontend
curl http://localhost:7880

# Expected: HTML response (long output)
```

---

## Step 9: Access The Logbook

### 9.1: Open in Browser

1. Open your web browser
2. Go to: `http://YOUR-UNRAID-IP:7880`
   - Example: `http://192.168.1.10:7880`

3. You should see **The Logbook** login/setup page

### 9.2: Complete Initial Setup

1. **Create Admin Account:**
   - First Name, Last Name
   - Email address
   - Strong password (12+ characters)

2. **Organization Setup:**
   - Organization name (e.g., "Springfield Fire Department")
   - Organization type (Fire, EMS, Rescue, etc.)
   - Timezone

3. **Click "Complete Setup"**

4. **Log in with your new account**

**Congratulations! The Logbook is now running! 🎉**

---

## Step 10: Configure Automatic Startup

The containers are already set to `restart: unless-stopped`, so they'll automatically start when Unraid boots.

### Verify Auto-Start

```bash
# Check restart policy
docker inspect logbook-frontend | grep -A 5 RestartPolicy

# Should show:
#   "RestartPolicy": {
#     "Name": "unless-stopped",
```

**No additional configuration needed!**

---

## Management Commands

### Start/Stop/Restart

```bash
# Navigate to project directory
cd /mnt/user/appdata/the-logbook

# Stop all services
docker-compose stop

# Start all services
docker-compose start

# Restart all services
docker-compose restart

# Stop and remove containers (data is preserved)
docker-compose down

# Start services (recreates containers if needed)
docker-compose up -d
```

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f db

# Last 100 lines
docker-compose logs --tail 100

# Since specific time
docker-compose logs --since 30m
```

### Update The Logbook

```bash
cd /mnt/user/appdata/the-logbook

# Backup first (IMPORTANT!)
docker-compose exec backend /app/scripts/backup.sh

# Pull latest images
docker-compose pull

# Recreate containers with new images
docker-compose up -d

# Verify
docker-compose ps
docker-compose logs -f
```

### Access Container Shells

```bash
# Backend shell (for troubleshooting)
docker-compose exec backend bash

# Database shell
docker-compose exec db mysql -u root -p
# Enter MYSQL_ROOT_PASSWORD from .env

# Redis shell
docker-compose exec redis redis-cli -a YOUR_REDIS_PASSWORD
```

### Database Management

```bash
# Backup database manually
docker-compose exec db mysqldump -u root -pYOUR_ROOT_PASSWORD the_logbook > backup_$(date +%Y%m%d).sql

# Restore database
docker-compose exec -T db mysql -u root -pYOUR_ROOT_PASSWORD the_logbook < backup_20260120.sql

# Access database
docker-compose exec db mysql -u root -p
```

---

## Backups

### Automatic Backups

Backups run automatically at **2 AM daily** (configurable in `.env`).

**Backup location:** `/mnt/user/backups/the-logbook/`

```bash
# View backups
ls -lh /mnt/user/backups/the-logbook/

# Example output:
# the-logbook-backup-20260120-020000.tar.gz
# the-logbook-backup-20260121-020000.tar.gz
```

### Manual Backup

```bash
# Trigger backup manually
docker-compose exec backend /app/scripts/backup.sh

# Check backup was created
ls -lh /mnt/user/backups/the-logbook/
```

### Restore from Backup

```bash
# Stop services
docker-compose stop

# Restore (replace with your backup filename)
docker-compose exec backend /app/scripts/backup.sh --restore /backups/the-logbook-backup-20260120-020000.tar.gz

# Start services
docker-compose start
```

### Configure Backup Schedule

Edit `.env` file:

```bash
nano .env

# Update these lines:
BACKUP_ENABLED=true
BACKUP_SCHEDULE=0 2 * * *  # 2 AM daily (cron format)
BACKUP_RETENTION_DAYS=30   # Keep 30 days of backups

# Save and restart
docker-compose restart backend
```

**Cron Schedule Examples:**
- `0 2 * * *` - 2 AM daily
- `0 */6 * * *` - Every 6 hours
- `0 0 * * 0` - Sunday midnight (weekly)

---

## Troubleshooting

### Container Won't Start

```bash
# Check logs for errors
docker-compose logs backend

# Common issues:
# 1. Port already in use
netstat -tlnp | grep 7880
netstat -tlnp | grep 7881

# 2. Database connection failed
docker-compose logs db

# 3. Missing .env variables
docker-compose config  # Shows merged configuration
```

### Can't Access Web Interface

```bash
# Test locally on Unraid
curl http://localhost:7880

# If works: Firewall issue
# If fails: Container issue

# Check container networking
docker network ls
docker network inspect the-logbook_logbook-internal

# Verify ports are exposed
docker-compose ps
```

### Database Connection Errors

```bash
# Check database is running
docker-compose ps db

# Test database connection
docker-compose exec db mysql -u logbook_user -p
# Enter DB_PASSWORD from .env

# If connection fails, check passwords in .env match
cat .env | grep DB_PASSWORD
```

### Reset Everything (Nuclear Option)

**WARNING: This deletes all data!**

```bash
cd /mnt/user/appdata/the-logbook

# Stop and remove containers
docker-compose down -v

# Remove all data
rm -rf mysql/ redis/ data/ uploads/ logs/

# Recreate directories
mkdir -p mysql redis data uploads logs
chown -R 99:100 .

# Start fresh
docker-compose up -d
```

### Out of Memory

```bash
# Check memory usage
free -h

# Check Docker memory usage
docker stats

# Solutions:
# 1. Reduce MariaDB buffer pool in docker-compose.yml:
#    --innodb_buffer_pool_size=256M  # Instead of 512M

# 2. Reduce Redis max memory in docker-compose.yml:
#    --maxmemory 128mb  # Instead of 256mb

# 3. Disable Redis if not needed:
#    Comment out redis service in docker-compose.yml
#    Remove REDIS_* variables from backend environment
```

### Port Conflicts

```bash
# Check what's using port 7880
netstat -tlnp | grep 7880

# Change ports in .env
nano .env
# Update FRONTEND_PORT=8880 (or any free port)

# Restart
docker-compose up -d
```

---

## Advanced Configuration

### Enable HTTPS with Reverse Proxy

See: [UNRAID-INSTALLATION.md - SSL Setup](./UNRAID-INSTALLATION.md#sslhttps-setup-with-reverse-proxy)

**Quick Summary:**

1. Install **Swag** from Community Apps
2. Configure domain and SSL certificate
3. Create proxy configuration:

```nginx
# /mnt/user/appdata/swag/nginx/proxy-confs/logbook.subdomain.conf
server {
    listen 443 ssl http2;
    server_name logbook.*;

    location / {
        proxy_pass http://192.168.1.10:7880;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Resource Limits

Add to `docker-compose.yml` under each service:

```yaml
services:
  backend:
    # ... existing config ...
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 2G
        reservations:
          memory: 512M
```

### External Network Access

To access from outside your network:

1. **VPN (Recommended):** Use WireGuard or OpenVPN
2. **Port Forwarding (Not Recommended):** Security risk without HTTPS
3. **Cloudflare Tunnel:** Secure external access without port forwarding

---

## Monitoring

### Healthcheck URLs

```bash
# Backend health
curl http://192.168.1.10:7881/health

# Backend detailed health (development only)
curl http://192.168.1.10:7881/health/detailed
```

### Resource Monitoring

```bash
# Real-time stats
docker stats

# Disk usage
docker system df

# Cleanup unused images
docker system prune -a
```

### Log Rotation

Docker handles log rotation automatically, but you can configure:

```yaml
# Add to docker-compose.yml under each service:
logging:
  driver: "json-file"
  options:
    max-size: "10m"
    max-file: "3"
```

---

## Uninstall

### Remove The Logbook

```bash
# Stop and remove containers
cd /mnt/user/appdata/the-logbook
docker-compose down -v

# Remove data (CAUTION: Permanent!)
rm -rf /mnt/user/appdata/the-logbook
rm -rf /mnt/user/backups/the-logbook

# Remove Docker images
docker rmi ghcr.io/thegspiro/the-logbook-frontend:latest
docker rmi ghcr.io/thegspiro/the-logbook-backend:latest
docker rmi mariadb:10.11
docker rmi redis:7-alpine
```

---

## Performance Tuning

### For 8GB RAM Systems

Edit `docker-compose.yml`:

```yaml
# Reduce MariaDB buffer
db:
  command: >
    --innodb_buffer_pool_size=256M  # Down from 512M

# Reduce Redis memory
redis:
  command: redis-server --maxmemory 128mb  # Down from 256mb
```

### For 16GB+ RAM Systems

```yaml
# Increase MariaDB buffer
db:
  command: >
    --innodb_buffer_pool_size=1G  # Up from 512M

# Increase Redis memory
redis:
  command: redis-server --maxmemory 512mb  # Up from 256mb
```

---

## Getting Help

### Check Documentation

- [Installation Guide](./UNRAID-INSTALLATION.md)
- [Community App Submission](./COMMUNITY-APP-SUBMISSION.md)
- [Main README](./README.md)

### Community Support

1. **Unraid Forums:**
   - [Docker Containers Section](https://forums.unraid.net/forum/56-docker-containers/)
   - Search for existing threads

2. **GitHub Issues:**
   - [Report Bugs](https://github.com/thegspiro/the-logbook/issues)
   - Search existing issues first

3. **Include in Support Requests:**
   - Unraid version: `cat /etc/unraid-version`
   - Docker version: `docker --version`
   - Container logs: `docker-compose logs`
   - .env configuration (sanitized - remove passwords!)

---

## Summary

You now have The Logbook running with:

✅ **Access URL:** `http://YOUR-UNRAID-IP:7880`
✅ **Auto-start:** Containers restart on Unraid boot
✅ **Automated backups:** Daily at 2 AM to `/mnt/user/backups/`
✅ **Health checks:** Automatic container monitoring
✅ **Data persistence:** All data stored in `/mnt/user/appdata/`

**Next Steps:**
1. Complete initial setup wizard in web interface
2. Create user accounts for your team
3. Explore modules (Training, Events, Elections, etc.)
4. Configure email notifications (optional)
5. Set up SSL with reverse proxy (recommended)

**Enjoy using The Logbook!** 🚒🚑

---

## Quick Reference Card

```bash
# Navigate to project
cd /mnt/user/appdata/the-logbook

# Start
docker-compose up -d

# Stop
docker-compose stop

# Restart
docker-compose restart

# Logs
docker-compose logs -f

# Update
docker-compose pull && docker-compose up -d

# Backup
docker-compose exec backend /app/scripts/backup.sh

# Status
docker-compose ps

# Access web interface
http://YOUR-UNRAID-IP:7880
```

**Save this for quick reference!**
