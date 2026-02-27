# Welcome to The Logbook Wiki

![The Logbook](https://img.shields.io/badge/Version-1.0.0-blue.svg)
![License](https://img.shields.io/badge/License-MIT-green.svg)
![Python](https://img.shields.io/badge/Python-3.13-blue.svg)
![React](https://img.shields.io/badge/React-18.3-blue.svg)

An open-source, highly flexible, secure, and modular intranet platform designed for fire departments, emergency services, healthcare organizations, and other institutions requiring secure internal communication and management systems. Built with HIPAA requirements in mind.

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
- **[Scheduling](Module-Scheduling)** - Shift scheduling, signup, swaps, templates & reports
- **[Admin Hours](Module-Admin-Hours)** - Administrative hours tracking with QR code clock-in/clock-out
- **[Apparatus](Module-Apparatus)** - Vehicle management (full module or lightweight basic)
- **[Inventory](Module-Inventory)** - Equipment tracking, assignments, pool items, thermal labels
- **[Compliance](Module-Compliance)** - Compliance tracking

### 🔐 Security
- **[Security Overview](Security-Overview)** - Security policy and compliance
- **[Authentication](Security-Authentication)** - OAuth, SAML, LDAP, MFA
- **[Encryption](Security-Encryption)** - AES-256 encryption
- **[Audit Logging](Security-Audit-Logging)** - Tamper-proof audit trails
- **[HIPAA Security Features](Security-HIPAA)** - Security features aligned with HIPAA requirements

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
- ✅ **HIPAA-Oriented Security** - Built with healthcare privacy and security standards in mind
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
| **Frontend** | React 18.3, TypeScript 5.9, Vite 7.3 |
| **Database** | MySQL 8.0+ (MariaDB 10.11+ for ARM) |
| **Cache** | Redis 7+ |
| **Authentication** | OAuth 2.0, SAML, LDAP, TOTP MFA |
| **Encryption** | AES-256, Argon2id |
| **Container** | Docker, Docker Compose |

---

## 📊 Latest Updates

### February 2026 (Feb 27) - Admin Hours, Elections Enhancements, Scheduling Hardening & Code Quality

- **Admin Hours Logging Module**: New module for tracking administrative work hours via QR code scanning or manual entry, with configurable approval workflows, category management, and summary dashboards
- **Member categories for training requirements**: Requirements can now target specific membership types (Active, Administrative, Probationary, Life, Retired, Honorary); permanent delete replaces soft-delete
- **Elections enhancements**: Meeting link support, voter override management, proxy voting authorization, fix for ballot-item-only elections
- **Organization settings expansion**: Email, file storage, and authentication settings now editable post-onboarding in Administration > Organization Settings
- **Scheduling production hardening**: Shift conflict detection, officer assignment, understaffing badges, template colors on calendar, weekday convention fix for patterns, route ordering fix, comprehensive data enrichment
- **Centralized backend logging**: Loguru + Sentry integration with request correlation IDs, duration tracking, and structured JSON output
- **QR code improvements**: Fixed display on Locations & Rooms, clipboard copy fallback, "Analytics" relabeled to "QR Code Analytics"
- **Code quality**: 565 floating promise ESLint warnings fixed, 94 axios calls typed, non-null assertions replaced, 0 ESLint errors/warnings across entire frontend
- **Security fixes**: CSRF tokens added to module API clients, permission gates on apparatus/forms routes, token refresh race condition fix, memory leak fix in PWA install hook

### February 2026 (Feb 23) - Training Compliance, Waiver Management & Membership Enhancements
- **LOA–Training Waiver auto-linking**: Leaves of absence automatically create linked training waivers; date changes sync; deactivation cascades; opt-out with `exempt_from_training_waiver`
- **Waiver Management Page** (`/members/admin/waivers`): Unified page for managing training, meeting, and shift waivers with Active/Create/History tabs
- **Training Waivers officer tab**: New tab in Training Admin Dashboard with summary cards, status filtering, and source tracking
- **Compliance summary card**: Member profiles show green/yellow/red compliance indicator
- **Bulk training record creation**: Up to 500 records per request with duplicate detection
- **Certification expiration alerts**: Tiered in-app + email notifications at 90/60/30/7 days with expired cert escalation
- **Rank & station snapshot**: Training records capture `rank_at_completion` and `station_at_completion`
- **Member Admin Edit, audit history, delete modal, photo upload**: Full admin member management
- **Rank validation**: Surfaces active members with unrecognized ranks
- **Compliance calculations document**: `docs/training-compliance-calculations.md`
- **15-minute time increments**: All date/time pickers enforce 15-minute steps

### February 2026 (Week of Feb 22) - Inventory Overhaul, Event Reminders & Security Hardening
- **Inventory module overhaul**: Pool/quantity-tracked items, item issuances, batch checkout/return, departure clearance lifecycle, notification netting, thermal label printing (Dymo/Rollo), barcode label generation
- **Inventory security hardening**: Row-level locking on all mutation operations, IDOR fix on clearance line items, org-scoped unique constraints, LIKE injection prevention, kwargs whitelist
- **Event reminders**: Configurable reminder schedules, multiple reminders per event, post-event/shift validation notifications
- **Notification enhancements**: Time-of-day preferences, notification expiry, in-app notification inbox
- **UI improvements**: Past events hidden by default (Past Events tab for managers), attendee management on event detail, dark mode modal fixes
- **Training Admin reorganization**: 3 sub-pages with inner tabs for better navigation
- **Badge consolidation**: `badge_number` merged into `membership_number` with migration
- **Training waivers**: Consistent adjustment formula across all compliance views
- **DateTime consistency**: All deprecated `datetime.utcnow()` replaced across backend
- **40 new inventory tests**, CI pipeline with GitHub Actions

### February 2026 (Earlier) - Scheduling Module, Events Module, TypeScript Quality & Backend Fixes
- **Scheduling Module enhanced**: 6-tab hub (Schedule, My Shifts, Open Shifts, Requests, Templates, Reports)
- Member self-service shift signup with position selection (officer, driver, firefighter, EMS, etc.)
- My Shifts tab with confirm/decline assignments, swap requests, and time-off requests
- Open Shifts tab for browsing and signing up for upcoming shifts
- Requests management with combined swap and time-off views, admin approve/deny workflow
- Shift detail slide-out panel showing crew roster, open positions, and calls/incidents
- Apparatus connection: shifts can now be linked to vehicles from the apparatus dropdown
- Lightweight Apparatus Basic page for departments without the full Apparatus module (mirrors Locations vs Facilities pattern)
- Basic Apparatus CRUD with crew positions per vehicle type (engine, ladder, rescue, ambulance, etc.)
- New backend endpoints: shift signup/withdraw, open shifts, basic apparatus CRUD
- New database migration for `basic_apparatus` table
- Side navigation updated with apparatus module toggle (full vs lightweight)
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
