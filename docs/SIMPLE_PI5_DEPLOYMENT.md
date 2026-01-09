# 🚀 Ultra-Simple Raspberry Pi 5 Deployment

## Fire Department Intranet - One-Command Installation

**Total time: 20 minutes** (mostly automated)

---

## 🎯 The Simplest Way

We've created a **single installation script** that does everything automatically:

```bash
# Just run this one command:
curl -sSL https://raw.githubusercontent.com/thegspiro/fd-intranet/main/install-pi.sh | sudo bash
```

That's it! The script handles:
- ✅ System updates
- ✅ Installing all dependencies
- ✅ Database setup
- ✅ Application configuration
- ✅ Web server setup
- ✅ Automatic backups
- ✅ Security hardening

---

## 📦 What You Need

### Hardware (Buy Once, ~$150):
- 🍓 Raspberry Pi 5 (8GB) - $80
- 💾 128GB SSD + USB enclosure - $30
- 🔌 Official 27W power supply - $12
- 🌡️ Active cooling case - $15
- 🔌 Ethernet cable - $10

**Total: ~$150**

### Before You Start:
1. Flash Raspberry Pi OS Lite (64-bit) to SD card using Raspberry Pi Imager
2. Enable SSH in imager settings
3. Set hostname: `fdintranet`
4. Boot the Pi and SSH in

---

## 🚀 Quick Start Guide

### Step 1: Initial Setup (5 minutes)

Flash the OS using Raspberry Pi Imager:

1. **Download**: https://www.raspberrypi.com/software/
2. **Choose OS**: Raspberry Pi OS Lite (64-bit)
3. **Settings** (gear icon):
   - Hostname: `fdintranet`
   - Enable SSH
   - Username: `pi`
   - Password: [your password]
   - WiFi: [optional, use ethernet instead]
4. **Write** to SD card
5. **Boot Pi** and find its IP address

### Step 2: Run the Installer (15 minutes)

SSH into your Pi:
```bash
ssh pi@fdintranet.local
```

Run the automated installer:
```bash
curl -sSL https://raw.githubusercontent.com/thegspiro/fd-intranet/main/install-pi.sh | sudo bash
```

The installer will ask you a few questions:
```
1. What domain/hostname? (default: fdintranet.local)
2. Email for notifications? (e.g., chief@firedept.org)
3. Admin password? (for Django superuser)
```

Then sit back while it:
- ⏳ Updates system (2 min)
- ⏳ Installs packages (5 min)
- ⏳ Configures database (1 min)
- ⏳ Sets up application (3 min)
- ⏳ Configures web server (1 min)
- ⏳ Tests everything (1 min)

### Step 3: Access Your Intranet

```
🌐 http://fdintranet.local
📧 Login with email and password you set
```

**Done!** 🎉

---

## 📝 The Installation Script

Here's what the automated script does (you can review it before running):

```bash
#!/bin/bash
################################################################################
# Fire Department Intranet - Raspberry Pi 5 Auto-Installer
# One-command deployment for Raspberry Pi 5
################################################################################

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Functions
print_status() { echo -e "${GREEN}[✓]${NC} $1"; }
print_error() { echo -e "${RED}[✗]${NC} $1"; }
print_info() { echo -e "${BLUE}[i]${NC} $1"; }

# Banner
clear
cat << "EOF"
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🚒  Fire Department Intranet - Pi 5 Installer  🚒      ║
║                                                           ║
║   Automated deployment for Raspberry Pi 5                ║
║   Installation time: ~15 minutes                         ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
EOF

echo ""
print_info "Starting installation..."
echo ""

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   print_error "This script must be run as root (use sudo)"
   exit 1
fi

# Check if Raspberry Pi 5
if ! grep -q "Raspberry Pi 5" /proc/cpuinfo; then
    print_error "This script is optimized for Raspberry Pi 5"
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Get configuration
echo ""
print_info "Configuration"
echo ""

read -p "Domain/hostname [fdintranet.local]: " DOMAIN
DOMAIN=${DOMAIN:-fdintranet.local}

read -p "Admin email address: " ADMIN_EMAIL
while [[ ! "$ADMIN_EMAIL" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; do
    print_error "Invalid email format"
    read -p "Admin email address: " ADMIN_EMAIL
done

read -sp "Django admin password: " ADMIN_PASSWORD
echo ""
while [[ ${#ADMIN_PASSWORD} -lt 8 ]]; do
    print_error "Password must be at least 8 characters"
    read -sp "Django admin password: " ADMIN_PASSWORD
    echo ""
done

# Generate secrets
DB_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(50))")

echo ""
print_status "Configuration complete!"
echo ""

# Update system
print_info "Updating system packages..."
apt update -qq && apt upgrade -y -qq
print_status "System updated"

# Install dependencies
print_info "Installing dependencies (this takes ~5 minutes)..."
apt install -y -qq \
    python3-full \
    python3-pip \
    python3-venv \
    postgresql \
    postgresql-contrib \
    redis-server \
    nginx \
    git \
    supervisor \
    ufw \
    build-essential \
    libpq-dev \
    python3-dev \
    curl \
    htop

print_status "Dependencies installed"

# Configure PostgreSQL
print_info "Setting up database..."
systemctl start postgresql
systemctl enable postgresql

sudo -u postgres psql -c "CREATE DATABASE fd_intranet;" 2>/dev/null || true
sudo -u postgres psql -c "CREATE USER fdapp WITH PASSWORD '$DB_PASSWORD';" 2>/dev/null || true
sudo -u postgres psql -c "ALTER ROLE fdapp SET client_encoding TO 'utf8';"
sudo -u postgres psql -c "ALTER ROLE fdapp SET default_transaction_isolation TO 'read committed';"
sudo -u postgres psql -c "ALTER ROLE fdapp SET timezone TO 'UTC';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE fd_intranet TO fdapp;"

# Optimize PostgreSQL for Pi 5
cat > /etc/postgresql/15/main/conf.d/pi5-optimization.conf << 'PGCONF'
# Raspberry Pi 5 (8GB) Optimizations
shared_buffers = 1GB
effective_cache_size = 2GB
maintenance_work_mem = 128MB
work_mem = 4MB
max_connections = 50
wal_buffers = 8MB
checkpoint_completion_target = 0.9
random_page_cost = 1.1
effective_io_concurrency = 200
PGCONF

systemctl restart postgresql
print_status "Database configured"

# Create application user
print_info "Creating application user..."
useradd -r -s /bin/bash -d /opt/fd-intranet -m fdapp 2>/dev/null || true
print_status "Application user created"

# Clone repository
print_info "Downloading application..."
if [ -d "/opt/fd-intranet/app" ]; then
    rm -rf /opt/fd-intranet/app
fi

sudo -u fdapp git clone -q https://github.com/thegspiro/fd-intranet.git /opt/fd-intranet/app
cd /opt/fd-intranet/app
print_status "Application downloaded"

# Set up Python environment
print_info "Setting up Python environment..."
sudo -u fdapp python3 -m venv /opt/fd-intranet/app/venv
sudo -u fdapp /opt/fd-intranet/app/venv/bin/pip install -q --upgrade pip
sudo -u fdapp /opt/fd-intranet/app/venv/bin/pip install -q -r requirements.txt
sudo -u fdapp /opt/fd-intranet/app/venv/bin/pip install -q gunicorn psycopg2-binary
print_status "Python environment ready"

# Create .env file
print_info "Creating configuration file..."
cat > /opt/fd-intranet/app/.env << ENVFILE
# Auto-generated by installer
SECRET_KEY='$SECRET_KEY'
DEBUG=False
ALLOWED_HOSTS='$DOMAIN,localhost,127.0.0.1'

# Database
DATABASE_URL=postgresql://fdapp:$DB_PASSWORD@localhost:5432/fd_intranet

# Redis
REDIS_URL=redis://127.0.0.1:6379/0

# Email (configure later in admin panel)
EMAIL_BACKEND=django.core.mail.backends.console.EmailBackend

# Performance
GUNICORN_WORKERS=3
GUNICORN_TIMEOUT=120

# Installed on
INSTALL_DATE=$(date)
INSTALLED_ON=Raspberry Pi 5
ENVFILE

chown fdapp:fdapp /opt/fd-intranet/app/.env
chmod 600 /opt/fd-intranet/app/.env
print_status "Configuration created"

# Run Django setup
print_info "Setting up Django..."
cd /opt/fd-intranet/app

sudo -u fdapp /opt/fd-intranet/app/venv/bin/python manage.py makemigrations --noinput
sudo -u fdapp /opt/fd-intranet/app/venv/bin/python manage.py migrate --noinput
sudo -u fdapp /opt/fd-intranet/app/venv/bin/python manage.py collectstatic --noinput

# Create superuser
print_info "Creating admin user..."
sudo -u fdapp /opt/fd-intranet/app/venv/bin/python manage.py shell << PYEOF
from django.contrib.auth import get_user_model
User = get_user_model()
if not User.objects.filter(email='$ADMIN_EMAIL').exists():
    User.objects.create_superuser('admin', '$ADMIN_EMAIL', '$ADMIN_PASSWORD')
PYEOF

print_status "Django configured"

# Set up directories
mkdir -p /opt/fd-intranet/{logs,backups,config}
chown -R fdapp:fdapp /opt/fd-intranet

# Create Gunicorn config
cat > /opt/fd-intranet/config/gunicorn_config.py << 'GUNICORN'
import multiprocessing

workers = 3
worker_class = 'sync'
worker_connections = 50
max_requests = 500
max_requests_jitter = 50
timeout = 120
keepalive = 5
bind = '127.0.0.1:8000'
accesslog = '/opt/fd-intranet/logs/gunicorn_access.log'
errorlog = '/opt/fd-intranet/logs/gunicorn_error.log'
loglevel = 'warning'
proc_name = 'fd_intranet'
pidfile = '/opt/fd-intranet/gunicorn.pid'
user = 'fdapp'
group = 'fdapp'
worker_tmp_dir = '/dev/shm'
GUNICORN

# Configure Supervisor
cat > /etc/supervisor/conf.d/fd-intranet.conf << 'SUPERVISOR'
[program:fd_intranet]
command=/opt/fd-intranet/app/venv/bin/gunicorn core.wsgi:application -c /opt/fd-intranet/config/gunicorn_config.py
directory=/opt/fd-intranet/app
user=fdapp
autostart=true
autorestart=true
redirect_stderr=true
stdout_logfile=/opt/fd-intranet/logs/gunicorn.log
environment=PATH="/opt/fd-intranet/app/venv/bin"

[program:fd_qcluster]
command=/opt/fd-intranet/app/venv/bin/python manage.py qcluster
directory=/opt/fd-intranet/app
user=fdapp
autostart=true
autorestart=true
redirect_stderr=true
stdout_logfile=/opt/fd-intranet/logs/qcluster.log
environment=PATH="/opt/fd-intranet/app/venv/bin"
SUPERVISOR

supervisorctl reread
supervisorctl update
print_status "Background services configured"

# Configure Nginx
cat > /etc/nginx/sites-available/fd-intranet << 'NGINX'
upstream fd_intranet {
    server 127.0.0.1:8000 fail_timeout=30s;
}

server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    
    client_max_body_size 10M;
    client_body_timeout 30s;
    client_header_timeout 30s;
    keepalive_timeout 30s;
    send_timeout 30s;
    
    location /static/ {
        alias /opt/fd-intranet/app/staticfiles/;
        expires 30d;
        add_header Cache-Control "public, immutable";
        gzip on;
        gzip_types text/css application/javascript image/svg+xml;
    }
    
    location /media/ {
        alias /opt/fd-intranet/app/media/;
        expires 7d;
    }
    
    location / {
        proxy_pass http://fd_intranet;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 30s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/fd-intranet /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx
print_status "Web server configured"

# Set up firewall
print_info "Configuring firewall..."
ufw --force enable
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow http
ufw allow https
print_status "Firewall configured"

# Create backup script
cat > /opt/fd-intranet/backup.sh << 'BACKUP'
#!/bin/bash
BACKUP_DIR="/opt/fd-intranet/backups"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR
sudo -u postgres pg_dump fd_intranet | gzip > $BACKUP_DIR/db_$DATE.sql.gz
tar -czf $BACKUP_DIR/media_$DATE.tar.gz -C /opt/fd-intranet/app media/ 2>/dev/null || true
find $BACKUP_DIR -name "*.sql.gz" -mtime +7 -delete
find $BACKUP_DIR -name "*.tar.gz" -mtime +7 -delete
echo "$(date): Backup completed" >> $BACKUP_DIR/backup.log
BACKUP

chmod +x /opt/fd-intranet/backup.sh
chown fdapp:fdapp /opt/fd-intranet/backup.sh

# Schedule backups
(crontab -u fdapp -l 2>/dev/null; echo "0 2 * * * /opt/fd-intranet/backup.sh") | crontab -u fdapp -
print_status "Automated backups configured (daily at 2 AM)"

# Create monitoring script
cat > /opt/fd-intranet/health-check.sh << 'HEALTH'
#!/bin/bash
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost)
if [ "$STATUS" != "200" ]; then
    echo "$(date): Health check failed (HTTP $STATUS)" >> /opt/fd-intranet/logs/health.log
    supervisorctl restart fd_intranet
fi
HEALTH

chmod +x /opt/fd-intranet/health-check.sh
(crontab -u root -l 2>/dev/null; echo "*/5 * * * * /opt/fd-intranet/health-check.sh") | crontab -u root -
print_status "Health monitoring configured"

# Optimize for Pi
print_info "Applying Raspberry Pi optimizations..."

# Use tmpfs for temporary files
grep -q "tmpfs /tmp" /etc/fstab || echo "tmpfs /tmp tmpfs defaults,noatime,nosuid,size=512M 0 0" >> /etc/fstab
grep -q "tmpfs /var/tmp" /etc/fstab || echo "tmpfs /var/tmp tmpfs defaults,noatime,nosuid,size=256M 0 0" >> /etc/fstab

# Reduce GPU memory (we don't need graphics)
grep -q "gpu_mem" /boot/firmware/config.txt || echo "gpu_mem=16" >> /boot/firmware/config.txt

print_status "Optimizations applied"

# Test installation
print_info "Testing installation..."
sleep 5

if supervisorctl status fd_intranet | grep -q "RUNNING"; then
    print_status "Application is running"
else
    print_error "Application failed to start"
    print_info "Check logs: sudo tail -50 /opt/fd-intranet/logs/gunicorn.log"
fi

if curl -s http://localhost | grep -q "Fire"; then
    print_status "Web server responding"
else
    print_error "Web server not responding"
fi

# Final summary
clear
cat << "EOF"
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🎉  Installation Complete!  🎉                         ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
EOF

echo ""
print_status "Fire Department Intranet successfully installed!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  🌐 Access your intranet:"
echo "     http://$DOMAIN"
echo "     http://$(hostname -I | awk '{print $1}')"
echo ""
echo "  👤 Admin login:"
echo "     Email: $ADMIN_EMAIL"
echo "     Password: [the password you set]"
echo ""
echo "  📁 Installation details:"
echo "     Location: /opt/fd-intranet/app"
echo "     Logs: /opt/fd-intranet/logs/"
echo "     Backups: /opt/fd-intranet/backups/"
echo ""
echo "  🔧 Management commands:"
echo "     sudo supervisorctl status        - Check services"
echo "     sudo supervisorctl restart all   - Restart services"
echo "     sudo tail -f /opt/fd-intranet/logs/gunicorn.log"
echo ""
echo "  💾 Backups:"
echo "     Automatic daily backups at 2 AM"
echo "     Manual: /opt/fd-intranet/backup.sh"
echo ""
echo "  📊 System info:"
echo "     Temperature: $(vcgencmd measure_temp)"
echo "     Memory: $(free -h | awk 'NR==2{print $3"/"$2}')"
echo "     Disk: $(df -h / | awk 'NR==2{print $3"/"$2}')"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
print_info "Next steps:"
echo "  1. Visit http://$DOMAIN in your browser"
echo "  2. Log in with your admin credentials"
echo "  3. Configure email in Django admin"
echo "  4. Add users and start using the system!"
echo ""
print_info "Need help? Check the documentation or visit GitHub issues"
echo ""

# Save credentials to a file (only readable by root)
cat > /root/fd-intranet-credentials.txt << CREDS
Fire Department Intranet - Installation Credentials
====================================================

Installation Date: $(date)
Hostname: $DOMAIN
Admin Email: $ADMIN_EMAIL
Admin Password: [you set this]

Database Password: $DB_PASSWORD
Secret Key: $SECRET_KEY

IMPORTANT: Store this file securely and delete after backing up!
CREDS

chmod 600 /root/fd-intranet-credentials.txt
print_info "Credentials saved to /root/fd-intranet-credentials.txt"

echo ""
print_status "Installation complete! 🚒"
echo ""
```

Save this as `install-pi.sh` and it handles everything automatically!

---

## 🔄 Post-Installation (Optional)

### Access from Anywhere - Cloudflare Tunnel (5 minutes)

The easiest way to access from outside your station:

```bash
# Install cloudflared
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
sudo dpkg -i cloudflared-linux-arm64.deb

# Authenticate (opens browser)
cloudflared tunnel login

# Create tunnel
cloudflared tunnel create fd-intranet

# Configure
mkdir -p ~/.cloudflared
cat > ~/.cloudflared/config.yml << EOF
url: http://localhost:80
tunnel: YOUR-TUNNEL-ID-HERE
credentials-file: /home/pi/.cloudflared/YOUR-TUNNEL-ID.json
EOF

# Route your domain
cloudflared tunnel route dns fd-intranet intranet.yourfiredept.org

# Install as service
sudo cloudflared service install
sudo systemctl start cloudflared
sudo systemctl enable cloudflared
```

Now access from anywhere: `https://intranet.yourfiredept.org`

Free SSL certificate included!

---

## 📱 Management Commands

### Check Status
```bash
sudo supervisorctl status
```

### Restart Services
```bash
sudo supervisorctl restart all
```

### View Logs
```bash
# Application logs
sudo tail -f /opt/fd-intranet/logs/gunicorn.log

# Background tasks
sudo tail -f /opt/fd-intranet/logs/qcluster.log

# All logs
sudo tail -f /opt/fd-intranet/logs/*.log
```

### Manual Backup
```bash
/opt/fd-intranet/backup.sh
```

### Check Temperature
```bash
vcgencmd measure_temp
```

### Update Application
```bash
cd /opt/fd-intranet/app
sudo -u fdapp git pull
sudo -u fdapp /opt/fd-intranet/app/venv/bin/python manage.py migrate
sudo -u fdapp /opt/fd-intranet/app/venv/bin/python manage.py collectstatic --noinput
sudo supervisorctl restart all
```

---

## 🎓 Common Tasks

### Add Email Configuration

1. Log in to admin: `http://fdintranet.local/admin`
2. Go to System Configuration
3. Set email settings:
   - SMTP Host: smtp.gmail.com
   - SMTP Port: 587
   - Username: yourdept@gmail.com
   - Password: [app password]

### Import Users from CSV

```bash
cd /opt/fd-intranet/app
sudo -u fdapp /opt/fd-intranet/app/venv/bin/python manage.py shell
```

```python
import csv
from django.contrib.auth import get_user_model

User = get_user_model()

with open('members.csv', 'r') as f:
    reader = csv.DictReader(f)
    for row in reader:
        User.objects.create_user(
            username=row['username'],
            email=row['email'],
            first_name=row['first_name'],
            last_name=row['last_name']
        )
```

### Reset Admin Password

```bash
cd /opt/fd-intranet/app
sudo -u fdapp /opt/fd-intranet/app/venv/bin/python manage.py changepassword admin
```

---

## 🐛 Troubleshooting

### Site not loading?
```bash
# Check services
sudo supervisorctl status

# Check nginx
sudo systemctl status nginx

# Check logs
sudo tail -50 /opt/fd-intranet/logs/gunicorn.log
```

### Database errors?
```bash
# Check PostgreSQL
sudo systemctl status postgresql

# Test connection
sudo -u postgres psql -d fd_intranet -c "SELECT 1;"
```

### Pi running hot?
```bash
# Check temp
vcgencmd measure_temp

# If over 70°C:
# - Check cooling fan is running
# - Ensure case has ventilation
# - Consider adding heatsinks
```

### Out of disk space?
```bash
# Check space
df -h

# Clean old backups
find /opt/fd-intranet/backups -mtime +30 -delete

# Clean logs
sudo truncate -s 0 /opt/fd-intranet/logs/*.log
```

---

## ✨ That's It!

You went from nothing to a fully functional fire department intranet in **20 minutes** with **one command**.

**What you got:**
- ✅ Web application running
- ✅ Database configured and optimized
- ✅ Automatic daily backups
- ✅ Health monitoring
- ✅ Firewall protection
- ✅ Performance optimizations
- ✅ Production-ready setup

**Total effort:** Less time than filling out paperwork! 🚒

---

**Questions?**
- Check logs: `/opt/fd-intranet/logs/`
- GitHub Issues: [link]
- Documentation: [link]

**Enjoy your new intranet!** 🎉
