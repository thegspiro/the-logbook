# The Logbook - Synology NAS Deployment Guide

Deploy The Logbook on a Synology NAS using Docker (Container Manager) or Docker Compose via SSH.

## Overview

Synology NAS devices with Docker support can run The Logbook as a self-hosted intranet platform for your fire department. DSM 7.2+ with Container Manager (formerly Docker package) is required.

| Method | Difficulty | Best For |
|--------|-----------|----------|
| **Container Manager UI** (DSM 7.2+) | Easy | Users who prefer the GUI |
| **Docker Compose via SSH** | Moderate | Advanced users, full control |

### Hardware Requirements

| NAS Model Series | CPU | RAM | Profile | Status |
|-----------------|-----|-----|---------|--------|
| **DS224+, DS423+** | Intel Celeron J4125 | 2 GB | minimal | Works (add RAM recommended) |
| **DS723+, DS923+** | AMD Ryzen R1600 | 2-4 GB | minimal / standard | Works well |
| **DS1522+, DS1621+** | AMD Ryzen R1600 | 8 GB | standard / full | Recommended |
| **DS1823xs+, DS3622xs+** | Intel Xeon | 16+ GB | full | Excellent |

> **Minimum**: 4 GB RAM recommended. NAS models with only 2 GB should use the minimal profile and consider a RAM upgrade.

### Prerequisites

- Synology NAS with an **Intel/AMD x86_64** CPU (ARM-based models like DS223j are not supported for Docker)
- **DSM 7.2** or later
- **Container Manager** package installed (from Package Center)
- At least **30 GB free disk space** (50 GB recommended)
- SSH access enabled (for Docker Compose method)

---

## Method 1: Docker Compose via SSH (Recommended)

This method gives you the most control and matches the standard deployment process.

### Step 1: Enable SSH

1. Open **DSM** in your browser
2. Go to **Control Panel** > **Terminal & SNMP**
3. Check **Enable SSH service**
4. Set port (default: 22)
5. Click **Apply**

### Step 2: Connect via SSH

```bash
ssh your-admin-user@YOUR-SYNOLOGY-IP
```

> **Note**: Use your DSM admin account credentials. On DSM 7.2+, you may need to use `sudo` for Docker commands.

### Step 3: Create Project Directory

```bash
# Create a shared folder for the application data
# Using /volume1 (your primary volume — adjust if different)
sudo mkdir -p /volume1/docker/the-logbook
cd /volume1/docker/the-logbook
```

### Step 4: Clone and Configure

```bash
# Clone the repository
sudo git clone https://github.com/thegspiro/the-logbook.git .

# Copy environment file
sudo cp .env.example .env

# Generate secure keys
SECRET_KEY=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
ENCRYPTION_SALT=$(openssl rand -hex 16)
DB_PASSWORD=$(openssl rand -base64 24 | tr -d "=+/" | cut -c1-20)
REDIS_PASSWORD=$(openssl rand -base64 24 | tr -d "=+/" | cut -c1-20)
MYSQL_ROOT_PASSWORD=$(openssl rand -base64 24 | tr -d "=+/" | cut -c1-20)

# Update .env with generated values
sudo sed -i "s|^SECRET_KEY=.*|SECRET_KEY=${SECRET_KEY}|" .env
sudo sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=${ENCRYPTION_KEY}|" .env
sudo sed -i "s|^ENCRYPTION_SALT=.*|ENCRYPTION_SALT=${ENCRYPTION_SALT}|" .env
sudo sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=${DB_PASSWORD}|" .env
sudo sed -i "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=${REDIS_PASSWORD}|" .env
sudo sed -i "s|^MYSQL_ROOT_PASSWORD=.*|MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}|" .env

# Set ALLOWED_ORIGINS to your NAS IP
NAS_IP=$(hostname -I | awk '{print $1}')
sudo sed -i "s|^ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=http://${NAS_IP}:3000|" .env

# Set production mode
sudo sed -i "s|^ENVIRONMENT=.*|ENVIRONMENT=production|" .env
sudo sed -i "s|^DEBUG=.*|DEBUG=false|" .env
```

### Step 5: Start The Logbook

```bash
# Standard deployment (4+ GB RAM)
sudo docker compose up -d

# For NAS with limited RAM (2-4 GB), use the minimal profile
sudo docker compose -f docker-compose.yml -f docker-compose.minimal.yml up -d

# Verify all containers are running
sudo docker compose ps
```

### Step 6: Access The Logbook

Open your browser: `http://YOUR-SYNOLOGY-IP:3000`

Complete the onboarding wizard to set up your organization.

---

## Method 2: Container Manager UI (DSM 7.2+)

Use the Synology Container Manager GUI to deploy via Docker Compose.

### Step 1: Prepare Files

1. Enable SSH and connect (see Method 1, Steps 1-2)
2. Create the project directory and clone:

```bash
sudo mkdir -p /volume1/docker/the-logbook
cd /volume1/docker/the-logbook
sudo git clone https://github.com/thegspiro/the-logbook.git .
sudo cp .env.example .env
```

3. Edit `.env` with secure values (see Method 1, Step 4 for automated setup, or manually edit with `sudo nano .env`)

### Step 2: Create the Project in Container Manager

1. Open **Container Manager** from DSM
2. Go to **Project** in the left sidebar
3. Click **Create**
4. Configure:

| Setting | Value |
|---------|-------|
| **Project name** | `the-logbook` |
| **Path** | `/volume1/docker/the-logbook` |
| **Source** | Use existing `docker-compose.yml` |

5. Container Manager will detect the `docker-compose.yml` automatically
6. Click **Next**, review the settings, and click **Done**

> **For minimal profile**: Before creating the project, combine compose files:
> ```bash
> # Create a merged compose for Container Manager
> sudo docker compose -f docker-compose.yml -f docker-compose.minimal.yml config > docker-compose.synology.yml
> ```
> Then point Container Manager to `docker-compose.synology.yml` instead.

### Step 3: Start the Project

1. In Container Manager > Project, select `the-logbook`
2. Click **Start** (or it may auto-start)
3. Monitor container health in the **Container** tab

---

## Synology-Specific Configuration

### Port Conflicts

Synology DSM uses several ports by default. Check for conflicts:

| Port | Default DSM Use | The Logbook Use | Solution |
|------|----------------|-----------------|----------|
| 80 | DSM HTTP redirect | Nginx (optional) | Change `NGINX_HTTP_PORT` in `.env` |
| 443 | DSM HTTPS | Nginx (optional) | Change `NGINX_HTTPS_PORT` in `.env` |
| 3306 | MariaDB 10 (if installed) | MySQL 8.0 (internal) | No conflict — DB port is not exposed by default |

The default ports (3000 for frontend, 3001 for backend) typically don't conflict with DSM services.

If you need to change ports, edit `.env`:

```bash
FRONTEND_PORT=7880
BACKEND_PORT=7881
```

### Volume Paths

By default, Docker volumes are stored in `/volume1/@docker/volumes/`. For better organization or to use a specific volume/share:

```bash
# Edit docker-compose.yml to use bind mounts instead of named volumes
# Example: store MySQL data on a specific share
# volumes:
#   - /volume1/docker/the-logbook/data/mysql:/var/lib/mysql
```

> **Tip**: Keep the default named volumes unless you have a specific reason to change. They work well with Synology's storage management.

### Shared Folder Permissions

If you encounter permission errors:

```bash
# Fix ownership for the project directory
sudo chown -R 1000:1000 /volume1/docker/the-logbook/uploads

# Ensure Docker socket is accessible
sudo chmod 666 /var/run/docker.sock
```

### Static IP (Recommended)

Set a static IP for your NAS so The Logbook is always accessible at the same address:

1. **DSM** > **Control Panel** > **Network** > **Network Interface**
2. Select your active interface > **Edit**
3. Switch from DHCP to **Use manual configuration**
4. Set your desired IP, subnet mask, and gateway

Or configure at your router level via DHCP reservation.

### Resource Limits

Synology Container Manager allows setting resource limits per container. For a NAS with limited RAM:

**Via SSH:**
```bash
# Use the minimal profile which sets conservative resource limits
sudo docker compose -f docker-compose.yml -f docker-compose.minimal.yml up -d
```

**Via Container Manager UI:**
1. Go to **Container** tab
2. Select a container > **Edit**
3. Under **Resources**, set:
   - Backend: 1 GB memory limit
   - MySQL: 1 GB memory limit
   - Redis: 256 MB memory limit
   - Frontend: 256 MB memory limit

---

## Reverse Proxy with DSM

Synology DSM has a built-in reverse proxy that's the easiest way to add HTTPS and a clean URL.

### Set Up DSM Reverse Proxy

1. Go to **Control Panel** > **Login Portal** > **Advanced**
2. Click **Reverse Proxy**
3. Click **Create** and configure:

**Rule 1 — Frontend:**

| Setting | Value |
|---------|-------|
| **Description** | The Logbook Frontend |
| **Source Protocol** | HTTPS |
| **Source Hostname** | `logbook.yourdomain.com` (or `*`) |
| **Source Port** | 443 |
| **Destination Protocol** | HTTP |
| **Destination Hostname** | `localhost` |
| **Destination Port** | 3000 |

**Rule 2 — Backend API:**

| Setting | Value |
|---------|-------|
| **Description** | The Logbook API |
| **Source Protocol** | HTTPS |
| **Source Hostname** | `logbook.yourdomain.com` |
| **Source Port** | 443 |
| **Source Path** | `/api/*` |
| **Destination Protocol** | HTTP |
| **Destination Hostname** | `localhost` |
| **Destination Port** | 3001 |

> **Note**: Create the `/api/*` rule first (more specific), then the catch-all frontend rule.

### SSL with Let's Encrypt

Synology DSM can automatically obtain and renew Let's Encrypt certificates:

1. Go to **Control Panel** > **Security** > **Certificate**
2. Click **Add** > **Add a new certificate**
3. Select **Get a certificate from Let's Encrypt**
4. Enter your domain name and email
5. After certificate is created, click **Settings** to assign it to the reverse proxy

> **Prerequisite**: Port 80 must be accessible from the internet for Let's Encrypt HTTP-01 challenge. Configure port forwarding on your router if needed.

### DDNS (Dynamic DNS)

If you don't have a static public IP, use Synology's built-in DDNS:

1. Go to **Control Panel** > **External Access** > **DDNS**
2. Click **Add** and select a provider (Synology offers a free one)
3. Configure your hostname (e.g., `my-station.synology.me`)
4. Use this hostname in your reverse proxy and `ALLOWED_ORIGINS`

---

## Backups

### Hyper Backup (Recommended)

Use Synology's Hyper Backup to back up the entire Docker project:

1. Open **Hyper Backup** from DSM
2. Click **+** to create a new backup task
3. Select your backup destination (external drive, another NAS, cloud)
4. Under **Data Backup**, select the folder: `/volume1/docker/the-logbook`
5. Set a schedule (daily recommended)

### Application-Level Backup

For database-consistent backups:

```bash
# Manual backup
sudo docker compose exec backend /app/scripts/backup.sh

# Schedule via DSM Task Scheduler:
# Control Panel > Task Scheduler > Create > Scheduled Task > User-defined script
# Command:
cd /volume1/docker/the-logbook && sudo docker compose exec -T backend /app/scripts/backup.sh
```

### Database Dump

```bash
# Export database
sudo docker compose exec mysql mysqldump -u root -p the_logbook > /volume1/docker/the-logbook/backup.sql

# Restore database
sudo docker compose exec -T mysql mysql -u root -p the_logbook < /volume1/docker/the-logbook/backup.sql
```

---

## Updating

```bash
cd /volume1/docker/the-logbook

# Stop services
sudo docker compose down

# Pull latest code
sudo git pull

# Rebuild containers
sudo docker compose build

# Start services
sudo docker compose up -d

# Run database migrations
sudo docker compose exec backend alembic upgrade head
```

Or via Container Manager: **Project** > `the-logbook` > **Action** > **Build and Start**.

---

## Troubleshooting

### Docker Not Available

**Error**: `docker: command not found`

Ensure Container Manager is installed:
1. Open **Package Center** in DSM
2. Search for **Container Manager** (DSM 7.2+) or **Docker** (older DSM)
3. Install it

### Permission Denied

```bash
# Add your user to the Docker group
sudo synogroup --add docker $(whoami)

# Or run commands with sudo
sudo docker compose ps
```

### Containers Won't Start / Health Check Fails

```bash
# Check container logs
sudo docker compose logs --tail=100 backend
sudo docker compose logs --tail=100 mysql

# If MySQL takes a long time to start on first run, wait 2-3 minutes
# The healthcheck has a start_period to allow for initialization

# Check resource usage
sudo docker stats --no-stream
```

### Out of Memory

```bash
# Check available memory
free -h

# Switch to minimal profile
sudo docker compose down
sudo docker compose -f docker-compose.yml -f docker-compose.minimal.yml up -d

# Consider adding RAM to your NAS (most models support upgrades)
```

### Port Already in Use

```bash
# Check what's using a port
sudo netstat -tulpn | grep :3000

# Change the port in .env
# FRONTEND_PORT=7880
# Then restart
sudo docker compose down && sudo docker compose up -d
```

### DSM Reverse Proxy Returns 502

1. Verify the containers are running: `sudo docker compose ps`
2. Test direct access: `http://YOUR-NAS-IP:3000`
3. Check that the reverse proxy destination port matches the container port
4. If using WebSocket features, add custom headers in the reverse proxy:
   - **Control Panel** > **Login Portal** > **Reverse Proxy** > select rule > **Custom Header**
   - Add: `Upgrade` = `$http_upgrade`, `Connection` = `$connection_upgrade`

### Slow Performance

1. **Use SSD cache**: Enable SSD caching in Storage Manager for Docker volume
2. **Add RAM**: Most Synology NAS models support user-upgradeable RAM
3. **Reduce profile**: Switch to minimal if running standard
4. **Check disk health**: Storage Manager > HDD/SSD for SMART status

---

## Summary

| Step | Action |
|------|--------|
| 1 | Install Container Manager from Package Center |
| 2 | Enable SSH, connect to NAS |
| 3 | Clone repo to `/volume1/docker/the-logbook` |
| 4 | Configure `.env` with secure credentials |
| 5 | Run `sudo docker compose up -d` |
| 6 | Access at `http://YOUR-NAS-IP:3000` |
| 7 | Complete onboarding wizard |
| 8 | (Optional) Set up DSM reverse proxy with SSL |
| 9 | Configure Hyper Backup for automated backups |

**Need help?** See the [Troubleshooting Guide](../troubleshooting/README.md) or open a [GitHub Issue](https://github.com/thegspiro/the-logbook/issues).
