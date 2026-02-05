# Quick Reference

Common commands and quick solutions for The Logbook.

---

## 🚀 Installation

### Unraid (One Line)
```bash
curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/unraid/unraid-setup.sh | bash
```

### Docker Compose
```bash
git clone https://github.com/thegspiro/the-logbook.git
cd the-logbook
cp .env.example .env
# Edit .env with your settings
docker-compose up -d
```

---

## 📦 Docker Commands

### Container Management
```bash
# Start all services
docker-compose up -d

# Stop all services
docker-compose down

# Restart all services
docker-compose restart

# Restart specific service
docker-compose restart backend

# Rebuild and start
docker-compose build --no-cache
docker-compose up -d

# Remove containers and volumes (⚠️ deletes data!)
docker-compose down -v
```

### Logs
```bash
# View all logs (follow)
docker-compose logs -f

# View specific service logs
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f db

# Last 50 lines
docker-compose logs --tail=50 backend

# Since specific time
docker-compose logs --since 30m backend
```

### Status & Health
```bash
# Container status
docker-compose ps

# Resource usage
docker stats

# Health check
curl http://localhost:3001/health

# Container info
docker inspect logbook-backend
```

---

## 🔧 Common Operations

### Access Services

| Service | URL |
|---------|-----|
| **Frontend** | http://localhost:3000 |
| **Backend API** | http://localhost:3001 |
| **API Docs** | http://localhost:3001/docs |
| **ReDoc** | http://localhost:3001/redoc |

### Database Access
```bash
# MySQL/MariaDB shell
docker exec -it logbook-db mysql -u logbook_user -p

# Once in MySQL:
SHOW DATABASES;
USE the_logbook;
SHOW TABLES;
SELECT * FROM users LIMIT 5;
```

### Redis Access
```bash
# Redis CLI
docker exec -it logbook-redis redis-cli

# Once in Redis:
PING
KEYS *
GET key_name
```

### Backend Shell
```bash
# Access Python shell
docker exec -it logbook-backend bash

# Run Python commands
docker exec -it logbook-backend python -c "print('Hello')"

# Run migrations
docker exec -it logbook-backend alembic upgrade head
```

---

## 🔄 Updates

### Update Application
```bash
cd /path/to/the-logbook
docker-compose down
git pull
docker-compose build --no-cache
docker-compose up -d
```

### Update Unraid
```bash
cd /mnt/user/appdata/the-logbook/unraid
./unraid-setup.sh
# Choose option 2 (Update)
```

### Run Database Migrations
```bash
docker exec logbook-backend alembic upgrade head
```

---

## 💾 Backup & Restore

### Manual Backup
```bash
# Full backup
docker exec logbook-backend /app/scripts/backup.sh

# Database only
docker exec logbook-db mysqldump -u logbook_user -p the_logbook > backup.sql

# Uploads only
tar -czf uploads-backup.tar.gz /path/to/uploads/
```

### Restore
```bash
# Database restore
docker exec -i logbook-db mysql -u logbook_user -p the_logbook < backup.sql

# Uploads restore
tar -xzf uploads-backup.tar.gz -C /path/to/uploads/
```

---

## 🔍 Troubleshooting

### Container Won't Start
```bash
# Check logs for errors
docker-compose logs backend

# Remove and recreate
docker-compose down
docker-compose up -d

# Full rebuild
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### Port Conflicts
```bash
# Edit .env
nano .env
# Change FRONTEND_PORT and BACKEND_PORT

# Restart
docker-compose down
docker-compose up -d
```

### Permission Issues
```bash
# Fix ownership
sudo chown -R $USER:$USER .

# Fix permissions
chmod -R 755 .

# Unraid permissions
chown -R 99:100 /mnt/user/appdata/the-logbook/
```

### Database Connection Failed
```bash
# Check database is running
docker-compose ps db

# View database logs
docker-compose logs db

# Verify credentials
cat .env | grep DB_

# Test connection
docker exec logbook-backend python -c "import pymysql; pymysql.connect(host='db', user='logbook_user', password='YOUR_PASSWORD', database='the_logbook')"
```

### Frontend Not Loading
```bash
# Check frontend logs
docker-compose logs frontend

# Rebuild frontend
docker-compose stop frontend
docker-compose build --no-cache frontend
docker-compose up -d frontend

# Check nginx config
docker exec logbook-frontend cat /etc/nginx/conf.d/default.conf
```

### API Errors
```bash
# Check backend health
curl http://localhost:3001/health

# View backend logs
docker-compose logs backend

# Restart backend
docker-compose restart backend

# Check environment variables
docker exec logbook-backend env | grep -i secret
```

---

## 🔐 Security

### Generate Secrets
```bash
# Secret keys (64 characters)
openssl rand -hex 32

# Passwords
openssl rand -base64 32

# JWT tokens
openssl rand -hex 32
```

### View Current Config (sanitized)
```bash
# Show env without secrets
cat .env | grep -v PASSWORD | grep -v KEY | grep -v SECRET
```

### Reset Admin Password
```bash
# Via API (when logged in as admin)
curl -X POST http://localhost:3001/api/v1/users/reset-password \
  -H "Content-Type: application/json" \
  -d '{"user_id": 1, "new_password": "NewSecurePassword123!"}'

# Via database
docker exec -it logbook-db mysql -u root -p
# Then run: UPDATE users SET password_hash='new_hash' WHERE id=1;
```

---

## 📊 Monitoring

### Container Health
```bash
# All containers
docker-compose ps

# Specific health check
docker inspect --format='{{.State.Health.Status}}' logbook-backend
```

### Resource Usage
```bash
# Real-time stats
docker stats

# Disk usage
docker system df

# Logs size
docker-compose exec backend du -sh /app/logs
```

### API Health
```bash
# Backend health endpoint
curl http://localhost:3001/health

# Expected response:
{"status":"healthy","timestamp":"2026-01-31T12:00:00Z"}
```

---

## 🧹 Cleanup

### Remove Unused Images
```bash
# Remove dangling images
docker image prune

# Remove all unused images
docker image prune -a
```

### Clean Build Cache
```bash
# Remove build cache
docker builder prune

# Remove everything unused
docker system prune -a --volumes
```

### Clear Logs
```bash
# Truncate Docker logs
truncate -s 0 $(docker inspect --format='{{.LogPath}}' logbook-backend)

# Or rotate logs
docker-compose down
find /var/lib/docker/containers -name "*.log" -delete
docker-compose up -d
```

---

## 🔑 Environment Variables Quick Reference

### Required
```bash
SECRET_KEY=                 # openssl rand -hex 32
ENCRYPTION_KEY=             # openssl rand -hex 32
ENCRYPTION_SALT=            # openssl rand -hex 16
DB_PASSWORD=                # Strong password
REDIS_PASSWORD=             # Strong password
ALLOWED_ORIGINS=            # http://your-domain.com
```

### Common
```bash
FRONTEND_PORT=3000
BACKEND_PORT=3001
DB_HOST=db
DB_NAME=the_logbook
DB_USER=logbook_user
ENVIRONMENT=production
DEBUG=false
TZ=America/New_York
```

### Modules
```bash
MODULE_TRAINING_ENABLED=true
MODULE_COMPLIANCE_ENABLED=true
MODULE_SCHEDULING_ENABLED=true
MODULE_ELECTIONS_ENABLED=true
```

---

## 📱 Useful URLs (Default Ports)

| Resource | URL |
|----------|-----|
| **Frontend** | http://localhost:3000 |
| **API Docs (Swagger)** | http://localhost:3001/docs |
| **API Docs (ReDoc)** | http://localhost:3001/redoc |
| **API JSON** | http://localhost:3001/openapi.json |
| **Health Check** | http://localhost:3001/health |
| **Database Health** | http://localhost:3001/health/db |
| **Redis Health** | http://localhost:3001/health/redis |

---

## 🆘 Get Help

1. **Check [Troubleshooting Guide](Troubleshooting)**
2. **Search [GitHub Issues](https://github.com/thegspiro/the-logbook/issues)**
3. **Ask in [Discussions](https://github.com/thegspiro/the-logbook/discussions)**
4. **Create [New Issue](https://github.com/thegspiro/the-logbook/issues/new)**

### Include When Reporting Issues
```bash
# System info
uname -a
docker --version
docker-compose --version

# Container status
docker-compose ps

# Recent logs
docker-compose logs --tail=100 backend > logs.txt

# Environment (sanitized)
cat .env | grep -v PASSWORD | grep -v KEY
```

---

**See also:** [Installation Guide](Installation) | [Troubleshooting](Troubleshooting) | [Configuration](Configuration-Environment)
