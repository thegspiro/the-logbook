#!/bin/bash

# ============================================
# THE LOGBOOK - UNIVERSAL INSTALLATION SCRIPT
# ============================================
# Works on: Linux (Debian/Ubuntu, RHEL/CentOS/Fedora, Alpine, Arch), macOS, WSL
# Architectures: x86_64, ARM64 (Apple Silicon, Raspberry Pi), ARMv7
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/scripts/universal-install.sh | bash
#
# Or with options:
#   ./scripts/universal-install.sh --profile minimal    # Low memory (1GB RAM)
#   ./scripts/universal-install.sh --profile standard   # Default (4GB RAM)
#   ./scripts/universal-install.sh --profile full       # All features (8GB+ RAM)
#   ./scripts/universal-install.sh --arm                # Force ARM configuration
#   ./scripts/universal-install.sh --no-docker          # Skip Docker installation
#   ./scripts/universal-install.sh --help               # Show help
# ============================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Default settings
PROFILE="standard"
INSTALL_DOCKER=true
FORCE_ARM=false
INSTALL_DIR="${INSTALL_DIR:-$(pwd)}"

# ============================================
# Helper Functions
# ============================================

print_banner() {
    echo -e "${CYAN}"
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║            THE LOGBOOK - Universal Installer               ║"
    echo "║         Fire Department Intranet Platform                  ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

detect_os() {
    OS="unknown"
    OS_FAMILY="unknown"

    if [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
        OS_FAMILY="darwin"
    elif [[ -f /etc/os-release ]]; then
        . /etc/os-release
        OS="$ID"
        case "$ID" in
            ubuntu|debian|raspbian|pop|linuxmint|elementary)
                OS_FAMILY="debian"
                ;;
            fedora|centos|rhel|rocky|almalinux|amazon)
                OS_FAMILY="rhel"
                ;;
            alpine)
                OS_FAMILY="alpine"
                ;;
            arch|manjaro|endeavouros)
                OS_FAMILY="arch"
                ;;
            *)
                OS_FAMILY="unknown"
                ;;
        esac
    elif [[ -f /etc/alpine-release ]]; then
        OS="alpine"
        OS_FAMILY="alpine"
    fi

    log_info "Detected OS: $OS ($OS_FAMILY)"
}

detect_architecture() {
    ARCH=$(uname -m)
    IS_ARM=false

    case "$ARCH" in
        x86_64|amd64)
            DOCKER_ARCH="amd64"
            ;;
        aarch64|arm64)
            DOCKER_ARCH="arm64"
            IS_ARM=true
            ;;
        armv7l|armhf)
            DOCKER_ARCH="arm/v7"
            IS_ARM=true
            ;;
        *)
            log_warning "Unknown architecture: $ARCH, defaulting to amd64"
            DOCKER_ARCH="amd64"
            ;;
    esac

    if [[ "$FORCE_ARM" == "true" ]]; then
        IS_ARM=true
    fi

    log_info "Architecture: $ARCH (Docker: $DOCKER_ARCH, ARM: $IS_ARM)"
}

detect_memory() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        TOTAL_MEM_KB=$(sysctl -n hw.memsize | awk '{print $1/1024}')
    else
        TOTAL_MEM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
    fi
    TOTAL_MEM_GB=$((TOTAL_MEM_KB / 1024 / 1024))

    log_info "Total memory: ${TOTAL_MEM_GB}GB"

    # Auto-select profile based on memory if not explicitly set
    if [[ "$PROFILE" == "auto" ]]; then
        if [[ $TOTAL_MEM_GB -lt 2 ]]; then
            PROFILE="minimal"
        elif [[ $TOTAL_MEM_GB -lt 6 ]]; then
            PROFILE="standard"
        else
            PROFILE="full"
        fi
        log_info "Auto-selected profile: $PROFILE"
    fi
}

check_requirements() {
    log_info "Checking requirements..."

    # Check for curl or wget
    if command -v curl &> /dev/null; then
        DOWNLOADER="curl -fsSL"
    elif command -v wget &> /dev/null; then
        DOWNLOADER="wget -qO-"
    else
        log_error "curl or wget is required"
        exit 1
    fi

    # Check for git
    if ! command -v git &> /dev/null; then
        log_warning "git not found, will install"
        NEED_GIT=true
    fi

    log_success "Requirements check passed"
}

# ============================================
# Docker Installation (Platform-specific)
# ============================================

install_docker_debian() {
    log_info "Installing Docker on Debian/Ubuntu..."

    sudo apt-get update
    sudo apt-get install -y \
        apt-transport-https \
        ca-certificates \
        curl \
        gnupg \
        lsb-release

    # Add Docker GPG key
    sudo mkdir -p /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/$OS/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null || true

    # Add repository
    echo "deb [arch=$DOCKER_ARCH signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$OS $(lsb_release -cs) stable" | \
        sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

    sudo apt-get update
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    sudo usermod -aG docker $USER
    log_success "Docker installed successfully"
}

install_docker_rhel() {
    log_info "Installing Docker on RHEL/Fedora..."

    sudo dnf -y install dnf-plugins-core
    sudo dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo
    sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    sudo systemctl start docker
    sudo systemctl enable docker
    sudo usermod -aG docker $USER

    log_success "Docker installed successfully"
}

install_docker_alpine() {
    log_info "Installing Docker on Alpine..."

    sudo apk add --no-cache docker docker-cli-compose
    sudo rc-update add docker boot
    sudo service docker start
    sudo addgroup $USER docker

    log_success "Docker installed successfully"
}

install_docker_arch() {
    log_info "Installing Docker on Arch..."

    sudo pacman -S --noconfirm docker docker-compose
    sudo systemctl start docker
    sudo systemctl enable docker
    sudo usermod -aG docker $USER

    log_success "Docker installed successfully"
}

install_docker_macos() {
    log_info "Installing Docker on macOS..."

    if command -v brew &> /dev/null; then
        brew install --cask docker
        log_success "Docker Desktop installed. Please start it from Applications."
    else
        log_error "Homebrew not found. Please install Docker Desktop manually from https://docker.com"
        exit 1
    fi
}

install_docker() {
    if command -v docker &> /dev/null && docker compose version &> /dev/null; then
        log_success "Docker already installed ($(docker --version | cut -d' ' -f3))"
        return
    fi

    case "$OS_FAMILY" in
        debian)
            install_docker_debian
            ;;
        rhel)
            install_docker_rhel
            ;;
        alpine)
            install_docker_alpine
            ;;
        arch)
            install_docker_arch
            ;;
        darwin)
            install_docker_macos
            ;;
        *)
            log_error "Unsupported OS for automatic Docker installation: $OS"
            log_info "Please install Docker manually: https://docs.docker.com/get-docker/"
            exit 1
            ;;
    esac
}

install_git() {
    if [[ "$NEED_GIT" != "true" ]]; then
        return
    fi

    log_info "Installing git..."

    case "$OS_FAMILY" in
        debian)
            sudo apt-get install -y git
            ;;
        rhel)
            sudo dnf install -y git
            ;;
        alpine)
            sudo apk add git
            ;;
        arch)
            sudo pacman -S --noconfirm git
            ;;
        darwin)
            xcode-select --install 2>/dev/null || true
            ;;
    esac

    log_success "git installed"
}

# ============================================
# Environment Setup
# ============================================

generate_secrets() {
    # Use openssl if available, otherwise use /dev/urandom
    if command -v openssl &> /dev/null; then
        SECRET_KEY=$(openssl rand -hex 32)
        ENCRYPTION_KEY=$(openssl rand -hex 32)
        ENCRYPTION_SALT=$(openssl rand -hex 16)
        DB_PASSWORD=$(openssl rand -base64 24 | tr -d "=+/" | cut -c1-20)
        MYSQL_ROOT_PASSWORD=$(openssl rand -base64 24 | tr -d "=+/" | cut -c1-20)
        REDIS_PASSWORD=$(openssl rand -base64 24 | tr -d "=+/" | cut -c1-20)
    else
        SECRET_KEY=$(head -c 32 /dev/urandom | xxd -p | tr -d '\n')
        ENCRYPTION_KEY=$(head -c 32 /dev/urandom | xxd -p | tr -d '\n')
        ENCRYPTION_SALT=$(head -c 16 /dev/urandom | xxd -p | tr -d '\n')
        DB_PASSWORD=$(head -c 15 /dev/urandom | base64 | tr -d "=+/" | cut -c1-20)
        MYSQL_ROOT_PASSWORD=$(head -c 15 /dev/urandom | base64 | tr -d "=+/" | cut -c1-20)
        REDIS_PASSWORD=$(head -c 15 /dev/urandom | base64 | tr -d "=+/" | cut -c1-20)
    fi
}

create_env_file() {
    log_info "Creating .env file with profile: $PROFILE"

    generate_secrets

    # Set resource limits based on profile
    case "$PROFILE" in
        minimal)
            MYSQL_BUFFER="128M"
            MYSQL_MAX_CONN="100"
            REDIS_MAXMEM="64mb"
            BACKEND_WORKERS="1"
            ;;
        standard)
            MYSQL_BUFFER="256M"
            MYSQL_MAX_CONN="200"
            REDIS_MAXMEM="128mb"
            BACKEND_WORKERS="2"
            ;;
        full)
            MYSQL_BUFFER="512M"
            MYSQL_MAX_CONN="500"
            REDIS_MAXMEM="256mb"
            BACKEND_WORKERS="4"
            ;;
    esac

    cat > "$INSTALL_DIR/.env" << EOF
# ============================================
# THE LOGBOOK - AUTO-GENERATED CONFIGURATION
# ============================================
# Profile: $PROFILE
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
# Architecture: $ARCH
# ============================================

# ============================================
# SECURITY KEYS (Auto-generated - DO NOT SHARE)
# ============================================
SECRET_KEY=$SECRET_KEY
ENCRYPTION_KEY=$ENCRYPTION_KEY
ENCRYPTION_SALT=$ENCRYPTION_SALT

# ============================================
# DATABASE
# ============================================
MYSQL_ROOT_PASSWORD=$MYSQL_ROOT_PASSWORD
DB_NAME=the_logbook
DB_USER=logbook_user
DB_PASSWORD=$DB_PASSWORD
DB_HOST=mysql
DB_PORT=3306

# Resource tuning
MYSQL_BUFFER_POOL_SIZE=$MYSQL_BUFFER
MYSQL_MAX_CONNECTIONS=$MYSQL_MAX_CONN

# ============================================
# REDIS
# ============================================
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=$REDIS_PASSWORD
REDIS_MAXMEMORY=$REDIS_MAXMEM

# ============================================
# APPLICATION
# ============================================
APP_NAME=The Logbook
VERSION=1.0.0
ENVIRONMENT=production
DEBUG=false
BACKEND_WORKERS=$BACKEND_WORKERS

# ============================================
# NETWORK
# ============================================
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
FRONTEND_PORT=3000
BACKEND_PORT=3001

# ============================================
# PROFILE SETTINGS
# ============================================
PROFILE=$PROFILE
IS_ARM=$IS_ARM

# ============================================
# TIMEZONE
# ============================================
TZ=${TZ:-UTC}

# ============================================
# MODULES (Enable/disable as needed)
# ============================================
MODULE_TRAINING_ENABLED=true
MODULE_COMPLIANCE_ENABLED=true
MODULE_SCHEDULING_ENABLED=true
MODULE_ELECTIONS_ENABLED=true

# ============================================
# OPTIONAL SERVICES (Profile: $PROFILE)
# ============================================
ENABLE_ELASTICSEARCH=false
ENABLE_MINIO=false
ENABLE_MAILHOG=false
EOF

    log_success ".env file created"
}

# ============================================
# Docker Compose Selection
# ============================================

select_compose_file() {
    COMPOSE_FILE="docker-compose.yml"
    COMPOSE_PROFILES=""

    # Use ARM-optimized images if on ARM
    if [[ "$IS_ARM" == "true" ]]; then
        log_info "Using ARM-compatible configuration"
        export DOCKER_DEFAULT_PLATFORM="linux/arm64"
    fi

    # Add profiles based on user selection
    case "$PROFILE" in
        minimal)
            # No optional services
            ;;
        standard)
            # Default services only
            ;;
        full)
            COMPOSE_PROFILES="--profile with-search --profile with-s3"
            ;;
    esac

    log_info "Compose file: $COMPOSE_FILE, Profiles: ${COMPOSE_PROFILES:-none}"
}

# ============================================
# Installation
# ============================================

clone_or_update_repo() {
    if [[ -f "$INSTALL_DIR/docker-compose.yml" ]]; then
        log_info "Repository already exists, pulling latest changes..."
        cd "$INSTALL_DIR"
        git pull origin main || log_warning "Could not pull latest changes"
    else
        log_info "Cloning The Logbook repository..."
        git clone https://github.com/thegspiro/the-logbook.git "$INSTALL_DIR"
        cd "$INSTALL_DIR"
    fi
}

start_services() {
    log_info "Starting services..."

    cd "$INSTALL_DIR"

    # Build and start
    docker compose $COMPOSE_PROFILES build
    docker compose $COMPOSE_PROFILES up -d

    log_success "Services started"
}

wait_for_services() {
    log_info "Waiting for services to be healthy..."

    local max_attempts=30
    local attempt=0

    while [[ $attempt -lt $max_attempts ]]; do
        if docker compose exec -T backend curl -s http://localhost:3001/health > /dev/null 2>&1; then
            log_success "Backend is healthy"
            break
        fi
        attempt=$((attempt + 1))
        echo -n "."
        sleep 5
    done
    echo

    if [[ $attempt -eq $max_attempts ]]; then
        log_warning "Services may still be starting. Check logs with: docker compose logs -f"
    fi
}

run_migrations() {
    log_info "Running database migrations..."

    docker compose exec -T backend alembic upgrade head || {
        log_warning "Migrations may have already run or database is still starting"
        log_info "You can run manually: docker compose exec backend alembic upgrade head"
    }
}

print_success_message() {
    echo
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║           Installation Complete!                            ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
    echo
    echo -e "${CYAN}Access your installation:${NC}"
    echo -e "  Frontend:  ${GREEN}http://localhost:3000${NC}"
    echo -e "  Backend:   ${GREEN}http://localhost:3001${NC}"
    echo -e "  API Docs:  ${GREEN}http://localhost:3001/docs${NC}"
    echo
    echo -e "${CYAN}Useful commands:${NC}"
    echo -e "  View logs:       ${YELLOW}docker compose logs -f${NC}"
    echo -e "  Stop services:   ${YELLOW}docker compose down${NC}"
    echo -e "  Restart:         ${YELLOW}docker compose restart${NC}"
    echo -e "  Update:          ${YELLOW}git pull && docker compose up -d --build${NC}"
    echo
    echo -e "${CYAN}Configuration:${NC}"
    echo -e "  Profile:         ${GREEN}$PROFILE${NC}"
    echo -e "  Architecture:    ${GREEN}$ARCH${NC}"
    echo -e "  Config file:     ${GREEN}$INSTALL_DIR/.env${NC}"
    echo
    if [[ "$INSTALL_DOCKER" == "true" ]] && [[ "$OS_FAMILY" != "darwin" ]]; then
        echo -e "${YELLOW}Note: You may need to log out and back in for Docker group changes.${NC}"
        echo
    fi
}

show_help() {
    cat << EOF
The Logbook - Universal Installation Script

USAGE:
    $0 [OPTIONS]

OPTIONS:
    --profile <name>    Resource profile: minimal, standard (default), full, auto
                        - minimal: 1-2GB RAM (Raspberry Pi, small VPS)
                        - standard: 4GB RAM (typical deployment)
                        - full: 8GB+ RAM (all features including search)
                        - auto: Auto-detect based on available memory

    --arm               Force ARM configuration (auto-detected normally)
    --no-docker         Skip Docker installation
    --dir <path>        Installation directory (default: current directory)
    --help              Show this help message

EXAMPLES:
    # Standard installation
    $0

    # Minimal profile for Raspberry Pi
    $0 --profile minimal

    # Full installation with all features
    $0 --profile full

    # Custom directory
    $0 --dir /opt/the-logbook

SUPPORTED PLATFORMS:
    - Linux: Ubuntu, Debian, Fedora, CentOS, RHEL, Alpine, Arch
    - macOS: Intel and Apple Silicon
    - Windows: WSL2 (Windows Subsystem for Linux)
    - Architectures: x86_64, ARM64, ARMv7

For more information: https://github.com/thegspiro/the-logbook
EOF
}

# ============================================
# Main
# ============================================

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --profile)
                PROFILE="$2"
                shift 2
                ;;
            --arm)
                FORCE_ARM=true
                shift
                ;;
            --no-docker)
                INSTALL_DOCKER=false
                shift
                ;;
            --dir)
                INSTALL_DIR="$2"
                shift 2
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done
}

main() {
    parse_args "$@"

    print_banner

    # Detection
    detect_os
    detect_architecture
    detect_memory
    check_requirements

    # Installation
    if [[ "$INSTALL_DOCKER" == "true" ]]; then
        install_docker
    fi
    install_git

    # Setup
    clone_or_update_repo
    create_env_file
    select_compose_file

    # Start
    start_services
    wait_for_services
    run_migrations

    print_success_message
}

main "$@"
