# MySQL Health Check Diagnostic Guide

## Quick Diagnostics

Run these commands to diagnose the MySQL health issue:

### 1. Check Container Status
```bash
docker ps -a | grep mysql
# Look for: Status column - should show "healthy" not "unhealthy"
```

### 2. Check MySQL Logs
```bash
docker logs intranet-mysql --tail 100
# Look for errors like:
# - "Access denied"
# - "Can't connect to MySQL server"
# - "Unknown database"
# - "Out of memory"
```

### 3. Check Healthcheck Logs
```bash
docker inspect intranet-mysql | grep -A 20 "Health"
# Shows recent healthcheck results and output
```

### 4. Test Database Connection Manually
```bash
# Test ping
docker exec intranet-mysql mysqladmin ping -h localhost -uroot -pchange_me_in_production

# Test SELECT query
docker exec intranet-mysql mysql -uroot -pchange_me_in_production -e "SELECT 1"

# Test database exists
docker exec intranet-mysql mysql -uroot -pchange_me_in_production -e "SHOW DATABASES;"
```

---

## Common Issues & Fixes

### Issue 1: No .env File

**Symptom**: Using default passwords from docker-compose.yml

**Current defaults**:
- `MYSQL_ROOT_PASSWORD`: `change_me_in_production`
- `MYSQL_DATABASE`: `intranet_db`
- `MYSQL_USER`: `intranet_user`
- `MYSQL_PASSWORD`: `change_me_in_production`

**Fix**: Create `.env` file
```bash
cp .env.example .env
# Edit .env with your values
```

---

### Issue 2: Wrong Password in Healthcheck

**Symptom**:
```
Access denied for user 'root'@'localhost' (using password: YES)
```

**Diagnosis**:
```bash
# If using defaults, password should be: change_me_in_production
docker exec intranet-mysql mysqladmin ping -h localhost -uroot -pchange_me_in_production
```

**Fix**: If password was changed, update docker-compose.yml or recreate container:
```bash
docker-compose down
docker-compose up -d mysql
```

---

### Issue 3: Database Not Created Yet

**Symptom**:
```
ERROR 1049 (42000): Unknown database 'intranet_db'
```

**Cause**: Healthcheck runs before database initialization completes

**Current Config**: Has 90 second `start_period` which should be enough

**Check**:
```bash
# See if database exists
docker exec intranet-mysql mysql -uroot -pchange_me_in_production -e "SHOW DATABASES;" | grep intranet_db
```

**Fix if missing**: Database should be created automatically. If not:
```bash
docker exec intranet-mysql mysql -uroot -pchange_me_in_production -e "CREATE DATABASE IF NOT EXISTS intranet_db;"
```

---

### Issue 4: Memory Issues

**Symptom**:
```
InnoDB: Cannot allocate memory for the buffer pool
```

**Cause**: `innodb_buffer_pool_size=256M` may be too large for available RAM

**Check available memory**:
```bash
docker stats intranet-mysql --no-stream
```

**Fix**: Reduce buffer pool in docker-compose.yml:
```yaml
--innodb_buffer_pool_size=128M  # Reduced from 256M
```

Then restart:
```bash
docker-compose up -d mysql
```

---

### Issue 5: Healthcheck Timeout

**Symptom**: Container shows "unhealthy" but MySQL is actually running

**Diagnosis**:
```bash
# Check if MySQL responds (might be slow)
time docker exec intranet-mysql mysqladmin ping -h localhost -uroot -pchange_me_in_production
# If this takes >3 seconds, healthcheck times out
```

**Fix**: Increase timeout in docker-compose.yml:
```yaml
healthcheck:
  timeout: 10s  # Increased from 3s
```

---

## Recommended Quick Fixes

### Option 1: Restart MySQL Container
```bash
# Stop and remove container (data is preserved in volume)
docker-compose stop mysql
docker-compose rm -f mysql

# Start fresh
docker-compose up -d mysql

# Watch logs
docker logs -f intranet-mysql

# Wait for: "ready for connections" message
```

### Option 2: Check Healthcheck Manually
```bash
# Run the exact healthcheck command
docker exec intranet-mysql sh -c 'mysqladmin ping -h localhost -uroot -pchange_me_in_production && mysql -uroot -pchange_me_in_production -e "SELECT 1" intranet_db'

# Should output:
# mysqld is alive
# 1
# 1
```

### Option 3: Use Simpler Healthcheck (Temporary)

Edit `docker-compose.yml` healthcheck to:
```yaml
healthcheck:
  test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-uroot", "-pchange_me_in_production"]
  interval: 10s
  timeout: 5s
  retries: 12
  start_period: 120s
```

This only checks if MySQL is alive, not if database exists.

---

## Current Healthcheck Configuration

Your docker-compose.yml has:

```yaml
healthcheck:
  test:
    - "CMD-SHELL"
    - |
      mysqladmin ping -h localhost -uroot -p$${MYSQL_ROOT_PASSWORD:-change_me_in_production} &&
      mysql -uroot -p$${MYSQL_ROOT_PASSWORD:-change_me_in_production} -e 'SELECT 1' $${MYSQL_DATABASE:-intranet_db}
  interval: 5s      # Check every 5 seconds
  timeout: 3s       # Timeout after 3 seconds
  retries: 24       # Try 24 times
  start_period: 90s # Grace period for initialization
```

**Timeline**:
- 0-90s: Start period (failures don't count)
- 90s+: Up to 24 retries every 5s (120s more)
- **Total**: Up to 210 seconds before marking unhealthy

---

## Debugging Steps

### Step 1: Check if MySQL is actually running
```bash
docker exec intranet-mysql ps aux | grep mysql
# Should show mysqld process
```

### Step 2: Check if port is listening
```bash
docker exec intranet-mysql netstat -tlnp | grep 3306
# Should show MySQL listening on 3306
```

### Step 3: Test connection without password
```bash
docker exec intranet-mysql mysql -uroot -e "SELECT VERSION();"
# If this works, password is blank (misconfiguration)
```

### Step 4: Check MySQL error log
```bash
docker exec intranet-mysql tail -50 /var/log/mysql/error.log
# Or check container logs
docker logs intranet-mysql 2>&1 | grep -i error
```

---

## Environment Variables

If no `.env` file exists, these defaults are used:

```bash
MYSQL_DATABASE=intranet_db
MYSQL_USER=intranet_user
MYSQL_PASSWORD=change_me_in_production
MYSQL_ROOT_PASSWORD=change_me_in_production
```

**Verify what's actually set**:
```bash
docker exec intranet-mysql env | grep MYSQL
```

---

## If All Else Fails: Complete Reset

**WARNING: This deletes all data!**

```bash
# Stop all containers
docker-compose down

# Remove MySQL volume
docker volume rm the-logbook_mysql_data

# Remove any orphaned volumes
docker volume prune

# Start fresh
docker-compose up -d mysql

# Watch initialization
docker logs -f intranet-mysql

# Look for: "[Server] ready for connections"
```

---

## Backend Connection Test

Even if healthcheck fails, test if backend can connect:

```bash
# Start backend (will wait for healthy MySQL)
docker-compose up -d backend

# Check backend logs
docker logs intranet-backend --tail 50 | grep -i database

# Look for:
# ✅ "Database connected"
# ❌ "Failed to connect"
# ❌ "Access denied"
```

---

## Share These for Diagnosis

Please run and share output:

```bash
echo "=== Container Status ==="
docker ps -a | grep mysql

echo "=== MySQL Logs (last 30 lines) ==="
docker logs intranet-mysql --tail 30

echo "=== Healthcheck Status ==="
docker inspect intranet-mysql | grep -A 30 '"Health"'

echo "=== Environment Variables ==="
docker exec intranet-mysql env | grep MYSQL | grep -v PASSWORD

echo "=== Manual Healthcheck Test ==="
docker exec intranet-mysql sh -c 'mysqladmin ping -h localhost -uroot -pchange_me_in_production && echo "PING OK" || echo "PING FAILED"'

echo "=== Database Exists Check ==="
docker exec intranet-mysql mysql -uroot -pchange_me_in_production -e "SHOW DATABASES;" 2>&1 | grep intranet_db && echo "DATABASE EXISTS" || echo "DATABASE MISSING"
```

This will help identify exactly what's wrong!
