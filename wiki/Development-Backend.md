# Python Backend Documentation

> **Canonical source.** This page is the maintained backend development guide.
> [`docs/backend/python-backend.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/backend/python-backend.md)
> is a pointer to it, so there is one copy to keep current.

## Overview

The backend uses **Python 3.13+ with FastAPI** - a modern, high-performance framework with excellent type safety and automatic API documentation.

---

## Technology Stack

| Component           | Technology                          |
| ------------------- | ----------------------------------- |
| **Runtime**         | Python 3.13+                        |
| **Framework**       | FastAPI                             |
| **ORM**             | SQLAlchemy 2.1 (async)              |
| **Migrations**      | Alembic                             |
| **Validation**      | Pydantic                            |
| **Server**          | Uvicorn (ASGI)                      |
| **Database**        | MySQL 8.0+ (MariaDB 10.11+ for ARM) |
| **Cache**           | Redis 7+                            |
| **Package Manager** | pip                                 |

---

## Directory Structure

The top two levels, plus the files you will reach for most often:

```
backend/
├── main.py                     # FastAPI app: startup migrations, middleware, /health
├── app/
│   ├── api/
│   │   ├── dependencies.py     # get_current_user, require_permission, ...
│   │   ├── public/             # Unauthenticated endpoints (portal, webhooks, ...)
│   │   └── v1/
│   │       ├── api.py          # APIRouter combining all endpoints
│   │       └── endpoints/      # One file per resource
│   ├── core/
│   │   ├── config.py           # Pydantic Settings configuration
│   │   ├── database.py         # Base, engine, get_db dependency
│   │   ├── audit.py            # Tamper-evident audit log (log_event, log_audit_event)
│   │   ├── security.py         # Passwords, tokens
│   │   ├── security_middleware.py
│   │   ├── permissions.py      # Permission registry
│   │   ├── cache.py            # Redis client
│   │   └── utils.py            # generate_uuid, safe_error_detail
│   ├── models/                 # SQLAlchemy ORM models, one file per domain
│   ├── schemas/                # Pydantic request/response schemas
│   ├── services/               # Business logic ({feature}_service.py)
│   ├── utils/                  # Shared helpers (csv_export, sql_search, ...)
│   ├── mcp/                    # Optional MCP server, mounted at /api/mcp
│   ├── data/                   # Static registries and libraries
│   └── preflight.py            # `python -m app.preflight` config check
├── alembic/
│   ├── env.py
│   └── versions/               # Migration revisions
├── tests/
│   └── conftest.py             # db_session and sample-data fixtures
├── scripts/                    # Operator and maintenance scripts (see scripts/README.md)
├── requirements.txt            # Runtime, test and lint dependencies
├── Dockerfile                  # Multi-stage build (development / production)
├── alembic.ini
├── pytest.ini
├── mypy.ini
└── pyproject.toml
```

---

## Key Features

### Tamper-Evident Audit Logging

Each audit entry is chained to the previous one with a keyed HMAC-SHA256 hash,
so an edited or deleted row breaks verification:

```python
from app.core.audit import log_event

# Log an event
await log_event(
    db,
    "user_login",
    {"username": "john"},
    event_category="auth",
    severity="info",
    user_id=user.id,
    organization_id=org.id,
)

# Verify integrity
from app.core.audit import verify_audit_log_integrity
result = await verify_audit_log_integrity(db)
is_valid = result["verified"]
```

### Async Database Operations

SQLAlchemy 2.1 with async/await. Primary keys are string UUIDs, and every by-id
query is scoped to the caller's organization:

```python
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.user import User

async def get_user(db: AsyncSession, user_id: str, organization_id: str):
    result = await db.execute(
        select(User).where(
            User.id == user_id,
            User.organization_id == organization_id,
        )
    )
    return result.scalar_one_or_none()
```

### Pydantic Validation

Type-safe API contracts:

```python
from pydantic import BaseModel, ConfigDict, EmailStr, Field

class UserCreate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    email: EmailStr
    password: str = Field(min_length=8)
    first_name: str
    last_name: str
```

### Automatic API Documentation

FastAPI generates OpenAPI docs automatically when `ENABLE_DOCS=true` (disable
it in production):

- **Swagger UI**: `http://localhost:3001/docs`
- **ReDoc**: `http://localhost:3001/redoc`
- **OpenAPI JSON**: `http://localhost:3001/openapi.json`

---

## Development Setup

### 1. Install Python 3.13+

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install python3.13 python3.13-venv

# macOS (Homebrew)
brew install python@3.13

# Verify
python3.13 --version
```

### 2. Create Virtual Environment

```bash
cd backend
python3.13 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

### 3. Install Dependencies

`requirements.txt` is the only requirements file; it includes the test and
lint tools (pytest, black, flake8, isort, mypy).

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

### 4. Configure Environment

The settings loader reads `.env` from the directory the server starts in. Copy
the repository's example into `backend/`:

```bash
cp ../.env.example .env
nano .env  # Edit configuration
```

Required variables:

```env
# Database
DB_HOST=localhost
DB_PORT=3306
DB_NAME=intranet_db
DB_USER=intranet_user
DB_PASSWORD=password

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Security
SECRET_KEY=your-secret-key-here
ENCRYPTION_KEY=your-encryption-key-here
ENCRYPTION_SALT=your-encryption-salt-here

# CORS (comma-separated)
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

### 5. Run Migrations

```bash
alembic upgrade head
```

The server also brings the schema up to date when it starts (`run_migrations()`
in `main.py`), including tables that only `create_all()` builds, so a fresh
database does not need this step before the first start.

### 6. Start Development Server

`main.py` lives at the top of `backend/`, so the app is `main:app`, started
from `backend/`:

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 3001
```

From the repo root, `npm run dev:backend` runs the same command.

---

## Database Migrations

### Create Migration

```bash
# Auto-generate from model changes
alembic revision --autogenerate -m "Add user table"

# Manual migration
alembic revision -m "Custom migration"
```

### Apply Migrations

```bash
# Upgrade to latest
alembic upgrade head

# Upgrade to specific revision
alembic upgrade abc123

# Rollback one version
alembic downgrade -1

# Rollback to specific revision
alembic downgrade abc123
```

### View Migration History

```bash
# Show current revision
alembic current

# Show migration history
alembic history

# Show pending migrations
alembic show head
```

---

## Testing

### Run Tests

```bash
# All tests
pytest

# With coverage
pytest --cov=app --cov-report=html

# Specific test file
pytest tests/test_users_delete_endpoint.py

# Specific test
pytest tests/test_users_delete_endpoint.py::TestDeleteUserHard::test_rejects_self_deletion

# API contract tests (schemathesis). Opt-in: the module starts a real server
# at import time and pytest imports every test module during collection, so
# without the gate an ordinary `pytest` run would boot the app and hold
# database connections. Needs a migrated database.
RUN_API_CONTRACT_TESTS=1 pytest tests/test_api_contract.py --timeout=300

# Container tests (build the production images, start them, check health).
# Skipped automatically when no Docker daemon is reachable.
pytest tests/test_docker_integration.py -m docker --timeout=1800
```

### Test markers

`pytest.ini` registers `unit`, `integration`, `slow`, `docker`, `onboarding`
and `asyncio`. CI splits on them:

| Job                        | Selection                                                          |
| -------------------------- | ------------------------------------------------------------------ |
| `backend-test`             | `not integration and not slow and not docker`                      |
| `backend-test-integration` | `integration and not docker and not slow` (MySQL + Redis services) |
| `backend-test-contract`    | `tests/test_api_contract.py` with `RUN_API_CONTRACT_TESTS=1`       |
| `docker-build`             | `-m docker`, after verifying a daemon is reachable                 |

The daemon check in `docker-build` is deliberate: every test in that module
skips itself when Docker is absent, and 19 skips would otherwise report as a
passing job.

### Test Structure

Endpoint tests mount the router under test on a bare `FastAPI()` and override
its dependencies, rather than booting the whole application:

```python
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import suggestions
from app.core.database import get_db


async def test_lists_boxes(db_session, member):
    app = FastAPI()
    app.include_router(suggestions.router, prefix="/suggestions")
    app.dependency_overrides[get_current_user] = lambda: member
    app.dependency_overrides[get_db] = lambda: db_session

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/suggestions/boxes")
        assert response.status_code == 200
```

`asyncio_mode = auto` in `pytest.ini`, so async tests need no
`@pytest.mark.asyncio`.

---

## Typing Conventions

The backend uses Python 3.13+ typing conventions (`pyupgrade --py313-plus`):

```python
# Modern style (used throughout)
def get_items(ids: list[str], filter: str | None = None) -> dict[str, int]:
    ...

# Legacy style (not used)
from typing import List, Optional, Dict
def get_items(ids: List[str], filter: Optional[str] = None) -> Dict[str, int]:
    ...
```

---

## Production Deployment

### Docker Build

`backend/Dockerfile` is multi-stage (`base` → `dependencies` → `development` /
`production`). The production stage, abridged:

```dockerfile
FROM python:3.14-slim as base
# ... system packages, appuser, WORKDIR /app

FROM base as dependencies
COPY requirements.txt .
RUN pip install --upgrade pip && \
    pip install -r requirements.txt

FROM dependencies as production
COPY main.py .
COPY app/ ./app/
COPY alembic/ ./alembic/
COPY alembic.ini .
COPY scripts/ ./scripts/
RUN rm -f scripts/seed_test_users.py

USER appuser
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=300s --retries=3 \
    CMD python -c "import requests; r = requests.get('http://localhost:3001/health', timeout=5); exit(0 if r.status_code == 200 else 1)"

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "3001", "--workers", "4"]
```

There is no separate migration command: the server runs migrations itself on
startup, which is why the health check allows a 300-second start period.

### Environment Variables

Production `.env` should include:

```env
# Database
DB_HOST=mysql
DB_PORT=3306
DB_NAME=intranet_db
DB_USER=intranet_user
DB_PASSWORD=<strong-password>

# Redis
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=<strong-password>

# Security (see CLAUDE.md "Generate secrets")
SECRET_KEY=<generated-secret-key>
ENCRYPTION_KEY=<generated-encryption-key>
ENCRYPTION_SALT=<generated-encryption-salt>

# CORS (comma-separated)
ALLOWED_ORIGINS=https://yourdomain.com

# Environment
ENVIRONMENT=production
DEBUG=false
ENABLE_DOCS=false
```

`.env.example.full` lists every option.

### Health Checks

```bash
# Basic health (used by Docker and load balancers)
curl http://localhost:3001/health

# Detailed diagnostics: needs a signed-in administrator (settings.manage), so
# open it in the browser while signed in, or send that session's cookies.
# Returns an error object when ENVIRONMENT=production.
curl -b cookies.txt http://localhost:3001/health/detailed
```

---

## Common Tasks

### Add New Endpoint

1. **Create schema** in `app/schemas/`:

```python
# app/schemas/task.py
from pydantic import BaseModel

class TaskCreate(BaseModel):
    title: str
    description: str | None = None
```

2. **Create model** in `app/models/`:

```python
# app/models/task.py
from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.utils import generate_uuid

class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(String(1000), nullable=True)
```

3. **Create endpoint** in `app/api/v1/endpoints/`:

```python
# app/api/v1/endpoints/tasks.py
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.database import get_db
from app.models.task import Task
from app.models.user import User
from app.schemas.task import TaskCreate

router = APIRouter()

@router.post("")
async def create_task(
    task: TaskCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("tasks.manage")),
):
    db_task = Task(**task.model_dump(), organization_id=current_user.organization_id)
    db.add(db_task)
    await db.commit()
    await db.refresh(db_task)
    return db_task
```

4. **Register router** in `app/api/v1/api.py`:

```python
from app.api.v1.endpoints import tasks

api_router.include_router(tasks.router, prefix="/tasks", tags=["tasks"])
```

---

## Troubleshooting

### Import Errors

```bash
# Ensure virtual environment is activated
source venv/bin/activate

# Reinstall dependencies
pip install -r requirements.txt
```

### Database Connection Issues

```bash
# Test database connection
python -c "import pymysql; pymysql.connect(host='localhost', user='root', password='password')"

# Check if database exists
mysql -u root -p -e "SHOW DATABASES;"
```

### Migration Conflicts

```bash
# Show migration heads
alembic heads

# Merge conflicting heads
alembic merge heads -m "Merge migrations"
```

### Redis Connection Issues

```bash
# Test Redis connection
redis-cli ping  # Should return PONG

# Check Redis server
redis-cli info server
```

---

## Resources

- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [SQLAlchemy Documentation](https://docs.sqlalchemy.org/)
- [Pydantic Documentation](https://docs.pydantic.dev/)
- [Alembic Documentation](https://alembic.sqlalchemy.org/)
- [Python 3.13 Release Notes](https://docs.python.org/3.13/whatsnew/3.13.html)
