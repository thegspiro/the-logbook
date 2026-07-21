"""
Application Configuration

Uses pydantic-settings for environment variable management
with type validation and defaults.
"""

from functools import lru_cache

from loguru import logger
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


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
    DB_PASSWORD: str = ""
    DB_SSL: bool = False
    # Path to CA certificate for verifying MySQL server identity over TLS.
    # Required when DB_SSL=True for full MITM protection.
    DB_SSL_CA: str = ""
    DB_POOL_MIN: int = 2
    DB_POOL_MAX: int = 10
    DB_ECHO: bool = False  # SQL logging
    DB_CHARSET: str = "utf8mb4"  # Use utf8mb4 for full Unicode support
    DB_CONNECT_TIMEOUT: int = 30  # Connection timeout in seconds
    DB_CONNECT_RETRIES: int = (
        40  # Number of connection retry attempts (supports ~10min cold MySQL init)
    )
    DB_CONNECT_RETRY_DELAY: int = (
        2  # Initial delay between retries (exponential backoff) - optimized for faster startup
    )
    DB_CONNECT_RETRY_MAX_DELAY: int = (
        15  # Maximum delay between retries (caps exponential backoff) - optimized for faster startup
    )

    @property
    def DATABASE_URL(self) -> str:
        """Construct async MySQL database URL"""
        return f"mysql+aiomysql://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}?charset={self.DB_CHARSET}"

    @property
    def SYNC_DATABASE_URL(self) -> str:
        """Construct synchronous MySQL database URL (for Alembic)"""
        return f"mysql+pymysql://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}?charset={self.DB_CHARSET}"

    def get_db_connect_args(self) -> dict:
        """Build connect_args dict including SSL context when DB_SSL is enabled.

        SEC: When DB_SSL=True, all traffic between the application and MySQL
        is encrypted.  If DB_SSL_CA is also set, the server certificate is
        verified against that CA (full MITM protection).  Without a CA the
        connection is still encrypted but the server identity is not verified
        (equivalent to MySQL ssl-mode=REQUIRED).
        """
        args: dict = {
            "connect_timeout": self.DB_CONNECT_TIMEOUT,
        }
        if self.DB_SSL:
            import ssl

            ssl_ctx = ssl.create_default_context(
                cafile=self.DB_SSL_CA if self.DB_SSL_CA else None,
            )
            if not self.DB_SSL_CA:
                # Encrypt traffic but don't verify server certificate.
                # For full MITM protection, set DB_SSL_CA.
                ssl_ctx.check_hostname = False
                ssl_ctx.verify_mode = ssl.CERT_NONE
            args["ssl"] = ssl_ctx
        return args

    # ============================================
    # Redis
    # ============================================
    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_PASSWORD: str | None = None
    REDIS_DB: int = 0
    REDIS_SSL: bool = False  # Use TLS for Redis connections (rediss:// scheme)
    REDIS_SSL_CA: str = ""  # Path to CA cert for Redis TLS verification
    REDIS_TTL: int = 3600  # Default cache TTL in seconds
    REDIS_CONNECT_TIMEOUT: int = 5  # Connection timeout in seconds
    REDIS_CONNECT_RETRIES: int = 3  # Number of connection retry attempts
    REDIS_REQUIRED: bool = False  # If False, app starts even if Redis fails

    @property
    def REDIS_URL(self) -> str:
        """Construct Redis URL.

        SEC: When REDIS_SSL=True, uses the ``rediss://`` scheme so all
        traffic between the application and Redis is encrypted.
        """
        scheme = "rediss" if self.REDIS_SSL else "redis"
        if self.REDIS_PASSWORD:
            return f"{scheme}://:{self.REDIS_PASSWORD}@{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"
        return f"{scheme}://{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"

    # ============================================
    # Security
    # ============================================
    # CRITICAL: These MUST be set via environment variables.
    # Empty defaults force configuration — the app will refuse to start
    # until these are explicitly set (validated in validate_security_config).
    SECRET_KEY: str = ""
    # SEC: Only HS256 is accepted by decode_token(). Do not change without
    # updating the hardcoded allowlist in security.py:decode_token().
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = (
        30  # Short-lived access tokens (use refresh flow)
    )
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    # Grace window during which a just-rotated refresh token is still accepted,
    # so concurrent legitimate refreshes don't trip replay detection. Keep short.
    REFRESH_ROTATION_GRACE_SECONDS: int = 30

    # Password Policy
    PASSWORD_MIN_LENGTH: int = 12
    PASSWORD_MAX_LENGTH: int = 128  # Prevent Argon2 DoS with very long inputs
    PASSWORD_REQUIRE_UPPERCASE: bool = True
    PASSWORD_REQUIRE_LOWERCASE: bool = True
    PASSWORD_REQUIRE_NUMBERS: bool = True
    PASSWORD_REQUIRE_SPECIAL: bool = True

    # HIPAA-Related Security Settings (§164.312)
    HIPAA_SESSION_TIMEOUT_MINUTES: int = (
        15  # Automatic logoff after inactivity (§164.312(a)(2)(iii))
    )
    HIPAA_PASSWORD_HISTORY_COUNT: int = (
        12  # Previous passwords remembered (§164.312(d))
    )
    HIPAA_MINIMUM_PASSWORD_AGE_DAYS: int = (
        1  # Min days before password can be changed again
    )
    HIPAA_MAXIMUM_PASSWORD_AGE_DAYS: int = (
        90  # Max days before password must be changed
    )
    HIPAA_AUDIT_RETENTION_DAYS: int = 2555  # 7-year audit log retention (§164.312(b))

    # Account lockout after repeated failed sign-ins (brute-force protection).
    # Tunable so small, trusted deployments can run a gentler policy. (These
    # names were already documented in .env.example.full but not wired up; the
    # thresholds used to be hardcoded 5/30 in auth_service.)
    MAX_LOGIN_ATTEMPTS: int = 5  # Consecutive failures before locking
    ACCOUNT_LOCKOUT_DURATION_MINUTES: int = 15  # How long the account stays locked
    # When True, a locked-out sign-in is told the account is temporarily locked
    # (and roughly how much longer) instead of the generic "incorrect username
    # or password". Friendlier — it stops users hammering a disguised lock — but
    # it confirms the account exists. Set False for strict anti-enumeration
    # (SEC-14) on internet-facing deployments.
    # Default False (strict anti-enumeration): a locked account returns the same
    # generic "incorrect username or password" as a wrong password, never
    # confirming the account exists. Set True to instead tell users about the
    # temporary lock (friendlier, but reveals account existence — SEC-14).
    ACCOUNT_LOCKOUT_REVEAL: bool = False

    # Vote signing key — used for HMAC-SHA256 vote integrity signatures.
    # Falls back to SECRET_KEY if not set.  A dedicated key is recommended so
    # that rotating SECRET_KEY does not invalidate existing vote signatures.
    VOTE_SIGNING_KEY: str = ""

    # Audit-log signing key — keys the HMAC-SHA256 tamper-evidence hash chain.
    # Falls back to SECRET_KEY if not set. A DEDICATED key stored outside the
    # application database is strongly recommended: it means an attacker who can
    # only write audit rows (SQL access) cannot forge a valid chain, since they
    # do not possess the key. Store it in a secrets manager / HSM, not the DB.
    AUDIT_LOG_SIGNING_KEY: str = ""

    # Encryption - CRITICAL: Must be set via ENCRYPTION_KEY env var
    ENCRYPTION_KEY: str = ""

    # Installation-specific salt for key derivation
    # CRITICAL: Must be unique per installation, set via ENCRYPTION_SALT env var
    ENCRYPTION_SALT: str = ""

    # Registration control
    REGISTRATION_ENABLED: bool = False  # Disabled by default; admins create users
    REGISTRATION_REQUIRES_APPROVAL: bool = (
        True  # New registrations require admin approval
    )

    # Rate Limiting
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_PER_MINUTE: int = 60
    # Per-form/day ceiling on unauthenticated public form submissions (bounds
    # DB flooding and integration/email abuse from a distributed spam flood).
    # 0 disables the cap.
    PUBLIC_FORM_DAILY_LIMIT: int = 500

    # Trusted proxy IPs for X-Forwarded-For validation
    TRUSTED_PROXY_IPS: str = ""  # Comma-separated list of trusted proxy IPs

    # Security enforcement
    # SEC: HTTPS enforcement is checked at validation time (see below).
    # Defaults to False for local development; production/staging validation
    # will warn if not enabled.
    SECURITY_ENFORCE_HTTPS: bool = False  # Set to True in production
    # SEC: Explicit override for the Secure flag on auth cookies.
    # None = auto-detect (Secure=False only for localhost development).
    # Set to False for LAN deployments served over plain HTTP.
    COOKIE_SECURE: bool | None = None
    # SEC: When True, blocks startup in ANY environment if critical security
    # issues are detected (missing secrets, etc.).  Production and staging
    # ALWAYS block regardless of this flag.  Set to False for local dev only.
    SECURITY_BLOCK_INSECURE_DEFAULTS: bool = False

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

        # SEC: Reject weak or dangerous JWT algorithms
        _dangerous_algorithms = {"none", "None", "NONE", ""}
        if self.ALGORITHM in _dangerous_algorithms:
            warnings.append(
                "CRITICAL: ALGORITHM is set to a dangerous value "
                f"({self.ALGORITHM!r}). Only 'HS256' is supported."
            )

        _insecure_patterns = ("INSECURE_DEFAULT", "CHANGE_ME", "change_me")

        if (
            not self.SECRET_KEY
            or any(p in self.SECRET_KEY for p in _insecure_patterns)
            or len(self.SECRET_KEY) < 32
        ):
            warnings.append(
                "CRITICAL: SECRET_KEY must be set to a secure random value (min 32 chars). "
                'Generate one with: python3 -c "import secrets; print(secrets.token_urlsafe(64))"'
            )

        if (
            not self.ENCRYPTION_KEY
            or any(p in self.ENCRYPTION_KEY for p in _insecure_patterns)
            or len(self.ENCRYPTION_KEY) < 32
        ):
            warnings.append(
                "CRITICAL: ENCRYPTION_KEY must be set to a secure random value "
                "(min 32 chars). "
                'Generate one with: python3 -c "import secrets; print(secrets.token_hex(32))"'
            )

        if not self.ENCRYPTION_SALT:
            warnings.append(
                "CRITICAL: ENCRYPTION_SALT must be set to a unique random value. "
                'Generate one with: python3 -c "import secrets; print(secrets.token_hex(16))"'
            )

        if not self.DB_PASSWORD or any(
            p in self.DB_PASSWORD for p in _insecure_patterns
        ):
            warnings.append(
                "CRITICAL: DB_PASSWORD must be set to a secure value. "
                "Set it via the DB_PASSWORD environment variable."
            )

        # --- Additional production/staging checks ---
        if self.ENVIRONMENT in ("production", "staging"):
            if not self.REDIS_PASSWORD:
                warnings.append("CRITICAL: REDIS_PASSWORD must be set in production")

            if not self.DB_SSL:
                warnings.append(
                    "WARNING: DB_SSL should be enabled in production to encrypt "
                    "database traffic and prevent man-in-the-middle attacks"
                )

            if not self.REDIS_SSL:
                warnings.append(
                    "WARNING: REDIS_SSL should be enabled in production to encrypt "
                    "Redis traffic and prevent man-in-the-middle attacks"
                )

            if self.DEBUG:
                warnings.append(
                    "CRITICAL: DEBUG mode must be disabled in production — it can "
                    "expose stack traces and internal details to clients"
                )

            if self.DB_ECHO:
                warnings.append(
                    "CRITICAL: DB_ECHO must be False in production — SQL logging "
                    "can expose PII/PHI in query parameters to log aggregators"
                )

            if self.ENABLE_DOCS:
                warnings.append(
                    "CRITICAL: API documentation (ENABLE_DOCS) must be disabled in "
                    "production — /docs, /redoc, and /openapi.json expose the full "
                    "API surface for enumeration"
                )

            if not self.VOTE_SIGNING_KEY:
                warnings.append(
                    "WARNING: VOTE_SIGNING_KEY should be set for any organization "
                    "using the elections module. Without it, vote signatures use "
                    "SECRET_KEY and will be invalidated if SECRET_KEY is rotated."
                )

            if not self.SECURITY_ENFORCE_HTTPS:
                warnings.append(
                    "CRITICAL: SECURITY_ENFORCE_HTTPS must be True in production "
                    "to prevent cookies and credentials from being sent over HTTP"
                )

        return warnings

    def validate_cors_config(self) -> list[str]:
        """
        Validate CORS configuration for security issues.
        Returns list of CORS-related warnings.
        """
        warnings = []
        origins = (
            self.ALLOWED_ORIGINS
            if isinstance(self.ALLOWED_ORIGINS, list)
            else [self.ALLOWED_ORIGINS]
        )
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

    @field_validator("BLOCKED_COUNTRIES", mode="before")
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
        return {
            c.strip().upper() for c in self.BLOCKED_COUNTRIES.split(",") if c.strip()
        }

    # ============================================
    # CORS
    # ============================================
    ALLOWED_ORIGINS: list[str] | str = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

    # Frontend URL for generating links in emails
    FRONTEND_URL: str = "http://localhost:3000"

    @field_validator("ALLOWED_ORIGINS", mode="before")
    @classmethod
    def parse_allowed_origins(cls, v):
        """Parse ALLOWED_ORIGINS from comma-separated string or list.
        Logs a warning if wildcard '*' is present (insecure with credentials)."""
        if isinstance(v, str):
            origins = [origin.strip() for origin in v.split(",") if origin.strip()]
        else:
            origins = v
        if "*" in origins:
            logger.warning(
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

    # Hard ceiling on any request body, enforced at the ASGI edge before the
    # body is buffered into memory (memory-exhaustion DoS backstop, independent
    # of nginx's client_max_body_size). Sized above MAX_FILE_SIZE to leave room
    # for multipart-upload envelope overhead.
    MAX_REQUEST_BODY_SIZE: int = 62914560  # 60 MB

    # AWS S3
    AWS_ACCESS_KEY_ID: str | None = None
    AWS_SECRET_ACCESS_KEY: str | None = None
    AWS_REGION: str = "us-east-1"
    AWS_S3_BUCKET: str | None = None

    # Azure Blob
    AZURE_STORAGE_ACCOUNT: str | None = None
    AZURE_STORAGE_KEY: str | None = None
    AZURE_STORAGE_CONTAINER: str | None = None

    # Google Cloud Storage
    GCS_PROJECT_ID: str | None = None
    GCS_BUCKET: str | None = None
    GCS_CREDENTIALS_PATH: str | None = None

    # ============================================
    # Email
    # ============================================
    EMAIL_ENABLED: bool = False
    SMTP_HOST: str = "smtp.example.com"
    SMTP_PORT: int = 587
    SMTP_USER: str | None = None
    SMTP_PASSWORD: str | None = None
    SMTP_FROM_EMAIL: str = "noreply@example.com"
    SMTP_FROM_NAME: str = "Intranet Platform"
    SMTP_ENCRYPTION: str = "tls"  # tls (STARTTLS/587), ssl (465), none (25)
    SMTP_EHLO_HOSTNAME: str | None = (
        None  # EHLO hostname; defaults to from_email domain
    )

    # Cloudflare Email Service (alternative to SMTP)
    CLOUDFLARE_EMAIL_ENABLED: bool = False
    CLOUDFLARE_ACCOUNT_ID: str | None = None
    CLOUDFLARE_API_TOKEN: str | None = None

    # ============================================
    # SMS (Twilio)
    # ============================================
    TWILIO_ENABLED: bool = False
    TWILIO_ACCOUNT_SID: str | None = None
    TWILIO_AUTH_TOKEN: str | None = None
    TWILIO_PHONE_NUMBER: str | None = None

    # ============================================
    # OAuth Providers
    # ============================================
    # Microsoft / Azure AD
    AZURE_AD_ENABLED: bool = False
    # Single-tenant: the directory (tenant) GUID. Used in the authority URL and
    # enforced against the ID token's `tid` claim so only this org can sign in.
    AZURE_AD_TENANT_ID: str | None = None
    AZURE_AD_CLIENT_ID: str | None = None
    AZURE_AD_CLIENT_SECRET: str | None = None
    # Absolute URL Azure redirects back to. Must exactly match a redirect URI
    # registered on the app in the Azure portal, e.g.
    # https://app.example.org/api/v1/auth/oauth/microsoft/callback
    AZURE_AD_REDIRECT_URI: str | None = None
    # Comma-separated allowed email domains (empty = any account in the tenant,
    # still subject to an existing local user matching the email).
    AZURE_AD_ALLOWED_DOMAINS: str = ""

    # Google
    GOOGLE_OAUTH_ENABLED: bool = False
    GOOGLE_CLIENT_ID: str | None = None
    GOOGLE_CLIENT_SECRET: str | None = None
    # Absolute URL Google redirects back to after consent. Must exactly match an
    # "Authorized redirect URI" in the Google Cloud console, e.g.
    # https://app.example.org/api/v1/auth/oauth/google/callback
    GOOGLE_REDIRECT_URI: str | None = None
    # Comma-separated list of allowed Google email domains (e.g.
    # "yourdept.org,county.gov"). Empty = allow any Google account (still
    # subject to an existing local user matching the email).
    GOOGLE_ALLOWED_DOMAINS: str = ""
    # Relative SPA paths the OAuth callback redirects to. Success lands on a
    # lightweight page that establishes the session; failure returns to login.
    OAUTH_SUCCESS_REDIRECT: str = "/auth/callback"
    OAUTH_FAILURE_REDIRECT: str = "/login"

    # Salesforce Connected App (deployment-wide fallback). Each org may instead
    # supply its own client_id/client_secret on the integration; those take
    # precedence. Used by the "Connect Salesforce" authorization-code flow.
    SALESFORCE_CLIENT_ID: str | None = None
    SALESFORCE_CLIENT_SECRET: str | None = None
    # Absolute URL Salesforce redirects back to after consent. Must exactly
    # match a Callback URL on the Connected App, e.g.
    # https://app.example.org/api/v1/integrations/salesforce/oauth/callback
    # Leave unset to derive it from the incoming request's base URL.
    SALESFORCE_OAUTH_REDIRECT_URI: str | None = None

    def get_google_allowed_domains(self) -> set[str]:
        """Allowed Google email domains as a lowercased set (empty = any)."""
        if not self.GOOGLE_ALLOWED_DOMAINS:
            return set()
        return {
            d.strip().lower()
            for d in self.GOOGLE_ALLOWED_DOMAINS.split(",")
            if d.strip()
        }

    def get_azure_ad_allowed_domains(self) -> set[str]:
        """Allowed Azure AD email domains as a lowercased set (empty = any)."""
        if not self.AZURE_AD_ALLOWED_DOMAINS:
            return set()
        return {
            d.strip().lower()
            for d in self.AZURE_AD_ALLOWED_DOMAINS.split(",")
            if d.strip()
        }

    # LDAP
    LDAP_ENABLED: bool = False
    LDAP_SERVER: str | None = None
    LDAP_BIND_DN: str | None = None
    LDAP_BIND_PASSWORD: str | None = None
    LDAP_SEARCH_BASE: str | None = None

    # ============================================
    # Monitoring
    # ============================================
    SENTRY_ENABLED: bool = False
    SENTRY_DSN: str | None = None

    # ============================================
    # Development
    # ============================================
    # OpenAPI/Swagger docs. On by default for development convenience, but
    # enabling them in production is a CRITICAL misconfiguration that blocks
    # startup (they expose the full API surface). Production must set
    # ENABLE_DOCS=false (the production compose override does this).
    ENABLE_DOCS: bool = True
    LOG_LEVEL: str = "INFO"
    LOG_FORMAT: str = (
        "text"  # "text" for human-readable, "json" for structured JSON logging
    )
    RATE_LIMIT_DEFAULT: str = "100/minute"

    def __repr__(self) -> str:
        """
        SEC: Override __repr__ to mask secrets so they never appear in logs,
        tracebacks, or debug output. Only non-sensitive fields are shown.
        """
        return (
            f"Settings(ENVIRONMENT={self.ENVIRONMENT!r}, "
            f"APP_NAME={self.APP_NAME!r}, "
            f"DB_HOST={self.DB_HOST!r}, "
            f"DB_NAME={self.DB_NAME!r}, "
            f"DB_USER={self.DB_USER!r}, "
            f"DB_PASSWORD='****', "
            f"SECRET_KEY='****', "
            f"ENCRYPTION_KEY='****', "
            f"REDIS_HOST={self.REDIS_HOST!r}, "
            f"REDIS_PASSWORD='****')"
        )

    def __str__(self) -> str:
        return self.__repr__()


@lru_cache
def get_settings() -> Settings:
    """
    Get cached settings instance
    """
    return Settings()


# Global settings instance
settings = get_settings()
