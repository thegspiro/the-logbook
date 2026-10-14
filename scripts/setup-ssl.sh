#!/bin/bash

# ============================================
# THE LOGBOOK - SSL/HTTPS SETUP SCRIPT
# ============================================
# Automates SSL certificate setup with Let's Encrypt
# Configures Nginx for HTTPS
#
# Usage:
#   ./setup-ssl.sh yourdomain.com admin@yourdomain.com [--docker|--traditional]
#
# The nginx on this host terminates TLS for one of two layouts, detected
# automatically or named with a flag:
#   --docker       the Compose stack: everything goes to the frontend container
#                  on port 3000, which forwards /api itself (the production
#                  override does not publish the backend's 3001)
#   --traditional  install.sh --traditional: the built frontend is served from
#                  frontend/dist on 127.0.0.1:3000 and /api goes to the backend
#                  on 127.0.0.1:3001
#
# Requirements:
#   - Domain name (and www.<domain>) pointing to this server
#   - Nginx installed
#   - Port 80 and 443 open
# ============================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_error() { echo -e "${RED}✗ $1${NC}"; }
print_warning() { echo -e "${YELLOW}⚠ $1${NC}"; }
print_info() { echo -e "${BLUE}ℹ $1${NC}"; }

usage() {
    print_error "Usage: $0 <domain> <email> [--docker|--traditional]"
    echo "Example: $0 yourdomain.com admin@yourdomain.com"
}

# The domain is substituted into nginx config with sed, so it must be a plain
# hostname: letters, digits, dots and hyphens.
valid_domain() {
    [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$ ]]
}

# install.sh --traditional writes this unit; the Compose stack names its
# frontend container intranet-frontend.
detect_mode() {
    if [[ -f /etc/systemd/system/logbook-backend.service ]]; then
        echo traditional
        return 0
    fi
    if command -v docker >/dev/null 2>&1 \
        && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx intranet-frontend; then
        echo docker
        return 0
    fi
    return 1
}

# Port 80 only, answering the ACME challenge, so certbot can issue the
# certificate before the HTTPS server block (which names the certificate
# files) is installed; `nginx -t` rejects that block while they are missing.
render_acme_config() {
    local domain="$1"
    cat <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $domain www.$domain;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 404;
    }
}
EOF
}

# The host config, for either layout. In Docker mode the backend is reachable
# only through the frontend container, whose nginx already forwards /api,
# /health and the docs, so the API upstream points at 3000 as well.
render_site_config() {
    local mode="$1" domain="$2" project_dir="$3"
    local upstream_api="127.0.0.1:3001"
    [[ "$mode" == "docker" ]] && upstream_api="127.0.0.1:3000"
    sed -e "s/yourdomain\.com/$domain/g" \
        -e "s/^    server 127\.0\.0\.1:3001 max_fails/    server $upstream_api max_fails/" \
        "$project_dir/infrastructure/nginx/nginx.conf"
}

# Traditional mode only: the frontend container's own config, run on the host
# so the built app is served on 127.0.0.1:3000 with the same caching, PWA and
# branded-icon rules it has in Docker. Three adjustments beyond the addresses:
# the map variable is renamed so each site keeps its own definition rather
# than both sharing the host config's name; the `main` log format exists in the nginx:alpine image but not in a
# Debian/Ubuntu nginx, so the built-in `combined` is used; and it logs to its
# own file, since the public-facing site already logs every request.
render_frontend_config() {
    local project_dir="$1"
    sed -e 's/^    listen 80;/    listen 127.0.0.1:3000;/' \
        -e "s#root /usr/share/nginx/html;#root $project_dir/frontend/dist;#" \
        -e 's#http://backend:3001#http://127.0.0.1:3001#g' \
        -e 's/\$access_loggable/$frontend_access_loggable/g' \
        -e 's#access_log /var/log/nginx/access.log main #access_log /var/log/nginx/logbook_frontend_access.log combined #' \
        "$project_dir/frontend/nginx.conf"
}

reload_nginx() {
    if nginx -t; then
        print_success "Nginx configuration valid"
    else
        print_error "Nginx configuration invalid"
        exit 1
    fi
    systemctl reload nginx
    print_success "Nginx reloaded"
}

main() {
    local mode=""
    local positional=()
    for arg in "$@"; do
        case "$arg" in
            --docker) mode="docker" ;;
            --traditional) mode="traditional" ;;
            -*) usage; exit 1 ;;
            *) positional+=("$arg") ;;
        esac
    done
    if [[ ${#positional[@]} -ne 2 ]]; then
        usage
        exit 1
    fi

    DOMAIN="${positional[0]}"
    EMAIL="${positional[1]}"
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

    if ! valid_domain "$DOMAIN"; then
        print_error "'$DOMAIN' is not a valid domain name (example: logbook.yourdept.org)"
        exit 1
    fi

    # Check if running as root or with sudo
    if [[ $EUID -ne 0 ]]; then
        print_error "This script must be run with sudo"
        exit 1
    fi

    if [[ -z "$mode" ]] && ! mode="$(detect_mode)"; then
        print_error "Could not tell how The Logbook is installed on this server."
        print_error "Run again with --docker (Compose stack) or --traditional (install.sh --traditional)."
        exit 1
    fi
    print_info "Configuring nginx for the $mode installation"

    if [[ "$mode" == "traditional" ]]; then
        local dist="$PROJECT_DIR/frontend/dist"
        if [[ ! -f "$dist/index.html" ]]; then
            print_error "$dist/index.html not found. Build the frontend first:"
            print_error "  cd $PROJECT_DIR/frontend && npm run build"
            exit 1
        fi
        # nginx's workers run as www-data and must be able to read the build,
        # which a home directory's default permissions often prevent.
        if id www-data >/dev/null 2>&1 \
            && ! runuser -u www-data -- test -r "$dist/index.html"; then
            print_error "nginx (www-data) cannot read $dist."
            print_error "Give it access to the directories above it (e.g. chmod o+x on each), or move the install."
            exit 1
        fi
    fi

    print_info "Setting up SSL for $DOMAIN..."

    # Install certbot if not installed
    if ! command -v certbot &> /dev/null; then
        print_info "Installing certbot..."
        apt-get update
        apt-get install -y certbot
        print_success "Certbot installed"
    else
        print_success "Certbot already installed"
    fi

    mkdir -p /var/www/certbot

    # Obtain the certificate first, over a port-80-only site.
    if [[ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]]; then
        print_info "Obtaining SSL certificate from Let's Encrypt..."
        print_warning "Make sure DNS records for $DOMAIN and www.$DOMAIN point to this server"
        read -r -p "Press Enter to continue..."

        render_acme_config "$DOMAIN" > /etc/nginx/sites-available/logbook
        ln -sf /etc/nginx/sites-available/logbook /etc/nginx/sites-enabled/
        reload_nginx

        certbot certonly --webroot \
            -w /var/www/certbot \
            -d "$DOMAIN" \
            -d "www.$DOMAIN" \
            --non-interactive \
            --agree-tos \
            --email "$EMAIL"
        print_success "SSL certificate obtained"
    else
        print_success "Certificate for $DOMAIN already present"
    fi

    # Install the full configuration, now that the certificate exists.
    print_info "Updating Nginx configuration..."
    render_site_config "$mode" "$DOMAIN" "$PROJECT_DIR" > /etc/nginx/sites-available/logbook
    ln -sf /etc/nginx/sites-available/logbook /etc/nginx/sites-enabled/
    if [[ "$mode" == "traditional" ]]; then
        render_frontend_config "$PROJECT_DIR" > /etc/nginx/sites-available/logbook-frontend
        ln -sf /etc/nginx/sites-available/logbook-frontend /etc/nginx/sites-enabled/
    else
        rm -f /etc/nginx/sites-enabled/logbook-frontend
    fi
    reload_nginx

    # Set up automatic renewal
    print_info "Setting up automatic certificate renewal..."

    # Create systemd timer for renewal
    cat > /etc/systemd/system/certbot-renewal.service <<'EOF'
[Unit]
Description=Certbot Renewal

[Service]
Type=oneshot
ExecStart=/usr/bin/certbot renew --quiet --post-hook "systemctl reload nginx"
EOF

    cat > /etc/systemd/system/certbot-renewal.timer <<'EOF'
[Unit]
Description=Run certbot renewal twice daily

[Timer]
OnCalendar=*-*-* 00,12:00:00
RandomizedDelaySec=3600
Persistent=true

[Install]
WantedBy=timers.target
EOF

    # Enable and start timer
    systemctl daemon-reload
    systemctl enable certbot-renewal.timer
    systemctl start certbot-renewal.timer

    print_success "Automatic renewal configured"

    # Test certificate
    print_info "Testing SSL configuration..."

    if openssl s_client -connect "$DOMAIN:443" -servername "$DOMAIN" </dev/null 2>/dev/null | grep -q "Verify return code: 0"; then
        print_success "SSL certificate is valid and properly installed"
    else
        print_warning "SSL certificate validation returned warnings (this may be normal initially)"
    fi

    # Display certificate info
    certbot certificates

    print_success "SSL setup complete!"
    print_info "Your site is now accessible at: https://$DOMAIN"
    print_info "Certificate will auto-renew before expiration"

    # Security recommendations
    cat <<EOF

${BLUE}========================================${NC}
${BLUE}Security Recommendations${NC}
${BLUE}========================================${NC}

1. Test your SSL configuration:
   https://www.ssllabs.com/ssltest/analyze.html?d=$DOMAIN

2. Enable HSTS preloading:
   https://hstspreload.org/

3. Configure firewall:
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   sudo ufw enable

4. Set up monitoring:
   - Monitor certificate expiration
   - Set up log monitoring
   - Enable intrusion detection

5. Regular maintenance:
   - Update system packages regularly
   - Review nginx logs
   - Monitor for suspicious activity

For more information, see SECURITY.md in the repository root
EOF
}

# Run only when executed, so the functions above can be sourced by tests.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
