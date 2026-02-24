# Technology Stack

Complete technology reference for The Logbook.

---

## Architecture Overview

```
┌─────────────┐     ┌─────────────┐     ┌──────────┐     ┌───────┐
│   Frontend   │────▶│   Backend   │────▶│  MySQL   │     │ Redis │
│  React/Vite  │     │  FastAPI    │     │  8.0+    │     │  7+   │
│  Port 3000   │     │  Port 3001  │     │  3306    │     │ 6379  │
└─────────────┘     └─────────────┘     └──────────┘     └───────┘
     Nginx              Python             Database        Cache
```

---

## Frontend

| Technology | Version | Purpose |
|-----------|---------|---------|
| **React** | 18.3 | UI framework |
| **TypeScript** | 5.9 | Type-safe JavaScript |
| **Vite** | 7.3 | Build tool and dev server |
| **Tailwind CSS** | 3.x | Utility-first CSS framework |
| **React Router** | 6.x | Client-side routing |
| **Vitest** | 3.2 | Unit/integration testing |
| **React Hot Toast** | — | Toast notifications |
| **Lucide React** | 0.575+ | Icon library |
| **DOMPurify** | — | XSS sanitization |
| **React Hook Form** | 7.71 | Form management |

### Frontend Capabilities
- Progressive Web App (PWA) with offline support and install prompt
- Responsive design (mobile-first)
- WCAG 2.1 Level AA accessibility
- Dark mode and high-contrast theme support
- Camera-based QR/barcode scanning
- Command Palette (Ctrl+K) for quick navigation
- Keyboard shortcuts for common actions
- Print-optimized CSS

---

## Backend

| Technology | Version | Purpose |
|-----------|---------|---------|
| **Python** | 3.13 | Runtime |
| **FastAPI** | Latest | Async web framework |
| **SQLAlchemy** | 2.x | Async ORM |
| **Alembic** | Latest | Database migrations |
| **Pydantic** | 2.x | Data validation and serialization |
| **Argon2-cffi** | 25.1 | Password hashing |
| **PyJWT** | — | JWT token management |
| **ReportLab** | 4.3 | PDF and label generation |
| **Pillow** | 11.3 | Image processing and optimization |
| **python-magic** | 0.4.27 | File type detection |
| **cryptography** | 44.0 | Cryptographic operations |
| **slowapi** | — | Application-level rate limiting |

### Backend Capabilities
- Fully async (asyncio + SQLAlchemy async)
- Auto-generated OpenAPI documentation
- Tamper-proof audit logging (SHA-256 hash chain)
- AES-256 data encryption at rest
- Application-level rate limiting (slowapi + Redis)
- CSRF protection (global middleware)
- httpOnly cookie-based authentication
- Multi-tenant data isolation with org-scoped queries
- Structured JSON logging option (LOG_FORMAT=json)

---

## Database

| Technology | Version | Purpose |
|-----------|---------|---------|
| **MySQL** | 8.0+ | Primary database (x86) |
| **MariaDB** | 10.11+ | Primary database (ARM/Raspberry Pi) |

### Database Features Used
- Row-level locking (`SELECT FOR UPDATE`)
- Org-scoped unique constraints
- JSON columns for flexible data
- Full-text search

---

## Cache & Session

| Technology | Version | Purpose |
|-----------|---------|---------|
| **Redis** | 7+ | Caching, session storage, rate limiting |

---

## Infrastructure

| Technology | Purpose |
|-----------|---------|
| **Docker** | Containerization |
| **Docker Compose** | Multi-container orchestration |
| **Nginx** | Reverse proxy (frontend container) |
| **GitHub Actions** | CI/CD pipeline |
| **GitHub Container Registry** | Docker image hosting |

---

## Security Stack

| Layer | Technology |
|-------|-----------|
| Password hashing | Argon2id |
| Data encryption | AES-256 |
| Transport encryption | TLS 1.3 |
| Audit integrity | SHA-256 hash chain |
| Authentication | JWT (access + refresh tokens) |
| MFA | TOTP (RFC 6238) |
| Input sanitization | DOMPurify (frontend), Pydantic (backend) |
| Rate limiting | Redis-backed sliding window |

---

## Deployment Platforms

| Platform | Status |
|----------|--------|
| **Unraid** | One-command installer, fully supported |
| **Docker Compose** | Primary deployment method |
| **AWS** | Documented (ECS, EC2) |
| **Azure** | Documented (Container Instances) |
| **Google Cloud** | Documented (Cloud Run) |
| **Raspberry Pi** | Supported (ARM images, MariaDB) |
| **Synology NAS** | Documented |
| **Proxmox** | Documented |

---

## Browser Support

| Browser | Minimum Version |
|---------|----------------|
| Chrome / Edge | Last 2 versions |
| Firefox | Last 2 versions |
| Safari | Last 2 versions |
| iOS Safari | Last 2 versions |
| Android Chrome | Last 2 versions |

---

**See also:** [Installation Guide](Installation) | [Backend Development](Development-Backend) | [Frontend Development](Development-Frontend)
