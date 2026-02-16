# The Logbook - AWS Deployment Guide

Deploy The Logbook on Amazon Web Services using EC2, or with managed RDS and ElastiCache for production environments.

## Overview

| Method | Cost | Best For |
|--------|------|----------|
| **EC2 + Docker Compose** (Simple) | ~$15-40/mo | Small teams, testing, self-contained |
| **EC2 + RDS + ElastiCache** (Production) | ~$50-100/mo | Production, automated backups, high availability |
| **ECS/Fargate** (Container-native) | ~$40-80/mo | Teams already using AWS container services |

---

## Method 1: EC2 with Docker Compose (Simple)

Everything runs on a single EC2 instance — the application, database, and Redis cache.

### Step 1: Launch an EC2 Instance

1. Open the [EC2 Console](https://console.aws.amazon.com/ec2/)
2. Click **Launch Instance**
3. Configure:

| Setting | Value | Notes |
|---------|-------|-------|
| **Name** | `the-logbook` | |
| **AMI** | Ubuntu Server 22.04 LTS | Or Amazon Linux 2023 |
| **Instance type** | `t3.medium` (4 GB) | See sizing table below |
| **Key pair** | Create or select existing | Required for SSH access |
| **Storage** | 30 GB gp3 minimum | 50 GB recommended |

4. **Network settings** — Create or select a security group with these rules:

| Type | Port | Source | Purpose |
|------|------|--------|---------|
| SSH | 22 | Your IP | Administration |
| HTTP | 80 | 0.0.0.0/0 | Web access (redirects to HTTPS) |
| HTTPS | 443 | 0.0.0.0/0 | Secure web access |

> **Note**: Do NOT open ports 3000, 3001, 3306, or 6379 to the public. Use a reverse proxy (Nginx) on ports 80/443 instead.

### Recommended Instance Types

| Instance | vCPUs | RAM | Profile | Monthly Cost (approx.) |
|----------|-------|-----|---------|------------------------|
| `t3.micro` | 2 | 1 GB | minimal | ~$8 |
| `t3.small` | 2 | 2 GB | minimal | ~$15 |
| `t3.medium` | 2 | 4 GB | standard | ~$30 |
| `t3.large` | 2 | 8 GB | full | ~$60 |

> **Tip**: Use `t3.medium` for most fire department deployments. Enable **T3 Unlimited** if you expect occasional traffic spikes during incidents.

### Step 2: Connect and Install

```bash
# SSH into your instance
ssh -i your-key.pem ubuntu@YOUR-EC2-PUBLIC-IP

# Update the system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Log out and back in so Docker group takes effect
exit
ssh -i your-key.pem ubuntu@YOUR-EC2-PUBLIC-IP

# Verify Docker
docker --version
docker compose version
```

### Step 3: Deploy The Logbook

```bash
# Clone the repository
git clone https://github.com/thegspiro/the-logbook.git /opt/the-logbook
cd /opt/the-logbook

# Copy and configure environment
cp .env.example .env

# Generate secure keys
SECRET_KEY=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
ENCRYPTION_SALT=$(openssl rand -hex 16)
DB_PASSWORD=$(openssl rand -base64 24 | tr -d "=+/" | cut -c1-20)
REDIS_PASSWORD=$(openssl rand -base64 24 | tr -d "=+/" | cut -c1-20)
MYSQL_ROOT_PASSWORD=$(openssl rand -base64 24 | tr -d "=+/" | cut -c1-20)

# Update .env with generated values
sed -i "s|^SECRET_KEY=.*|SECRET_KEY=${SECRET_KEY}|" .env
sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=${ENCRYPTION_KEY}|" .env
sed -i "s|^ENCRYPTION_SALT=.*|ENCRYPTION_SALT=${ENCRYPTION_SALT}|" .env
sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=${DB_PASSWORD}|" .env
sed -i "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=${REDIS_PASSWORD}|" .env
sed -i "s|^MYSQL_ROOT_PASSWORD=.*|MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}|" .env

# Set ALLOWED_ORIGINS (use your domain or EC2 public IP)
# For domain:
sed -i "s|^ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=https://logbook.yourdomain.com|" .env
# Or for IP access:
# sed -i "s|^ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=http://YOUR-EC2-PUBLIC-IP|" .env

# Set production mode
sed -i "s|^ENVIRONMENT=.*|ENVIRONMENT=production|" .env
sed -i "s|^DEBUG=.*|DEBUG=false|" .env

# Start the application
docker compose up -d

# Verify all containers are running and healthy
docker compose ps
```

### Step 4: Set Up Nginx Reverse Proxy

```bash
sudo apt install -y nginx

sudo tee /etc/nginx/sites-available/logbook > /dev/null << 'EOF'
server {
    listen 80;
    server_name logbook.yourdomain.com;

    client_max_body_size 50M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /api/ {
        proxy_pass http://localhost:3001/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/logbook /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### Step 5: Enable HTTPS with Let's Encrypt

```bash
sudo apt install -y certbot python3-certbot-nginx

# Make sure your domain's A record points to the EC2 public IP first
sudo certbot --nginx -d logbook.yourdomain.com

# Verify auto-renewal
sudo certbot renew --dry-run
```

### Step 6: Access The Logbook

Open your browser: `https://logbook.yourdomain.com`

Complete the onboarding wizard to set up your organization.

---

## Method 2: EC2 + RDS + ElastiCache (Production)

Use AWS managed database and cache services for automated backups, high availability, and easier scaling.

### Step 1: Set Up Networking (VPC)

If you don't already have a VPC configured:

1. Use the **default VPC** (simplest), or
2. Create a new VPC with public and private subnets

Key networking requirements:
- EC2 instance in a **public subnet** (for web access)
- RDS and ElastiCache in **private subnets** (not publicly accessible)
- All three in the **same VPC** so they can communicate

### Step 2: Create an RDS MySQL Instance

1. Open the [RDS Console](https://console.aws.amazon.com/rds/)
2. Click **Create database**
3. Configure:

| Setting | Value |
|---------|-------|
| **Engine** | MySQL 8.0 |
| **Template** | Free Tier (testing) or Production |
| **Instance** | `db.t3.micro` (testing) or `db.t3.small` (production) |
| **Storage** | 20 GB gp3, enable auto-scaling to 100 GB |
| **Master username** | `admin` |
| **Master password** | Generate a strong password |
| **Public access** | No |
| **VPC security group** | Create new — allow port 3306 from EC2 security group |
| **Database name** | `the_logbook` |
| **Backup retention** | 7 days (recommended) |

> **Important**: Select the same VPC as your EC2 instance. RDS should NOT be publicly accessible.

### Step 3: Create an ElastiCache Redis Cluster

1. Open the [ElastiCache Console](https://console.aws.amazon.com/elasticache/)
2. Click **Create cluster** → **Redis OSS**
3. Configure:

| Setting | Value |
|---------|-------|
| **Name** | `logbook-redis` |
| **Node type** | `cache.t3.micro` |
| **Replicas** | 0 (testing) or 1 (production) |
| **Subnet group** | Same VPC as EC2/RDS |
| **Security group** | Allow port 6379 from EC2 security group |

### Step 4: Create Security Groups

You need three security groups in the same VPC:

**EC2 Security Group** (`logbook-ec2-sg`):
| Inbound | Port | Source |
|---------|------|--------|
| SSH | 22 | Your IP |
| HTTP | 80 | 0.0.0.0/0 |
| HTTPS | 443 | 0.0.0.0/0 |

**RDS Security Group** (`logbook-rds-sg`):
| Inbound | Port | Source |
|---------|------|--------|
| MySQL | 3306 | `logbook-ec2-sg` |

**ElastiCache Security Group** (`logbook-redis-sg`):
| Inbound | Port | Source |
|---------|------|--------|
| Redis | 6379 | `logbook-ec2-sg` |

### Step 5: Launch EC2 and Deploy

Follow Method 1 Steps 1-3 to launch an EC2 instance and install Docker, then configure `.env` to use managed services:

```bash
cd /opt/the-logbook
cp .env.example .env

# Generate application secrets (same as Method 1)
SECRET_KEY=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
ENCRYPTION_SALT=$(openssl rand -hex 16)

sed -i "s|^SECRET_KEY=.*|SECRET_KEY=${SECRET_KEY}|" .env
sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=${ENCRYPTION_KEY}|" .env
sed -i "s|^ENCRYPTION_SALT=.*|ENCRYPTION_SALT=${ENCRYPTION_SALT}|" .env

# Point to RDS (replace with your actual RDS endpoint)
sed -i "s|^DB_HOST=.*|DB_HOST=your-rds-instance.xxxx.us-east-1.rds.amazonaws.com|" .env
sed -i "s|^DB_PORT=.*|DB_PORT=3306|" .env
sed -i "s|^DB_NAME=.*|DB_NAME=the_logbook|" .env
sed -i "s|^DB_USER=.*|DB_USER=admin|" .env
sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=your-rds-password|" .env

# Point to ElastiCache (replace with your actual endpoint)
sed -i "s|^REDIS_HOST=.*|REDIS_HOST=logbook-redis.xxxx.use1.cache.amazonaws.com|" .env
sed -i "s|^REDIS_PORT=.*|REDIS_PORT=6379|" .env

# Production settings
sed -i "s|^ENVIRONMENT=.*|ENVIRONMENT=production|" .env
sed -i "s|^DEBUG=.*|DEBUG=false|" .env
sed -i "s|^ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=https://logbook.yourdomain.com|" .env

# Start WITHOUT local database and Redis (only backend + frontend)
docker compose up -d backend frontend
```

> **Note**: When using RDS and ElastiCache, you don't start the `mysql` or `redis` containers — the application connects to the managed AWS services directly.

### Step 6: Set Up Nginx and SSL

Follow Method 1 Steps 4-5 for Nginx and Let's Encrypt setup.

---

## AWS-Specific Configuration

### Elastic IP (Recommended)

Assign an Elastic IP so your instance keeps the same public IP after restarts:

```bash
# Via AWS CLI
aws ec2 allocate-address --domain vpc
aws ec2 associate-address --instance-id i-YOUR-INSTANCE-ID --allocation-id eipalloc-YOUR-ALLOCATION-ID
```

Or assign via the EC2 Console: **Elastic IPs → Allocate → Associate**.

### IAM Role for S3 Backups (Optional)

If you want to store backups in S3:

1. Create an S3 bucket: `your-org-logbook-backups`
2. Create an IAM role with S3 access and attach it to your EC2 instance
3. Configure in `.env`:

```bash
STORAGE_TYPE=s3
AWS_S3_BUCKET=your-org-logbook-backups
AWS_REGION=us-east-1
# If using IAM role (recommended), leave these blank:
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
```

### CloudWatch Monitoring (Optional)

Install the CloudWatch agent for detailed monitoring:

```bash
# Install CloudWatch agent
sudo apt install -y amazon-cloudwatch-agent

# Basic monitoring is already included with EC2
# For custom metrics (Docker container stats), configure the agent:
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-config-wizard
```

Set up CloudWatch Alarms for:
- **CPU utilization** > 80% for 5 minutes
- **Disk usage** > 85%
- **Status check failed** (instance health)

### Route 53 DNS (Optional)

If using Route 53 for DNS:

1. Create a hosted zone for your domain
2. Add an **A record** pointing to your EC2 Elastic IP (or an alias to an ALB)
3. Use the domain name in your `.env` `ALLOWED_ORIGINS` and Nginx config

---

## Backups

### Method 1 (EC2 + Docker Compose)

The database runs locally, so use The Logbook's built-in backup:

```bash
# Manual backup
docker compose exec backend /app/scripts/backup.sh

# Schedule daily backups via cron
crontab -e
# Add: 0 2 * * * cd /opt/the-logbook && docker compose exec -T backend /app/scripts/backup.sh

# Back up to S3 (optional)
aws s3 sync /opt/the-logbook/backups/ s3://your-org-logbook-backups/
```

Also consider **EBS snapshots** for full disk backup:

```bash
# Create a snapshot of the instance's EBS volume
aws ec2 create-snapshot --volume-id vol-YOUR-VOLUME-ID --description "Logbook backup"
```

### Method 2 (RDS)

RDS handles database backups automatically:
- **Automated backups**: Configured during RDS setup (7-35 day retention)
- **Manual snapshots**: Create anytime from the RDS Console
- **Point-in-time restore**: Restore to any second within the retention period

You still need to back up uploaded files from the EC2 instance:

```bash
# Sync uploads to S3
aws s3 sync /opt/the-logbook/uploads/ s3://your-org-logbook-backups/uploads/
```

---

## Updating

```bash
cd /opt/the-logbook

# Stop services
docker compose down

# Pull latest code
git pull

# Rebuild containers
docker compose build

# Start services
docker compose up -d

# Run database migrations
docker compose exec backend alembic upgrade head

# If using RDS (Method 2), start only app containers:
# docker compose up -d backend frontend
```

---

## Troubleshooting

### Cannot Connect to RDS

```bash
# Verify the RDS endpoint is reachable from EC2
mysql -h your-rds-endpoint.rds.amazonaws.com -u admin -p -e "SELECT 1"

# If connection times out, check:
# 1. RDS and EC2 are in the same VPC
# 2. RDS security group allows port 3306 from EC2's security group
# 3. RDS is not set to "Publicly Accessible: No" while EC2 is in a different VPC
```

### Cannot Connect to ElastiCache

```bash
# Test Redis connectivity from EC2
redis-cli -h logbook-redis.xxxx.cache.amazonaws.com -p 6379 ping

# If connection fails:
# 1. Ensure ElastiCache and EC2 are in the same VPC
# 2. Check ElastiCache security group allows port 6379 from EC2
# 3. ElastiCache is never publicly accessible — must connect from within the VPC
```

### EC2 Instance Runs Out of Memory

```bash
# Check memory usage
free -h
docker stats --no-stream

# Option 1: Add swap space
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Option 2: Use the minimal profile
docker compose -f docker-compose.yml -f docker-compose.minimal.yml up -d

# Option 3: Upgrade the instance type
# Stop instance → Change instance type → Start instance
```

### Docker Containers Keep Restarting

```bash
# Check container logs
docker compose logs --tail=100 backend
docker compose logs --tail=100 frontend

# Check if the database is ready (common on first start)
docker compose logs mysql | grep "ready for connections"

# If MySQL is still initializing, wait 1-2 minutes and check again
docker compose ps
```

### SSL Certificate Won't Renew

```bash
# Check certificate status
sudo certbot certificates

# Ensure port 80 is open in the security group
# Certbot needs port 80 for HTTP-01 challenge

# Force renewal
sudo certbot renew --force-renewal

# Check Nginx config
sudo nginx -t
```

---

## Cost Optimization

### Method 1 (EC2 Only)

- Use **Reserved Instances** or **Savings Plans** for 30-60% savings on long-running instances
- Use **t3.small** with the minimal profile if your team is under 20 people
- Consider **Spot Instances** only for development/testing (they can be interrupted)

### Method 2 (EC2 + RDS + ElastiCache)

| Service | Dev/Test | Production |
|---------|----------|------------|
| EC2 | t3.small ($15/mo) | t3.medium ($30/mo) |
| RDS | db.t3.micro ($13/mo) | db.t3.small ($25/mo) |
| ElastiCache | cache.t3.micro ($12/mo) | cache.t3.micro ($12/mo) |
| EBS Storage | 30 GB gp3 ($2.40/mo) | 50 GB gp3 ($4/mo) |
| **Total** | **~$42/mo** | **~$71/mo** |

> **Tip**: RDS and ElastiCache free-tier eligible instances are available for the first 12 months of a new AWS account.

---

## Security Best Practices

- **Never expose database ports** (3306, 6379) to the internet
- Use **IAM roles** instead of access keys when possible
- Enable **RDS encryption at rest** and **in-transit** (SSL)
- Enable **VPC Flow Logs** to monitor network traffic
- Use **AWS Secrets Manager** for sensitive environment variables in production
- Enable **CloudTrail** for API audit logging
- Keep the EC2 instance updated: `sudo apt update && sudo apt upgrade -y`
- Regularly rotate the `.env` secrets (SECRET_KEY, ENCRYPTION_KEY)

---

## Summary

| Step | EC2 Simple | EC2 + RDS Production |
|------|-----------|---------------------|
| 1 | Launch EC2 with security group | Set up VPC, security groups |
| 2 | Install Docker | Create RDS MySQL 8.0 instance |
| 3 | Clone repo, configure .env | Create ElastiCache Redis cluster |
| 4 | `docker compose up -d` | Launch EC2, install Docker |
| 5 | Set up Nginx reverse proxy | Clone repo, configure .env with RDS/ElastiCache endpoints |
| 6 | Enable SSL with Let's Encrypt | `docker compose up -d backend frontend` |
| 7 | Access at `https://your-domain` | Set up Nginx + SSL |
| 8 | Configure backups | Access at `https://your-domain` |

**Need help?** See the [Troubleshooting Guide](../troubleshooting/README.md) or open a [GitHub Issue](https://github.com/thegspiro/the-logbook/issues).
