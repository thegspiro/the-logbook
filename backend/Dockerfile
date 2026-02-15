# ============================================
# Multi-stage Dockerfile for Python Backend
# ============================================

# ============================================
# Stage 1: Base
# ============================================
FROM python:3.13-slim as base

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DEBIAN_FRONTEND=noninteractive

# Install system dependencies (MySQL client for healthchecks, LDAP for auth, libmagic for file validation)
RUN apt-get update && apt-get install -y \
    gcc \
    default-mysql-client \
    default-libmysqlclient-dev \
    libldap2-dev \
    libsasl2-dev \
    libmagic1 \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Create app user
RUN useradd -m -u 1000 appuser

# Set work directory
WORKDIR /app

# ============================================
# Stage 2: Dependencies
# ============================================
FROM base as dependencies

# Copy requirements
COPY requirements.txt .

# Install Python dependencies
RUN pip install --upgrade pip && \
    pip install -r requirements.txt

# ============================================
# Stage 3: Development
# ============================================
FROM dependencies as development

# Install development dependencies
RUN pip install \
    pytest \
    pytest-asyncio \
    pytest-cov \
    black \
    flake8 \
    mypy \
    ipython

# Copy application code
COPY . .

# Change ownership
RUN chown -R appuser:appuser /app

# Switch to app user
USER appuser

# Expose port
EXPOSE 3001

# Run development server
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "3001", "--reload"]

# ============================================
# Stage 4: Production
# ============================================
FROM dependencies as production

# Copy only necessary files
COPY main.py .
COPY app/ ./app/
COPY alembic/ ./alembic/
COPY alembic.ini .

# Change ownership
RUN chown -R appuser:appuser /app

# Switch to app user
USER appuser

# Create logs directory
RUN mkdir -p logs

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=300s --retries=3 \
    CMD python -c "import requests; r = requests.get('http://localhost:3001/health', timeout=5); exit(0 if r.status_code == 200 else 1)"

# Run production server
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "3001", "--workers", "4"]
