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

- Training & Certification Tracking
- Compliance Management
- Scheduling & Shift Management
- Inventory Management
- Member Directory & Tracking
- Meeting Management
- Elections & Voting
- Incident Reporting
- Equipment Maintenance
- Fundraising & Donations
- Vehicle/Apparatus Management
- Budget & Finance Tracking
- Event Management

## 🚀 Quick Start

```bash
# Clone the repository
git clone https://github.com/thegspiro/the-logbook.git
cd the-logbook

# Copy environment configuration
cp .env.example .env

# IMPORTANT: Edit .env and set strong passwords and secret keys
# Generate secure keys with:
python -c "import secrets; print(secrets.token_urlsafe(64))"

# Start with Docker Compose (includes MySQL, Redis, Backend, Frontend)
docker-compose up -d

# View logs
docker-compose logs -f backend

# Access the platform
# - Frontend: http://localhost:3000
# - Backend API: http://localhost:3001
# - API Docs: http://localhost:3001/docs
```

### First Time Setup

After starting the containers:

1. Access the API documentation at http://localhost:3001/docs
2. The system will automatically create database tables on first run
3. Create your first organization and admin user via the API
4. Configure security settings and modules
5. Set up email/SMS notifications (optional)

See [QUICK_START_GITHUB.md](QUICK_START_GITHUB.md) for detailed instructions.

## 📚 Documentation

- [Installation Guide](docs/installation/README.md)
- [Configuration Guide](docs/configuration/README.md)
- [Module Documentation](docs/modules/README.md)
- [API Documentation](docs/api/README.md)
- [Security Guide](docs/security/README.md)
- [Deployment Guide](docs/deployment/README.md)

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
