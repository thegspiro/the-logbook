# The Logbook - Azure Deployment Guide

Deploy The Logbook on Microsoft Azure: on a single Linux virtual machine, or on
a VM backed by Azure Database for MySQL and Azure Managed Redis.

## Overview

| Method                                                                  | Best For                                              |
| ----------------------------------------------------------------------- | ----------------------------------------------------- |
| **Method 1: Azure VM + Docker Compose** (Simple)                        | Small departments, testing, a self-contained install  |
| **Method 2: Azure VM + Azure Database for MySQL + Azure Managed Redis** | Production with provider-managed backups and patching |

Both methods run the same Docker Compose stack on a VM — the same one the
[AWS guide](./aws.md) uses. The repository ships no Kubernetes manifests, Helm
chart or Container Apps definition, so AKS, Azure Container Apps and App
Service for Containers are **not** supported targets: they would need the
persistent `uploads` and `audit_archives` volumes, the ClamAV sidecar and the
startup migration lock re-created by hand.

Prices change by region and over time; use the
[Azure pricing calculator](https://azure.microsoft.com/pricing/calculator/)
with the sizes below rather than a figure printed here.

> **Before you start:** read [BACKUP.md](../BACKUP.md) for how backups and
> restores work, [Pitfalls](#pitfalls) for what goes wrong on Azure in
> particular, and — if you are moving an existing installation rather than
> starting a new one — [Moving an Existing Installation to Azure](#moving-an-existing-installation-to-azure)
> **before** you generate any secrets. Every command below uses placeholder
> names (`rg-logbook`, `logbook.yourdomain.com`, `eastus`); replace them with
> yours.

---

## Prerequisites

- An Azure subscription with permission to create resource groups, virtual
  networks, VMs and (for Method 2) Azure Database for MySQL and Azure Managed
  Redis.
- The [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli)
  (`az`), signed in with `az login` — or use **Cloud Shell** in the Azure
  portal, which has it pre-installed.
- A domain name whose DNS you control, for HTTPS.

### VM sizing

| VM size           | vCPUs | RAM  | Suitable for                                                  |
| ----------------- | ----- | ---- | ------------------------------------------------------------- |
| `Standard_B2s`    | 2     | 4 GB | Method 2 only, once the images are built (see below)          |
| `Standard_B2ms`   | 2     | 8 GB | **Recommended** for both methods — the full stack plus ClamAV |
| `Standard_D2s_v5` | 2     | 8 GB | Steady, non-burstable CPU for larger departments              |

ClamAV holds its signature database in memory and needs 1.5–3 GB on top of the
rest of the stack, which is why Method 1 should not run on a 4 GB VM. Use a
64 GB Premium SSD (or Standard SSD) OS disk; the database, uploads and backup
archives all live on it in Method 1.

The images are **built on the VM** — there are no pre-built images, so the
first `up --build` runs `npm ci` and a full production frontend build there.
Give that build 8 GB. To run Method 2 on a `Standard_B2s`, create the VM as a
`Standard_B2ms`, build and start the stack, then resize it down (portal: VM →
**Size**), and resize back up for each update that rebuilds. Use an x86-64
size: the Arm sizes (`…p…` names such as `Standard_D2ps_v5`) need
`docker-compose.arm.yml`, which swaps MySQL 8.0 for MariaDB 10.11 and is not
the configuration this guide describes.

---

## Method 1: Azure VM with Docker Compose (Simple)

Everything runs on one VM — the application, MySQL, Redis, ClamAV and the
nightly backup sidecar.

### Step 1: Create the Resource Group and Network

```bash
az group create --name rg-logbook --location eastus

# A virtual network with a subnet for the VM. Method 2 adds two more subnets
# to this same network, so create it explicitly rather than letting
# `az vm create` invent one.
az network vnet create \
  --resource-group rg-logbook \
  --name vnet-logbook \
  --address-prefixes 10.20.0.0/16 \
  --subnet-name snet-app \
  --subnet-prefixes 10.20.1.0/24
```

### Step 2: Create the VM

```bash
az vm create \
  --resource-group rg-logbook \
  --name vm-logbook \
  --image Ubuntu2204 \
  --size Standard_B2ms \
  --vnet-name vnet-logbook \
  --subnet snet-app \
  --admin-username azureuser \
  --generate-ssh-keys \
  --public-ip-sku Standard \
  --public-ip-address-dns-name your-unique-logbook-label \
  --os-disk-size-gb 64 \
  --nsg-rule SSH
```

A Standard-SKU public IP is static, so the address does not change when the VM
is stopped and started. The DNS label gives the VM a name of the form
`your-unique-logbook-label.eastus.cloudapp.azure.com`, useful until your own
domain points at it.

The command prints `publicIpAddress` — note it.

### Step 3: Lock Down the Network Security Group

`az vm create` names the VM's network security group `vm-logbookNSG` and opens
SSH to the whole internet. Narrow SSH to your own address and open only HTTP
and HTTPS:

```bash
# Restrict SSH to your public IP (find it with: curl -s https://ifconfig.me)
az network nsg rule update \
  --resource-group rg-logbook \
  --nsg-name vm-logbookNSG \
  --name default-allow-ssh \
  --source-address-prefixes YOUR.PUBLIC.IP.ADDRESS/32

# HTTP (for the Let's Encrypt challenge and the redirect) and HTTPS
az vm open-port \
  --resource-group rg-logbook \
  --name vm-logbook \
  --port 80,443 \
  --priority 1010

# Refuse the frontend's port 3000 to the rest of the virtual network
az network nsg rule create \
  --resource-group rg-logbook \
  --nsg-name vm-logbookNSG \
  --name deny-vnet-frontend-3000 \
  --priority 1020 \
  --direction Inbound \
  --access Deny \
  --protocol Tcp \
  --source-address-prefixes VirtualNetwork \
  --destination-port-ranges 3000
```

| Port | Source          | Purpose                                   |
| ---- | --------------- | ----------------------------------------- |
| 22   | Your IP         | Administration (or use Azure Bastion)     |
| 80   | Internet        | Let's Encrypt HTTP-01 challenge, redirect |
| 443  | Internet        | The application                           |
| 3000 | Virtual network | **Denied** — see below                    |

> **Never open 3000, 3001, 3306 or 6379.** The production stack does not
> publish the backend port at all, and the database and Redis must stay on the
> stack's private Docker network.

**Why port 3000 needs an explicit deny.** The frontend container publishes
port 3000 on every interface of the VM (`docker-compose.yml`), and Nginx in
Step 7 reaches it on `localhost`. Internet traffic to 3000 is already refused,
but every NSG carries Azure's built-in `AllowVnetInBound` rule, so any other
machine on the virtual network can reach it. The production backend trusts
`X-Forwarded-For` from `10.0.0.0/8` (`TRUSTED_PROXY_IPS` in
`docker-compose.prod.yml`), so such a machine could claim any client address
and sidestep per-client rate limiting and the IPs recorded in the audit log.
Rule 1020 outranks `AllowVnetInBound` (65000). Traffic Nginx sends over
loopback is not subject to the NSG, so the application is unaffected.

If you would rather not expose SSH at all, deploy
[Azure Bastion](https://learn.microsoft.com/azure/bastion/bastion-overview) on
the virtual network and delete the `default-allow-ssh` rule.

### Step 4: Point Your Domain at the VM

Create an **A record** for `logbook.yourdomain.com` pointing at the VM's public
IP — at your registrar, or in an
[Azure DNS](https://learn.microsoft.com/azure/dns/dns-overview) zone if you host
the domain there. Let's Encrypt (Step 8) cannot issue a certificate until this
resolves.

### Step 5: Install Docker

```bash
ssh azureuser@YOUR-VM-PUBLIC-IP

sudo apt update && sudo apt upgrade -y

curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Log out and back in so the docker group takes effect
exit
ssh azureuser@YOUR-VM-PUBLIC-IP

docker --version
docker compose version   # must be v2.24.4 or later (the production override uses !override / !reset)
```

### Step 6: Deploy The Logbook

```bash
sudo git clone https://github.com/thegspiro/the-logbook.git /opt/the-logbook
sudo chown -R "$USER":"$USER" /opt/the-logbook
cd /opt/the-logbook

cp .env.example .env

# Generate secrets
SECRET_KEY=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
ENCRYPTION_SALT=$(openssl rand -hex 16)
DB_PASSWORD=$(openssl rand -base64 24 | tr -d "=+/" | cut -c1-20)
REDIS_PASSWORD=$(openssl rand -base64 24 | tr -d "=+/" | cut -c1-20)
MYSQL_ROOT_PASSWORD=$(openssl rand -base64 24 | tr -d "=+/" | cut -c1-20)

sed -i "s|^SECRET_KEY=.*|SECRET_KEY=${SECRET_KEY}|" .env
sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=${ENCRYPTION_KEY}|" .env
sed -i "s|^ENCRYPTION_SALT=.*|ENCRYPTION_SALT=${ENCRYPTION_SALT}|" .env
sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=${DB_PASSWORD}|" .env
sed -i "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=${REDIS_PASSWORD}|" .env
sed -i "s|^MYSQL_ROOT_PASSWORD=.*|MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}|" .env

# The public address. FRONTEND_URL builds every link in outgoing email,
# and its default points at localhost.
sed -i "s|^ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=https://logbook.yourdomain.com|" .env
sed -i "s|^FRONTEND_URL=.*|FRONTEND_URL=https://logbook.yourdomain.com|" .env

sed -i "s|^ENVIRONMENT=.*|ENVIRONMENT=production|" .env
sed -i "s|^DEBUG=.*|DEBUG=false|" .env

# The bundled MySQL and Redis speak plaintext on the stack's private Docker
# network. Production refuses to start without TLS to both unless this is
# recorded. (Method 2 uses TLS instead.)
echo "SECURITY_REQUIRE_TLS=false" >> .env

# Pin the production override so every later `docker compose ...` uses it
echo "COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml" >> .env
```

Store a copy of `ENCRYPTION_KEY` and `ENCRYPTION_SALT` somewhere outside the VM
— an [Azure Key Vault](https://learn.microsoft.com/azure/key-vault/general/overview)
secret, or your department's password manager. Without them, encrypted fields
and uploaded files in a restored backup cannot be read. See
[KEY_ROTATION.md](../KEY_ROTATION.md). (Moving an existing installation? Do
**not** generate new values for these two — see
[Moving an Existing Installation to Azure](#moving-an-existing-installation-to-azure).)

Create the backup encryption keys now, before the first nightly backup runs.
Until they exist, every archive is written **unencrypted** and cannot be sent
off the VM (see [Backups](#backups)):

```bash
./scripts/backup-keygen.sh
```

It prints a private key once and asks you to type `SAVED`. Put that key in your
password manager or Key Vault, apart from the VM and its backups; it is the
only way to read an archive if the VM is lost. See
[BACKUP.md → Encrypted backups](../BACKUP.md#encrypted-backups).

Check the configuration, then start the stack:

```bash
docker compose run --rm --build backend python -m app.preflight

docker compose up -d --build

# backend, frontend, mysql, redis, clamav and backup should all be healthy
docker compose ps
docker compose logs -f backend   # wait for the schema-up-to-date message, then Ctrl+C
```

Migrations need no separate step: the backend applies them on every start.

> **Why the production override matters.** The base `docker-compose.yml` is a
> development configuration (uvicorn `--reload`, backend port published, API
> docs enabled, no HTTPS enforcement). `docker-compose.prod.yml` disables all
> of that, adds the nightly `backup` sidecar, and makes the app **refuse to
> start** if a required secret is missing or weak, `DEBUG` is on, or HTTPS is
> not enforced. HTTPS itself is terminated by the Nginx proxy in the next step.

### Step 7: Set Up the Nginx Reverse Proxy

```bash
sudo apt install -y nginx

sudo tee /etc/nginx/sites-available/logbook > /dev/null << 'EOF'
# Anonymous suggestion-box submissions and follow-ups are never access-logged:
# a line holding the client IP and the exact second would identify the member.
map $request_uri $access_loggable {
    "~^/api/v1/suggestions/(boxes/[^/?]+/submissions(\?|$)|follow-up/)" 0;
    default 1;
}

server {
    listen 80;
    server_name logbook.yourdomain.com;

    access_log /var/log/nginx/access.log combined if=$access_loggable;

    # The backend's own ceiling (MAX_REQUEST_BODY_SIZE)
    client_max_body_size 60M;

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

    # No separate /api/ block: the production override does not publish the
    # backend's port 3001, and the frontend container already forwards /api to
    # the backend over the stack's private network.
}
EOF

sudo ln -s /etc/nginx/sites-available/logbook /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

To terminate TLS in a container instead of a host-installed Nginx, layer
`docker-compose.proxy.yml` after `docker-compose.prod.yml` (in `COMPOSE_FILE`)
and follow "Docker Compose production profile" in
[DEPLOYMENT.md](../DEPLOYMENT.md); skip this step and the next.

### Step 8: Enable HTTPS with Let's Encrypt

```bash
sudo apt install -y certbot python3-certbot-nginx

# The A record from Step 4 must already resolve to this VM
sudo certbot --nginx -d logbook.yourdomain.com

sudo certbot renew --dry-run
```

See [TLS.md](../TLS.md) for the application's own TLS expectations.

### Step 9: Open The Logbook

Browse to `https://logbook.yourdomain.com` and complete the onboarding wizard
to set up your department.

---

## Method 2: Azure VM + Azure Database for MySQL + Azure Managed Redis (Production)

The database and Redis move to managed services on private network addresses;
the VM runs only the application containers (`backend`, `frontend`,
`clamav`).

> **Why Azure Managed Redis, not Azure Cache for Redis.** Microsoft is retiring
> the Basic, Standard and Premium tiers of Azure Cache for Redis (retirement
> 2028-09-30), and stopped allowing **new** caches on those tiers — for new
> customers from 2026-04-01 and for existing customers from 2026-10-01. A new
> install therefore uses Azure Managed Redis. If you already run an Azure Cache
> for Redis instance, it works the same way as below except that its TLS port
> is `6380`, not `10000`; plan its migration with Microsoft's
> [retirement FAQ](https://learn.microsoft.com/azure/azure-cache-for-redis/retirement-faq).

### Step 1: Create the Network

Follow Method 1, Step 1, then add one subnet delegated to MySQL and one for the
Redis private endpoint:

```bash
# Azure Database for MySQL with private access needs a subnet delegated to it,
# holding nothing else
az network vnet subnet create \
  --resource-group rg-logbook \
  --vnet-name vnet-logbook \
  --name snet-mysql \
  --address-prefixes 10.20.2.0/24 \
  --delegations Microsoft.DBforMySQL/flexibleServers

# The Azure Managed Redis private endpoint goes here
az network vnet subnet create \
  --resource-group rg-logbook \
  --vnet-name vnet-logbook \
  --name snet-redis \
  --address-prefixes 10.20.3.0/24
```

### Step 2: Create the Azure Database for MySQL Flexible Server

In the portal, **Create a resource → Azure Database for MySQL → Flexible
server**:

| Setting                 | Value                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| **Resource group**      | `rg-logbook`                                                                                            |
| **Server name**         | `logbook-mysql` (becomes `logbook-mysql.mysql.database.azure.com`)                                      |
| **Region**              | Same as the VM                                                                                          |
| **MySQL version**       | **8.0** — the version the bundled stack and CI run                                                      |
| **Workload type**       | Small/medium; compute **Burstable `Standard_B1ms`** or **`Standard_B2s`**                               |
| **Storage**             | 32 GB or more, **storage auto-growth on**                                                               |
| **High availability**   | Off for testing; zone-redundant for production if your budget allows                                    |
| **Authentication**      | MySQL authentication only                                                                               |
| **Admin username**      | e.g. `logbookadmin` — reserved names such as `admin` and `root` are refused                             |
| **Password**            | A strong generated password                                                                             |
| **Connectivity method** | **Private access (VNet integration)**, VNet `vnet-logbook`, subnet `snet-mysql`, a new private DNS zone |
| **Backup retention**    | 7 days or more; geo-redundant backup if the region pair suits you                                       |

The connectivity method **cannot be changed after the server is created**.
Choose private access now; a server created with public access would need to be
recreated to move onto the virtual network. The private DNS zone lets the VM
resolve `logbook-mysql.mysql.database.azure.com` to the server's private
address — always connect by that name, never by IP, or TLS hostname
verification fails.

Or, with the CLI:

```bash
az mysql flexible-server create \
  --resource-group rg-logbook \
  --name logbook-mysql \
  --location eastus \
  --version 8.0.21 \
  --tier Burstable \
  --sku-name Standard_B2s \
  --storage-size 32 \
  --storage-auto-grow Enabled \
  --backup-retention 7 \
  --admin-user logbookadmin \
  --admin-password 'YOUR-STRONG-PASSWORD' \
  --vnet vnet-logbook \
  --subnet snet-mysql \
  --private-dns-zone logbook-mysql.private.mysql.database.azure.com
```

**Server parameters.** The bundled MySQL container starts with these settings
(`mysql:` in `docker-compose.yml`); give the managed server the same ones:

```bash
az mysql flexible-server parameter set -g rg-logbook --server-name logbook-mysql \
  --name character_set_server --value utf8mb4
az mysql flexible-server parameter set -g rg-logbook --server-name logbook-mysql \
  --name collation_server --value utf8mb4_unicode_ci
az mysql flexible-server parameter set -g rg-logbook --server-name logbook-mysql \
  --name max_allowed_packet --value 268435456
```

Leave `require_secure_transport` **ON** (Azure's default): the app connects over
verified TLS (Step 5).

**Create the database** with the character set given explicitly, so every
table the app creates inherits it whatever the server default is. The
database must be **The Logbook's alone** — see the warning below.

```bash
az mysql flexible-server db create \
  --resource-group rg-logbook \
  --server-name logbook-mysql \
  --database-name the_logbook \
  --charset utf8mb4 \
  --collation utf8mb4_unicode_ci
```

> **The backend empties any database it takes for new.** On start, a database
> with no `alembic_version` table is treated as a fresh install: the backend
> **drops every table in it** and builds the schema from the models
> (`_fast_path_init` in `backend/main.py`). It cannot tell an empty database
> from one holding someone else's data. So:
>
> - point `DB_NAME` only at a database created for The Logbook, as above —
>   never at one another application uses, and never at `mysql`, `sys` or
>   another system schema;
> - never hand-load a partial dump (one without `alembic_version`) into it and
>   then start the backend; restore with `./scripts/backup.sh --restore`, as in
>   [Moving an Existing Installation to Azure](#moving-an-existing-installation-to-azure).
>
> Azure's point-in-time restore is the way back if this happens, which is one
> more reason to keep its backup retention at 7 days or more.

### Step 3: Create the Azure Managed Redis Cache

In the portal, **Create a resource → Azure Managed Redis**:

| Setting                 | Value                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| **Name**                | `logbook-redis` (becomes `logbook-redis.<region>.redis.azure.net`)                                    |
| **Region**              | Same as the VM                                                                                        |
| **Performance tier**    | The smallest **Balanced** size is ample — the app keeps sessions, rate limits and cache entries there |
| **Connectivity**        | **Private endpoint** in `vnet-logbook` / `snet-redis`, integrated with a private DNS zone             |
| **Public access**       | Disabled                                                                                              |
| **Clustering policy**   | **Non-clustered** (see below)                                                                         |
| **Authentication**      | **Access keys authentication enabled** — the app authenticates with a password                        |
| **Minimum TLS version** | 1.2                                                                                                   |

**Clustering policy.** The backend connects with a single non-cluster-aware
Redis URL on database `0` and runs Lua scripts for its background-task lock.
**Non-clustered** (offered for caches of 25 GB and under) avoids every
cross-slot restriction and is the right fit. **Enterprise** also presents a
single endpoint and works with this client, but carries multi-key command
limitations. **Do not choose OSS**: it requires a cluster-aware client, which
the app does not use. Changing the policy later may mean recreating the cache,
so choose now.

After creation, copy the **primary access key** from **Settings →
Authentication → Access keys**. It becomes `REDIS_PASSWORD`. Azure Managed
Redis listens with TLS on port **10000**.

### Step 4: Create the VM and Install Docker

Follow Method 1, Steps 2–5. Create the VM as a `Standard_B2ms` even if you mean
to run on a `Standard_B2s`: the first build needs the memory (see
[VM sizing](#vm-sizing)). Clone the repository as in Method 1, Step 6 — but
configure `.env` as below rather than as in Method 1, and do not start the
stack yet.

The NSG rules from Method 1, Step 3 are unchanged, including the port 3000
deny. The managed services are reached over the virtual network and need no
inbound rule on the VM.

Install the MySQL command-line client on the VM itself. `./scripts/backup.sh`
uses it to dump and restore a database that is not in a container:

```bash
sudo apt install -y mysql-client
```

### Step 5: Fetch the CA Certificates

The production stack refuses to start unless both connections use TLS with a
verified certificate. The backend reads CA files from `/etc/ssl/logbook`, which
is `./infrastructure/certs` on the host (or `SSL_CERTS_DIR`, if you set it).

Azure Database for MySQL is moving from DigiCert Global Root CA to DigiCert
Global Root G2 and Microsoft RSA Root Certificate Authority 2017. Microsoft's
guidance for clients other than .NET on Windows is one file holding **all
three**, so a server-side rotation causes no outage:

```bash
cd /opt/the-logbook/infrastructure/certs

curl -fsSL -o DigiCertGlobalRootCA.crt.pem \
  https://cacerts.digicert.com/DigiCertGlobalRootCA.crt.pem
curl -fsSL -o DigiCertGlobalRootG2.crt.pem \
  https://cacerts.digicert.com/DigiCertGlobalRootG2.crt.pem
# Microsoft publishes this root in DER form; convert it to PEM
curl -fsSL -o MicrosoftRSARootCA2017.crt \
  "https://www.microsoft.com/pkiops/certs/Microsoft%20RSA%20Root%20Certificate%20Authority%202017.crt"
openssl x509 -inform DER -in MicrosoftRSARootCA2017.crt -out MicrosoftRSARootCA2017.crt.pem

cat DigiCertGlobalRootCA.crt.pem DigiCertGlobalRootG2.crt.pem \
  MicrosoftRSARootCA2017.crt.pem > azure-combined-ca.pem
```

The same combined file covers Azure Managed Redis, whose certificates chain to
the same DigiCert and Microsoft roots. Confirm what each endpoint actually
presents before relying on it:

```bash
openssl s_client -connect logbook-mysql.mysql.database.azure.com:3306 -starttls mysql \
  -CAfile azure-combined-ca.pem </dev/null 2>/dev/null | grep "Verify return code"
openssl s_client -connect logbook-redis.eastus.redis.azure.net:10000 \
  -CAfile azure-combined-ca.pem </dev/null 2>/dev/null | grep "Verify return code"
```

Both should print `Verify return code: 0 (ok)`. If one does not, run the same
command with `-showcerts`, find the root it chains to, and add that root's PEM
to `azure-combined-ca.pem`. (`-starttls mysql` needs OpenSSL 1.1.1 or later,
which Ubuntu 22.04 has.)

### Step 6: Configure `.env`

```bash
cd /opt/the-logbook
cp .env.example .env

SECRET_KEY=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
ENCRYPTION_SALT=$(openssl rand -hex 16)
sed -i "s|^SECRET_KEY=.*|SECRET_KEY=${SECRET_KEY}|" .env
sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=${ENCRYPTION_KEY}|" .env
sed -i "s|^ENCRYPTION_SALT=.*|ENCRYPTION_SALT=${ENCRYPTION_SALT}|" .env

# Azure Database for MySQL
sed -i "s|^DB_HOST=.*|DB_HOST=logbook-mysql.mysql.database.azure.com|" .env
sed -i "s|^DB_PORT=.*|DB_PORT=3306|" .env
sed -i "s|^DB_NAME=.*|DB_NAME=the_logbook|" .env
sed -i "s|^DB_USER=.*|DB_USER=logbookadmin|" .env
sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=your-mysql-admin-password|" .env

# Azure Managed Redis (the primary access key from Step 3)
sed -i "s|^REDIS_HOST=.*|REDIS_HOST=logbook-redis.eastus.redis.azure.net|" .env
sed -i "s|^REDIS_PORT=.*|REDIS_PORT=10000|" .env
sed -i "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=your-redis-primary-access-key|" .env

# The bundled mysql service never starts with this override, but compose still
# reads its definition, which requires a value here. It is used for nothing.
sed -i "s|^MYSQL_ROOT_PASSWORD=.*|MYSQL_ROOT_PASSWORD=$(openssl rand -hex 24)|" .env

sed -i "s|^ENVIRONMENT=.*|ENVIRONMENT=production|" .env
sed -i "s|^DEBUG=.*|DEBUG=false|" .env
sed -i "s|^ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=https://logbook.yourdomain.com|" .env
sed -i "s|^FRONTEND_URL=.*|FRONTEND_URL=https://logbook.yourdomain.com|" .env

# Verified TLS to both services (container paths, not host paths)
cat >> .env <<'EOF'
DB_SSL=true
DB_SSL_CA=/etc/ssl/logbook/azure-combined-ca.pem
REDIS_SSL=true
REDIS_SSL_CA=/etc/ssl/logbook/azure-combined-ca.pem
SECURITY_REQUIRE_TLS=true
COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml:docker-compose.external-services.yml
EOF
```

If an access key contains `|` or `&`, the `sed` lines above will mangle it;
edit `.env` by hand for that value instead.

Then create the backup encryption keys, as in Method 1, Step 6:

```bash
./scripts/backup-keygen.sh
```

**TLS for the backup script.** `./scripts/backup.sh` runs `mysqldump` and
`mysql` on the VM against `DB_HOST`. Those clients read their TLS settings from
an option file, not from `.env`, so give them one — as the user the backups run
as (`azureuser`, not root):

```bash
cat > ~/.my.cnf <<'EOF'
[client]
ssl-mode=VERIFY_IDENTITY
ssl-ca=/opt/the-logbook/infrastructure/certs/azure-combined-ca.pem

[mysqldump]
# Azure Database for MySQL runs with GTIDs on. A dump that carries
# SET @@GLOBAL.GTID_PURGED cannot be loaded back into a server that has
# executed transactions of its own, which every Flexible Server has.
set-gtid-purged=OFF
no-tablespaces
EOF
chmod 600 ~/.my.cnf
```

Without it the clients still encrypt the connection (Azure requires TLS) but do
not check the server's certificate.

`docker-compose.external-services.yml`:

- points the backend at `DB_HOST`, `DB_PORT`, `REDIS_HOST` and `REDIS_PORT`
  from `.env`, with no defaults — a missing value stops `docker compose` with a
  message naming it;
- drops the backend's dependency on the bundled `mysql` and `redis`;
- keeps `mysql`, `redis` and the `backup` sidecar from starting (see
  [Backups → Method 2](#method-2-managed-services) for what replaces it).

The `COMPOSE_FILE` line applies all three files to every later
`docker compose ...` command, so none of them can fall back to the bundled
database.

### Step 7: Start the Stack

```bash
# Expect: backend, clamav, frontend
docker compose config --services

docker compose run --rm --build backend python -m app.preflight
docker compose up -d --build

docker compose ps
docker compose logs -f backend   # first start creates every table on the new database

# Confirm the backend actually reached Redis (see below)
docker compose logs backend | grep -E "Redis connected|Redis unavailable|Redis connection failed"
```

**A Redis the backend cannot reach does not stop it starting.** A wrong port,
a CA that does not verify or a rotated access key is logged as a warning, and
the backend runs on without Redis: caching off, and rate limiting falling back
to per-process memory. Against the bundled Redis that covers a brief outage;
against a managed service a configuration mistake would stay in place,
unnoticed. Look for `✓ Redis connected` after the first start and after any
change to the `REDIS_*` settings or the access key. `REDIS_REQUIRED=true` is
meant to turn this into a refusal to start, but in this release the startup
code catches the failure regardless, so it does not; check the log instead.

Never run `docker compose up -d mysql` (or `redis`) against this stack: compose
starts a service you name even when its profile is off, and nothing would use
it.

### Step 8: Nginx, HTTPS and First Sign-In

Follow Method 1, Steps 7–9.

---

## Azure-Specific Configuration

### Malware Scanning

Every uploaded file is scanned with ClamAV before it is stored. The bundled
`clamav` service always starts, and `CLAMAV_ENABLED` defaults to `true`. An
unreachable scanner refuses uploads rather than storing them unscanned. Setting
`CLAMAV_ENABLED=false` accepts files unscanned behind a standing warning to
administrators; read
[Security Configuration → Malware scanning](../../wiki/Configuration-Security.md#malware-scanning-of-uploads)
first. Allow 1.5–3 GB of RAM for clamd, as in the sizing table.

### Outbound Email

Azure blocks outbound SMTP on port 25 from most subscription types. Send mail
through an authenticated relay on port 587 instead — your Microsoft 365 tenant,
Azure Communication Services Email, or another provider — and set the `SMTP_*`
variables accordingly. See [EMAIL_DELIVERABILITY.md](../EMAIL_DELIVERABILITY.md)
and [Integration: Microsoft 365](../../wiki/Integration-Microsoft-365.md). For
Microsoft Entra ID (Azure AD) sign-in, see the `AZURE_AD_*` variables in
`.env.example.full`.

### Monitoring

- Enable **VM insights** (Azure Monitor agent) on the VM for CPU, memory and
  disk metrics.
- Create alerts for CPU above 80% for 5 minutes, OS disk above 85% full, and
  VM availability.
- Azure Database for MySQL and Azure Managed Redis publish their own metrics;
  alert on storage percentage and connection failures.
- Application logs stay in the containers (`docker compose logs`). If you ship
  them to Log Analytics, remember they may contain member identifiers and
  treat the workspace as holding PHI.

### Secrets

`.env` on the VM holds every secret. Restrict it with `chmod 600 .env`, keep the
VM's OS disk encrypted (Azure encrypts managed disks at rest by default), and
keep an off-VM copy of `ENCRYPTION_KEY` and `ENCRYPTION_SALT` in Key Vault. The
application reads its configuration from environment variables only; it has no
Key Vault integration of its own.

---

## Backups

Every backup holds every member's records. **Only encrypted archives leave the
VM.** Encryption needs the keys from `./scripts/backup-keygen.sh` (Method 1,
Step 6); until they exist, archives are written in plaintext, administrators
see a "Backups are not encrypted" notice, and `./scripts/backup.sh` refuses to
upload anything. Do not work around that refusal by copying the backup
directory with a general-purpose sync tool: that is exactly the plaintext copy
it exists to prevent. See [BACKUP.md](../BACKUP.md#encrypted-backups).

### The Storage Account (Both Methods)

Create a private storage account, let only the VM's subnet reach it, and give
the VM a managed identity that may write to it, so no storage key is kept on
the VM:

```bash
az storage account create -g rg-logbook -n yourorglogbookbackups \
  --sku Standard_GRS --min-tls-version TLS1_2 --allow-blob-public-access false
az storage container create --account-name yourorglogbookbackups \
  --name logbook-backups --auth-mode login

# Reachable only from the VM's subnet
az network vnet subnet update -g rg-logbook --vnet-name vnet-logbook \
  -n snet-app --service-endpoints Microsoft.Storage
az storage account network-rule add -g rg-logbook \
  --account-name yourorglogbookbackups --vnet-name vnet-logbook --subnet snet-app
az storage account update -g rg-logbook -n yourorglogbookbackups --default-action Deny

# The VM's identity, allowed to write blobs in this account only
az vm identity assign -g rg-logbook -n vm-logbook
az role assignment create \
  --assignee "$(az vm show -g rg-logbook -n vm-logbook --query identity.principalId -o tsv)" \
  --role "Storage Blob Data Contributor" \
  --scope "$(az storage account show -g rg-logbook -n yourorglogbookbackups --query id -o tsv)"
```

Turn on **blob soft delete** and a lifecycle rule (portal: storage account →
Data protection, and Lifecycle management) so a mistaken or malicious delete
can be undone and old archives expire. With `--default-action Deny`, browsing
the container from the portal or your own computer is refused too; to fetch an
archive from outside the VM, add your address with
`az storage account network-rule add --ip-address`, and remove it afterwards.

Then, on the VM, install the Azure CLI and sign it in as the VM's identity, as
the user the backups run as (`azureuser`):

```bash
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
az login --identity
```

And name the destination in `.env`, where `./scripts/backup.sh` reads it:

```bash
cat >> /opt/the-logbook/.env <<'EOF'
AZURE_STORAGE_ACCOUNT=yourorglogbookbackups
AZURE_STORAGE_CONTAINER=logbook-backups
EOF
```

### Method 1 (Single VM)

The production stack's `backup` sidecar takes a nightly encrypted archive of
the database, uploads and audit archives (at `BACKUP_TIME`, default 02:00 UTC),
prunes archives older than `BACKUP_RETENTION_DAYS`, and runs a
restore-verification drill every `VERIFY_EVERY_N_BACKUPS` runs. Its archives
stay on the VM's disk. For the offsite copy, run `./scripts/backup.sh` from
`azureuser`'s crontab at a different hour; it writes its own encrypted archive
and uploads it, together with its `.key` and `.sha256` files, under
`backups/` in the container:

```bash
# crontab -e (as azureuser)
30 3 * * * cd /opt/the-logbook && AZURE_STORAGE_AUTH_MODE=login ./scripts/backup.sh --destination azure >> "$HOME/logbook-offsite-backup.log" 2>&1
```

`AZURE_STORAGE_AUTH_MODE=login` makes `az storage blob upload` authenticate as
the VM's identity rather than look for an account key.

`./scripts/backup.sh`'s archive does **not** include the `audit_archives`
volume; the sidecar's does. Once a retention purge has run, those files are
the only copy of that audit history, so copy the sidecar's encrypted archives
offsite too — and only those, which is what the include pattern does:

```bash
# root's crontab (the volume lives under Docker's data directory); needs AzCopy
azcopy login --identity
azcopy sync \
  "$(docker volume inspect the-logbook_backups -f '{{ .Mountpoint }}')" \
  "https://yourorglogbookbackups.blob.core.windows.net/logbook-backups/sidecar" \
  --include-pattern "*.tar.gz.enc;*.tar.gz.enc.key;*.tar.gz.enc.sha256"
```

([AzCopy](https://learn.microsoft.com/azure/storage/common/storage-use-azcopy-v10)
installs as a single binary.) A plaintext archive is named `….tar.gz` and
matches none of those patterns, so it is never copied.

Also consider **Azure Backup** for the VM itself (a daily recovery point of the
whole disk). It complements the archives; it does not replace them, because a
disk snapshot of a running MySQL is only crash-consistent.

### Method 2 (Managed Services)

The `backup` sidecar does not run: `docker-compose.external-services.yml` turns
it off, because it dumps and drills against the bundled MySQL. Azure Database
for MySQL covers the database itself:

- **Automated backups** with the retention chosen in Step 2 (up to 35 days),
  optionally geo-redundant.
- **Point-in-time restore** to any second within that retention, always to a
  **new** server.
- **On-demand backups** from the portal before an upgrade.

Those backups live and die with the server and the subscription. For a copy
outside them, and for the `uploads` volume, which nothing else backs up, run
`./scripts/backup.sh` nightly. It dumps the Azure database over verified TLS
(the `~/.my.cnf` from Step 6), archives the uploads from the backend container,
encrypts the result and uploads it:

```bash
# crontab -e (as azureuser)
30 3 * * * cd /opt/the-logbook && AZURE_STORAGE_AUTH_MODE=login ./scripts/backup.sh --destination azure >> "$HOME/logbook-offsite-backup.log" 2>&1
```

The uploaded files are themselves encrypted by the application with
`ENCRYPTION_KEY` / `ENCRYPTION_SALT`
(see "Secrets are NOT in the backup" in [BACKUP.md](../BACKUP.md)),
so the archive is unreadable without both the backup keys and those secrets.

**The `audit_archives` volume needs a copy of its own.** Neither
`./scripts/backup.sh` nor Azure's backups include it, and once a retention
purge has run it is the only copy of that audit history. Its files are gzipped
JSON lines the application does **not** encrypt, so copy them only into the
private, subnet-restricted account above (encrypted at rest by Azure):

```bash
# root's crontab; needs AzCopy
azcopy login --identity
azcopy sync \
  "$(docker volume inspect the-logbook_audit_archives -f '{{ .Mountpoint }}')" \
  "https://yourorglogbookbackups.blob.core.windows.net/logbook-backups/audit_archives"
```

Restore drills are yours to run in Method 2: from time to time, restore the
MySQL server to a new server and point a test stack at it, and restore one of
the `./scripts/backup.sh` archives into that test stack. Azure Managed Redis
holds no data that needs backing up — sessions and cache entries rebuild
themselves.

---

## Moving an Existing Installation to Azure

Bring the data across with the repository's own backup and restore, never a
hand-made dump: the backend empties a database that has no `alembic_version`
table (see the warning in Method 2, Step 2).

1. **On the old server**, make sure backup keys exist
   (`./scripts/backup-keygen.sh` if not), then take a fresh backup:
   `./scripts/backup.sh`. Note the release you are running (`git describe
--tags` or `git rev-parse HEAD`).
2. **Copy across**, over SSH: the newest `logbook_backup_*.tar.gz.enc` with its
   `.key` and `.sha256` files, and the `backup-keys/` directory (or have the
   backup's private key to hand).
3. **On the Azure VM**, check out the same release you were running, then build
   `.env` as Method 1 or Method 2, Step 6 describes — but **copy `SECRET_KEY`,
   `ENCRYPTION_KEY` and `ENCRYPTION_SALT` from the old `.env` instead of
   generating new ones.** New values make every encrypted field and every
   uploaded file in the backup unreadable, and leave every registered NFC tag
   and ID card unmatched. Put `backup-keys/` back in place.
4. **Start the stack** as the method describes and wait until the backend
   reports the schema up to date. It builds empty tables in the new database.
5. **Restore** into it — this replaces those empty tables, the uploads and the
   `alembic_version` row:

   ```bash
   ./scripts/backup.sh --restore /path/to/logbook_backup_YYYYmmdd_HHMMSS.tar.gz.enc
   docker compose restart backend
   ```

   Add `--private-key FILE` if you brought the backup's private key rather
   than `backup-keys/`. In Method 2, the restore runs `mysql` on the VM against
   Azure, which is why it needs the `mysql-client` package and `~/.my.cnf`.

6. **Verify** as in BACKUP.md's
   [restore drill](../BACKUP.md#verify-your-backups-restore-drill), then move
   DNS to the new VM and issue its certificate (Method 1, Steps 4 and 8).
7. **Then upgrade**, if you want a newer release, with the
   [Updating](#updating) steps — one change at a time, so a problem is clearly
   either the move or the upgrade. Read [UPGRADING.md](../UPGRADING.md) first.

The `audit_archives` volume is not in `./scripts/backup.sh`'s archive. If the
old server has one, copy its contents across with `tar` over SSH into the new
VM's `the-logbook_audit_archives` volume before step 5.

---

## Updating

Read [UPGRADING.md](../UPGRADING.md) before pulling: it lists every change
that can stop an existing installation from starting. Never downgrade to
repair a migration problem — several migrations do not reverse.

```bash
cd /opt/the-logbook

# 1. Back up first (Method 2: also take an on-demand backup in the portal)
./scripts/backup.sh

# Method 2 on a B2s: resize the VM to B2ms before the rebuild (see VM sizing)

# 2. Pull and repair build contexts
git pull
./scripts/sync-compose-build-context.sh --fix -f docker-compose.yml

# 3. Check the new version's configuration before restarting
docker compose run --rm --build backend python -m app.preflight

# 4. Rebuild and recreate; migrations run as the backend starts
docker compose up -d --build

# 5. Verify
docker compose ps
curl -s https://logbook.yourdomain.com/health
```

The commands are the same for both methods; Method 2's `COMPOSE_FILE` line
applies the external-services file to each of them.

---

## Troubleshooting

### Cannot Connect to Azure Database for MySQL

```bash
# Name resolution must return a private 10.20.2.x address, not a public one
getent hosts logbook-mysql.mysql.database.azure.com

# Connect over verified TLS with the CA file the backend uses
cd /opt/the-logbook
docker run --rm -it -v "$PWD/infrastructure/certs:/certs:ro" mysql:8.0 \
  mysql -h logbook-mysql.mysql.database.azure.com -u logbookadmin -p \
  --ssl-mode=VERIFY_IDENTITY --ssl-ca=/certs/azure-combined-ca.pem \
  -e "SELECT 1"
```

If it times out or the name does not resolve:

1. The VM and the server must be in the same virtual network (or peered ones).
2. The private DNS zone created with the server must be **linked** to
   `vnet-logbook` (portal: private DNS zone → Virtual network links).
3. `snet-mysql` must be delegated to `Microsoft.DBforMySQL/flexibleServers` and
   hold nothing else.
4. A custom DNS server on the virtual network must forward to Azure DNS
   (`168.63.129.16`), or the private zone is never consulted.

`Access denied` with the right password usually means the username was typed
with a suffix; Flexible Server takes the bare name (`logbookadmin`), not
`logbookadmin@logbook-mysql`.

### Cannot Connect to Azure Managed Redis

```bash
getent hosts logbook-redis.eastus.redis.azure.net   # should be a 10.20.3.x address

cd /opt/the-logbook
docker run --rm -it -v "$PWD/infrastructure/certs:/certs:ro" redis:7-alpine \
  redis-cli --tls --cacert /certs/azure-combined-ca.pem \
  -h logbook-redis.eastus.redis.azure.net -p 10000 \
  --askpass ping
```

`PONG` means the backend's settings will work. Otherwise check that the private
endpoint's DNS zone is linked to the virtual network, that **access keys
authentication** is enabled on the cache, that `REDIS_PORT` is `10000`, and
that the clustering policy is not OSS.

### VM Runs Out of Memory

```bash
free -h
docker stats --no-stream
```

Resize the VM (portal: VM → **Size**; the VM restarts), or add swap. Azure
Linux images usually provide a temporary resource disk at `/mnt`; it is wiped
on deallocation, which is acceptable for swap but never for data:

```bash
sudo fallocate -l 4G /mnt/swapfile
sudo chmod 600 /mnt/swapfile
sudo mkswap /mnt/swapfile
sudo swapon /mnt/swapfile
```

Swap added this way does not survive a deallocation; configure it through
cloud-init or the Azure Linux agent if you need it permanently.

### Certificate Won't Issue or Renew

- The A record must resolve to the VM's public IP (`dig +short logbook.yourdomain.com`).
- Port 80 must be open in `vm-logbookNSG` — Let's Encrypt's HTTP-01 challenge
  uses it.
- `sudo certbot certificates`, then `sudo nginx -t`.

### Containers Keep Restarting

```bash
docker compose logs --tail=100 backend
```

In production the backend exits with a message naming the setting it refuses
— a weak or missing secret, `DEBUG` on, TLS required but not configured. Fix
that value in `.env` and run `docker compose up -d` again. See
[TROUBLESHOOTING.md](../TROUBLESHOOTING.md).

---

## Pitfalls

Things that go wrong on Azure in particular. The first four are dealt with in
the steps above; they are listed here so nothing depends on having read every
step.

| Pitfall                                          | What happens                                                                                                                                                                                                                                                                                        | What to do                                                                                                                                                                                                             |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A database without `alembic_version`**         | The backend drops every table in it on start, taking it for a fresh install.                                                                                                                                                                                                                        | A database for The Logbook alone; restore with `./scripts/backup.sh --restore` ([Method 2, Step 2](#step-2-create-the-azure-database-for-mysql-flexible-server), [Moving](#moving-an-existing-installation-to-azure)). |
| **Backups never encrypted**                      | Without `./scripts/backup-keygen.sh`, every archive is plaintext and offsite upload is refused.                                                                                                                                                                                                     | Create the keys before the first backup; sync only `*.enc` files ([Backups](#backups)).                                                                                                                                |
| **Redis misconfigured**                          | The backend starts anyway, with caching off and per-process rate limiting.                                                                                                                                                                                                                          | Check for `✓ Redis connected` after every start and change ([Method 2, Step 7](#step-7-start-the-stack)).                                                                                                              |
| **Port 3000 reachable from the virtual network** | Another VM on the network can forge `X-Forwarded-For`.                                                                                                                                                                                                                                              | The deny rule in [Method 1, Step 3](#step-3-lock-down-the-network-security-group).                                                                                                                                     |
| **Building on a 4 GB VM**                        | The frontend build runs on the VM and can run out of memory or exhaust a burstable size's CPU credits.                                                                                                                                                                                              | Build on 8 GB; resize down afterwards if you must ([VM sizing](#vm-sizing)).                                                                                                                                           |
| **Application Gateway or Front Door in front**   | Either one terminating TLS and forwarding plain HTTP makes Nginx send `X-Forwarded-Proto: http`, and the production backend, which enforces HTTPS, redirects forever. Front Door's addresses are also outside `TRUSTED_PROXY_IPS`, so every member shares one rate-limit bucket and one audited IP. | Have Nginx pass on the gateway's `X-Forwarded-Proto` rather than `$scheme`, and add the gateway's address ranges to `TRUSTED_PROXY_IPS` in `.env`. This guide does not use either service.                             |
| **Too few database connections**                 | Each backend process opens up to 30 connections (`DB_POOL_MAX` 10, plus 20 overflow, in `backend/app/core/database.py`); the optional four-worker setup in [Production Deployment](../../wiki/Deployment-Production.md) makes 120. Burstable servers allow few.                                     | Check the server's `max_connections` parameter before adding workers, or choose a larger compute size.                                                                                                                 |
| **Arm VM sizes**                                 | They need `docker-compose.arm.yml`, which replaces MySQL 8.0 with MariaDB 10.11.                                                                                                                                                                                                                    | Choose an x86-64 size.                                                                                                                                                                                                 |
| **A different install directory**                | Docker names volumes after the directory, so outside `/opt/the-logbook` they are not `the-logbook_*` and the backup commands find nothing.                                                                                                                                                          | Install at `/opt/the-logbook`, or adjust every `the-logbook_` name; `docker volume ls` shows the real ones.                                                                                                            |
| **Data on `/mnt`**                               | It is the VM's temporary disk and is wiped whenever the VM is deallocated or moved.                                                                                                                                                                                                                 | Never put Docker's data directory, backups or uploads there. Swap only.                                                                                                                                                |
| **Idle connections cut**                         | Azure closes idle inbound TCP flows through a public IP after 4 minutes by default, and Nginx's default `proxy_read_timeout` is 60 seconds; a long-idle live-update connection is dropped and has to reconnect.                                                                                     | Usually nothing. If live updates misbehave, raise the public IP's idle timeout (Standard SKU, up to 30 minutes) and `proxy_read_timeout` together.                                                                     |
| **MySQL 8.0's lifecycle**                        | Community MySQL 8.0 reached end of life in April 2026. Azure's support terms for 8.0 on Flexible Server, including any charge for extended support, are Azure's to set and change.                                                                                                                  | Check the current terms for your server. Test any move to 8.4 on a copy first: this repository's CI and bundled stack run 8.0.                                                                                         |

---

## Security Checklist

- SSH restricted to your address, or replaced by Azure Bastion.
- No inbound rule for 3000, 3001, 3306, 6379 or 10000, and port 3000 denied
  from the virtual network; MySQL and Redis on private access only, with
  public network access disabled.
- `require_secure_transport` ON for MySQL; `DB_SSL`, `REDIS_SSL` and
  `SECURITY_REQUIRE_TLS` set to `true` with CA files (Method 2).
- Backup keys created, the private key stored apart from the VM, and only
  encrypted archives sent offsite.
- Backup storage account with public blob access off, network access limited
  to the VM's subnet, soft delete on, and access through the VM's managed
  identity rather than a storage key.
- `ENCRYPTION_KEY` / `ENCRYPTION_SALT` kept off the VM as well as on it.
- Enable **Microsoft Defender for Cloud** recommendations for the subscription,
  and keep the VM patched (`sudo apt update && sudo apt upgrade -y`, or Azure
  Update Manager).
- Because the application stores PHI, confirm your Azure agreement includes
  Microsoft's HIPAA Business Associate Agreement before going live (see
  [COMPLIANCE.md](../COMPLIANCE.md)).

---

## Summary

| Step | Method 1: Single VM                                         | Method 2: VM + Managed Services                                         |
| ---- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1    | Resource group and virtual network                          | Resource group, virtual network, MySQL and Redis subnets                |
| 2    | Create the VM, lock down the NSG                            | Azure Database for MySQL Flexible Server (private access, 8.0)          |
| 3    | Point DNS at the VM                                         | Azure Managed Redis (private endpoint, non-clustered, access keys)      |
| 4    | Install Docker, clone, configure `.env`, create backup keys | Create the VM, install Docker and `mysql-client`, clone                 |
| 5    | `docker compose up -d --build`                              | Fetch and combine the Azure CA certificates                             |
| 6    | Nginx reverse proxy                                         | Configure `.env`, backup keys and `~/.my.cnf`                           |
| 7    | HTTPS with Let's Encrypt                                    | `up -d` with `docker-compose.external-services.yml`; confirm Redis      |
| 8    | Encrypted backups to Blob Storage                           | Nginx and HTTPS; encrypted backups and `audit_archives` to Blob Storage |

**Need help?** See the [Troubleshooting Guide](../TROUBLESHOOTING.md) or open a
[GitHub Issue](https://github.com/thegspiro/the-logbook/issues).
