-- ============================================
-- The Logbook - Initial Database Schema
-- MySQL 8.0 Compatible
-- ============================================
-- This script runs once when the MySQL container is first created.
--
-- It ONLY creates the alembic_version tracking table and stamps it
-- to the initial revision. The backend's fast-path initialization
-- then creates all application tables from SQLAlchemy model
-- definitions in a single batch (seconds), which is much faster
-- than creating tables here and having them immediately dropped
-- and recreated.
--
-- The alembic_version stamp tells the backend to use fast-path
-- initialization instead of running 39+ individual migrations.
-- ============================================

-- ============================================
-- Alembic Version Tracking
-- ============================================

CREATE TABLE IF NOT EXISTS alembic_version (
    version_num VARCHAR(32) NOT NULL,
    PRIMARY KEY (version_num)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Stamp to initial revision so the backend knows this is a fresh database.
-- The backend will detect this and use fast-path initialization.
INSERT INTO alembic_version (version_num) VALUES ('20260118_0001') ON DUPLICATE KEY UPDATE version_num = '20260118_0001';
