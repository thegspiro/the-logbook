# The Logbook - Google Cloud Deployment Guide

Deploy The Logbook on Google Cloud: on a single Compute Engine virtual
machine, or on a VM backed by Cloud SQL for MySQL and Memorystore for Redis.

## Overview

| Method                                                              | Best For                                              |
| ------------------------------------------------------------------- | ----------------------------------------------------- |
| **Method 1: Compute Engine VM + Docker Compose** (Simple)           | Small departments, testing, a self-contained install  |
| **Method 2: Compute Engine VM + Cloud SQL for MySQL + Memorystore** | Production with provider-managed backups and patching |

Both methods run the same Docker Compose stack on a VM — the same one the
[AWS](./aws.md) and [Azure](./azure.md) guides use. The repository ships no
Kubernetes manifests, Helm chart or Cloud Run service definition, so GKE and
Cloud Run are **not** supported targets: they would need the persistent
`uploads` and `audit_archives` volumes, the ClamAV sidecar and the startup
migration lock re-created by hand.

Prices change by region and over time; use the
[Google Cloud pricing calculator](https://cloud.google.com/products/calculator)
with the sizes below rather than a figure printed here.

> **Before you start:** read [BACKUP.md](../BACKUP.md) for how backups and
> restores work, [Pitfalls](#pitfalls) for what goes wrong on Google Cloud in
> particular, and — if you are moving an existing installation rather than
> starting a new one — [Moving an Existing Installation to Google Cloud](#moving-an-existing-installation-to-google-cloud)
> **before** you generate any secrets. Every command below uses placeholder
> names (`your-project-id`, `logbook.yourdomain.com`, `us-central1`); replace
> them with yours.

---

## Prerequisites

- A Google Cloud project with billing enabled, and permission to create
  networks, firewall rules, VMs, service accounts and Cloud Storage buckets —
  and for Method 2, Cloud SQL, Memorystore and Cloud DNS.
- The [Google Cloud CLI](https://cloud.google.com/sdk/docs/install)
  (`gcloud`), signed in with `gcloud auth login` — or use **Cloud Shell** in
  the console, which has it pre-installed.
- A domain name whose DNS you control, for HTTPS.

Set the defaults the commands below assume, and turn on the APIs they use:

```bash
gcloud config set project your-project-id
gcloud config set compute/region us-central1
gcloud config set compute/zone us-central1-a

gcloud services enable compute.googleapis.com iam.googleapis.com storage.googleapis.com

# Method 2 only
gcloud services enable sqladmin.googleapis.com redis.googleapis.com \
  servicenetworking.googleapis.com dns.googleapis.com
```

### VM sizing

| Machine type    | vCPUs      | RAM  | Suitable for                                                  |
| --------------- | ---------- | ---- | ------------------------------------------------------------- |
| `e2-medium`     | 2 (shared) | 4 GB | Method 2 only, once the images are built (see below)          |
| `e2-standard-2` | 2          | 8 GB | **Recommended** for both methods — the full stack plus ClamAV |
| `n2-standard-2` | 2          | 8 GB | Steadier CPU for larger departments                           |

ClamAV holds its signature database in memory and needs 1.5–3 GB on top of the
rest of the stack, which is why Method 1 should not run on a 4 GB VM. Use a
64 GB `pd-balanced` boot disk; the database, uploads and backup archives all
live on it in Method 1.

The images are **built on the VM** — there are no pre-built images, so the
first `up --build` runs `npm ci` and a full production frontend build there.
Give that build 8 GB. To run Method 2 on an `e2-medium`, create the VM as an
`e2-standard-2`, build and start the stack, then change its machine type
(stop the VM, `gcloud compute instances set-machine-type`, start it), and
change it back for each update that rebuilds. Use an x86-64 machine type: the
Arm series (`t2a`, `c4a`) need `docker-compose.arm.yml`, which swaps MySQL 8.0
for MariaDB 10.11 and is not the configuration this guide describes.

---

## Method 1: Compute Engine VM with Docker Compose (Simple)

Everything runs on one VM — the application, MySQL, Redis, ClamAV and the
nightly backup sidecar.

### Step 1: Create the Network

Use a **custom-mode VPC network** of your own rather than the project's
`default` network. The `default` network ships a `default-allow-internal`
rule that lets every address in the network reach every port on the VM — see
[Step 3](#step-3-create-the-firewall-rules) for why that matters here. A new
custom network starts with no inbound rules at all, so only what you add is
reachable.

```bash
gcloud compute networks create logbook-vpc --subnet-mode=custom

# Private Google Access lets the VM reach Google APIs (Cloud Storage for
# backups) without depending on its external address
gcloud compute networks subnets create logbook-subnet \
  --network=logbook-vpc \
  --region=us-central1 \
  --range=10.20.1.0/24 \
  --enable-private-ip-google-access
```

### Step 2: Create the Service Account, Address and VM

Give the VM its own service account with **no project roles**. Method 1's
backups grant it access to one bucket only (see [Backups](#backups)); the
project's default Compute Engine service account carries far more than that.

```bash
gcloud iam service-accounts create logbook-vm \
  --display-name="The Logbook VM"

# A static external address, so it survives the VM being stopped and started
gcloud compute addresses create logbook-ip --region=us-central1

gcloud compute instances create logbook-vm \
  --zone=us-central1-a \
  --machine-type=e2-standard-2 \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=64GB \
  --boot-disk-type=pd-balanced \
  --subnet=logbook-subnet \
  --address=logbook-ip \
  --tags=logbook-web \
  --service-account=logbook-vm@your-project-id.iam.gserviceaccount.com \
  --scopes=cloud-platform \
  --shielded-secure-boot
```

**Why `--scopes=cloud-platform`.** A VM's access scopes cap what its service
account may do, whatever IAM grants it. Without `--scopes`, the VM gets the
default scopes, which include only **read-only** Cloud Storage access — so the
nightly backup upload is refused even after the bucket grants write access.
`cloud-platform` removes the cap and leaves IAM, which grants this account
nothing beyond its one bucket, as the only control.

Note the external address: `gcloud compute addresses describe logbook-ip
--region=us-central1 --format='value(address)'`.

### Step 3: Create the Firewall Rules

```bash
# HTTP (for the Let's Encrypt challenge and the redirect) and HTTPS
gcloud compute firewall-rules create logbook-allow-web \
  --network=logbook-vpc \
  --direction=INGRESS \
  --action=ALLOW \
  --rules=tcp:80,tcp:443 \
  --source-ranges=0.0.0.0/0 \
  --target-tags=logbook-web

# SSH through Identity-Aware Proxy only: no SSH port open to the internet
gcloud compute firewall-rules create logbook-allow-iap-ssh \
  --network=logbook-vpc \
  --direction=INGRESS \
  --action=ALLOW \
  --rules=tcp:22 \
  --source-ranges=35.235.240.0/20 \
  --target-tags=logbook-web
```

`35.235.240.0/20` is the range IAP TCP forwarding connects from. Connect with
`gcloud compute ssh logbook-vm --zone=us-central1-a --tunnel-through-iap`; your
account needs the **IAP-secured Tunnel User** role on the project. To use
plain SSH from a fixed address instead, replace that source range with your
own address (`YOUR.PUBLIC.IP.ADDRESS/32`).

| Port | Source                  | Purpose                                   |
| ---- | ----------------------- | ----------------------------------------- |
| 22   | IAP (`35.235.240.0/20`) | Administration                            |
| 80   | Internet                | Let's Encrypt HTTP-01 challenge, redirect |
| 443  | Internet                | The application                           |

> **Never open 3000, 3001, 3306 or 6379**, and never add an
> "allow internal" rule covering the whole network to `logbook-vpc`.

**Why no "allow internal" rule.** The frontend container publishes port 3000
on every interface of the VM (`docker-compose.yml`), and Nginx in Step 7
reaches it on `localhost`. The production backend trusts `X-Forwarded-For`
from `10.0.0.0/8` (`TRUSTED_PROXY_IPS` in `docker-compose.prod.yml`), so any
machine on the network that can reach port 3000 can claim any client address,
sidestepping per-client rate limiting and the IPs recorded in the audit log.
The `default` network's `default-allow-internal` rule is exactly such a rule;
a custom network without one refuses that traffic by default. Traffic Nginx
sends over loopback never passes the firewall, so the application is
unaffected. If other machines on this network need to reach the VM, allow
them the specific port they need, never 3000.

### Step 4: Point Your Domain at the VM

Create an **A record** for `logbook.yourdomain.com` pointing at the static
address from Step 2 — at your registrar, or in a public
[Cloud DNS](https://cloud.google.com/dns/docs/overview) zone if you host the
domain there. Let's Encrypt (Step 8) cannot issue a certificate until this
resolves.

### Step 5: Install Docker

```bash
gcloud compute ssh logbook-vm --zone=us-central1-a --tunnel-through-iap

sudo apt update && sudo apt upgrade -y

curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Log out and back in so the docker group takes effect
exit
gcloud compute ssh logbook-vm --zone=us-central1-a --tunnel-through-iap

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

Store a copy of `ENCRYPTION_KEY` and `ENCRYPTION_SALT` somewhere outside the
VM — a [Secret Manager](https://cloud.google.com/secret-manager/docs/overview)
secret, or your department's password manager. Without them, encrypted fields
and uploaded files in a restored backup cannot be read. See
[KEY_ROTATION.md](../KEY_ROTATION.md). (Moving an existing installation? Do
**not** generate new values for these two — see
[Moving an Existing Installation to Google Cloud](#moving-an-existing-installation-to-google-cloud).)

Create the backup encryption keys now, before the first nightly backup runs.
Until they exist, every archive is written **unencrypted** and cannot be sent
off the VM (see [Backups](#backups)):

```bash
./scripts/backup-keygen.sh
```

It prints a private key once and asks you to type `SAVED`. Put that key in your
password manager or Secret Manager, apart from the VM and its backups; it is
the only way to read an archive if the VM is lost. See
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

## Method 2: Compute Engine VM + Cloud SQL for MySQL + Memorystore (Production)

The database and Redis move to managed services on private addresses in your
network; the VM runs only the application containers (`backend`, `frontend`,
`clamav`).

> **Read Steps 3 and 5 before you commit to this method.** The backend
> verifies the server certificate **and its hostname** on both connections,
> and refuses to start in production without verified TLS. Cloud SQL passes
> that check only through a DNS name (Step 3). Whether Memorystore's
> certificate passes it when the backend connects by IP address is something
> Step 5 has you test before going further; if it does not, that step gives
> the choices.

### Step 1: Create the Network and Private Services Access

Follow Method 1, Step 1. Cloud SQL and Memorystore then reach your network
through **private services access**: a range of addresses you set aside for
Google's services, and a peering to them.

```bash
gcloud compute addresses create google-managed-services-logbook \
  --global \
  --purpose=VPC_PEERING \
  --prefix-length=20 \
  --network=logbook-vpc

gcloud services vpc-peerings connect \
  --service=servicenetworking.googleapis.com \
  --ranges=google-managed-services-logbook \
  --network=logbook-vpc
```

### Step 2: Create the Cloud SQL for MySQL Instance

```bash
gcloud sql instances create logbook-mysql \
  --database-version=MYSQL_8_0 \
  --edition=enterprise \
  --cpu=2 \
  --memory=4GB \
  --region=us-central1 \
  --network=logbook-vpc \
  --no-assign-ip \
  --server-ca-mode=GOOGLE_MANAGED_CAS_CA \
  --ssl-mode=ENCRYPTED_ONLY \
  --storage-type=SSD \
  --storage-size=20 \
  --storage-auto-increase \
  --backup-start-time=07:00 \
  --enable-bin-log \
  --retained-backups-count=7 \
  --database-flags=max_allowed_packet=268435456 \
  --deletion-protection
```

| Flag                                     | Why                                                                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MYSQL_8_0`                              | The version the bundled stack and CI run.                                                                                                                                      |
| `--network`, `--no-assign-ip`            | A private address in `logbook-vpc` and **no public address**.                                                                                                                  |
| `--server-ca-mode=GOOGLE_MANAGED_CAS_CA` | The shared, Google-managed CA. It is what gives the instance a DNS name the backend's hostname check can pass (Step 3). Choose it now: it is set when the instance is created. |
| `--ssl-mode=ENCRYPTED_ONLY`              | Refuses unencrypted connections, without requiring client certificates.                                                                                                        |
| `--enable-bin-log`                       | Enables point-in-time recovery.                                                                                                                                                |
| `--database-flags`                       | The 256 MB packet limit the bundled MySQL container starts with (`mysql:` in `docker-compose.yml`). Its character set is given to the database itself, below.                  |
| `--deletion-protection`                  | `gcloud sql instances delete` refuses until it is turned off.                                                                                                                  |

`--edition=enterprise` with `--cpu` / `--memory` sets a dedicated-core
machine; size up with the same flags on `gcloud sql instances patch`.

Then create the database — with the character set given explicitly, so every
table the app creates inherits it — and a user for the application:

```bash
gcloud sql databases create the_logbook \
  --instance=logbook-mysql \
  --charset=utf8mb4 \
  --collation=utf8mb4_unicode_ci

gcloud sql users create logbook \
  --instance=logbook-mysql \
  --host=% \
  --password='YOUR-STRONG-PASSWORD'
```

The database must be **The Logbook's alone**:

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
>   [Moving an Existing Installation to Google Cloud](#moving-an-existing-installation-to-google-cloud).
>
> Cloud SQL's point-in-time recovery (to a new instance) is the way back if
> this happens, which is one more reason to keep `--enable-bin-log` on.

### Step 3: Give Cloud SQL a Private DNS Name

The backend checks that the database server's certificate names the host it
connected to. A Cloud SQL certificate does not name its private IP address;
with the shared CA from Step 2, it names a DNS name Cloud SQL assigns. Cloud
SQL does not publish that name for a private-services-access instance — you
create the record, in a private zone only your network can see.

Find the name and the private address:

```bash
gcloud sql instances describe logbook-mysql \
  --format='yaml(dnsNames,ipAddresses)'
```

Take the `dnsNames` entry whose `connectionType` is `PRIVATE_SERVICES_ACCESS`.
It has the form `INSTANCE_UID.PROJECT_DNS_LABEL.REGION.sql-psa.goog.`. Take the
`ipAddresses` entry of type `PRIVATE`. Then create a private zone for exactly
that name — not for all of `sql-psa.goog`, which would hide any other Cloud SQL
instance from this network — and point it at the address:

```bash
SQL_DNS_NAME="INSTANCE_UID.PROJECT_DNS_LABEL.us-central1.sql-psa.goog."   # with the trailing dot
SQL_PRIVATE_IP="10.x.x.x"

gcloud dns managed-zones create logbook-mysql-dns \
  --description="Private name for the Logbook Cloud SQL instance" \
  --dns-name="${SQL_DNS_NAME}" \
  --visibility=private \
  --networks=logbook-vpc

gcloud dns record-sets create "${SQL_DNS_NAME}" \
  --zone=logbook-mysql-dns \
  --type=A \
  --ttl=300 \
  --rrdatas="${SQL_PRIVATE_IP}"
```

`DB_HOST` is that name **without** the trailing dot. You confirm the
certificate really names it in Step 5, before anything depends on it.

### Step 4: Create the Memorystore for Redis Instance

```bash
gcloud redis instances create logbook-redis \
  --region=us-central1 \
  --tier=basic \
  --size=1 \
  --redis-version=redis_7_2 \
  --network=logbook-vpc \
  --connect-mode=private-service-access \
  --enable-auth \
  --transit-encryption-mode=server-authentication
```

| Flag                                              | Why                                                                                                         |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `--tier=basic`, `--size=1`                        | Ample: the app keeps sessions, rate limits and cache entries there. `standard` adds a replica and failover. |
| `--connect-mode=private-service-access`           | Uses the range from Step 1.                                                                                 |
| `--enable-auth`                                   | Redis AUTH. The stack refuses to start without `REDIS_PASSWORD`.                                            |
| `--transit-encryption-mode=server-authentication` | TLS. Without it the connection is plaintext, which production refuses (`SECURITY_REQUIRE_TLS`).             |

Read the connection details back rather than assuming them — the TLS port is
not 6379:

```bash
gcloud redis instances describe logbook-redis --region=us-central1 \
  --format='value(host,port)'

# The AUTH string: this becomes REDIS_PASSWORD
gcloud redis instances get-auth-string logbook-redis --region=us-central1
```

### Step 5: Create the VM, Fetch the CA Certificates and Test Them

Create the VM as in Method 1, Steps 2–5 — as an `e2-standard-2` even if you
mean to run on an `e2-medium`, since the first build needs the memory (see
[VM sizing](#vm-sizing)). The firewall rules from Method 1, Step 3 are
unchanged; Cloud SQL and Memorystore are reached over the private peering and
need no inbound rule on the VM. Clone the repository as in Method 1, Step 6 —
but configure `.env` as in Step 6 below, and do not start the stack yet.

Install the MySQL command-line client on the VM itself. `./scripts/backup.sh`
uses it to dump and restore a database that is not in a container:

```bash
sudo apt install -y mysql-client
```

**Fetch the CA certificates.** The backend reads CA files from
`/etc/ssl/logbook`, which is `./infrastructure/certs` on the host (or
`SSL_CERTS_DIR`, if you set it). The VM's service account has no Cloud SQL or
Memorystore permission, so run these two commands from your own workstation or
Cloud Shell, then copy the files to the VM (`gcloud compute scp --tunnel-through-iap`):

```bash
gcloud sql ssl server-ca-certs list --instance=logbook-mysql \
  --format='value(cert)' > cloudsql-server-ca.pem

gcloud redis instances describe logbook-redis --region=us-central1 --format=json \
  | python3 -c "import json,sys; print('\n'.join(c['cert'].strip() for c in json.load(sys.stdin).get('serverCaCerts', [])))" \
  > memorystore-server-ca.pem
```

Put both in `/opt/the-logbook/infrastructure/certs/` on the VM.

**Test both before configuring anything.** These are the checks the backend
makes — the certificate chains to the CA file, and names the host connected
to:

```bash
cd /opt/the-logbook/infrastructure/certs

# Cloud SQL, by the DNS name from Step 3 (no trailing dot)
openssl s_client -connect SQL_DNS_NAME:3306 -starttls mysql \
  -CAfile cloudsql-server-ca.pem -verify_hostname SQL_DNS_NAME \
  </dev/null 2>/dev/null | grep "Verify return code"

# Memorystore, by the host and port from Step 4
openssl s_client -connect REDIS_HOST:REDIS_PORT \
  -CAfile memorystore-server-ca.pem -verify_ip REDIS_HOST \
  </dev/null 2>/dev/null | grep "Verify return code"
```

Each should print `Verify return code: 0 (ok)`.

- **Cloud SQL fails** with `62 (hostname mismatch)`: the certificate does not
  name the DNS name. Check that the instance was created with
  `--server-ca-mode=GOOGLE_MANAGED_CAS_CA`, and run the same command with
  `-showcerts` to see the names it carries. Do not go on with Method 2 until it
  passes; the backend will refuse the connection. Any other failure — a
  timeout, an unresolved name — is in
  [Troubleshooting](#cannot-connect-to-cloud-sql).
- **Memorystore fails** with `62 (hostname mismatch)`: its certificate does not
  name its IP address, so the backend cannot verify which server it reached.
  You then have two choices, and the decision is the department's:
  1. Accept an encrypted but **unverified** Redis connection: leave
     `REDIS_SSL_CA` unset in Step 6 and add `SECURITY_ALLOW_UNVERIFIED_TLS=true`,
     which the backend requires before it will start that way and reports at
     every start. The connection stays encrypted and can only come from inside
     `logbook-vpc`, but an attacker already inside the network could
     impersonate Redis — which holds sessions and cached records. The database
     connection is still verified.
  2. Use Method 1 instead. The stack runs either both services itself or
     neither, so a bundled Redis means the bundled MySQL too.

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

# Cloud SQL — the private DNS name from Step 3, without the trailing dot
sed -i "s|^DB_HOST=.*|DB_HOST=SQL_DNS_NAME|" .env
sed -i "s|^DB_PORT=.*|DB_PORT=3306|" .env
sed -i "s|^DB_NAME=.*|DB_NAME=the_logbook|" .env
sed -i "s|^DB_USER=.*|DB_USER=logbook|" .env
sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=your-cloud-sql-user-password|" .env

# Memorystore — host, port and AUTH string from Step 4
sed -i "s|^REDIS_HOST=.*|REDIS_HOST=REDIS_HOST|" .env
sed -i "s|^REDIS_PORT=.*|REDIS_PORT=REDIS_PORT|" .env
sed -i "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=your-memorystore-auth-string|" .env

# The bundled mysql service never starts with this override, but compose still
# reads its definition, which requires a value here. It is used for nothing.
sed -i "s|^MYSQL_ROOT_PASSWORD=.*|MYSQL_ROOT_PASSWORD=$(openssl rand -hex 24)|" .env

sed -i "s|^ENVIRONMENT=.*|ENVIRONMENT=production|" .env
sed -i "s|^DEBUG=.*|DEBUG=false|" .env
sed -i "s|^ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=https://logbook.yourdomain.com|" .env
sed -i "s|^FRONTEND_URL=.*|FRONTEND_URL=https://logbook.yourdomain.com|" .env

# Verified TLS to both services (container paths, not host paths). If Step 5's
# Memorystore test failed and the department chose option 1 there, leave out
# the REDIS_SSL_CA line and add SECURITY_ALLOW_UNVERIFIED_TLS=true.
cat >> .env <<'EOF'
DB_SSL=true
DB_SSL_CA=/etc/ssl/logbook/cloudsql-server-ca.pem
REDIS_SSL=true
REDIS_SSL_CA=/etc/ssl/logbook/memorystore-server-ca.pem
SECURITY_REQUIRE_TLS=true
REDIS_REQUIRED=true
COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml:docker-compose.external-services.yml
EOF
```

If a password or AUTH string contains `|` or `&`, the `sed` lines above will
mangle it; edit `.env` by hand for that value instead.

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

Then create the backup encryption keys, as in Method 1, Step 6:

```bash
./scripts/backup-keygen.sh
```

**TLS for the backup script.** `./scripts/backup.sh` runs `mysqldump` and
`mysql` on the VM against `DB_HOST`. Those clients read their TLS settings from
an option file, not from `.env`, so give them one — as the user the backups run
as (your login user, not root):

```bash
cat > ~/.my.cnf <<'EOF'
[client]
ssl-mode=VERIFY_IDENTITY
ssl-ca=/opt/the-logbook/infrastructure/certs/cloudsql-server-ca.pem

[mysqldump]
# Cloud SQL for MySQL runs with GTIDs on. A dump that carries
# SET @@GLOBAL.GTID_PURGED cannot be loaded back into a server that has
# executed transactions of its own, which every Cloud SQL instance has.
set-gtid-purged=OFF
no-tablespaces
EOF
chmod 600 ~/.my.cnf
```

### Step 7: Start the Stack

```bash
# Expect: backend, clamav, frontend
docker compose config --services

docker compose run --rm --build backend python -m app.preflight
docker compose up -d --build

docker compose ps
docker compose logs -f backend   # first start creates every table on the new database

# Confirm the backend reached Redis
docker compose logs backend | grep -E "Redis connected|REDIS_REQUIRED|Redis connection failed"
```

**Why `REDIS_REQUIRED=true` (set in Step 6).** By default a Redis the backend
cannot reach does not stop it starting: a wrong port, a CA that does not verify
or a changed AUTH string is logged as a warning, and the backend runs on
without Redis — caching off, and rate limiting falling back to per-process
memory. Against a managed service that mistake would stay in place, unnoticed.
With `REDIS_REQUIRED=true` the backend logs `Redis connection failed and
REDIS_REQUIRED is true - refusing to start` and exits, and Docker restarts it
until Redis answers. See
[UPGRADING.md](../UPGRADING.md#redis_requiredtrue-now-refuses-to-start-without-redis-2026-11-04).

Never run `docker compose up -d mysql` (or `redis`) against this stack: compose
starts a service you name even when its profile is off, and nothing would use
it.

### Step 8: Nginx, HTTPS and First Sign-In

Follow Method 1, Steps 7–9.

---

## Google Cloud-Specific Configuration

### Malware Scanning

Every uploaded file is scanned with ClamAV before it is stored. The bundled
`clamav` service always starts, and `CLAMAV_ENABLED` defaults to `true`. An
unreachable scanner refuses uploads rather than storing them unscanned. Setting
`CLAMAV_ENABLED=false` accepts files unscanned behind a standing warning to
administrators; read
[Security Configuration → Malware scanning](../../wiki/Configuration-Security.md#malware-scanning-of-uploads)
first. Allow 1.5–3 GB of RAM for clamd, as in the sizing table.

### Outbound Email

Compute Engine blocks outbound connections to port 25. Send mail through an
authenticated relay on port 587 instead — Google Workspace's SMTP relay, or
another provider — and set the `SMTP_*` variables accordingly. See
[EMAIL_DELIVERABILITY.md](../EMAIL_DELIVERABILITY.md) and
[Integration: Google Workspace](../../wiki/Integration-Google-Workspace.md).
For Google sign-in, see the `GOOGLE_OAUTH_*` variables in `.env.example.full`.

### Monitoring

- Install the [Ops Agent](https://cloud.google.com/monitoring/agent/ops-agent)
  on the VM for memory and disk metrics; Compute Engine reports CPU without it.
- Create alerting policies for CPU above 80% for 5 minutes, boot disk above
  85% full, and VM uptime.
- Cloud SQL and Memorystore publish their own metrics; alert on storage
  utilisation and connection errors.
- Application logs stay in the containers (`docker compose logs`). If you ship
  them to Cloud Logging, remember they may contain member identifiers and
  treat the log bucket as holding PHI.

### Secrets

`.env` on the VM holds every secret. Restrict it with `chmod 600 .env`, and keep
an off-VM copy of `ENCRYPTION_KEY` and `ENCRYPTION_SALT` in Secret Manager.
Compute Engine encrypts disks at rest by default. The application reads its
configuration from environment variables only; it has no Secret Manager
integration of its own.

---

## Backups

Every backup holds every member's records. **Only encrypted archives leave the
VM.** Encryption needs the keys from `./scripts/backup-keygen.sh` (Method 1,
Step 6); until they exist, archives are written in plaintext, administrators
see a "Backups are not encrypted" notice, and `./scripts/backup.sh` refuses to
upload anything. Do not work around that refusal by copying the backup
directory with a general-purpose sync tool: that is exactly the plaintext copy
it exists to prevent. See [BACKUP.md](../BACKUP.md#encrypted-backups).

### The Bucket (Both Methods)

Create a private bucket, and let the VM's service account add objects to it
and read them — but **not delete or overwrite** them, so a compromised VM
cannot destroy its own backups:

```bash
gcloud storage buckets create gs://yourorg-logbook-backups \
  --location=us \
  --uniform-bucket-level-access \
  --public-access-prevention \
  --soft-delete-duration=30d

gcloud storage buckets add-iam-policy-binding gs://yourorg-logbook-backups \
  --member=serviceAccount:logbook-vm@your-project-id.iam.gserviceaccount.com \
  --role=roles/storage.objectCreator
gcloud storage buckets add-iam-policy-binding gs://yourorg-logbook-backups \
  --member=serviceAccount:logbook-vm@your-project-id.iam.gserviceaccount.com \
  --role=roles/storage.objectViewer
```

A multi-region location (`us`, `eu`, `asia`) keeps copies in more than one
region. Add an Object Lifecycle rule (console: bucket → Lifecycle) so old
archives are deleted after your retention period; the lifecycle rule runs as
Google, not as the VM, so it is unaffected by the VM's limited role.

Then name the bucket in `.env`, where `./scripts/backup.sh` reads it:

```bash
echo "GCS_BUCKET=yourorg-logbook-backups" >> /opt/the-logbook/.env
```

`./scripts/backup.sh` uploads with `gsutil`, and the `audit_archives` copies
below use `gcloud storage`; both sign in as the VM's service account on their
own. Check that both are on the VM with `gsutil version` and `gcloud version`;
if either is missing, install the Google Cloud CLI from
[cloud.google.com/sdk/docs/install](https://cloud.google.com/sdk/docs/install).

### Method 1 (Single VM)

The production stack's `backup` sidecar takes a nightly encrypted archive of
the database, uploads and audit archives (at `BACKUP_TIME`, default 02:00 UTC),
prunes archives older than `BACKUP_RETENTION_DAYS`, and runs a
restore-verification drill every `VERIFY_EVERY_N_BACKUPS` runs. Its archives
stay on the VM's disk. For the offsite copy, run `./scripts/backup.sh` from your
login user's crontab at a different hour; it writes its own encrypted archive
and uploads it, with its `.key` and `.sha256` files, under `backups/` in the
bucket:

```bash
# crontab -e (as your login user)
30 3 * * * cd /opt/the-logbook && ./scripts/backup.sh --destination gcs >> "$HOME/logbook-offsite-backup.log" 2>&1
```

`./scripts/backup.sh`'s archive does **not** include the `audit_archives`
volume; the sidecar's does. Once a retention purge has run, those files are
the only copy of that audit history, so copy the sidecar's encrypted archives
offsite too — and only those, which is what the exclude pattern does:

```bash
# root's crontab (the volume lives under Docker's data directory)
gcloud storage rsync \
  "$(docker volume inspect the-logbook_backups -f '{{ .Mountpoint }}')" \
  gs://yourorg-logbook-backups/sidecar \
  --exclude='^(?!.*\.tar\.gz\.enc(\.key|\.sha256)?$)'
```

The pattern excludes every file whose name does not end in `.tar.gz.enc`,
`.tar.gz.enc.key` or `.tar.gz.enc.sha256`. A plaintext archive is named
`….tar.gz`, so it is never copied.

Also consider scheduled **disk snapshots** of the VM's boot disk (a snapshot
schedule on the disk). They complement the archives; they do not replace
them, because a snapshot of a running MySQL is only crash-consistent.

### Method 2 (Managed Services)

The `backup` sidecar does not run: `docker-compose.external-services.yml` turns
it off, because it dumps and drills against the bundled MySQL. Cloud SQL covers
the database itself:

- **Automated backups** daily at `--backup-start-time`, keeping
  `--retained-backups-count`.
- **Point-in-time recovery** (with `--enable-bin-log`), always to a **new**
  instance.
- **On-demand backups** before an upgrade:
  `gcloud sql backups create --instance=logbook-mysql`.

Those backups belong to the instance and the project. For a copy outside them,
and for the `uploads` volume, which nothing else backs up, run
`./scripts/backup.sh` nightly. It dumps the Cloud SQL database over verified TLS
(the `~/.my.cnf` from Step 6), archives the uploads from the backend container,
encrypts the result and uploads it:

```bash
# crontab -e (as your login user)
30 3 * * * cd /opt/the-logbook && ./scripts/backup.sh --destination gcs >> "$HOME/logbook-offsite-backup.log" 2>&1
```

The uploaded files are themselves encrypted by the application with
`ENCRYPTION_KEY` / `ENCRYPTION_SALT` (see "Secrets are NOT in the backup" in
[BACKUP.md](../BACKUP.md)), so the archive is unreadable without both the
backup keys and those secrets.

**The `audit_archives` volume needs a copy of its own.** Neither
`./scripts/backup.sh` nor Cloud SQL's backups include it, and once a retention
purge has run it is the only copy of that audit history. Its files are gzipped
JSON lines the application does **not** encrypt, so copy them only into the
private bucket above (encrypted at rest by Google):

```bash
# root's crontab
gcloud storage rsync \
  "$(docker volume inspect the-logbook_audit_archives -f '{{ .Mountpoint }}')" \
  gs://yourorg-logbook-backups/audit_archives
```

Restore drills are yours to run in Method 2: from time to time, restore a
Cloud SQL backup to a new instance and point a test stack at it, and restore
one of the `./scripts/backup.sh` archives into that test stack. Memorystore
holds no data that needs backing up — sessions and cache entries rebuild
themselves.

---

## Moving an Existing Installation to Google Cloud

Bring the data across with the repository's own backup and restore, never a
hand-made dump: the backend empties a database that has no `alembic_version`
table (see the warning in Method 2, Step 2).

1. **On the old server**, make sure backup keys exist
   (`./scripts/backup-keygen.sh` if not), then take a fresh backup:
   `./scripts/backup.sh`. Note the release you are running (`git describe
--tags` or `git rev-parse HEAD`).
2. **Copy across**, over SSH (`gcloud compute scp --tunnel-through-iap`): the
   newest `logbook_backup_*.tar.gz.enc` with its `.key` and `.sha256` files,
   and the `backup-keys/` directory (or have the backup's private key to hand).
3. **On the Compute Engine VM**, check out the same release you were running,
   then build `.env` as Method 1 or Method 2, Step 6 describes — but **copy
   `SECRET_KEY`, `ENCRYPTION_KEY` and `ENCRYPTION_SALT` from the old `.env`
   instead of generating new ones.** New values make every encrypted field and
   every uploaded file in the backup unreadable, and leave every registered NFC
   tag and ID card unmatched. Put `backup-keys/` back in place.
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
   Cloud SQL, which is why it needs the `mysql-client` package and `~/.my.cnf`.

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

# 1. Back up first (Method 2: also gcloud sql backups create --instance=logbook-mysql)
./scripts/backup.sh

# Method 2 on an e2-medium: change the machine type to e2-standard-2 before
# the rebuild (see VM sizing)

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

### Cannot Connect to Cloud SQL

```bash
# Name resolution must return the instance's private address
getent hosts SQL_DNS_NAME

# Connect over verified TLS with the CA file the backend uses
cd /opt/the-logbook
docker run --rm -it -v "$PWD/infrastructure/certs:/certs:ro" mysql:8.0 \
  mysql -h SQL_DNS_NAME -u logbook -p \
  --ssl-mode=VERIFY_IDENTITY --ssl-ca=/certs/cloudsql-server-ca.pem \
  -e "SELECT 1"
```

If the name does not resolve:

1. The private zone from Method 2, Step 3 must list `logbook-vpc` as a network
   it is visible to (`gcloud dns managed-zones describe logbook-mysql-dns`).
2. Its record must match the `PRIVATE_SERVICES_ACCESS` name exactly, with the
   trailing dot in the zone and record commands and without it in `DB_HOST`.

If it resolves but times out:

1. The private services access peering must be up:
   `gcloud services vpc-peerings list --network=logbook-vpc`.
2. The instance must have been created with `--network=logbook-vpc`.

`certificate verify failed` or `hostname mismatch`: re-run the `openssl` test
from Method 2, Step 5, and re-fetch the CA file if the instance's CA has
rotated since.

### Cannot Connect to Memorystore

```bash
cd /opt/the-logbook
docker run --rm -it -v "$PWD/infrastructure/certs:/certs:ro" redis:7-alpine \
  redis-cli --tls --cacert /certs/memorystore-server-ca.pem \
  -h REDIS_HOST -p REDIS_PORT \
  --askpass ping
```

`PONG` means the backend's settings will work. Otherwise check that
`REDIS_PORT` is the port `gcloud redis instances describe` reports (not 6379),
that `REDIS_PASSWORD` is the current AUTH string, and that the instance was
created with `--network=logbook-vpc` and transit encryption. If `redis-cli`
works but the backend reports a hostname or certificate error, see the
Memorystore result in Method 2, Step 5.

### VM Runs Out of Memory

```bash
free -h
docker stats --no-stream
```

Change the machine type (stop the VM, then
`gcloud compute instances set-machine-type logbook-vm --zone=us-central1-a --machine-type=e2-standard-4`,
then start it), or add swap on the boot disk:

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### Certificate Won't Issue or Renew

- The A record must resolve to the VM's static address (`dig +short logbook.yourdomain.com`).
- `logbook-allow-web` must allow port 80 to the VM's `logbook-web` tag —
  Let's Encrypt's HTTP-01 challenge uses it.
- `sudo certbot certificates`, then `sudo nginx -t`.

### Backups Are Not Uploaded

`AccessDeniedException: 403 ... Provided scope(s) are not authorized` means
the VM was created without `--scopes=cloud-platform` (Method 1, Step 2). Stop
the VM, run
`gcloud compute instances set-service-account logbook-vm --zone=us-central1-a --service-account=logbook-vm@your-project-id.iam.gserviceaccount.com --scopes=cloud-platform`,
and start it. A `403` that names a missing permission instead means the bucket
binding in [Backups](#backups) is missing.

### Containers Keep Restarting

```bash
docker compose logs --tail=100 backend
```

In production the backend exits with a message naming the setting it refuses
— a weak or missing secret, `DEBUG` on, TLS required but not configured, or
(with `REDIS_REQUIRED=true`) a Redis it cannot reach. Fix that value in `.env`
and run `docker compose up -d` again. See
[TROUBLESHOOTING.md](../TROUBLESHOOTING.md).

---

## Pitfalls

Things that go wrong on Google Cloud in particular. The first six are dealt
with in the steps above; they are listed here so nothing depends on having
read every step.

| Pitfall                                  | What happens                                                                                                                                                                                                                                                                                                    | What to do                                                                                                                                                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A database without `alembic_version`** | The backend drops every table in it on start, taking it for a fresh install.                                                                                                                                                                                                                                    | A database for The Logbook alone; restore with `./scripts/backup.sh --restore` ([Method 2, Step 2](#step-2-create-the-cloud-sql-for-mysql-instance), [Moving](#moving-an-existing-installation-to-google-cloud)).       |
| **Backups never encrypted**              | Without `./scripts/backup-keygen.sh`, every archive is plaintext and offsite upload is refused.                                                                                                                                                                                                                 | Create the keys before the first backup; sync only `*.enc` files ([Backups](#backups)).                                                                                                                                 |
| **The default access scopes**            | A VM created without `--scopes` can only read Cloud Storage, whatever IAM grants, so backup uploads fail with `403`.                                                                                                                                                                                            | `--scopes=cloud-platform` with a dedicated service account ([Method 1, Step 2](#step-2-create-the-service-account-address-and-vm)).                                                                                     |
| **The `default` network**                | Its `default-allow-internal` rule lets every machine on the network reach port 3000 and forge `X-Forwarded-For`; it also opens SSH to the internet.                                                                                                                                                             | A custom-mode network with only the rules in [Method 1, Step 3](#step-3-create-the-firewall-rules).                                                                                                                     |
| **Hostname verification**                | The backend checks that each server's certificate names the host it connected to. Cloud SQL's names only its DNS name, which nothing publishes for a private instance; Memorystore's may not name its IP address.                                                                                               | The private DNS zone ([Method 2, Step 3](#step-3-give-cloud-sql-a-private-dns-name)) and the `openssl` tests ([Step 5](#step-5-create-the-vm-fetch-the-ca-certificates-and-test-them)) before anything depends on them. |
| **Redis misconfigured**                  | By default the backend starts anyway, with caching off and per-process rate limiting.                                                                                                                                                                                                                           | `REDIS_REQUIRED=true`, so it refuses to start instead ([Method 2, Step 7](#step-7-start-the-stack)).                                                                                                                    |
| **Building on a 4 GB VM**                | The frontend build runs on the VM and can run out of memory, or crawl on an `e2-medium`'s shared cores.                                                                                                                                                                                                         | Build on 8 GB; change the machine type down afterwards if you must ([VM sizing](#vm-sizing)).                                                                                                                           |
| **A load balancer in front**             | An HTTPS load balancer terminating TLS and forwarding plain HTTP makes Nginx send `X-Forwarded-Proto: http`, and the production backend, which enforces HTTPS, redirects forever. Its proxies' addresses are also outside `TRUSTED_PROXY_IPS`, so every member shares one rate-limit bucket and one audited IP. | Have Nginx pass on the load balancer's `X-Forwarded-Proto` rather than `$scheme`, and add the load balancer's proxy ranges to `TRUSTED_PROXY_IPS` in `.env`. This guide does not use one.                               |
| **Too few database connections**         | Each backend process opens up to 30 connections (`DB_POOL_MAX` 10, plus 20 overflow, in `backend/app/core/database.py`); the optional four-worker setup in [Production Deployment](../../wiki/Deployment-Production.md) makes 120. Small Cloud SQL machines allow few.                                          | Check the instance's `max_connections` before adding workers, or choose more memory.                                                                                                                                    |
| **Arm machine types**                    | `t2a` and `c4a` need `docker-compose.arm.yml`, which replaces MySQL 8.0 with MariaDB 10.11.                                                                                                                                                                                                                     | Choose an x86-64 machine type.                                                                                                                                                                                          |
| **A different install directory**        | Docker names volumes after the directory, so outside `/opt/the-logbook` they are not `the-logbook_*` and the backup commands find nothing.                                                                                                                                                                      | Install at `/opt/the-logbook`, or adjust every `the-logbook_` name; `docker volume ls` shows the real ones.                                                                                                             |
| **Idle connections cut**                 | Google Cloud's firewall forgets a TCP connection after 10 minutes without a packet, and Nginx's default `proxy_read_timeout` is 60 seconds; a long-idle live-update connection is dropped and has to reconnect.                                                                                                 | Usually nothing. If live updates misbehave, raise `proxy_read_timeout` and make sure something crosses the connection more often than every 10 minutes.                                                                 |
| **MySQL 8.0's lifecycle**                | Community MySQL 8.0 reached end of life in April 2026. Google's support terms for 8.0 on Cloud SQL, including any charge for extended support, are Google's to set and change.                                                                                                                                  | Check the current terms for your instance. Test any move to 8.4 on a copy first: this repository's CI and bundled stack run 8.0.                                                                                        |

---

## Security Checklist

- SSH only through IAP (or from your own address); no rule opening 22 to the
  internet.
- No inbound rule for 3000, 3001, 3306 or 6379, and no network-wide "allow
  internal" rule; Cloud SQL with no public address, Memorystore on private
  services access.
- Cloud SQL `--ssl-mode=ENCRYPTED_ONLY`; `DB_SSL`, `REDIS_SSL` and
  `SECURITY_REQUIRE_TLS` set to `true` with CA files (Method 2), and any
  `SECURITY_ALLOW_UNVERIFIED_TLS` recorded as the department's decision.
- The VM's own service account, with no project roles and only create/view on
  the backup bucket.
- Backup keys created, the private key stored apart from the VM, and only
  encrypted archives sent offsite.
- Backup bucket with uniform access, public access prevention and soft delete.
- `ENCRYPTION_KEY` / `ENCRYPTION_SALT` kept off the VM as well as on it.
- Keep the VM patched (`sudo apt update && sudo apt upgrade -y`, or VM Manager
  OS patch management), and review Security Command Center findings.
- Because the application stores PHI, confirm your Google Cloud agreement
  includes Google's HIPAA Business Associate Agreement, and that every service
  you use is covered by it, before going live (see
  [COMPLIANCE.md](../COMPLIANCE.md)).

---

## Summary

| Step | Method 1: Single VM                                         | Method 2: VM + Managed Services                                          |
| ---- | ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1    | Custom-mode network and subnet                              | Network, plus private services access                                    |
| 2    | Service account, static address, VM                         | Cloud SQL for MySQL 8.0 (private, shared CA), database and user          |
| 3    | Firewall: 80/443 from the internet, 22 from IAP             | Private DNS zone for the Cloud SQL name                                  |
| 4    | Point DNS at the VM                                         | Memorystore for Redis (AUTH, transit encryption)                         |
| 5    | Install Docker, clone, configure `.env`, create backup keys | VM, `mysql-client`, CA certificates — and the `openssl` tests            |
| 6    | `docker compose up -d --build`                              | Configure `.env`, backup keys and `~/.my.cnf`                            |
| 7    | Nginx and HTTPS                                             | `up -d` with `docker-compose.external-services.yml`; confirm Redis       |
| 8    | Encrypted backups to Cloud Storage                          | Nginx and HTTPS; encrypted backups and `audit_archives` to Cloud Storage |

**Need help?** See the [Troubleshooting Guide](../TROUBLESHOOTING.md) or open a
[GitHub Issue](https://github.com/thegspiro/the-logbook/issues).
