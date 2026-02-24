# Troubleshooting: Containers

Docker container issues and solutions for The Logbook deployment.

---

## Container Won't Start

### Check Logs
```bash
docker-compose logs backend
docker-compose logs frontend
docker-compose logs mysql
docker-compose logs redis
```

### Common Causes

| Symptom | Cause | Fix |
|---------|-------|-----|
| Backend crashes on startup | Missing or invalid `.env` | Check required env vars (SECRET_KEY, ENCRYPTION_KEY, etc.) |
| Backend exits with "SECURITY FAILURE" | Default secrets in production | Generate real secrets: `openssl rand -hex 32` |
| MySQL fails to start | Port conflict or data corruption | Check port 3306, try `docker-compose down -v` (loses data) |
| Redis marked unhealthy | Health check warning suppression | Add `--no-auth-warning` to Redis health check |
| Frontend exits immediately | Build failure | Rebuild: `docker-compose build --no-cache frontend` |

### Full Rebuild

```bash
docker-compose down
docker-compose rm -f
docker system prune -f
docker-compose build --no-cache
docker-compose up -d
```

---

## Container Health Checks

```bash
# Check all container statuses
docker-compose ps

# Check specific container health
docker inspect --format='{{.State.Health.Status}}' logbook-backend

# View health check logs
docker inspect --format='{{json .State.Health}}' logbook-backend | jq
```

### Expected Health States

| Container | Expected | Health Check |
|-----------|----------|-------------|
| `logbook-backend` | healthy | HTTP GET /health |
| `logbook-frontend` | healthy | wget http://localhost:80/ |
| `logbook-db` | healthy | mysqladmin ping |
| `logbook-redis` | healthy | redis-cli ping |

---

## Redis Container Unhealthy

**Error:** `dependency failed to start: container intranet-redis is unhealthy`

**Fix:** Update the health check to suppress auth warnings:

```yaml
redis:
  healthcheck:
    test: ["CMD-SHELL", "redis-cli -a $${REDIS_PASSWORD:-change_me_in_production} --no-auth-warning ping | grep PONG"]
    interval: 10s
    timeout: 5s
    retries: 5
    start_period: 30s
```

---

## Port Conflicts

```bash
# Check what's using a port
lsof -i :3000
lsof -i :3001
lsof -i :3306

# Change ports in .env
FRONTEND_PORT=3100
BACKEND_PORT=3101
```

---

## Container Networking

```bash
# Verify containers are on same network
docker network inspect logbook-internal

# Test connectivity between containers
docker-compose exec frontend ping -c 3 backend
docker-compose exec backend ping -c 3 mysql

# Test backend can reach database
docker-compose exec backend python -c "import pymysql; pymysql.connect(host='mysql')"
```

---

## Resource Issues

```bash
# Check resource usage
docker stats

# Check disk usage
docker system df

# Clean up unused resources
docker image prune -a
docker builder prune
docker system prune -a --volumes  # ⚠️ Removes ALL unused data
```

---

## Container Conflict Cleanup

If containers from a previous installation conflict:

```bash
# Remove all logbook containers
docker ps -a | grep logbook | awk '{print $1}' | xargs docker rm -f

# Remove all logbook images
docker images | grep logbook | awk '{print $3}' | xargs docker rmi -f

# Remove logbook networks
docker network ls | grep logbook | awk '{print $1}' | xargs docker network rm

# Fresh start
docker-compose up -d
```

---

## Docker Compose Profile Issues (2026-02-24)

### MinIO Required Variable Error

**Error:** `required variable MINIO_ROOT_PASSWORD is missing a value`

**Cause:** The MinIO service used `:?` (required variable) syntax. Docker Compose validates these even for inactive profiles (`with-s3`).

**Fix:** Updated to `:-` (default value) syntax. Pull latest:
```bash
git pull origin main
docker-compose up -d
```

MinIO only starts when you explicitly use `docker compose --profile with-s3 up -d`.

---

### Memory Resource Limits

All services in `docker-compose.yml` now have memory limits configured:

| Service | Limit | Reservation |
|---------|-------|-------------|
| MySQL | 512M | 256M |
| Redis | 128M | 64M |
| Backend | 768M | 384M |
| Frontend | 128M | 64M |

If containers are being OOM-killed, increase limits in `docker-compose.override.yml`.

---

**See also:** [Main Troubleshooting](Troubleshooting) | [Backend Issues](Troubleshooting-Backend) | [Quick Reference](Quick-Reference)
