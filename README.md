# The Logbook

An open-source, modular intranet platform designed for fire departments, emergency services, healthcare organizations, and other institutions requiring HIPAA-compliant internal communication and management systems.

## Features

- **Modular Architecture** — Enable only the modules you need
- **HIPAA Compliant** — Built with healthcare privacy and security standards in mind
- **Flexible Configuration** — Customize workflows, rules, and policies to match your organization
- **Tamper-Proof Logging** — Cryptographic audit trails with integrity verification
- **Multi-Tenancy Ready** — Host multiple organizations on a single installation
- **Integration Framework** — Connect with Microsoft 365, Google Workspace, LDAP, and more
- **Role-Based Access Control** — Granular permissions with 16 system roles
- **Mobile Responsive** — Progressive Web App (PWA) support
- **Public Kiosk Displays** — Tablet-friendly pages for room QR code check-in, no login required
- **Unified Location System** — Single source of truth for all rooms, buildings, and venues across every module

## Core Modules

| Module | Description |
|--------|-------------|
| **User Management & Authentication** | Member profiles, roles, permissions, OAuth 2.0 / SAML / LDAP, MFA |
| **Document Management** | 7 system folders (SOPs, Policies, Forms, Reports, Training Materials, Meeting Minutes, General), custom folders, grid/list views, document viewer |
| **Communication Tools** | Announcements, messaging, notifications |
| **Calendar & Scheduling** | Week/month views, shift templates (day, night, morning), staffing requirements |
| **Dashboard** | Organization stats, training progress widget, member overview |

## Modules

### Event Management

Event creation, editing, and duplication with type filtering. RSVP with admin overrides, recurring events (daily/weekly/monthly/yearly), event templates, file attachments, location booking conflict prevention, cancel notifications, organization timezone support, QR code check-in, self-check-in pages, check-out tracking, and analytics.

### Locations & Kiosk Display

Unified location management that serves as the single source of truth for rooms, buildings, and venues across all modules. Location Setup Wizard with address, building, floor, room, and capacity fields.

- **Kiosk Display** — Each location gets a non-guessable display URL (`/display/{code}`) designed for tablets left in rooms. The page automatically shows the current event's QR code and cycles to the next event. No authentication required on the display — auth happens on the scanning member's device.
- **Facility Bridge** — When the Facilities module is enabled, locations can optionally link to a Facility record for deep building management data (maintenance, inspections, utilities).
- **Universal Picker** — Events, Training, and Meetings all reference the same `locations` table. Turning Facilities on or off never breaks location references.

### Training & Certification Tracking ([Documentation](docs/TRAINING_PROGRAMS.md))

- Multi-type requirements (hours, shifts, calls, skills, checklists)
- Phase-based program progression with manual and automatic advancement
- NFPA, NREMT, and Pro Board registry integration
- Member progress tracking and dashboard widgets
- Template system with duplication and versioning
- Prerequisite programs and concurrent enrollment controls
- Training session creation with approval workflow and location dropdown
- Check-in/check-out tracking integrated with events
- Milestone system with conditional reminders
- Officer dashboard, requirements management, and external training integration pages
- Compliance and competency matrix with frequency-aware evaluation

### Member Directory & Tracking

Member list, profiles, add/import, training history per member. Configurable drop notifications with CC recipients, personal email support, and editable email templates. Membership tiers (Probationary, Active, Senior, Life) with auto-advancement, tier-based training exemptions, and voting eligibility gated by meeting attendance.

### Meeting Minutes ([Documentation](docs/MEETING_MINUTES_MODULE.md))

- 8 meeting types (business, special, committee, board, trustee, executive, annual, other)
- Template system with configurable default sections per meeting type
- Dynamic sections with reordering, add/remove
- Draft, Review, Approved lifecycle with edit protection
- Publish approved minutes to Documents module as styled HTML
- Event linking and full-text search

### Custom Forms ([Documentation](docs/FORMS_MODULE.md))

- Drag-and-drop form builder with 15+ field types
- Public-facing forms via unique URL slugs with QR code generation
- Cross-module integrations (membership interest, equipment assignment)
- Submission management with filtering and export
- Member lookup fields for internal workflows
- Bot protection (honeypot), rate limiting, and input sanitization

### Elections & Voting

Full election system with ballots and candidate management.

### Inventory Management

Full CRUD with item types, status/condition tracking, category management, search and filtering.

### Compliance Management

Compliance tracking and auditing across training requirements, certifications, and member records.

### Facilities Management

Building and property management including maintenance tracking, inspections, and utilities. Links to Locations for room-level data.

### Reports

Reports catalog with member, training, event, and compliance report categories.

### Additional Modules

| Module | Description |
|--------|-------------|
| **Module Configuration** | Priority-based module overview system |
| **Navigation Options** | Configurable top and side navigation layouts |
| Vehicle/Apparatus Management | Vehicle and apparatus tracking |
| Incident Reporting | *Planned* |
| Equipment Maintenance | *Planned* |
| Fundraising & Donations | *Planned* |
| Budget & Finance Tracking | *Planned* |

## Quick Start

### One-Line Install (Any Platform)

Works on Linux (Ubuntu, Debian, Fedora, CentOS, Alpine, Arch), macOS, and Raspberry Pi:

```bash
curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/scripts/universal-install.sh | bash
```

This automatically:
- ✅ Detects your OS and architecture (x86_64, ARM64, ARMv7)
- ✅ Installs Docker if needed
- ✅ Generates secure secrets
- ✅ Configures optimal settings for your hardware
- ✅ Starts all services

**Access:** `http://localhost:3000`

### Installation Profiles

Choose a profile based on your hardware:

| Profile | RAM | Best For |
|---------|-----|----------|
| `minimal` | 1-2GB | Raspberry Pi, small VPS |
| `standard` | 4GB | Most deployments (default) |
| `full` | 8GB+ | Large organizations, all features |

```bash
# Raspberry Pi / Low memory
curl -sSL .../universal-install.sh | bash -s -- --profile minimal

# Standard (default)
curl -sSL .../universal-install.sh | bash

# Full with Elasticsearch, S3 storage
curl -sSL .../universal-install.sh | bash -s -- --profile full
```

### Platform-Specific Guides

<details>
<summary><strong>🐳 Docker (Manual)</strong></summary>

```bash
git clone https://github.com/thegspiro/the-logbook.git
cd the-logbook
cp .env.example .env

# Generate secrets (copy output to .env)
openssl rand -hex 32  # SECRET_KEY
openssl rand -hex 32  # ENCRYPTION_KEY
openssl rand -hex 16  # ENCRYPTION_SALT

docker compose up -d
```
</details>

<details>
<summary><strong>🍓 Raspberry Pi</strong></summary>

```bash
# Automatic (recommended)
curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/scripts/universal-install.sh | bash -s -- --profile minimal

# Manual with ARM + minimal profiles
git clone https://github.com/thegspiro/the-logbook.git
cd the-logbook
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.minimal.yml -f docker-compose.arm.yml up -d
```
</details>

<details>
<summary><strong>☁️ AWS / Azure / GCP</strong></summary>

```bash
# EC2/VM - SSH in, then:
curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/scripts/universal-install.sh | bash

# With managed database (RDS/Azure SQL/Cloud SQL):
# Edit .env to point to your managed database
DB_HOST=your-database-endpoint
DB_PASSWORD=your-secure-password
docker compose up -d backend frontend
```

See [AWS Deployment Guide](docs/deployment/aws.md) for detailed AWS instructions or [Deployment Guide](wiki/Deployment-Guide.md) for other cloud platforms.
</details>

<details>
<summary><strong>🖥️ Unraid</strong></summary>

```bash
curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/unraid/unraid-setup.sh | bash
```

Access: `http://YOUR-UNRAID-IP:7880`

See [Unraid Quick Start](unraid/QUICK-START-UPDATED.md) for details.
</details>

<details>
<summary><strong>🖧 Proxmox VE</strong></summary>

```bash
# Create an LXC container with nesting enabled, then inside it:
curl -fsSL https://get.docker.com | sh
git clone https://github.com/thegspiro/the-logbook.git /opt/the-logbook
cd /opt/the-logbook
cp .env.example .env
# Edit .env with your settings
docker compose up -d
```

Access: `http://YOUR-LXC-IP:3000`

See [Proxmox Deployment Guide](docs/deployment/proxmox.md) for details.
</details>

<details>
<summary><strong>💾 Synology NAS</strong></summary>

```bash
# SSH into your Synology NAS, then:
sudo mkdir -p /volume1/docker/the-logbook
cd /volume1/docker/the-logbook
sudo git clone https://github.com/thegspiro/the-logbook.git .
sudo cp .env.example .env
# Edit .env with your settings
sudo docker compose up -d
```

Access: `http://YOUR-NAS-IP:3000`

See [Synology Deployment Guide](docs/deployment/synology.md) for details.
</details>

<details>
<summary><strong>🔧 Traditional (No Docker)</strong></summary>

```bash
git clone https://github.com/thegspiro/the-logbook.git
cd the-logbook
./install.sh --traditional
```

Installs directly with systemd services (Ubuntu/Debian only).
</details>

### First Time Setup

After starting the containers:

1. Open `http://localhost:3000` in your browser
2. Complete the onboarding wizard (organization setup, admin account)
3. Configure modules and settings as needed
4. Add locations via the Location Setup Wizard (enables kiosk displays)
5. Set up email notifications (optional)

For API access: `http://localhost:3001/docs`

See [QUICK_START_GITHUB.md](QUICK_START_GITHUB.md) for detailed instructions.

## Supported Platforms

| Platform | Architecture | Profile | Status |
|----------|--------------|---------|--------|
| **Linux** (Ubuntu, Debian, Fedora, CentOS, Alpine, Arch) | x86_64 | All | ✅ Full support |
| **macOS** (Intel & Apple Silicon) | x86_64, ARM64 | All | ✅ Full support |
| **Windows** (WSL2) | x86_64 | All | ✅ Full support |
| **Raspberry Pi 4/5** | ARM64 | minimal, standard | ✅ Full support |
| **Raspberry Pi 3** | ARMv7 | minimal | ⚠️ Limited (1GB RAM) |
| **AWS** (EC2, ECS, Fargate) | x86_64, ARM64 | All | ✅ Full support |
| **Azure** (VMs, Container Instances) | x86_64 | All | ✅ Full support |
| **Google Cloud** (Compute, Cloud Run) | x86_64 | All | ✅ Full support |
| **DigitalOcean** (Droplets, App Platform) | x86_64 | All | ✅ Full support |
| **Proxmox VE** (LXC, VM) | x86_64 | All | ✅ Full support |
| **Synology NAS** (DS+, XS+ series) | x86_64 | minimal, standard | ✅ Full support |
| **Unraid** | x86_64 | standard | ✅ Optimized |
| **Kubernetes** | x86_64, ARM64 | standard, full | ✅ Helm chart available |

## Documentation

**[The Logbook Wiki](https://github.com/thegspiro/the-logbook/wiki)** — Comprehensive documentation including installation, configuration, troubleshooting, and development guides.

### Getting Started
- [Quick Start Guide](QUICK_START_GITHUB.md) — Detailed first-run instructions
- [Onboarding Guide](ONBOARDING.md) — First-time setup wizard
- [Contributing Guide](CONTRIBUTING.md) — How to contribute

### Deployment
- [General Deployment Guide](docs/DEPLOYMENT.md) — Overview of all deployment methods
- [AWS Deployment](docs/deployment/aws.md) — EC2, RDS, and ElastiCache
- [Proxmox Deployment](docs/deployment/proxmox.md) — LXC and VM
- [Synology NAS Deployment](docs/deployment/synology.md) — Docker on Synology DS+/XS+
- [Unraid Quick Start](unraid/QUICK-START-UPDATED.md) — One-command Unraid setup
- [Docker Build & Publish](docs/DOCKER-BUILD-PUBLISH.md) — Docker image management

### Modules & Features
- [Training Programs](docs/TRAINING_PROGRAMS.md) — Training management, requirements, certifications
- [Training Module Backend](backend/app/docs/TRAINING_MODULE.md) — Backend API for training
- [Meeting Minutes](docs/MEETING_MINUTES_MODULE.md) — Minutes management, templates, document publishing
- [Custom Forms](docs/FORMS_MODULE.md) — Form builder, public forms, cross-module integrations
- [Public API](docs/PUBLIC_API_DOCUMENTATION.md) — Public forms and kiosk display endpoints
- [Drop Notifications](docs/DROP_NOTIFICATIONS.md) — Configurable notifications, CC recipients, email templates
- [Application Pages](APPLICATION_PAGES.md) — Complete page inventory and route map
- [Role System](ROLE_SYSTEM_README.md) — Role-based access control (16 system roles)

### Development
- [Python Backend Guide](docs/backend/python-backend.md) — Backend development
- [TypeScript Safeguards](docs/TYPESCRIPT_SAFEGUARDS.md) — Multi-layer build protection
- [Testing Guide](TESTING.md) — Test suites for onboarding and event components
- [Architecture Review](ARCHITECTURE_REVIEW_AND_IMPROVEMENT_PLAN.md) — Architecture decisions and improvement plan

### Security & Troubleshooting
- [Security Guide](SECURITY.md) — Security policy and compliance
- [Troubleshooting Guide](docs/TROUBLESHOOTING.md) — All modules including locations, kiosk, and training
- [Deployment Troubleshooting](docs/troubleshooting/README.md) — Docker and deployment issues

## Technology Stack

| Layer | Technologies |
|-------|-------------|
| **Backend** | Python 3.11+, FastAPI, SQLAlchemy (async), Alembic |
| **Frontend** | React 18, TypeScript, Tailwind CSS |
| **Database** | MySQL 8.0+ |
| **Cache** | Redis 7+ |
| **Search** | Elasticsearch (optional) |
| **File Storage** | Local, S3, Azure Blob, Google Cloud Storage |
| **Authentication** | OAuth 2.0, SAML, LDAP, TOTP-based MFA |

## Security & Compliance

- **Password Security** — Argon2id hashing (OWASP recommended)
- **Encryption** — AES-256 at rest for sensitive data, TLS 1.3 in transit
- **Multi-Factor Authentication** — TOTP-based 2FA
- **Tamper-Proof Audit Logs** — Blockchain-inspired hash chain with 7-year retention
- **Session Security** — JWT with automatic timeout
- **Rate Limiting** — Brute force protection (5 attempts = 30 min lockout)
- **Input Sanitization** — XSS and SQL injection prevention
- **HIPAA Compliant** — PHI encryption, audit retention, access controls
- **Section 508 Accessible** — WCAG 2.1 Level AA compliance
- **Public Endpoints** — Kiosk displays and public forms use non-guessable codes; no sensitive data exposed

See [SECURITY.md](SECURITY.md) for comprehensive security documentation.

**Important**: While this software provides security features, organizations are responsible for proper configuration, staff training, and ongoing compliance with applicable regulations.

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## Support

- **Documentation**: [The Logbook Wiki](https://github.com/thegspiro/the-logbook/wiki)
- **Issues**: https://github.com/thegspiro/the-logbook/issues
- **Discussions**: https://github.com/thegspiro/the-logbook/discussions
- **Security**: [SECURITY.md](SECURITY.md)
