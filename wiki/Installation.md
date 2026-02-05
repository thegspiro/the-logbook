# Installation Guide

This guide covers all installation methods for The Logbook.

---

## Choose Your Installation Method

| Method | Best For | Difficulty | Time |
|--------|----------|------------|------|
| **[Unraid](#unraid-one-command)** | Unraid users | ⭐ Easy | 5-10 min |
| **[Docker Compose](#docker-compose)** | General use | ⭐⭐ Moderate | 10-15 min |
| **[Development](#development-setup)** | Contributors | ⭐⭐⭐ Advanced | 20-30 min |

---

## Unraid (One Command!)

**Recommended for Unraid users**

```bash
curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/unraid/unraid-setup.sh | bash
```

This automated script handles everything:
- ✅ Container cleanup
- ✅ Secure password generation
- ✅ Directory creation with proper permissions
- ✅ Build and deployment
- ✅ Verification

**Access:** `http://YOUR-UNRAID-IP:7880`

**[→ Full Unraid Guide](Unraid-Quick-Start)**

---

## Docker Compose

**Recommended for most users**

### Prerequisites

- Docker 20.10+ and Docker Compose 2.0+
- 2GB RAM minimum (4GB recommended)
- 10GB disk space
- Linux, macOS, or Windows with WSL2

### Quick Install

```bash
# Clone repository
git clone https://github.com/thegspiro/the-logbook.git
cd the-logbook

# Copy environment file
cp .env.example .env

# Generate secure keys
openssl rand -hex 32  # Copy to SECRET_KEY
openssl rand -hex 32  # Copy to ENCRYPTION_KEY
openssl rand -hex 16  # Copy to ENCRYPTION_SALT
openssl rand -base64 32  # Copy to DB_PASSWORD

# Edit .env with your settings
nano .env

# Start services
docker-compose up -d

# View logs
docker-compose logs -f
```

### Access Application

- **Frontend:** http://localhost:3000
- **Backend API:** http://localhost:3001
- **API Docs:** http://localhost:3001/docs

### Required Environment Variables

Edit `.env` file:

```bash
# REQUIRED: Generate these!
SECRET_KEY=your_generated_secret_key_here
ENCRYPTION_KEY=your_generated_encryption_key_here
ENCRYPTION_SALT=your_generated_encryption_salt_here
DB_PASSWORD=your_generated_db_password_here
REDIS_PASSWORD=your_generated_redis_password_here

# Database Configuration
DB_HOST=db
DB_PORT=3306
DB_NAME=the_logbook
DB_USER=logbook_user

# CORS Configuration (update with your IP/domain)
ALLOWED_ORIGINS=http://localhost:3000

# Application Settings
ENVIRONMENT=production
DEBUG=false
```

---

## Development Setup

**For contributors and developers**

### Prerequisites

- Python 3.13+
- Node.js 22+
- MySQL 8.0+ or MariaDB 10.11+
- Redis 7+

### Backend Setup

```bash
# Clone repository
git clone https://github.com/thegspiro/the-logbook.git
cd the-logbook/backend

# Create virtual environment
python3.13 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install --upgrade pip
pip install -r requirements.txt
pip install -r requirements-dev.txt

# Configure environment
cp .env.example .env
nano .env  # Edit with your settings

# Run migrations
alembic upgrade head

# Start development server
uvicorn app.main:app --reload --host 0.0.0.0 --port 3001
```

### Frontend Setup

```bash
# In a new terminal
cd the-logbook/frontend

# Install dependencies
npm install

# Configure environment
cp .env.example .env
nano .env  # Update VITE_API_URL=http://localhost:3001

# Start development server
npm run dev
```

**Access:** http://localhost:5173

**[→ Full Development Guide](Development-Backend)**

---

## Production Deployment

### Docker Compose Production

```bash
# Use production compose file
docker-compose -f docker-compose.prod.yml up -d

# With SSL/TLS
docker-compose -f docker-compose.prod-ssl.yml up -d
```

### Environment Configuration

Production `.env` checklist:

- [ ] Generated strong `SECRET_KEY` (64+ characters)
- [ ] Generated strong `ENCRYPTION_KEY` (64+ characters)
- [ ] Set strong database passwords
- [ ] Set `ENVIRONMENT=production`
- [ ] Set `DEBUG=false`
- [ ] Configured `ALLOWED_ORIGINS` with actual domain
- [ ] Configured SMTP for email (optional)
- [ ] Set correct timezone in `TZ`
- [ ] Configured backup schedule
- [ ] Reviewed all security settings

### SSL/TLS Setup

#### Using Reverse Proxy (Recommended)

```yaml
# nginx reverse proxy example
server {
    listen 443 ssl http2;
    server_name logbook.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

#### Using Let's Encrypt

```bash
# With Certbot
certbot --nginx -d logbook.yourdomain.com

# Auto-renewal
certbot renew --dry-run
```

---

## Post-Installation

### 1. Complete Onboarding

Navigate to your frontend URL and complete the setup wizard:

1. Create organization
2. Set up first admin user
3. Configure security settings
4. Enable desired modules
5. Set up integrations (optional)

**[→ Onboarding Guide](Onboarding)**

### 2. Configure Modules

Enable/disable modules based on your needs:

```bash
# In .env file
MODULE_TRAINING_ENABLED=true
MODULE_COMPLIANCE_ENABLED=true
MODULE_SCHEDULING_ENABLED=true
MODULE_ELECTIONS_ENABLED=true
```

**[→ Module Configuration](Configuration-Modules)**

### 3. Set Up Backups

```bash
# Configure automated backups
BACKUP_ENABLED=true
BACKUP_SCHEDULE=0 2 * * *  # Daily at 2 AM
BACKUP_RETENTION_DAYS=30
```

Manual backup:
```bash
docker-compose exec backend /app/scripts/backup.sh
```

### 4. Security Hardening

See **[Security Configuration](Configuration-Security)** for:
- Rate limiting
- Multi-factor authentication
- Session security
- Audit logging
- HIPAA compliance

---

## Verification

### Health Checks

```bash
# Backend health
curl http://localhost:3001/health

# Frontend accessibility
curl -I http://localhost:3000

# Database connection
docker-compose exec db mysql -u logbook_user -p -e "SELECT 1"

# Redis connection
docker-compose exec redis redis-cli ping
```

### Container Status

```bash
# All containers should be "Up" and "healthy"
docker-compose ps

# Expected output:
# logbook-frontend    Up (healthy)
# logbook-backend     Up (healthy)
# logbook-db          Up (healthy)
# logbook-redis       Up (healthy)
```

### Log Verification

```bash
# Check for errors
docker-compose logs --tail=50 backend
docker-compose logs --tail=50 frontend

# Expected: No ERROR or CRITICAL messages
```

---

## Troubleshooting

If you encounter issues, see:

- **[Troubleshooting Guide](Troubleshooting)** - Common problems
- **[Container Issues](Troubleshooting-Containers)** - Docker problems
- **[Frontend Issues](Troubleshooting-Frontend)** - UI problems
- **[Backend Issues](Troubleshooting-Backend)** - API problems

### Common Issues

**Port already in use:**
```bash
# Change ports in .env
FRONTEND_PORT=8080
BACKEND_PORT=8081

# Restart
docker-compose down
docker-compose up -d
```

**Permission denied:**
```bash
# Fix permissions
sudo chown -R $USER:$USER .
chmod -R 755 .
```

**Database connection failed:**
```bash
# Check database is running
docker-compose ps db

# View database logs
docker-compose logs db

# Verify credentials in .env match
```

---

## Updating

### Update to Latest Version

```bash
cd the-logbook

# Stop services
docker-compose down

# Backup first!
docker-compose exec backend /app/scripts/backup.sh

# Pull latest code
git pull

# Rebuild containers
docker-compose build --no-cache

# Start services
docker-compose up -d

# Run migrations
docker-compose exec backend alembic upgrade head
```

### Unraid Updates

```bash
cd /mnt/user/appdata/the-logbook/unraid
./unraid-setup.sh
# Choose option 2 (Update)
```

---

## Uninstallation

### Remove Containers

```bash
# Stop and remove containers
docker-compose down

# Remove volumes (WARNING: deletes all data!)
docker-compose down -v

# Remove images
docker rmi the-logbook-frontend:local
docker rmi the-logbook-backend:local
```

### Remove Files

```bash
# Development
rm -rf the-logbook/

# Unraid
rm -rf /mnt/user/appdata/the-logbook/
rm -rf /mnt/user/backups/the-logbook/
```

---

## Next Steps

1. **[Complete Onboarding](Onboarding)**
2. **[Configure Modules](Configuration-Modules)**
3. **[Set Up Security](Security-Overview)**
4. **[Create Users](Role-System)**
5. **[Review Troubleshooting](Troubleshooting)**

---

**Need help?** [GitHub Issues](https://github.com/thegspiro/the-logbook/issues) | [Discussions](https://github.com/thegspiro/the-logbook/discussions)
