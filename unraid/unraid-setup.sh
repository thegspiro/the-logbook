#!/bin/bash
# ============================================
# THE LOGBOOK - UNRAID AUTOMATIC SETUP SCRIPT
# ============================================
# This script automates the complete setup process for Unraid
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/unraid/unraid-setup.sh | bash
#
# Or manually:
#   cd /mnt/user/appdata
#   git clone https://github.com/thegspiro/the-logbook.git
#   cd the-logbook/unraid
#   chmod +x unraid-setup.sh
#   ./unraid-setup.sh
# ============================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
INSTALL_DIR="/mnt/user/appdata/the-logbook"
BACKUP_DIR="/mnt/user/backups/the-logbook"
REPO_URL="https://github.com/thegspiro/the-logbook.git"

# ============================================
# Helper Functions
# ============================================

print_header() {
    echo ""
    echo -e "${BLUE}============================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}============================================${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

# ============================================
# Pre-flight Checks
# ============================================

print_header "THE LOGBOOK - UNRAID SETUP"
echo "This script will set up The Logbook on your Unraid server"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    print_error "Please run as root (use 'sudo' or log in as root)"
    exit 1
fi

# Detect Unraid IP
UNRAID_IP=$(hostname -I | awk '{print $1}')
print_info "Detected Unraid IP: $UNRAID_IP"

# ============================================
# Installation Type
# ============================================

print_header "INSTALLATION OPTIONS"
echo "1) Fresh Installation (recommended)"
echo "2) Update Existing Installation"
echo "3) Clean Install (removes all data)"
echo ""
read -p "Choose option [1-3]: " INSTALL_TYPE

# ============================================
# Clean Up Existing Containers
# ============================================

cleanup_containers() {
    print_header "CLEANING UP EXISTING CONTAINERS"

    # Stop and remove containers
    if docker ps -a | grep -q "logbook"; then
        print_info "Stopping existing containers..."
        docker stop logbook-frontend logbook-backend logbook-db logbook-redis 2>/dev/null || true

        print_info "Removing existing containers..."
        docker rm -f logbook-frontend logbook-backend logbook-db logbook-redis 2>/dev/null || true

        print_success "Existing containers removed"
    else
        print_info "No existing containers found"
    fi

    # Remove old images if clean install
    if [ "$INSTALL_TYPE" == "3" ]; then
        print_info "Removing old images..."
        docker rmi the-logbook-frontend:local 2>/dev/null || true
        docker rmi the-logbook-backend:local 2>/dev/null || true
    fi

    # Remove network if exists
    if docker network ls | grep -q "the-logbook_logbook-internal"; then
        print_info "Removing existing network..."
        docker network rm the-logbook_logbook-internal 2>/dev/null || true
    fi
}

# ============================================
# Backup Existing Data
# ============================================

backup_existing_data() {
    if [ "$INSTALL_TYPE" == "2" ] || [ "$INSTALL_TYPE" == "3" ]; then
        if [ -d "$INSTALL_DIR" ]; then
            print_header "BACKING UP EXISTING DATA"

            BACKUP_DATE=$(date +%Y%m%d_%H%M%S)
            BACKUP_PATH="${BACKUP_DIR}/backup_${BACKUP_DATE}"

            mkdir -p "$BACKUP_DIR"

            print_info "Creating backup at: $BACKUP_PATH"

            # Backup data directories
            if [ -d "$INSTALL_DIR/mysql" ]; then
                cp -r "$INSTALL_DIR/mysql" "$BACKUP_PATH/mysql" 2>/dev/null || true
            fi
            if [ -d "$INSTALL_DIR/data" ]; then
                cp -r "$INSTALL_DIR/data" "$BACKUP_PATH/data" 2>/dev/null || true
            fi
            if [ -d "$INSTALL_DIR/uploads" ]; then
                cp -r "$INSTALL_DIR/uploads" "$BACKUP_PATH/uploads" 2>/dev/null || true
            fi

            # Backup .env file
            if [ -f "$INSTALL_DIR/.env" ]; then
                cp "$INSTALL_DIR/.env" "$BACKUP_PATH/.env" 2>/dev/null || true
            fi

            print_success "Backup created: $BACKUP_PATH"
        fi
    fi
}

# ============================================
# Clone or Update Repository
# ============================================

setup_repository() {
    print_header "SETTING UP REPOSITORY"

    if [ "$INSTALL_TYPE" == "3" ]; then
        # Clean install - remove everything
        if [ -d "$INSTALL_DIR" ]; then
            print_warning "Removing existing installation..."
            mv "$INSTALL_DIR" "${INSTALL_DIR}.old.$(date +%Y%m%d_%H%M%S)"
        fi
    fi

    if [ ! -d "$INSTALL_DIR" ]; then
        # Directory doesn't exist - clone fresh
        print_info "Cloning repository..."
        mkdir -p "$(dirname "$INSTALL_DIR")"
        git clone "$REPO_URL" "$INSTALL_DIR"
        print_success "Repository cloned"
    elif [ -d "$INSTALL_DIR/.git" ]; then
        # Directory exists and is a git repo - update it
        print_info "Updating existing repository..."
        cd "$INSTALL_DIR"
        git fetch origin
        git pull origin main || git pull origin master || print_warning "Could not update from git"
        print_success "Repository updated"
    else
        # Directory exists but is NOT a git repo - back it up and clone fresh
        print_warning "Directory exists but is not a git repository"
        print_info "Backing up existing directory..."
        mv "$INSTALL_DIR" "${INSTALL_DIR}.old.$(date +%Y%m%d_%H%M%S)"
        print_info "Cloning repository..."
        mkdir -p "$(dirname "$INSTALL_DIR")"
        git clone "$REPO_URL" "$INSTALL_DIR"
        print_success "Repository cloned (previous directory backed up)"
    fi
}

# ============================================
# Create Directory Structure
# ============================================

create_directories() {
    print_header "CREATING DIRECTORY STRUCTURE"

    mkdir -p "$INSTALL_DIR/mysql"
    mkdir -p "$INSTALL_DIR/redis"
    mkdir -p "$INSTALL_DIR/data"
    mkdir -p "$INSTALL_DIR/uploads"
    mkdir -p "$INSTALL_DIR/logs"
    mkdir -p "$BACKUP_DIR"

    # Set Unraid permissions (nobody:users)
    chown -R 99:100 "$INSTALL_DIR/mysql"
    chown -R 99:100 "$INSTALL_DIR/redis"
    chown -R 99:100 "$INSTALL_DIR/data"
    chown -R 99:100 "$INSTALL_DIR/uploads"
    chown -R 99:100 "$INSTALL_DIR/logs"
    chown -R 99:100 "$BACKUP_DIR"

    print_success "Directories created with correct permissions"
}

# ============================================
# Generate .env File
# ============================================

generate_env() {
    print_header "CONFIGURING ENVIRONMENT"

    ENV_FILE="$INSTALL_DIR/.env"

    # Check if .env already exists
    if [ -f "$ENV_FILE" ] && [ "$INSTALL_TYPE" == "2" ]; then
        print_info ".env file already exists, keeping existing configuration"
        return
    fi

    print_info "Generating new .env file..."

    # Generate secrets
    SECRET_KEY=$(openssl rand -hex 32)
    ENCRYPTION_KEY=$(openssl rand -hex 32)
    ENCRYPTION_SALT=$(openssl rand -hex 16)
    MYSQL_ROOT_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
    DB_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
    REDIS_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)

    # Create .env file from template
    cat > "$ENV_FILE" << EOF
# ============================================
# THE LOGBOOK - UNRAID ENVIRONMENT
# Auto-generated on $(date)
# ============================================

# Application Secrets (auto-generated)
SECRET_KEY=$SECRET_KEY
ENCRYPTION_KEY=$ENCRYPTION_KEY
ENCRYPTION_SALT=$ENCRYPTION_SALT

# Database Passwords (auto-generated)
MYSQL_ROOT_PASSWORD=$MYSQL_ROOT_PASSWORD
DB_PASSWORD=$DB_PASSWORD
REDIS_PASSWORD=$REDIS_PASSWORD

# Database Configuration
DB_NAME=the_logbook
DB_USER=logbook_user

# Network Configuration
ALLOWED_ORIGINS=http://${UNRAID_IP}:7880

# Application Settings
APP_NAME=The Logbook
VERSION=1.0.0
ENVIRONMENT=production
DEBUG=false

# Ports
FRONTEND_PORT=7880
BACKEND_PORT=7881

# Timezone
TZ=America/New_York

# Unraid User/Group IDs
PUID=99
PGID=100

# Email Configuration (disabled by default)
EMAIL_ENABLED=false

# Storage Configuration
STORAGE_TYPE=local
MAX_FILE_SIZE=52428800

# Backup Configuration
BACKUP_ENABLED=true
BACKUP_SCHEDULE=0 2 * * *
BACKUP_RETENTION_DAYS=30

# Module Configuration
MODULE_TRAINING_ENABLED=true
MODULE_COMPLIANCE_ENABLED=true
MODULE_SCHEDULING_ENABLED=true
MODULE_ELECTIONS_ENABLED=true

# Monitoring & Logging
ENABLE_DOCS=true
LOG_LEVEL=INFO
SENTRY_ENABLED=false
EOF

    chmod 600 "$ENV_FILE"
    print_success ".env file created with secure auto-generated secrets"
}

# ============================================
# Copy Docker Compose File
# ============================================

setup_docker_compose() {
    print_header "SETTING UP DOCKER COMPOSE"

    cd "$INSTALL_DIR"

    # Copy Unraid-specific docker-compose file
    if [ -f "unraid/docker-compose-unraid.yml" ]; then
        cp unraid/docker-compose-unraid.yml docker-compose.yml
        print_success "Docker Compose file configured"
    else
        print_error "Docker Compose template not found"
        exit 1
    fi
}

# ============================================
# Build and Start Services
# ============================================

start_services() {
    print_header "BUILDING AND STARTING SERVICES"

    cd "$INSTALL_DIR"

    print_info "This may take 5-10 minutes for first-time build..."

    # Pull base images first
    print_info "Pulling base images..."
    docker pull mysql:8.0
    docker pull redis:7-alpine

    # Build and start
    print_info "Building application containers..."
    docker-compose build --no-cache

    print_info "Starting services..."
    docker-compose up -d

    print_success "Services started!"
}

# ============================================
# Verify Deployment
# ============================================

verify_deployment() {
    print_header "VERIFYING DEPLOYMENT"

    cd "$INSTALL_DIR"

    # Wait for services to start
    print_info "Waiting for services to initialize (30 seconds)..."
    sleep 30

    # Check container status
    print_info "Checking container status..."
    docker-compose ps

    # Check if containers are healthy
    if docker ps | grep -q "logbook-frontend.*Up"; then
        print_success "Frontend container is running"
    else
        print_warning "Frontend container may not be running correctly"
    fi

    if docker ps | grep -q "logbook-backend.*Up"; then
        print_success "Backend container is running"
    else
        print_warning "Backend container may not be running correctly"
    fi

    if docker ps | grep -q "logbook-db.*Up"; then
        print_success "Database container is running"
    else
        print_warning "Database container may not be running correctly"
    fi

    # Test connectivity
    print_info "Testing application connectivity..."
    sleep 10

    if curl -s -o /dev/null -w "%{http_code}" "http://localhost:7880" | grep -q "200\|301\|302"; then
        print_success "Frontend is accessible"
    else
        print_warning "Frontend may not be accessible yet"
    fi

    if curl -s "http://localhost:7881/health" | grep -q "ok\|healthy"; then
        print_success "Backend is healthy"
    else
        print_warning "Backend may not be healthy yet"
    fi
}

# ============================================
# Display Summary
# ============================================

display_summary() {
    print_header "INSTALLATION COMPLETE!"

    echo ""
    echo -e "${GREEN}The Logbook has been successfully installed!${NC}"
    echo ""
    echo -e "${BLUE}Access Information:${NC}"
    echo -e "  Frontend:  ${GREEN}http://${UNRAID_IP}:7880${NC}"
    echo -e "  Backend:   ${GREEN}http://${UNRAID_IP}:7881${NC}"
    echo -e "  API Docs:  ${GREEN}http://${UNRAID_IP}:7881/docs${NC}"
    echo ""
    echo -e "${BLUE}Useful Commands:${NC}"
    echo "  View logs:       cd $INSTALL_DIR && docker-compose logs -f"
    echo "  Restart:         cd $INSTALL_DIR && docker-compose restart"
    echo "  Stop:            cd $INSTALL_DIR && docker-compose down"
    echo "  Start:           cd $INSTALL_DIR && docker-compose up -d"
    echo "  Rebuild:         cd $INSTALL_DIR && docker-compose build --no-cache && docker-compose up -d"
    echo ""
    echo -e "${BLUE}Configuration:${NC}"
    echo "  Install Dir:     $INSTALL_DIR"
    echo "  Backup Dir:      $BACKUP_DIR"
    echo "  Config File:     $INSTALL_DIR/.env"
    echo ""
    echo -e "${YELLOW}Next Steps:${NC}"
    echo "  1. Open http://${UNRAID_IP}:7880 in your browser"
    echo "  2. Complete the onboarding wizard"
    echo "  3. Configure your organization settings"
    echo ""
    echo -e "${BLUE}Support:${NC}"
    echo "  Documentation:   $INSTALL_DIR/README.md"
    echo "  GitHub:          https://github.com/thegspiro/the-logbook"
    echo ""
}

# ============================================
# Main Execution
# ============================================

main() {
    # Run setup steps
    cleanup_containers
    backup_existing_data
    setup_repository
    create_directories
    generate_env
    setup_docker_compose
    start_services
    verify_deployment
    display_summary
}

# Execute main function
main
