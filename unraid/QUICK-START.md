# The Logbook - Docker Compose Quick Start

**5-Minute Setup for Unraid** | [Full Setup Guide](./DOCKER-COMPOSE-SETUP.md)

---

## Prerequisites

- Unraid 6.9.0+
- 8GB RAM minimum
- SSH or Terminal access

---

## Setup Steps

### 1. Create Directory

```bash
mkdir -p /mnt/user/appdata/the-logbook
cd /mnt/user/appdata/the-logbook
```

### 2. Download Files

```bash
# Clone repo
git clone https://github.com/thegspiro/the-logbook.git temp
mv temp/unraid/docker-compose-unraid.yml docker-compose.yml
mv temp/unraid/.env.example .env.example
rm -rf temp
```

### 3. Generate Secrets

```bash
# Generate these and save the output:
openssl rand -hex 32  # SECRET_KEY
openssl rand -hex 32  # ENCRYPTION_KEY
openssl rand -base64 32 | tr -d "=+/" | cut -c1-25  # DB passwords (run 3x)
```

### 4. Configure Environment

```bash
# Copy and edit .env
cp .env.example .env
nano .env

# Update these values:
SECRET_KEY=paste_generated_key_here
ENCRYPTION_KEY=paste_generated_key_here
MYSQL_ROOT_PASSWORD=paste_password_here
DB_PASSWORD=paste_password_here
REDIS_PASSWORD=paste_password_here
ALLOWED_ORIGINS=http://YOUR_UNRAID_IP:7880

# Save: Ctrl+O, Enter, Ctrl+X
chmod 600 .env
```

### 5. Create Directories

```bash
mkdir -p mysql redis data uploads logs
mkdir -p /mnt/user/backups/the-logbook
chown -R 99:100 /mnt/user/appdata/the-logbook
chown -R 99:100 /mnt/user/backups/the-logbook
```

### 6. Start Services

```bash
docker-compose pull
docker-compose up -d
```

### 7. Verify

```bash
# Check status (all should be "Up" and "healthy")
docker-compose ps

# View logs
docker-compose logs -f

# Test health
curl http://localhost:7881/health
```

### 8. Access

Open browser: `http://YOUR-UNRAID-IP:7880`

Complete the setup wizard!

---

## Common Commands

```bash
cd /mnt/user/appdata/the-logbook

# Start/Stop
docker-compose start
docker-compose stop
docker-compose restart

# Logs
docker-compose logs -f
docker-compose logs backend

# Update
docker-compose pull
docker-compose up -d

# Backup
docker-compose exec backend /app/scripts/backup.sh

# Status
docker-compose ps
```

---

## Troubleshooting

### Container won't start
```bash
docker-compose logs backend
```

### Port conflict
```bash
# Edit .env and change ports
nano .env
# Update: FRONTEND_PORT=8880
docker-compose up -d
```

### Reset everything
```bash
docker-compose down -v
rm -rf mysql redis data uploads logs
mkdir -p mysql redis data uploads logs
chown -R 99:100 .
docker-compose up -d
```

---

## Files Location

```
/mnt/user/appdata/the-logbook/
├── docker-compose.yml  # Main config
├── .env                # Secrets (DO NOT commit!)
├── mysql/              # Database files
├── redis/              # Cache files
├── data/               # App data
├── uploads/            # User uploads
└── logs/               # Application logs

/mnt/user/backups/the-logbook/
└── *.tar.gz            # Automated backups
```

---

## Default Settings

| Setting | Value |
|---------|-------|
| Web Interface | http://UNRAID-IP:7880 |
| API Endpoint | http://UNRAID-IP:7881 |
| Database | Internal (port 3306) |
| Redis | Internal (port 6379) |
| Backups | Daily at 2 AM |
| Retention | 30 days |
| User/Group | 99:100 (nobody:users) |

---

## Need More Help?

- 📖 [Full Setup Guide](./DOCKER-COMPOSE-SETUP.md) - Step-by-step with screenshots
- 📝 [Unraid Installation Guide](./UNRAID-INSTALLATION.md) - Complete documentation
- 🐛 [GitHub Issues](https://github.com/thegspiro/the-logbook/issues) - Report bugs
- 💬 [Unraid Forums](https://forums.unraid.net/) - Community support

---

**Happy deploying!** 🚀
