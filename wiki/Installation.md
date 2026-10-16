# Installation

The Logbook runs as a Docker Compose stack: a React frontend served by nginx, a
FastAPI backend, MySQL 8.0, Redis 7, the ClamAV malware scanner and, in
production, a nightly backup sidecar. This page helps you pick an install path;
each platform's full procedure lives on its own page.

---

## Choose a Method

| Platform                                | Install with                       | Full guide                                                              |
| --------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| Linux server, VM, macOS, Windows (WSL2) | `scripts/universal-install.sh`     | [Docker Deployment](Deployment-Docker#install-with-a-script)            |
| Ubuntu / Debian server                  | `./install.sh --docker`            | [Docker Deployment](Deployment-Docker#install-with-a-script)            |
| Any Docker host, by hand                | `docker compose`                   | [Docker Deployment](Deployment-Docker#install-manually)                 |
| Unraid                                  | `unraid/unraid-setup.sh`           | [Unraid Deployment](Deployment-Unraid)                                  |
| Raspberry Pi 4/5, other ARM64           | `docker compose` with ARM override | [Docker → ARM and Raspberry Pi](Deployment-Docker#arm-and-raspberry-pi) |
| AWS, Azure, Google Cloud, DigitalOcean  | A VM running one of the above      | [Production → Cloud Platforms](Deployment-Production#cloud-platforms)   |
| Synology NAS, Proxmox                   | Docker Compose                     | [Production → Cloud Platforms](Deployment-Production#cloud-platforms)   |
| Local development                       | `npm run dev`                      | [Development Setup](#development-setup)                                 |

Whatever the platform, a deployment that members will use also needs the steps
in [Production Deployment](Deployment-Production): HTTPS in front of the app,
backups copied off the host, and the encryption keys stored somewhere safe.

### Requirements

- **4 GB RAM** for a standard install; the malware scanner runs on every
  install and sets the floor — see
  [Docker → Memory Profiles](Deployment-Docker#memory-profiles).
- **Docker Compose v2.24.4 or later** — see
  [Docker → Requirements](Deployment-Docker#requirements).
- **A public address** for `FRONTEND_URL`, which every emailed link is built
  from; a production backend will not start with a `localhost` value.
- **HTTPS** in front of the app, because production logins need it — see
  [Production → Startup Security Gate](Deployment-Production#startup-security-gate).

---

## Universal Installer

Detects the OS and CPU architecture, installs Docker if needed, generates
secrets, writes `.env` and starts the production stack:

```bash
curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/scripts/universal-install.sh \
  | bash -s -- --public-url https://logbook.example.org --dir "$HOME/the-logbook"
```

Options, what the script does and does not configure, and the steps to finish
afterwards: [Docker → Install with a Script](Deployment-Docker#install-with-a-script).

## Unraid

```bash
bash <(curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/unraid/unraid-setup.sh)
```

The script asks for the public HTTPS URL of your reverse proxy, so set that up
first. Full procedure: [Unraid Deployment](Deployment-Unraid).

## Docker Compose

```bash
git clone https://github.com/thegspiro/the-logbook.git
cd the-logbook
cp .env.example .env    # then edit it — see the full guide
docker compose up -d
```

As written this starts the **development** configuration, which is fine for a
local trial. A production install layers `docker-compose.prod.yml`; see
[Docker → Install Manually](Deployment-Docker#install-manually).

## Raspberry Pi and ARM

Raspberry Pi 4 or 5 with 4 GB or more and a 64-bit OS, using the minimal and
ARM compose overrides: [Docker → ARM and Raspberry Pi](Deployment-Docker#arm-and-raspberry-pi).

## Cloud and Other Platforms

Cloud VMs, Synology and Proxmox run the Docker Compose stack; managed MySQL and
Redis are supported through an override. See
[Production → Cloud Platforms](Deployment-Production#cloud-platforms).

---

## Development Setup

For contributors, running the backend and frontend directly on the host.
Prerequisites: Python 3.13+, Node.js 22.22.1+ with npm 10+, MySQL 8.0 and Redis 7 reachable from
the host.

```bash
git clone https://github.com/thegspiro/the-logbook.git
cd the-logbook
npm run setup             # npm install + backend pip install + frontend npm install

# The backend reads .env from its working directory (backend/)
cp .env.example backend/.env
# edit backend/.env: secrets, DB_HOST=localhost, REDIS_HOST=localhost

npm run dev               # backend on :3001 (uvicorn --reload), frontend on :3000 (Vite)
```

Open `http://localhost:3000`; Vite proxies `/api` to the backend
(`VITE_BACKEND_URL`, default `http://localhost:3001`). API docs are at
`http://localhost:3001/docs` while `ENABLE_DOCS=true`.

Details: [Backend Development](Development-Backend) ·
[Frontend Development](Development-Frontend).

---

## After Installing

1. **Run the onboarding wizard** at your site's URL: organization, first
   administrator, security settings, modules. See [Onboarding](Onboarding).
2. **Store the encryption keys.** Copy `ENCRYPTION_KEY` and `ENCRYPTION_SALT`
   from `.env` to a password manager or sealed record kept away from the server
   and its backups. Without them no backup can be decrypted. The app asks you
   to confirm this during setup.
3. **Enable modules** per organization in the app (Organization/Admin Settings
   → Modules). There are no module switches in `.env`. See
   [Module Configuration](Configuration-Modules).
4. **Check backups** are running and copied off the host. See
   [Production → Backup and Recovery](Deployment-Production#backup-and-recovery).
5. **Review security settings:** [Security Configuration](Configuration-Security)
   and [Security Overview](Security-Overview).
6. **Create users and roles:** [Role System](Role-System).

---

## Verification

Commands for the standard Docker Compose stack, run from the install directory.
On Unraid use [Unraid → Verify](Deployment-Unraid#verify).

```bash
# Every service Up; those with a healthcheck show (healthy)
docker compose ps

# Backend health, through the frontend's nginx (works in every configuration
# that publishes the frontend port)
curl -s http://localhost:3000/health
# {"status":"healthy","ready":true}

# Recent errors
docker compose logs --tail=50 backend
```

What the `/health` states mean:
[Production → Monitoring](Deployment-Production#monitoring). ClamAV takes a few
minutes to become healthy on first start.

Direct checks of the data services (container environment supplies the
credentials):

```bash
docker compose exec mysql sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" -e "SELECT 1"'
docker compose exec redis sh -c 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ping'
```

---

## Troubleshooting

- [Troubleshooting Guide](Troubleshooting)
- [Container & Docker diagnostics](Troubleshooting#container--docker-diagnostics)
- [Backend diagnostics](Troubleshooting#backend-service-diagnostics)
- [Frontend diagnostics](Troubleshooting#frontend--browser-diagnostics)
- Unraid-specific: [Unraid → Troubleshooting](Deployment-Unraid#troubleshooting)

---

## Uninstall

Back up first if you might want the data
([Production → Backup and Recovery](Deployment-Production#backup-and-recovery)).

```bash
cd the-logbook

docker compose down              # stop and remove containers, keep data
docker compose down -v           # also delete every volume — ALL DATA
docker compose down --rmi local  # also remove the images the stack built

cd .. && rm -rf the-logbook      # remove the checkout and its .env
```

On Unraid, use the setup script's uninstall option:
[Unraid → Uninstall](Deployment-Unraid#uninstall).

---

**Need help?** [GitHub Issues](https://github.com/thegspiro/the-logbook/issues) | [Discussions](https://github.com/thegspiro/the-logbook/discussions)
