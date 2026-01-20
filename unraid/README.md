# The Logbook - Unraid Integration

Official Unraid Community Applications package for The Logbook.

## Quick Links

- 📖 **[Installation Guide](./UNRAID-INSTALLATION.md)** - Complete setup instructions
- 🐳 **[Docker Compose](./docker-compose-unraid.yml)** - Alternative installation method
- 🚀 **[Community App Submission](./COMMUNITY-APP-SUBMISSION.md)** - For maintainers
- 💬 **[Support Forum](https://forums.unraid.net/)** - Get help from the community
- 🐛 **[Report Issues](https://github.com/your-org/the-logbook/issues)** - Bug reports

---

## Overview

The Logbook is a comprehensive, modular intranet platform designed specifically for fire departments, EMS, and emergency services organizations. Now optimized for Unraid!

### Key Features

✅ **Member Management** - Track members, roles, and contact information
✅ **Training Tracking** - Schedule and record training sessions
✅ **Equipment Inventory** - Manage gear, vehicles, and supplies
✅ **Event Scheduling** - Calendar with RSVP and check-ins
✅ **QR Code Check-Ins** - Touchless attendance tracking
✅ **Elections Management** - Conduct secure electronic voting
✅ **Document Management** - Policies, procedures, and files
✅ **Reporting & Analytics** - Comprehensive dashboards
✅ **Mobile Responsive** - Works on any device
✅ **HIPAA Compliant** - Secure PHI handling

---

## Installation

### Method 1: Community Applications (Recommended)

1. Open **Apps** tab in Unraid
2. Search for **"The Logbook"**
3. Click **Install**
4. Configure required settings
5. Click **Apply**

**That's it!** Access at `http://YOUR-UNRAID-IP:7880`

📖 **[Full Installation Guide →](./UNRAID-INSTALLATION.md)**

### Method 2: Docker Compose

For advanced users who want a self-contained stack:

```bash
# Copy docker-compose file
cp docker-compose-unraid.yml /mnt/user/appdata/the-logbook/docker-compose.yml

# Create and configure .env file
cd /mnt/user/appdata/the-logbook
nano .env

# Start services
docker-compose up -d
```

---

## Quick Start

### 1. Prerequisites

- Unraid 6.9.0 or later
- MySQL/MariaDB database
- 8GB RAM minimum

### 2. Install

Search for "The Logbook" in Community Applications.

### 3. Configure

**Required Settings:**
- WebUI Port: `7880` (or any available)
- API Port: `7881` (or any available)
- Database Host: Your Unraid IP
- Database Credentials: Create database first
- Secret Keys: Generate with `openssl rand -hex 32`

### 4. Access

Open: `http://YOUR-UNRAID-IP:7880`

Complete the onboarding wizard.

### 5. Enjoy!

Start managing your organization! 🎉

---

## System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| **Unraid Version** | 6.9.0+ | 6.12.0+ |
| **RAM** | 8 GB | 16 GB |
| **Storage** | 20 GB | 50 GB+ |
| **CPU Cores** | 2 | 4+ |

### Required Services

- **MySQL/MariaDB** - For data storage
- **Redis** (optional) - For caching (improves performance)

---

## Default Ports

Conflict-free default ports:

| Service | Port | Purpose |
|---------|------|---------|
| Frontend (WebUI) | 7880 | Web interface |
| Backend API | 7881 | API endpoint |

**Need different ports?** No problem! Change them in the template.

---

## File Structure

```
/mnt/user/appdata/the-logbook/
├── data/              # Application data
├── uploads/           # User uploaded files
├── logs/              # Application logs
├── mysql/             # Database files (if using compose)
├── redis/             # Redis data (if using compose)
└── docker-compose.yml # Compose file (if used)

/mnt/user/backups/the-logbook/
└── *.tar.gz           # Automated backups
```

---

## Configuration

### Environment Variables

All configuration via Unraid Docker template or `.env` file.

**Essential:**
```bash
DB_HOST=192.168.1.10       # Your Unraid IP
DB_NAME=the_logbook
DB_USER=logbook_user
DB_PASSWORD=strong_password
SECRET_KEY=generate_with_openssl
ENCRYPTION_KEY=generate_with_openssl
```

**Optional:**
```bash
REDIS_HOST=192.168.1.10
EMAIL_ENABLED=true
SMTP_HOST=smtp.gmail.com
MODULE_TRAINING_ENABLED=true
BACKUP_ENABLED=true
```

📖 **[Full Configuration Guide →](./UNRAID-INSTALLATION.md#configuration)**

---

## Database Setup

### Option 1: Use Existing MariaDB

```sql
CREATE DATABASE the_logbook CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'logbook_user'@'%' IDENTIFIED BY 'strong_password';
GRANT ALL PRIVILEGES ON the_logbook.* TO 'logbook_user'@'%';
FLUSH PRIVILEGES;
```

### Option 2: Install MariaDB from Community Apps

1. Install **MariaDB** from Apps
2. Create database using phpMyAdmin or command line

### Option 3: Use Included Docker Compose

The `docker-compose-unraid.yml` includes MariaDB and Redis.

📖 **[Database Setup Guide →](./UNRAID-INSTALLATION.md#database-setup)**

---

## Backup & Recovery

### Automated Backups

Backups run automatically based on schedule (default: daily at 2 AM).

**Backup Location:** `/mnt/user/backups/the-logbook/`

### Manual Backup

```bash
docker exec TheLogbook /app/scripts/backup.sh
```

### Restore

```bash
docker exec -it TheLogbook /app/scripts/backup.sh --restore /backups/backup_file.tar.gz
```

### Cloud Backup

Supports S3, Azure Blob, and Google Cloud Storage.

📖 **[Backup Guide →](./UNRAID-INSTALLATION.md#backup-configuration)**

---

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker logs TheLogbook

# Common issues:
# 1. Port conflict - change ports in template
# 2. Database connection - verify DB_HOST and credentials
# 3. Missing secrets - generate SECRET_KEY and ENCRYPTION_KEY
```

### Can't Access WebUI

```bash
# Verify container is running
docker ps | grep TheLogbook

# Check health
curl http://localhost:7880/health

# Test from another device
curl http://UNRAID-IP:7880
```

### Database Connection Error

```bash
# Test database connection
docker exec -it mariadb mysql -u logbook_user -p

# Verify database exists
SHOW DATABASES;
```

📖 **[Full Troubleshooting Guide →](./UNRAID-INSTALLATION.md#troubleshooting)**

---

## Updates

### Automatic Updates

Enable in Community Applications settings for automatic updates.

### Manual Update

```bash
# From Unraid terminal
docker pull ghcr.io/your-org/the-logbook:latest
docker restart TheLogbook
```

### Backup Before Update

```bash
docker exec TheLogbook /app/scripts/backup.sh
```

---

## Security

### Best Practices

✅ **Use Strong Passwords** - 20+ characters
✅ **Generate Unique Keys** - Never use defaults
✅ **Enable HTTPS** - Use reverse proxy (Swag, npm)
✅ **Regular Updates** - Keep container updated
✅ **Automated Backups** - Test restores monthly
✅ **Limit Access** - Use VPN for remote access

### Reverse Proxy (HTTPS)

**Using Swag:**

```nginx
# /mnt/user/appdata/swag/nginx/proxy-confs/logbook.subdomain.conf
server {
    listen 443 ssl http2;
    server_name logbook.*;

    location / {
        proxy_pass http://192.168.1.10:7880;
        # ... proxy settings
    }
}
```

📖 **[SSL Setup Guide →](./UNRAID-INSTALLATION.md#sslhttps-setup-with-reverse-proxy)**

---

## Support

### Getting Help

1. **Check Documentation**
   - [Installation Guide](./UNRAID-INSTALLATION.md)
   - [Troubleshooting](./UNRAID-INSTALLATION.md#troubleshooting)

2. **Search Forums**
   - [Unraid Community Forums](https://forums.unraid.net/)
   - Look for existing threads

3. **Create Support Thread**
   - Post in Docker Containers section
   - Include:
     - Unraid version
     - Container logs
     - Steps to reproduce issue

4. **Report Bugs**
   - [GitHub Issues](https://github.com/your-org/the-logbook/issues)
   - Include diagnostic information

### Useful Commands

```bash
# View logs
docker logs TheLogbook --tail 100 -f

# Container status
docker ps -a | grep TheLogbook

# Health check
curl http://localhost:3001/health

# Database access
docker exec -it mariadb mysql -u root -p

# Container shell
docker exec -it TheLogbook bash

# Restart container
docker restart TheLogbook
```

---

## Advanced

### Custom Network

```bash
# Create custom network
docker network create logbook-network

# Add to template Extra Parameters:
--network=logbook-network
```

### Resource Limits

```bash
# Add to Extra Parameters:
--memory=4g --cpus=2
```

### Multiple Instances

1. Use different ports for each instance
2. Use different database names
3. Use separate appdata directories

---

## Contributing

Want to improve The Logbook for Unraid?

1. Fork the repository
2. Make improvements
3. Test on Unraid
4. Submit pull request

**Areas needing help:**
- Documentation improvements
- Bug fixes
- Feature requests
- Community support

---

## License

The Logbook is open source software. See [LICENSE](../LICENSE) for details.

---

## Acknowledgments

- **Unraid Team** - For the amazing platform
- **Community Applications** - For the plugin ecosystem
- **Contributors** - Everyone who helps improve The Logbook

---

## Resources

### Documentation
- [Installation Guide](./UNRAID-INSTALLATION.md)
- [Community App Submission](./COMMUNITY-APP-SUBMISSION.md)
- [Main Documentation](../docs/)

### External Links
- [Official Website](#)
- [GitHub Repository](https://github.com/your-org/the-logbook)
- [Docker Hub](https://hub.docker.com/r/your-org/the-logbook)
- [Unraid Forums](https://forums.unraid.net/)

### Quick Reference
- [Docker Compose File](./docker-compose-unraid.yml)
- [XML Template](./the-logbook.xml)
- [Changelog](../CHANGELOG.md)

---

## Stay Connected

- 🌟 Star us on [GitHub](https://github.com/your-org/the-logbook)
- 💬 Join our [Community Forum](#)
- 🐦 Follow on [Twitter](#)
- 📧 Subscribe to [Newsletter](#)

---

**Made with ❤️ for Emergency Services**

_The Logbook - Serving those who serve_
