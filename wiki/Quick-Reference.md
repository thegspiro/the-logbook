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
docker compose up -d
```

> **Production hardening.** The bare `docker compose ...` commands throughout
> this reference run the **development** configuration (uvicorn `--reload`,
> backend port published, API docs enabled, no HTTPS enforcement) and skip the
> startup security gate. For production, pin
> `COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml` in `.env` (or pass
> `-f docker-compose.yml -f docker-compose.prod.yml` on every command) so all the
> commands below stay hardened; `install.sh` sets this automatically. In
> production the app **refuses to start** if required secrets are missing or
> weak, if `DEBUG` or API docs are enabled, if HTTPS isn't enforced, or if
> `FRONTEND_URL` points at `localhost` and `ALLOWED_ORIGINS` names no address
> other than localhost to use instead.
>
> **Names.** Every command here is for the standard stack: services `mysql`,
> `redis`, `backend`, `frontend`; containers `intranet-*`; database user
> `intranet_user` and database `intranet_db` (the `.env.example` defaults). An
> Unraid install uses service `db`, containers `logbook-*`, user
> `logbook_user` and database `the_logbook` instead — see
> [Deployment: Unraid](Deployment-Unraid).

---

## 📦 Docker Commands

### Container Management

```bash
# Start all services
docker compose up -d

# Stop all services
docker compose down

# Restart all services
docker compose restart

# Restart specific service
docker compose restart backend

# Rebuild and start
docker compose build --no-cache
docker compose up -d

# Remove containers and volumes (⚠️ deletes data!)
docker compose down -v
```

### Logs

```bash
# View all logs (follow)
docker compose logs -f

# View specific service logs
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f mysql

# Last 50 lines
docker compose logs --tail=50 backend

# Since specific time
docker compose logs --since 30m backend
```

### Status & Health

```bash
# Container status
docker compose ps

# Resource usage
docker stats

# Health check
curl http://localhost:3001/health

# Container info
docker inspect intranet-backend
```

---

## 🔧 Common Operations

### Access Services

| Service         | URL                         |
| --------------- | --------------------------- |
| **Frontend**    | http://localhost:3000       |
| **Backend API** | http://localhost:3001       |
| **API Docs**    | http://localhost:3001/docs  |
| **ReDoc**       | http://localhost:3001/redoc |

### Database Access

```bash
# MySQL shell
docker exec -it intranet-mysql mysql -u intranet_user -p

# Once in MySQL:
SHOW DATABASES;
USE intranet_db;
SHOW TABLES;
SELECT * FROM users LIMIT 5;
```

### Redis Access

```bash
# Redis CLI
docker exec -it intranet-redis redis-cli

# Once in Redis, authenticate first (REDIS_PASSWORD from .env):
AUTH your_redis_password

# Then:
PING
KEYS *
GET key_name
```

### Backend Shell

```bash
# Access Python shell
docker exec -it intranet-backend bash

# Run Python commands
docker exec -it intranet-backend python -c "print('Hello')"

# Run migrations
docker exec -it intranet-backend alembic upgrade head
```

---

## 🔄 Updates

### Update Application

```bash
cd /path/to/the-logbook
docker compose down
git pull
docker compose build --no-cache
docker compose up -d
```

### Update Unraid

```bash
cd /mnt/user/appdata/the-logbook/unraid
./unraid-setup.sh
# Choose option 2 (Update)
```

### Run Database Migrations

```bash
docker exec intranet-backend alembic upgrade head
```

---

## 💾 Backup & Restore

### Manual Backup

```bash
# Full backup: database, uploads (from the running backend container) and config
./scripts/backup.sh   # host-side script, run from the install directory

# Database only
docker exec intranet-mysql mysqldump -u intranet_user -p intranet_db > backup.sql

# Uploads only (logbook-backend on Unraid, intranet-backend otherwise)
docker exec logbook-backend tar -czf - -C /app uploads > uploads-backup.tar.gz
```

### Restore

```bash
# Database restore
docker exec -i intranet-mysql mysql -u intranet_user -p intranet_db < backup.sql

# Uploads restore (the archive holds a top-level uploads/ directory)
docker exec -i logbook-backend tar -xzf - --no-overwrite-dir -C /app < uploads-backup.tar.gz
```

---

## 🏥 Training & Compliance Quick Tips

### Check Member Compliance

```bash
# Via API
curl http://localhost:3001/api/v1/training/compliance-summary/{user_id}
# Returns: requirements_met, requirements_total, compliance_status (green/yellow/red)
```

### Manage Waivers

- **UI**: Members > Admin > Waivers (unified page for training, meeting, and shift waivers)
- **Training-specific**: Training Admin > Dashboard > Training Waivers tab

### Bulk Create Training Records

```bash
curl -X POST http://localhost:3001/api/v1/training/records/bulk \
  -H "Content-Type: application/json" \
  -d '{"records": [...], "skip_duplicates": true}'
# Up to 500 records per request with duplicate detection
```

### Generate a Course Cohort

- **UI**: Training > Records > Course Cohorts > New cohort (build the course's
  syllabus first under Training > Setup > Course Library > Manage classes)

```bash
# Preview first — read-only, creates nothing
curl -X POST http://localhost:3001/api/v1/training/cohorts/preview \
  -H "Content-Type: application/json" \
  -d '{"course_id": "<uuid>", "start_date": "2026-09-08", "date_roll_policy": "next_business_day"}'

# Then generate: one event + one training session per class, in one transaction
curl -X POST http://localhost:3001/api/v1/training/cohorts \
  -H "Content-Type: application/json" \
  -d '{"course_id": "<uuid>", "name": "Recruit School — Fall 2026", "start_date": "2026-09-08", "member_user_ids": ["<uuid>"]}'
```

### Process Certification Alerts

```bash
# Run daily alert processing (90/60/30/7-day tiers + expired escalation)
curl -X POST http://localhost:3001/api/v1/training/certifications/process-alerts/all-orgs
```

### Check Rank Validation

```bash
curl http://localhost:3001/api/v1/users/rank-validation
# Lists active members with ranks not matching configured operational ranks
```

---

## 🔍 Troubleshooting

### Container Won't Start

```bash
# Check logs for errors
docker compose logs backend

# Remove and recreate
docker compose down
docker compose up -d

# Full rebuild
docker compose down
docker compose build --no-cache
docker compose up -d
```

### Port Conflicts

```bash
# Edit .env
nano .env
# Change FRONTEND_PORT and BACKEND_PORT

# Restart
docker compose down
docker compose up -d
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
docker compose ps mysql

# View database logs
docker compose logs mysql

# Verify credentials
cat .env | grep DB_

# Test connection
docker exec intranet-backend python -c "import pymysql; pymysql.connect(host='mysql', user='intranet_user', password='YOUR_PASSWORD', database='intranet_db')"
```

### Frontend Not Loading

```bash
# Check frontend logs
docker compose logs frontend

# Rebuild frontend
docker compose stop frontend
docker compose build --no-cache frontend
docker compose up -d frontend

# Check nginx config
docker exec intranet-frontend cat /etc/nginx/conf.d/default.conf
```

### API Errors

```bash
# Check backend health
curl http://localhost:3001/health

# View backend logs
docker compose logs backend

# Restart backend
docker compose restart backend

# Check environment variables
docker exec intranet-backend env | grep -i secret
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
docker exec -it intranet-mysql mysql -u root -p
# Then run: UPDATE users SET password_hash='new_hash' WHERE id=1;
```

---

## 📊 Monitoring

### Container Health

```bash
# All containers
docker compose ps

# Specific health check
docker inspect --format='{{.State.Health.Status}}' intranet-backend
```

### Resource Usage

```bash
# Real-time stats
docker stats

# Disk usage
docker system df

# Logs size
docker compose exec backend du -sh /app/logs
```

### API Health

```bash
# Backend health endpoint
curl http://localhost:3001/health

# Expected response once started ("degraded" when MySQL or Redis is unreachable):
{"status":"healthy","ready":true}
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
truncate -s 0 $(docker inspect --format='{{.LogPath}}' intranet-backend)

# Or rotate logs
docker compose down
find /var/lib/docker/containers -name "*.log" -delete
docker compose up -d
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
FRONTEND_URL=               # https://your-domain.com (links in emails)
```

### Common

```bash
FRONTEND_PORT=3000
BACKEND_PORT=3001
DB_HOST=mysql
DB_NAME=intranet_db
DB_USER=intranet_user
ENVIRONMENT=production
DEBUG=false
TZ=America/New_York
```

### Modules

There are no `MODULE_*_ENABLED` environment variables. Module availability is
controlled **per organization** inside the app (Organization/Admin Settings →
Modules), stored in the organization's `enabled_modules` setting. See
[Module Configuration](Configuration-Modules).

---

## 📱 Useful URLs (Default Ports)

| Resource               | URL                                                      |
| ---------------------- | -------------------------------------------------------- |
| **Frontend**           | http://localhost:3000                                    |
| **API Docs (Swagger)** | http://localhost:3001/docs                               |
| **API Docs (ReDoc)**   | http://localhost:3001/redoc                              |
| **API JSON**           | http://localhost:3001/openapi.json                       |
| **Health Check**       | http://localhost:3001/health                             |
| **Detailed Health**    | http://localhost:3001/health/detailed (development only) |

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
docker compose ps

# Recent logs
docker compose logs --tail=100 backend > logs.txt

# Environment (sanitized)
cat .env | grep -v PASSWORD | grep -v KEY
```

---

**See also:** [Installation Guide](Installation) | [Troubleshooting](Troubleshooting) | [Configuration](Configuration-Environment)
