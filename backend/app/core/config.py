"""
Application Configuration

Uses pydantic-settings for environment variable management
with type validation and defaults.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator
from typing import List, Optional, Union
from functools import lru_cache


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables
    """
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
    )
    
    # ============================================
    # Application
    # ============================================
    APP_NAME: str = "The Logbook"
    VERSION: str = "1.0.0"
    ENVIRONMENT: str = "development"
    PORT: int = 3001
    DEBUG: bool = False
    
    # ============================================
    # Database - MySQL
    # ============================================
    DB_HOST: str = "localhost"
    DB_PORT: int = 3306
    DB_NAME: str = "intranet_db"
    DB_USER: str = "intranet_user"
    DB_PASSWORD: str = "change_me_in_production"
    DB_SSL: bool = False
    DB_POOL_MIN: int = 2
    DB_POOL_MAX: int = 10
    DB_ECHO: bool = False  # SQL logging
    DB_CHARSET: str = "utf8mb4"  # Use utf8mb4 for full Unicode support
    DB_CONNECT_TIMEOUT: int = 30  # Connection timeout in seconds
    DB_CONNECT_RETRIES: int = 40  # Number of connection retry attempts (supports ~10min cold MySQL init)
    DB_CONNECT_RETRY_DELAY: int = 2  # Initial delay between retries (exponential backoff) - optimized for faster startup
    DB_CONNECT_RETRY_MAX_DELAY: int = 15  # Maximum delay between retries (caps exponential backoff) - optimized for faster startup

    @property
    def DATABASE_URL(self) -> str:
        """Construct async MySQL database URL"""
        return f"mysql+aiomysql://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}?charset={self.DB_CHARSET}"

    @property
    def SYNC_DATABASE_URL(self) -> str:
        """Construct synchronous MySQL database URL (for Alembic)"""
        return f"mysql+pymysql://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}?charset={self.DB_CHARSET}"
    
    # ============================================
    # Redis
    # ============================================
    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_PASSWORD: Optional[str] = None
    REDIS_DB: int = 0
    REDIS_TTL: int = 3600  # Default cache TTL in seconds
    REDIS_CONNECT_TIMEOUT: int = 5  # Connection timeout in seconds
    REDIS_CONNECT_RETRIES: int = 3  # Number of connection retry attempts
    REDIS_REQUIRED: bool = False  # If False, app starts even if Redis fails

    @property
    def REDIS_URL(self) -> str:
        """Construct Redis URL"""
        if self.REDIS_PASSWORD:
            return f"redis://:{self.REDIS_PASSWORD}@{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"
    
    # ============================================
    # Security
    # ============================================
    # CRITICAL: These MUST be set via environment variables.
    # The application will refuse to start if these contain known-insecure values.
    SECRET_KEY: str = "INSECURE_DEFAULT_KEY_CHANGE_IN_PRODUCTION"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30  # Short-lived access tokens (use refresh flow)
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Password Policy
    PASSWORD_MIN_LENGTH: int = 12
    PASSWORD_REQUIRE_UPPERCASE: bool = True
    PASSWORD_REQUIRE_LOWERCASE: bool = True
    PASSWORD_REQUIRE_NUMBERS: bool = True
    PASSWORD_REQUIRE_SPECIAL: bool = True

    # HIPAA Compliance Settings (§164.312)
    HIPAA_SESSION_TIMEOUT_MINUTES: int = 15  # Automatic logoff after inactivity (§164.312(a)(2)(iii))
    HIPAA_PASSWORD_HISTORY_COUNT: int = 12  # Previous passwords remembered (§164.312(d))
    HIPAA_MINIMUM_PASSWORD_AGE_DAYS: int = 1  # Min days before password can be changed again
    HIPAA_MAXIMUM_PASSWORD_AGE_DAYS: int = 90  # Max days before password must be changed
    HIPAA_AUDIT_RETENTION_DAYS: int = 2555  # 7-year audit log retention (§164.312(b))

    # Encryption - CRITICAL: Must be set via ENCRYPTION_KEY env var
    ENCRYPTION_KEY: str = "INSECURE_DEFAULT_KEY_CHANGE_ME"

    # Installation-specific salt for key derivation
    # CRITICAL: Must be unique per installation, set via ENCRYPTION_SALT env var
    ENCRYPTION_SALT: str = ""

    # Registration control
    REGISTRATION_ENABLED: bool = False  # Disabled by default; admins create users
    REGISTRATION_REQUIRES_APPROVAL: bool = True  # New registrations require admin approval

    # Rate Limiting
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_PER_MINUTE: int = 60

    # Trusted proxy IPs for X-Forwarded-For validation
    TRUSTED_PROXY_IPS: str = ""  # Comma-separated list of trusted proxy IPs

    # Security enforcement
    SECURITY_ENFORCE_HTTPS: bool = False  # Set to True in production
    SECURITY_BLOCK_INSECURE_DEFAULTS: bool = True  # Block startup with default keys in production

    def validate_security_config(self) -> list[str]:
        """
        Validate security configuration.

        Insecure default detection runs in ALL environments to prevent
        accidental deployment with known-bad values. Production-only
        checks are additive.

        Returns list of security warnings/errors.
        """
        warnings = []

        # --- Checks that apply in ALL environments ---
        _insecure_patterns = ("INSECURE_DEFAULT", "CHANGE_ME", "change_me")

        if any(p in self.SECRET_KEY for p in _insecure_patterns) or len(self.SECRET_KEY) < 32:
            warnings.append(
                "CRITICAL: SECRET_KEY must be set to a secure random value (min 32 chars). "
                "Generate one with: python3 -c \"import secrets; print(secrets.token_urlsafe(64))\""
            )

        if any(p in self.ENCRYPTION_KEY for p in _insecure_patterns):
            warnings.append(
                "CRITICAL: ENCRYPTION_KEY must be set to a secure random value. "
                "Generate one with: python3 -c \"import secrets; print(secrets.token_hex(32))\""
            )

        if not self.ENCRYPTION_SALT:
            warnings.append(
                "CRITICAL: ENCRYPTION_SALT must be set to a unique random value. "
                "Generate one with: python3 -c \"import secrets; print(secrets.token_hex(16))\""
            )

        if any(p in self.DB_PASSWORD for p in _insecure_patterns):
            warnings.append("CRITICAL: DB_PASSWORD must be changed from default")

        # --- Additional production-only checks ---
        if self.ENVIRONMENT == "production":
            if not self.REDIS_PASSWORD:
                warnings.append("CRITICAL: REDIS_PASSWORD must be set in production")

            if self.DEBUG:
                warnings.append("WARNING: DEBUG mode should be disabled in production")

            if self.ENABLE_DOCS:
                warnings.append("WARNING: API documentation should be disabled in production")

            if not self.SECURITY_ENFORCE_HTTPS:
                warnings.append("WARNING: HTTPS enforcement should be enabled in production")

        return warnings

    def validate_cors_config(self) -> list[str]:
        """
        Validate CORS configuration for security issues.
        Returns list of CORS-related warnings.
        """
        warnings = []
        origins = self.ALLOWED_ORIGINS if isinstance(self.ALLOWED_ORIGINS, list) else [self.ALLOWED_ORIGINS]
        if "*" in origins:
            warnings.append(
                "CRITICAL: ALLOWED_ORIGINS contains wildcard '*'. "
                "This is insecure when credentials are enabled."
            )
        return warnings

    def get_trusted_proxy_ips(self) -> set:
        """Get trusted proxy IPs as a set."""
        if not self.TRUSTED_PROXY_IPS:
            return set()
        return {ip.strip() for ip in self.TRUSTED_PROXY_IPS.split(",") if ip.strip()}

    def is_production_ready(self) -> bool:
        """Check if configuration is production-ready (no CRITICAL warnings)."""
        warnings = self.validate_security_config() + self.validate_cors_config()
        return not any("CRITICAL" in w for w in warnings)

    # ============================================
    # GeoIP and Country Blocking
    # ============================================
    GEOIP_ENABLED: bool = True  # Enable geo-blocking
    GEOIP_DATABASE_PATH: str = "./data/GeoLite2-Country.mmdb"  # MaxMind database path

    # Blocked countries (ISO 3166-1 alpha-2 codes, comma-separated)
    # Default: High-risk nations commonly blocked in security-sensitive applications
    BLOCKED_COUNTRIES: str = "KP,IR,SY,CU,RU,BY"

    # IP Logging
    IP_LOGGING_ENABLED: bool = True  # Log all request IPs with geo info

    @field_validator('BLOCKED_COUNTRIES', mode='before')
    @classmethod
    def parse_blocked_countries(cls, v):
        """Parse BLOCKED_COUNTRIES - keep as string for later parsing."""
        if isinstance(v, list):
            return ",".join(v)
        return v

    def get_blocked_countries_set(self) -> set:
        """Get blocked countries as a set of ISO codes."""
        if not self.BLOCKED_COUNTRIES:
            return set()
        return {c.strip().upper() for c in self.BLOCKED_COUNTRIES.split(",") if c.strip()}

    # ============================================
    # CORS
    # ============================================
    ALLOWED_ORIGINS: Union[List[str], str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

    # Frontend URL for generating links in emails
    FRONTEND_URL: str = "http://localhost:3000"

    @field_validator('ALLOWED_ORIGINS', mode='before')
    @classmethod
    def parse_allowed_origins(cls, v):
        """Parse ALLOWED_ORIGINS from comma-separated string or list.
        Logs a warning if wildcard '*' is present (insecure with credentials)."""
        if isinstance(v, str):
            origins = [origin.strip() for origin in v.split(',') if origin.strip()]
        else:
            origins = v
        if "*" in origins:
            import logging
            logging.warning(
                "SECURITY WARNING: ALLOWED_ORIGINS contains wildcard '*'. "
                "This allows any origin to make credentialed requests."
            )
        return origins
    
    # ============================================
    # File Storage
    # ============================================
    STORAGE_TYPE: str = "local"  # local, s3, azure, gcs
    UPLOAD_DIR: str = "./uploads"
    MAX_FILE_SIZE: int = 52428800  # 50 MB
    
    # AWS S3
    AWS_ACCESS_KEY_ID: Optional[str] = None
    AWS_SECRET_ACCESS_KEY: Optional[str] = None
    AWS_REGION: str = "us-east-1"
    AWS_S3_BUCKET: Optional[str] = None
    
    # Azure Blob
    AZURE_STORAGE_ACCOUNT: Optional[str] = None
    AZURE_STORAGE_KEY: Optional[str] = None
    AZURE_STORAGE_CONTAINER: Optional[str] = None
    
    # Google Cloud Storage
    GCS_PROJECT_ID: Optional[str] = None
    GCS_BUCKET: Optional[str] = None
    GCS_CREDENTIALS_PATH: Optional[str] = None
    
    # ============================================
    # Email
    # ============================================
    EMAIL_ENABLED: bool = False
    SMTP_HOST: str = "smtp.example.com"
    SMTP_PORT: int = 587
    SMTP_USER: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None
    SMTP_FROM_EMAIL: str = "noreply@example.com"
    SMTP_FROM_NAME: str = "Intranet Platform"
    
    # ============================================
    # SMS (Twilio)
    # ============================================
    TWILIO_ENABLED: bool = False
    TWILIO_ACCOUNT_SID: Optional[str] = None
    TWILIO_AUTH_TOKEN: Optional[str] = None
    TWILIO_PHONE_NUMBER: Optional[str] = None
    
    # ============================================
    # OAuth Providers
    # ============================================
    # Microsoft / Azure AD
    AZURE_AD_ENABLED: bool = False
    AZURE_AD_TENANT_ID: Optional[str] = None
    AZURE_AD_CLIENT_ID: Optional[str] = None
    AZURE_AD_CLIENT_SECRET: Optional[str] = None
    
    # Google
    GOOGLE_OAUTH_ENABLED: bool = False
    GOOGLE_CLIENT_ID: Optional[str] = None
    GOOGLE_CLIENT_SECRET: Optional[str] = None
    
    # LDAP
    LDAP_ENABLED: bool = False
    LDAP_SERVER: Optional[str] = None
    LDAP_BIND_DN: Optional[str] = None
    LDAP_BIND_PASSWORD: Optional[str] = None
    LDAP_SEARCH_BASE: Optional[str] = None
    
    # ============================================
    # Modules
    # ============================================
    MODULE_TRAINING_ENABLED: bool = True
    MODULE_COMPLIANCE_ENABLED: bool = True
    MODULE_SCHEDULING_ENABLED: bool = True
    MODULE_INVENTORY_ENABLED: bool = True
    MODULE_MEETINGS_ENABLED: bool = True
    MODULE_ELECTIONS_ENABLED: bool = False
    MODULE_FUNDRAISING_ENABLED: bool = False
    
    # ============================================
    # Monitoring
    # ============================================
    SENTRY_ENABLED: bool = False
    SENTRY_DSN: Optional[str] = None
    
    # ============================================
    # Development
    # ============================================
    ENABLE_DOCS: bool = True  # OpenAPI/Swagger docs
    LOG_LEVEL: str = "INFO"
    LOG_FORMAT: str = "text"  # "text" for human-readable, "json" for structured JSON logging
    RATE_LIMIT_DEFAULT: str = "100/minute"


@lru_cache()
def get_settings() -> Settings:
    """
    Get cached settings instance
    """
    return Settings()


# Global settings instance
settings = get_settings()
