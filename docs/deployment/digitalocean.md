# The Logbook - DigitalOcean Deployment Guide

Deploy The Logbook on DigitalOcean: on a single Droplet, or on a Droplet backed
by DigitalOcean Managed MySQL and Managed Valkey.

## Overview

| Method                                                 | Best For                                              |
| ------------------------------------------------------ | ----------------------------------------------------- |
| **Method 1: Droplet + Docker Compose** (Simple)        | Small departments, testing, a self-contained install  |
| **Method 2: Droplet + Managed MySQL + Managed Valkey** | Production with provider-managed backups and patching |

Both methods run the same Docker Compose stack on a Droplet — the same one the
[AWS](./aws.md), [Azure](./azure.md) and [Google Cloud](./gcp.md) guides use.
The repository ships no App Platform app spec, Helm chart or Kubernetes
manifests, so App Platform and DigitalOcean Kubernetes are **not** supported
targets: they would need the persistent `uploads` and `audit_archives`
volumes, the ClamAV sidecar and the startup migration lock re-created by hand.

Prices change over time; check
[DigitalOcean's pricing](https://www.digitalocean.com/pricing) for the sizes
below rather than a figure printed here.

> **Before you start:** read [BACKUP.md](../BACKUP.md) for how backups and
> restores work, [Pitfalls](#pitfalls) for what goes wrong on DigitalOcean in
> particular — above all, that **DigitalOcean blocks outbound mail ports on
> Droplets**, so the app cannot send email until you choose a relay that
> accepts another port ([Outbound Email](#outbound-email)) — and, if you are
> moving an existing installation rather than starting a new one,
> [Moving an Existing Installation to DigitalOcean](#moving-an-existing-installation-to-digitalocean)
> **before** you generate any secrets. Every command below uses placeholder
> names (`logbook.yourdomain.com`, `nyc3`); replace them with yours.

---

## Prerequisites

- A DigitalOcean account and a team you can create Droplets, VPCs, firewalls,
  Spaces buckets and (for Method 2) managed databases in.
- [`doctl`](https://docs.digitalocean.com/reference/doctl/how-to/install/),
  DigitalOcean's command-line tool, signed in with `doctl auth init`. Every
  step can also be done in the control panel.
- An SSH key added to your account (`doctl compute ssh-key list` shows its ID
  or fingerprint).
- A domain name whose DNS you control, for HTTPS.

### Droplet sizing

| Size slug     | vCPUs | RAM  | Suitable for                                                  |
| ------------- | ----- | ---- | ------------------------------------------------------------- |
| `s-2vcpu-4gb` | 2     | 4 GB | Method 2 only, once the images are built (see below)          |
| `s-4vcpu-8gb` | 4     | 8 GB | **Recommended** for both methods — the full stack plus ClamAV |

Run `doctl compute size list` for the slugs your region offers; any size with
8 GB of memory will do. ClamAV holds its signature database in memory and
needs 1.5–3 GB on top of the rest of the stack, which is why Method 1 should not
run on a 4 GB Droplet.

The images are **built on the Droplet** — there are no pre-built images, so the
first `up --build` runs `npm ci` and a full production frontend build there.
Give that build 8 GB. To run Method 2 on a 4 GB Droplet, build and start the
stack on an 8 GB one, then resize it down (power off, then
`doctl compute droplet-action resize`; choose a resize that keeps the disk,
so it can be reversed), and resize back up for each update that rebuilds.

---

## Method 1: Droplet with Docker Compose (Simple)

Everything runs on one Droplet — the application, MySQL, Redis, ClamAV and the
nightly backup sidecar.

### Step 1: Create a VPC

```bash
doctl vpcs create --name logbook-vpc --region nyc3 --ip-range 10.20.0.0/20
```

Note the VPC's ID (`doctl vpcs list`). Method 2's database and cache join the
same VPC, so they are reached on private addresses.

### Step 2: Create the Droplet and a Reserved IP

```bash
doctl compute droplet create logbook \
  --region nyc3 \
  --size s-4vcpu-8gb \
  --image ubuntu-22-04-x64 \
  --vpc-uuid YOUR-VPC-ID \
  --ssh-keys YOUR-SSH-KEY-FINGERPRINT \
  --tag-names logbook-web \
  --enable-monitoring \
  --wait

# A Reserved IP stays the same if the Droplet is ever rebuilt or replaced
doctl compute reserved-ip create --droplet-id YOUR-DROPLET-ID
```

`doctl compute droplet list` shows the Droplet's ID; `doctl compute
reserved-ip list` shows the reserved address. Point everything at the reserved
address, not the Droplet's own one.

### Step 3: Create the Cloud Firewall

A Cloud Firewall filters traffic before it reaches the Droplet. With no rule
for a port, inbound traffic to it is refused — from the internet **and from
other machines in the VPC**, which matters here (see below).

```bash
doctl compute firewall create \
  --name logbook-web \
  --tag-names logbook-web \
  --inbound-rules "protocol:tcp,ports:22,address:YOUR.PUBLIC.IP.ADDRESS/32 protocol:tcp,ports:80,address:0.0.0.0/0,address:::/0 protocol:tcp,ports:443,address:0.0.0.0/0,address:::/0" \
  --outbound-rules "protocol:tcp,ports:all,address:0.0.0.0/0,address:::/0 protocol:udp,ports:all,address:0.0.0.0/0,address:::/0 protocol:icmp,address:0.0.0.0/0,address:::/0"
```

**The outbound rules are not optional.** A Cloud Firewall with no outbound
rules lets nothing out — no package installs, no Let's Encrypt, no Docker
image pulls, no backups.

| Port | Source   | Purpose                                   |
| ---- | -------- | ----------------------------------------- |
| 22   | Your IP  | Administration                            |
| 80   | Internet | Let's Encrypt HTTP-01 challenge, redirect |
| 443  | Internet | The application                           |

> **Never open 3000, 3001, 3306 or 6379**, to the internet or to the VPC.

**Why the VPC matters.** The frontend container publishes port 3000 on every
interface of the Droplet (`docker-compose.yml`), and Nginx in Step 7 reaches it
on `localhost`. The production backend trusts `X-Forwarded-For` from
`10.0.0.0/8` (`TRUSTED_PROXY_IPS` in `docker-compose.prod.yml`), so any machine
in the VPC that could reach port 3000 could claim any client address,
sidestepping per-client rate limiting and the IPs recorded in the audit log.
The Cloud Firewall applies to VPC traffic too, and with no rule for 3000 it
refuses it. Traffic Nginx sends over loopback never passes the firewall, so
the application is unaffected. If other machines in the VPC need to reach the
Droplet, allow them the specific port they need, never 3000.

### Step 4: Point Your Domain at the Droplet

Create an **A record** for `logbook.yourdomain.com` pointing at the Reserved IP
— at your registrar, or in DigitalOcean's DNS if you host the domain there.
Let's Encrypt (Step 8) cannot issue a certificate until this resolves.

### Step 5: Create a User and Install Docker

A new Droplet signs you in as `root`. Make a sudo user for the rest of the
guide, and work as that user from here on:

```bash
ssh root@YOUR-RESERVED-IP

adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy
# Give it a password for sudo, and your SSH key
passwd deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
exit

ssh deploy@YOUR-RESERVED-IP

sudo apt update && sudo apt upgrade -y

curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Log out and back in so the docker group takes effect
exit
ssh deploy@YOUR-RESERVED-IP

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
Droplet — your department's password manager, or another place that does not
share fate with it. Without them, encrypted fields
and uploaded files in a restored backup cannot be read. See
[KEY_ROTATION.md](../KEY_ROTATION.md). (Moving an existing installation? Do
**not** generate new values for these two — see
[Moving an Existing Installation to DigitalOcean](#moving-an-existing-installation-to-digitalocean).)

Create the backup encryption keys now, before the first nightly backup runs.
Until they exist, every archive is written **unencrypted** and cannot be sent
off the Droplet (see [Backups](#backups)):

```bash
./scripts/backup-keygen.sh
```

It prints a private key once and asks you to type `SAVED`. Put that key in your
password manager, apart from the Droplet and its backups; it is the only way
to read an archive if the Droplet is lost. See
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

# The A record from Step 4 must already resolve to this Droplet
sudo certbot --nginx -d logbook.yourdomain.com

sudo certbot renew --dry-run
```

See [TLS.md](../TLS.md) for the application's own TLS expectations.

### Step 9: Open The Logbook

Browse to `https://logbook.yourdomain.com` and complete the onboarding wizard
to set up your department.

---

## Method 2: Droplet + Managed MySQL + Managed Valkey (Production)

The database and cache move to DigitalOcean managed clusters in the same VPC;
the Droplet runs only the application containers (`backend`, `frontend`,
`clamav`).

> **Why Valkey, not Redis.** DigitalOcean discontinued its managed Redis
> (Managed Caching) on 30 June 2025 and replaced it with **Managed Valkey**, a
> Redis-compatible engine. The backend talks to it with the same Redis client
> and settings as any Redis.

> **Read Step 5 before you commit to this method.** The backend verifies each
> server's certificate **and its hostname**, and refuses to start in production
> without verified TLS. Step 5 has you test both connections the way the
> backend will before anything depends on them.

### Step 1: Create the VPC

Follow Method 1, Step 1.

### Step 2: Create the Managed MySQL Cluster

```bash
# The sizes this engine offers in your region
doctl databases options slugs --engine mysql

doctl databases create logbook-mysql \
  --engine mysql \
  --version 8 \
  --region nyc3 \
  --size db-s-2vcpu-4gb \
  --num-nodes 1 \
  --private-network-uuid YOUR-VPC-ID
```

Use `--num-nodes 2` or more for a standby node with automatic failover.
`doctl databases list` shows the cluster's ID, used below as `MYSQL-ID`, and its
MySQL version: the bundled stack and CI run 8.0.

You create the database itself in Step 5, from the Droplet, because `doctl`
cannot set its collation and the cluster will accept connections only from
the Droplet. Create the application's user now:

```bash
doctl databases user create MYSQL-ID logbook
```

The command prints the user's generated password; keep it for Step 6.

The database must be **The Logbook's alone**:

> **The backend empties any database it takes for new.** On start, a database
> with no `alembic_version` table is treated as a fresh install: the backend
> **drops every table in it** and builds the schema from the models
> (`_fast_path_init` in `backend/main.py`). It cannot tell an empty database
> from one holding someone else's data. So:
>
> - point `DB_NAME` only at the database created for The Logbook in Step 5 —
>   never at `defaultdb`, at one another application uses, or at `mysql`,
>   `sys` or another system schema;
> - never hand-load a partial dump (one without `alembic_version`) into it and
>   then start the backend; restore with `./scripts/backup.sh --restore`, as in
>   [Moving an Existing Installation to DigitalOcean](#moving-an-existing-installation-to-digitalocean).
>
> The cluster's own backups (restored to a **new** cluster) are the way back if
> this happens.

**Leave `sql_require_primary_key` on.** DigitalOcean's MySQL refuses to create
a table without a primary key, which some applications trip over. Every table
in this schema has one (all 356 in the current release), so nothing needs
changing. If a future upgrade's migration fails with "Unable to create or
change a table without a primary key", report it as a bug in that migration
rather than turning the setting off: primary keys are what row-based
replication between the cluster's nodes relies on.

### Step 3: Create the Managed Valkey Cluster

```bash
doctl databases options slugs --engine valkey

doctl databases create logbook-valkey \
  --engine valkey \
  --region nyc3 \
  --size db-s-1vcpu-1gb \
  --num-nodes 1 \
  --private-network-uuid YOUR-VPC-ID
```

The smallest size is ample: the app keeps sessions, rate limits and cache
entries there. `doctl databases list` shows its ID, used below as `VALKEY-ID`.

### Step 4: Allow Only the Droplet to Connect

Both clusters accept connections from anywhere until you add **trusted
sources**. Restrict each to the Droplet. The rule takes the Droplet's ID, so do
this as soon as the Droplet exists (Step 5):

```bash
doctl databases firewalls append MYSQL-ID --rule droplet:YOUR-DROPLET-ID
doctl databases firewalls append VALKEY-ID --rule droplet:YOUR-DROPLET-ID
```

### Step 5: Create the Droplet, Fetch the Certificates and Test Them

Create the Droplet as in Method 1, Steps 2–5 — at 8 GB even if you mean to run
on 4 GB, since the first build needs the memory (see
[Droplet sizing](#droplet-sizing)) — then add the trusted sources from Step 4.
The Cloud Firewall from Method 1, Step 3 is unchanged: the clusters are reached
outbound, which its outbound rules allow. Clone the repository as in Method 1,
Step 6 — but configure `.env` as in Step 6 below, and do not start the stack
yet.

Install the MySQL command-line client on the Droplet itself.
`./scripts/backup.sh` uses it to dump and restore a database that is not in a
container, and you need it now to create the database:

```bash
sudo apt install -y mysql-client
```

**Get the connection details**, from your workstation:

```bash
doctl databases connection MYSQL-ID --private    # host, port, doadmin's password
doctl databases connection VALKEY-ID --private   # host, port, password
```

`--private` gives the hostnames inside the VPC, which begin `private-`.
Without it you get the public ones. **Neither listens on the default port**
(3306 or 6379): use the ports these commands print.

**Fetch the CA certificates.** The backend reads CA files from
`/etc/ssl/logbook`, which is `./infrastructure/certs` on the host (or
`SSL_CERTS_DIR`, if you set it).

- **MySQL** uses a CA of the cluster's own. Fetch it on your workstation, then
  copy `do-mysql-ca.pem` to `/opt/the-logbook/infrastructure/certs/` on the
  Droplet:

  ```bash
  doctl databases get-ca MYSQL-ID -o json \
    | python3 -c "import base64,json,sys; sys.stdout.write(base64.b64decode(json.load(sys.stdin)['certificate']).decode())" \
    > do-mysql-ca.pem
  ```

- **Valkey** uses Let's Encrypt certificates, so there is no cluster CA to
  download. The backend still needs a CA file to verify against, so give it
  Let's Encrypt's roots — on the Droplet:

  ```bash
  cd /opt/the-logbook/infrastructure/certs
  curl -fsSL -o isrgrootx1.pem https://letsencrypt.org/certs/isrgrootx1.pem
  curl -fsSL -o isrg-root-x2.pem https://letsencrypt.org/certs/isrg-root-x2.pem
  cat isrgrootx1.pem isrg-root-x2.pem > letsencrypt-roots.pem
  ```

**Create the database** with the character set and collation the bundled
MySQL uses (`mysql:` in `docker-compose.yml`). The app's tables declare no
collation of their own, so they inherit the database's, and MySQL 8's default
(`utf8mb4_0900_ai_ci`) is not the one the application is tested with:

```bash
mysql -h PRIVATE-MYSQL-HOST -P MYSQL-PORT -u doadmin -p \
  --ssl-mode=VERIFY_CA --ssl-ca=/opt/the-logbook/infrastructure/certs/do-mysql-ca.pem \
  -e "CREATE DATABASE the_logbook CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
```

**Test both connections before configuring anything.** These are the checks
the backend makes — the certificate chains to the CA file, and names the host
connected to:

```bash
cd /opt/the-logbook/infrastructure/certs

openssl s_client -connect PRIVATE-MYSQL-HOST:MYSQL-PORT -starttls mysql \
  -CAfile do-mysql-ca.pem -verify_hostname PRIVATE-MYSQL-HOST \
  </dev/null 2>/dev/null | grep "Verify return code"

openssl s_client -connect PRIVATE-VALKEY-HOST:VALKEY-PORT \
  -CAfile letsencrypt-roots.pem -verify_hostname PRIVATE-VALKEY-HOST \
  </dev/null 2>/dev/null | grep "Verify return code"
```

Each should print `Verify return code: 0 (ok)`. If one fails with
`62 (hostname mismatch)`, its certificate does not name the private hostname.
Run the same test against the **public** hostname (the one `doctl databases
connection` prints without `--private`). If that passes, use the public
hostname for that service in Step 6: the connection stays encrypted and
verified, and the trusted sources from Step 4 still refuse everyone but the
Droplet — the traffic simply leaves the VPC. Do not disable verification to
keep the private hostname. Any other failure — a timeout, a refused
connection — is in [Troubleshooting](#cannot-connect-to-managed-mysql).

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

# Managed MySQL — the hostname that passed Step 5's test, and its port
sed -i "s|^DB_HOST=.*|DB_HOST=PRIVATE-MYSQL-HOST|" .env
sed -i "s|^DB_PORT=.*|DB_PORT=MYSQL-PORT|" .env
sed -i "s|^DB_NAME=.*|DB_NAME=the_logbook|" .env
sed -i "s|^DB_USER=.*|DB_USER=logbook|" .env
sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=the-logbook-user-password|" .env

# Managed Valkey — host, port and password from doctl databases connection
sed -i "s|^REDIS_HOST=.*|REDIS_HOST=PRIVATE-VALKEY-HOST|" .env
sed -i "s|^REDIS_PORT=.*|REDIS_PORT=VALKEY-PORT|" .env
sed -i "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=your-valkey-password|" .env

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
DB_SSL_CA=/etc/ssl/logbook/do-mysql-ca.pem
REDIS_SSL=true
REDIS_SSL_CA=/etc/ssl/logbook/letsencrypt-roots.pem
SECURITY_REQUIRE_TLS=true
REDIS_REQUIRED=true
COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml:docker-compose.external-services.yml
EOF
```

If a password contains `|` or `&`, the `sed` lines above will mangle it; edit
`.env` by hand for that value instead.

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
`mysql` on the Droplet against `DB_HOST` and `DB_PORT`. Those clients read
their TLS settings from an option file, not from `.env`, so give them one, as
the user the backups run as (`deploy`, not root):

```bash
cat > ~/.my.cnf <<'EOF'
[client]
ssl-mode=VERIFY_IDENTITY
ssl-ca=/opt/the-logbook/infrastructure/certs/do-mysql-ca.pem

[mysqldump]
# Leave GTID state out of the dump, so it loads back into a server that has
# executed transactions of its own — a new cluster, or this one after a
# restore. It does nothing on a server running without GTIDs.
set-gtid-purged=OFF
no-tablespaces
EOF
chmod 600 ~/.my.cnf
```

If Step 5's test sent MySQL to the public hostname, `VERIFY_IDENTITY` is
checked against that name, which is what you want.

**On a release from before 2026-11-05**, `./scripts/backup.sh` ignored
`DB_PORT` and the clients tried 3306, which a DigitalOcean cluster does not
listen on. If you are on such a release, add `port=MYSQL-PORT` under
`[client]` above.

### Step 7: Start the Stack

```bash
# Expect: backend, clamav, frontend
docker compose config --services

docker compose run --rm --build backend python -m app.preflight
docker compose up -d --build

docker compose ps
docker compose logs -f backend   # first start creates every table on the new database

# Confirm the backend reached Valkey
docker compose logs backend | grep -E "Redis connected|REDIS_REQUIRED|Redis connection failed"
```

**Why `REDIS_REQUIRED=true` (set in Step 6).** By default a Redis (or Valkey)
the backend cannot reach does not stop it starting: a wrong port, a CA that
does not verify or a changed password is logged as a warning, and the backend
runs on without it — caching off, and rate limiting falling back to
per-process memory. Against a managed service that mistake would stay in
place, unnoticed. With `REDIS_REQUIRED=true` the backend logs `Redis connection
failed and REDIS_REQUIRED is true - refusing to start` and exits, and Docker
restarts it until the cache answers. See
[UPGRADING.md](../UPGRADING.md#redis_requiredtrue-now-refuses-to-start-without-redis-2026-11-04).

Never run `docker compose up -d mysql` (or `redis`) against this stack: compose
starts a service you name even when its profile is off, and nothing would use
it.

### Step 8: Nginx, HTTPS and First Sign-In

Follow Method 1, Steps 7–9.

---

## DigitalOcean-Specific Configuration

### Malware Scanning

Every uploaded file is scanned with ClamAV before it is stored. The bundled
`clamav` service always starts, and `CLAMAV_ENABLED` defaults to `true`. An
unreachable scanner refuses uploads rather than storing them unscanned. Setting
`CLAMAV_ENABLED=false` accepts files unscanned behind a standing warning to
administrators; read
[Security Configuration → Malware scanning](../../wiki/Configuration-Security.md#malware-scanning-of-uploads)
first. Allow 1.5–3 GB of RAM for clamd, as in the sizing table.

### Outbound Email

**DigitalOcean blocks outbound SMTP on ports 25, 465 and 587 on Droplets by
default.** The app sends mail over SMTP only, so out of the box it cannot send
anything — not invitations, not password resets, not notices. Two ways round
it:

- **A relay that accepts a non-standard port.** Several transactional mail
  providers accept authenticated SMTP on port `2525` as well. Set `SMTP_PORT`
  (and the other `SMTP_*` variables) to that provider's values, and confirm
  the port is open from the Droplet first:
  `nc -vz smtp.your-provider.example 2525`.
- **Ask DigitalOcean support to lift the block** for your account. They may
  or may not grant it.

Send a test from **Settings → Email** after either. See
[EMAIL_DELIVERABILITY.md](../EMAIL_DELIVERABILITY.md).

### Monitoring

- `--enable-monitoring` (Method 1, Step 2) installs DigitalOcean's metrics
  agent. Create alert policies (control panel → Monitoring) for CPU above 80%
  for 5 minutes, memory above 90%, and disk above 85%.
- The managed clusters publish their own metrics; alert on storage and
  connection counts.
- Application logs stay in the containers (`docker compose logs`). If you ship
  them elsewhere, remember they may contain member identifiers and treat the
  destination as holding PHI.

### Secrets

`.env` on the Droplet holds every secret. Restrict it with `chmod 600 .env`,
and keep an off-Droplet copy of `ENCRYPTION_KEY` and `ENCRYPTION_SALT` in your
department's password manager. The application reads its configuration from
environment variables only.

---

## Backups

Every backup holds every member's records. **Only encrypted archives leave the
Droplet.** Encryption needs the keys from `./scripts/backup-keygen.sh`
(Method 1, Step 6); until they exist, archives are written in plaintext and
administrators see a "Backups are not encrypted" notice. The copies below
select encrypted files by name, so a plaintext archive is never sent. See
[BACKUP.md](../BACKUP.md#encrypted-backups).

### The Spaces Bucket (Both Methods)

Backups go to a **Spaces** bucket in a different region from the Droplet, so a
regional outage does not take both.

1. Create a bucket (control panel → Spaces Object Storage), private, in another
   region — `yourorg-logbook-backups` in `sfo3`, say.
2. Create an access key for it (control panel → API → Spaces Keys). Where the
   key can be limited to one bucket, limit it to this one.
3. On the Droplet, install the AWS CLI, which speaks Spaces' S3-compatible API,
   and give it the key under its own profile:

   ```bash
   sudo apt install -y awscli
   aws configure --profile spaces   # the key and secret; region us-east-1; output json
   ```

   Every command below names the Spaces endpoint for the bucket's region with
   `--endpoint-url`. If a newer AWS CLI refuses uploads with an error about a
   checksum or an unsupported header, set
   `AWS_REQUEST_CHECKSUM_CALCULATION=when_required` in the cron line.

A key that can write to the bucket can also delete from it, so a compromised
Droplet could remove its own backups. Keep a second copy somewhere the Droplet
cannot reach — DigitalOcean's own Droplet backups (below), or a periodic copy
pulled to a department machine.

### Method 1 (Single Droplet)

The production stack's `backup` sidecar takes a nightly encrypted archive of
the database, uploads and audit archives (at `BACKUP_TIME`, default 02:00 UTC),
prunes archives older than `BACKUP_RETENTION_DAYS`, and runs a
restore-verification drill every `VERIFY_EVERY_N_BACKUPS` runs. Copy those
archives — the encrypted ones only — to Spaces nightly, from root's crontab
(the volume lives under Docker's data directory):

```bash
# sudo crontab -e  — once the AWS CLI profile above exists for root too
30 3 * * * aws s3 sync "$(docker volume inspect the-logbook_backups -f '{{ .Mountpoint }}')" s3://yourorg-logbook-backups/sidecar --profile spaces --endpoint-url https://sfo3.digitaloceanspaces.com --exclude "*" --include "*.tar.gz.enc" --include "*.tar.gz.enc.key" --include "*.tar.gz.enc.sha256" >> /var/log/logbook-offsite.log 2>&1
```

`--exclude "*"` first, then the three `--include`s, copies only files whose
names end in `.tar.gz.enc`, `.tar.gz.enc.key` or `.tar.gz.enc.sha256`. A
plaintext archive is named `….tar.gz`, so it is never copied.

Also consider **Droplet backups** (`doctl compute droplet-action
enable-backups YOUR-DROPLET-ID`, a paid add-on). They complement the archives;
they do not replace them, because a snapshot of a running MySQL is only
crash-consistent.

### Method 2 (Managed Services)

The `backup` sidecar does not run: `docker-compose.external-services.yml` turns
it off, because it dumps and drills against the bundled MySQL. The managed
MySQL cluster takes daily backups of its own, with point-in-time restore to a
**new** cluster, kept for a period set by DigitalOcean.

Those backups belong to the cluster and the account. For a copy outside them,
and for the `uploads` volume, which nothing else backs up, run
`./scripts/backup.sh` nightly as `deploy`. It dumps the database over verified
TLS (the `~/.my.cnf` from Step 6), archives the uploads from the backend
container and writes an encrypted archive to `/opt/the-logbook/backups`. Then
copy the encrypted files to Spaces:

```bash
# crontab -e (as deploy)
30 3 * * * cd /opt/the-logbook && ./scripts/backup.sh >> "$HOME/logbook-backup.log" 2>&1 && aws s3 sync /opt/the-logbook/backups s3://yourorg-logbook-backups/backups --profile spaces --endpoint-url https://sfo3.digitaloceanspaces.com --exclude "*" --include "*.tar.gz.enc" --include "*.tar.gz.enc.key" --include "*.tar.gz.enc.sha256" >> "$HOME/logbook-backup.log" 2>&1
```

The uploaded files are themselves encrypted by the application with
`ENCRYPTION_KEY` / `ENCRYPTION_SALT` (see "Secrets are NOT in the backup" in
[BACKUP.md](../BACKUP.md)), so the archive is unreadable without both the
backup keys and those secrets.

**The `audit_archives` volume needs a copy of its own.** Neither
`./scripts/backup.sh` nor the cluster's backups include it, and once a
retention purge has run it is the only copy of that audit history. Its files
are gzipped JSON lines the application does **not** encrypt, so copy them only
into the private bucket above (Spaces encrypts stored data at rest):

```bash
# sudo crontab -e
45 3 * * * aws s3 sync "$(docker volume inspect the-logbook_audit_archives -f '{{ .Mountpoint }}')" s3://yourorg-logbook-backups/audit_archives --profile spaces --endpoint-url https://sfo3.digitaloceanspaces.com >> /var/log/logbook-offsite.log 2>&1
```

Restore drills are yours to run in Method 2: from time to time, restore the
MySQL cluster's backup to a new cluster and point a test stack at it, and
restore one of the `./scripts/backup.sh` archives into that test stack.
Managed Valkey holds no data that needs backing up — sessions and cache
entries rebuild themselves.

---

## Moving an Existing Installation to DigitalOcean

Bring the data across with the repository's own backup and restore, never a
hand-made dump: the backend empties a database that has no `alembic_version`
table (see the warning in Method 2, Step 2).

1. **On the old server**, make sure backup keys exist
   (`./scripts/backup-keygen.sh` if not), then take a fresh backup:
   `./scripts/backup.sh`. Note the release you are running (`git describe
--tags` or `git rev-parse HEAD`).
2. **Copy across**, over SSH (`scp`): the newest `logbook_backup_*.tar.gz.enc`
   with its `.key` and `.sha256` files, and the `backup-keys/` directory (or
   have the backup's private key to hand).
3. **On the Droplet**, check out the same release you were running, then build
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
   than `backup-keys/`. In Method 2, the restore runs `mysql` on the Droplet
   against the managed cluster, which is why it needs the `mysql-client`
   package and `~/.my.cnf`.

6. **Verify** as in BACKUP.md's
   [restore drill](../BACKUP.md#verify-your-backups-restore-drill), then move
   DNS to the new Droplet and issue its certificate (Method 1, Steps 4 and 8).
7. **Then upgrade**, if you want a newer release, with the
   [Updating](#updating) steps — one change at a time, so a problem is clearly
   either the move or the upgrade. Read [UPGRADING.md](../UPGRADING.md) first.

The `audit_archives` volume is not in `./scripts/backup.sh`'s archive. If the
old server has one, copy its contents across with `tar` over SSH into the new
Droplet's `the-logbook_audit_archives` volume before step 5.

---

## Updating

Read [UPGRADING.md](../UPGRADING.md) before pulling: it lists every change
that can stop an existing installation from starting. Never downgrade to
repair a migration problem — several migrations do not reverse.

```bash
cd /opt/the-logbook

# 1. Back up first
./scripts/backup.sh

# Method 2 on a 4 GB Droplet: resize to 8 GB before the rebuild (see Droplet sizing)

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

### Cannot Connect to Managed MySQL

```bash
# Connect over verified TLS with the CA file the backend uses
cd /opt/the-logbook
docker run --rm -it -v "$PWD/infrastructure/certs:/certs:ro" mysql:8.0 \
  mysql -h PRIVATE-MYSQL-HOST -P MYSQL-PORT -u logbook -p \
  --ssl-mode=VERIFY_IDENTITY --ssl-ca=/certs/do-mysql-ca.pem \
  -e "SELECT 1"
```

If it times out:

1. The cluster's trusted sources must include the Droplet
   (`doctl databases firewalls list MYSQL-ID`).
2. A private hostname only answers from inside the cluster's VPC: the Droplet
   must have been created with `--vpc-uuid` of the same VPC.
3. The port is the one `doctl databases connection` prints — never 3306.

`Access denied`: check `DB_USER` / `DB_PASSWORD` against the user from
Method 2, Step 2 (`doctl databases user get MYSQL-ID logbook`).

`./scripts/backup.sh` fails to connect while the backend works: `~/.my.cnf`
belongs to a different user than the one running the script, or — on a
release from before 2026-11-05, which ignored `DB_PORT` — is missing a
`port=` line (see Method 2, Step 6).

### Cannot Connect to Managed Valkey

```bash
cd /opt/the-logbook
docker run --rm -it -v "$PWD/infrastructure/certs:/certs:ro" redis:7-alpine \
  redis-cli --tls --cacert /certs/letsencrypt-roots.pem \
  -h PRIVATE-VALKEY-HOST -p VALKEY-PORT \
  --askpass ping
```

`PONG` means the backend's settings will work. Otherwise check the trusted
sources (`doctl databases firewalls list VALKEY-ID`), that `REDIS_PORT` is the
port `doctl databases connection` reports, and that `REDIS_PASSWORD` is the
current password. If `redis-cli` works but the backend reports a hostname or
certificate error, re-run the `openssl` test in Method 2, Step 5.

### Droplet Runs Out of Memory

```bash
free -h
docker stats --no-stream
```

Resize the Droplet (power it off, then `doctl compute droplet-action resize`,
then power it on), or add swap:

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### Nothing Works After Adding the Cloud Firewall

`apt`, `git pull`, Docker builds and Let's Encrypt all fail at once, and the
site may still answer: the firewall has **no outbound rules**. Add the outbound
rules from Method 1, Step 3 (`doctl compute firewall add-rules`).

### Certificate Won't Issue or Renew

- The A record must resolve to the Reserved IP (`dig +short logbook.yourdomain.com`).
- The `logbook-web` firewall must allow port 80 inbound and all outbound —
  Let's Encrypt's HTTP-01 challenge uses the first, certbot's own requests the
  second.
- `sudo certbot certificates`, then `sudo nginx -t`.

### Email Does Not Arrive

See [Outbound Email](#outbound-email): ports 25, 465 and 587 are blocked on
Droplets by default. `nc -vz SMTP-HOST SMTP-PORT` from the Droplet shows
whether the port you configured is reachable.

### Containers Keep Restarting

```bash
docker compose logs --tail=100 backend
```

In production the backend exits with a message naming the setting it refuses
— a weak or missing secret, `DEBUG` on, TLS required but not configured, or
(with `REDIS_REQUIRED=true`) a cache it cannot reach. Fix that value in `.env`
and run `docker compose up -d` again. See
[TROUBLESHOOTING.md](../TROUBLESHOOTING.md).

---

## Pitfalls

Things that go wrong on DigitalOcean in particular. The first seven are dealt
with in the steps above; they are listed here so nothing depends on having
read every step.

| Pitfall                                  | What happens                                                                                                                                                                                                                                                       | What to do                                                                                                                                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Mail ports blocked**                   | Ports 25, 465 and 587 are blocked on Droplets by default, so the app sends no email at all.                                                                                                                                                                        | A relay on another port, or ask support to lift the block ([Outbound Email](#outbound-email)).                                                                                                                                 |
| **A database without `alembic_version`** | The backend drops every table in it on start, taking it for a fresh install.                                                                                                                                                                                       | A database for The Logbook alone — never `defaultdb`; restore with `./scripts/backup.sh --restore` ([Method 2, Step 2](#step-2-create-the-managed-mysql-cluster), [Moving](#moving-an-existing-installation-to-digitalocean)). |
| **Backups never encrypted**              | Without `./scripts/backup-keygen.sh`, every archive is plaintext.                                                                                                                                                                                                  | Create the keys before the first backup; sync only `*.enc` files ([Backups](#backups)).                                                                                                                                        |
| **A firewall with no outbound rules**    | Every outbound connection is refused: package installs, builds, certificates, backups.                                                                                                                                                                             | The outbound rules in [Method 1, Step 3](#step-3-create-the-cloud-firewall).                                                                                                                                                   |
| **Managed clusters' ports**              | Neither cluster listens on 3306 or 6379.                                                                                                                                                                                                                           | The ports `doctl databases connection` prints, in `.env` ([Method 2, Step 6](#step-6-configure-env)). `./scripts/backup.sh` uses `DB_PORT` from `.env` too.                                                                    |
| **Hostname verification**                | The backend checks that each server's certificate names the host it connected to. Whether DigitalOcean's certificates name the `private-` hostnames is something to test, not assume.                                                                              | The `openssl` tests in [Method 2, Step 5](#step-5-create-the-droplet-fetch-the-certificates-and-test-them), and the public hostname if a private one fails — never disabled verification.                                      |
| **Redis misconfigured**                  | By default the backend starts anyway, with caching off and per-process rate limiting.                                                                                                                                                                              | `REDIS_REQUIRED=true`, so it refuses to start instead ([Method 2, Step 7](#step-7-start-the-stack)).                                                                                                                           |
| **Collation**                            | A database created by `doctl` or the control panel takes MySQL 8's default collation, not the `utf8mb4_unicode_ci` the application is tested with, and every table inherits it.                                                                                    | Create it with SQL ([Method 2, Step 5](#step-5-create-the-droplet-fetch-the-certificates-and-test-them)).                                                                                                                      |
| **Building on a 4 GB Droplet**           | The frontend build runs on the Droplet and can run out of memory.                                                                                                                                                                                                  | Build on 8 GB; resize down afterwards if you must ([Droplet sizing](#droplet-sizing)).                                                                                                                                         |
| **A load balancer in front**             | A DigitalOcean Load Balancer terminating TLS and forwarding plain HTTP makes Nginx send `X-Forwarded-Proto: http`, and the production backend, which enforces HTTPS, redirects forever.                                                                            | Have Nginx pass on the load balancer's `X-Forwarded-Proto` rather than `$scheme`, and add the load balancer's address to `TRUSTED_PROXY_IPS` in `.env`. This guide does not use one.                                           |
| **Too few database connections**         | Each backend process opens up to 30 connections (`DB_POOL_MAX` 10, plus 20 overflow, in `backend/app/core/database.py`); the optional four-worker setup in [Production Deployment](../../wiki/Deployment-Production.md) makes 120. Small clusters allow far fewer. | Check the cluster's connection limit (control panel → the cluster's settings) before adding workers, or choose a larger size.                                                                                                  |
| **A different install directory**        | Docker names volumes after the directory, so outside `/opt/the-logbook` they are not `the-logbook_*` and the backup commands find nothing.                                                                                                                         | Install at `/opt/the-logbook`, or adjust every `the-logbook_` name; `docker volume ls` shows the real ones.                                                                                                                    |
| **MySQL 8.0's lifecycle**                | Community MySQL 8.0 reached end of life in April 2026. Which MySQL versions DigitalOcean offers, and for how long, is DigitalOcean's to set and change.                                                                                                            | Check the version your cluster runs (`doctl databases list`). Test any move to 8.4 on a copy first: this repository's CI and bundled stack run 8.0.                                                                            |

---

## Security Checklist

- SSH only from your own address, as a sudo user rather than `root`.
- A Cloud Firewall with inbound 22 (your address), 80 and 443 only — nothing
  for 3000, 3001, 3306 or 6379, from the internet or the VPC — and the
  outbound rules it needs.
- Both managed clusters limited by trusted sources to the Droplet.
- `DB_SSL`, `REDIS_SSL` and `SECURITY_REQUIRE_TLS` set to `true` with CA files
  (Method 2), and verification never disabled.
- Backup keys created, the private key stored apart from the Droplet, and only
  encrypted archives sent to Spaces.
- A private Spaces bucket in another region, with a key limited to it where
  possible, and a second copy the Droplet cannot delete.
- `ENCRYPTION_KEY` / `ENCRYPTION_SALT` kept off the Droplet as well as on it.
- Keep the Droplet patched (`sudo apt update && sudo apt upgrade -y`).
- Because the application stores PHI, confirm before going live that
  DigitalOcean will sign a HIPAA Business Associate Agreement covering the
  services you use; if it will not, this platform is not suitable for a
  HIPAA-covered deployment (see [COMPLIANCE.md](../COMPLIANCE.md)).

---

## Summary

| Step | Method 1: Single Droplet                                      | Method 2: Droplet + Managed Services                                          |
| ---- | ------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1    | VPC                                                           | VPC                                                                           |
| 2    | Droplet and Reserved IP                                       | Managed MySQL cluster and the `logbook` user                                  |
| 3    | Cloud Firewall: 22 from you, 80/443 from anyone, all outbound | Managed Valkey cluster                                                        |
| 4    | Point DNS at the Reserved IP                                  | Trusted sources: the Droplet only                                             |
| 5    | Sudo user and Docker                                          | Droplet, `mysql-client`, CA files, the database — and the `openssl` tests     |
| 6    | Clone, configure `.env`, create backup keys, start            | Configure `.env`, backup keys and `~/.my.cnf`                                 |
| 7    | Nginx and HTTPS                                               | `up -d` with `docker-compose.external-services.yml`; confirm Valkey           |
| 8    | Encrypted backups to Spaces; mail relay on an open port       | Nginx and HTTPS; encrypted backups and `audit_archives` to Spaces; mail relay |

**Need help?** See the [Troubleshooting Guide](../TROUBLESHOOTING.md) or open a
[GitHub Issue](https://github.com/thegspiro/the-logbook/issues).
