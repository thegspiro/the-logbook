# Unraid Quick Start

## One-Command Install

SSH into your Unraid server and run:

```bash
curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/unraid/unraid-setup.sh | bash
```

This script clones the repository, generates secure credentials, builds all containers, and starts the application.

## Manual Install

```bash
ssh root@YOUR-UNRAID-IP

cd /mnt/user/appdata
git clone https://github.com/thegspiro/the-logbook.git
cd the-logbook/unraid
chmod +x unraid-setup.sh
./unraid-setup.sh
```

Choose option 1 (Fresh Installation) when prompted.

## Access

After installation:

- **Frontend:** `http://YOUR-UNRAID-IP:7880`
- **Backend API:** `http://YOUR-UNRAID-IP:7881/docs`

## Quick Commands

```bash
cd /mnt/user/appdata/the-logbook

# View logs
docker-compose logs -f

# Restart
docker-compose restart

# Update
cd unraid && ./unraid-setup.sh   # Choose option 2

# Fix container conflicts
docker-compose down --remove-orphans && docker-compose up -d
```

## Full Documentation

- **[Unraid Setup Guide](docs/deployment/unraid.md)** - complete installation, configuration, HTTPS, backups, and troubleshooting
- **[Unraid Installation Details](unraid/UNRAID-INSTALLATION.md)** - Community Apps template and advanced configuration
- **[Troubleshooting](docs/troubleshooting/README.md)** - general troubleshooting

**Need help?** Open a [GitHub issue](https://github.com/thegspiro/the-logbook/issues).
