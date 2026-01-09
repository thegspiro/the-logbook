# 🍓 Raspberry Pi Deployment Guide

## Fire Department Intranet on Raspberry Pi

Deploying your fire department intranet on a Raspberry Pi is a cost-effective, energy-efficient solution perfect for small to medium-sized volunteer departments.

---

## 🎯 Why Raspberry Pi?

### ✅ Advantages:
- **Low Cost**: $75-135 (vs $100-500/mo cloud hosting)
- **Low Power**: ~5-15W (saves $50-100/year vs traditional server)
- **Silent Operation**: No fan noise in the station
- **Physical Control**: Keep data on-site, no cloud dependency
- **Easy Recovery**: Backup entire SD card for disaster recovery
- **Perfect for 10-50 Users**: Handles typical fire department workload

### ⚠️ Limitations:
- Not recommended for >50 concurrent users
- Requires local power/internet redundancy
- SD card may need replacement every 1-2 years
- Limited RAM compared to cloud servers

---

## 📋 Hardware Requirements

### **Recommended: Raspberry Pi 5**

| Component | Minimum | Recommended | Notes |
|-----------|---------|-------------|-------|
| **Model** | Pi 4 (4GB) | **Pi 5 (8GB)** | Best performance |
| **Storage** | 64GB SD Card | **128GB SSD via USB** | SSD much faster & reliable |
| **Power** | Official 5V 3A | **Official 5V 5A (Pi 5)** | Prevents brownouts |
| **Network** | WiFi | **Gigabit Ethernet** | More stable |
| **Cooling** | Heatsink | **Active Cooling Fan** | Prevents throttling |
| **Case** | Basic | **Metal case with fan** | Better heat dissipation |
| **UPS** | None | **UPS Battery Pack** | Power protection |

### **Shopping List (Recommended Setup - ~$200)**

```
🛒 Raspberry Pi 5 (8GB)                    $80
🛒 Official Power Supply (27W USB-C)       $12
🛒 128GB USB 3.0 SSD with Enclosure       $30
🛒 32GB microSD Card (for boot)            $8
🛒 Metal Case with Active Cooling          $15
🛒 Ethernet Cable (Cat6)                   $10
🛒 PiSugar S Plus Battery (Optional UPS)   $45
                                          -----
                                    Total: $200
```

**Budget Option (~$100):**
```
🛒 Raspberry Pi 4 (4GB)                    $55
🛒 Official Power Supply                   $8
🛒 64GB High-Endurance SD Card            $15
🛒 Basic Case with Fan                     $12
🛒 Heatsinks                               $5
                                          -----
                                    Total: $95
```

---

## 💻 Operating System Setup

### **Step 1: Install Raspberry Pi OS (64-bit)**

```bash
# On your computer:

# 1. Download Raspberry Pi Imager
# https://www.raspberrypi.com/software/

# 2. Flash OS to SD card:
#    - Choose OS: Raspberry Pi OS Lite (64-bit) - No desktop needed
#    - Choose Storage: Your SD card
#    - Settings (gear icon):
#      ✓ Enable SSH
#      ✓ Set username: pi
#      ✓ Set password: [secure password]
#      ✓ Configure WiFi (if not using ethernet)
#      ✓ Set hostname: fdintranet
#    - Write to SD card

# 3. Boot Raspberry Pi with SD card
# 4. Find IP address (check your router or use: sudo nmap -sn 192.168.1.0/24)
# 5. SSH into Pi
ssh pi@fdintranet.local
# or
ssh pi@[IP_ADDRESS]
```

### **Step 2: Initial Configuration**

```bash
# Update system
sudo apt update && sudo apt full-upgrade -y

# Configure Pi
sudo raspi-config
# - System Options > Boot/Auto Login > Console
# - Performance Options > GPU Memory > Set to 16MB (we don't need graphics)
# - Localisation Options > Timezone > Set your timezone
# - Advanced Options > Expand Filesystem

# Reboot
sudo reboot

# SSH back in after reboot
```

### **Step 3: Optional - Boot from SSD (Highly Recommended)**

If you have a USB SSD, booting from SSD is **10x faster** and more reliable:

```bash
# 1. Update bootloader for USB boot
sudo rpi-eeprom-update
sudo rpi-eeprom-update -a

# 2. Enable USB boot
sudo raspi-config
# Advanced Options > Boot Order > USB Boot

# 3. Clone SD to SSD using Raspberry Pi Imager
# (On another computer, or use SD Card Copier on Pi Desktop)

# 4. Shutdown, remove SD card, boot from SSD only
sudo shutdown -h now
```

---

## 🚀 Application Installation

### **Step 1: Install Dependencies**

```bash
# Install system packages
sudo apt install -y \
    python3-full \
    python3-pip \
    python3-venv \
    postgresql \
    postgresql-contrib \
    redis-server \
    nginx \
    git \
    supervisor \
    certbot \
    python3-certbot-nginx \
    ufw \
    build-essential \
    libpq-dev \
    python3-dev

# For Pi 4, you might need to add swap for compilation
sudo dphys-swapfile swapoff
sudo nano /etc/dphys-swapfile
# Change: CONF_SWAPSIZE=2048
sudo dphys-swapfile setup
sudo dphys-swapfile swapon
```

### **Step 2: PostgreSQL Setup**

```bash
# Switch to postgres user
sudo -u postgres psql

# Create database and user
CREATE DATABASE fd_intranet;
CREATE USER fdapp WITH PASSWORD 'YourSecurePassword123!';
ALTER ROLE fdapp SET client_encoding TO 'utf8';
ALTER ROLE fdapp SET default_transaction_isolation TO 'read committed';
ALTER ROLE fdapp SET timezone TO 'America/New_York';
GRANT ALL PRIVILEGES ON DATABASE fd_intranet TO fdapp;
\q

# Optimize PostgreSQL for Raspberry Pi
sudo nano /etc/postgresql/15/main/postgresql.conf
```

**Add these optimizations:**

```conf
# Memory settings for Raspberry Pi 4/5
shared_buffers = 512MB                    # For 4GB model
# shared_buffers = 1GB                    # For 8GB model
effective_cache_size = 1GB                # For 4GB model
# effective_cache_size = 2GB              # For 8GB model
maintenance_work_mem = 128MB
work_mem = 4MB

max_connections = 50                      # Lower for Pi

# Write performance
wal_buffers = 8MB
checkpoint_completion_target = 0.9
random_page_cost = 1.1                    # For SSD
# random_page_cost = 4                    # For SD card

# Reduce logging overhead
log_min_duration_statement = 5000         # Only log slow queries
```

```bash
# Restart PostgreSQL
sudo systemctl restart postgresql
```

### **Step 3: Application Setup**

```bash
# Create application user
sudo useradd -r -s /bin/bash -d /opt/fd-intranet -m fdapp

# Switch to fdapp
sudo su - fdapp

# Clone repository
git clone https://github.com/thegspiro/fd-intranet.git app
cd app

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Upgrade pip
pip install --upgrade pip

# Install dependencies (this takes ~10-15 minutes on Pi)
pip install -r requirements.txt

# Install production dependencies
pip install gunicorn psycopg2-binary

# Create .env file
nano .env
```

**Raspberry Pi Optimized .env:**

```bash
# Core Settings
SECRET_KEY='your-very-long-random-secret-key'
DEBUG=False
ALLOWED_HOSTS='fdintranet.local,192.168.1.XXX,yourdomain.com'

# Database
DATABASE_URL=postgresql://fdapp:YourSecurePassword123!@localhost:5432/fd_intranet

# Email Configuration
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USE_TLS=True
EMAIL_HOST_USER=yourdept@gmail.com
EMAIL_HOST_PASSWORD=your-app-password

# Redis
REDIS_URL=redis://127.0.0.1:6379/0

# Performance Tuning for Raspberry Pi
# Fewer workers, smaller cache
GUNICORN_WORKERS=2                        # 2 for Pi 4, 3-4 for Pi 5
GUNICORN_WORKER_CLASS=sync
GUNICORN_MAX_REQUESTS=500
GUNICORN_MAX_REQUESTS_JITTER=50
GUNICORN_TIMEOUT=120

# Cache Settings
CACHE_TIMEOUT=3600
CACHE_SIZE_LIMIT=52428800                 # 50MB cache

# File Upload Limits (reasonable for Pi)
MAX_UPLOAD_SIZE=10485760                  # 10MB

# External Integrations (Optional)
TARGET_SOLUTIONS_API_KEY=
GOOGLE_CLIENT_ID=
```

```bash
# Run migrations
python manage.py migrate

# Collect static files
python manage.py collectstatic --noinput

# Create superuser
python manage.py createsuperuser

# Test Django
python manage.py check --deploy

# Exit fdapp user
exit
```

### **Step 4: Configure Gunicorn**

```bash
# Create Gunicorn config
sudo mkdir -p /opt/fd-intranet/config
sudo nano /opt/fd-intranet/config/gunicorn_config.py
```

**Raspberry Pi Optimized Gunicorn Config:**

```python
import multiprocessing

# Raspberry Pi optimizations
workers = 2  # Conservative for Pi 4/5
worker_class = 'sync'
worker_connections = 50
max_requests = 500
max_requests_jitter = 50
timeout = 120
keepalive = 5

# Binding
bind = '127.0.0.1:8000'

# Logging
accesslog = '/opt/fd-intranet/logs/gunicorn_access.log'
errorlog = '/opt/fd-intranet/logs/gunicorn_error.log'
loglevel = 'warning'  # Reduce disk I/O

# Process naming
proc_name = 'fd_intranet'

# Server mechanics
daemon = False
pidfile = '/opt/fd-intranet/gunicorn.pid'
user = 'fdapp'
group = 'fdapp'

# Temp directory (use tmpfs for better performance)
worker_tmp_dir = '/dev/shm'
```

```bash
# Create logs directory
sudo mkdir -p /opt/fd-intranet/logs
sudo chown -R fdapp:fdapp /opt/fd-intranet/logs
```

### **Step 5: Configure Supervisor**

```bash
sudo nano /etc/supervisor/conf.d/fd-intranet.conf
```

```ini
[program:fd_intranet]
command=/opt/fd-intranet/app/venv/bin/gunicorn core.wsgi:application -c /opt/fd-intranet/config/gunicorn_config.py
directory=/opt/fd-intranet/app
user=fdapp
autostart=true
autorestart=true
redirect_stderr=true
stdout_logfile=/opt/fd-intranet/logs/gunicorn_supervisor.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=3
environment=PATH="/opt/fd-intranet/app/venv/bin"

[program:fd_qcluster]
command=/opt/fd-intranet/app/venv/bin/python manage.py qcluster
directory=/opt/fd-intranet/app
user=fdapp
autostart=true
autorestart=true
redirect_stderr=true
stdout_logfile=/opt/fd-intranet/logs/qcluster.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=3
environment=PATH="/opt/fd-intranet/app/venv/bin"
```

```bash
# Update supervisor
sudo supervisorctl reread
sudo supervisorctl update
sudo supervisorctl status
```

### **Step 6: Configure Nginx**

```bash
sudo nano /etc/nginx/sites-available/fd-intranet
```

**Raspberry Pi Optimized Nginx Config:**

```nginx
# Upstream to Gunicorn
upstream fd_intranet {
    server 127.0.0.1:8000 fail_timeout=30s;
}

# HTTP server
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name fdintranet.local _;
    
    client_max_body_size 10M;  # Match Django setting
    
    # Optimize for Raspberry Pi
    client_body_timeout 30s;
    client_header_timeout 30s;
    keepalive_timeout 30s;
    send_timeout 30s;
    
    # Static files
    location /static/ {
        alias /opt/fd-intranet/app/staticfiles/;
        expires 30d;
        add_header Cache-Control "public, immutable";
        
        # Gzip compression
        gzip on;
        gzip_types text/css application/javascript image/svg+xml;
        gzip_vary on;
    }
    
    # Media files
    location /media/ {
        alias /opt/fd-intranet/app/media/;
        expires 7d;
    }
    
    # Application
    location / {
        proxy_pass http://fd_intranet;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Timeouts for Pi
        proxy_connect_timeout 30s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        
        # Buffer settings
        proxy_buffering on;
        proxy_buffers 8 16k;
        proxy_buffer_size 16k;
    }
}
```

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/fd-intranet /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default

# Test and restart
sudo nginx -t
sudo systemctl restart nginx
```

### **Step 7: Firewall Configuration**

```bash
# Set up firewall
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow http
sudo ufw allow https
sudo ufw enable

# Check status
sudo ufw status
```

---

## 🔧 Raspberry Pi Specific Optimizations

### **1. Use tmpfs for Temporary Files**

Reduce SD card/SSD writes by using RAM for temporary files:

```bash
sudo nano /etc/fstab
```

Add these lines:

```
tmpfs /tmp tmpfs defaults,noatime,nosuid,size=512M 0 0
tmpfs /var/tmp tmpfs defaults,noatime,nosuid,size=256M 0 0
tmpfs /var/log tmpfs defaults,noatime,nosuid,mode=0755,size=256M 0 0
```

```bash
sudo mount -a
```

### **2. Disable Unnecessary Services**

```bash
# Disable services you don't need
sudo systemctl disable bluetooth
sudo systemctl disable avahi-daemon
sudo systemctl disable triggerhappy
sudo systemctl disable cups  # If no printer

# Reduce logs
sudo nano /etc/systemd/journald.conf
# Change:
# SystemMaxUse=50M
# RuntimeMaxUse=50M
```

### **3. Set Up Log Rotation**

```bash
sudo nano /etc/logrotate.d/fd-intranet
```

```
/opt/fd-intranet/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0640 fdapp fdapp
    sharedscripts
    postrotate
        supervisorctl restart fd_intranet
    endscript
}
```

### **4. Monitor Temperature**

Raspberry Pi needs cooling under load:

```bash
# Check temperature
vcgencmd measure_temp

# Add temperature monitoring
sudo apt install lm-sensors
sensors

# Set up temperature alerts
sudo nano /opt/fd-intranet/check_temp.sh
```

```bash
#!/bin/bash
TEMP=$(vcgencmd measure_temp | cut -d= -f2 | cut -d\' -f1)
if (( $(echo "$TEMP > 70" | bc -l) )); then
    echo "High temperature: $TEMP°C" | mail -s "Pi Temperature Alert" admin@yourdept.org
fi
```

```bash
chmod +x /opt/fd-intranet/check_temp.sh

# Run every 5 minutes
crontab -e
# Add:
*/5 * * * * /opt/fd-intranet/check_temp.sh
```

---

## 🔄 Automated Backups

### **Database Backups**

```bash
sudo mkdir -p /opt/fd-intranet/backups
sudo nano /opt/fd-intranet/backup.sh
```

```bash
#!/bin/bash
BACKUP_DIR="/opt/fd-intranet/backups"
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=7  # Keep only 1 week on Pi

mkdir -p $BACKUP_DIR

# Database backup
sudo -u postgres pg_dump fd_intranet | gzip > $BACKUP_DIR/db_$DATE.sql.gz

# Media files backup
tar -czf $BACKUP_DIR/media_$DATE.tar.gz -C /opt/fd-intranet/app media/

# Remove old backups
find $BACKUP_DIR -name "db_*.sql.gz" -mtime +$RETENTION_DAYS -delete
find $BACKUP_DIR -name "media_*.tar.gz" -mtime +$RETENTION_DAYS -delete

echo "$(date): Backup completed" >> $BACKUP_DIR/backup.log

# Optional: Copy to USB drive or network storage
# rsync -av $BACKUP_DIR/ /mnt/usb_backup/
```

```bash
sudo chmod +x /opt/fd-intranet/backup.sh
sudo chown fdapp:fdapp /opt/fd-intranet/backup.sh

# Schedule daily backups at 2 AM
sudo -u fdapp crontab -e
# Add:
0 2 * * * /opt/fd-intranet/backup.sh
```

### **Full SD Card Image Backup (Monthly)**

On another computer:

```bash
# Shutdown Pi
ssh pi@fdintranet.local "sudo shutdown -h now"

# Remove SD card and insert in computer

# Create image (Linux/Mac)
sudo dd if=/dev/sdX of=~/fd-intranet-backup-$(date +%Y%m%d).img bs=4M status=progress

# Compress
gzip ~/fd-intranet-backup-*.img

# Store securely off-site
```

---

## 🌐 Accessing from Outside the Station

### **Option 1: Cloudflare Tunnel (Recommended)**

Free and secure way to access your Pi from anywhere:

```bash
# Install cloudflared
wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
sudo dpkg -i cloudflared-linux-arm64.deb

# Authenticate
cloudflared tunnel login

# Create tunnel
cloudflared tunnel create fd-intranet

# Configure tunnel
mkdir -p ~/.cloudflared
nano ~/.cloudflared/config.yml
```

```yaml
url: http://localhost:80
tunnel: [YOUR-TUNNEL-ID]
credentials-file: /home/pi/.cloudflared/[YOUR-TUNNEL-ID].json
```

```bash
# Route domain
cloudflared tunnel route dns fd-intranet intranet.yourfiredept.org

# Install as service
sudo cloudflared service install
sudo systemctl start cloudflared
sudo systemctl enable cloudflared
```

Now access via: https://intranet.yourfiredept.org (free SSL!)

### **Option 2: Dynamic DNS + Port Forwarding**

1. Sign up for free DDNS (NoIP, DuckDNS)
2. Configure DDNS client on Pi
3. Forward ports 80/443 on router
4. Use Let's Encrypt for SSL

### **Option 3: VPN (Most Secure)**

Set up WireGuard VPN on the Pi:

```bash
# Install WireGuard
sudo apt install wireguard

# Follow WireGuard setup guide
# Access Pi only via VPN connection
```

---

## 📊 Performance Expectations

### **Typical Performance (Raspberry Pi 5, 8GB):**

| Metric | Performance |
|--------|-------------|
| Concurrent Users | 15-20 comfortably |
| Page Load Time | 0.5-1.5 seconds |
| Database Queries | 50-100 per second |
| File Uploads | 5-10 MB/s |
| Memory Usage | 1-2 GB |
| CPU Load | 10-30% average |
| Power Consumption | 8-12W |

### **Typical Performance (Raspberry Pi 4, 4GB):**

| Metric | Performance |
|--------|-------------|
| Concurrent Users | 10-15 comfortably |
| Page Load Time | 1-2 seconds |
| Database Queries | 30-50 per second |
| Memory Usage | 1.5-2.5 GB |
| CPU Load | 20-40% average |

---

## 🔍 Monitoring & Maintenance

### **Set Up Basic Monitoring**

```bash
# Install monitoring tools
sudo apt install htop iotop

# Create monitoring script
nano /opt/fd-intranet/monitor.sh
```

```bash
#!/bin/bash
echo "=== Fire Department Intranet - Status Report ===" > /tmp/status.txt
echo "Date: $(date)" >> /tmp/status.txt
echo "" >> /tmp/status.txt

# Temperature
echo "Temperature: $(vcgencmd measure_temp)" >> /tmp/status.txt

# Disk usage
echo "Disk Usage:" >> /tmp/status.txt
df -h / >> /tmp/status.txt

# Memory
echo "" >> /tmp/status.txt
echo "Memory:" >> /tmp/status.txt
free -h >> /tmp/status.txt

# Services
echo "" >> /tmp/status.txt
echo "Services:" >> /tmp/status.txt
supervisorctl status >> /tmp/status.txt

# Database size
echo "" >> /tmp/status.txt
echo "Database Size:" >> /tmp/status.txt
sudo -u postgres psql -c "SELECT pg_size_pretty(pg_database_size('fd_intranet'));" >> /tmp/status.txt

cat /tmp/status.txt
```

### **Scheduled Maintenance**

```bash
# Create maintenance script
sudo nano /opt/fd-intranet/maintenance.sh
```

```bash
#!/bin/bash

# Update system (monthly)
sudo apt update && sudo apt upgrade -y

# Clean up packages
sudo apt autoremove -y
sudo apt autoclean

# Vacuum database
sudo -u postgres psql -d fd_intranet -c "VACUUM ANALYZE;"

# Clear old logs
find /opt/fd-intranet/logs -name "*.log" -mtime +30 -delete

# Restart services for clean slate
sudo supervisorctl restart all
sudo systemctl restart nginx

echo "$(date): Maintenance completed" >> /opt/fd-intranet/logs/maintenance.log
```

```bash
sudo chmod +x /opt/fd-intranet/maintenance.sh

# Run monthly on 1st at 3 AM
sudo crontab -e
# Add:
0 3 1 * * /opt/fd-intranet/maintenance.sh
```

---

## ⚡ Quick Troubleshooting

### **Application won't start:**
```bash
sudo supervisorctl status
sudo tail -50 /opt/fd-intranet/logs/gunicorn_supervisor.log
```

### **Database connection errors:**
```bash
sudo systemctl status postgresql
sudo -u postgres psql -c "SELECT version();"
```

### **High temperature throttling:**
```bash
vcgencmd measure_temp
vcgencmd get_throttled
# Add cooling or reduce workers in gunicorn config
```

### **Out of memory:**
```bash
free -h
# Reduce Gunicorn workers to 2
# Reduce PostgreSQL shared_buffers
```

### **Slow performance:**
```bash
# Check if running from SD card vs SSD
lsblk

# Monitor I/O
sudo iotop

# Check if swapping
vmstat 1
```

---

## 💡 Pro Tips

1. **Always use Ethernet** over WiFi for stability
2. **Use quality SD card/SSD** - Samsung EVO or SanDisk Extreme
3. **Keep Pi cool** - Active cooling prevents throttling
4. **Use UPS/battery** - Prevents corruption during power loss
5. **Regular backups** - SD cards can fail without warning
6. **Monitor temperature** - Keep under 60°C for longevity
7. **Test failover** - Have spare Pi configured as backup

---

## 📞 Support

For Raspberry Pi specific issues:
- **Raspberry Pi Forums**: https://forums.raspberrypi.com
- **Stack Overflow**: Tag `raspberry-pi`
- **This Project**: GitHub Issues

---

## 🎉 You're Done!

Your fire department intranet is now running on a Raspberry Pi!

Access it at:
- Local: http://fdintranet.local
- IP: http://192.168.1.XXX
- External: https://intranet.yourfiredept.org (if configured)

**Total Cost**: $100-200
**Power Cost**: ~$5-10/year
**Maintenance**: ~30 minutes/month
**Reliability**: Excellent with proper cooling and backups

**Next Steps:**
1. Create superuser: `python manage.py createsuperuser`
2. Configure training providers and integrations
3. Import member data
4. Set up scheduled backups to external drive
5. Train department members on the system

---

**Document Version**: 1.0  
**Last Updated**: January 2026  
**Tested On**: Raspberry Pi 4 (4GB/8GB), Raspberry Pi 5 (8GB)
