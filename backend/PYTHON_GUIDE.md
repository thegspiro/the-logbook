# Python Backend - Quick Start Guide

## 🐍 Technology Stack

The backend has been rebuilt using **Python 3.11+ with FastAPI**:

### Core Technologies

- **FastAPI**: Modern, fast web framework with automatic API documentation
- **SQLAlchemy 2.0**: Async ORM for database operations
- **Alembic**: Database migration tool
- **MySQL 8.0+**: Primary database
- **Redis**: Caching and session storage
- **Pydantic**: Data validation with type hints
- **Uvicorn**: ASGI server
- **Argon2**: Secure password hashing (OWASP recommended)
- **PyJWT**: JWT token handling

### Why Python?

✅ **Fast Performance**: FastAPI is one of the fastest Python frameworks (comparable to Node.js)  
✅ **Type Safety**: Full type hint support with Pydantic validation  
✅ **Async/Await**: Native async support for high concurrency  
✅ **Auto Documentation**: Automatic OpenAPI/Swagger docs at `/docs`  
✅ **Clean Syntax**: Readable, maintainable Python code  
✅ **Rich Ecosystem**: Excellent libraries for security, data processing, ML  
✅ **Future-Ready**: Easy to add data analytics and ML features  

## 📁 Backend Structure

```
backend/
├── main.py                     # Application entry point
├── requirements.txt            # Python dependencies
├── Dockerfile                  # Multi-stage Docker build
├── alembic.ini                 # Migration configuration
│
├── app/
│   ├── __init__.py
│   │
│   ├── core/                   # Core functionality
│   │   ├── config.py           # Pydantic settings
│   │   ├── database.py         # SQLAlchemy setup
│   │   ├── cache.py            # Redis client
│   │   └── audit.py            # Tamper-proof logging
│   │
│   ├── models/                 # SQLAlchemy models
│   │   ├── user.py             # User, Role, Organization
│   │   ├── audit.py            # Audit logs
│   │   └── [modules]/          # Module-specific models
│   │
│   ├── schemas/                # Pydantic schemas (API contracts)
│   │   ├── user.py
│   │   └── [modules]/
│   │
│   ├── api/                    # API endpoints
│   │   └── v1/
│   │       ├── api.py          # Router aggregator
│   │       └── endpoints/
│   │           ├── auth.py
│   │           ├── users.py
│   │           └── [modules]/
│   │
│   ├── services/               # Business logic
│   │   ├── auth_service.py
│   │   ├── user_service.py
│   │   └── [modules]/
│   │
│   ├── integrations/           # External services
│   │   ├── microsoft365/
│   │   ├── google/
│   │   ├── ldap/
│   │   └── storage/
│   │
│   └── utils/                  # Utilities
│       ├── security.py
│       ├── email.py
│       └── validators.py
│
├── alembic/                    # Database migrations
│   ├── versions/
│   │   └── 001_initial_schema.py
│   └── env.py
│
└── tests/                      # Tests
    ├── conftest.py
    ├── test_api/
    └── test_services/
```

## 🚀 Quick Start

### Prerequisites

- Python 3.11 or higher
- MySQL 8.0+
- Redis 7+
- Docker & Docker Compose (recommended)

### Option 1: Docker (Recommended)

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f backend

# Access API documentation
open http://localhost:3001/docs
```

### Option 2: Local Development

```bash
# Navigate to backend
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Set environment variables
cp ../.env.example ../.env
# Edit .env with your settings

# Run database migrations
alembic upgrade head

# Start development server
uvicorn main:app --reload --port 3001
```

## 📊 Database Migrations

Using Alembic for database schema management:

```bash
# Create a new migration
alembic revision --autogenerate -m "Add training module tables"

# Apply migrations
alembic upgrade head

# Rollback last migration
alembic downgrade -1

# View migration history
alembic history

# View current version
alembic current
```

## 🔍 API Documentation

FastAPI automatically generates interactive API documentation:

- **Swagger UI**: http://localhost:3001/docs
- **ReDoc**: http://localhost:3001/redoc
- **OpenAPI JSON**: http://localhost:3001/openapi.json

## 🧪 Testing

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=app --cov-report=html

# Run specific test file
pytest tests/test_api/test_auth.py

# Run with verbose output
pytest -v

# Run in watch mode
pytest-watch
```

## 📦 Key Python Packages

### Web Framework
```python
fastapi==0.115.6        # Web framework
uvicorn[standard]==0.34.0  # ASGI server
pydantic==2.10.5        # Data validation
```

### Database
```python
sqlalchemy==2.0.36      # ORM
alembic==1.14.0         # Migrations
aiomysql==0.2.0         # Async MySQL driver
pymysql==1.1.1          # MySQL driver (sync fallback)
```

### Security
```python
PyJWT[crypto]==2.10.1   # JWT tokens (replaces python-jose)
bcrypt==4.2.1           # Password hashing
argon2-cffi==23.1.0     # Argon2 hashing (OWASP recommended)
pyotp==2.9.0            # TOTP for MFA
cryptography==43.0.3    # Encryption & secure connections
```

### Integrations
```python
boto3==1.35.95          # AWS SDK
msal==1.31.1            # Microsoft authentication
google-auth==2.37.0     # Google authentication
twilio==9.4.0           # SMS
```

## 🔐 Security Features Implemented

### Tamper-Proof Audit Logging

```python
from app.core.audit import log_event
from app.core.database import get_db

# Log an event
await log_event(
    db=db,
    event_type="user_login",
    event_data={"username": "john.doe"},
    event_category="auth",
    severity="info",
    user_id=user.id,
    ip_address=request.client.host,
)

# Verify integrity
from app.core.audit import audit_logger

results = await audit_logger.verify_integrity(db)
if not results["verified"]:
    # Tampering detected!
    logger.critical("Audit log tampering detected!")
```

### Password Hashing

```python
from argon2 import PasswordHasher

# Initialize Argon2 password hasher (OWASP recommended)
password_hasher = PasswordHasher(
    time_cost=3,        # Number of iterations
    memory_cost=65536,  # Memory usage in KB (64 MB)
    parallelism=4,      # Number of parallel threads
    hash_len=32,        # Length of the hash in bytes
    salt_len=16         # Length of the salt in bytes
)

# Hash password
hashed = password_hasher.hash("user_password")

# Verify password
try:
    password_hasher.verify(hashed, "user_password")
    is_valid = True

    # Check if password needs rehashing (if parameters changed)
    if password_hasher.check_needs_rehash(hashed):
        # Rehash with new parameters
        new_hashed = password_hasher.hash("user_password")
except Exception:
    is_valid = False
```

### JWT Authentication

```python
import jwt
from jwt.exceptions import InvalidTokenError
from datetime import datetime, timedelta

# Create access token
access_token = jwt.encode(
    {
        "sub": str(user.id),
        "exp": datetime.utcnow() + timedelta(minutes=480),
        "iat": datetime.utcnow(),
        "type": "access"
    },
    settings.SECRET_KEY,
    algorithm=settings.ALGORITHM
)

# Decode and verify token
try:
    payload = jwt.decode(
        token,
        settings.SECRET_KEY,
        algorithms=[settings.ALGORITHM]
    )
    user_id = payload.get("sub")
except InvalidTokenError:
    # Handle invalid token (expired, tampered, etc.)
    raise HTTPException(status_code=401, detail="Invalid token")
```

## 🔧 Configuration

Configuration is managed through Pydantic Settings in `app/core/config.py`:

```python
from app.core.config import settings

# Access settings
database_url = settings.DATABASE_URL
redis_url = settings.REDIS_URL
is_debug = settings.DEBUG

# Settings are loaded from:
# 1. Environment variables
# 2. .env file
# 3. Default values in Settings class
```

## 📝 Creating a New Endpoint

```python
# app/api/v1/endpoints/example.py
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.audit import log_event

router = APIRouter()

@router.get("/example")
async def get_example(
    db: AsyncSession = Depends(get_db)
):
    """
    Example endpoint with database access and audit logging
    """
    # Your logic here
    result = {"message": "Hello from FastAPI!"}
    
    # Log the access
    await log_event(
        db=db,
        event_type="example_accessed",
        event_data=result,
        event_category="api",
        severity="info",
    )
    
    return result

# Add to api.py:
# from app.api.v1.endpoints import example
# api_router.include_router(example.router, prefix="/example", tags=["example"])
```

## 🐳 Docker Commands

```bash
# Build images
docker-compose build backend

# Start backend only
docker-compose up backend

# Run migrations in container
docker-compose exec backend alembic upgrade head

# Open Python shell in container
docker-compose exec backend python

# View backend logs
docker-compose logs -f backend

# Restart backend
docker-compose restart backend
```

## 🔄 Development Workflow

1. **Create feature branch**
   ```bash
   git checkout -b feature/new-module
   ```

2. **Create database models** in `app/models/`

3. **Generate migration**
   ```bash
   alembic revision --autogenerate -m "Add new module"
   ```

4. **Create Pydantic schemas** in `app/schemas/`

5. **Implement business logic** in `app/services/`

6. **Create API endpoints** in `app/api/v1/endpoints/`

7. **Write tests** in `tests/`

8. **Run tests**
   ```bash
   pytest
   ```

9. **Commit and push**
   ```bash
   git add .
   git commit -m "feat: add new module"
   git push origin feature/new-module
   ```

## 📚 Additional Resources

- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [SQLAlchemy 2.0 Documentation](https://docs.sqlalchemy.org/en/20/)
- [Alembic Documentation](https://alembic.sqlalchemy.org/)
- [Pydantic Documentation](https://docs.pydantic.dev/)
- [Python Type Hints](https://docs.python.org/3/library/typing.html)

## 🤝 Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for development guidelines.

## 📄 License

MIT License - see [LICENSE](../LICENSE) for details.
