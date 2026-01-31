# 🚀 Unraid Quick Start

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

## Manual Installation

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

---

## Access Your Application

After installation completes:

**Frontend:** `http://YOUR-UNRAID-IP:7880`
**Backend API:** `http://YOUR-UNRAID-IP:7881/docs`

---

## If You Get Container Conflicts

If you see: `Error: The container name "/logbook-redis" is already in use`

**Fix:**
```bash
cd /mnt/user/appdata/the-logbook
docker-compose down --remove-orphans
docker-compose up -d
```

---

## Full Documentation

- **Complete Guide:** [unraid/QUICK-START-UPDATED.md](unraid/QUICK-START-UPDATED.md)
- **Deployment Guide:** [docs/deployment/unraid.md](docs/deployment/unraid.md)
- **Troubleshooting:** [docs/troubleshooting/README.md](docs/troubleshooting/README.md)

---

## Quick Commands

```bash
# View logs
cd /mnt/user/appdata/the-logbook && docker-compose logs -f

# Restart
cd /mnt/user/appdata/the-logbook && docker-compose restart

# Update
cd /mnt/user/appdata/the-logbook/unraid && ./unraid-setup.sh
# Choose option 2 (Update)
```

---

**Need help?** See the [troubleshooting guide](docs/troubleshooting/README.md) or open a [GitHub issue](https://github.com/thegspiro/the-logbook/issues).

🚒 **Happy logging!**
