# TLS certificate authorities

Private CA certificates for the backend's outbound TLS connections to MySQL
and Redis. Mounted read-only into the backend container at `/etc/ssl/logbook`
by both `docker-compose.yml` and `docker-compose.prod.yml`.

`DB_SSL_CA` and `REDIS_SSL_CA` are read **inside** the container, so they must
name the container path, not the host path:

```bash
DB_SSL=true
DB_SSL_CA=/etc/ssl/logbook/mysql-ca.pem

REDIS_SSL=true
REDIS_SSL_CA=/etc/ssl/logbook/redis-ca.pem
```

A host path such as `/home/you/certs/ca.pem` resolves to nothing in the
container, and `ssl.create_default_context(cafile=...)` raises
`FileNotFoundError` during startup — so the mistake surfaces as a boot crash
rather than as a TLS error.

Point `SSL_CERTS_DIR` at a different host directory to keep certificates
outside the repository.

Certificates are ignored by git; only this file and `.gitignore` are tracked.
