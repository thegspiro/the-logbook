#!/bin/bash

# ============================================
# THE LOGBOOK - AUTOMATED INSTALLATION SCRIPT
# ============================================
# This script automates the installation of The Logbook platform
# on Ubuntu/Debian servers and can also set up Docker-based deployment.
#
# Usage:
#   ./install.sh                 # Interactive installation
#   ./install.sh --docker        # Docker-based installation
#   ./install.sh --traditional   # Traditional server installation
#   ./install.sh --docker --public-url https://logbook.example.org
#                                # Address used in emailed links
#   ./install.sh --help          # Show help
#
# Requirements:
#   - Ubuntu 20.04+ or Debian 11+
#   - Sudo privileges
#   - Internet connection
# ============================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# The address members open the site at. Every link the app emails is built
# from it (FRONTEND_URL). Also asked for interactively when the installer has a
# terminal. The variable is prefixed because a bare PUBLIC_URL is already used
# by other tooling (Create React App among them).
PUBLIC_URL="${LOGBOOK_PUBLIC_URL:-}"

# ============================================
# Helper Functions
# ============================================

print_header() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

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
            print_error "The public URL must start with http:// or https:// (got: $url)"
            return 1
            ;;
    esac
    case "$url" in
        *[[:space:]\"\'\$\`\\#]*)
            print_error "The public URL must not contain spaces, quotes, \$, backticks, backslashes or #"
            return 1
            ;;
    esac
    if frontend_url_is_loopback "$url"; then
        print_warning "$url points at this machine; emailed links will not open elsewhere"
    fi
    return 0
}

# Asked only when nobody supplied one and there is a terminal to answer from;
# an empty answer keeps the localhost default, which is reported at the end.
prompt_public_url() {
    local answer
    if [[ -n "$PUBLIC_URL" || ! -t 0 ]]; then
        return 0
    fi
    while :; do
        read -r -p "Public URL members will use (e.g. https://logbook.example.org), or Enter to set it later: " answer
        answer="${answer%/}"
        if [[ -z "$answer" ]]; then
            return 0
        fi
        if validate_public_url "$answer"; then
            PUBLIC_URL="$answer"
            return 0
        fi
    done
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
# replaced when a public URL was given, and reported otherwise.
reconcile_frontend_url() {
    local env_file="$1" current
    current=$(sed -n 's/^[[:space:]]*FRONTEND_URL=//p' "$env_file" | tail -n 1)
    if [[ -n "$current" ]] && ! frontend_url_is_loopback "$current"; then
        if [[ -n "$PUBLIC_URL" && "$current" != "$PUBLIC_URL" ]]; then
            print_warning "Your .env already sets FRONTEND_URL=$current — keeping it"
        fi
        return 0
    fi
    if [[ -n "$PUBLIC_URL" ]]; then
        write_frontend_url "$env_file" "$PUBLIC_URL"
        print_info "Set FRONTEND_URL=$PUBLIC_URL in .env"
    fi
}

# Printed with the closing instructions of both deployment paths.
warn_if_frontend_url_is_loopback() {
    local current
    current=$(sed -n 's/^[[:space:]]*FRONTEND_URL=//p' "$SCRIPT_DIR/.env" | tail -n 1)
    if frontend_url_is_loopback "$current"; then
        print_warning "FRONTEND_URL is '${current}', so password resets, ballots and reminders"
        print_warning "will link to this machine only. Set FRONTEND_URL in .env to the address"
        print_warning "members use, then restart the backend."
    fi
}

check_root() {
    if [[ $EUID -eq 0 ]]; then
        print_error "This script should NOT be run as root"
        print_info "Please run as a regular user with sudo privileges"
        exit 1
    fi
}

check_sudo() {
    if ! sudo -v; then
        print_error "Sudo privileges required"
        exit 1
    fi
}

check_os() {
    if [[ ! -f /etc/os-release ]]; then
        print_error "Cannot detect OS. This script supports Ubuntu/Debian only."
        exit 1
    fi

    . /etc/os-release
    if [[ "$ID" != "ubuntu" && "$ID" != "debian" ]]; then
        print_error "This script supports Ubuntu/Debian only. Detected: $ID"
        exit 1
    fi

    print_success "OS detected: $PRETTY_NAME"
}

# ============================================
# Installation Methods
# ============================================

install_docker() {
    print_header "Installing Docker"

    if command -v docker &> /dev/null; then
        print_success "Docker already installed ($(docker --version))"
    else
        print_info "Installing Docker..."

        # Update packages
        sudo apt-get update

        # Install dependencies
        sudo apt-get install -y \
            apt-transport-https \
            ca-certificates \
            curl \
            gnupg \
            lsb-release

        # Add Docker GPG key
        sudo mkdir -p /etc/apt/keyrings
        curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

        # Add Docker repository
        echo \
          "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
          $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

        # Install Docker
        sudo apt-get update
        sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

        # Add current user to docker group
        sudo usermod -aG docker $USER

        print_success "Docker installed successfully"
        print_warning "You may need to log out and back in for group changes to take effect"
    fi
}

install_docker_compose() {
    print_header "Installing Docker Compose"

    if command -v docker compose &> /dev/null; then
        print_success "Docker Compose already installed"
    else
        print_info "Installing Docker Compose..."

        # Install Docker Compose plugin
        sudo apt-get update
        sudo apt-get install -y docker-compose-plugin

        print_success "Docker Compose installed successfully"
    fi
}

setup_environment() {
    print_header "Setting Up Environment"

    if [[ -f "$SCRIPT_DIR/.env" ]]; then
        print_warning ".env file already exists"
        read -p "Do you want to overwrite it? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_info "Keeping existing .env file"
            # The deployment below is safe either way — it passes -f for both
            # compose files explicitly — but the management commands the
            # operator runs afterwards (logs/restart/down/update) are bare
            # `docker compose` calls that read COMPOSE_FILE from .env. A
            # preserved .env may predate that pin, so append it when ABSENT.
            # Append-only: an existing value is the operator's and is never
            # rewritten, and no other line (secrets included) is touched.
            if ! grep -qE '^[[:space:]]*COMPOSE_FILE=' "$SCRIPT_DIR/.env"; then
                cat >> "$SCRIPT_DIR/.env" <<'EOF'

# Added by the installer: pin the production override so bare
# `docker compose ...` commands in this directory layer
# docker-compose.prod.yml on the development base file.
COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml
EOF
                print_info "Added COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml to .env"
            elif ! grep -qE '^[[:space:]]*COMPOSE_FILE=.*docker-compose\.prod\.yml' "$SCRIPT_DIR/.env"; then
                print_warning "Your .env sets COMPOSE_FILE without docker-compose.prod.yml."
                print_warning "This installer still deploys the production stack (it passes -f"
                print_warning "explicitly), but your own bare \`docker compose\` commands will"
                print_warning "start the development posture (uvicorn --reload, published"
                print_warning "backend port, docs on)."
            fi
            # Never modify a config the operator already customized — but do
            # tell them when it cannot boot: docker-compose.prod.yml defaults
            # SECURITY_REQUIRE_TLS to true, and the backend refuses to start
            # in production when TLS to MySQL/Redis is required but not
            # configured. The bundled services do not terminate TLS.
            if ! grep -qE '^[[:space:]]*SECURITY_REQUIRE_TLS=' "$SCRIPT_DIR/.env"; then
                print_warning "Your existing .env does not set SECURITY_REQUIRE_TLS."
                print_warning "The production override defaults it to TRUE, and the backend"
                print_warning "will REFUSE TO START because the bundled MySQL/Redis do not"
                print_warning "terminate TLS. Either configure TLS (DB_SSL/DB_SSL_CA and"
                print_warning "REDIS_SSL/REDIS_SSL_CA, then SECURITY_REQUIRE_TLS=true) or add"
                print_warning "an explicit SECURITY_REQUIRE_TLS=false to .env for the bundled"
                print_warning "plaintext services (traffic stays on the internal Docker network)."
            fi
            prompt_public_url
            reconcile_frontend_url "$SCRIPT_DIR/.env"
            return
        fi
    fi

    print_info "Copying .env.example to .env..."
    cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"

    print_info "Generating secure secrets..."

    # Generate SECRET_KEY (64 characters)
    SECRET_KEY=$(openssl rand -hex 32)
    sed -i "s|SECRET_KEY=.*|SECRET_KEY=$SECRET_KEY|" "$SCRIPT_DIR/.env"

    # Generate ENCRYPTION_KEY (32 bytes hex = 64 characters)
    ENCRYPTION_KEY=$(openssl rand -hex 32)
    sed -i "s|ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$ENCRYPTION_KEY|" "$SCRIPT_DIR/.env"

    # Generate ENCRYPTION_SALT (16 bytes hex = 32 characters)
    ENCRYPTION_SALT=$(openssl rand -hex 16)
    sed -i "s|ENCRYPTION_SALT=.*|ENCRYPTION_SALT=$ENCRYPTION_SALT|" "$SCRIPT_DIR/.env"

    # Generate DB_PASSWORD
    DB_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
    sed -i "s|DB_PASSWORD=.*|DB_PASSWORD=$DB_PASSWORD|" "$SCRIPT_DIR/.env"

    # Generate MYSQL_ROOT_PASSWORD
    MYSQL_ROOT_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
    sed -i "s|MYSQL_ROOT_PASSWORD=.*|MYSQL_ROOT_PASSWORD=$MYSQL_ROOT_PASSWORD|" "$SCRIPT_DIR/.env"

    # Generate REDIS_PASSWORD
    REDIS_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
    sed -i "s|REDIS_PASSWORD=.*|REDIS_PASSWORD=$REDIS_PASSWORD|" "$SCRIPT_DIR/.env"

    # Set environment to production
    sed -i "s|ENVIRONMENT=.*|ENVIRONMENT=production|" "$SCRIPT_DIR/.env"
    sed -i "s|DEBUG=.*|DEBUG=false|" "$SCRIPT_DIR/.env"

    # Pin the production compose override in .env so that every bare
    # `docker compose ...` invocation (this installer AND the management
    # commands in the docs — logs/restart/down/update) automatically layers
    # docker-compose.prod.yml. Without this, a plain `docker compose up -d`
    # would silently apply the base file's development posture.
    if ! grep -q '^COMPOSE_FILE=' "$SCRIPT_DIR/.env"; then
        echo "COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml" >> "$SCRIPT_DIR/.env"
    else
        sed -i "s|^COMPOSE_FILE=.*|COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml|" "$SCRIPT_DIR/.env"
    fi

    # Transport TLS posture. docker-compose.prod.yml fails closed
    # (SECURITY_REQUIRE_TLS defaults to true) and the backend then refuses to
    # start unless DB_SSL/REDIS_SSL are configured — but the bundled MySQL and
    # Redis containers do NOT terminate TLS, so a fresh bundled install could
    # never boot. Write the opt-out explicitly and loudly instead of shipping
    # an unbootable config. This only runs on a freshly generated .env — an
    # existing operator-customized .env is never modified (see above).
    if ! grep -qE '^[[:space:]]*SECURITY_REQUIRE_TLS=' "$SCRIPT_DIR/.env"; then
        cat >> "$SCRIPT_DIR/.env" <<'EOF'

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
EOF
        print_warning "SECURITY_REQUIRE_TLS=false written to .env: the bundled MySQL/Redis"
        print_warning "do not terminate TLS, so DB/cache traffic on the internal Docker"
        print_warning "network is NOT encrypted. If you use external data services, enable"
        print_warning "DB_SSL/REDIS_SSL (+ CA certs) and set SECURITY_REQUIRE_TLS=true."
    fi

    # Every link the app emails is built from FRONTEND_URL; .env.example ships
    # it as localhost.
    prompt_public_url
    if [[ -n "$PUBLIC_URL" ]]; then
        write_frontend_url "$SCRIPT_DIR/.env" "$PUBLIC_URL"
        print_info "Set FRONTEND_URL=$PUBLIC_URL in .env"
    fi

    print_success "Environment configured with secure secrets"
    print_warning "Please review and update .env file with your specific settings"
}

docker_deployment() {
    print_header "Docker Deployment"

    install_docker
    install_docker_compose
    setup_environment

    print_info "Building and starting containers..."
    cd "$SCRIPT_DIR"

    # setup_environment writes ENVIRONMENT=production to .env, so deploy with the
    # production override layered on top of the base file. Without it the base
    # file's development posture (uvicorn --reload, published backend port, docs
    # enabled, no HTTPS/TLS enforcement) would apply and the startup security
    # gate would be skipped. The override disables --reload/docs and enforces
    # HTTPS/TLS for a hardened install.
    local COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml"

    # Build images
    docker compose $COMPOSE_FILES build

    # Start services
    docker compose $COMPOSE_FILES up -d

    print_success "Docker containers started"

    # Wait for services to be healthy
    print_info "Waiting for services to be ready..."
    sleep 10

    # Run database migrations
    print_info "Running database migrations..."
    docker compose $COMPOSE_FILES exec -T backend alembic upgrade head

    print_success "Installation complete!"
    print_info "Access the application at: http://localhost:3000"
    print_info "(The backend sits behind the frontend/reverse proxy and is not"
    print_info " published to the host in the production configuration.)"

    print_warning "\nIMPORTANT: Please complete the following steps:"
    print_info "1. Review and update .env file with your organization settings"
    print_info "2. Configure SSL/HTTPS for production (see docs/DEPLOYMENT.md)"
    print_info "3. Set up automated backups (see docs/BACKUP.md)"
    print_info "4. Review security settings in .env"
    warn_if_frontend_url_is_loopback
}

traditional_deployment() {
    print_header "Traditional Server Deployment"

    print_info "Installing system dependencies..."
    sudo apt-get update
    sudo apt-get install -y \
        python3.10 \
        python3-pip \
        python3-venv \
        mysql-server \
        redis-server \
        nginx \
        certbot \
        python3-certbot-nginx \
        git \
        nodejs \
        npm

    setup_environment

    # Setup Python virtual environment
    print_info "Setting up Python virtual environment..."
    cd "$SCRIPT_DIR/backend"
    python3 -m venv venv
    source venv/bin/activate
    pip install --upgrade pip
    pip install -r requirements.txt

    # Setup database
    print_info "Setting up MySQL database..."
    sudo mysql -e "CREATE DATABASE IF NOT EXISTS intranet_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
    sudo mysql -e "CREATE USER IF NOT EXISTS 'intranet_user'@'localhost' IDENTIFIED BY '$(grep DB_PASSWORD "$SCRIPT_DIR/.env" | cut -d'=' -f2)';"
    sudo mysql -e "GRANT ALL PRIVILEGES ON intranet_db.* TO 'intranet_user'@'localhost';"
    sudo mysql -e "FLUSH PRIVILEGES;"

    # Run migrations
    print_info "Running database migrations..."
    alembic upgrade head

    # Setup frontend
    print_info "Building frontend..."
    cd "$SCRIPT_DIR/frontend"
    npm install
    npm run build

    # Setup systemd services
    print_info "Setting up systemd services..."

    # Backend service
    sudo tee /etc/systemd/system/logbook-backend.service > /dev/null <<EOF
[Unit]
Description=The Logbook Backend API
After=network.target mysql.service redis.service

[Service]
Type=simple
User=$USER
WorkingDirectory=$SCRIPT_DIR/backend
Environment="PATH=$SCRIPT_DIR/backend/venv/bin"
EnvironmentFile=$SCRIPT_DIR/.env
ExecStart=$SCRIPT_DIR/backend/venv/bin/uvicorn main:app --host 0.0.0.0 --port 3001
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

    # Start services
    sudo systemctl daemon-reload
    sudo systemctl enable logbook-backend
    sudo systemctl start logbook-backend

    print_success "Installation complete!"
    print_warning "\nNext steps:"
    print_info "1. Configure Nginx (see docs/DEPLOYMENT.md)"
    print_info "2. Set up SSL with: sudo certbot --nginx -d yourdomain.com"
    print_info "3. Configure firewall"
    print_info "4. Set up automated backups"
    warn_if_frontend_url_is_loopback
}

show_help() {
    cat << EOF
The Logbook - Automated Installation Script

Usage:
    ./install.sh [OPTIONS]

Options:
    --docker            Install using Docker (recommended for beginners)
    --traditional       Install directly on server
    --public-url <url>  Address members open the site at (for example
                        https://logbook.example.org). Written to FRONTEND_URL,
                        which every link in outgoing email is built from.
                        Also read from LOGBOOK_PUBLIC_URL; asked for
                        interactively when neither is given.
    --help              Show this help message

Interactive Mode:
    Run without options for interactive installation

Examples:
    ./install.sh                    # Interactive mode
    ./install.sh --docker           # Docker installation
    ./install.sh --traditional      # Traditional installation
    ./install.sh --docker --public-url https://logbook.example.org

For more information, see docs/DEPLOYMENT.md
EOF
}

# ============================================
# Main Script
# ============================================

# --public-url may appear anywhere; everything else is passed on unchanged so
# the mode handling below keeps its existing one-argument behaviour.
MODE_ARGS=()
extract_public_url_arg() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --public-url)
                if [[ $# -lt 2 || -z "$2" ]]; then
                    print_error "--public-url needs a value, for example --public-url https://logbook.example.org"
                    exit 1
                fi
                PUBLIC_URL="$2"
                shift 2
                ;;
            *)
                MODE_ARGS+=("$1")
                shift
                ;;
        esac
    done
}

main() {
    extract_public_url_arg "$@"
    set -- "${MODE_ARGS[@]}"

    # Validated before anything is installed, so a mistyped address fails fast.
    PUBLIC_URL="${PUBLIC_URL%/}"
    if [[ -n "$PUBLIC_URL" ]]; then
        validate_public_url "$PUBLIC_URL" || exit 1
    fi

    print_header "THE LOGBOOK - INSTALLATION"

    check_root
    check_sudo
    check_os

    # Parse arguments
    if [[ $# -eq 0 ]]; then
        # Interactive mode
        echo "Choose installation method:"
        echo "1) Docker (Recommended - Easy setup, containerized)"
        echo "2) Traditional (Direct installation on server)"
        echo "3) Exit"
        read -p "Enter choice [1-3]: " choice

        case $choice in
            1)
                docker_deployment
                ;;
            2)
                traditional_deployment
                ;;
            3)
                exit 0
                ;;
            *)
                print_error "Invalid choice"
                exit 1
                ;;
        esac
    else
        # Command-line mode
        case "$1" in
            --docker)
                docker_deployment
                ;;
            --traditional)
                traditional_deployment
                ;;
            --help|-h)
                show_help
                ;;
            *)
                print_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    fi
}

# Run main function
main "$@"
