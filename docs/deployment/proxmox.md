# The Logbook - Proxmox Deployment Guide

Deploy The Logbook on Proxmox VE using either an LXC container or a VM with Docker.

## Overview

Proxmox VE is an open-source virtualization platform that supports both LXC containers and full virtual machines. The Logbook runs well on both, with LXC being the recommended approach for lower overhead.

| Method | Overhead | Best For |
|--------|----------|----------|
| **LXC + Docker** (Recommended) | Low (~50MB) | Most deployments, dedicated Proxmox servers |
| **VM + Docker** | Medium (~512MB) | Full isolation, mixed workloads |
| **Docker directly on host** | Minimal | Single-purpose servers |

---

## Method 1: LXC Container with Docker (Recommended)

### Step 1: Create the LXC Container

1. In Proxmox web UI, click **Create CT**
2. Configure:

| Setting | Value | Notes |
|---------|-------|-------|
| **Template** | `ubuntu-22.04-standard` or `debian-12-standard` | |
| **Hostname** | `the-logbook` | |
| **Root Disk** | 32 GB minimum | 50 GB recommended |
| **CPU Cores** | 2 minimum | 4 recommended |
| **Memory** | 4096 MB minimum | 8192 MB recommended |
| **Swap** | 2048 MB | |
| **Network** | DHCP or static IP | |

3. **Important**: Check **Nesting** under Features (required for Docker)

Or use the CLI:

```bash
# Download template if needed
pveam download local ubuntu-22.04-standard_22.04-1_amd64.tar.zst

# Create container
pct create 200 local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst \
  --hostname the-logbook \
  --memory 4096 \
  --swap 2048 \
  --cores 2 \
  --rootfs local-lvm:32 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --features nesting=1 \
  --unprivileged 1 \
  --start 1
```

### Step 2: Enable Docker Support

SSH into the container or use the Proxmox console:

```bash
# Enter the container
pct enter 200

# Update packages
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh

# Verify Docker is running
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

# Generate security keys
SECRET_KEY=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
DB_PASSWORD=$(openssl rand -base64 24 | tr -d "=+/" | cut -c1-20)
REDIS_PASSWORD=$(openssl rand -base64 24 | tr -d "=+/" | cut -c1-20)
MYSQL_ROOT_PASSWORD=$(openssl rand -base64 24 | tr -d "=+/" | cut -c1-20)

# Update .env with generated values
sed -i "s|^SECRET_KEY=.*|SECRET_KEY=${SECRET_KEY}|" .env
sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=${ENCRYPTION_KEY}|" .env
sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=${DB_PASSWORD}|" .env
sed -i "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=${REDIS_PASSWORD}|" .env
sed -i "s|^MYSQL_ROOT_PASSWORD=.*|MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}|" .env

# Update ALLOWED_ORIGINS with your LXC IP
LXC_IP=$(hostname -I | awk '{print $1}')
sed -i "s|^ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=http://${LXC_IP}:3000|" .env

# Start the application
docker compose up -d

# Verify all containers are running
docker compose ps
```

### Step 4: Access The Logbook

Open your browser: `http://YOUR-LXC-IP:3000`

Complete the onboarding wizard to set up your organization.

---

## Method 2: Virtual Machine with Docker

### Step 1: Create a VM

1. In Proxmox web UI, click **Create VM**
2. Upload an Ubuntu Server 22.04 or Debian 12 ISO
3. Configure:

| Setting | Value |
|---------|-------|
| **OS** | Ubuntu 22.04 or Debian 12 |
| **CPU** | 2 cores minimum (4 recommended) |
| **Memory** | 4 GB minimum (8 GB recommended) |
| **Disk** | 32 GB minimum (50 GB recommended) |
| **Network** | Bridge vmbr0 |

4. Install the OS, then SSH into the VM

### Step 2: Install Docker and Deploy

Follow the same steps as Method 1 starting from Step 2 (Install Docker).

---

## Proxmox-Specific Configuration

### Static IP (Recommended)

Set a static IP for reliable access:

**For LXC** (in Proxmox UI or via CLI):

```bash
pct set 200 --net0 name=eth0,bridge=vmbr0,ip=192.168.1.50/24,gw=192.168.1.1
```

**For VM** (inside the VM):

```bash
# Edit netplan (Ubuntu)
nano /etc/netplan/00-installer-config.yaml
```

```yaml
network:
  ethernets:
    eth0:
      addresses:
        - 192.168.1.50/24
      routes:
        - to: default
          via: 192.168.1.1
      nameservers:
        addresses: [8.8.8.8, 1.1.1.1]
  version: 2
```

```bash
netplan apply
```

### Autostart on Boot

Ensure the container/VM starts automatically when Proxmox boots:

```bash
# For LXC
pct set 200 --onboot 1

# For VM
qm set 200 --onboot 1
```

Docker containers use `restart: unless-stopped`, so they will automatically start when the LXC/VM boots.

### Resource Limits

#### LXC Container Resources

```bash
# Update resources
pct set 200 --memory 8192 --cores 4 --swap 4096

# View current resources
pct config 200
```

#### Recommended Resource Allocation

| Component | Small (1-10 users) | Medium (10-50 users) | Large (50+ users) |
|-----------|-------------------|---------------------|-------------------|
| **CPU Cores** | 2 | 4 | 4-8 |
| **Memory** | 4 GB | 8 GB | 16 GB |
| **Disk** | 32 GB | 50 GB | 100 GB+ |

### Backup with Proxmox

Proxmox integrates with its built-in backup system:

```bash
# Manual backup of LXC container
vzdump 200 --storage local --compress zstd

# Schedule in Proxmox UI:
# Datacenter → Backup → Add
# Select the container/VM, set schedule
```

The Logbook also has its own internal backup system (database + uploads). Both should be configured for full protection.

### Firewall Rules

If using Proxmox firewall, allow the application ports:

```bash
# Allow frontend (port 3000)
pct set 200 --firewall 1
pvesh create /nodes/$(hostname)/lxc/200/firewall/rules \
  --type in --action ACCEPT --dest 3000 --proto tcp

# Allow backend API (port 3001) - optional, for direct API access
pvesh create /nodes/$(hostname)/lxc/200/firewall/rules \
  --type in --action ACCEPT --dest 3001 --proto tcp
```

Or configure in the Proxmox web UI: **Container/VM → Firewall → Add**.

---

## Reverse Proxy Setup

### Nginx Proxy Manager (Recommended for Proxmox)

1. Deploy Nginx Proxy Manager in a separate LXC:

```bash
# Create NPM container
pct create 201 local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst \
  --hostname nginx-proxy \
  --memory 512 \
  --cores 1 \
  --rootfs local-lvm:8 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --features nesting=1 \
  --unprivileged 1
```

2. Configure a proxy host pointing to The Logbook's LXC IP:3000

3. Enable SSL with Let's Encrypt

### Nginx on the Same LXC

```bash
apt install -y nginx certbot python3-certbot-nginx

cat > /etc/nginx/sites-available/logbook << 'EOF'
server {
    listen 80;
    server_name logbook.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/ {
        proxy_pass http://localhost:3001/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

ln -s /etc/nginx/sites-available/logbook /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# Add SSL
certbot --nginx -d logbook.yourdomain.com
```

---

## Troubleshooting

### Docker Won't Start in LXC

**Error**: `Cannot connect to the Docker daemon`

```bash
# Ensure nesting is enabled
pct set 200 --features nesting=1

# Restart the container
pct stop 200 && pct start 200

# Verify inside container
systemctl status docker
```

**If using unprivileged LXC**, add AppArmor profile:

```bash
# On the Proxmox host, edit container config
nano /etc/pve/lxc/200.conf

# Add these lines:
lxc.apparmor.profile: unconfined
lxc.cgroup2.devices.allow: a
lxc.cap.drop:
lxc.mount.auto: proc:rw sys:rw
```

Then restart: `pct stop 200 && pct start 200`

### Container Runs Out of Memory

```bash
# Check memory usage
pct exec 200 -- free -h
pct exec 200 -- docker stats --no-stream

# Increase memory
pct set 200 --memory 8192

# Or reduce application memory usage
# Edit docker-compose.yml to use the minimal profile:
docker compose -f docker-compose.yml -f docker-compose.minimal.yml up -d
```

### Network Connectivity Issues

```bash
# From inside the LXC, test connectivity
ping -c 3 google.com
curl -s https://registry-1.docker.io/v2/ | head -1

# Check DNS resolution
nslookup github.com

# If DNS fails, set nameservers
echo "nameserver 8.8.8.8" > /etc/resolv.conf
```

### Disk Space Running Low

```bash
# Check disk usage
df -h

# Clean Docker resources
docker system prune -a

# Resize LXC disk (on Proxmox host)
pct resize 200 rootfs +20G
```

---

## Performance Optimization

### SSD Storage

Store the LXC/VM on SSD storage for best performance:

```bash
# Move container to SSD pool
pct move-volume 200 rootfs ssd-pool
```

### CPU Pinning (Optional)

For dedicated performance, pin CPU cores:

```bash
# Pin to cores 2-5
pct set 200 --cpulimit 4 --cpuunits 2048
```

### Memory Ballooning (VMs only)

For VMs, enable memory ballooning to share unused RAM:

```bash
qm set 200 --balloon 2048
```

---

## Monitoring

### From Proxmox UI

- **Container/VM → Summary**: CPU, memory, network, disk I/O
- **Container/VM → Monitor**: Real-time metrics

### From Inside the Container

```bash
# Docker container stats
docker stats

# Application health
curl http://localhost:3001/health

# Database status
docker compose exec mysql mysqladmin -u root -p status
```

---

## Migration

### From Unraid to Proxmox

1. Backup The Logbook data on Unraid:
   ```bash
   docker compose exec backend /app/scripts/backup.sh
   ```

2. Copy backup and configuration:
   ```bash
   scp -r /mnt/user/backups/the-logbook/* root@PROXMOX-IP:/tmp/logbook-backup/
   scp /mnt/user/appdata/the-logbook/.env root@PROXMOX-IP:/tmp/logbook-backup/
   ```

3. Deploy on Proxmox following this guide

4. Restore the backup:
   ```bash
   docker compose exec backend /app/scripts/backup.sh --restore /backups/latest-backup.tar.gz
   ```

### From Another Server to Proxmox

Same process — backup data, deploy fresh on Proxmox, restore backup.

---

## Summary

| Step | Action |
|------|--------|
| 1 | Create LXC or VM with nesting enabled |
| 2 | Install Docker |
| 3 | Clone repo and configure .env |
| 4 | Run `docker compose up -d` |
| 5 | Access at `http://YOUR-IP:3000` |
| 6 | Complete onboarding wizard |
| 7 | Configure backup schedule |
| 8 | (Optional) Set up reverse proxy with SSL |

**Need help?** See the [Troubleshooting Guide](../TROUBLESHOOTING.md) or open a [GitHub Issue](https://github.com/thegspiro/the-logbook/issues).
