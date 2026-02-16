# Deployment Guide

This guide covers deploying The Logbook across various platforms, from small devices like Raspberry Pi to enterprise cloud environments.

## Table of Contents

1. [Quick Reference](#quick-reference)
2. [Resource Requirements](#resource-requirements)
3. [Docker Deployment](#docker-deployment)
4. [Raspberry Pi](#raspberry-pi)
5. [Cloud Platforms](#cloud-platforms)
   - [AWS](#aws-deployment)
   - [Azure](#azure-deployment)
   - [Google Cloud](#google-cloud-deployment)
   - [DigitalOcean](#digitalocean-deployment)
6. [Self-Hosted Server](#self-hosted-server)
7. [Kubernetes](#kubernetes-deployment)
8. [Reverse Proxy Setup](#reverse-proxy-setup)
9. [SSL/HTTPS Setup](#sslhttps-setup)
10. [Backup & Recovery](#backup--recovery)

---

## Quick Reference

| Platform | Minimum RAM | Recommended | Profile |
|----------|-------------|-------------|---------|
| Raspberry Pi 3 | 1GB | 2GB | minimal |
| Raspberry Pi 4/5 | 2GB | 4GB | standard |
| Small VPS | 1GB | 2GB | minimal |
| Standard VPS | 2GB | 4GB | standard |
| Synology NAS (DS+/XS+) | 4GB | 8GB | standard |
| Production Server | 4GB | 8GB+ | full |
| Kubernetes | 2GB per pod | 4GB per pod | standard |

---

## Resource Requirements

### Minimal Profile (1-2GB RAM)
- Raspberry Pi, small VPS, budget hosting
- Single-user or small team (< 20 users)
- Basic features, no search

```bash
docker compose -f docker-compose.yml -f docker-compose.minimal.yml up -d
```

### Standard Profile (4GB RAM)
- Most deployments
- Medium organizations (20-200 users)
- All core features

```bash
docker compose up -d
```

### Full Profile (8GB+ RAM)
- Large organizations (200+ users)
- Elasticsearch search, S3 storage, email testing

```bash
docker compose --profile with-search --profile with-s3 up -d
```

---

## Docker Deployment

### One-Command Install (Any Platform)

```bash
curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/scripts/universal-install.sh | bash
```

### With Options

```bash
# Minimal for low-memory systems
curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/scripts/universal-install.sh | bash -s -- --profile minimal

# Full installation with all features
curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/scripts/universal-install.sh | bash -s -- --profile full

# Custom directory
curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/scripts/universal-install.sh | bash -s -- --dir /opt/the-logbook
```

### Manual Installation

```bash
# Clone repository
git clone https://github.com/thegspiro/the-logbook.git
cd the-logbook

# Copy and configure environment
cp .env.example .env
# Edit .env with your settings

# Generate secure secrets
openssl rand -hex 32  # For SECRET_KEY
openssl rand -hex 32  # For ENCRYPTION_KEY
openssl rand -hex 16  # For ENCRYPTION_SALT

# Start services
docker compose up -d

# View logs
docker compose logs -f
```

---

## Raspberry Pi

### Raspberry Pi 4/5 (Recommended)

```bash
# Install (uses minimal + ARM profiles automatically)
curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/scripts/universal-install.sh | bash -s -- --profile minimal

# Or manually
git clone https://github.com/thegspiro/the-logbook.git
cd the-logbook
cp .env.example .env
# Edit .env

docker compose -f docker-compose.yml -f docker-compose.minimal.yml -f docker-compose.arm.yml up -d
```

### Raspberry Pi 3 (Limited)

For Pi 3 with 1GB RAM:

1. Use minimal profile
2. Consider external database (MySQL on another machine)
3. Disable non-essential modules

```bash
# Edit .env to use external database
DB_HOST=your-database-server
DB_PORT=3306
```

### Optimization Tips for Pi

1. **Use SSD instead of SD card** - Much better performance
2. **Increase swap** - `sudo dphys-swapfile swapoff && sudo nano /etc/dphys-swapfile` (set CONF_SWAPSIZE=1024)
3. **Disable GUI** - Run headless with `sudo raspi-config`
4. **Overclock (carefully)** - Only on Pi 4/5 with good cooling

---

## Cloud Platforms

### AWS Deployment

#### EC2 (Simple)

```bash
# Launch EC2 instance
# - Amazon Linux 2023 or Ubuntu 22.04
# - t3.small (2GB) for minimal, t3.medium (4GB) for standard
# - Open ports: 22, 80, 443, 3000, 3001

# Connect and install
ssh ec2-user@your-instance

# Run universal installer
curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/scripts/universal-install.sh | bash
```

#### AWS with RDS (Production)

1. Create RDS MySQL instance:
   - Engine: MySQL 8.0
   - Instance: db.t3.micro (testing) or db.t3.small (production)
   - Enable automated backups

2. Create ElastiCache Redis:
   - Engine: Redis 7.x
   - Node: cache.t3.micro

3. Configure .env:
```bash
DB_HOST=your-rds-endpoint.rds.amazonaws.com
DB_PORT=3306
DB_NAME=the_logbook
DB_USER=admin
DB_PASSWORD=your-secure-password

REDIS_HOST=your-elasticache-endpoint.cache.amazonaws.com
REDIS_PORT=6379
```

4. Deploy without local database:
```bash
docker compose -f docker-compose.yml up -d backend frontend
```

#### AWS ECS/Fargate

For container-native deployments, build and push Docker images to ECR, then deploy via ECS task definitions. See the [AWS Deployment Guide](../docs/deployment/aws.md) for details.

---

### Azure Deployment

#### Azure VM

```bash
# Create VM via Azure CLI
az vm create \
  --resource-group myResourceGroup \
  --name the-logbook-vm \
  --image Ubuntu2204 \
  --size Standard_B2s \
  --admin-username azureuser \
  --generate-ssh-keys

# Connect and install
ssh azureuser@your-vm-ip
curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/scripts/universal-install.sh | bash
```

#### Azure with Managed Services

1. **Azure Database for MySQL**:
   - Flexible Server, Burstable B1ms
   - Enable SSL

2. **Azure Cache for Redis**:
   - Basic C0 (development) or Standard C1 (production)

3. Configure .env:
```bash
DB_HOST=your-server.mysql.database.azure.com
DB_USER=admin@your-server
DB_PASSWORD=your-secure-password

REDIS_HOST=your-cache.redis.cache.windows.net
REDIS_PORT=6380
REDIS_SSL=true
```

---

### Google Cloud Deployment

#### Compute Engine

```bash
# Create instance
gcloud compute instances create the-logbook \
  --zone=us-central1-a \
  --machine-type=e2-small \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud

# Connect and install
gcloud compute ssh the-logbook
curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/scripts/universal-install.sh | bash
```

#### Cloud Run (Serverless)

```bash
# Build and push images
docker build -t gcr.io/your-project/logbook-backend ./backend
docker build -t gcr.io/your-project/logbook-frontend ./frontend
docker push gcr.io/your-project/logbook-backend
docker push gcr.io/your-project/logbook-frontend

# Deploy
gcloud run deploy logbook-backend \
  --image gcr.io/your-project/logbook-backend \
  --platform managed \
  --allow-unauthenticated
```

---

### DigitalOcean Deployment

#### Droplet

```bash
# Create droplet via doctl
doctl compute droplet create the-logbook \
  --image ubuntu-22-04-x64 \
  --size s-2vcpu-2gb \
  --region nyc1

# Connect and install
ssh root@your-droplet-ip
curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/scripts/universal-install.sh | bash
```

#### App Platform

1. Create app from GitHub repository
2. Set environment variables in App Platform console
3. Add managed database (MySQL) and Redis

---

## Self-Hosted Server

### Ubuntu/Debian

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | bash
sudo usermod -aG docker $USER

# Relogin, then install The Logbook
curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/scripts/universal-install.sh | bash
```

### CentOS/RHEL/Fedora

```bash
# Install Docker
sudo dnf install -y docker docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER

# Relogin, then install
curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/scripts/universal-install.sh | bash
```

### Traditional Installation (No Docker)

See `./install.sh --traditional` for systemd-based installation on Ubuntu/Debian.

---

## Kubernetes Deployment

### Helm Chart (Coming Soon)

```bash
helm repo add the-logbook https://charts.the-logbook.org
helm install my-logbook the-logbook/the-logbook
```

### Manual Kubernetes

See `deploy/kubernetes/` for manifests:
- `deployment.yaml` - Backend and frontend deployments
- `service.yaml` - Services and ingress
- `configmap.yaml` - Configuration
- `secrets.yaml` - Sensitive data
- `pvc.yaml` - Persistent volumes

---

## Reverse Proxy Setup

### Nginx

```nginx
server {
    listen 80;
    server_name logbook.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name logbook.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/logbook.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/logbook.yourdomain.com/privkey.pem;

    # Frontend
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Backend API
    location /api/ {
        proxy_pass http://localhost:3001/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Traefik

```yaml
# docker-compose.override.yml
services:
  frontend:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.frontend.rule=Host(`logbook.yourdomain.com`)"
      - "traefik.http.routers.frontend.tls.certresolver=letsencrypt"

  backend:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.backend.rule=Host(`logbook.yourdomain.com`) && PathPrefix(`/api`)"
      - "traefik.http.routers.backend.tls.certresolver=letsencrypt"
```

### Caddy

```
logbook.yourdomain.com {
    handle /api/* {
        reverse_proxy localhost:3001
    }
    handle {
        reverse_proxy localhost:3000
    }
}
```

---

## SSL/HTTPS Setup

### Let's Encrypt with Certbot

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d logbook.yourdomain.com

# Auto-renewal (automatic with certbot)
sudo certbot renew --dry-run
```

### Self-Signed (Development Only)

```bash
mkdir -p infrastructure/docker/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout infrastructure/docker/ssl/key.pem \
  -out infrastructure/docker/ssl/cert.pem \
  -subj "/CN=localhost"
```

---

## Backup & Recovery

### Automated Backups

```bash
# Enable in .env
BACKUP_ENABLED=true
BACKUP_SCHEDULE=0 2 * * *  # Daily at 2 AM
BACKUP_RETENTION_DAYS=30
```

### Manual Backup

```bash
# Database
docker compose exec mysql mysqldump -u root -p the_logbook > backup.sql

# Files
tar -czvf uploads-backup.tar.gz uploads/

# Full backup
./scripts/backup.sh
```

### Restore

```bash
# Database
docker compose exec -T mysql mysql -u root -p the_logbook < backup.sql

# Files
tar -xzvf uploads-backup.tar.gz

# Full restore
./scripts/restore.sh backup-2024-01-15.tar.gz
```

---

## Troubleshooting

### Common Issues

**Container won't start:**
```bash
docker compose logs <service-name>
docker compose ps
```

**Database connection error:**
```bash
# Check if database is ready
docker compose exec mysql mysql -u root -p -e "SELECT 1"
```

**Out of memory (Raspberry Pi):**
```bash
# Use minimal profile
docker compose -f docker-compose.yml -f docker-compose.minimal.yml up -d

# Increase swap
sudo dphys-swapfile swapoff
sudo nano /etc/dphys-swapfile  # Set CONF_SWAPSIZE=2048
sudo dphys-swapfile setup
sudo dphys-swapfile swapon
```

**ARM image issues:**
```bash
# Explicitly use ARM compose
docker compose -f docker-compose.yml -f docker-compose.arm.yml up -d
```

---

## Environment Variables Reference

See `.env.example` for basic settings and `.env.example.full` for all options.

| Variable | Description | Default |
|----------|-------------|---------|
| `SECRET_KEY` | JWT signing key (64 hex chars) | Required |
| `ENCRYPTION_KEY` | Data encryption key (64 hex chars) | Required |
| `ENCRYPTION_SALT` | Encryption salt (32 hex chars) | Required |
| `DB_HOST` | Database hostname | db |
| `DB_PASSWORD` | Database password | Required |
| `REDIS_PASSWORD` | Redis password | Required |
| `FRONTEND_PORT` | Frontend port | 3000 |
| `BACKEND_PORT` | Backend port | 3001 |
| `ALLOWED_ORIGINS` | CORS origins | http://localhost:3000 |

---

## Getting Help

- **Documentation**: [Wiki](https://github.com/thegspiro/the-logbook/wiki)
- **Issues**: [GitHub Issues](https://github.com/thegspiro/the-logbook/issues)
- **Discussions**: [GitHub Discussions](https://github.com/thegspiro/the-logbook/discussions)
