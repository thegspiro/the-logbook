# 🚀 Fire Department Intranet - Deployment Guide

## Table of Contents
1. [Development Setup](#development-setup)
2. [Production Deployment](#production-deployment)
3. [Database Configuration](#database-configuration)
4. [Background Tasks](#background-tasks)
5. [Email Configuration](#email-configuration)
6. [External Integrations](#external-integrations)
7. [Troubleshooting](#troubleshooting)

---

## Development Setup

### Prerequisites
- Python 3.9+
- PostgreSQL 12+ (recommended) or SQLite for development
- Redis (for background tasks)
- Git

### Quick Start

```bash
# 1. Clone repository
git clone https://github.com/yourusername/fd-intranet.git
cd fd-intranet

# 2. Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Configure environment
cp .env.example .env
# Edit .env with your settings

# 5. Initialize database
python manage.py makemigrations
python manage.py migrate

# 6. Run setup script
python setup_system.py

# 7. Create superuser
python manage.py createsuperuser

# 8. Start development server
python manage.py runserver
```

Visit: http://localhost:8000

---

## Production Deployment

### Server Requirements
- Ubuntu 20.04 LTS or newer
- 2GB RAM minimum (4GB recommended)
- 20GB disk space minimum
- Python 3.9+
- PostgreSQL 12+
- Redis
- Nginx
- SSL certificate (Let's Encrypt recommended)

### Step-by-Step Production Setup

#### 1. System Preparation

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install required packages
sudo apt install -y python3-pip python3-venv postgresql postgresql-contrib \
    redis-server nginx git certbot python3-certbot-nginx

# Create application user
sudo adduser --system --group --home /opt/fd-intranet fd-intranet
```

#### 2. Database Setup

```bash
# Login to PostgreSQL
sudo -u postgres psql

# Create database and user
CREATE DATABASE fd_intranet;
CREATE USER fd_user WITH PASSWORD 'your_secure_password_here';
ALTER ROLE fd_user SET client_encoding TO 'utf8';
ALTER ROLE fd_user SET default_transaction_isolation TO 'read committed';
ALTER ROLE fd_user SET timezone TO 'UTC';
GRANT ALL PRIVILEGES ON DATABASE fd_intranet TO fd_user;
\q
```

#### 3. Application Setup

```bash
# Switch to application user
sudo su - fd-intranet

# Clone repository
git clone https://github.com/yourusername/fd-intranet.git /opt/fd-intranet/app
cd /opt/fd-intranet/app

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
pip install gunicorn

# Configure environment
cp .env.example .env
nano .env  # Edit with production settings
```

#### 4. Production `.env` Configuration

```bash
# CRITICAL PRODUCTION SETTINGS
SECRET_KEY='generate-new-secret-key-here'
DEBUG=False
ALLOWED_HOSTS='yourdomain.com,www.yourdomain.com'

# Database
DATABASE_URL=postgresql://fd_user:your_secure_password@localhost:5432/fd_intranet

# Email
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USE_TLS=True
EMAIL_HOST_USER=your-dept@gmail.com
EMAIL_HOST_PASSWORD=your-app-password

# Security (HTTPS required)
SECURE_SSL_REDIRECT=True
SESSION_COOKIE_SECURE=True
CSRF_COOKIE_SECURE=True
SECURE_HSTS_SECONDS=31536000

# Redis
REDIS_URL=redis://localhost:6379/0
CELERY_BROKER_URL=redis://localhost:6379/0

# File storage (if using S3)
USE_S3=True
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_STORAGE_BUCKET_NAME=fd-intranet-files
AWS_S3_REGION_NAME=us-east-1
```

#### 5. Initialize Application

```bash
# Run migrations
python manage.py migrate

# Collect static files
python manage.py collectstatic --noinput

# Run setup
python setup_system.py

# Create superuser
python manage.py createsuperuser
```

#### 6. Configure Gunicorn

Create `/opt/fd-intranet/app/gunicorn_config.py`:

```python
bind = '127.0.0.1:8000'
workers = 4  # (2 x CPU cores) + 1
worker_class = 'sync'
worker_connections = 1000
max_requests = 1000
max_requests_jitter = 50
timeout = 30
keepalive = 2
errorlog = '/opt/fd-intranet/logs/gunicorn-error.log'
accesslog = '/opt/fd-intranet/logs/gunicorn-access.log'
loglevel = 'info'
```

Create systemd service `/etc/systemd/system/fd-intranet.service`:

```ini
[Unit]
Description=Fire Department Intranet
After=network.target

[Service]
Type=notify
User=fd-intranet
Group=fd-intranet
WorkingDirectory=/opt/fd-intranet/app
Environment="PATH=/opt/fd-intranet/app/venv/bin"
ExecStart=/opt/fd-intranet/app/venv/bin/gunicorn \
    --config /opt/fd-intranet/app/gunicorn_config.py \
    core.wsgi:application
ExecReload=/bin/kill -s HUP $MAINPID
KillMode=mixed
TimeoutStopSec=5
PrivateTmp=true
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

#### 7. Configure Django-Q Worker

Create systemd service `/etc/systemd/system/fd-intranet-worker.service`:

```ini
[Unit]
Description=Fire Department Intranet Background Worker
After=network.target redis.service

[Service]
Type=simple
User=fd-intranet
Group=fd-intranet
WorkingDirectory=/opt/fd-intranet/app
Environment="PATH=/opt/fd-intranet/app/venv/bin"
ExecStart=/opt/fd-intranet/app/venv/bin/python manage.py qcluster
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

#### 8. Configure Nginx

Create `/etc/nginx/sites-available/fd-intranet`:

```nginx
upstream fd_intranet {
    server 127.0.0.1:8000;
}

server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    
    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;
    
    # SSL certificates (managed by Certbot)
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    
    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    
    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    
    # Logging
    access_log /var/log/nginx/fd-intranet-access.log;
    error_log /var/log/nginx/fd-intranet-error.log;
    
    # Max upload size
    client_max_body_size 20M;
    
    # Static files
    location /static/ {
        alias /opt/fd-intranet/app/staticfiles/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
    
    # Media files
    location /media/ {
        alias /opt/fd-intranet/app/media/;
        expires 7d;
    }
    
    # Application
    location / {
        proxy_pass http://fd_intranet;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_redirect off;
        proxy_buffering off;
    }
}
```

Enable site:
```bash
sudo ln -s /etc/nginx/sites-available/fd-intranet /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

#### 9. Get SSL Certificate

```bash
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

#### 10. Start Services

```bash
# Create log directory
sudo mkdir -p /opt/fd-intranet/logs
sudo chown fd-intranet:fd-intranet /opt/fd-intranet/logs

# Enable and start services
sudo systemctl enable fd-intranet fd-intranet-worker
sudo systemctl start fd-intranet fd-intranet-worker

# Check status
sudo systemctl status fd-intranet
sudo systemctl status fd-intranet-worker
```

---

## Background Tasks Configuration

### Scheduled Tasks

Configure these in Django Admin (Django Q > Scheduled tasks):

| Task | Schedule | Function |
|------|----------|----------|
| Training Expiration Alerts | Daily at 07:00 | `training.services.TrainingNotificationService.send_expiration_alerts` |
| Compliance Check | Daily at 06:00 | `compliance.alerts.ComplianceAlertService.check_all_compliance` |
| Gear Inspection Reminders | Weekly (Monday 08:00) | `quartermaster.services.send_inspection_reminders` |
| Target Solutions Sync | Daily at 02:00 | `integrations.target_solutions.TargetSolutionsSyncService.sync_all_users` |
| NocoDB Sync | Daily at 03:00 | `integrations.nocodb_client.NocoDBSyncService.sync_all_data` |

---

## Backup Strategy

### Database Backups

Create `/opt/fd-intranet/backup.sh`:

```bash
#!/bin/bash
BACKUP_DIR="/opt/fd-intranet/backups"
DATE=$(date +%Y%m%d_%H%M%S)

# Create backup directory
mkdir -p $BACKUP_DIR

# Backup database
sudo -u postgres pg_dump fd_intranet | gzip > $BACKUP_DIR/db_$DATE.sql.gz

# Backup media files
tar -czf $BACKUP_DIR/media_$DATE.tar.gz /opt/fd-intranet/app/media/

# Keep only last 30 days of backups
find $BACKUP_DIR -name "*.gz" -mtime +30 -delete

echo "Backup completed: $DATE"
```

Add to crontab:
```bash
0 1 * * * /opt/fd-intranet/backup.sh
```

---

## Monitoring

### Log Files

- Application: `/opt/fd-intranet/logs/gunicorn-error.log`
- Access: `/opt/fd-intranet/logs/gunicorn-access.log`
- Nginx: `/var/log/nginx/fd-intranet-*.log`
- System: `journalctl -u fd-intranet -f`

### Health Checks

```bash
# Check application status
curl -f https://yourdomain.com/ || echo "Application down!"

# Check database
sudo -u postgres psql -c "SELECT 1;" fd_intranet

# Check Redis
redis-cli ping
```

---

## Troubleshooting

### Common Issues

**Issue: Static files not loading**
```bash
python manage.py collectstatic --noinput
sudo systemctl restart fd-intranet
```

**Issue: Database connection errors**
```bash
# Check PostgreSQL is running
sudo systemctl status postgresql

# Check credentials in .env
cat .env | grep DATABASE_URL
```

**Issue: Background tasks not running**
```bash
# Check Django-Q worker
sudo systemctl status fd-intranet-worker
sudo journalctl -u fd-intranet-worker -n 50

# Check Redis
redis-cli ping
```

**Issue: Permission errors**
```bash
# Fix ownership
sudo chown -R fd-intranet:fd-intranet /opt/fd-intranet/app/
sudo chmod -R 755 /opt/fd-intranet/app/staticfiles/
```

---

## Security Checklist

- [ ] `DEBUG=False` in production
- [ ] Strong `SECRET_KEY` generated and set
- [ ] HTTPS enabled with valid SSL certificate
- [ ] Firewall configured (only ports 80, 443, 22 open)
- [ ] Database password is strong and unique
- [ ] Regular backups configured and tested
- [ ] Redis requires authentication
- [ ] File upload size limits enforced
- [ ] Rate limiting enabled
- [ ] HSTS enabled
- [ ] Security headers configured
- [ ] Fail2ban configured for SSH
- [ ] Regular security updates applied

---

## Maintenance

### Regular Tasks

**Daily:**
- Monitor logs for errors
- Check system resources (disk, memory, CPU)

**Weekly:**
- Review backup success
- Check for application updates

**Monthly:**
- Apply security updates: `sudo apt update && sudo apt upgrade`
- Review user accounts and permissions
- Test disaster recovery procedures

**Quarterly:**
- Review and update documentation
- Security audit
- Performance optimization review

---

## Support

For issues or questions:
- GitHub Issues: https://github.com/yourusername/fd-intranet/issues
- Documentation: https://github.com/yourusername/fd-intranet/wiki
- Email: support@yourfiredept.org
