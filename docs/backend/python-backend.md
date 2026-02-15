# Python Backend Documentation

## Overview

The backend uses **Python 3.13+ with FastAPI** - a modern, high-performance framework with excellent type safety and automatic API documentation.

---

## Technology Stack

| Component | Technology |
|-----------|-----------|
| **Runtime** | Python 3.13+ |
| **Framework** | FastAPI |
| **ORM** | SQLAlchemy 2.0 (async) |
| **Migrations** | Alembic |
| **Validation** | Pydantic |
| **Server** | Uvicorn (ASGI) |
| **Database** | MySQL 8.0+ (MariaDB 10.11+ for ARM) |
| **Cache** | Redis 7+ |
| **Package Manager** | pip / pip-tools |

---

## Directory Structure

```
backend/
├── app/                                # Application code
│   ├── __init__.py
│   ├── main.py                         # FastAPI application entry point
│   │
│   ├── core/                           # Core functionality
│   │   ├── __init__.py
│   │   ├── config.py                   # Pydantic Settings configuration
│   │   ├── database.py                 # SQLAlchemy setup
│   │   ├── cache.py                    # Redis client
│   │   ├── security.py                 # Security utilities
│   │   ├── encryption.py               # Encryption functions
│   │   ├── audit.py                    # Tamper-proof audit logging
│   │   └── middleware.py               # Custom middleware
│   │
│   ├── models/                         # SQLAlchemy models
│   │   ├── __init__.py
│   │   ├── user.py                     # User, Organization, Role
│   │   ├── session.py                  # Session model
│   │   ├── audit.py                    # Audit log models
│   │   └── module_config.py            # Module configuration
│   │
│   ├── schemas/                        # Pydantic schemas (API contracts)
│   │   ├── __init__.py
│   │   ├── user.py                     # User schemas
│   │   ├── auth.py                     # Auth schemas
│   │   ├── role.py                     # Role schemas
│   │   └── common.py                   # Shared schemas
│   │
│   ├── api/                            # API routes
│   │   ├── __init__.py
│   │   ├── router.py                   # Main API router
│   │   ├── deps.py                     # Dependencies (get_db, get_current_user)
│   │   │
│   │   ├── v1/                         # API version 1
│   │   │   ├── __init__.py
│   │   │   ├── api.py                  # Router aggregator
│   │   │   └── endpoints/              # Endpoint modules
│   │   │       ├── auth.py
│   │   │       ├── users.py
│   │   │       ├── onboarding.py
│   │   │       └── ...
│   │   │
│   │   └── modules/                    # Module-specific routes
│   │       ├── training/
│   │       ├── scheduling/
│   │       └── ...
│   │
│   ├── services/                       # Business logic layer
│   │   ├── __init__.py
│   │   ├── user_service.py
│   │   ├── auth_service.py
│   │   └── ...
│   │
│   └── utils/                          # Utility functions
│       ├── __init__.py
│       └── ...
│
├── alembic/                            # Database migrations
│   ├── versions/
│   └── env.py
│
├── tests/                              # Test suite
│   ├── __init__.py
│   ├── conftest.py
│   └── ...
│
├── scripts/                            # Utility scripts
│   └── seed_data.py
│
├── requirements.txt                    # Python dependencies
├── requirements-dev.txt                # Development dependencies
├── Dockerfile                          # Production Docker build
├── alembic.ini                         # Alembic configuration
└── pytest.ini                          # Pytest configuration
```

---

## Key Features

### Tamper-Proof Audit Logging

Blockchain-inspired hash chain for immutable audit logs:

```python
from app.core.audit import log_event

# Log an event
await log_event(
    db=db,
    event_type="user_login",
    event_data={"username": "john"},
    event_category="auth",
    severity="info",
    user_id=user.id,
    organization_id=org.id
)

# Verify integrity
from app.core.audit import verify_audit_chain
is_valid = await verify_audit_chain(db)
```

### Async Database Operations

SQLAlchemy 2.0 with async/await:

```python
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.user import User

async def get_user(db: AsyncSession, user_id: int):
    result = await db.execute(
        select(User).where(User.id == user_id)
    )
    return result.scalar_one_or_none()
```

### Pydantic Validation

Type-safe API contracts:

```python
from pydantic import BaseModel, EmailStr, constr

class UserCreate(BaseModel):
    email: EmailStr
    password: constr(min_length=8)
    first_name: str
    last_name: str

    class Config:
        from_attributes = True
```

### Automatic API Documentation

FastAPI generates OpenAPI docs automatically:
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

```bash
pip install --upgrade pip
pip install -r requirements.txt
pip install -r requirements-dev.txt  # For development
```

### 4. Configure Environment

```bash
cp .env.example .env
nano .env  # Edit configuration
```

Required variables:
```env
# Database
DB_HOST=localhost
DB_PORT=3306
DB_NAME=the_logbook
DB_USER=root
DB_PASSWORD=password

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Security
SECRET_KEY=your-secret-key-here
ENCRYPTION_KEY=your-encryption-key-here
ENCRYPTION_SALT=your-encryption-salt-here

# CORS
ALLOWED_ORIGINS=["http://localhost:5173"]
```

### 5. Run Migrations

```bash
# Create initial migration
alembic revision --autogenerate -m "Initial migration"

# Apply migrations
alembic upgrade head
```

### 6. Start Development Server

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 3001
```

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
pytest tests/test_users.py

# Specific test
pytest tests/test_users.py::test_create_user

# Watch mode
pytest-watch
```

### Test Structure

```python
import pytest
from httpx import AsyncClient
from app.main import app

@pytest.mark.asyncio
async def test_create_user():
    async with AsyncClient(app=app, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/users",
            json={"email": "test@example.com", "password": "password123"}
        )
        assert response.status_code == 201
```

---

## Python 3.13 Features

### Performance Improvements
- **JIT Compiler**: 10-60% faster execution
- **Improved asyncio**: Better async performance
- **Optimized GC**: Reduced memory overhead

### Language Features
- **Better Error Messages**: More detailed tracebacks
- **Type System**: Enhanced type checking
- **Experimental GIL Removal**: Better multi-threading (experimental)

### Benefits for The Logbook
✅ Faster API response times
✅ Lower memory usage
✅ Better type safety
✅ Long-term support until October 2029

---

## Production Deployment

### Docker Build

```dockerfile
FROM python:3.13-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY . .

# Run migrations and start server
CMD alembic upgrade head && \
    uvicorn app.main:app --host 0.0.0.0 --port 3001
```

### Environment Variables

Production `.env` should include:

```env
# Database
DB_HOST=db
DB_PORT=3306
DB_NAME=the_logbook
DB_USER=logbook_user
DB_PASSWORD=<strong-password>

# Redis
REDIS_HOST=redis
REDIS_PORT=6379

# Security (generate with: openssl rand -hex 32)
SECRET_KEY=<generated-secret-key>
ENCRYPTION_KEY=<generated-encryption-key>

# CORS
ALLOWED_ORIGINS=["https://yourdomain.com"]

# Environment
ENV=production
DEBUG=false
```

### Health Checks

```bash
# Basic health
curl http://localhost:3001/health

# Database health
curl http://localhost:3001/health/db

# Redis health
curl http://localhost:3001/health/redis
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
from sqlalchemy import Column, Integer, String
from app.core.database import Base

class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True)
    title = Column(String(255), nullable=False)
    description = Column(String(1000))
```

3. **Create endpoint** in `app/api/v1/endpoints/`:
```python
# app/api/v1/endpoints/tasks.py
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_db
from app.schemas.task import TaskCreate
from app.models.task import Task

router = APIRouter()

@router.post("/tasks")
async def create_task(
    task: TaskCreate,
    db: AsyncSession = Depends(get_db)
):
    db_task = Task(**task.dict())
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

### Duplicate Index Name on MySQL

If you see `(1061, "Duplicate key name 'ix_<table>_<column>'")` during startup, a model column has both `index=True` and an explicit `Index()` with the same auto-generated name. Use one method, not both:

```python
# CORRECT: explicit Index in __table_args__ (preferred)
organization_id = Column(String(36), ForeignKey("organizations.id"), nullable=False)

__table_args__ = (
    Index("ix_locations_organization_id", "organization_id"),
)

# WRONG: both together — MySQL rejects the duplicate name
organization_id = Column(String(36), ForeignKey("organizations.id"), nullable=False, index=True)

__table_args__ = (
    Index("ix_locations_organization_id", "organization_id"),  # Duplicate!
)
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
- [SQLAlchemy 2.0 Documentation](https://docs.sqlalchemy.org/en/20/)
- [Pydantic Documentation](https://docs.pydantic.dev/)
- [Alembic Documentation](https://alembic.sqlalchemy.org/)
- [Python 3.13 Release Notes](https://docs.python.org/3.13/whatsnew/3.13.html)

---

## Migration History

### Node.js to Python (2025-2026)
- **From:** Node.js/Express.js with Knex.js
- **To:** Python/FastAPI with SQLAlchemy
- **Reason:** Better performance, type safety, and automatic API docs

### Version Updates
- **Python:** 3.11 → 3.13 (January 2026)
- **FastAPI:** Latest stable
- **SQLAlchemy:** 2.0+ (async support)
- **Support:** Python 3.13 supported until October 2029
