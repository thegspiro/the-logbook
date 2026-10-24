# TLS between the application, the database and Redis

Traffic between the backend, MySQL (or MariaDB) and Redis carries member
records, sessions and cached data. This page covers encrypting that traffic with
certificates you control, verifying who is on the other end, and optionally
requiring the backend to prove who it is too (mutual TLS). TLS to the
**browser** is separate: see the reverse-proxy guides.

The setup has two steps, deliberately:

1. **Offer TLS (this page).** The servers accept encrypted connections, the
   backend and the backup sidecar use them and verify the server. Plaintext
   still works, so nothing breaks while you move everything over.
2. **Require TLS.** A later switch refuses plaintext and makes the client
   certificate mandatory. Until it is applied, a network attacker who can force
   a plaintext connection is not blocked.

## What the pieces are

| Piece                | What it is                                                    | Where it lives                                         |
| -------------------- | ------------------------------------------------------------- | ------------------------------------------------------ |
| CA certificate       | The authority every certificate is signed by                  | Public; copied beside every certificate                |
| CA **private key**   | Needed only to issue or renew certificates                    | `tls-ca-private/` — **never mounted into a container** |
| Server certificates  | One for MySQL, one for Redis                                  | `tls/mysql`, `tls/redis`                               |
| Client certificates  | One for the backend, one for the backup sidecar               | `tls/backend`, `tls/backup`                            |
| Public server copies | The server certificates without their keys, for expiry checks | `tls/backend`                                          |

## Set it up

On the host, in the install directory (on Unraid, as root, so the keys can be
handed to the containers' users):

```bash
./scripts/tls-setup.sh
./scripts/tls-setup.sh --print-env     # the lines to add to .env
docker compose up -d                   # database and Redis restart with TLS
```

Add the printed lines to `.env`. They are container paths, not host paths:

```bash
DB_SSL=true
DB_SSL_CA=/etc/ssl/logbook-tls/ca.pem
DB_SSL_CERT=/etc/ssl/logbook-tls/client.pem
DB_SSL_KEY=/etc/ssl/logbook-tls/client.key
REDIS_SSL=true
BACKEND_REDIS_PORT=6380
REDIS_SSL_CA=/etc/ssl/logbook-tls/ca.pem
REDIS_SSL_CERT=/etc/ssl/logbook-tls/client.pem
REDIS_SSL_KEY=/etc/ssl/logbook-tls/client.key
```

`BACKEND_REDIS_PORT` is the port the backend uses to reach Redis: `6379` is
plaintext, `6380` is TLS. With these set the backend connects with the server
verified against the CA, by name, and presents its client certificate. Production
installs can then drop `SECURITY_REQUIRE_TLS=false` (the Unraid files default to
it): the backend now has TLS, and `SECURITY_REQUIRE_TLS=true` keeps it that way.

The generated server certificates name `mysql`, `db`, `intranet-mysql`,
`logbook-db`, `redis`, `intranet-redis`, `logbook-redis`, `localhost` and
`127.0.0.1`. For a database or cache on another host add its name with
`--san db.example.org`.

### How the servers decide

The database and Redis start through a small wrapper
(`database/tls-entrypoint.sh`, `infrastructure/redis/tls-entrypoint.sh`):

- **Certificates mounted** → TLS 1.2/1.3 is enabled (MySQL on its normal port,
  Redis additionally on 6380).
- **Nothing mounted** → the server starts exactly as it always did.
- **Mounted but incomplete or unreadable** → the server starts **without** TLS
  and logs why, instead of crash-looping the database over a file permission.
  Check `docker compose logs mysql redis` for `[tls]` lines after changing certificates.

Healthchecks use the local socket / plaintext loopback and are unaffected.

### Backups

The nightly sidecar and the restore drill connect with `--ssl-mode=VERIFY_IDENTITY`
and the `backup` client certificate whenever `tls/backup` holds `ca.pem`,
`client.pem` and `client.key`. A half-populated directory **aborts the run**
rather than falling back to plaintext. `scripts/backup.sh` reaches the bundled
database through its container, so it is not affected; for a remote `DB_HOST` it
uses the same files (`DB_TLS_DIR`, default `tls/backup`).

## Certificate lifetimes

Server and client certificates last one year; the CA ten. **An expired
certificate stops the connection it protects.** Check at any time:

```bash
./scripts/tls-setup.sh --check         # exits 1 if anything expires within 30 days
```

Renew before they lapse, keeping the CA (needs `tls-ca-private/ca.key`):

```bash
./scripts/tls-setup.sh --renew
docker compose up -d --force-recreate mysql redis backend backup
```

`--force` replaces the CA itself, which invalidates every certificate and needs
every service restarted.

## Keeping the CA key safe

The CA key can mint a certificate that any of your services will trust. Keep
`tls-ca-private/` (or the directory you gave `--ca-key-dir`) off the server's
shared storage once you have the certificates, for example in a password
manager or on an offline drive. If you lose it you lose only the ability to
renew: run `--force` once to start over.

## Known limits

- Until plaintext is refused (the second step), TLS is available but not
  enforced.
- Private keys are written mode `600`. As root (Unraid) each is handed to the
  user of the container that loads it (`999` for MySQL and Redis, `1000` for the
  backend). Not running as root, the script tells you the `chown` to run. Do not
  loosen the modes: a key anyone on the host can read defeats the point.
- MariaDB (the ARM stack) takes the same flags as MySQL here; enforcement in the
  second step differs between the two engines.
