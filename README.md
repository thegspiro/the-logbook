# The Logbook

An open-source, highly flexible, secure, and modular intranet platform designed for fire departments, emergency services, healthcare organizations, and other institutions requiring HIPAA-compliant, secure internal communication and management systems.

## 🌟 Features

- **Modular Architecture**: Enable only the modules you need
- **HIPAA Compliant**: Built with healthcare privacy and security standards in mind
- **Flexible Configuration**: Customize workflows, rules, and policies to match your organization
- **Tamper-Proof Logging**: Cryptographic audit trails with integrity verification
- **Multi-Tenancy Ready**: Host multiple organizations on a single installation
- **Integration Framework**: Connect with Microsoft 365, Google Workspace, LDAP, and more
- **Role-Based Access Control**: Granular permissions system
- **Mobile Responsive**: Progressive Web App (PWA) support

## 📦 Core Modules

- User Management & Authentication
- Document Management
- Communication Tools (Announcements, Messaging, Notifications)
- Calendar & Scheduling

## 🔌 Optional Modules

- **Training & Certification Tracking** ([Documentation](docs/TRAINING_PROGRAMS.md))
  - Multi-type requirements (hours, shifts, calls, skills, checklists)
  - Phase-based program progression with manual and automatic advancement
  - NFPA, NREMT, and Pro Board registry integration
  - Member progress tracking and dashboard widgets
  - Template system with duplication and versioning
  - Prerequisite programs and concurrent enrollment controls
  - Training session creation with approval workflow
  - Check-in/check-out tracking integrated with events
  - Milestone system with conditional reminders
  - Officer dashboard, requirements management, and external training integration pages
- **Compliance Management** - Compliance tracking and auditing
- **Scheduling & Shift Management** - Week/month calendar views, shift templates (day, night, morning), staffing requirements
- **Inventory Management** - Full CRUD with item types, status/condition tracking, category management, search and filtering
- **Member Directory & Tracking** - Member list, profiles, add/import, training history per member, configurable drop notifications with CC recipients, personal email support, editable email templates, membership tiers (Probationary/Active/Senior/Life) with auto-advancement, tier-based training exemptions, and voting eligibility gated by meeting attendance
- **Meeting Minutes** ([Documentation](docs/MEETING_MINUTES_MODULE.md))
  - 8 meeting types (business, special, committee, board, trustee, executive, annual, other)
  - Template system with configurable default sections per meeting type
  - Dynamic sections with reordering, add/remove
  - Draft → Review → Approved lifecycle with edit protection
  - Publish approved minutes to Documents module as styled HTML
  - Event linking and full-text search
- **Elections & Voting** - Full election system with ballots and candidate management
- Incident Reporting
- Equipment Maintenance
- Fundraising & Donations
- Vehicle/Apparatus Management
- Budget & Finance Tracking
- **Event Management** - Event creation/editing/duplication, type filtering, RSVP with admin overrides, recurring events (daily/weekly/monthly/yearly), event templates, file attachments, location booking prevention, cancel notifications, organization timezone support, QR code check-in, self-check-in pages, check-out, analytics
- **Reports** - Reports catalog with member, training, event, and compliance report categories
- **Documents** - Folder-based document management with 7 system folders (SOPs, Policies, Forms & Templates, Reports, Training Materials, Meeting Minutes, General Documents), custom folders, grid/list views, document viewer
- **Custom Forms** ([Documentation](docs/FORMS_MODULE.md))
  - Drag-and-drop form builder with 15+ field types
  - Public-facing forms via unique URL slugs with QR code generation
  - Cross-module integrations (Membership interest, Equipment assignment)
  - Submission management with filtering and export
  - Member lookup fields for internal workflows
  - Bot protection (honeypot), rate limiting, and input sanitization
- **Module Configuration** - Priority-based module overview system
- **Navigation Options** - Configurable top and side navigation layouts
- **Dashboard** - Organization stats (members, events, documents), training progress widget

## 🚀 Quick Start

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
4. Set up email notifications (optional)

For API access: `http://localhost:3001/docs`

See [QUICK_START_GITHUB.md](QUICK_START_GITHUB.md) for detailed instructions.

## 🖥️ Supported Platforms

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

## 📚 Documentation

### 📖 GitHub Wiki (Comprehensive Documentation)

**Visit our complete documentation wiki:** **[The Logbook Wiki](https://github.com/thegspiro/the-logbook/wiki)**

The wiki includes:
- 📖 **[Installation Guide](https://github.com/thegspiro/the-logbook/wiki/Installation)** - All installation methods
- 🚀 **[Unraid Quick Start](https://github.com/thegspiro/the-logbook/wiki/Unraid-Quick-Start)** - One-command setup
- 🔧 **[Configuration](https://github.com/thegspiro/the-logbook/wiki/Configuration-Environment)** - All settings explained
- 🛠️ **[Troubleshooting](https://github.com/thegspiro/the-logbook/wiki/Troubleshooting)** - Common issues & solutions
- 💻 **[Development Guides](https://github.com/thegspiro/the-logbook/wiki/Development-Backend)** - Backend & frontend
- 🔐 **[Security](https://github.com/thegspiro/the-logbook/wiki/Security-Overview)** - Security & compliance
- 📦 **[Modules](https://github.com/thegspiro/the-logbook/wiki/Module-Training)** - Feature documentation
- 📋 **[Quick Reference](https://github.com/thegspiro/the-logbook/wiki/Quick-Reference)** - Common commands

### Getting Started
- [Unraid Quick Start](UNRAID-QUICKSTART.md) - One-command Unraid installation
- [GitHub Setup Guide](docs/setup/github.md) - Complete GitHub configuration
- [Onboarding Guide](ONBOARDING.md) - First-time setup wizard
- [Contributing Guide](CONTRIBUTING.md) - How to contribute

### Deployment
- [AWS Deployment Guide](docs/deployment/aws.md) - EC2, RDS, and ElastiCache deployment on AWS
- [Unraid Deployment Guide](docs/deployment/unraid.md) - Complete Unraid guide
- [Unraid Updated Quick Start](unraid/QUICK-START-UPDATED.md) - Latest Unraid instructions
- [Proxmox Deployment Guide](docs/deployment/proxmox.md) - LXC and VM deployment on Proxmox VE
- [Synology NAS Deployment Guide](docs/deployment/synology.md) - Docker deployment on Synology DS+/XS+ series
- [General Deployment Guide](docs/DEPLOYMENT.md) - Deployment instructions
- [Docker Build & Publish](docs/DOCKER-BUILD-PUBLISH.md) - Docker image management
- [Docker Build Verification](scripts/verify-docker-build.sh) - Validate Docker configuration before deploying

### Backend
- [Python Backend Guide](docs/backend/python-backend.md) - Backend development
- [Training Module Backend](backend/app/docs/TRAINING_MODULE.md) - Backend API documentation

### Modules & Features
- [Training Programs Module](docs/TRAINING_PROGRAMS.md) - Comprehensive training management system
- [Meeting Minutes Module](docs/MEETING_MINUTES_MODULE.md) - Minutes management, templates, dynamic sections, document publishing
- [Custom Forms Module](docs/FORMS_MODULE.md) - Form builder, public forms, cross-module integrations
- [Drop Notifications & Email Templates](docs/DROP_NOTIFICATIONS.md) - Configurable drop notification messages, CC recipients, personal email, editable templates
- [Role System](ROLE_SYSTEM_README.md) - Role-based access control (16 system roles)
- [Onboarding Flow](docs/ONBOARDING_FLOW.md) - Onboarding process details

### Development & Quality
- [TypeScript Safeguards](docs/TYPESCRIPT_SAFEGUARDS.md) - Multi-layer TypeScript build protection, `as any` elimination
- [Testing Guide](TESTING.md) - Test suites for onboarding and event components

### Security & Troubleshooting
- [Security Guide](SECURITY.md) - Security policy and compliance
- [Troubleshooting Guide](docs/TROUBLESHOOTING.md) - Comprehensive troubleshooting for all modules
- [Deployment Troubleshooting](docs/troubleshooting/README.md) - Docker and deployment issues

## 🛠️ Technology Stack

- **Backend**: Python 3.11+, FastAPI, SQLAlchemy
- **Frontend**: React, TypeScript, Tailwind CSS
- **Database**: MySQL 8.0+
- **Cache**: Redis 7+
- **Search**: Elasticsearch (optional)
- **File Storage**: Local, S3, Azure Blob, Google Cloud Storage
- **Authentication**: OAuth 2.0, SAML, LDAP, Multi-Factor Authentication (TOTP)

## 🔒 Security

- **Password Security**: Argon2id hashing (OWASP recommended)
- **Encryption**: AES-256 encryption at rest for sensitive data
- **Transport Security**: TLS 1.3 for data in transit
- **Multi-Factor Authentication**: TOTP-based 2FA
- **Tamper-Proof Audit Logs**: Blockchain-inspired hash chain
- **Session Security**: JWT with automatic timeout
- **Rate Limiting**: Brute force protection (5 attempts = 30min lockout)
- **Input Sanitization**: XSS and SQL injection prevention
- **HIPAA Compliant**: 7-year audit retention, PHI encryption
- **Section 508 Accessible**: WCAG 2.1 Level AA compliance
- **Zero Plain Text Passwords**: All passwords securely hashed

See [SECURITY.md](SECURITY.md) for comprehensive security documentation.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## 💬 Support

- **Documentation**: See docs/ directory
- **Issues**: https://github.com/thegspiro/the-logbook/issues
- **Discussions**: https://github.com/thegspiro/the-logbook/discussions
- **Security**: See [SECURITY.md](SECURITY.md)

## 🔐 Security & Compliance

This platform is designed with security and compliance as top priorities:

- **HIPAA Compliance Features**: See [SECURITY.md](SECURITY.md#hipaa-compliance)
- **Section 508 Accessibility**: See [SECURITY.md](SECURITY.md#section-508-accessibility)
- **Audit Logging**: Tamper-proof logs with 7-year retention
- **Regular Security Updates**: Keep your installation up to date

**Important**: While this software provides security features, organizations are responsible for proper configuration, staff training, and ongoing compliance with applicable regulations.

## 🙏 Acknowledgments

Built with ❤️ for emergency services and healthcare organizations worldwide.
