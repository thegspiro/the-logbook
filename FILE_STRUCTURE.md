# Project File Structure

```
the-logbook/
├── README.md                           # Main project documentation
├── LICENSE                             # MIT License
├── CONTRIBUTING.md                     # Contribution guidelines
├── CODE_OF_CONDUCT.md                  # Community guidelines
├── SECURITY.md                         # Security policy and reporting
├── .gitignore                          # Git ignore rules
├── .env.example                        # Environment variables template
├── docker-compose.yml                  # Docker Compose configuration
├── docker-compose.dev.yml              # Development environment
├── docker-compose.prod.yml             # Production environment
├── Makefile                            # Common commands and shortcuts
│
├── docs/                               # Documentation
│   ├── README.md                       # Documentation index
│   ├── installation/                   # Installation guides
│   │   ├── README.md
│   │   ├── docker.md
│   │   ├── kubernetes.md
│   │   ├── manual.md
│   │   └── cloud-providers/
│   │       ├── aws.md
│   │       ├── azure.md
│   │       └── gcp.md
│   ├── configuration/                  # Configuration guides
│   │   ├── README.md
│   │   ├── environment-variables.md
│   │   ├── database.md
│   │   ├── authentication.md
│   │   ├── integrations.md
│   │   └── modules.md
│   ├── modules/                        # Module documentation
│   │   ├── README.md
│   │   ├── training.md
│   │   ├── compliance.md
│   │   ├── scheduling.md
│   │   ├── inventory.md
│   │   └── [other modules].md
│   ├── api/                            # API documentation
│   │   ├── README.md
│   │   ├── authentication.md
│   │   ├── rest-api.md
│   │   ├── graphql.md
│   │   └── webhooks.md
│   ├── security/                       # Security documentation
│   │   ├── README.md
│   │   ├── hipaa-compliance.md
│   │   ├── audit-logging.md
│   │   ├── encryption.md
│   │   └── best-practices.md
│   ├── deployment/                     # Deployment guides
│   │   ├── README.md
│   │   ├── production-checklist.md
│   │   ├── scaling.md
│   │   ├── backup-recovery.md
│   │   └── monitoring.md
│   ├── development/                    # Developer guides
│   │   ├── README.md
│   │   ├── getting-started.md
│   │   ├── architecture.md
│   │   ├── coding-standards.md
│   │   ├── testing.md
│   │   └── creating-modules.md
│   └── user-guides/                    # End-user documentation
│       ├── README.md
│       ├── admin-guide.md
│       ├── user-guide.md
│       └── module-guides/
│
├── backend/                            # Backend application
│   ├── package.json                    # Node.js dependencies
│   ├── package-lock.json
│   ├── tsconfig.json                   # TypeScript configuration
│   ├── .eslintrc.js                    # ESLint configuration
│   ├── .prettierrc                     # Prettier configuration
│   ├── jest.config.js                  # Jest test configuration
│   ├── Dockerfile                      # Backend Docker image
│   ├── .dockerignore
│   │
│   ├── src/                            # Source code
│   │   ├── index.ts                    # Application entry point
│   │   ├── app.ts                      # Express app setup
│   │   ├── server.ts                   # Server initialization
│   │   │
│   │   ├── config/                     # Configuration
│   │   │   ├── index.ts
│   │   │   ├── database.ts
│   │   │   ├── redis.ts
│   │   │   ├── storage.ts
│   │   │   ├── email.ts
│   │   │   └── modules.ts
│   │   │
│   │   ├── core/                       # Core system functionality
│   │   │   ├── auth/                   # Authentication
│   │   │   │   ├── strategies/
│   │   │   │   │   ├── local.strategy.ts
│   │   │   │   │   ├── oauth.strategy.ts
│   │   │   │   │   ├── saml.strategy.ts
│   │   │   │   │   └── ldap.strategy.ts
│   │   │   │   ├── middleware/
│   │   │   │   │   ├── authenticate.ts
│   │   │   │   │   ├── authorize.ts
│   │   │   │   │   └── mfa.ts
│   │   │   │   ├── services/
│   │   │   │   │   ├── auth.service.ts
│   │   │   │   │   ├── token.service.ts
│   │   │   │   │   ├── password.service.ts
│   │   │   │   │   └── mfa.service.ts
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   ├── users/                  # User management
│   │   │   │   ├── models/
│   │   │   │   │   ├── user.model.ts
│   │   │   │   │   ├── role.model.ts
│   │   │   │   │   └── permission.model.ts
│   │   │   │   ├── services/
│   │   │   │   │   ├── user.service.ts
│   │   │   │   │   ├── role.service.ts
│   │   │   │   │   └── permission.service.ts
│   │   │   │   ├── controllers/
│   │   │   │   │   ├── user.controller.ts
│   │   │   │   │   └── role.controller.ts
│   │   │   │   ├── routes/
│   │   │   │   │   └── user.routes.ts
│   │   │   │   ├── validators/
│   │   │   │   │   └── user.validator.ts
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   ├── documents/              # Document management
│   │   │   │   ├── models/
│   │   │   │   ├── services/
│   │   │   │   ├── controllers/
│   │   │   │   └── routes/
│   │   │   │
│   │   │   ├── notifications/          # Notification system
│   │   │   │   ├── models/
│   │   │   │   ├── services/
│   │   │   │   │   ├── notification.service.ts
│   │   │   │   │   ├── email.service.ts
│   │   │   │   │   └── sms.service.ts
│   │   │   │   ├── controllers/
│   │   │   │   ├── templates/
│   │   │   │   └── routes/
│   │   │   │
│   │   │   ├── audit/                  # Audit logging system
│   │   │   │   ├── models/
│   │   │   │   │   ├── audit-log.model.ts
│   │   │   │   │   └── checkpoint.model.ts
│   │   │   │   ├── services/
│   │   │   │   │   ├── audit.service.ts
│   │   │   │   │   ├── integrity.service.ts
│   │   │   │   │   └── verification.service.ts
│   │   │   │   ├── middleware/
│   │   │   │   │   └── audit.middleware.ts
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   └── security/               # Security features
│   │   │       ├── encryption.ts
│   │   │       ├── rate-limiter.ts
│   │   │       ├── ip-filter.ts
│   │   │       ├── geo-filter.ts
│   │   │       └── dlp.ts
│   │   │
│   │   ├── modules/                    # Optional modules
│   │   │   ├── training/
│   │   │   │   ├── models/
│   │   │   │   │   ├── certification.model.ts
│   │   │   │   │   ├── training-session.model.ts
│   │   │   │   │   └── requirement.model.ts
│   │   │   │   ├── services/
│   │   │   │   │   ├── certification.service.ts
│   │   │   │   │   ├── training.service.ts
│   │   │   │   │   └── compliance.service.ts
│   │   │   │   ├── controllers/
│   │   │   │   │   └── training.controller.ts
│   │   │   │   ├── routes/
│   │   │   │   │   └── training.routes.ts
│   │   │   │   ├── config/
│   │   │   │   │   └── module.config.ts
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   ├── compliance/
│   │   │   │   ├── models/
│   │   │   │   ├── services/
│   │   │   │   ├── controllers/
│   │   │   │   ├── routes/
│   │   │   │   ├── config/
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   ├── scheduling/
│   │   │   │   ├── models/
│   │   │   │   │   ├── shift.model.ts
│   │   │   │   │   ├── schedule.model.ts
│   │   │   │   │   └── time-off.model.ts
│   │   │   │   ├── services/
│   │   │   │   │   ├── schedule.service.ts
│   │   │   │   │   ├── shift.service.ts
│   │   │   │   │   └── time-off.service.ts
│   │   │   │   ├── controllers/
│   │   │   │   ├── routes/
│   │   │   │   ├── config/
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   ├── inventory/
│   │   │   │   ├── models/
│   │   │   │   ├── services/
│   │   │   │   ├── controllers/
│   │   │   │   ├── routes/
│   │   │   │   ├── config/
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   ├── meetings/
│   │   │   │   ├── models/
│   │   │   │   ├── services/
│   │   │   │   ├── controllers/
│   │   │   │   ├── routes/
│   │   │   │   ├── config/
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   ├── elections/
│   │   │   │   ├── models/
│   │   │   │   ├── services/
│   │   │   │   │   ├── election.service.ts
│   │   │   │   │   ├── ballot.service.ts
│   │   │   │   │   └── voting.service.ts
│   │   │   │   ├── controllers/
│   │   │   │   ├── routes/
│   │   │   │   ├── config/
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   ├── fundraising/
│   │   │   │   ├── models/
│   │   │   │   ├── services/
│   │   │   │   ├── controllers/
│   │   │   │   ├── routes/
│   │   │   │   ├── config/
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   └── incidents/
│   │   │       ├── models/
│   │   │       ├── services/
│   │   │       ├── controllers/
│   │   │       ├── routes/
│   │   │       ├── config/
│   │   │       └── index.ts
│   │   │
│   │   ├── integrations/               # External integrations
│   │   │   ├── microsoft365/
│   │   │   │   ├── auth.ts
│   │   │   │   ├── email.ts
│   │   │   │   ├── calendar.ts
│   │   │   │   └── storage.ts
│   │   │   ├── google/
│   │   │   │   ├── auth.ts
│   │   │   │   ├── gmail.ts
│   │   │   │   ├── calendar.ts
│   │   │   │   └── drive.ts
│   │   │   ├── ldap/
│   │   │   │   └── connector.ts
│   │   │   ├── stripe/
│   │   │   │   └── payments.ts
│   │   │   ├── twilio/
│   │   │   │   └── sms.ts
│   │   │   └── storage/
│   │   │       ├── s3.ts
│   │   │       ├── azure-blob.ts
│   │   │       ├── gcs.ts
│   │   │       └── local.ts
│   │   │
│   │   ├── common/                     # Shared utilities
│   │   │   ├── middleware/
│   │   │   │   ├── error-handler.ts
│   │   │   │   ├── validator.ts
│   │   │   │   ├── sanitizer.ts
│   │   │   │   └── request-logger.ts
│   │   │   ├── utils/
│   │   │   │   ├── crypto.ts
│   │   │   │   ├── date.ts
│   │   │   │   ├── string.ts
│   │   │   │   └── validation.ts
│   │   │   ├── types/
│   │   │   │   ├── index.ts
│   │   │   │   ├── request.ts
│   │   │   │   └── response.ts
│   │   │   ├── constants/
│   │   │   │   ├── index.ts
│   │   │   │   ├── errors.ts
│   │   │   │   └── permissions.ts
│   │   │   └── decorators/
│   │   │       ├── cache.ts
│   │   │       └── audit.ts
│   │   │
│   │   └── database/                   # Database layer
│   │       ├── index.ts
│   │       ├── connection.ts
│   │       ├── base-repository.ts
│   │       ├── migrations/             # Database migrations
│   │       │   ├── 001_initial_schema.ts
│   │       │   ├── 002_add_audit_logs.ts
│   │       │   ├── 003_add_training_module.ts
│   │       │   └── [timestamp]_[description].ts
│   │       ├── seeds/                  # Seed data
│   │       │   ├── development/
│   │       │   │   ├── 001_users.ts
│   │       │   │   └── 002_roles.ts
│   │       │   └── production/
│   │       │       └── 001_default_admin.ts
│   │       └── models/
│   │           └── index.ts
│   │
│   └── tests/                          # Backend tests
│       ├── unit/
│       │   ├── auth/
│       │   ├── users/
│       │   └── modules/
│       ├── integration/
│       │   ├── api/
│       │   └── database/
│       ├── e2e/
│       │   └── scenarios/
│       ├── fixtures/
│       │   └── data/
│       └── helpers/
│           └── test-utils.ts
│
├── frontend/                           # Frontend application
│   ├── package.json
│   ├── package-lock.json
│   ├── tsconfig.json
│   ├── vite.config.ts                  # Vite configuration
│   ├── tailwind.config.js              # Tailwind CSS config
│   ├── postcss.config.js
│   ├── .eslintrc.js
│   ├── .prettierrc
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── index.html
│   │
│   ├── public/                         # Static assets
│   │   ├── favicon.ico
│   │   ├── logo.svg
│   │   ├── manifest.json               # PWA manifest
│   │   └── robots.txt
│   │
│   ├── src/
│   │   ├── main.tsx                    # Application entry
│   │   ├── App.tsx                     # Root component
│   │   ├── routes.tsx                  # Route definitions
│   │   │
│   │   ├── core/                       # Core components
│   │   │   ├── auth/
│   │   │   │   ├── LoginPage.tsx
│   │   │   │   ├── RegisterPage.tsx
│   │   │   │   ├── MFASetup.tsx
│   │   │   │   └── PasswordReset.tsx
│   │   │   ├── layout/
│   │   │   │   ├── MainLayout.tsx
│   │   │   │   ├── Header.tsx
│   │   │   │   ├── Sidebar.tsx
│   │   │   │   └── Footer.tsx
│   │   │   ├── dashboard/
│   │   │   │   ├── Dashboard.tsx
│   │   │   │   └── widgets/
│   │   │   ├── users/
│   │   │   │   ├── UserList.tsx
│   │   │   │   ├── UserProfile.tsx
│   │   │   │   └── UserForm.tsx
│   │   │   ├── documents/
│   │   │   │   ├── DocumentBrowser.tsx
│   │   │   │   ├── DocumentViewer.tsx
│   │   │   │   └── DocumentUpload.tsx
│   │   │   └── settings/
│   │   │       ├── GeneralSettings.tsx
│   │   │       ├── SecuritySettings.tsx
│   │   │       └── IntegrationSettings.tsx
│   │   │
│   │   ├── modules/                    # Module components
│   │   │   ├── training/
│   │   │   │   ├── TrainingDashboard.tsx
│   │   │   │   ├── CertificationList.tsx
│   │   │   │   ├── TrainingSchedule.tsx
│   │   │   │   └── components/
│   │   │   ├── compliance/
│   │   │   │   ├── ComplianceDashboard.tsx
│   │   │   │   ├── TaskList.tsx
│   │   │   │   └── components/
│   │   │   ├── scheduling/
│   │   │   │   ├── ShiftCalendar.tsx
│   │   │   │   ├── TimeOffRequest.tsx
│   │   │   │   ├── ShiftSwap.tsx
│   │   │   │   └── components/
│   │   │   ├── inventory/
│   │   │   │   ├── InventoryDashboard.tsx
│   │   │   │   ├── ItemList.tsx
│   │   │   │   ├── CheckOut.tsx
│   │   │   │   └── components/
│   │   │   ├── meetings/
│   │   │   │   ├── MeetingList.tsx
│   │   │   │   ├── MeetingDetail.tsx
│   │   │   │   ├── LiveMinutes.tsx
│   │   │   │   └── components/
│   │   │   └── elections/
│   │   │       ├── ElectionList.tsx
│   │   │       ├── VotingBooth.tsx
│   │   │       ├── Results.tsx
│   │   │       └── components/
│   │   │
│   │   ├── components/                 # Shared components
│   │   │   ├── ui/                     # UI components
│   │   │   │   ├── Button.tsx
│   │   │   │   ├── Input.tsx
│   │   │   │   ├── Select.tsx
│   │   │   │   ├── Modal.tsx
│   │   │   │   ├── Table.tsx
│   │   │   │   ├── Card.tsx
│   │   │   │   ├── Badge.tsx
│   │   │   │   ├── Alert.tsx
│   │   │   │   └── Loading.tsx
│   │   │   ├── forms/
│   │   │   │   ├── FormField.tsx
│   │   │   │   ├── FormError.tsx
│   │   │   │   └── FormSubmit.tsx
│   │   │   ├── data/
│   │   │   │   ├── DataTable.tsx
│   │   │   │   ├── Pagination.tsx
│   │   │   │   └── Filter.tsx
│   │   │   └── feedback/
│   │   │       ├── Toast.tsx
│   │   │       └── ErrorBoundary.tsx
│   │   │
│   │   ├── hooks/                      # Custom React hooks
│   │   │   ├── useAuth.ts
│   │   │   ├── useApi.ts
│   │   │   ├── useForm.ts
│   │   │   ├── useDebounce.ts
│   │   │   └── useLocalStorage.ts
│   │   │
│   │   ├── services/                   # API services
│   │   │   ├── api.ts                  # Base API client
│   │   │   ├── auth.service.ts
│   │   │   ├── user.service.ts
│   │   │   ├── document.service.ts
│   │   │   └── modules/
│   │   │       ├── training.service.ts
│   │   │       ├── compliance.service.ts
│   │   │       └── scheduling.service.ts
│   │   │
│   │   ├── store/                      # State management
│   │   │   ├── index.ts
│   │   │   ├── auth.store.ts
│   │   │   ├── user.store.ts
│   │   │   ├── config.store.ts
│   │   │   └── modules/
│   │   │       └── [module].store.ts
│   │   │
│   │   ├── utils/                      # Utility functions
│   │   │   ├── date.ts
│   │   │   ├── format.ts
│   │   │   ├── validation.ts
│   │   │   └── constants.ts
│   │   │
│   │   ├── types/                      # TypeScript types
│   │   │   ├── index.ts
│   │   │   ├── user.types.ts
│   │   │   ├── auth.types.ts
│   │   │   └── module.types.ts
│   │   │
│   │   └── styles/                     # Global styles
│   │       ├── index.css
│   │       ├── variables.css
│   │       └── themes/
│   │           ├── default.css
│   │           └── dark.css
│   │
│   └── tests/                          # Frontend tests
│       ├── unit/
│       │   ├── components/
│       │   └── hooks/
│       ├── integration/
│       │   └── pages/
│       └── e2e/
│           └── scenarios/
│
├── mobile/                             # Mobile app (React Native - optional)
│   ├── package.json
│   ├── app.json
│   ├── babel.config.js
│   ├── metro.config.js
│   ├── tsconfig.json
│   ├── android/
│   ├── ios/
│   └── src/
│       ├── App.tsx
│       ├── screens/
│       ├── components/
│       ├── navigation/
│       └── services/
│
├── infrastructure/                     # Infrastructure as Code
│   ├── docker/
│   │   ├── backend.Dockerfile
│   │   ├── frontend.Dockerfile
│   │   ├── nginx.Dockerfile
│   │   └── nginx.conf
│   │
│   ├── kubernetes/                     # Kubernetes manifests
│   │   ├── namespace.yaml
│   │   ├── configmap.yaml
│   │   ├── secrets.yaml
│   │   ├── backend/
│   │   │   ├── deployment.yaml
│   │   │   ├── service.yaml
│   │   │   └── hpa.yaml
│   │   ├── frontend/
│   │   │   ├── deployment.yaml
│   │   │   ├── service.yaml
│   │   │   └── ingress.yaml
│   │   ├── database/
│   │   │   ├── statefulset.yaml
│   │   │   ├── service.yaml
│   │   │   └── pvc.yaml
│   │   └── redis/
│   │       ├── deployment.yaml
│   │       └── service.yaml
│   │
│   ├── terraform/                      # Terraform configurations
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   ├── outputs.tf
│   │   ├── providers/
│   │   │   ├── aws/
│   │   │   ├── azure/
│   │   │   └── gcp/
│   │   └── modules/
│   │       ├── network/
│   │       ├── database/
│   │       └── storage/
│   │
│   └── ansible/                        # Ansible playbooks
│       ├── playbook.yml
│       ├── inventory/
│       └── roles/
│
├── scripts/                            # Utility scripts
│   ├── setup/
│   │   ├── init-db.sh
│   │   ├── install-deps.sh
│   │   └── generate-keys.sh
│   ├── deployment/
│   │   ├── deploy.sh
│   │   ├── rollback.sh
│   │   └── backup.sh
│   ├── maintenance/
│   │   ├── cleanup-logs.sh
│   │   ├── verify-integrity.sh
│   │   └── health-check.sh
│   └── development/
│       ├── seed-data.sh
│       └── reset-db.sh
│
├── database/                           # Database scripts
│   ├── schemas/
│   │   ├── core.sql
│   │   └── modules/
│   │       ├── training.sql
│   │       ├── compliance.sql
│   │       └── scheduling.sql
│   ├── migrations/                     # SQL migrations
│   │   └── [linked to backend/src/database/migrations]
│   └── backups/
│       └── .gitkeep
│
├── config/                             # Configuration files
│   ├── default.json                    # Default configuration
│   ├── development.json                # Dev environment
│   ├── staging.json                    # Staging environment
│   ├── production.json                 # Production environment
│   └── test.json                       # Test environment
│
├── tools/                              # Development tools
│   ├── module-generator/               # CLI tool to generate modules
│   │   ├── templates/
│   │   └── generate.js
│   ├── config-validator/               # Validate configuration
│   │   └── validate.js
│   └── audit-reporter/                 # Generate audit reports
│       └── report.js
│
├── .github/                            # GitHub specific files
│   ├── workflows/                      # GitHub Actions
│   │   ├── ci.yml
│   │   ├── cd.yml
│   │   ├── security-scan.yml
│   │   └── tests.yml
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md
│   │   ├── feature_request.md
│   │   └── module_request.md
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── dependabot.yml
│
├── .vscode/                            # VS Code settings
│   ├── settings.json
│   ├── extensions.json
│   └── launch.json
│
└── monitoring/                         # Monitoring & observability
    ├── prometheus/
    │   └── prometheus.yml
    ├── grafana/
    │   └── dashboards/
    └── alerts/
        └── rules.yml
```

## Key Directories Explained

### `/backend`
Backend Python/FastAPI API server with modular architecture. Each module is self-contained with its own models, services, and API endpoints. Uses SQLAlchemy 2.0 (async) for ORM and Pydantic for data validation.

### `/frontend`
React frontend application with TypeScript and Tailwind CSS. Component-based architecture with clear separation of concerns.

### `/docs`
Documentation including deployment guides, training programs, and Docker build instructions.

### `/infrastructure`
Infrastructure as Code (IaC) for Docker, Kubernetes, Terraform, and Ansible deployments.

### `/backend/app/models`
SQLAlchemy database models for all features. Each module has its own model files (e.g., training.py, election.py, event.py).

### `/backend/alembic`
Database migrations using Alembic. Uses MySQL 8.0+ with proper migration management.

### `/scripts`
Utility scripts for setup, deployment, maintenance, and development tasks.

### `/tests`
Comprehensive test suites for unit, integration, and end-to-end testing.

## Backend Module Structure (Python/FastAPI)

The backend uses Python with FastAPI. Here's the actual structure:

```
backend/
├── app/
│   ├── models/              # SQLAlchemy ORM models
│   │   ├── training.py      # Training module models
│   │   ├── election.py      # Election models
│   │   ├── event.py         # Event models
│   │   └── ...
│   ├── schemas/             # Pydantic request/response schemas
│   │   ├── training.py
│   │   ├── training_program.py
│   │   └── ...
│   ├── services/            # Business logic layer
│   │   ├── training_program_service.py
│   │   ├── training_session_service.py
│   │   └── ...
│   ├── api/v1/endpoints/    # API route handlers
│   │   ├── training.py
│   │   ├── training_programs.py
│   │   ├── training_sessions.py
│   │   ├── elections.py
│   │   ├── events.py
│   │   └── ...
│   ├── core/                # Core functionality (config, database, security)
│   └── data/registries/     # Registry seed data (NFPA, NREMT, Pro Board)
└── alembic/                 # Database migrations
    └── versions/            # Migration files
```

**Key Technologies:**
- **FastAPI** - Modern, fast web framework
- **SQLAlchemy 2.0** - Async ORM
- **Pydantic** - Data validation
- **Alembic** - Database migrations
- **MySQL 8.0+** - Database
- **Redis 7+** - Caching and sessions

This ensures consistency and makes modules easy to understand, maintain, and extend.
