# Docker Deployment

Deploy The Logbook using Docker Compose on any Linux, macOS, or Windows system with Docker installed.

---

## Prerequisites

- Docker 20.10+
- Docker Compose 2.0+
- 4GB+ RAM (2GB minimum with minimal profile)
- 20GB+ storage

---

## Quick Start

```bash
# Clone the repository
git clone https://github.com/thegspiro/the-logbook.git
cd the-logbook

# Copy and configure environment
cp .env.example .env
# Edit .env with your settings (see Configuration below)

# Start all services
docker-compose up -d

# Verify
docker-compose ps
curl http://localhost:3001/health
```

Access the application at `http://localhost:3000`

---

## Configuration

### Required .env Settings

```bash
# Generate secrets
SECRET_KEY=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
ENCRYPTION_SALT=$(openssl rand -hex 16)

# Database
DB_HOST=mysql
DB_NAME=the_logbook
DB_USER=logbook_user
DB_PASSWORD=<strong-password>
MYSQL_ROOT_PASSWORD=<strong-password>

# Redis
REDIS_PASSWORD=<strong-password>

# CORS
ALLOWED_ORIGINS=["http://localhost:3000"]

# Ports
FRONTEND_PORT=3000
BACKEND_PORT=3001
```

### Frontend Environment

Create `frontend/.env`:
```bash
VITE_API_URL=/api/v1
VITE_ENV=production
```

> **Important:** Vite bakes environment variables at build time. After changing these, rebuild the frontend.

---

## Services

| Service | Container | Port | Description |
|---------|-----------|------|-------------|
| Frontend | logbook-frontend | 3000→80 | React app served by Nginx |
| Backend | logbook-backend | 3001 | FastAPI application |
| MySQL | logbook-db | 3306 (internal) | Database |
| Redis | logbook-redis | 6379 (internal) | Cache & sessions |

### Optional Services (Profiles)

| Service | Profile | Description |
|---------|---------|-------------|
| Nginx | `production` | Reverse proxy with SSL |
| Elasticsearch | `with-search` | Advanced search |
| MinIO | `with-s3` | S3-compatible storage |
| Mailhog | `development` | Email testing |

Enable a profile: `docker compose --profile with-search up -d`

> **Note:** Optional services use default values for credentials. Set `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` in `.env` if you enable the `with-s3` profile in production.

---

## Common Operations

### Start / Stop / Restart

```bash
docker-compose up -d          # Start all
docker-compose down            # Stop all
docker-compose restart         # Restart all
docker-compose restart backend # Restart one service
```

### Rebuild After Code Changes

```bash
docker-compose build --no-cache
docker-compose up -d
```

### View Logs

```bash
docker-compose logs -f              # All services
docker-compose logs -f backend      # Specific service
docker-compose logs --tail=50 backend # Last 50 lines
```

### Run Migrations

```bash
docker-compose exec backend alembic upgrade head
```

### Database Backup

```bash
docker exec logbook-db mysqldump -u logbook_user -p the_logbook > backup.sql
```

---

## Updating

```bash
cd /path/to/the-logbook
docker-compose down
git pull
docker-compose build --no-cache
docker-compose up -d
docker-compose exec backend alembic upgrade head
```

---

## Memory Profiles

| RAM | Profile | Notes |
|-----|---------|-------|
| 1-2GB | Minimal | Single worker, reduced cache |
| 4GB | Standard | Default configuration |
| 8GB+ | Full | Multiple workers, full cache |

For low-memory systems:
```bash
docker-compose -f docker-compose.yml -f docker-compose.minimal.yml up -d
```

---

## ARM / Raspberry Pi

```bash
docker-compose -f docker-compose.yml -f docker-compose.arm.yml up -d
```

Uses MariaDB 10.11+ instead of MySQL 8.0 for ARM compatibility.

---

## Docker Image Publishing

To publish images to GitHub Container Registry:

```bash
# Login
echo $GITHUB_TOKEN | docker login ghcr.io -u thegspiro --password-stdin

# Build and push
docker build --target production -t ghcr.io/thegspiro/the-logbook-backend:latest ./backend
docker push ghcr.io/thegspiro/the-logbook-backend:latest
```

---

**See also:** [Installation Guide](Installation) | [Unraid Deployment](Deployment-Unraid) | [Production Deployment](Deployment-Production)
