# 🚒 Fire Department Intranet Platform

## 🌟 Project Overview

An open-source, self-hosted intranet built with **Django 4.2+** designed specifically for volunteer fire departments. This platform manages:

- **Shift Scheduling** - Bid board system with qualification checking
- **Training Management** - Certification tracking, evaluations, and Target Solutions API integration
- **Gear/Asset Management** - PPE tracking with NFPA 10-year retirement alerts
- **Compliance** - Health, safety, and standards tracking
- **Document Management** - SOGs, SOPs, and policy documents
- **Historical Archives** - Shift logs and legacy data

### Key Features

✅ **Open Source & Self-Hosted** - No vendor lock-in, deploy anywhere  
✅ **API-First Architecture** - Easy integration with external systems  
✅ **Mobile Responsive** - Optimized for desktop, tablet, and phone  
✅ **Role-Based Security** - Granular permissions with object-level access control  
✅ **Background Task Queue** - Async operations for notifications and sync  
✅ **Flexible Integration** - Connects to Google Calendar, Microsoft 365, Target Solutions, and NocoDB

---

## 📋 Prerequisites

- **Python 3.9+**
- **PostgreSQL 12+** (recommended) or SQLite for development
- **Redis** (for background tasks via Django-Q2)
- **pip** (Python package installer)

---

## 🚀 Quick Start Installation

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/fd-intranet.git
cd fd-intranet
```

### 2. Create Virtual Environment

```bash
python -m venv venv

# Activate virtual environment
# Linux/macOS:
source venv/bin/activate
# Windows:
.\venv\Scripts\activate
```

### 3. Install Dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure Environment Variables

Copy the example environment file and configure it:

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```bash
# REQUIRED
SECRET_KEY='your-very-long-random-django-secret-key'
DEBUG=True
ALLOWED_HOSTS='127.0.0.1,localhost'

# DATABASE (PostgreSQL recommended for production)
DATABASE_URL=postgresql://user:password@localhost:5432/fd_intranet
# For development, you can use:
# DATABASE_URL=sqlite:///db.sqlite3

# EMAIL (Required for notifications and 2FA)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USE_TLS=True
EMAIL_HOST_USER=your.dept.email@gmail.com
EMAIL_HOST_PASSWORD=your_app_password_here

# OPTIONAL INTEGRATIONS
TARGET_SOLUTIONS_API_KEY=
NOCODB_API_TOKEN=
GOOGLE_CLIENT_ID=
MS_CLIENT_ID=
```

**🔒 Security Note:** Never commit the `.env` file to version control!

### 5. Run Database Migrations

```bash
python manage.py makemigrations
python manage.py migrate
```

### 6. Run Initial Setup Script

```bash
python setup_system.py
```

This will:
- Create user groups (Chief Officers, Line Officers, Training Officers, etc.)
- Prompt you to create a superuser account
- Set up default permissions

### 7. Load Initial Data (Optional)

```bash
# Create some sample positions for shift scheduling
python manage.py shell
>>> from scheduling.models import Position
>>> Position.objects.create(name="Captain", code="CAPT")
>>> Position.objects.create(name="Driver/Operator", code="DRVR")
>>> Position.objects.create(name="Firefighter", code="FF")
>>> exit()
```

### 8. Start Development Server

```bash
python manage.py runserver
```

Visit: **http://localhost:8000**

---

## 🏗️ Project Structure

```
fd-intranet/
├── core/                       # Project settings & routing
│   ├── settings.py
│   ├── urls.py
│   ├── wsgi.py
│   └── notifications.py        # Global notification system
│
├── accounts/                   # User profiles & certifications
│   ├── models.py               # UserProfile, CertificationStandard, MemberCertification
│   └── views.py
│
├── scheduling/                 # Shift management & bid board
│   ├── models.py               # Shift, ShiftSlot, Position, ShiftTemplate
│   ├── forms.py
│   ├── views.py
│   ├── utils.py                # Qualification & overlap checking
│   └── templates/
│
├── training/                   # Training matrix & evaluations
│   ├── models.py               # TrainingRequirement, TrainingRecord, PracticalEvaluation
│   ├── services.py             # Target Solutions API integration
│   └── views.py
│
├── quartermaster/              # Gear & asset management
│   ├── models.py               # GearItem, GearInspection, GearAssignment
│   ├── services.py             # NFPA retirement alerts
│   └── views.py
│
├── compliance/                 # Health, safety & standards
│   ├── models.py               # MedicalPhysical, FitTest, OSHA_Log
│   ├── alerts.py
│   └── views.py
│
├── archives/                   # Historical records
│   ├── models.py
│   └── views.py
│
├── documents/                  # SOGs, SOPs & digital forms
│   ├── models.py
│   ├── storage.py              # AWS S3 connector
│   └── views.py
│
├── integrations/               # External API connectors
│   ├── target_solutions.py
│   ├── google_calendar.py
│   ├── ms_graph.py
│   └── nocodb_client.py
│
├── templates/                  # Global templates
│   ├── base.html
│   └── setup_wizard.html
│
├── static/                     # CSS, JS, images
├── media/                      # Uploaded files
├── requirements.txt
├── setup_system.py
├── manage.py
└── .env                        # Environment secrets (DO NOT COMMIT)
```

---

## 👥 User Roles & Permissions

The system includes pre-configured role groups:

| Role | Permissions |
|------|------------|
| **Chief Officers** | Full administrative access, approve all operations |
| **Line Officers** | Manage shifts for their apparatus, sign off on training |
| **Training Officers** | Manage training requirements, conduct evaluations, sync Target Solutions |
| **Compliance Officers** | View all compliance records, manage medical/physical records |
| **Quartermaster** | Manage gear inventory, conduct inspections, process requests |
| **Active Members** | Bid on shifts, view training requirements, request gear |
| **Probationary Members** | View-only access to most features |

---

## 🔌 API Integrations

### Target Solutions / Vector Solutions

Sync training records automatically:

1. Obtain API key from Target Solutions
2. Add to `.env`: `TARGET_SOLUTIONS_API_KEY=your_key`
3. Map courses to training requirements using `target_solutions_id` field
4. Run sync: `python manage.py sync_training_records`

### Google Calendar

Sync shifts to Google Calendar:

1. Create OAuth credentials in Google Cloud Console
2. Add credentials to `.env`
3. Configure in admin interface

### Microsoft 365

Similar to Google Calendar integration for Outlook users.

### NocoDB

Mirror administrative data to NocoDB for advanced reporting:

1. Set up NocoDB instance
2. Configure API token in `.env`
3. Enable sync in admin settings

---

## 🔒 Security Best Practices

### Production Deployment Checklist

- [ ] Set `DEBUG=False` in production
- [ ] Use PostgreSQL (not SQLite) for production database
- [ ] Enable HTTPS with valid SSL certificate
- [ ] Set strong `SECRET_KEY` (generate with `python -c 'from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())'`)
- [ ] Configure proper `ALLOWED_HOSTS`
- [ ] Enable security middleware settings:
  ```python
  SECURE_SSL_REDIRECT=True
  SESSION_COOKIE_SECURE=True
  CSRF_COOKIE_SECURE=True
  SECURE_HSTS_SECONDS=31536000
  ```
- [ ] Set up regular database backups
- [ ] Configure Redis with authentication
- [ ] Use environment variables for all secrets
- [ ] Set up fail2ban or similar for brute-force protection
- [ ] Enable Django's two-factor authentication for admin accounts

### Object-Level Permissions

Sensitive personnel records use `django-guardian` for object-level access control:

```python
from guardian.shortcuts import assign_perm

# Grant specific user permission to view a record
assign_perm('view_personnelrecord', user, record_obj)
```

---

## 📊 Background Tasks

The system uses Django-Q2 for background task processing:

### Start the Task Queue Worker

```bash
python manage.py qcluster
```

### Scheduled Tasks

Configure these in the admin interface under "Django Q > Scheduled tasks":

- **Training Expiration Alerts** - Daily at 0700
- **Gear Inspection Reminders** - Weekly on Mondays
- **NFPA Retirement Warnings** - Monthly
- **Target Solutions Sync** - Daily at 0200

---

## 📱 Mobile App Integration

The platform is API-ready for future native mobile apps:

### REST API Endpoints

```
/api/scheduling/shifts/          - List upcoming shifts
/api/scheduling/signup/          - Sign up for shift slot
/api/training/requirements/      - Training requirements
/api/quartermaster/gear/         - Gear inventory
/api/compliance/status/          - Compliance status
```

API authentication uses token-based auth (DRF).

---

## 🧪 Testing

Run tests:

```bash
python manage.py test
```

Generate test data:

```bash
python manage.py shell
>>> from faker import Faker
>>> # Create test users, shifts, etc.
```

---

## 📈 Monitoring & Logging

### Logging Configuration

Logs are written to:
- Console (development)
- File: `logs/fd_intranet.log` (production)

Configure logging levels in `settings.py`:

```python
LOGGING = {
    'version': 1,
    'handlers': {
        'file': {
            'level': 'INFO',
            'class': 'logging.FileHandler',
            'filename': 'logs/fd_intranet.log',
        },
    },
    'loggers': {
        'django': {
            'handlers': ['file'],
            'level': 'INFO',
        },
    },
}
```

---

## 🤝 Contributing

We welcome contributions! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🆘 Support & Documentation

- **Issues**: https://github.com/yourusername/fd-intranet/issues
- **Wiki**: https://github.com/yourusername/fd-intranet/wiki
- **Email**: support@yourfiredept.org

---

## 🙏 Acknowledgments

Built with:
- Django 4.2
- Bootstrap 5
- Django-Q2
- django-guardian
- And many other open-source libraries

---

## 📝 Changelog

### Version 1.0.0 (2025-01-07)
- Initial release
- Core scheduling, training, quartermaster, and compliance modules
- API integrations for Target Solutions, Google, Microsoft
- Mobile-responsive UI
- Background task processing
- Object-level permissions for sensitive data
