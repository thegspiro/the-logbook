# Unraid Quick Start

**One command to install The Logbook on Unraid:**

```bash
curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/unraid/unraid-setup.sh | bash
```

This automated script will:
- ✅ Clean up any existing containers (fixes container conflicts)
- ✅ Clone the repository to `/mnt/user/appdata/the-logbook`
- ✅ Generate secure passwords automatically
- ✅ Build all containers with latest updates
- ✅ Start services and verify deployment

---

## Access Your Application

After installation completes:

**Frontend:** `http://YOUR-UNRAID-IP:7880`
**Backend API:** `http://YOUR-UNRAID-IP:7881/docs`

---

## Manual Installation

If you prefer manual installation:

```bash
# SSH into Unraid
ssh root@YOUR-UNRAID-IP

# Clone repository
cd /mnt/user/appdata
git clone https://github.com/thegspiro/the-logbook.git
cd the-logbook

# Run setup script
cd unraid
chmod +x unraid-setup.sh
./unraid-setup.sh
```

Choose installation option:
1. **Fresh Installation** - First time install (recommended)
2. **Update Existing** - Update current installation
3. **Clean Install** - Remove all data and reinstall

---

## Fixing Container Conflicts

If you see: `Error: The container name "/logbook-redis" is already in use`

### Quick Fix

```bash
cd /mnt/user/appdata/the-logbook
docker-compose down --remove-orphans
docker-compose up -d
```

### Or Use Setup Script

```bash
cd /mnt/user/appdata/the-logbook/unraid
./unraid-setup.sh
# Choose option 2 (Update)
```

---

## Common Commands

```bash
# Navigate to app directory
cd /mnt/user/appdata/the-logbook

# View all logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f backend
docker-compose logs -f frontend

# Restart services
docker-compose restart

# Stop everything
docker-compose down

# Start everything
docker-compose up -d

# Rebuild after updates
docker-compose build --no-cache
docker-compose up -d

# Check status
docker-compose ps
```

---

## Updating The Logbook

### Automatic Update

```bash
cd /mnt/user/appdata/the-logbook/unraid
./unraid-setup.sh
# Choose option 2 (Update)
```

### Manual Update

```bash
cd /mnt/user/appdata/the-logbook

# Pull latest code
git pull

# Rebuild containers
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

---

## What's Included

The setup script automatically configures:

### 🔐 Security
- Generates unique `SECRET_KEY` and `ENCRYPTION_KEY`
- Creates strong database passwords
- Sets proper Unraid permissions (nobody:users)

### 📦 Containers
- **Frontend** - React/Vite app (Port 7880)
- **Backend** - FastAPI (Port 7881)
- **Database** - MySQL 8.0
- **Cache** - Redis 7

### 📁 Directory Structure
```
/mnt/user/appdata/the-logbook/
├── mysql/           # Database files
├── redis/           # Cache data
├── data/            # Application data
├── uploads/         # File uploads
├── logs/            # Application logs
└── .env             # Configuration (auto-generated)

/mnt/user/backups/the-logbook/
└── backup_YYYYMMDD_HHMMSS/  # Automatic backups
```

---

## Configuration

All settings are in `.env` file at: `/mnt/user/appdata/the-logbook/.env`

### Important Settings

```bash
# Your Unraid IP (auto-detected)
ALLOWED_ORIGINS=http://192.168.1.10:7880

# Ports (change if needed)
FRONTEND_PORT=7880
BACKEND_PORT=7881

# Timezone
TZ=America/New_York
```

After changing `.env`, restart:
```bash
docker-compose restart
```

---

## Troubleshooting

See the **[Troubleshooting Guide](Troubleshooting)** for common issues.

### Quick Fixes

**Frontend not loading:**
```bash
docker-compose logs frontend
docker-compose restart frontend
```

**Backend API errors:**
```bash
curl http://localhost:7881/health
docker-compose logs backend
```

**Database issues:**
```bash
docker ps | grep logbook-db
docker-compose logs db
```

**Port conflicts:**
Edit `.env` and change `FRONTEND_PORT` and `BACKEND_PORT`, then restart.

---

## Next Steps

1. **[Complete the Onboarding Wizard](Onboarding)**
2. **[Configure Modules](Configuration-Modules)**
3. **[Set Up Users and Roles](Role-System)**
4. **[Review Security Settings](Security-Overview)**

---

**For complete documentation:** [Full Unraid Deployment Guide](Deployment-Unraid)

**Need help?** [Troubleshooting Guide](Troubleshooting) | [GitHub Issues](https://github.com/thegspiro/the-logbook/issues)
