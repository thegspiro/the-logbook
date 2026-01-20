# The Logbook - Unraid Installation Guide

Complete guide for installing The Logbook on Unraid using Community Applications.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Installation](#quick-installation)
3. [Detailed Setup](#detailed-setup)
4. [Configuration](#configuration)
5. [Port Conflicts](#port-conflicts)
6. [Database Setup](#database-setup)
7. [Troubleshooting](#troubleshooting)
8. [Backup Configuration](#backup-configuration)
9. [Updates](#updates)

---

## Prerequisites

### Required

- **Unraid 6.9.0 or later**
- **Community Applications plugin installed**
- **MySQL/MariaDB database** (can use existing Unraid MariaDB)
- **8GB RAM minimum** (16GB recommended for production)
- **20GB free disk space** (50GB+ recommended)

### Recommended (Optional)

- **Redis** (for caching - improves performance)
- **Reverse proxy** (nginx, Swag, or npm for HTTPS)
- **Backup destination** (for automated backups)

---

## Quick Installation

### Step 1: Install Community Applications Plugin

If not already installed:

1. Go to **Apps** tab in Unraid
2. Install **Community Applications** plugin
3. Restart Unraid (if prompted)

### Step 2: Search for The Logbook

1. Click **Apps** tab
2. Search for "The Logbook"
3. Click **Install**

### Step 3: Configure Required Settings

**IMPORTANT - Set these before clicking Apply:**

| Setting | Value | Notes |
|---------|-------|-------|
| **WebUI Port** | 7880 | Or any available port |
| **API Port** | 7881 | Or any available port |
| **Database Host** | Your Unraid IP or MariaDB container name | |
| **Database Name** | the_logbook | Create this database first |
| **Database User** | logbook_user | Create this user first |
| **Database Password** | *strong password* | **REQUIRED** |
| **Secret Key** | Generate with: `openssl rand -hex 32` | **REQUIRED** |
| **Encryption Key** | Generate with: `openssl rand -hex 32` | **REQUIRED** |

### Step 4: Generate Security Keys

Open Unraid terminal and run:

```bash
# Generate Secret Key
openssl rand -hex 32

# Generate Encryption Key
openssl rand -hex 32
```

Copy these values into the template fields.

### Step 5: Click Apply

Unraid will download and start The Logbook!

### Step 6: Access The Logbook

Open: `http://YOUR-UNRAID-IP:7880`

Complete the onboarding wizard to set up your organization.

**Done!** 🎉

---

## Detailed Setup

### Database Setup (MariaDB)

If you don't have MariaDB installed or need to create a new database:

#### Option 1: Use Existing MariaDB Container

1. **Open MariaDB Terminal**
   ```bash
   docker exec -it mariadb mysql -u root -p
   ```

2. **Create Database**
   ```sql
   CREATE DATABASE the_logbook CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```

3. **Create User**
   ```sql
   CREATE USER 'logbook_user'@'%' IDENTIFIED BY 'your_strong_password';
   GRANT ALL PRIVILEGES ON the_logbook.* TO 'logbook_user'@'%';
   FLUSH PRIVILEGES;
   EXIT;
   ```

#### Option 2: Install MariaDB from Community Apps

1. Search for **MariaDB** in Community Apps
2. Install with these settings:
   - Port: 3306 (default)
   - Root password: Set a strong password
   - AppData: `/mnt/user/appdata/mariadb`
3. After installation, follow Option 1 steps to create database

#### Option 3: Use Separate Database Stack

If you want a dedicated database for The Logbook:

1. Create `/mnt/user/appdata/the-logbook/docker-compose.yml`:

```yaml
version: '3.8'

services:
  db:
    image: mariadb:10.11
    container_name: logbook-db
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: change_me_root_password
      MYSQL_DATABASE: the_logbook
      MYSQL_USER: logbook_user
      MYSQL_PASSWORD: change_me_user_password
    volumes:
      - /mnt/user/appdata/the-logbook/mysql:/var/lib/mysql
    ports:
      - "3307:3306"  # Use non-standard port to avoid conflicts
    networks:
      - logbook

  redis:
    image: redis:7-alpine
    container_name: logbook-redis
    restart: unless-stopped
    command: redis-server --requirepass change_me_redis_password
    volumes:
      - /mnt/user/appdata/the-logbook/redis:/data
    ports:
      - "6380:6379"  # Use non-standard port
    networks:
      - logbook

networks:
  logbook:
    driver: bridge
```

2. Start the stack:
   ```bash
   cd /mnt/user/appdata/the-logbook
   docker-compose up -d
   ```

3. Use these settings in The Logbook template:
   - DB_HOST: 192.168.1.X (your Unraid IP)
   - DB_PORT: 3307
   - REDIS_HOST: 192.168.1.X
   - REDIS_PORT: 6380

---

## Configuration

### Port Configuration

**Default Ports** (conflict-free):
- **Frontend:** 7880 (WebUI)
- **Backend API:** 7881

**If Ports Are In Use:**

Check what's using a port:
```bash
netstat -tuln | grep 7880
```

Alternative ports you can use:
- 8880, 8881 (common alternatives)
- 9880, 9881
- Any high port (10000-65535)

**Update Template:**
1. Stop The Logbook container
2. Edit container
3. Change port mappings
4. Update `ALLOWED_ORIGINS` to match new port
5. Start container

### Path Configuration

**Recommended Unraid Paths:**

| Container Path | Host Path | Purpose |
|---------------|-----------|---------|
| /app/data | /mnt/user/appdata/the-logbook | Application data |
| /app/uploads | /mnt/user/appdata/the-logbook/uploads | User uploads |
| /backups | /mnt/user/backups/the-logbook | Backups |
| /app/logs | /mnt/user/appdata/the-logbook/logs | Application logs |

**Use Cache Drive:**

For best performance:
1. Set share to **Use cache: Yes**
2. Mover will move data to array during scheduled times
3. Uploads stay on cache for fast access

**Use Array Only:**

For maximum reliability:
1. Set share to **Use cache: No**
2. All data written directly to array
3. Slower but more redundant

### Environment Variables

**Essential Settings:**

```bash
ENVIRONMENT=production          # Always production for Unraid
DEBUG=false                     # MUST be false in production
TZ=America/New_York            # Your timezone

# Database (REQUIRED)
DB_HOST=192.168.1.10           # Your Unraid IP or container name
DB_PORT=3306
DB_NAME=the_logbook
DB_USER=logbook_user
DB_PASSWORD=strong_password_here

# Security Keys (REQUIRED - generate unique keys!)
SECRET_KEY=generate_with_openssl_rand_hex_32
ENCRYPTION_KEY=generate_with_openssl_rand_hex_32

# CORS (match your WebUI port)
ALLOWED_ORIGINS=http://192.168.1.10:7880
```

**Optional Settings:**

```bash
# Redis (Recommended for performance)
REDIS_HOST=192.168.1.10
REDIS_PORT=6379
REDIS_PASSWORD=redis_password_if_set

# Email Notifications
EMAIL_ENABLED=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM_EMAIL=noreply@yourdomain.com

# Backups
BACKUP_ENABLED=true
BACKUP_SCHEDULE=0 2 * * *      # Daily at 2 AM
BACKUP_RETENTION_DAYS=30

# Modules (Enable/Disable features)
MODULE_TRAINING_ENABLED=true
MODULE_COMPLIANCE_ENABLED=true
MODULE_SCHEDULING_ENABLED=true
MODULE_ELECTIONS_ENABLED=true
MODULE_FUNDRAISING_ENABLED=false
```

---

## Port Conflicts

### Common Unraid Port Conflicts

These ports are commonly used by Unraid and should be avoided:

| Port | Typical Use | Conflict |
|------|-------------|----------|
| 80 | HTTP | Unraid WebUI, nginx |
| 443 | HTTPS | Unraid WebUI, nginx |
| 3000 | Various | Grafana, many apps |
| 3306 | MySQL | MariaDB |
| 5432 | PostgreSQL | PostgreSQL |
| 6379 | Redis | Redis |
| 8080 | HTTP Alt | Many apps |
| 8443 | HTTPS Alt | Many apps |
| 9000 | Various | Portainer |

### Recommended Safe Ports

**The Logbook Defaults (Safe):**
- 7880 - Frontend WebUI
- 7881 - Backend API

**If These Conflict:**
- 10880, 10881
- 11880, 11881
- Any 5-digit port above 10000

### Checking Port Availability

```bash
# Check if port is in use
netstat -tuln | grep :7880

# List all listening ports
netstat -tuln | grep LISTEN

# Check from Unraid terminal
lsof -i :7880
```

---

## Database Setup Details

### Creating Database and User

**Method 1: Command Line**

```bash
# Access MariaDB
docker exec -it mariadb mysql -u root -p

# In MySQL prompt:
CREATE DATABASE the_logbook CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'logbook_user'@'%' IDENTIFIED BY 'YourStrongPasswordHere';
GRANT ALL PRIVILEGES ON the_logbook.* TO 'logbook_user'@'%';
FLUSH PRIVILEGES;
SHOW GRANTS FOR 'logbook_user'@'%';
EXIT;
```

**Method 2: phpMyAdmin** (if installed)

1. Login to phpMyAdmin
2. Go to **Databases**
3. Create new database: `the_logbook`
   - Collation: `utf8mb4_unicode_ci`
4. Go to **User accounts**
5. Add user account:
   - Username: `logbook_user`
   - Host: `%` (any host)
   - Password: Strong password
   - Grant all privileges on `the_logbook.*`

### Database Connection Testing

```bash
# Test connection from Unraid terminal
docker exec -it TheLogbook python -c "
from app.core.database import database_manager
import asyncio
async def test():
    try:
        await database_manager.connect()
        print('✓ Database connection successful')
    except Exception as e:
        print(f'✗ Connection failed: {e}')
asyncio.run(test())
"
```

### Common Database Issues

**Issue: Can't connect to database**

```bash
# Check MariaDB is running
docker ps | grep mariadb

# Check MariaDB logs
docker logs mariadb

# Verify credentials
docker exec -it mariadb mysql -h localhost -u logbook_user -p
```

**Issue: Access denied for user**

```sql
-- Recreate user with correct permissions
DROP USER IF EXISTS 'logbook_user'@'%';
CREATE USER 'logbook_user'@'%' IDENTIFIED BY 'password';
GRANT ALL PRIVILEGES ON the_logbook.* TO 'logbook_user'@'%';
FLUSH PRIVILEGES;
```

**Issue: Table doesn't exist**

```bash
# Run database migrations
docker exec -it TheLogbook alembic upgrade head
```

---

## Troubleshooting

### Container Won't Start

**Check Logs:**
```bash
docker logs TheLogbook
```

**Common Issues:**

1. **Port Already in Use**
   ```bash
   # Find what's using the port
   netstat -tuln | grep :7880

   # Solution: Change to different port in template
   ```

2. **Database Connection Failed**
   ```bash
   # Verify database is running
   docker ps | grep mariadb

   # Test connection
   docker exec -it mariadb mysql -u logbook_user -p

   # Check DB_HOST is correct (Unraid IP or container name)
   ```

3. **Missing Environment Variables**
   ```bash
   # Check container environment
   docker inspect TheLogbook | grep -A 20 "Env"

   # Ensure SECRET_KEY and DB_PASSWORD are set
   ```

### WebUI Not Accessible

1. **Check Container Status:**
   ```bash
   docker ps | grep TheLogbook
   ```

2. **Verify Port Mapping:**
   ```bash
   docker port TheLogbook
   ```

3. **Check Firewall:**
   ```bash
   # Unraid should allow by default, but verify:
   iptables -L -n | grep 7880
   ```

4. **Test Directly:**
   ```bash
   curl http://localhost:7880
   ```

### Performance Issues

**Slow Loading:**

1. **Enable Redis** (if not already):
   - Install Redis from Community Apps
   - Add REDIS_HOST and REDIS_PORT to template

2. **Check Resource Usage:**
   ```bash
   docker stats TheLogbook
   ```

3. **Increase Container Resources:**
   - Stop container
   - Edit template
   - Add: `--memory=4g --cpus=2` to Extra Parameters

**Database Slow:**

```sql
-- Optimize database
docker exec -it mariadb mysqlcheck -u root -p --optimize the_logbook

-- Check table sizes
docker exec -it mariadb mysql -u root -p -e "
SELECT table_schema, table_name,
       ROUND((data_length + index_length) / 1024 / 1024, 2) as 'Size (MB)'
FROM information_schema.tables
WHERE table_schema = 'the_logbook'
ORDER BY (data_length + index_length) DESC;
"
```

### Can't Access from Other Devices

1. **Check Unraid Settings:**
   - Settings → Network Settings
   - Ensure network bridge is properly configured

2. **Update ALLOWED_ORIGINS:**
   ```bash
   # In container template, set:
   ALLOWED_ORIGINS=http://192.168.1.10:7880,http://unraid.local:7880
   ```

3. **Check Router/Firewall:**
   - Ensure port 7880 is not blocked
   - Check any VLANs or network isolation

### SSL/HTTPS Setup (with Reverse Proxy)

**Using Swag (Recommended):**

1. Install **Swag** from Community Apps

2. Create proxy conf: `/mnt/user/appdata/swag/nginx/proxy-confs/logbook.subdomain.conf`

```nginx
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name logbook.*;

    include /config/nginx/ssl.conf;

    location / {
        include /config/nginx/proxy.conf;
        resolver 127.0.0.11 valid=30s;
        set $upstream_app TheLogbook;
        set $upstream_port 3000;
        set $upstream_proto http;
        proxy_pass $upstream_proto://$upstream_app:$upstream_port;
    }

    location /api {
        include /config/nginx/proxy.conf;
        resolver 127.0.0.11 valid=30s;
        set $upstream_app TheLogbook;
        set $upstream_port 3001;
        set $upstream_proto http;
        proxy_pass $upstream_proto://$upstream_app:$upstream_port;
    }
}
```

3. Restart Swag container

4. Access via: `https://logbook.yourdomain.com`

**Using Nginx Proxy Manager:**

1. Add Proxy Host
2. Domain: `logbook.yourdomain.com`
3. Forward Hostname/IP: `192.168.1.X` (Unraid IP)
4. Forward Port: `7880`
5. Enable SSL with Let's Encrypt
6. Save

---

## Backup Configuration

### Automated Backups

Backups run automatically based on `BACKUP_SCHEDULE` (default: 2 AM daily).

**Backup Location:**
```
/mnt/user/backups/the-logbook/
```

**Backup Contents:**
- Database dump (compressed)
- Uploaded files
- Configuration (sanitized)
- Backup metadata

### Manual Backup

```bash
# Create backup
docker exec TheLogbook /app/scripts/backup.sh

# List backups
ls -lh /mnt/user/backups/the-logbook/

# Restore backup
docker exec -it TheLogbook /app/scripts/backup.sh --restore /backups/logbook_backup_20260120_020000.tar.gz
```

### Cloud Backup Integration

**AWS S3:**

```bash
# Add to template environment:
BACKUP_DESTINATION=s3
AWS_S3_BUCKET=your-bucket-name
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
```

**Azure Blob:**

```bash
BACKUP_DESTINATION=azure
AZURE_STORAGE_ACCOUNT=your-account
AZURE_STORAGE_KEY=your-key
AZURE_STORAGE_CONTAINER=logbook-backups
```

### Unraid Backup Best Practices

1. **Use Array for Backups:**
   - Set backup path to array: `/mnt/user/backups/`
   - Ensures redundancy if cache fails

2. **Enable Appdata Backup Plugin:**
   - Backs up entire appdata folder
   - Includes The Logbook configuration

3. **Test Restores:**
   ```bash
   # Test restore monthly
   docker exec -it TheLogbook /app/scripts/backup.sh --list
   docker exec -it TheLogbook /app/scripts/backup.sh --restore /backups/latest_backup.tar.gz
   ```

---

## Updates

### Updating The Logbook

**Method 1: Community Applications (Recommended)**

1. Go to **Apps** tab
2. Click **Check for Updates**
3. If update available, click **Update**
4. Unraid will pull new image and restart container

**Method 2: Docker Command**

```bash
# Stop container
docker stop TheLogbook

# Pull latest image
docker pull ghcr.io/thegspiro/the-logbook:latest

# Remove old container
docker rm TheLogbook

# Recreate from template (Unraid does this automatically)
```

**Method 3: Force Update**

```bash
# From Unraid terminal
docker pull ghcr.io/thegspiro/the-logbook:latest --no-cache
docker restart TheLogbook
```

### Update Best Practices

1. **Backup First:**
   ```bash
   docker exec TheLogbook /app/scripts/backup.sh
   ```

2. **Check Release Notes:**
   - Visit GitHub releases page
   - Review breaking changes
   - Note any migration steps

3. **Update During Low Usage:**
   - Updates typically take 2-5 minutes
   - Schedule during off-hours

4. **Verify After Update:**
   ```bash
   # Check container is running
   docker ps | grep TheLogbook

   # Check logs for errors
   docker logs TheLogbook --tail 50

   # Test WebUI
   curl http://localhost:7880/health
   ```

### Rollback to Previous Version

```bash
# Stop container
docker stop TheLogbook

# Pull specific version
docker pull ghcr.io/thegspiro/the-logbook:v1.0.0

# Restart container
docker start TheLogbook
```

---

## Advanced Configuration

### Custom Network (Docker Bridge)

If you want The Logbook on a custom network:

```bash
# Create network
docker network create logbook-network

# Add to template Extra Parameters:
--network=logbook-network

# Update DB_HOST to use container name if MariaDB is on same network
DB_HOST=mariadb
```

### Resource Limits

Add to Extra Parameters:

```bash
--memory=4g --memory-swap=4g --cpus=2 --cpu-shares=1024
```

### Health Checks

The Logbook includes built-in health checks. Monitor with:

```bash
# Check health status
docker inspect TheLogbook --format='{{.State.Health.Status}}'

# View health check logs
docker inspect TheLogbook --format='{{range .State.Health.Log}}{{.Output}}{{end}}'
```

---

## Support

### Getting Help

1. **Check Logs:**
   ```bash
   docker logs TheLogbook --tail 100
   ```

2. **Visit Support Forum:**
   - [Unraid Forums - The Logbook Thread](https://forums.unraid.net)
   - [GitHub Issues](https://github.com/thegspiro/the-logbook/issues)

3. **Community Support:**
   - Post in Unraid Community Applications support thread
   - Include:
     - Unraid version
     - Container logs
     - Template configuration (sanitized)

### Diagnostics

```bash
# Generate diagnostic report
docker exec TheLogbook python -c "
import platform, psutil, os
print(f'OS: {platform.platform()}')
print(f'Python: {platform.python_version()}')
print(f'CPU: {psutil.cpu_percent()}%')
print(f'RAM: {psutil.virtual_memory().percent}%')
print(f'Disk: {psutil.disk_usage(\"/\").percent}%')
"

# Export configuration (sanitized)
docker exec TheLogbook cat /app/.env | sed 's/=.*/=***/' > logbook-config.txt
```

---

## Security Best Practices

1. **Use Strong Passwords:**
   - Database password: 20+ characters
   - Generate with: `openssl rand -base64 32`

2. **Generate Unique Keys:**
   - Never use default keys
   - Generate new keys: `openssl rand -hex 32`

3. **Enable HTTPS:**
   - Use Swag or Nginx Proxy Manager
   - Let's Encrypt for free SSL certificates

4. **Regular Updates:**
   - Enable auto-updates in Community Apps
   - Check for updates weekly

5. **Backup Regularly:**
   - Daily automated backups
   - Test restores monthly
   - Store backups off-server

6. **Limit Access:**
   - Use Unraid VPN for remote access
   - Don't expose ports to internet directly
   - Use reverse proxy with authentication

7. **Monitor Logs:**
   ```bash
   # Check for suspicious activity
   docker logs TheLogbook | grep -i "error\|failed\|unauthorized"
   ```

---

## Unraid-Specific Tips

### Dashboard Integration

Add to Unraid dashboard:

1. Install **Organizr** or **Heimdall** from Community Apps
2. Add The Logbook as a tile
3. Icon URL: `https://raw.githubusercontent.com/thegspiro/the-logbook/main/unraid/icon.png`

### User Scripts

Create custom scripts in: `/boot/config/plugins/user.scripts/scripts/`

**Example: Daily Health Check**

```bash
#!/bin/bash
HEALTH=$(docker exec TheLogbook curl -s http://localhost:3001/health | grep -o '"status":"[^"]*"')
if [[ "$HEALTH" != *"healthy"* ]]; then
    echo "The Logbook health check failed!"
    # Send notification
fi
```

### Integration with Other Unraid Apps

- **Paperless-ngx:** Document management integration
- **Nextcloud:** File sharing and collaboration
- **Authentik:** SSO/LDAP authentication
- **Uptime Kuma:** Monitoring and alerts

---

## FAQ

**Q: Can I use an existing MariaDB instance?**
A: Yes! Just create a new database and user in your existing MariaDB.

**Q: Does this work with PostgreSQL?**
A: Currently only MySQL/MariaDB is supported.

**Q: Can I change ports after installation?**
A: Yes, stop container, edit template, change ports, restart.

**Q: How much RAM does it need?**
A: Minimum 2GB per container, 8GB total system. 16GB recommended.

**Q: Can I run multiple instances?**
A: Yes, use different ports and database names for each instance.

**Q: Is there a mobile app?**
A: Not yet, but the web interface is mobile-responsive.

**Q: Does it support ARM (Raspberry Pi)?**
A: Currently x86_64 only. ARM support planned for future release.

**Q: Can I use with Cloudflare Tunnel?**
A: Yes! Configure tunnel to point to your Unraid IP:7880.

---

## Next Steps

1. ✅ Install The Logbook from Community Apps
2. ✅ Complete initial setup wizard
3. ✅ Configure automated backups
4. ✅ Set up reverse proxy for HTTPS (optional)
5. ✅ Invite team members
6. ✅ Customize organization settings
7. ✅ Explore modules and features

**Welcome to The Logbook! ** 🚀
