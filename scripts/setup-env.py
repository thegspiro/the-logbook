#!/usr/bin/env python3
"""
The Logbook - Environment Configuration Setup Script

This script helps you generate a secure .env file with all required secrets.

Usage:
    python3 scripts/setup-env.py

Options:
    --unraid    Generate configuration optimized for Unraid deployment
    --help      Show this help message
"""

import secrets
import sys
import os
from pathlib import Path


def generate_secret_key():
    """Generate a secure SECRET_KEY (64 bytes URL-safe)"""
    return secrets.token_urlsafe(64)


def generate_encryption_key():
    """Generate a secure ENCRYPTION_KEY (32 bytes hex)"""
    return secrets.token_hex(32)


def generate_encryption_salt():
    """Generate a secure ENCRYPTION_SALT (16 bytes hex)"""
    return secrets.token_hex(16)


def generate_password(length=32):
    """Generate a secure password"""
    return secrets.token_urlsafe(length)


def get_user_input(prompt, default=None, required=True):
    """Get user input with optional default"""
    if default:
        prompt = f"{prompt} [{default}]: "
    else:
        prompt = f"{prompt}: "

    while True:
        value = input(prompt).strip()
        if value:
            return value
        elif default:
            return default
        elif not required:
            return ""
        else:
            print("This field is required. Please enter a value.")


def main():
    """Main setup function"""
    print("=" * 60)
    print("  THE LOGBOOK - Environment Configuration Setup")
    print("=" * 60)
    print()

    # Check if running with --unraid flag
    is_unraid = "--unraid" in sys.argv

    if "--help" in sys.argv:
        print(__doc__)
        sys.exit(0)

    # Determine if we're in Unraid mode
    if is_unraid:
        print("🚀 Generating Unraid-optimized configuration...")
        env_file = Path("unraid/.env")
        example_file = Path("unraid/.env.example")
    else:
        print("🚀 Generating standard configuration...")
        env_file = Path(".env")
        example_file = Path(".env.example")

    # Check if .env already exists
    if env_file.exists():
        response = get_user_input(
            f"\n⚠️  {env_file} already exists. Overwrite? (yes/no)",
            default="no",
            required=True
        )
        if response.lower() not in ["yes", "y"]:
            print("\n❌ Setup cancelled. Existing .env file preserved.")
            sys.exit(0)

    print("\n📝 This wizard will help you configure The Logbook.")
    print("   Press Enter to use default values shown in brackets.\n")

    # Generate all secrets
    print("🔐 Generating secure secrets...")
    config = {
        "SECRET_KEY": generate_secret_key(),
        "ENCRYPTION_KEY": generate_encryption_key(),
        "ENCRYPTION_SALT": generate_encryption_salt(),
        "MYSQL_ROOT_PASSWORD": generate_password(),
        "DB_PASSWORD": generate_password(),
        "REDIS_PASSWORD": generate_password(),
    }
    print("   ✓ Security keys generated\n")

    # Basic configuration
    print("📋 Application Settings:")
    config["APP_NAME"] = get_user_input("Application name", default="The Logbook")
    config["ENVIRONMENT"] = get_user_input(
        "Environment (development/staging/production)",
        default="production" if is_unraid else "development"
    )
    config["DEBUG"] = "false" if config["ENVIRONMENT"] == "production" else "true"
    print()

    # Database configuration
    print("🗄️  Database Settings:")
    config["DB_NAME"] = get_user_input("Database name", default="the_logbook")
    config["DB_USER"] = get_user_input("Database user", default="logbook_user")
    config["DB_HOST"] = get_user_input(
        "Database host",
        default="db" if is_unraid else "localhost"
    )
    config["DB_PORT"] = get_user_input("Database port", default="3306")
    print()

    # Redis configuration
    print("📦 Redis Settings:")
    config["REDIS_HOST"] = get_user_input(
        "Redis host",
        default="redis" if is_unraid else "localhost"
    )
    config["REDIS_PORT"] = get_user_input("Redis port", default="6379")
    print()

    # Network configuration
    print("🌐 Network Settings:")
    if is_unraid:
        print("   Enter your Unraid server IP address (e.g., 192.168.1.10)")
        unraid_ip = get_user_input("Unraid IP address", required=True)
        config["ALLOWED_ORIGINS"] = f"http://{unraid_ip}:7880"
        config["FRONTEND_PORT"] = "7880"
        config["BACKEND_PORT"] = "7881"
        config["PUID"] = get_user_input("User ID (PUID)", default="99")
        config["PGID"] = get_user_input("Group ID (PGID)", default="100")
    else:
        origins = get_user_input(
            "Allowed origins (comma-separated)",
            default="http://localhost:3000,http://127.0.0.1:3000"
        )
        config["ALLOWED_ORIGINS"] = origins
        config["FRONTEND_PORT"] = get_user_input("Frontend port", default="3000")
        config["BACKEND_PORT"] = get_user_input("Backend port", default="3001")
    print()

    # Timezone
    print("🕐 Timezone:")
    config["TZ"] = get_user_input("Timezone", default="America/New_York")
    print()

    # Modules
    print("🔧 Modules (true/false):")
    config["MODULE_TRAINING_ENABLED"] = get_user_input(
        "Enable Training module",
        default="true"
    )
    config["MODULE_COMPLIANCE_ENABLED"] = get_user_input(
        "Enable Compliance module",
        default="true"
    )
    config["MODULE_SCHEDULING_ENABLED"] = get_user_input(
        "Enable Scheduling module",
        default="true"
    )
    config["MODULE_ELECTIONS_ENABLED"] = get_user_input(
        "Enable Elections module",
        default="true"
    )
    print()

    # Email configuration
    print("📧 Email Configuration (optional):")
    email_enabled = get_user_input(
        "Enable email notifications? (yes/no)",
        default="no"
    )
    config["EMAIL_ENABLED"] = "true" if email_enabled.lower() in ["yes", "y"] else "false"

    if config["EMAIL_ENABLED"] == "true":
        config["SMTP_HOST"] = get_user_input("SMTP host", default="smtp.gmail.com")
        config["SMTP_PORT"] = get_user_input("SMTP port", default="587")
        config["SMTP_USER"] = get_user_input("SMTP username/email", required=True)
        config["SMTP_PASSWORD"] = get_user_input("SMTP password", required=True)
        config["SMTP_FROM_EMAIL"] = get_user_input(
            "From email address",
            default=config["SMTP_USER"]
        )
    else:
        config["SMTP_HOST"] = "smtp.gmail.com"
        config["SMTP_PORT"] = "587"
        config["SMTP_USER"] = ""
        config["SMTP_PASSWORD"] = ""
        config["SMTP_FROM_EMAIL"] = "noreply@example.com"
    print()

    # Backup configuration
    print("💾 Backup Settings:")
    config["BACKUP_ENABLED"] = get_user_input(
        "Enable automatic backups? (true/false)",
        default="true"
    )
    config["BACKUP_SCHEDULE"] = get_user_input(
        "Backup schedule (cron format)",
        default="0 2 * * *"
    )
    config["BACKUP_RETENTION_DAYS"] = get_user_input(
        "Backup retention days",
        default="30"
    )
    print()

    # Monitoring
    print("📊 Monitoring:")
    config["LOG_LEVEL"] = get_user_input(
        "Log level (DEBUG/INFO/WARNING/ERROR/CRITICAL)",
        default="INFO"
    )
    config["ENABLE_DOCS"] = get_user_input(
        "Enable API documentation? (true/false)",
        default="true"
    )
    print()

    # Write configuration file
    print("💾 Writing configuration file...")

    # Read the template
    if not example_file.exists():
        print(f"❌ Error: {example_file} not found!")
        sys.exit(1)

    template = example_file.read_text()

    # Replace placeholders
    output = template
    for key, value in config.items():
        # Handle different placeholder formats
        placeholders = [
            f"{key}=CHANGE_ME",
            f"{key}=change_me",
            f"{key}=your-",
            f"{key}=",
        ]

        for placeholder in placeholders:
            if placeholder in output:
                # Find the line and replace just the value part
                lines = output.split('\n')
                new_lines = []
                for line in lines:
                    if line.startswith(key + "=") and not line.startswith("#"):
                        new_lines.append(f"{key}={value}")
                    else:
                        new_lines.append(line)
                output = '\n'.join(new_lines)
                break

    # Write the file
    env_file.parent.mkdir(parents=True, exist_ok=True)
    env_file.write_text(output)

    print(f"   ✓ Configuration written to {env_file}\n")

    # Summary
    print("=" * 60)
    print("✅ Setup Complete!")
    print("=" * 60)
    print()
    print("🔐 Important Security Notes:")
    print("   • Your secrets have been generated securely")
    print("   • Never commit .env files to version control")
    print("   • Keep your .env file secure and backed up separately")
    print("   • Rotate secrets regularly (every 90 days recommended)")
    print()
    print("🚀 Next Steps:")
    print()
    if is_unraid:
        print("   1. Review your configuration:")
        print(f"      nano {env_file}")
        print()
        print("   2. Start the application:")
        print("      cd /mnt/user/appdata/the-logbook")
        print("      docker-compose up -d")
        print()
        print("   3. Check the logs:")
        print("      docker-compose logs -f")
        print()
        print("   4. Access the application:")
        print(f"      http://{config.get('ALLOWED_ORIGINS', 'YOUR-IP').split(':')[1].replace('//', '')}:7880")
    else:
        print("   1. Review your configuration:")
        print(f"      cat {env_file}")
        print()
        print("   2. Start the application:")
        print("      docker-compose up -d")
        print()
        print("   3. Check the logs:")
        print("      docker-compose logs -f")
        print()
        print("   4. Access the application:")
        print("      http://localhost:3000")
    print()
    print("📖 For more information:")
    print("   • Documentation: README.md")
    print("   • All config options: .env.example.full")
    print("   • Unraid guide: unraid/UNRAID-INSTALLATION.md")
    print()
    print("=" * 60)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n❌ Setup cancelled by user.")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n❌ Error: {e}")
        sys.exit(1)
