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
- Compliance Management
- Scheduling & Shift Management
- Inventory Management
- Member Directory & Tracking
- Meeting Management
- **Elections & Voting** - Full election system with ballots and candidate management
- Incident Reporting
- Equipment Maintenance
- Fundraising & Donations
- Vehicle/Apparatus Management
- Budget & Finance Tracking
- **Event Management** - QR code check-in, self-check-in pages, check-out functionality
- **Module Configuration** - Priority-based module overview system
- **Navigation Options** - Configurable top and side navigation layouts

## 🚀 Quick Start

### Option 1: Automated Setup (Recommended)

```bash
# Clone the repository
git clone https://github.com/thegspiro/the-logbook.git
cd the-logbook

# Run the interactive setup wizard
python3 scripts/setup-env.py

# The wizard will:
# - Generate secure secrets automatically
# - Configure database and Redis
# - Set up CORS and network settings
# - Enable/disable modules
# - Create your .env file

# Start with Docker Compose (includes MySQL, Redis, Backend, Frontend)
docker-compose up -d

# View logs
docker-compose logs -f backend

# Access the platform
# - Frontend: http://localhost:3000
# - Backend API: http://localhost:3001
# - API Docs: http://localhost:3001/docs
```

### Option 2: Manual Setup

```bash
# Clone the repository
git clone https://github.com/thegspiro/the-logbook.git
cd the-logbook

# Copy environment configuration
cp .env.example .env

# Generate secure keys and update .env
python3 -c "import secrets; print('SECRET_KEY=' + secrets.token_urlsafe(64))"
python3 -c "import secrets; print('ENCRYPTION_KEY=' + secrets.token_hex(32))"
python3 -c "import secrets; print('DB_PASSWORD=' + secrets.token_urlsafe(32))"
python3 -c "import secrets; print('REDIS_PASSWORD=' + secrets.token_urlsafe(32))"

# Edit .env and replace CHANGE_ME values with generated secrets

# Start with Docker Compose
docker-compose up -d

# View logs
docker-compose logs -f backend

# Access the platform
# - Frontend: http://localhost:3000
# - Backend API: http://localhost:3001
# - API Docs: http://localhost:3001/docs
```

### Option 3: Unraid Installation (One Command!)

For Unraid users, run this single command:

```bash
curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/unraid/unraid-setup.sh | bash
```

This automated script will:
- ✅ Clean up any existing containers (fixes conflicts)
- ✅ Clone repository to `/mnt/user/appdata/the-logbook`
- ✅ Generate secure passwords automatically
- ✅ Build and start all services
- ✅ Verify deployment

**Access:** `http://YOUR-UNRAID-IP:7880`

See [UNRAID-QUICKSTART.md](UNRAID-QUICKSTART.md) or [unraid/QUICK-START-UPDATED.md](unraid/QUICK-START-UPDATED.md) for detailed Unraid instructions.

### First Time Setup

After starting the containers:

1. Access the API documentation at http://localhost:3001/docs
2. The system will automatically create database tables on first run
3. Create your first organization and admin user via the API
4. Configure security settings and modules
5. Set up email/SMS notifications (optional)

See [QUICK_START_GITHUB.md](QUICK_START_GITHUB.md) for detailed instructions.

## 📚 Documentation

### Getting Started
- [Unraid Quick Start](UNRAID-QUICKSTART.md) - One-command Unraid installation
- [GitHub Setup Guide](docs/setup/github.md) - Complete GitHub configuration
- [Onboarding Guide](ONBOARDING.md) - First-time setup wizard
- [Contributing Guide](CONTRIBUTING.md) - How to contribute

### Deployment
- [Unraid Deployment Guide](docs/deployment/unraid.md) - Complete Unraid guide
- [Unraid Updated Quick Start](unraid/QUICK-START-UPDATED.md) - Latest Unraid instructions
- [General Deployment Guide](docs/DEPLOYMENT.md) - Deployment instructions
- [Docker Build & Publish](docs/DOCKER-BUILD-PUBLISH.md) - Docker image management

### Backend
- [Python Backend Guide](docs/backend/python-backend.md) - Backend development
- [Training Module Backend](backend/app/docs/TRAINING_MODULE.md) - Backend API documentation

### Modules & Features
- [Training Programs Module](docs/TRAINING_PROGRAMS.md) - Comprehensive training management system
- [Role System](ROLE_SYSTEM_README.md) - Role-based access control
- [Onboarding Flow](docs/ONBOARDING_FLOW.md) - Onboarding process details

### Security & Troubleshooting
- [Security Guide](SECURITY.md) - Security policy and compliance
- [Troubleshooting Guide](docs/troubleshooting/README.md) - Common issues and fixes

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
