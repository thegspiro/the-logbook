# Building The Logbook from Source on Unraid

This guide shows you how to build and run The Logbook directly on Unraid **without needing to push images to GitHub**. This is the fastest way to get started!

## Why Build from Source?

- ✅ **No GitHub Container Registry needed** - Build directly on Unraid
- ✅ **No token/authentication required** - Everything is local
- ✅ **Fastest way to test** - No waiting for image uploads/downloads
- ✅ **Full control** - Modify code and rebuild anytime

## Prerequisites

- Unraid 6.9.0 or later
- Git installed on Unraid (usually pre-installed)
- At least 8GB RAM
- 20GB free disk space

---

## Step 1: Clean Up Previous Attempt

```bash
# Remove any existing setup
cd /mnt/user/appdata/the-logbook
docker-compose down -v  # Stop and remove containers
cd /mnt/user/appdata
rm -rf the-logbook
```

---

## Step 2: Clone the Repository on Unraid

```bash
# Navigate to appdata directory
cd /mnt/user/appdata

# Clone the repository (this downloads the source code)
git clone https://github.com/thegspiro/the-logbook.git
cd the-logbook

# Verify files are present
ls -la
# You should see: backend/, frontend/, unraid/, etc.
```

---

## Step 3: Copy the Build-from-Source Docker Compose File

```bash
# Copy the special docker-compose file
cp unraid/docker-compose-build-from-source.yml docker-compose.yml

# Copy the environment template
cp unraid/.env.example .env

# Verify
ls -la docker-compose.yml .env
```

---

## Step 4: Configure Environment Variables

```bash
# Edit the .env file
nano .env
```

**CRITICAL - Update these values:**

```bash
# 1. Generate secrets (open a new terminal/SSH session)
# Run these commands and copy the output:
openssl rand -hex 32  # For SECRET_KEY
openssl rand -hex 32  # For ENCRYPTION_KEY
openssl rand -base64 32 | tr -d "=+/" | cut -c1-25  # For MYSQL_ROOT_PASSWORD
openssl rand -base64 32 | tr -d "=+/" | cut -c1-25  # For DB_PASSWORD
openssl rand -base64 32 | tr -d "=+/" | cut -c1-25  # For REDIS_PASSWORD

# 2. Back in nano, update these lines:
SECRET_KEY=paste_your_generated_secret_key_here
ENCRYPTION_KEY=paste_your_generated_encryption_key_here
MYSQL_ROOT_PASSWORD=paste_first_password_here
DB_PASSWORD=paste_second_password_here
REDIS_PASSWORD=paste_third_password_here

# 3. Update your Unraid IP address:
ALLOWED_ORIGINS=http://YOUR-UNRAID-IP:7880
# Example: ALLOWED_ORIGINS=http://192.168.1.100:7880

# Find your IP with:
# ip addr show | grep "inet " | grep -v 127.0.0.1

# 4. Set timezone (optional):
TZ=America/New_York  # Change to your timezone

# 5. Save and exit:
# Press Ctrl+O, Enter, Ctrl+X
```

**Verify your changes:**

```bash
# Make sure you don't have any "CHANGE_ME" values
cat .env | grep "CHANGE_ME"
# This should return nothing (no output)

# Make sure SECRET_KEY is set
cat .env | grep SECRET_KEY
# Should show your generated key
```

---

## Step 5: Create Required Directories

```bash
# Create all data directories
mkdir -p /mnt/user/appdata/the-logbook/mysql
mkdir -p /mnt/user/appdata/the-logbook/redis
mkdir -p /mnt/user/appdata/the-logbook/data
mkdir -p /mnt/user/appdata/the-logbook/uploads
mkdir -p /mnt/user/appdata/the-logbook/logs
mkdir -p /mnt/user/backups/the-logbook

# Set proper permissions
chown -R 99:100 /mnt/user/appdata/the-logbook
chown -R 99:100 /mnt/user/backups/the-logbook

# Verify
ls -la /mnt/user/appdata/the-logbook/
```

---

## Step 6: Build the Docker Images

**This is the important step!** Instead of pulling from GitHub, we're building locally.

```bash
# Make sure you're in the right directory
cd /mnt/user/appdata/the-logbook

# Build the images (this will take 15-20 minutes the first time)
docker-compose build

# You'll see output like:
# [+] Building backend...
# [+] Building frontend...
# This is normal and may take a while
```

**What's happening:**
- **Backend build**: Downloads Python, installs dependencies, creates API server (~5-10 min)
- **Frontend build**: Downloads Node.js, compiles React app, creates Nginx server (~10-15 min)

**Troubleshooting build errors:**

If you get errors during build:

```bash
# Check Docker has enough space
df -h

# Check memory
free -h

# If low on memory, build one at a time:
docker-compose build backend
docker-compose build frontend
```

---

## Step 7: Start The Logbook

```bash
# Start all services
docker-compose up -d

# Watch the logs to verify startup
docker-compose logs -f

# Wait for these messages:
# ✓ Database connection successful
# ✓ Redis connected
# ✓ Server started on port 3001
# ✓ nginx started

# Press Ctrl+C to stop watching logs (containers keep running)
```

---

## Step 8: Verify Everything is Running

```bash
# Check container status (all should show "Up" and "healthy")
docker-compose ps

# Expected output:
# NAME                 STATUS                    PORTS
# logbook-backend      Up (healthy)              0.0.0.0:7881->3001/tcp
# logbook-frontend     Up (healthy)              0.0.0.0:7880->80/tcp
# logbook-db           Up (healthy)
# logbook-redis        Up (healthy)

# Test the backend health endpoint
curl http://localhost:7881/health
# Should return: {"status":"healthy"...}

# Test the frontend
curl http://localhost:7880
# Should return HTML
```

---

## Step 9: Access The Logbook

1. **Open your web browser**
2. **Go to**: `http://YOUR-UNRAID-IP:7880`
   - Example: `http://192.168.1.100:7880`

3. **Complete Initial Setup:**
   - Create admin account
   - Set up organization details
   - Configure settings

**Congratulations! The Logbook is running!** 🎉

---

## Management Commands

### View Logs

```bash
cd /mnt/user/appdata/the-logbook

# All services
docker-compose logs -f

# Specific service
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f db

# Last 100 lines
docker-compose logs --tail 100
```

### Stop/Start/Restart

```bash
cd /mnt/user/appdata/the-logbook

# Stop
docker-compose stop

# Start
docker-compose start

# Restart
docker-compose restart

# Stop and remove (keeps data)
docker-compose down

# Start from scratch
docker-compose up -d
```

### Update The Logbook

When there are code updates:

```bash
cd /mnt/user/appdata/the-logbook

# 1. Pull latest code
git pull origin main

# 2. Rebuild images
docker-compose build

# 3. Recreate containers with new images
docker-compose up -d

# 4. Verify
docker-compose ps
docker-compose logs -f
```

### Backup

```bash
# Trigger manual backup
docker-compose exec backend /app/scripts/backup.sh

# View backups
ls -lh /mnt/user/backups/the-logbook/
```

### Database Access

```bash
# Access MySQL shell
docker-compose exec logbook-db mysql -u root -p
# Enter MYSQL_ROOT_PASSWORD from .env

# Inside MySQL:
USE the_logbook;
SHOW TABLES;
SELECT COUNT(*) FROM users;
exit;
```

---

## Troubleshooting

### Build fails with "no space left on device"

```bash
# Clean up Docker
docker system prune -a

# Check disk space
df -h
```

### Build fails with "network timeout"

Your internet connection dropped during package download. Just run again:

```bash
docker-compose build
```

### Containers fail to start

```bash
# Check logs for errors
docker-compose logs backend
docker-compose logs db

# Common issues:
# - Wrong password in .env
# - Database not ready (wait 30 seconds and try again)
# - Port conflicts (7880 or 7881 already in use)
```

### "Database connection failed"

```bash
# Verify database is running
docker-compose ps db
# Should show "Up (healthy)"

# Check database logs
docker-compose logs db

# Verify password matches in .env
cat .env | grep DB_PASSWORD
cat .env | grep MYSQL_ROOT_PASSWORD
```

### Can't access web interface

```bash
# 1. Verify frontend is running
docker-compose ps frontend
# Should show "Up (healthy)"

# 2. Check if port is accessible
curl http://localhost:7880
# Should return HTML

# 3. Check firewall (Unraid usually allows all)
# 4. Verify IP address is correct
ip addr show | grep "inet " | grep -v 127.0.0.1
```

### "Permission denied" errors

```bash
# Fix permissions
chown -R 99:100 /mnt/user/appdata/the-logbook
chown -R 99:100 /mnt/user/backups/the-logbook
docker-compose restart
```

---

## Performance Tuning

### For Unraid servers with limited RAM (8GB)

Edit `docker-compose.yml`:

```yaml
db:
  command: >
    --innodb_buffer_pool_size=256M  # Down from 512M

redis:
  command: redis-server --maxmemory 128mb  # Down from 256mb
```

### For powerful Unraid servers (16GB+ RAM)

```yaml
db:
  command: >
    --innodb_buffer_pool_size=1G  # Up from 512M

redis:
  command: redis-server --maxmemory 512mb  # Up from 256mb
```

---

## Switching to Pre-Built Images Later

Once you push images to ghcr.io, you can switch back to the regular docker-compose file:

```bash
cd /mnt/user/appdata/the-logbook

# Switch to the pull-based compose file
cp unraid/docker-compose-unraid.yml docker-compose.yml

# Pull pre-built images
docker-compose pull

# Recreate containers
docker-compose up -d
```

---

## Summary

✅ **Built locally** - No GitHub Container Registry needed
✅ **Running on Unraid** - Accessible at `http://YOUR-IP:7880`
✅ **Auto-starts on boot** - `restart: unless-stopped` policy
✅ **Auto-backups** - Daily at 2 AM to `/mnt/user/backups/`
✅ **All data persisted** - Survives container restarts

**You're all set!** 🚀
