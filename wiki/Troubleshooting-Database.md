# Troubleshooting: Database

Solutions for MySQL database connection, migration, and data issues in The Logbook.

---

## Connection Issues

### Can't Connect to Database

**Error:** `Can't connect to MySQL server on 'db'`

**Cause:** `DB_HOST` set to `db` instead of `mysql`.

**Fix:**
```bash
# Check your .env
grep DB_HOST .env

# Correct value
DB_HOST=mysql
```

### Backend Waits Forever for Database

**Cause:** MySQL container not yet healthy when backend starts.

**Fix:**
```bash
# Start MySQL first
docker-compose up -d mysql

# Wait for it to be healthy
docker-compose ps  # Should show "healthy"

# Then start backend
docker-compose up -d backend
```

### Access MySQL Shell

```bash
# Via Docker
docker exec -it logbook-db mysql -u logbook_user -p

# Once connected:
SHOW DATABASES;
USE the_logbook;
SHOW TABLES;
```

---

## Migration Issues

### Alembic Version Mismatch

**Error:** `Can't locate revision identified by '0001'`

**Fix:**
```bash
# Check current version
docker-compose exec mysql mysql -u root -p$MYSQL_ROOT_PASSWORD the_logbook \
  -e "SELECT * FROM alembic_version;"

# Update to correct version
docker-compose exec mysql mysql -u root -p$MYSQL_ROOT_PASSWORD the_logbook \
  -e "UPDATE alembic_version SET version_num='20260118_0001';"

# Restart backend
docker-compose restart backend
```

### Multiple Heads Detected

**Error:** `Multiple heads detected`

```bash
# Check migration chain
docker-compose exec backend alembic heads
docker-compose exec backend alembic history --verbose

# Look for duplicate revision IDs
grep -h "^revision = " backend/alembic/versions/*.py | sort | uniq -d
```

### Table Already Exists

**Error:** `Table 'X' already exists`

**Cause:** Migration partially ran. The table was created but the version wasn't recorded.

**Fix:**
```bash
# Manually set the migration version to skip the problematic migration
docker-compose exec mysql mysql -u root -p$MYSQL_ROOT_PASSWORD the_logbook \
  -e "UPDATE alembic_version SET version_num='<target_version>';"
docker-compose restart backend
```

### Run All Migrations

```bash
docker-compose exec backend alembic upgrade head
```

---

## Data Issues

### Enum Mismatch

**Error:** `'fire_ems_combined' is not among the defined enum values`

**Cause:** Database enum values don't match application expectations (case mismatch).

**Fix:** Run migrations to update enum values:
```bash
docker-compose exec backend alembic upgrade head
docker-compose restart backend
```

### Org-Scoped Unique Constraints

**Error:** `Duplicate entry for key 'uq_item_org_barcode'`

**Cause:** Barcodes/asset tags must be unique within each organization.

**Fix:** Search for the existing item with the same code. Either change the new item's code or update the existing one.

---

## Backup & Restore

### Create Backup

```bash
# Full database backup
docker exec logbook-db mysqldump -u logbook_user -p the_logbook > backup.sql

# Compressed backup
docker exec logbook-db mysqldump -u logbook_user -p the_logbook | gzip > backup.sql.gz
```

### Restore from Backup

```bash
# Restore
docker exec -i logbook-db mysql -u logbook_user -p the_logbook < backup.sql

# Restore compressed
gunzip -c backup.sql.gz | docker exec -i logbook-db mysql -u logbook_user -p the_logbook
```

---

## Performance

### Slow Queries

```bash
# Check active queries
docker-compose exec mysql mysql -u root -p -e "SHOW PROCESSLIST;"

# Enable slow query log
docker-compose exec mysql mysql -u root -p -e "SET GLOBAL slow_query_log = 'ON';"
docker-compose exec mysql mysql -u root -p -e "SET GLOBAL long_query_time = 2;"
```

### Table Statistics

```bash
docker-compose exec mysql mysql -u root -p the_logbook \
  -e "SELECT table_name, table_rows, data_length/1024/1024 AS 'Size (MB)' FROM information_schema.tables WHERE table_schema='the_logbook' ORDER BY data_length DESC;"
```

---

## Migration Issues on Unraid (2026-02-24)

### Alembic Revision Not Found on Unraid Filesystem

**Error:** `KeyError` or `Revision X is not present` during startup

**Cause:** Unraid's union filesystem (shfs) can make Docker bind-mounted `.py` files transiently invisible. Combined with stale `__pycache__` bytecode from a different Python version (e.g., host 3.11 vs container 3.13), Alembic fails to build its revision graph.

**Solution:** Multiple resilience improvements added:
1. `__pycache__` is automatically cleaned before Alembic loads the revision graph
2. Graph loading retries up to 3 times with 1s/2s backoff
3. SQL-based stamp fallback when `command.stamp("head")` fails
4. `create_all` + SQL stamp fallback when `command.upgrade()` fails

Pull latest and rebuild:
```bash
git pull origin main
docker-compose build --no-cache backend
docker-compose up -d
```

### Migration Revision ID Collision

**Error:** `Multiple heads detected` or duplicate revision errors

**Prevention:** A complete migration tracking document now exists at `docs/ALEMBIC_MIGRATIONS.md` with all 114+ revisions, naming conventions, and a template for new migrations. Check it before creating new migration files to avoid revision ID collisions.

---

**See also:** [Main Troubleshooting](Troubleshooting) | [Container Issues](Troubleshooting-Containers) | [Backend Issues](Troubleshooting-Backend)
