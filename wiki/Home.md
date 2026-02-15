# Welcome to The Logbook Wiki

![The Logbook](https://img.shields.io/badge/Version-1.0.0-blue.svg)
![License](https://img.shields.io/badge/License-MIT-green.svg)
![Python](https://img.shields.io/badge/Python-3.13-blue.svg)
![React](https://img.shields.io/badge/React-18.3-blue.svg)

An open-source, highly flexible, secure, and modular intranet platform designed for fire departments, emergency services, healthcare organizations, and other institutions requiring HIPAA-compliant, secure internal communication and management systems.

---

## 🚀 Quick Start

### Unraid (Recommended - One Command!)

```bash
curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/unraid/unraid-setup.sh | bash
```

Then access: `http://YOUR-UNRAID-IP:7880`

**[→ Full Unraid Quick Start Guide](Unraid-Quick-Start)**

### Docker Compose

```bash
git clone https://github.com/thegspiro/the-logbook.git
cd the-logbook
cp .env.example .env
# Edit .env with your settings
docker-compose up -d
```

**[→ Complete Installation Guide](Installation)**

---

## 📚 Documentation Sections

### 🎯 Getting Started
- **[Installation Guide](Installation)** - Complete setup instructions
- **[Unraid Quick Start](Unraid-Quick-Start)** - One-command Unraid deployment
- **[Onboarding Guide](Onboarding)** - First-time setup wizard
- **[Quick Reference](Quick-Reference)** - Common commands and tasks

### 🚢 Deployment
- **[Unraid Deployment](Deployment-Unraid)** - Complete Unraid guide
- **[Docker Deployment](Deployment-Docker)** - Docker Compose deployment
- **[Production Deployment](Deployment-Production)** - Production best practices

### 🔧 Configuration
- **[Environment Variables](Configuration-Environment)** - All .env settings explained
- **[Module Configuration](Configuration-Modules)** - Enable/disable modules
- **[Security Configuration](Configuration-Security)** - Security settings

### 💻 Development
- **[Backend Development](Development-Backend)** - Python/FastAPI development
- **[Frontend Development](Development-Frontend)** - React/TypeScript development
- **[Contributing Guide](Contributing)** - How to contribute

### 📦 Modules
- **[Training Programs](Module-Training)** - Training & certification tracking
- **[Elections & Voting](Module-Elections)** - Election management system
- **[Event Management](Module-Events)** - QR code check-in system
- **[Scheduling](Module-Scheduling)** - Shift management
- **[Compliance](Module-Compliance)** - Compliance tracking

### 🔐 Security
- **[Security Overview](Security-Overview)** - Security policy and compliance
- **[Authentication](Security-Authentication)** - OAuth, SAML, LDAP, MFA
- **[Encryption](Security-Encryption)** - AES-256 encryption
- **[Audit Logging](Security-Audit-Logging)** - Tamper-proof audit trails
- **[HIPAA Compliance](Security-HIPAA)** - HIPAA compliance guide

### 🛠️ Troubleshooting
- **[Common Issues](Troubleshooting)** - Solutions to common problems
- **[Container Conflicts](Troubleshooting-Containers)** - Docker container issues
- **[Frontend Issues](Troubleshooting-Frontend)** - Frontend not loading
- **[Backend Issues](Troubleshooting-Backend)** - API errors
- **[Database Issues](Troubleshooting-Database)** - Database connection problems

### 📖 Reference
- **[API Documentation](API-Reference)** - Complete API reference
- **[Database Schema](Database-Schema)** - Database structure
- **[Role System](Role-System)** - RBAC documentation
- **[Technology Stack](Technology-Stack)** - Tech stack details

---

## 🌟 Key Features

- ✅ **Modular Architecture** - Enable only what you need
- ✅ **HIPAA Compliant** - Healthcare privacy and security standards
- ✅ **Tamper-Proof Logging** - Blockchain-inspired audit trails
- ✅ **Multi-Tenancy** - Host multiple organizations
- ✅ **Role-Based Access Control** - Granular permissions
- ✅ **Progressive Web App** - Mobile responsive PWA
- ✅ **Integration Ready** - Microsoft 365, Google Workspace, LDAP
- ✅ **Zero Configuration** - One-command installation for Unraid

---

## 🛠️ Technology Stack

| Component | Technology |
|-----------|-----------|
| **Backend** | Python 3.13, FastAPI, SQLAlchemy |
| **Frontend** | React 18.3, TypeScript 5.7, Vite 6 |
| **Database** | MySQL 8.0+ (MariaDB 10.11+ for ARM) |
| **Cache** | Redis 7+ |
| **Authentication** | OAuth 2.0, SAML, LDAP, TOTP MFA |
| **Encryption** | AES-256, Argon2id |
| **Container** | Docker, Docker Compose |

---

## 📊 Latest Updates

### February 2026 - Events Module, TypeScript Quality & Backend Fixes
- Events module enhanced: recurring events, templates, duplication, attachments, booking prevention, RSVP overrides
- Dedicated EventCreatePage and EventEditPage with reusable EventForm component
- All TypeScript build errors resolved across entire frontend codebase
- 17 unsafe `as any` type assertions replaced with proper typing
- Backend quality fixes: dependency injection, duplicate models, missing permissions (29 files)
- Mutable default arguments fixed across 9 backend models
- Startup fixes: polling loop, type safety, API client signatures
- Comprehensive event test coverage (5 files, 1,865+ lines)
- Meeting Minutes and Documents module with 8 meeting types, template system, publish workflow
- Custom Forms module with public forms, QR codes, cross-module integrations
- Prospective Members pipeline with inactivity timeouts and election package integration
- Elections module with ranked-choice voting, audit logging, ballot forensics
- 16 system roles with unified role initialization
- Security hardening: session timeouts, DOMPurify sanitization, password requirements

### January 2026 - Package Updates
- ✅ Updated to Vite 6.0.5 (fixed from invalid 7.3.1)
- ✅ React 18.3.1 with security updates
- ✅ axios 1.7.9 security updates
- ✅ lucide-react 0.468.0 (was 150+ versions behind)
- ✅ TypeScript 5.7.3
- ✅ 25+ package updates total

### January 2026 - Unraid Automation
- ✅ One-command installation script
- ✅ Automatic container cleanup
- ✅ Auto-generated secure passwords
- ✅ Zero-configuration deployment

---

## 🤝 Contributing

We welcome contributions! Please see our **[Contributing Guide](Contributing)** for details.

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](https://github.com/thegspiro/the-logbook/blob/main/LICENSE) file for details.

---

## 🔗 Quick Links

- **[GitHub Repository](https://github.com/thegspiro/the-logbook)**
- **[Report an Issue](https://github.com/thegspiro/the-logbook/issues)**
- **[Request a Feature](https://github.com/thegspiro/the-logbook/issues/new)**
- **[Discussions](https://github.com/thegspiro/the-logbook/discussions)**

---

## 💬 Getting Help

1. **Check the [Troubleshooting Guide](Troubleshooting)** first
2. **Search [existing issues](https://github.com/thegspiro/the-logbook/issues)**
3. **Ask in [Discussions](https://github.com/thegspiro/the-logbook/discussions)**
4. **Create a [new issue](https://github.com/thegspiro/the-logbook/issues/new)** with details

---

**Ready to get started?** → **[Installation Guide](Installation)** or **[Unraid Quick Start](Unraid-Quick-Start)**
