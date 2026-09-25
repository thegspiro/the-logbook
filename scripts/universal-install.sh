#!/bin/bash

# ============================================
# THE LOGBOOK - UNIVERSAL INSTALLATION SCRIPT
# ============================================
# Works on: Linux (Debian/Ubuntu, RHEL/CentOS/Fedora, Alpine, Arch), macOS, WSL
# Architectures: x86_64, ARM64 (Apple Silicon, Raspberry Pi), ARMv7
#
# Usage (the public URL is required):
#   curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/scripts/universal-install.sh \
#     | bash -s -- --public-url https://logbook.example.org
#
# Or with options (each also needs --public-url, or LOGBOOK_PUBLIC_URL set):
#   ./scripts/universal-install.sh --public-url https://logbook.example.org
#                                                       # Address used in emailed links
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
# The address members open the site at. Every link the app emails is built
# from it (FRONTEND_URL). Taken as a flag or environment variable rather than a
# prompt because this script is commonly run as `curl ... | bash`, where stdin
# is the script itself and a prompt cannot be answered. The variable is
# prefixed because a bare PUBLIC_URL is already used by other tooling (Create
# React App among them) and would be picked up from an unrelated shell.
PUBLIC_URL="${LOGBOOK_PUBLIC_URL:-}"

# The production stack is ALWAYS the base file plus the production override.
# COMPOSE_FILE_LIST is what gets pinned into .env (for the operator's later bare
# `docker compose ...` commands); COMPOSE_FILE_ARGS is what this script passes
# on every invocation. The explicit -f flags are the authoritative selection:
# they override COMPOSE_FILE from the environment/.env, so a preserved .env that
# predates the pin (or one an operator wrote by hand) can never downgrade this
# installer to the development-only base file.
COMPOSE_FILE_LIST="docker-compose.yml:docker-compose.prod.yml"
COMPOSE_FILE_ARGS=(-f docker-compose.yml -f docker-compose.prod.yml)

# ============================================
# Helper Functions
# ============================================

# Mirrors the backend's startup check (_is_loopback_url in
# backend/app/core/config.py): a host only this machine can reach, or none at
# all. Kept in sync by hand because this script runs before the backend image
# exists.
frontend_url_is_loopback() {
    local host="${1#*://}"
    host="${host%%/*}"
    host="${host##*@}"
    case "$host" in
        \[*\]*) host="${host%%]*}]" ;;
        *) host="${host%%:*}" ;;
    esac
    host=$(printf '%s' "$host" | tr '[:upper:]' '[:lower:]')
    case "$host" in
        ""|localhost|*.localhost|127.*|0.0.0.0|"[::1]"|"[::]") return 0 ;;
    esac
    return 1
}

# The value lands verbatim in .env, where Docker Compose interpolates `$` and
# treats `#` as a comment, so anything beyond a plain URL is refused rather
# than written into a file that would then mean something else.
validate_public_url() {
    local url="$1"
    case "$url" in
        http://?*|https://?*) ;;
        *)
            log_error "--public-url must start with http:// or https:// (got: $url)"
            return 1
            ;;
    esac
    case "$url" in
        *[[:space:]\"\'\$\`\\#]*)
            log_error "--public-url must not contain spaces, quotes, \$, backticks, backslashes or #"
            return 1
            ;;
    esac
    if frontend_url_is_loopback "$url"; then
        log_error "--public-url $url points at this machine. The backend refuses to start in"
        log_error "production with it, because emailed links would not open anywhere else."
        return 1
    fi
    return 0
}

# The stack runs ENVIRONMENT=production, where the backend refuses to start
# while FRONTEND_URL points at this machine. Checked before anything is
# installed, so a missing address fails here rather than after a full install
# that can never boot. A preserved .env that already names a public address
# needs nothing more.
require_public_url() {
    local current=""
    if [[ -n "$PUBLIC_URL" ]]; then
        return 0
    fi
    if [[ -f "$INSTALL_DIR/.env" ]]; then
        current=$(sed -n 's/^[[:space:]]*FRONTEND_URL=//p' "$INSTALL_DIR/.env" | tail -n 1)
        if ! frontend_url_is_loopback "$current"; then
            return 0
        fi
    fi
    log_error "A public URL is required: the address members open the site at."
    log_error "Every link in outgoing email is built from it, and the backend refuses"
    log_error "to start in production without one. Re-run with"
    log_error "  --public-url https://logbook.example.org   (or set LOGBOOK_PUBLIC_URL)"
    return 1
}

# Replaces the line by filtering rather than with sed, whose replacement text
# would misread a "|" or "&" in the URL.
write_frontend_url() {
    local env_file="$1" url="$2" tmp
    tmp=$(mktemp)
    grep -vE '^[[:space:]]*FRONTEND_URL=' "$env_file" > "$tmp" || true
    printf 'FRONTEND_URL=%s\n' "$url" >> "$tmp"
    cat "$tmp" > "$env_file"
    rm -f "$tmp"
}

# A preserved .env is the operator's, so an existing public FRONTEND_URL is
# never rewritten. One that is absent or still points at this machine is
# replaced with --public-url; require_public_url has already refused to run
# when neither exists, so the error branch is a backstop.
reconcile_frontend_url() {
    local env_file="$1" current
    current=$(sed -n 's/^[[:space:]]*FRONTEND_URL=//p' "$env_file" | tail -n 1)
    if [[ -n "$current" ]] && ! frontend_url_is_loopback "$current"; then
        if [[ -n "$PUBLIC_URL" && "$current" != "$PUBLIC_URL" ]]; then
            log_warning "Your .env already sets FRONTEND_URL=$current — keeping it, not --public-url"
        fi
        return 0
    fi
    if [[ -n "$PUBLIC_URL" ]]; then
        write_frontend_url "$env_file" "$PUBLIC_URL"
        log_info "Set FRONTEND_URL=$PUBLIC_URL in your .env"
    else
        log_error "Your .env has no public FRONTEND_URL, and the backend refuses to start in"
        log_error "production without one. Re-run with --public-url <address members use>."
        return 1
    fi
}

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
    # Never clobber (or silently weaken) a config the operator already has:
    # regenerating would replace live DB passwords and secrets. Keep it, but
    # warn when it cannot boot under the pinned production override.
    if [[ -f "$INSTALL_DIR/.env" ]]; then
        log_warning "Existing .env found — keeping it (delete it and re-run to regenerate)"
        # A preserved .env may predate the COMPOSE_FILE pin (or have been
        # hand-written without it). This installer no longer depends on the pin
        # — it passes -f explicitly — but the management commands printed at the
        # end (logs/restart/down/update) are bare `docker compose` calls that do,
        # so append the key when it is ABSENT. Appending only: an existing value
        # is the operator's own and is never rewritten, and no other line in the
        # file is touched (secrets and passwords stay exactly as they are).
        if ! grep -qE '^[[:space:]]*COMPOSE_FILE=' "$INSTALL_DIR/.env"; then
            cat >> "$INSTALL_DIR/.env" << EOF

# Added by the installer: pin the production override so bare
# \`docker compose ...\` commands in this directory layer
# docker-compose.prod.yml on the development base file.
COMPOSE_FILE=$COMPOSE_FILE_LIST
EOF
            log_info "Added COMPOSE_FILE=$COMPOSE_FILE_LIST to your .env"
        elif ! grep -qE '^[[:space:]]*COMPOSE_FILE=.*docker-compose\.prod\.yml' "$INSTALL_DIR/.env"; then
            log_warning "Your .env sets COMPOSE_FILE without docker-compose.prod.yml. This"
            log_warning "installer still deploys the production stack (it passes -f"
            log_warning "explicitly), but your own bare \`docker compose\` commands will"
            log_warning "start the development posture (uvicorn --reload, published backend"
            log_warning "port, docs on). Set COMPOSE_FILE=$COMPOSE_FILE_LIST"
        fi
        if ! grep -qE '^[[:space:]]*SECURITY_REQUIRE_TLS=' "$INSTALL_DIR/.env"; then
            log_warning "Your .env does not set SECURITY_REQUIRE_TLS. docker-compose.prod.yml"
            log_warning "defaults it to TRUE and the backend will REFUSE TO START, because the"
            log_warning "bundled MySQL/Redis do not terminate TLS. Either configure TLS"
            log_warning "(DB_SSL/DB_SSL_CA, REDIS_SSL/REDIS_SSL_CA) or add an explicit"
            log_warning "SECURITY_REQUIRE_TLS=false for the bundled plaintext services."
        fi
        reconcile_frontend_url "$INSTALL_DIR/.env"
        return
    fi

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

# Pin the production compose override so every bare \`docker compose ...\` command
# in this directory (start, update, logs, restart) layers docker-compose.prod.yml
# on top of the development base file — hardened posture (no --reload, docs off,
# HTTPS/TLS enforced, backend port unpublished, trusted-proxy IPs set).
COMPOSE_FILE=$COMPOSE_FILE_LIST

# ============================================
# TRANSPORT TLS TO DATA SERVICES — EXPLICIT OPT-OUT
# ============================================
# The bundled MySQL and Redis containers speak PLAINTEXT on the internal
# Docker network; they do not terminate TLS. With SECURITY_REQUIRE_TLS unset,
# docker-compose.prod.yml defaults it to true and the backend REFUSES TO
# START. This explicit false keeps the bundled stack bootable: database and
# cache traffic stays on the compose-internal network but is NOT encrypted.
# If you move MySQL/Redis off-host (or add TLS termination), set
# DB_SSL=true + DB_SSL_CA and REDIS_SSL=true + REDIS_SSL_CA, then flip
# SECURITY_REQUIRE_TLS=true to keep it that way.
SECURITY_REQUIRE_TLS=false
DB_SSL=false
REDIS_SSL=false

# ============================================
# NETWORK
# ============================================
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
# Every link in outgoing email (password resets, ballots, reminders) is built
# from this. Set it to the address members open the site at.
FRONTEND_URL=${PUBLIC_URL}
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
# MODULES
# ============================================
# Modules are enabled per organization at runtime (organization settings →
# enabled_modules); there are no MODULE_*_ENABLED deployment flags.

# ============================================
# OPTIONAL SERVICES (Profile: $PROFILE)
# ============================================
ENABLE_ELASTICSEARCH=false
ENABLE_MINIO=false
ENABLE_MAILHOG=false
EOF

    log_success ".env file created"
    log_warning "SECURITY_REQUIRE_TLS=false written to .env: the bundled MySQL/Redis do"
    log_warning "not terminate TLS, so DB/cache traffic on the internal Docker network is"
    log_warning "NOT encrypted. If you use external data services, enable DB_SSL/REDIS_SSL"
    log_warning "(+ CA certs) and set SECURITY_REQUIRE_TLS=true."
}

# ============================================
# Docker Compose Selection
# ============================================

select_compose_file() {
    # Every `docker compose` call below passes COMPOSE_FILE_ARGS (-f base -f
    # prod) rather than relying on COMPOSE_FILE from .env: CLI -f flags win over
    # the environment, so the selection holds even for a preserved .env that
    # never had the key. The .env pin (see create_env_file) exists only for the
    # operator's later bare `docker compose ...` commands.
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

    log_info "Compose files: ${COMPOSE_FILE_ARGS[*]}, Profiles: ${COMPOSE_PROFILES:-none}"
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

    # Build and start. COMPOSE_PROFILES is an intentionally word-split string of
    # `--profile x` flags; the compose file selection is an array so paths stay
    # intact regardless of what .env holds.
    # shellcheck disable=SC2086
    docker compose "${COMPOSE_FILE_ARGS[@]}" $COMPOSE_PROFILES build
    # shellcheck disable=SC2086
    docker compose "${COMPOSE_FILE_ARGS[@]}" $COMPOSE_PROFILES up -d

    log_success "Services started"
}

wait_for_services() {
    log_info "Waiting for services to be healthy..."

    local max_attempts=30
    local attempt=0

    while [[ $attempt -lt $max_attempts ]]; do
        if docker compose "${COMPOSE_FILE_ARGS[@]}" exec -T backend curl -s http://localhost:3001/health > /dev/null 2>&1; then
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

    docker compose "${COMPOSE_FILE_ARGS[@]}" exec -T backend alembic upgrade head || {
        log_warning "Migrations may have already run or database is still starting"
        log_info "You can run manually: docker compose ${COMPOSE_FILE_ARGS[*]} exec backend alembic upgrade head"
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
    --public-url <url>  Required. Address members open the site at (for
                        example https://logbook.example.org). Written to
                        FRONTEND_URL, which every link in outgoing email is
                        built from; the backend refuses to start in production
                        while it points at this machine. Also read from the
                        LOGBOOK_PUBLIC_URL environment variable. May be omitted
                        only when an existing .env already sets a public
                        FRONTEND_URL.
    --help              Show this help message

EXAMPLES:
    # Standard installation
    $0 --public-url https://logbook.example.org

    # Minimal profile for Raspberry Pi
    $0 --public-url https://logbook.example.org --profile minimal

    # Full installation with all features
    $0 --public-url https://logbook.example.org --profile full

    # Custom directory
    $0 --public-url https://logbook.example.org --dir /opt/the-logbook

    # A LAN-only install still needs an address other machines can reach
    $0 --public-url http://192.168.1.50:3000

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
            --public-url)
                if [[ $# -lt 2 || -z "$2" ]]; then
                    log_error "--public-url needs a value, for example --public-url https://logbook.example.org"
                    exit 1
                fi
                PUBLIC_URL="$2"
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

    # Validated before anything is installed, so a mistyped address fails fast.
    PUBLIC_URL="${PUBLIC_URL%/}"
    if [[ -n "$PUBLIC_URL" ]]; then
        validate_public_url "$PUBLIC_URL" || exit 1
    fi
    require_public_url || exit 1

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
