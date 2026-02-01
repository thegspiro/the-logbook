-- ============================================
-- The Logbook - Initial Database Schema
-- MySQL 8.0 Compatible
-- ============================================
-- This schema is automatically executed when the MySQL container
-- is first created. Alembic migrations handle subsequent updates.
-- ============================================

-- Create database if not exists (handled by docker-compose env vars)
-- USE the_logbook;

-- ============================================
-- Onboarding Tables (needed for first-time setup)
-- ============================================

CREATE TABLE IF NOT EXISTS onboarding_status (
    id VARCHAR(36) PRIMARY KEY,
    is_completed BOOLEAN NOT NULL DEFAULT FALSE,
    completed_at DATETIME(6),
    steps_completed JSON,
    current_step INT DEFAULT 0,
    organization_name VARCHAR(255),
    organization_type VARCHAR(50),
    admin_email VARCHAR(255),
    admin_username VARCHAR(100),
    security_keys_verified BOOLEAN DEFAULT FALSE,
    database_verified BOOLEAN DEFAULT FALSE,
    email_configured BOOLEAN DEFAULT FALSE,
    enabled_modules JSON,
    timezone VARCHAR(50) DEFAULT 'America/New_York',
    setup_started_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    setup_ip_address VARCHAR(45),
    setup_user_agent TEXT,
    setup_notes TEXT,
    created_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS onboarding_checklist (
    id VARCHAR(36) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(50),
    priority VARCHAR(20),
    is_completed BOOLEAN DEFAULT FALSE,
    completed_at DATETIME(6),
    completed_by VARCHAR(36),
    documentation_link TEXT,
    estimated_time_minutes INT,
    sort_order INT DEFAULT 0,
    created_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS onboarding_sessions (
    id VARCHAR(36) PRIMARY KEY,
    session_id VARCHAR(64) NOT NULL UNIQUE,
    data JSON NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    user_agent TEXT,
    expires_at DATETIME(6) NOT NULL,
    created_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    INDEX idx_session_id (session_id),
    INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- Core Tables
-- ============================================

CREATE TABLE IF NOT EXISTS organizations (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    type VARCHAR(50) DEFAULT 'fire_department',
    settings JSON,
    active BOOLEAN DEFAULT TRUE,
    created_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    INDEX idx_org_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    username VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    badge_number VARCHAR(50),
    phone VARCHAR(20),
    mobile VARCHAR(20),
    photo_url TEXT,
    date_of_birth DATE,
    hire_date DATE,
    status ENUM('active', 'inactive', 'suspended', 'probationary', 'retired') DEFAULT 'active',
    email_verified BOOLEAN DEFAULT FALSE,
    email_verified_at DATETIME(6),
    mfa_enabled BOOLEAN DEFAULT FALSE,
    mfa_secret VARCHAR(32),
    mfa_backup_codes JSON,
    password_changed_at DATETIME(6),
    failed_login_attempts INT DEFAULT 0,
    locked_until DATETIME(6),
    last_login_at DATETIME(6),
    created_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    deleted_at DATETIME(6),
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    INDEX idx_user_org_id (organization_id),
    INDEX idx_user_email (email),
    INDEX idx_user_status (status),
    UNIQUE INDEX idx_user_org_username (organization_id, username),
    UNIQUE INDEX idx_user_org_email (organization_id, email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS roles (
    id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(36) NOT NULL,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    description TEXT,
    permissions JSON,
    is_system BOOLEAN DEFAULT FALSE,
    priority INT DEFAULT 0,
    created_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    INDEX idx_role_org_id (organization_id),
    UNIQUE INDEX idx_role_org_slug (organization_id, slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_roles (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    role_id VARCHAR(36) NOT NULL,
    assigned_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    assigned_by VARCHAR(36),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY (assigned_by) REFERENCES users(id),
    UNIQUE INDEX idx_user_role (user_id, role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    token TEXT NOT NULL,
    refresh_token TEXT,
    ip_address VARCHAR(45),
    user_agent TEXT,
    device_info JSON,
    geo_location JSON,
    expires_at DATETIME(6) NOT NULL,
    created_at DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    last_activity DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_session_user_id (user_id),
    INDEX idx_session_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- Audit Logging Tables
-- ============================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    timestamp DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    timestamp_nanos BIGINT NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    event_category VARCHAR(50) NOT NULL,
    severity ENUM('info', 'warning', 'critical') NOT NULL,
    user_id VARCHAR(36),
    username VARCHAR(255),
    session_id VARCHAR(36),
    ip_address VARCHAR(45),
    user_agent TEXT,
    geo_location JSON,
    event_data JSON NOT NULL,
    sensitive_data_encrypted TEXT,
    previous_hash VARCHAR(64) NOT NULL,
    current_hash VARCHAR(64) NOT NULL,
    server_id VARCHAR(100),
    process_id INT,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    INDEX idx_audit_timestamp (timestamp),
    INDEX idx_audit_user_id (user_id),
    INDEX idx_audit_event_type (event_type),
    INDEX idx_audit_current_hash (current_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_log_checkpoints (
    id INT PRIMARY KEY AUTO_INCREMENT,
    checkpoint_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    first_log_id BIGINT NOT NULL,
    last_log_id BIGINT NOT NULL,
    merkle_root VARCHAR(64) NOT NULL,
    checkpoint_hash VARCHAR(64) NOT NULL,
    signature TEXT,
    total_entries INT NOT NULL,
    verified_at DATETIME(6),
    verification_status VARCHAR(20),
    verification_details JSON,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    INDEX idx_checkpoint_time (checkpoint_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- Alembic Version Tracking
-- ============================================

CREATE TABLE IF NOT EXISTS alembic_version (
    version_num VARCHAR(32) NOT NULL,
    PRIMARY KEY (version_num)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Mark initial schema as applied (skip Alembic migrations for base tables)
-- This prevents Alembic from trying to recreate tables that already exist
INSERT INTO alembic_version (version_num) VALUES ('0001') ON DUPLICATE KEY UPDATE version_num = '0001';
