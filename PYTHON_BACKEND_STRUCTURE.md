# Python Backend File Structure

## Overview

The backend has been restructured to use **Python with FastAPI** instead of Node.js/TypeScript.

## Technology Stack

**Backend:**
- **Python 3.11+**
- **FastAPI** - Modern, fast web framework
- **SQLAlchemy 2.0** - Async ORM
- **Alembic** - Database migrations
- **MySQL 8.0+** - Database
- **Redis 7+** - Caching and sessions
- **Pydantic** - Data validation
- **Uvicorn** - ASGI server

**Frontend:** (unchanged)
- **React 18** with TypeScript
- **Vite** for building
- **Tailwind CSS** for styling

## Backend Directory Structure

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
│   │   ├── redis_client.py             # Redis connection
│   │   ├── security.py                 # Security utilities
│   │   ├── encryption.py               # Encryption functions
│   │   └── middleware.py               # Custom middleware
│   │
│   ├── models/                         # SQLAlchemy models
│   │   ├── __init__.py
│   │   ├── user.py                     # User, Organization, Role
│   │   ├── session.py                  # Session model
│   │   ├── audit_log.py                # Audit logging
│   │   └── module_config.py            # Module configuration
│   │
│   ├── schemas/                        # Pydantic schemas (DTOs)
│   │   ├── __init__.py
│   │   ├── user.py                     # User schemas
│   │   ├── auth.py                     # Auth request/response schemas
│   │   ├── role.py                     # Role schemas
│   │   └── common.py                   # Shared schemas
│   │
│   ├── api/                            # API routes
│   │   ├── __init__.py
│   │   ├── router.py                   # Main API router
│   │   ├── deps.py                     # Dependencies (get_db, get_current_user, etc.)
│   │   │
│   │   ├── auth/                       # Authentication endpoints
│   │   │   ├── __init__.py
│   │   │   ├── login.py
│   │   │   ├── register.py
│   │   │   ├── mfa.py
│   │   │   └── oauth.py
│   │   │
│   │   ├── users/                      # User management
│   │   │   ├── __init__.py
│   │   │   ├── users.py
│   │   │   ├── roles.py
│   │   │   └── permissions.py
│   │   │
│   │   ├── documents/                  # Document management
│   │   │   ├── __init__.py
│   │   │   └── documents.py
│   │   │
│   │   └── modules/                    # Module-specific routes
│   │       ├── training/
│   │       │   ├── __init__.py
│   │       │   ├── certifications.py
│   │       │   └── sessions.py
│   │       ├── compliance/
│   │       ├── scheduling/
│   │       └── inventory/
│   │
│   ├── services/                       # Business logic
│   │   ├── __init__.py
│   │   ├── auth_service.py             # Authentication logic
│   │   ├── user_service.py             # User operations
│   │   ├── email_service.py            # Email sending
│   │   ├── sms_service.py              # SMS sending
│   │   ├── audit_service.py            # Audit logging
│   │   ├── encryption_service.py       # Encryption/decryption
│   │   └── storage_service.py          # File storage
│   │
│   ├── repositories/                   # Data access layer
│   │   ├── __init__.py
│   │   ├── base.py                     # Base repository
│   │   ├── user_repository.py
│   │   ├── role_repository.py
│   │   └── audit_repository.py
│   │
│   ├── integrations/                   # External service integrations
│   │   ├── __init__.py
│   │   ├── microsoft/
│   │   │   ├── __init__.py
│   │   │   ├── oauth.py
│   │   │   ├── graph.py
│   │   │   └── email.py
│   │   ├── google/
│   │   │   ├── __init__.py
│   │   │   ├── oauth.py
│   │   │   └── gmail.py
│   │   ├── ldap/
│   │   │   └── connector.py
│   │   ├── storage/
│   │   │   ├── s3.py
│   │   │   ├── azure_blob.py
│   │   │   ├── gcs.py
│   │   │   └── local.py
│   │   └── stripe/
│   │       └── payments.py
│   │
│   ├── utils/                          # Utility functions
│   │   ├── __init__.py
│   │   ├── hash.py                     # Password hashing
│   │   ├── jwt.py                      # JWT token handling
│   │   ├── validators.py               # Custom validators
│   │   ├── geo_ip.py                   # Geo IP utilities
│   │   └── logger.py                   # Logging configuration
│   │
│   └── modules/                        # Optional feature modules
│       ├── __init__.py
│       ├── training/
│       │   ├── __init__.py
│       │   ├── models.py               # Module-specific models
│       │   ├── schemas.py              # Module schemas
│       │   ├── service.py              # Module business logic
│       │   ├── repository.py           # Module data access
│       │   └── config.py               # Module configuration
│       ├── compliance/
│       ├── scheduling/
│       ├── inventory/
│       ├── meetings/
│       └── elections/
│
├── alembic/                            # Database migrations
│   ├── versions/                       # Migration files
│   │   ├── 20240113_1200_initial_schema.py
│   │   ├── 20240115_1400_add_audit_logs.py
│   │   └── 20240120_1000_add_training_module.py
│   ├── env.py                          # Migration environment
│   └── script.py.mako                  # Migration template
│
├── tests/                              # Tests
│   ├── __init__.py
│   ├── conftest.py                     # Pytest configuration
│   ├── unit/                           # Unit tests
│   │   ├── test_auth.py
│   │   ├── test_users.py
│   │   └── test_services.py
│   ├── integration/                    # Integration tests
│   │   ├── test_api.py
│   │   └── test_database.py
│   ├── e2e/                            # End-to-end tests
│   └── fixtures/                       # Test fixtures
│       └── data.py
│
├── scripts/                            # Utility scripts
│   ├── init_db.py                      # Initialize database
│   ├── seed_data.py                    # Seed test data
│   └── generate_keys.py                # Generate encryption keys
│
├── requirements.txt                    # Python dependencies (pip)
├── pyproject.toml                      # Modern Python project config (Poetry)
├── alembic.ini                         # Alembic configuration
├── .env.example                        # Environment variables example
├── Dockerfile                          # Docker configuration
├── .dockerignore
├── pytest.ini                          # Pytest configuration
├── .flake8                             # Flake8 linting config
└── README.md                           # Backend documentation
```

## Key Differences from Node.js Version

### 1. Package Management
- **Node.js**: `package.json`, `npm`/`yarn`
- **Python**: `requirements.txt` (pip) or `pyproject.toml` (Poetry)

### 2. Database ORM
- **Node.js**: Knex (query builder) or TypeORM
- **Python**: SQLAlchemy (full ORM with async support)

### 3. Migrations
- **Node.js**: Knex migrations
- **Python**: Alembic migrations

### 4. Data Validation
- **Node.js**: Joi, Zod, class-validator
- **Python**: Pydantic (built into FastAPI)

### 5. Dependency Injection
- **Node.js**: Manual or libraries like InversifyJS
- **Python**: FastAPI's built-in dependency injection system

### 6. Type Checking
- **Node.js**: TypeScript (required)
- **Python**: Type hints (optional but recommended, checked with mypy)

### 7. Async Support
- **Node.js**: Native async/await
- **Python**: asyncio with async/await (SQLAlchemy 2.0 has full async support)

## Python-Specific Features

### FastAPI Advantages
1. **Automatic OpenAPI documentation** - Interactive docs at `/docs`
2. **Built-in request validation** - Using Pydantic
3. **Dependency injection** - Clean, reusable dependencies
4. **Async support** - Native async/await for better performance
5. **Type hints** - Better IDE support and error catching

### SQLAlchemy Benefits
1. **Mature ORM** - 15+ years of development
2. **Async support** - SQLAlchemy 2.0 is fully async
3. **Flexible** - Can use ORM or raw SQL
4. **Relationship handling** - Excellent support for complex relationships
5. **Migration support** - Alembic is the standard

### Pydantic Features
1. **Automatic validation** - Type-safe request/response
2. **Settings management** - Type-safe configuration
3. **JSON Schema** - Automatic schema generation
4. **Data conversion** - Automatic type coercion

## Example: Creating a New Endpoint

**Python/FastAPI:**
```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.deps import get_db, get_current_user
from app.models.user import User
from app.schemas.user import UserResponse

router = APIRouter()

@router.get("/users/me", response_model=UserResponse)
async def get_current_user_info(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get current user information"""
    return current_user
```

**Key Features:**
- Automatic request validation
- Automatic response serialization
- Type-safe dependencies
- Async database queries
- Automatic OpenAPI documentation

## Running the Python Backend

### Installation
```bash
# Using pip
pip install -r requirements.txt

# Using Poetry (recommended)
poetry install
```

### Database Migrations
```bash
# Create a new migration
alembic revision --autogenerate -m "description"

# Run migrations
alembic upgrade head

# Rollback
alembic downgrade -1
```

### Development Server
```bash
# Using uvicorn directly
uvicorn app.main:app --reload --host 0.0.0.0 --port 3001

# Using Python module
python -m app.main

# Using Poetry
poetry run uvicorn app.main:app --reload
```

### Testing
```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=app --cov-report=html

# Run specific test
pytest tests/unit/test_auth.py
```

### Code Quality
```bash
# Format code
black app/

# Sort imports
isort app/

# Lint
flake8 app/

# Type check
mypy app/
```

## Docker Usage

The Docker setup remains similar but uses Python instead:

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3001"]
```

## Configuration

Configuration is handled via Pydantic Settings (see `app/core/config.py`):
- Type-safe configuration
- Environment variable loading
- Validation on startup
- IDE autocomplete support

## Summary

The Python backend provides:
- ✅ **Modern async framework** (FastAPI)
- ✅ **Strong type safety** (Pydantic + mypy)
- ✅ **Excellent ORM** (SQLAlchemy 2.0 async)
- ✅ **Automatic API docs** (OpenAPI/Swagger)
- ✅ **Clean dependency injection**
- ✅ **Industry-standard tools** (Alembic, pytest, etc.)
- ✅ **Great developer experience**

All the same features and security from the Node.js version are maintained!
