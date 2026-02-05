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

    # Build images
    docker compose build

    # Start services
    docker compose up -d

    print_success "Docker containers started"

    # Wait for services to be healthy
    print_info "Waiting for services to be ready..."
    sleep 10

    # Run database migrations
    print_info "Running database migrations..."
    docker compose exec -T backend alembic upgrade head

    print_success "Installation complete!"
    print_info "Access the application at: http://localhost:3000"
    print_info "Backend API at: http://localhost:3001"

    print_warning "\nIMPORTANT: Please complete the following steps:"
    print_info "1. Review and update .env file with your organization settings"
    print_info "2. Configure SSL/HTTPS for production (see docs/DEPLOYMENT.md)"
    print_info "3. Set up automated backups (see docs/BACKUP.md)"
    print_info "4. Review security settings in .env"
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
}

show_help() {
    cat << EOF
The Logbook - Automated Installation Script

Usage:
    ./install.sh [OPTIONS]

Options:
    --docker        Install using Docker (recommended for beginners)
    --traditional   Install directly on server
    --help          Show this help message

Interactive Mode:
    Run without options for interactive installation

Examples:
    ./install.sh                    # Interactive mode
    ./install.sh --docker           # Docker installation
    ./install.sh --traditional      # Traditional installation

For more information, see docs/DEPLOYMENT.md
EOF
}

# ============================================
# Main Script
# ============================================

main() {
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
