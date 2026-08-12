# The Logbook - Unraid Integration

Everything needed to run The Logbook on Unraid lives in this directory:
setup and update scripts, Unraid-tuned Docker Compose files, the Community
Applications template, and the guides below.

## Which guide do I need?

| I want to…                                       | Read                                                                       |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| Install quickly with one command                 | [QUICK-START.md](./QUICK-START.md)                                         |
| Install, configure, and operate (the full guide) | [docs/deployment/unraid.md](../docs/deployment/unraid.md)                  |
| Install via the Community Applications template  | [UNRAID-INSTALLATION.md](./UNRAID-INSTALLATION.md) — see status below      |
| Build the images locally instead of pulling      | [BUILD-FROM-SOURCE-ON-UNRAID.md](./BUILD-FROM-SOURCE-ON-UNRAID.md)         |
| Submit the app to Community Applications         | [COMMUNITY-APP-SUBMISSION.md](./COMMUNITY-APP-SUBMISSION.md) (maintainers) |

## Install method status

- **Docker Compose (available now).** The supported path today. One command:

  ```bash
  curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/unraid/unraid-setup.sh | bash
  ```

  The script clones the repository to `/mnt/user/appdata/the-logbook`,
  generates secure credentials, sets Unraid permissions, and builds and starts
  all containers (frontend, backend, MySQL 8.0, Redis 7, nightly backup
  sidecar). Access the app at `http://YOUR-UNRAID-IP:7880` and complete the
  onboarding wizard. Requires Docker Compose — install the **Docker Compose
  Manager** plugin from Community Applications first.

- **Community Applications (pending).** The template
  ([the-logbook.xml](./the-logbook.xml)) and its installation guide
  ([UNRAID-INSTALLATION.md](./UNRAID-INSTALLATION.md)) are ready, but The
  Logbook has not yet been published to the Community Applications catalog —
  searching "The Logbook" in the Apps tab will not find it. Use the Docker
  Compose path until the listing is live.

## Security posture

The Unraid stack runs with `ENVIRONMENT=production`, which enforces a startup
security gate (strong secrets required, `DEBUG=false`, **API docs (`/docs`)
off** — enabling them blocks boot, and `SECURITY_ENFORCE_HTTPS=true`) — and
marks auth cookies `Secure`, which browsers refuse to send over plain
`http://`. The setup script therefore configures a **LAN-trial posture**
(`COOKIE_SECURE=false`) so logins work over plain HTTP on a trusted LAN.
Before real use, front the app with an HTTPS reverse proxy (Swag, Nginx Proxy
Manager), point `ALLOWED_ORIGINS` at your `https://` origin, and delete the
`COOKIE_SECURE` line from `.env`. Leave `TRUSTED_PROXY_IPS` empty unless you
actually add a proxy. Details:
[HTTPS with Reverse Proxy](../docs/deployment/unraid.md#https-with-reverse-proxy)
and [Security Hardening](./UNRAID-INSTALLATION.md#security-hardening).

## Files in this directory

| File                                                                           | Purpose                                                                                      |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| [unraid-setup.sh](./unraid-setup.sh)                                           | Automated install/update/clean-install script (the one-liner above)                          |
| [update.sh](./update.sh)                                                       | Preferred update path: verified database dump, build-context repair, rebuild, rollback notes |
| [validate-deployment.sh](./validate-deployment.sh)                             | Post-install validation and frontend build diagnosis                                         |
| [docker-compose-unraid.yml](./docker-compose-unraid.yml)                       | Unraid-tuned compose file (pre-built images)                                                 |
| [docker-compose-build-from-source.yml](./docker-compose-build-from-source.yml) | Compose file that builds images locally                                                      |
| [the-logbook.xml](./the-logbook.xml)                                           | Community Applications template                                                              |
| [.env.example](./.env.example)                                                 | Environment template the setup script starts from                                            |

## System requirements

| Component | Minimum | Recommended |
| --------- | ------- | ----------- |
| Unraid    | 6.9.0+  | 6.12.0+     |
| RAM       | 8 GB    | 16 GB       |
| Storage   | 20 GB   | 50 GB+      |
| CPU cores | 2       | 4+          |

Default ports: frontend (WebUI) `7880`, backend API `7881` — change via
`FRONTEND_PORT` / `BACKEND_PORT` in `.env` (and update `ALLOWED_ORIGINS` to
match).

## Configuration, backups, troubleshooting

These are covered once, in the full guide, rather than repeated here:

- [Configuration](../docs/deployment/unraid.md#configuration) — `.env` settings,
  ports, email; modules are enabled per organization in-app (Organization/Admin
  Settings > Modules), not via environment variables
- [Backup and Restore](../docs/deployment/unraid.md#backup-and-restore) —
  automated daily backups with restore drills, manual backup/restore
- [Updating](../docs/deployment/unraid.md#updating) — including the
  build-context repair step that prevents mid-rebuild failures
- [Troubleshooting](../docs/deployment/unraid.md#troubleshooting) — container
  conflicts, port conflicts, database issues, full rebuild

## Getting help

1. [Troubleshooting](../docs/deployment/unraid.md#troubleshooting) in the full guide
2. [docs/TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md) for application-level issues
3. [Unraid Community Forums](https://forums.unraid.net/) — post in the Docker Containers section with your Unraid version, container logs, and steps to reproduce
4. [GitHub Issues](https://github.com/thegspiro/the-logbook/issues) for bug reports

## License

The Logbook is open source software. See [LICENSE](../LICENSE) for details.
