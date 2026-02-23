# Production Deployment

Best practices for deploying The Logbook in a production environment.

---

## Pre-Production Checklist

### Security

- [ ] Generate unique `SECRET_KEY` (not default): `openssl rand -hex 32`
- [ ] Generate unique `ENCRYPTION_KEY`: `openssl rand -hex 32`
- [ ] Generate unique `ENCRYPTION_SALT`: `openssl rand -hex 16`
- [ ] Set strong `DB_PASSWORD` (16+ characters)
- [ ] Set strong `REDIS_PASSWORD`
- [ ] Set `ENVIRONMENT=production`
- [ ] Set `DEBUG=false`
- [ ] Configure `ALLOWED_ORIGINS` for your domain only
- [ ] Enable HTTPS with valid SSL certificate
- [ ] Review all `.env` settings
- [ ] Ensure `.env` is in `.gitignore`

### Infrastructure

- [ ] Minimum 4GB RAM, 2 CPU cores
- [ ] SSD storage (recommended 50GB+)
- [ ] Automated backups configured
- [ ] Monitoring and alerting set up
- [ ] Firewall rules configured (only expose ports 80/443)

---

## HTTPS Setup

### With Nginx Reverse Proxy (Recommended)

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/ssl/certs/your-cert.pem;
    ssl_certificate_key /etc/ssl/private/your-key.pem;
    ssl_protocols TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Frontend
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Backend API
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket
    location /ws/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### With Let's Encrypt (Free SSL)

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
# Auto-renewal is configured automatically
```

---

## Environment Configuration

```bash
# Production .env
ENVIRONMENT=production
DEBUG=false
SECRET_KEY=<generated-64-char-hex>
ENCRYPTION_KEY=<generated-64-char-hex>
ENCRYPTION_SALT=<generated-32-char-hex>

# Database
DB_HOST=mysql
DB_PASSWORD=<strong-password>
MYSQL_ROOT_PASSWORD=<strong-password>

# Redis
REDIS_PASSWORD=<strong-password>

# CORS - your domain only
ALLOWED_ORIGINS=["https://your-domain.com"]

# Frontend build
VITE_API_URL=/api/v1
VITE_ENV=production
```

---

## Backup Strategy

### Automated Daily Backups

```bash
# Add to crontab
0 2 * * * docker exec logbook-db mysqldump -u logbook_user -p$DB_PASSWORD the_logbook | gzip > /backups/logbook-$(date +\%Y\%m\%d).sql.gz

# Cleanup old backups (keep 30 days)
0 3 * * * find /backups -name "logbook-*.sql.gz" -mtime +30 -delete
```

### Upload Volume Backup

```bash
# Include uploads directory in backup
0 2 * * * tar -czf /backups/uploads-$(date +\%Y\%m\%d).tar.gz /path/to/uploads/
```

---

## Monitoring

### Health Checks

```bash
# Backend health
curl -s https://your-domain.com/api/v1/health | jq

# Database health
curl -s https://your-domain.com/api/v1/health/db | jq

# Redis health
curl -s https://your-domain.com/api/v1/health/redis | jq
```

### Container Monitoring

```bash
# Resource usage
docker stats

# Container status
docker-compose ps
```

### Security Monitoring

```bash
# Security status
curl -s https://your-domain.com/api/v1/security/status | jq

# Audit log integrity
curl -s https://your-domain.com/api/v1/security/audit-log/integrity | jq
```

---

## Scaling

### Multiple Backend Workers

In `docker-compose.override.yml`:
```yaml
services:
  backend:
    command: uvicorn main:app --host 0.0.0.0 --port 3001 --workers 4
```

### Database Optimization

```sql
-- Increase connection limits
SET GLOBAL max_connections = 200;

-- Enable query cache
SET GLOBAL query_cache_size = 67108864;  -- 64MB
```

---

## Cloud Deployment

For cloud-specific guides, see:
- **[AWS Deployment](../docs/deployment/aws.md)** — ECS, EC2, RDS
- **[Synology NAS](../docs/deployment/synology.md)**
- **[Proxmox](../docs/deployment/proxmox.md)**
- **[Unraid](Deployment-Unraid)**

---

## Updating in Production

```bash
# 1. Backup first
docker exec logbook-db mysqldump -u logbook_user -p the_logbook > pre-update-backup.sql

# 2. Pull changes
cd /path/to/the-logbook
git pull

# 3. Rebuild
docker-compose build --no-cache

# 4. Restart with minimal downtime
docker-compose up -d

# 5. Run migrations
docker-compose exec backend alembic upgrade head

# 6. Verify
curl -s https://your-domain.com/api/v1/health
```

---

**See also:** [Docker Deployment](Deployment-Docker) | [Security Configuration](Configuration-Security) | [Environment Variables](Configuration-Environment)
