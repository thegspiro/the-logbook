#!/bin/bash

# ============================================
# THE LOGBOOK - SSL/HTTPS SETUP SCRIPT
# ============================================
# Automates SSL certificate setup with Let's Encrypt
# Configures Nginx for HTTPS
#
# Usage:
#   ./setup-ssl.sh yourdomain.com admin@yourdomain.com
#
# Requirements:
#   - Domain name pointing to this server
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

# Check arguments
if [[ $# -lt 2 ]]; then
    print_error "Usage: $0 <domain> <email>"
    echo "Example: $0 yourdomain.com admin@yourdomain.com"
    exit 1
fi

DOMAIN="$1"
EMAIL="$2"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Check if running as root or with sudo
if [[ $EUID -ne 0 ]]; then
    print_error "This script must be run with sudo"
    exit 1
fi

print_info "Setting up SSL for $DOMAIN..."

# Install certbot if not installed
if ! command -v certbot &> /dev/null; then
    print_info "Installing certbot..."
    apt-get update
    apt-get install -y certbot python3-certbot-nginx
    print_success "Certbot installed"
else
    print_success "Certbot already installed"
fi

# Create certbot directory
mkdir -p /var/www/certbot

# Update nginx configuration with domain
print_info "Updating Nginx configuration..."

cp "$PROJECT_DIR/infrastructure/nginx/nginx.conf" /etc/nginx/sites-available/logbook

# Replace placeholder domain
sed -i "s/yourdomain.com/$DOMAIN/g" /etc/nginx/sites-available/logbook

# Enable site
ln -sf /etc/nginx/sites-available/logbook /etc/nginx/sites-enabled/

# Test nginx configuration
if nginx -t; then
    print_success "Nginx configuration valid"
else
    print_error "Nginx configuration invalid"
    exit 1
fi

# Reload nginx
systemctl reload nginx
print_success "Nginx reloaded"

# Obtain SSL certificate
print_info "Obtaining SSL certificate from Let's Encrypt..."
print_warning "Make sure DNS records for $DOMAIN point to this server"
read -p "Press Enter to continue..."

certbot --nginx \
    -d "$DOMAIN" \
    -d "www.$DOMAIN" \
    --non-interactive \
    --agree-tos \
    --email "$EMAIL" \
    --redirect

print_success "SSL certificate obtained and installed"

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

For more information, see docs/SECURITY.md
EOF
