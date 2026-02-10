-- MySQL Initialization Settings
-- This file runs once when the database is first created
-- It sets global configuration to avoid deprecated command-line flags

-- Set host cache size to 0 (replaces --host-cache-size=0 command-line flag)
-- This is recommended by MySQL 8.0+ instead of using command-line arguments
SET GLOBAL host_cache_size=0;

-- Log that initialization completed
SELECT 'MySQL initialization settings applied successfully' AS status;
