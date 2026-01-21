# The Logbook - Deployment Guide

This guide provides step-by-step instructions for deploying The Logbook platform. Whether you're a beginner or experienced developer, we've got you covered!

## Table of Contents

1. [Quick Start (Recommended)](#quick-start-docker)
2. [System Requirements](#system-requirements)
3. [Deployment Options](#deployment-options)
4. [Security Checklist](#security-checklist)
5. [Post-Deployment](#post-deployment)
6. [Troubleshooting](#troubleshooting)

---

## Quick Start (Docker)

**For beginners:** This is the easiest and recommended method!

### Prerequisites

- A server or computer running Ubuntu 20.04+ or Debian 11+
- Sudo/administrative access
- Internet connection

### Installation Steps

1. **Download the Platform**
   ```bash
   git clone https://github.com/your-org/the-logbook.git
   cd the-logbook
   ```

2. **Run the Installation Script**
   ```bash
   chmod +x install.sh
   ./install.sh
   ```

3. **Choose Installation Type**
   - Select option `1` for Docker (recommended)
   - The script will automatically:
     - Install Docker and Docker Compose
     - Generate secure passwords
     - Set up the database
     - Start all services

4. **Access Your Application**
   - Frontend: http://your-server-ip:3000
   - Backend API: http://your-server-ip:3001
   - First-time setup wizard will guide you through initial configuration

**That's it!** You're up and running! 🎉

---

## System Requirements

### Minimum Requirements
- **CPU:** 2 cores
- **RAM:** 4 GB
- **Storage:** 20 GB
- **OS:** Ubuntu 20.04+ or Debian 11+

### Recommended for Production
- **CPU:** 4+ cores
- **RAM:** 8+ GB
- **Storage:** 50+ GB SSD
- **OS:** Ubuntu 22.04 LTS

### Software Requirements
All software will be automatically installed by the installation script:
- Docker 20.10+
- Docker Compose 2.0+
- Git
- OpenSSL

---

## Deployment Options

### Option 1: Docker Deployment (Recommended)

**Best for:** Most users, easy setup, consistent environments

**Advantages:**
- ✅ One-command setup
- ✅ Isolated environment
- ✅ Easy updates and rollbacks
- ✅ Works on any server
- ✅ Automatic service management

**Steps:**
```bash
./install.sh --docker
```

**Managing Services:**
```bash
# Start all services
docker compose up -d

# Stop all services
docker compose down

# View logs
docker compose logs -f

# Restart a service
docker compose restart backend

# Update the application
git pull
docker compose build
docker compose up -d
```

---

### Option 2: Traditional Server Deployment

**Best for:** Advanced users who want full control

**Steps:**

1. **Run Installation Script**
   ```bash
   ./install.sh --traditional
   ```

2. **Verify Services**
   ```bash
   sudo systemctl status logbook-backend
   sudo systemctl status mysql
   sudo systemctl status redis
   ```

3. **Configure Nginx**
   ```bash
   sudo cp infrastructure/nginx/nginx.conf /etc/nginx/sites-available/logbook
   sudo ln -s /etc/nginx/sites-available/logbook /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl reload nginx
   ```

---

### Option 3: Cloud Platform Deployment

#### AWS Deployment

1. **Launch EC2 Instance**
   - Ubuntu 22.04 LTS
   - t3.medium or larger
   - Security group: Allow ports 22, 80, 443

2. **Connect and Install**
   ```bash
   ssh ubuntu@your-ec2-ip
   git clone https://github.com/your-org/the-logbook.git
   cd the-logbook
   ./install.sh --docker
   ```

3. **Configure Domain**
   - Point your domain's A record to the EC2 IP
   - Run SSL setup:
     ```bash
     sudo ./scripts/setup-ssl.sh yourdomain.com admin@yourdomain.com
     ```

#### Digital Ocean Deployment

1. **Create Droplet**
   - Ubuntu 22.04
   - 4 GB RAM / 2 vCPUs or larger
   - Enable monitoring

2. **Install Application**
   ```bash
   ssh root@your-droplet-ip
   git clone https://github.com/your-org/the-logbook.git
   cd the-logbook
   ./install.sh --docker
   ```

3. **Configure Firewall**
   ```bash
   ufw allow 22/tcp
   ufw allow 80/tcp
   ufw allow 443/tcp
   ufw enable
   ```

#### Google Cloud Platform (GCP)

1. **Create Compute Engine Instance**
   - Ubuntu 22.04 LTS
   - e2-medium or larger
   - Allow HTTP/HTTPS traffic

2. **SSH and Install**
   ```bash
   gcloud compute ssh your-instance-name
   git clone https://github.com/your-org/the-logbook.git
   cd the-logbook
   ./install.sh --docker
   ```

---

## HTTPS/SSL Setup

**IMPORTANT:** Always use HTTPS in production!

### Automatic SSL Setup (Let's Encrypt)

1. **Prerequisites**
   - Domain name pointing to your server
   - Ports 80 and 443 open

2. **Run SSL Setup Script**
   ```bash
   sudo ./scripts/setup-ssl.sh yourdomain.com admin@yourdomain.com
   ```

3. **Done!** Your site is now accessible at `https://yourdomain.com`

### Manual SSL Setup

If you have your own SSL certificates:

1. Copy certificates to `/etc/nginx/ssl/`
2. Update nginx configuration:
   ```bash
   sudo nano /etc/nginx/sites-available/logbook
   ```
3. Update certificate paths:
   ```nginx
   ssl_certificate /etc/nginx/ssl/your-cert.pem;
   ssl_certificate_key /etc/nginx/ssl/your-key.pem;
   ```
4. Reload Nginx:
   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   ```

---

## Security Checklist

Before going live, complete these security steps:

### Essential Security Steps

- [ ] **Change all default passwords** in `.env`
- [ ] **Enable HTTPS/SSL** using Let's Encrypt or your own certificates
- [ ] **Configure firewall** (UFW, iptables, or cloud firewall)
- [ ] **Update `.env` file** with production values
- [ ] **Set `DEBUG=false`** in `.env`
- [ ] **Set `ENVIRONMENT=production`** in `.env`
- [ ] **Configure backups** (see [BACKUP.md](./BACKUP.md))
- [ ] **Set up monitoring** and error tracking
- [ ] **Review CORS settings** in `.env`
- [ ] **Enable rate limiting** (`RATE_LIMIT_ENABLED=true`)

### Advanced Security (Recommended)

- [ ] Set up fail2ban for brute force protection
- [ ] Enable automatic security updates
- [ ] Configure intrusion detection (e.g., OSSEC)
- [ ] Set up log monitoring
- [ ] Implement database encryption at rest
- [ ] Configure VPN for administrative access
- [ ] Set up two-factor authentication
- [ ] Regular security audits

### Firewall Configuration

**Ubuntu/Debian (UFW):**
```bash
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP
sudo ufw allow 443/tcp  # HTTPS
sudo ufw enable
sudo ufw status
```

**CentOS/RHEL (firewalld):**
```bash
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

---

## Configuration

### Environment Variables

All configuration is done through the `.env` file. Important settings:

```bash
# Application
ENVIRONMENT=production  # MUST be 'production' for live deployments
DEBUG=false             # MUST be false in production

# Domain/URLs
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com

# Database Passwords (CHANGE THESE!)
DB_PASSWORD=your-secure-password-here
MYSQL_ROOT_PASSWORD=another-secure-password

# Security Keys (CHANGE THESE!)
SECRET_KEY=generate-with-openssl-rand-hex-32
ENCRYPTION_KEY=generate-with-openssl-rand-hex-32
```

### Generating Secure Secrets

```bash
# Generate SECRET_KEY
openssl rand -hex 32

# Generate ENCRYPTION_KEY
openssl rand -hex 32

# Generate Database Password
openssl rand -base64 32
```

---

## Post-Deployment

### 1. Initial Setup

1. Access your application at `https://yourdomain.com`
2. Complete the onboarding wizard
3. Create administrator account
4. Configure organization settings

### 2. Configure Backups

Set up automated daily backups:

```bash
# Edit crontab
crontab -e

# Add this line (runs daily at 2 AM)
0 2 * * * /path/to/the-logbook/scripts/backup.sh
```

See [BACKUP.md](./BACKUP.md) for detailed backup configuration.

### 3. Set Up Monitoring

**Health Checks:**
- Backend: `https://yourdomain.com/api/v1/health`
- Database: `docker compose exec backend alembic current`

**Monitoring Tools:**
- Set up Uptime monitoring (e.g., UptimeRobot, Pingdom)
- Configure log monitoring
- Enable error tracking (Sentry recommended)

### 4. Email Configuration

Configure SMTP in `.env`:

```bash
EMAIL_ENABLED=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM_EMAIL=noreply@yourdomain.com
```

**For Gmail:**
1. Enable 2-factor authentication
2. Generate an App Password
3. Use the App Password as SMTP_PASSWORD

### 5. Regular Maintenance

**Weekly:**
- Review error logs
- Check disk space
- Verify backups

**Monthly:**
- Update system packages
- Review security logs
- Test backup restoration
- Review user accounts

**Quarterly:**
- Rotate secrets and passwords
- Security audit
- Performance review
- Capacity planning

---

## Updating the Application

### Docker Deployment

```bash
# Stop services
docker compose down

# Pull latest code
git pull

# Rebuild images
docker compose build

# Start services
docker compose up -d

# Run migrations if needed
docker compose exec backend alembic upgrade head
```

### Traditional Deployment

```bash
# Pull latest code
git pull

# Update backend
cd backend
source venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
sudo systemctl restart logbook-backend

# Update frontend
cd ../frontend
npm install
npm run build
```

---

## Troubleshooting

### Application Won't Start

1. **Check logs:**
   ```bash
   # Docker
   docker compose logs -f

   # Traditional
   sudo systemctl status logbook-backend
   sudo journalctl -u logbook-backend -f
   ```

2. **Verify database connection:**
   ```bash
   docker compose exec mysql mysql -u${DB_USER} -p${DB_PASSWORD} -e "SELECT 1;"
   ```

3. **Check ports:**
   ```bash
   sudo netstat -tulpn | grep -E '(3000|3001|3306|6379)'
   ```

### Database Connection Errors

1. Check `.env` database credentials
2. Verify MySQL is running:
   ```bash
   docker compose ps mysql
   # or
   sudo systemctl status mysql
   ```
3. Test connection manually:
   ```bash
   mysql -h localhost -u intranet_user -p
   ```

### Permission Issues

```bash
# Fix permissions for uploads directory
sudo chown -R $USER:$USER uploads/
chmod -R 755 uploads/

# Fix Docker permissions
sudo usermod -aG docker $USER
# Log out and back in
```

### SSL Certificate Issues

```bash
# Verify certificate
sudo certbot certificates

# Force renewal
sudo certbot renew --force-renewal

# Check Nginx configuration
sudo nginx -t
```

### Performance Issues

1. **Check resource usage:**
   ```bash
   htop
   docker stats
   ```

2. **Optimize database:**
   ```bash
   docker compose exec mysql mysqlcheck -u root -p --optimize --all-databases
   ```

3. **Clear Redis cache:**
   ```bash
   docker compose exec redis redis-cli FLUSHALL
   ```

### Getting Help

- 📖 Read the [FAQ](./FAQ.md)
- 🐛 Report issues on [GitHub Issues](https://github.com/your-org/the-logbook/issues)
- 💬 Join our [Community Forum](https://community.yourorg.com)
- 📧 Email support: support@yourorg.com

---

## Advanced Topics

### Load Balancing

For high-traffic deployments, see [SCALING.md](./SCALING.md)

### Multi-Region Deployment

For global deployments, see [MULTI-REGION.md](./MULTI-REGION.md)

### Custom Integrations

For API and webhook integrations, see [API.md](./API.md)

### Compliance

For HIPAA, GDPR, and other compliance requirements, see [COMPLIANCE.md](./COMPLIANCE.md)

---

## Next Steps

- [ ] Complete [Security Checklist](#security-checklist)
- [ ] Configure [Backups](./BACKUP.md)
- [ ] Set up [Monitoring](./MONITORING.md)
- [ ] Review [Security Best Practices](./SECURITY.md)
- [ ] Train your team on platform usage

**Need help?** Don't hesitate to reach out to support!
