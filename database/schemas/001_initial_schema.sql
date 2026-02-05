-- ============================================
-- The Logbook - Initial Database Schema
-- MySQL 8.0 Compatible
-- ============================================
-- This schema is automatically executed when the MySQL container
-- is first created. Alembic migrations handle subsequent updates.
--
-- IMPORTANT: This schema creates ONLY the core tables that match
-- Alembic migration 20260118_0001. Additional tables (onboarding,
-- training, elections, events, etc.) are created by subsequent
-- Alembic migrations when the backend starts.
--
-- The alembic_version is set to '20260118_0001' so Alembic knows
-- to start from the next migration (20260118_0002).
-- ============================================

-- Create database if not exists (handled by docker-compose env vars)
-- USE the_logbook;

-- ============================================
-- Core Tables (matches Alembic migration 20260118_0001)
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

-- Mark initial schema migration as applied
-- This tells Alembic to start from 20260118_0002 (the next migration)
-- The revision ID must match the first Alembic migration exactly
INSERT INTO alembic_version (version_num) VALUES ('20260118_0001') ON DUPLICATE KEY UPDATE version_num = '20260118_0001';
