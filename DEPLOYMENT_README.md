# 🚒 Fire Department Intranet - Deployment Options

Repository: [https://github.com/thegspiro/fd-intranet](https://github.com/thegspiro/fd-intranet)

---

## 📋 Deployment Methods

We offer **three deployment methods** to suit different needs:

1. **Quick Deploy Script** (Recommended for most) - Automated Ubuntu setup
2. **Manual Deployment** - Step-by-step for custom configurations
3. **Docker Deployment** - Containerized for portability

---

## Method 1: Quick Deploy Script ⚡ (Recommended)

**Best for:** Ubuntu 20.04/22.04 servers, straightforward deployments

### Prerequisites:
- Fresh Ubuntu 20.04 or 22.04 LTS server
- Root/sudo access
- Domain name with DNS configured
- Email account for notifications

### Installation:

```bash
# 1. Download the deployment script
wget https://raw.githubusercontent.com/thegspiro/fd-intranet/main/deploy.sh

# 2. Make it executable
chmod +x deploy.sh

# 3. Run the script
sudo ./deploy.sh
```

The script will:
- ✅ Install all dependencies
- ✅ Configure PostgreSQL database
- ✅ Clone the repository
- ✅ Set up Python environment
- ✅ Configure Nginx and SSL
- ✅ Set up automated backups
- ✅ Configure firewall and security

**Time:** ~15 minutes

---

## Method 2: Manual Deployment 🔧

**Best for:** Custom configurations, non-Ubuntu systems, learning

See the complete guide: [PRODUCTION_DEPLOYMENT_GUIDE.md](./PRODUCTION_DEPLOYMENT_GUIDE.md)

### Quick Overview:

```bash
# 1. Install dependencies
sudo apt update && sudo apt install -y python3.10 postgresql redis-server nginx

# 2. Create application user
sudo adduser --system --group --home /opt/fd-intranet fdapp

# 3. Clone repository
sudo -u fdapp git clone https://github.com/thegspiro/fd-intranet.git /opt/fd-intranet/app

# 4. Set up Python environment
cd /opt/fd-intranet/app
sudo -u fdapp python3.10 -m venv venv
sudo -u fdapp bash -c "source venv/bin/activate && pip install -r requirements.txt"

# 5. Configure database
sudo -u postgres psql << EOF
CREATE DATABASE fd_intranet;
CREATE USER fdapp WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE fd_intranet TO fdapp;
EOF

# 6. Create .env file (see example below)
sudo -u fdapp nano /opt/fd-intranet/app/.env

# 7. Run Django setup
sudo -u fdapp bash -c "cd /opt/fd-intranet/app && source venv/bin/activate && python manage.py migrate"
sudo -u fdapp bash -c "cd /opt/fd-intranet/app && source venv/bin/activate && python manage.py collectstatic"
sudo -u fdapp bash -c "cd /opt/fd-intranet/app && source venv/bin/activate && python manage.py createsuperuser"

# 8. Configure Supervisor, Nginx, SSL (see full guide)
```

---

## Method 3: Docker Deployment 🐳

**Best for:** Development, testing, containerized environments

### Prerequisites:
- Docker and Docker Compose installed
- Domain name (for production)

### Quick Start:

```bash
# 1. Clone repository
git clone https://github.com/thegspiro/fd-intranet.git
cd fd-intranet

# 2. Create .env file
cp .env.example .env
nano .env  # Edit with your settings

# 3. Set database password
export DB_PASSWORD="your_secure_password"

# 4. Start services
docker-compose up -d

# 5. Run migrations
docker-compose exec web python manage.py migrate

# 6. Create superuser
docker-compose exec web python manage.py createsuperuser

# 7. Access application
# HTTP: http://localhost
# HTTPS: https://yourdomain.com (after SSL setup)
```

### Docker Management:

```bash
# View logs
docker-compose logs -f web

# Stop services
docker-compose down

# Restart services
docker-compose restart

# Database backup
docker-compose exec db pg_dump -U fdapp fd_intranet > backup.sql

# Update application
git pull origin main
docker-compose build
docker-compose up -d
docker-compose exec web python manage.py migrate
docker-compose exec web python manage.py collectstatic --noinput
```

---

## Environment Configuration

Create a `.env` file with these settings:

```bash
# Core Settings
SECRET_KEY='generate-a-50-character-random-string'
DEBUG=False
ALLOWED_HOSTS=yourdomain.com,www.yourdomain.com

# Database
DATABASE_URL=postgresql://fdapp:password@localhost:5432/fd_intranet

# Email
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USE_TLS=True
EMAIL_HOST_USER=alerts@yourfiredept.org
EMAIL_HOST_PASSWORD=your-app-password

# Redis
REDIS_URL=redis://localhost:6379/0

# Security (Production)
SECURE_SSL_REDIRECT=True
SESSION_COOKIE_SECURE=True
CSRF_COOKIE_SECURE=True
SECURE_HSTS_SECONDS=31536000

# Geographic Security
GEO_SECURITY_ENABLED=True
TIME_ZONE=America/New_York

# Optional: AWS S3
USE_S3=False
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_STORAGE_BUCKET_NAME=

# Optional: Integrations
TARGET_SOLUTIONS_API_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

**Generate SECRET_KEY:**
```bash
python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
```

---

## Post-Deployment Setup

### 1. Create Superuser

```bash
# Standard deployment
sudo -u fdapp bash -c "cd /opt/fd-intranet/app && source venv/bin/activate && python manage.py createsuperuser"

# Docker deployment
docker-compose exec web python manage.py createsuperuser
```

### 2. Configure Groups

Login to admin panel: `https://yourdomain.com/admin`

Create these groups:
- Chief Officers
- Line Officers
- Training Officers
- Compliance Officers
- Quartermaster
- IT Director
- Secretary
- Active Members
- Probationary Members

### 3. Schedule Background Tasks

In Django Admin → Django Q → Scheduled tasks, add:

| Task | Function | Schedule |
|------|----------|----------|
| Training Alerts | `training.services.send_training_alerts` | Daily 07:00 |
| Compliance Check | `compliance.hipaa_compliance.run_hipaa_compliance_checks` | Daily 06:00 |
| Weekly Digest | `core.weekly_digest.send_weekly_digest` | Weekly Monday 08:00 |
| Target Solutions Sync | `training.services.sync_from_target_solutions` | Daily 02:00 |

### 4. Configure Integrations

Add API keys in `.env` file for:
- Target Solutions (training sync)
- Google Calendar (shift export)
- Microsoft 365 (Outlook sync)
- NocoDB (data mirroring)
- AWS S3 (document storage)

---

## Testing Your Deployment

```bash
# 1. Check application status
curl -I https://yourdomain.com

# 2. Check database connection
sudo -u fdapp psql -h localhost -U fdapp -d fd_intranet -c "SELECT 1"

# 3. Check Redis
redis-cli ping

# 4. View logs
sudo tail -f /opt/fd-intranet/logs/gunicorn_error.log

# 5. Check services (standard deployment)
sudo supervisorctl status

# 6. Check services (Docker)
docker-compose ps
```

---

## Updating the Application

### Standard Deployment:

```bash
# 1. Backup current version
cd /opt/fd-intranet
sudo -u fdapp tar -czf backup_$(date +%Y%m%d).tar.gz app/

# 2. Pull updates
cd /opt/fd-intranet/app
sudo -u fdapp git pull origin main

# 3. Update dependencies
sudo -u fdapp bash -c "source venv/bin/activate && pip install -r requirements.txt"

# 4. Run migrations
sudo -u fdapp bash -c "source venv/bin/activate && python manage.py migrate"

# 5. Collect static files
sudo -u fdapp bash -c "source venv/bin/activate && python manage.py collectstatic --noinput"

# 6. Restart services
sudo supervisorctl restart fd-intranet fd-intranet-worker
```

### Docker Deployment:

```bash
# 1. Pull updates
git pull origin main

# 2. Rebuild and restart
docker-compose down
docker-compose build
docker-compose up -d

# 3. Run migrations
docker-compose exec web python manage.py migrate
docker-compose exec web python manage.py collectstatic --noinput
```

---

## Backup & Restore

### Automated Backups

Backups run automatically at 2 AM daily:
- Database: `/opt/fd-intranet/backups/fd_intranet_YYYYMMDD_HHMMSS.sql.gz`
- Retention: 30 days

### Manual Backup:

```bash
# Database backup
sudo -u fdapp pg_dump -U fdapp fd_intranet | gzip > backup_$(date +%Y%m%d).sql.gz

# Media files backup
sudo tar -czf media_backup_$(date +%Y%m%d).tar.gz /opt/fd-intranet/app/media/
```

### Restore from Backup:

```bash
# 1. Stop application
sudo supervisorctl stop fd-intranet

# 2. Restore database
gunzip < backup_20240101.sql.gz | sudo -u fdapp psql -U fdapp fd_intranet

# 3. Restore media files
sudo tar -xzf media_backup_20240101.tar.gz -C /

# 4. Restart application
sudo supervisorctl start fd-intranet
```

---

## Monitoring

### Check Application Health:

```bash
# Application status
curl https://yourdomain.com/admin/

# Database status
sudo -u fdapp psql -U fdapp -d fd_intranet -c "SELECT count(*) FROM auth_user"

# Disk space
df -h

# Memory usage
free -h

# Service status
sudo supervisorctl status
```

### View Logs:

```bash
# Application logs
sudo tail -f /opt/fd-intranet/logs/gunicorn_error.log

# Background worker logs
sudo tail -f /opt/fd-intranet/logs/qcluster.log

# Nginx logs
sudo tail -f /var/log/nginx/fd-intranet-error.log

# PostgreSQL logs
sudo tail -f /var/log/postgresql/postgresql-14-main.log
```

---

## Troubleshooting

### Application won't start

```bash
# Check configuration
cd /opt/fd-intranet/app
sudo -u fdapp bash -c "source venv/bin/activate && python manage.py check"

# Check environment
sudo -u fdapp cat /opt/fd-intranet/app/.env

# Check logs
sudo tail -100 /opt/fd-intranet/logs/gunicorn_supervisor_error.log
```

### Database connection errors

```bash
# Test connection
sudo -u fdapp psql -h localhost -U fdapp -d fd_intranet

# Check PostgreSQL status
sudo systemctl status postgresql

# View PostgreSQL logs
sudo tail -f /var/log/postgresql/postgresql-14-main.log
```

### Static files not loading

```bash
# Recollect static files
cd /opt/fd-intranet/app
sudo -u fdapp bash -c "source venv/bin/activate && python manage.py collectstatic --noinput"

# Check permissions
ls -la /opt/fd-intranet/app/staticfiles/

# Restart Nginx
sudo systemctl restart nginx
```

---

## Security Checklist

After deployment, verify:

- [ ] DEBUG=False in production
- [ ] Strong SECRET_KEY generated
- [ ] HTTPS enabled with valid SSL
- [ ] Firewall configured (UFW)
- [ ] Fail2Ban installed and active
- [ ] PostgreSQL password changed
- [ ] .env file permissions (600)
- [ ] Automated backups running
- [ ] Security updates enabled
- [ ] Admin account secured with 2FA
- [ ] Geographic IP restrictions configured
- [ ] Audit logging verified

---

## Getting Help

- **Documentation:** See `PRODUCTION_DEPLOYMENT_GUIDE.md`
- **Security Issues:** Contact security@yourfiredept.org
- **GitHub Issues:** https://github.com/thegspiro/fd-intranet/issues
- **Email Support:** admin@yourfiredept.org

---

## Quick Reference

| Task | Command |
|------|---------|
| Start services | `sudo supervisorctl start fd-intranet` |
| Stop services | `sudo supervisorctl stop fd-intranet` |
| Restart services | `sudo supervisorctl restart fd-intranet` |
| View logs | `sudo tail -f /opt/fd-intranet/logs/gunicorn_error.log` |
| Access shell | `sudo -u fdapp bash -c "cd /opt/fd-intranet/app && source venv/bin/activate && python manage.py shell"` |
| Create superuser | `sudo -u fdapp bash -c "cd /opt/fd-intranet/app && source venv/bin/activate && python manage.py createsuperuser"` |
| Backup database | `/opt/fd-intranet/backup_db.sh` |
| Update app | See "Updating the Application" section |

---

**Repository:** [https://github.com/thegspiro/fd-intranet](https://github.com/thegspiro/fd-intranet)  
**License:** MIT  
**Version:** 1.0.0
