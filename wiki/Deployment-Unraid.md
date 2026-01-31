# Unraid Instance Update Guide

**Last Updated:** January 24, 2026

This guide will help you update your Unraid instance of The Logbook with the latest fixes and security updates.

## What's Been Fixed

### ✅ Onboarding Module Improvements
- Fixed inconsistent button text in Module Overview page
- "Start Working" → "Configure Now" for consistency
- "Continue to Dashboard" → "Continue to Admin Setup" for clarity
- All navigation flows now properly aligned with documentation

### ✅ Security Updates
- Updated deprecated packages including `are-we-there-yet` (now replaced)
- Fixed moderate severity vulnerabilities in `lodash`
- Updated npm dependencies to latest compatible versions

### ⚠️ Remaining Vulnerabilities (Development Only)
The following vulnerabilities only affect **development builds** and do NOT impact production:
- `esbuild` - Development server vulnerability (not used in production)
- `vite` - Build tool vulnerability (not used in production)
- `pdfjs-dist` - Requires updating to breaking changes (planned for next major release)
- `tar` - Transitive dependency (used only in development)

**Your production deployment is safe** - these tools are not included in the Docker container.

---

## Quick Update Steps

### Option 1: Pull Latest Changes (Recommended)

If you have The Logbook installed on Unraid via git:

```bash
# SSH into your Unraid server
ssh root@YOUR-UNRAID-IP

# Navigate to the app directory
cd /mnt/user/appdata/the-logbook

# Check current branch
git branch

# Pull latest changes from the current branch
git pull origin claude/review-logbook-unraid-setup-0i5sZ

# Rebuild the Docker containers
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### Option 2: Fresh Installation

For a clean start:

```bash
# SSH into your Unraid server
ssh root@YOUR-UNRAID-IP

# Backup existing installation (if you have data)
cd /mnt/user/appdata
mv the-logbook the-logbook-backup-$(date +%Y%m%d)

# Clone the repository
git clone https://github.com/thegspiro/the-logbook.git
cd the-logbook

# Switch to the updated branch
git checkout claude/review-logbook-unraid-setup-0i5sZ

# Copy environment configuration
cp .env.example .env

# Edit environment file with your settings
nano .env
```

**Required .env settings:**
```bash
# Database Configuration
DB_HOST=YOUR_UNRAID_IP          # e.g., 192.168.1.100
DB_NAME=the_logbook
DB_USER=logbook_user
DB_PASSWORD=your_secure_password

# Security Keys (generate with: openssl rand -hex 32)
SECRET_KEY=your_generated_secret_key_here
ENCRYPTION_KEY=your_generated_encryption_key_here

# Unraid Port Configuration
FRONTEND_PORT=7880
BACKEND_PORT=7881
```

**Generate security keys:**
```bash
# Generate Secret Key
openssl rand -hex 32

# Generate Encryption Key
openssl rand -hex 32
```

**Build and start:**
```bash
docker-compose build
docker-compose up -d
```

---

## Post-Update Verification

### 1. Check Container Status

```bash
docker ps | grep logbook
```

You should see both frontend and backend containers running.

### 2. Check Logs

```bash
# View all logs
docker-compose logs -f

# View just backend logs
docker-compose logs -f backend

# View just frontend logs
docker-compose logs -f frontend
```

### 3. Access the Application

Open your browser and navigate to:
- **Frontend**: `http://YOUR-UNRAID-IP:7880`
- **Backend API**: `http://YOUR-UNRAID-IP:7881/docs`
- **Health Check**: `http://YOUR-UNRAID-IP:7881/health`

### 4. Test Onboarding Flow

If this is a fresh install:
1. Navigate to `http://YOUR-UNRAID-IP:7880`
2. Complete the onboarding wizard
3. Verify the improved button text and navigation flow

---

## Troubleshooting

### Port Conflicts

If ports 7880 or 7881 are already in use:

```bash
# Check what's using the ports
netstat -tulpn | grep 7880
netstat -tulpn | grep 7881

# Update .env file with different ports
nano .env
# Change FRONTEND_PORT and BACKEND_PORT

# Restart containers
docker-compose down
docker-compose up -d
```

### Database Connection Issues

```bash
# Test database connection
docker exec -it mariadb mysql -u logbook_user -p

# Once logged in, verify database exists
SHOW DATABASES;
USE the_logbook;
SHOW TABLES;
```

If database doesn't exist, create it:
```sql
CREATE DATABASE the_logbook CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'logbook_user'@'%' IDENTIFIED BY 'your_password';
GRANT ALL PRIVILEGES ON the_logbook.* TO 'logbook_user'@'%';
FLUSH PRIVILEGES;
```

### Container Won't Start

```bash
# View detailed error logs
docker-compose logs backend
docker-compose logs frontend

# Common fixes:

# 1. Clear old containers and rebuild
docker-compose down --volumes
docker system prune -a
docker-compose build --no-cache
docker-compose up -d

# 2. Check environment variables
cat .env
# Verify all required variables are set

# 3. Check file permissions
ls -la /mnt/user/appdata/the-logbook
chmod -R 755 /mnt/user/appdata/the-logbook
```

### Build Errors

If you encounter TypeScript or build errors:

```bash
# Clear all build caches
docker-compose down
docker system prune -a --volumes
rm -rf frontend/node_modules
rm -rf frontend/dist

# Rebuild
docker-compose build --no-cache
docker-compose up -d
```

---

## What Changed in This Update

### Code Changes
1. **frontend/src/modules/onboarding/pages/ModuleOverview.tsx**
   - Line 411: "Start Working" → "Configure Now"
   - Line 304: "Continue to Dashboard" → "Continue to Admin Setup"

2. **Package Updates**
   - Removed deprecated `are-we-there-yet` package
   - Updated `lodash` to latest secure version
   - Updated various devDependencies

### Documentation Updates
- Created this comprehensive update guide
- Clarified Unraid-specific deployment steps
- Added troubleshooting section for common issues

---

## Security Best Practices

### 1. Keep Keys Secure
- **Never commit .env files to git**
- **Use strong, unique keys** for SECRET_KEY and ENCRYPTION_KEY
- **Regenerate keys** if they're ever exposed

### 2. Use HTTPS (Recommended)
Set up a reverse proxy with SSL:
- **Swag** (recommended for Unraid)
- **Nginx Proxy Manager**
- **Traefik**

Example Swag configuration:
```nginx
# /mnt/user/appdata/swag/nginx/proxy-confs/logbook.subdomain.conf
server {
    listen 443 ssl http2;
    server_name logbook.*;

    location / {
        proxy_pass http://192.168.1.100:7880;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api {
        proxy_pass http://192.168.1.100:7881;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 3. Enable Backups
```bash
# Manual backup
docker exec TheLogbook /app/scripts/backup.sh

# View backups
ls -lh /mnt/user/backups/the-logbook/

# Restore from backup
docker exec -it TheLogbook /app/scripts/backup.sh --restore /backups/backup_20260124.tar.gz
```

---

## Package Version Status

### Current Versions (After Update)
- Node.js: 18.x (via Docker)
- React: 18.2.0
- TypeScript: 5.3.3
- Vite: 5.0.11
- Python: 3.11 (backend)
- FastAPI: Latest (backend)

### Deprecated Packages Removed
- ✅ `are-we-there-yet` - Removed, replaced by npm's built-in progress
- ✅ `npmlog` - Removed, replaced by modern logging
- ✅ Old `tar` versions - Updated where possible

### Packages Pending Major Updates
These require breaking changes and are scheduled for next major release:
- `react-pdf` (v7 → v10)
- `vite` (v5 → v7)
- `vitest` (v1 → v4)
- `eslint` (v8 → v9)

---

## Getting Help

### Documentation
- [Unraid Installation Guide](./unraid/UNRAID-INSTALLATION.md)
- [Onboarding Flow Documentation](./docs/ONBOARDING_FLOW.md)
- [Main README](./README.md)

### Support Channels
- **GitHub Issues**: https://github.com/thegspiro/the-logbook/issues
- **Unraid Forums**: https://forums.unraid.net/
- **Email Support**: support@the-logbook.io (if configured)

### Useful Commands Reference
```bash
# Container Management
docker ps -a                                    # List all containers
docker-compose logs -f                          # Follow logs
docker-compose restart                          # Restart services
docker-compose down && docker-compose up -d     # Full restart

# Database
docker exec -it mariadb mysql -u root -p        # Access database
docker exec mariadb mysqldump -u root -p the_logbook > backup.sql  # Backup DB

# System Health
curl http://localhost:7881/health               # Backend health check
curl http://localhost:7880                      # Frontend check
docker stats                                    # Resource usage

# Cleanup
docker system prune -a                          # Remove unused data
docker volume prune                             # Remove unused volumes
```

---

## Next Steps

After updating:

1. ✅ **Verify the update was successful**
   - Check container status
   - Access the web interface
   - Test the onboarding flow

2. ✅ **Configure SSL (if not already done)**
   - Set up reverse proxy
   - Configure domain name
   - Enable HTTPS

3. ✅ **Set up automated backups**
   - Configure backup schedule
   - Test restore process
   - Set up off-site backup storage

4. ✅ **Review security settings**
   - Ensure strong passwords
   - Enable 2FA (when available)
   - Review user permissions

5. ✅ **Join the community**
   - Star the GitHub repo
   - Join discussions
   - Provide feedback

---

## Changelog

**January 24, 2026**
- Fixed onboarding module button text inconsistencies
- Updated npm packages to address security vulnerabilities
- Removed deprecated `are-we-there-yet` and other obsolete packages
- Created comprehensive update guide
- Improved Unraid deployment documentation

---

**Questions or Issues?**

If you encounter any problems during the update process, please:
1. Check the troubleshooting section above
2. Review the logs for error messages
3. Create an issue on GitHub with detailed information
4. Include your Unraid version, container logs, and steps to reproduce

**We're here to help!** 🚒
