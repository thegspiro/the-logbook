"""
Application Configuration

Uses pydantic-settings for environment variable management
with type validation and defaults.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List, Optional
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
    
    @property
    def REDIS_URL(self) -> str:
        """Construct Redis URL"""
        if self.REDIS_PASSWORD:
            return f"redis://:{self.REDIS_PASSWORD}@{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"
    
    # ============================================
    # Security
    # ============================================
    SECRET_KEY: str = "change_me_to_random_64_character_string"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480  # 8 hours
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    
    # Password Policy
    PASSWORD_MIN_LENGTH: int = 12
    PASSWORD_REQUIRE_UPPERCASE: bool = True
    PASSWORD_REQUIRE_LOWERCASE: bool = True
    PASSWORD_REQUIRE_NUMBERS: bool = True
    PASSWORD_REQUIRE_SPECIAL: bool = True
    
    # Encryption
    ENCRYPTION_KEY: str = "change_me_to_32_byte_hex_string"
    
    # Rate Limiting
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_PER_MINUTE: int = 60
    
    # ============================================
    # CORS
    # ============================================
    ALLOWED_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]
    
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


@lru_cache()
def get_settings() -> Settings:
    """
    Get cached settings instance
    """
    return Settings()


# Global settings instance
settings = get_settings()
