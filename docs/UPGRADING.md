# Upgrading

Read this before pulling a new version into a running deployment.

## Check the configuration before you restart

A configuration problem is normally discovered when the container refuses to
boot — which means finding it by losing the service. Ask first:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  run --rm --build backend python -m app.preflight
```

Exit `0` means the configuration starts, `1` means it does not and the
blocking items are listed, `2` means a value is malformed.

Two details of that command are load-bearing:

- **`--build`.** `run` uses the image that already exists; it does not build
  first. Without this you are checking the version you are replacing rather
  than the one you are deploying — and before the first upgrade that carries
  this tool, the old image has no `app.preflight` module at all.
- **The same `-f` files the deployment uses.** Compose merges values from
  every file given, so a bare `docker compose run` evaluates only the base
  development configuration: different `SECURITY_ENFORCE_HTTPS`, different
  `ENABLE_DOCS`, and an answer about a configuration nobody runs. Pass the
  identical `-f` set you bring the stack up with (or none, if the deployment
  uses a single file).

Blocking checks only run for `production` and `staging`, so a run in
development reports nothing regardless of how broken a production
configuration is. To test production values from elsewhere, add
`--as production`.

### Advisory items

Below any blocking items, preflight lists an **"Advisory, does not prevent
startup"** section. These are printed in the startup log too, and the service
boots with them — but each one names something that works worse than intended.

A localhost `FRONTEND_URL` used to be listed here. Since 2026-09-25 it
blocks startup instead — see
[`FRONTEND_URL` must be a public address](#frontend_url-must-be-a-public-address-2026-09-25).

### "I set it in .env and nothing changed"

A Docker Compose `environment:` block is a **whitelist**. A variable missing
from it cannot be set from `.env` at all — Compose does not warn, and the
application sees only its built-in default. When a blocking check fires,
preflight and the startup log both report whether each setting actually
reached the process:

```
SECURITY_REQUIRE_TLS   NOT PRESENT — using built-in default True
```

That line means the value is not arriving. Add the name to the backend
service's `environment:` block and confirm it lands:

```bash
docker compose config | grep SECURITY_REQUIRE_TLS
```

This applies to any hand-maintained compose file — including one managed by
Unraid's Compose Manager plugin, which keeps its own file under
`/boot/config/plugins/compose.manager/projects/<name>/`. Such a file does not
receive changes made to the compose files in this repository, so a setting
added upstream has to be added there by hand.

## Find the gaps before an upgrade gates on them

Rather than waiting for a boot to fail, ask which settings the compose file
cannot pass through at all:

```bash
docker compose run --rm --build \
  -v "$PWD/compose.yaml:/tmp/compose.yaml:ro" \
  backend python -m app.preflight --compose /tmp/compose.yaml
```

The path is read **inside** the container, so a host file has to be mounted;
point the `-v` source at whichever compose file the deployment actually uses.
It reports every setting that can block a boot and is absent from that file:

```
12 of 21 settings that can block a boot are absent from this file:
  ...
  SECURITY_REQUIRE_TLS
```

None of those are a problem on the day you run it. Each becomes one the
moment an upgrade starts gating on it, and the failure then looks like an
unexplained crash loop rather than a missing line. Add them to the backend
service's `environment:` block as `NAME: ${NAME:-<default>}`, keeping the
application's own default so nothing changes until you set it.

### Unraid (Compose Manager)

The plugin keeps its compose file and `.env` on the flash drive, and they are
the only copies — back them up before editing:

```bash
cd /boot/config/plugins/compose.manager/projects/<project>
cp compose.yaml compose.yaml.bak && cp .env .env.bak

docker compose run --rm --build \
  -v "$PWD/compose.yaml:/tmp/compose.yaml:ro" \
  backend python -m app.preflight --compose /tmp/compose.yaml
```

This file is written by hand and never updated by pulling this repository, so
it is the deployment most likely to fall behind a newly added gate. Run the
check before each upgrade.

## Before every upgrade: back up, and do not downgrade to fix a fork

The backend applies database migrations itself when it starts, so the restart
_is_ the upgrade. Before it:

- **Back up the database, and separately back up `ENCRYPTION_KEY` and
  `ENCRYPTION_SALT`.** Sensitive fields are encrypted with them, so a restored
  database is unreadable without the keys that were in use when it was written.
- **If you apply migrations by hand** (`cd backend && alembic upgrade head`),
  run `alembic heads` first. It must print exactly one revision; two means the
  release itself has a fork, and it should be reported rather than repaired
  locally.
- **Never downgrade to "repair" a migration fork.** Several migrations
  deliberately do not reverse, and one loses data on the way down — the entries
  below name them.

## Changes that can stop an existing deployment from starting

Newest first. Every entry here is a change that was safe on a fresh install
and refused to boot an existing one.

### Every backend setting in `.env` now reaches the container (2026-10-06)

**Review your `.env` before you upgrade.** Until this release the backend's
`environment:` block in each shipped compose file listed only about a fifth of
the backend's settings (33 of 170 in `docker-compose.yml`, 44 in
`unraid/docker-compose-unraid.yml`). Anything else you put in `.env` never
reached the application: the block is a whitelist, `.env` is not copied into
the image, and the backend kept its built-in default without a word. The
shipped files — `docker-compose.yml`, `unraid/docker-compose-unraid.yml` and
`unraid/docker-compose-build-from-source.yml` — now pass every setting through.

A line in `.env` that has been doing nothing will start doing something on the
first restart. The groups most likely to carry such a line:

- **Email** — `EMAIL_ENABLED`, `SMTP_*`, `CLOUDFLARE_*`. A stale
  `EMAIL_ENABLED=true` with old or placeholder SMTP credentials now tries to
  send, and fails.
- **Sign-in** — `GOOGLE_*`, `AZURE_AD_*`, `AUTHENTIK_*`, `OAUTH_*`,
  `SALESFORCE_*`. A provider switched on in `.env` becomes available. A
  `SALESFORCE_OAUTH_REDIRECT_URI` left at the `.env.example.full` placeholder
  (`https://your-domain/...`) replaces the address the backend used to derive
  from the request, and "Connect Salesforce" fails. Set it to your real
  callback URL or remove the line.
- **SMS and push** — `TWILIO_*`, `PUSH_ENABLED`, `VAPID_*`.
- **Password and session policy** — `PASSWORD_*`, `HIPAA_*`,
  `ACCESS_TOKEN_EXPIRE_MINUTES`, `REFRESH_TOKEN_EXPIRE_DAYS`. These apply from
  the restart; a stricter password rule binds the next password set. A `.env` copied
  from `.env.example.full` carries `ACCESS_TOKEN_EXPIRE_MINUTES=480`, which
  replaces the 30-minute default.
- **Abuse controls** — `CAPTCHA_*`, `BREACHED_PASSWORD_*`, `MAX_LOGIN_ATTEMPTS`,
  `ACCOUNT_LOCKOUT_*`, `SUSPICIOUS_IP_*`, `RATE_LIMIT_*`,
  `PUBLIC_FORM_DAILY_LIMIT`, `GUEST_CHECK_IN_DAILY_LIMIT`.
- **Geo-blocking** — `GEOIP_*`, `BLOCKED_COUNTRIES`, `IP_LOGGING_ENABLED`.
  `BLOCKED_COUNTRIES=` (empty) now means "block no countries".
- **Storage and paths** — `STORAGE_TYPE`, `UPLOAD_DIR`, `MAX_FILE_SIZE`,
  `MAX_REQUEST_BODY_SIZE`, `AWS_*`, `AZURE_STORAGE_*`, `GCS_*`,
  `AUDIT_ARCHIVE_DIR`, `GEOIP_DATABASE_PATH`. These are read **inside the
  container**. A host path left over from a non-Docker install would now send
  uploads somewhere no volume is mounted, and they would be lost with the
  container.
- **Audit shipping and signing keys** — `AUDIT_SHIP_*`,
  `AUDIT_ALLOW_CHAIN_REHASH`, `ENCRYPTION_KEYS_LEGACY`, `AUDIT_LOG_SIGNING_KEY`,
  and on the Unraid files `VOTE_SIGNING_KEY`. Read the next paragraph if
  either signing key is in your `.env`.
- **Monitoring and startup** — `SENTRY_*`, `LOG_FORMAT`, `DB_ECHO`,
  `REDIS_REQUIRED`, `SECURITY_BLOCK_INSECURE_DEFAULTS`, `REGISTRATION_ENABLED`.

**A signing key that never arrived signed nothing, and the old records keep
verifying.** Production startup warns when `AUDIT_LOG_SIGNING_KEY` is unset,
so many installs added it to `.env` — where it did not reach the backend, and
every audit row since was signed with the fallback, `SECRET_KEY`. The same
applies to `VOTE_SIGNING_KEY` and ballots on the Unraid files
(`docker-compose.yml` already passed that one through). Leave the key in
`.env`; there is nothing to comment out. Once it arrives:

- New audit rows and ballots are signed with the dedicated key, and each
  records a short fingerprint of the key that signed it (migration
  `01f36743137a` adds `signing_key_id` to `audit_logs` and `votes`; it is
  never the key, nor anything the key can be recovered from).
- Rows signed before the key arrived still verify: a row with no fingerprint
  is checked against the dedicated key, then against `SECRET_KEY`. The
  integrity check logs one `WARNING` per run saying how many it verified with
  `SECRET_KEY`.
- `SECRET_KEY` is accepted only for rows written **before the first row signed
  with the dedicated key** — for ballots, cast no later than the first ballot
  signed with it. A row after that point signed with `SECRET_KEY` is reported
  as tampered, as is a row that matches neither key.

Two things follow. **Keep `SECRET_KEY` unchanged** for as long as you need the
pre-upgrade audit rows and ballots to verify: rotating it makes them read as
tampered, exactly as rotating the dedicated key would. And an off-host audit
collector (`AUDIT_SHIP_*`) verifying the shipped batches' HMAC must be given
the dedicated key, since shipping signs with it from the first restart. To see
whether a key was reaching the container before the upgrade:

```bash
docker compose exec backend printenv AUDIT_LOG_SIGNING_KEY VOTE_SIGNING_KEY
```

A key that printed nothing there but is set in `.env` had never been used,
and the rows written meanwhile are the ones `SECRET_KEY` now verifies. See
`docs/KNOWN_LIMITATIONS.md`, "Audit and ballot signing — `SECRET_KEY` still
verifies rows from before the dedicated key".

**What can stop the boot.** A value that never reached the app was never
validated either. A typo such as `EMAIL_ENABLED=ture` or `SMTP_PORT=587x`
now fails settings validation and the backend refuses to start. A newly
honoured value can also fail a production check that blocks startup:
`RATE_LIMIT_ENABLED=false`, `DB_ECHO=true`, or an `ALGORITHM` other than
`HS256`. `REDIS_REQUIRED=true` refuses to start without Redis, and
`SECURITY_BLOCK_INSECURE_DEFAULTS=true` makes a development stack refuse to
start on a critical warning.

**One template line reads differently under Compose.** Older copies of
`.env.example.full` have `CAPTCHA_SITE_KEY=` followed by spaces and a
`# Public …` comment. Compose takes that whole comment as the value. It does
nothing while CAPTCHA is off; with CAPTCHA on, the browser is given a key that
does not exist and every protected form fails. Delete the comment from that
line.

**Before you upgrade:**

1. Read your `.env` line by line, and delete or correct anything you did not
   mean to run with. Settings you never set keep the same values they had
   before: every new line in the compose files defaults to the application's
   own default, and an empty value for an optional setting counts as unset.
2. Run preflight against the new version, as at the top of this page. It
   validates every setting that will now arrive.
3. After the restart, confirm the values you care about landed:

   ```bash
   docker compose config | grep -E 'EMAIL_ENABLED|SMTP_HOST|PASSWORD_MIN_LENGTH'
   ```

A compose file you maintain yourself, such as one kept by Unraid's Compose
Manager, does not change on upgrade. It keeps its old allowlist, and settings
missing from it still do nothing — see
[Find the gaps before an upgrade gates on them](#find-the-gaps-before-an-upgrade-gates-on-them).
The Unraid Community Apps template (`unraid/the-logbook.xml`) is unaffected:
it has no allowlist, and every variable it defines goes to the container.

### The `production` profile's nginx needs a certificate in `infrastructure/nginx/ssl/` (2026-09-30)

Only deployments started with `--profile production` are affected. That
profile's nginx container used to mount `infrastructure/nginx/nginx.conf`,
which is a host-nginx site file: it has no `events`/`http` blocks, proxies to
`127.0.0.1`, and reads Let's Encrypt paths for a placeholder domain. As shipped
the container could not start, so a working deployment is running a local
edit of that file or of `docker-compose.yml`.

The container now mounts its own `infrastructure/nginx/docker.conf` and reads
`fullchain.pem` and `privkey.pem` from `infrastructure/nginx/ssl/`. **Without
both files it will not start**, and it logs:

```
[emerg] cannot load certificate "/etc/nginx/ssl/fullchain.pem"
```

**The fix:** put the certificate and key there, then bring the profile up
again. "Docker Compose `production` profile" in `docs/DEPLOYMENT.md` covers
issuing one with Let's Encrypt, including renewal. If you had edited
`nginx.conf` or the compose file to make the old setup work, move your
certificate paths to that directory instead. Your edited `nginx.conf` is no
longer read by the container. Git will report a conflict on a locally edited
`docker-compose.yml`; take the incoming `volumes:` list for the `nginx`
service.

Nothing changes for installs that run nginx on the host
(`scripts/setup-ssl.sh`, `docs/deployment/aws.md`) or no proxy at all.

### `FRONTEND_URL` must be a public address (2026-09-25)

A production backend now **refuses to start** while `FRONTEND_URL` points at
the machine itself. Until this release that was an advisory warning, and the
shipped default is `http://localhost:3000`, so any production install that
never set it stops booting on the first restart after the upgrade:

```
CRITICAL: FRONTEND_URL is 'http://localhost:3000', which points at this machine. ...
```

Every link in an outgoing email — password resets, ballots, approvals,
reminders, applicant status — is built from `FRONTEND_URL`, never from the
address a request arrived on. A loopback value mails every recipient a link
to their own computer, and nothing else reports it: the send succeeds, the
link does not open. The check covers a host of `localhost`, a `*.localhost`
name, a loopback address (`127.x.x.x`, `::1`), `0.0.0.0`, or a value with no
parseable host. It runs in `production` only; staging and development are
unaffected.

**A public address in `ALLOWED_ORIGINS` counts.** When `FRONTEND_URL` is
loopback or empty, the backend uses the first address in `ALLOWED_ORIGINS`
that is not loopback, logs that it did, and starts. That covers the Unraid
Community Apps template and `scripts/setup-env.py`, which ask only for the
allowed origins. The block applies only when neither setting names an
address a recipient could open. Setting `FRONTEND_URL` explicitly is still
the way to choose, for example an `https://` domain rather than the LAN
address CORS also allows.

**The fix:** set `FRONTEND_URL` in `.env` to the address members open the site
at — `https://logbook.yourdept.org`, or a LAN address such as
`http://192.168.1.50:7880` for an install nobody reaches from outside — then
confirm it reaches the container and restart:

```bash
docker compose config | grep FRONTEND_URL
```

There is no waiver flag: a deployment that sends email with unusable links
is not a configuration anyone should run. For a trial on a single machine,
run with `ENVIRONMENT=development` instead of production.

**Links already sent keep the old address.** Fixing the setting does not
reach mail already delivered: members request a fresh password reset, and the
secretary re-sends any open ballots.

**The installers now require the address too.** `install.sh` asks for it and
no longer offers "set it later", and without a terminal to ask from it
stops before installing anything. `scripts/universal-install.sh` stops unless
it is given `--public-url <url>` (or `LOGBOOK_PUBLIC_URL`) — so
`curl ... | bash` becomes `curl ... | bash -s -- --public-url <url>`. Both
accept a re-run without the flag when the existing `.env` already names a
public `FRONTEND_URL`, and both refuse a `localhost` address.
`unraid/unraid-setup.sh` refuses a `localhost` HTTPS origin, and its update
path stops, before restarting anything, when the kept `.env` would not boot.

### The production compose file needs Docker Compose v2.24.4 or later (2026-08-16)

`docker-compose.prod.yml` uses `volumes: !override` to throw away the
development bind mounts it inherits from `docker-compose.yml`, so production
runs the built image rather than a source tree mounted over it. Compose older
than v2.24.4 does not understand the tag and will not bring the stack up.

Check with `docker compose version`. **Upgrade Compose; do not delete the
tag** — without it, production mounts the development source over the image.
The Unraid compose files in `unraid/` do not use the tag, and neither does a
compose file of your own unless you copied it in.

### `SECURITY_REQUIRE_TLS` defaults to `true` (2026-08-13)

Absent transport TLS was previously a warning. It is now a **blocking**
critical in production and staging, so a deployment whose MySQL and Redis
speak plaintext stops booting on the next restart after this upgrade — which
may be long after the upgrade itself, making the connection easy to miss.

Choose one:

- **The data services have TLS:** set `DB_SSL=true` and `REDIS_SSL=true`, plus
  `DB_SSL_CA` / `REDIS_SSL_CA` pointing at the CA **inside the container**
  (`/etc/ssl/logbook/...`; put the PEM in `./infrastructure/certs`). Enabling
  TLS without a CA is itself blocking — an encrypted channel that authenticates
  nobody is indistinguishable from a correct one.
- **They do not, and the network protects that traffic** (the bundled MySQL and
  Redis on a private Docker network are this case): set
  `SECURITY_REQUIRE_TLS=false` as an explicit risk acceptance.

`SECURITY_ENFORCE_HTTPS` must also be `true` in production. It has no waiver
flag. It currently gates no behaviour — nothing emits HSTS and nothing
redirects HTTP — so setting it true cannot cause a redirect loop behind a
reverse proxy or CDN. To control the `Secure` flag on auth cookies, use
`COOKIE_SECURE`.

### Duplicate active applicants stop the migration (2026-08-12)

Migration `20260812_0003` restores the rule that a department has at most one
**active** prospective member per email address, and builds a unique index to
hold it. A later step (`20260814_0003`) reconciles duplicates — but the index
is built first, so a database that already holds two active applicants with the
same email fails the upgrade at that index, before the reconciliation can run.

Run this before upgrading an installation older than 2026-08-12:

```sql
SELECT organization_id, LOWER(TRIM(email)) AS normalized_email, COUNT(*) AS active_rows
FROM prospective_members
WHERE status = 'active' AND email IS NOT NULL
GROUP BY organization_id, LOWER(TRIM(email))
HAVING COUNT(*) > 1;
```

**Any row it returns is a hard stop.** For each group, keep the record with the
earliest `created_at` (then the lowest `id`), review the applications linked to
the others, and set those others to `inactive`. Do not delete them. Re-run the
query until it returns nothing, then upgrade, and read the migration log
afterwards for anything the reconciliation merged. The full procedure is in the
[August 12–14 change audit](./CHANGE_AUDIT_2026-08-12_TO_14.md#alembic-route-upgrade-data-path).

### `RATE_LIMIT_ENABLED` is enforced (2026-08-01)

The flag previously gated nothing. Production and staging now refuse to start
with it disabled, since turning it off removes brute-force protection from
every authentication and public endpoint at once.

## Changes you will notice after an upgrade

Newest first. Nothing here blocks a restart — these are changes an operator
should not have to discover by being surprised.

### Document folders open to module rights; who sees what changes (2026-10-09)

Phase 3 of the file-storage hardening (`docs/FILE_STORAGE_HARDENING.md`).
Nothing here stops the stack from starting, but people will find folders
appear and disappear, so tell the department before you upgrade.

**Only a full administrator (`*`) still sees every folder.** Holding
`documents.manage` or `members.manage` no longer opens everything. Browsing
Documents still needs `documents.view`; on top of that, a folder now asks for
its module's rights. Computed from the seeded positions alone — a member who
also holds the **Member** position (every member does, by default) keeps
`training.view` and `events.view` from it:

| Folder                              | Opens to (any one)                                     | Changes, seeded positions on their own                                                                                                                                                                                                                                             |
| ----------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apparatus Files                     | `apparatus.view`, `apparatus.edit`, `apparatus.manage` | Gained by lieutenant, engineer and training officer. Lost by treasurer, historian, compliance officer and assistant secretary. The apparatus officer and quartermaster have no `documents.view`; they reach vehicle files on the apparatus screens, which now upload and open them |
| Training Materials                  | `training.view`, `training.manage`                     | Lost by treasurer, board of directors, communications officer, historian, fundraising chair and assistant secretary, unless they also hold Member                                                                                                                                  |
| Event Attachments                   | `events.view`, `events.edit`, `events.manage`          | Lost by treasurer and board of directors, unless they also hold Member                                                                                                                                                                                                             |
| Member Separations                  | `members.manage`                                       | Lost by treasurer, historian, safety officer and compliance officer                                                                                                                                                                                                                |
| Finance (new), with Receipts        | `finance.view`, `finance.manage`, `finance.approve`    | Opens to the treasurer. A member opens their own receipt from the purchase request or expense report, not from Documents                                                                                                                                                           |
| A member's personal folder          | that member                                            | Lost by captains, chiefs, president, vice president, secretaries, membership coordinator and every other `members.manage` or `documents.manage` holder                                                                                                                             |
| A custom "leadership only" folder   | `documents.manage`                                     | Lost by `members.manage` holders without `documents.manage`                                                                                                                                                                                                                        |
| A custom folder restricted to roles | holders of those roles                                 | `documents.manage` no longer passes the role check                                                                                                                                                                                                                                 |

Changing what is in a module folder (upload, move, rename, delete through
Documents) still needs `documents.manage` **and** a non-view right from that
folder's list. Facility folders are unchanged.

**Apparatus files and finance receipts are uploaded, not typed:**

- `POST /apparatus/{id}/photos` and `/documents` no longer accept a URL in
  `file_path`; it must be `document:<id>` of a stored document, or use the new
  `.../photos/upload` and `.../documents/upload`. Rows already on file keep
  their link; responses now carry `fileUrl`, which is the link only if it is
  HTTP(S). A stored `javascript:` or other value is no longer handed to the
  page.
- `receipt_url` on purchase requests and expense lines must be an HTTP(S)
  URL; anything else is a 422. Existing values that are not are withheld from
  responses, and left in the database untouched.

**Migrations.** `b38df38d849b` stamps the rights onto each department's
existing system folders, `6c25b7d68965` adds `document_id` to apparatus
photos and documents, `c0bf0b155719` adds `receipt_document_id` to purchase
requests and expense lines. All three run on `alembic upgrade head` and are
reversible: `alembic downgrade c62a98b47406`, then redeploy the previous
image. Downgrading closes the Finance folder to leadership-only (the earlier
code has no finance gate) and drops the receipt and apparatus links; the
uploaded files remain in Documents.

### Every upload is malware-scanned, and the scanner starts with the stack (2026-10-08)

Phase 2 of the file-storage hardening (`docs/FILE_STORAGE_HARDENING.md`).

- **A ClamAV container now starts with everything else.** `docker compose up
-d` pulls `clamav/clamav-debian:1.4.3` (multi-arch — ARM hosts included) and
  `CLAMAV_ENABLED` now defaults to `true`. **Budget roughly 1.5–3 GB of extra
  RAM.** On first start clamd spends a few minutes downloading signatures;
  until it is healthy, **uploads are refused** with a retryable 503
  (`LB-UPLD-005`). The rest of the application works meanwhile.
- **If the scanner is not running, uploads are refused** — by design (fail
  closed). That bites a deployment built from its own compose file or run with
  `--scale clamav=0`: add the `clamav` service, or point `CLAMAV_HOST` at a
  clamd you run, with `StreamMaxLength` of at least 60M.
- **A `.env` that already says `CLAMAV_ENABLED=false` keeps scanning off** —
  the upgrade does not override it. Files are then accepted unscanned, and you
  will see a `WARNING: CLAMAV_ENABLED is false` line in the startup log and in
  `python -m app.preflight`, and every administrator with `settings.manage`
  sees a red notice in the app until it is turned back on.
- **Small hosts.** The `minimal` profile's floor is now about 3 GB: ClamAV is
  required on every profile, and on a 1–2 GB host it is killed for memory,
  after which uploads are refused. The installer warns below 3 GB.
- **Scanning now covers every upload**, not just self-reported certificates:
  documents, all attachments, applicant files, email-template attachments,
  suggestion screenshots, member photos, logos, storefront and equipment-check
  photos, and every CSV import. Files already stored are not rescanned.
- **New uploads use a new folder layout**:
  `/app/uploads/<organization_id>/<area>/<record_id>/<uuid><ext>`. Existing
  files keep working where they are. To move them, run (dry run first — it
  changes nothing without `--apply`):

  ```bash
  docker exec -it intranet-backend python scripts/relocate_uploads.py
  docker exec -it intranet-backend python scripts/relocate_uploads.py --apply
  # check the app, then delete the old copies:
  docker exec -it intranet-backend python scripts/relocate_uploads.py \
      --finalize /app/uploads/.relocation/relocation-<stamp>.json
  ```

  `--apply` copies and checksum-verifies every file and keeps the originals;
  `--rollback <manifest>` undoes it until you finalize. Disk use doubles for
  the moved files until `--finalize`.

- **Downloads have descriptive names**, built from the record:
  `2026-10-08_Smith-John_EMT-Recertification.pdf` for a training certificate
  (member name, last name first), the event date and title for an event
  attachment, the date and name for a document. Emailed template attachments
  reach recipients under the name they were uploaded with, not a UUID.
- **Smaller behaviour changes:** an email-template attachment that is too large
  is now refused with 400 rather than 413, like every other upload; a training
  history CSV that is not UTF-8 is decoded as Latin-1 as intended instead of
  being reported as "exceeds the 10MB limit".

### Uploaded files: tighter access, and email attachments move onto the uploads volume (2026-10-08)

Phase 1 of the file-storage hardening (`docs/FILE_STORAGE_HARDENING.md`).

- **Email-template attachments now persist.** They were written to
  `/app/storage/email_attachments`, which no compose file mounts, so every
  container rebuild lost them and backups never included them. New uploads go
  to `/app/uploads/email-attachments/<org_id>/`, and migration `2be075025403`
  moves the files that still exist (copy, checksum, rename, then remove the
  original; safe to re-run). **Attachments already lost to an earlier rebuild
  cannot be recovered** — they still list on the template but are skipped when
  the email is sent, exactly as before. Re-upload them. A file the migration
  cannot move is logged (`Email attachment relocation …`) and stays sendable
  from its old location.
- **Event attachments need `events.view`** to list or download (or
  `events.manage`), and a draft event's attachments are visible to organizers
  only. Every seeded rank carries `events.view`, so only a member with a
  custom position and no rank can lose access.
- **Equipment-check photos** can only be added by the member who performed
  the check, or by holders of `inventory.check_manage`.
- **Training-record, self-reported certificate, applicant and document files**
  are now served and deleted only from inside their own organization's
  directory. Nothing moves; every file the application wrote is already there.
- **Event and email-template uploads** whose extension disagrees with the
  file's contents (a PDF named `.png`) are refused, and the stored type is the
  detected one rather than the browser's claim.

The migration's downgrade moves relocated email attachments back to the old,
unpersisted path.

### A locked fiscal year's budget amounts are frozen (2026-10-08)

`PUT /finance/budgets/{id}` that **changes** `amountBudgeted` on a line in a
**locked** fiscal year is now refused with 400 "This fiscal year is locked.
Budget amounts can no longer be changed or amended." It used to succeed, though
the training guide already called a locked year read-only. Notes, station and
owner still save, as does a request that sends the unchanged amount. An
integration that adjusts locked-year amounts through the API will start getting
the 400.

The same upgrade adds **budget amendments** — logged increases to a line, with
who approved them and when (Finance › Budgets › a line › **Add amendment**).
Migration `ca564ba5a9ad` creates the `budget_amendments` table on an
installation that has a `budgets` table; one that does not yet gets it from
`create_all` with the rest of the finance tables. Existing lines are untouched
and report their current amount as their original until amended.

### The QuickBooks export is a journal-entry import, and needs accounts first (2026-10-08)

`POST /finance/export/transactions` now produces a file QuickBooks Online's
**Journal Entries** import accepts. Before this, every row had an empty
Account and a debit with no matching credit, so QuickBooks rejected the file.

- **New columns:** `Journal No, Journal Date, Memo, Account Name, Debits,
Credits, Description`. Each transaction is two lines (two per expense line on
  an expense report) under one Journal No: a debit to the category's account
  and a credit to the account it was paid from. Update anything that reads the
  old `Date, Type, Num, Name, Memo, Account, Debit, Credit` header.
- **Journal No is the request number** (`PR-…`, `CR-…`, `ER-…`). A check's
  number moves into Description.
- **The export now refuses** (HTTP 400, naming what to fix) when any
  transaction in the range has no budget line, or its budget category has no
  QuickBooks account, or no **offset account**. The account comes from the
  category's `qb_account_name`, or else from the export mapping whose
  `internal_category` matches the category name. The offset account comes only
  from that mapping's new `qbOffsetAccountName` field. Nothing is backfilled,
  so **existing installations must set offset accounts before their next
  export**, on **Finance › QuickBooks Export** (`/finance/settings/quickbooks`,
  added 2026-10-09), which lists each budget category and what it is missing.
- A migration adds the nullable `finance_export_mappings.qb_offset_account_name`
  column. Its downgrade drops the column and the values stored in it.

### Training provider imports credit members automatically (2026-10-08)

A **Target Solutions** sync or report upload now credits matched members as it
stages them; completions that match nobody wait under **Imports**. Vector
Solutions, Lexipol, iAmResponding and Custom API keep the officer's review step
until each is reviewed (the list is `AUTO_CREDIT_PROVIDERS` in
`external_training_service.py`). The Import and Bulk Import buttons now honour
the category and credit hours the officer chose.

Five migrations land after head `8c4f2a6e1d93`, ending at `7db20aa49329`:

- `9bb4af123ebc` makes `(provider_id, external_record_id)` unique on staged
  imports. Existing duplicates are settled first and **nothing is deleted**: the
  imported row (else the earliest) is kept; others get `#dup:<id>` on their
  record id and, if never imported, status `duplicate`. The downgrade restores
  them exactly.
- `6cf89b44dc08` adds the `policy_acknowledgment` training type.
- `95dbdfb6591d` creates `external_course_mappings`, seeded with unmapped rows;
  nobody is emailed and nothing is mapped until an officer does it. Downgrading
  loses the mappings.
- `26ca07c56d0f` adds `voided_at`, `voided_by`, `void_reason` to training records.

**Check after upgrading:** the HIPAA, Bloodborne Pathogens and Hazmat requirement
templates now create **Courses** requirements. Existing requirements are not
rewritten; an hours requirement with one of those codes and no category or course
scope shows a warning on its card. Fix them in **Training Admin › Requirements**.

### Every member can raise their own finance requests (2026-10-07)

A new permission, **`finance.request`** — "Create, submit and track your own
purchase requests, expense reports and check requests" — is **granted to every
member** by this upgrade. Migration `7db20aa49329` adds it to each
department's seeded **Member** position, which every member holds; a position
your department created is not touched. Until now raising a request
needed `finance.manage`, so only the Treasurer and the IT Manager could.

What a member can do with it, and nothing more:

- raise a purchase request, expense report or check request, edit it until it
  is submitted, submit it, and withdraw it while it is still a draft;
- see **only the requests they raised** — another member's is "not found";
- pick a budget line by its name and the amount left on it, without seeing
  the budget pages.

Requests from members go through your approval chains like any other, and
nobody can approve or pay their own. A new **Finance** entry appears in the
navigation when the module is on; a member sees **My Purchase Requests**,
**My Expense Reports** and **My Check Requests** under it.

Two smaller changes come with it. A holder of `finance.view` alone still reads
every purchase and check request but is no longer offered the New / Edit
forms, which it could never save. And the Mark Ordered / Received / Paid,
Issue Check and Void buttons are now shown only to `finance.manage` holders,
who were the only people the server ever accepted them from.

**If your department does not want members raising requests**, remove
`finance.request` from the **Member** position on the positions screen. It is
not a rank default, so that one edit withdraws it from everybody who holds it
only through Member. Downgrading past this revision removes it from the seeded
Member positions.

### Member badges carry a server-issued code; old badges keep scanning until you turn them off (2026-10-05)

Migration `ad3b979746f1` adds `users.badge_code` and gives **every existing
member** a random code such as `MB-7KQ2W9HXRT` (unique per organization; new
members get one by default). Labels, CR80 ID cards and the digital ID card now
encode that code instead of the membership number or short member id, which any
member could read in the directory.

- **Nothing stops working on upgrade.** Both scanners resolve through
  `POST /member-badges/resolve`, which still accepts the membership number, the
  short id and the old phone-card QR until an officer turns **Accept old badges**
  off (Members → select → **Print ID Cards**, switch at the bottom). Absent means
  accepted. Turn it off only after every member holds a reprinted card; it stops
  every pre-badge-code card at every station and the inventory issue-by-badge
  scanner.
- **A badge printed after the upgrade is only as good as the code.** **Reissue
  badge** on a member's ID card page cancels a lost badge and prints a new code.
  The code is shown only to the member and to `members.manage` /
  `members.manage_id_cards` holders, and is not in rosters, profile responses,
  exports or anonymized records.
- Scripts or integrations that built a badge from the membership number must
  fetch the code (`GET /member-badges/{id}`) or keep Accept old badges on.
- Rollback: the downgrade drops the column, and badges printed with a code stop
  scanning on a version below this one.

### Training and compliance figures move (2026-10-05)

Nothing blocks a restart, but percentages a department already published or
reads on the dashboard can change. Check them after the upgrade.

- **Certification name matching is now legacy-only** (`60aaf273de27`). A
  completed record whose course name merely contained a certification
  requirement's name (a "CPR Refresher" crediting "CPR") used to count.
  The migration sets `training_requirements.name_match_until` on every
  requirement that exists to **the day it runs (UTC)**: records completed on or
  before it still match by name, so published standings do not move on upgrade
  day. From then on a record needs a linked course, the training type or the
  registry code. Requirements created afterwards, and every requirement on a fresh
  install, never match by name. Downgrade drops the column and every record name-
  matches again.
- **Required roles match the member's rank.** `required_roles` holds rank slugs,
  but every screen compared it with position ids, so a requirement scoped only by
  role applied to nobody. It now grades the members of those ranks on My
  Training, the matrix, the dashboard percentage, the roster, the profile card,
  the competency matrix, the annual report and Scheduling's Shift Compliance
  report: **their standings, and the department percentages that include them,
  move.** Stored values were already rank slugs; there is no data migration.
  Compliance-profile `role_ids` are unchanged (position ids).
- **One definition of who is graded.** The dashboard's Department Compliance
  card and the annual and monthly compliance reports now use compliance profiles
  (narrowed requirement lists, threshold overrides) and the org's own thresholds,
  as the matrix always did. Departments with profiles, or a compliant threshold
  under 100%, see those figures change; **stored annual reports keep the
  figures they were generated with.**
- **Members nothing grades are "not applicable", not 100%.** A member with no
  applicable requirement (none applies, a profile selects none, or all are in
  catch-up) used to count as compliant at 100% and now shows N/A and leaves every
  percentage's denominator. Percentages can fall for a department with many
  such members, and read blank when nobody is graded. A compliance attestation
  records the server's figure as of the period's last day, not a typed one.
- **Shift Compliance grades only shift-credited requirements** (`f16b004db34e`).
  A SHIFTS requirement is shift-credited by default (existing ones are
  backfilled); an HOURS requirement is not. **Every existing HOURS requirement
  drops off Scheduling Reports → Shift Compliance until an officer ticks Shift
  Credit** on it. The cards are now Requirement Checks, Checks Met and Checks Not
  Met; the numbers are unchanged. Downgrade drops the column.
- **Skills testing:** `GET /training/skills-testing/tests` returns
  `{ items, total }` (it was a bare list), and the CSV export needs `date_from`
  and `date_to` at most 366 days apart. `GET /training/records` is paged
  (limit 500, `X-Total-Count`). Scripts reading these must page.

### Self-reported certificate files can now expire — default is keep (2026-10-05)

`cdb725bb1d12` adds `self_report_configs.attachment_retention_days`. **NULL, the
default, keeps files indefinitely and nothing is backfilled, so an upgrade
deletes nothing.** When a department sets a period (Review Submissions →
Settings → Certificate Files; 90 days minimum), the daily
`self_report_attachment_retention` task **permanently deletes** the certificate
files of submissions decided longer ago than that, and removes the references
from the submission and the member's training records; the rows stay. It is not
reversible — back up first, and set the period only after the department's
records policy says so. Audited as `self_report_attachment_retention` per
organization run and `self_report_attachment_retention_updated` per change.

### Proxy per-address limits are sized for a department (2026-10-05)

The bundled nginx configs (`infrastructure/nginx/nginx.conf` and `docker.conf`)
allowed 10 concurrent requests per address and 10 API requests a second (burst
20, refused beyond it). Under HTTP/2 every in-flight request counts, and one
dashboard load is about 20 API calls, so one member could lose most of a page to
503, and a station whose members share one public address lost most requests.
Now `limit_conn 400` and the API zone at **50/s with `burst=600 delay=100`** (the
first 100 requests of a burst pass at once, the rest queue at 50/s rather than
being refused). The sign-in limits (`login_limit`, 5 a minute, burst 3, and the
backend's `rate_limit_login`) are **unchanged** brute-force controls. **A reverse
proxy you run yourself keeps whatever limits it was given:** raise its per-address
connection and rate limits the same way, or a station sees 503 at shift change.
No migration; a container rebuild or `nginx -s reload` picks the bundled change
up.

### Events: finalized events can be edited; series saves are checked per occurrence (2026-10-06)

A **finalized** event can be saved from the edit form: the attendance lock now
refuses a changed value of a locked field (type, category, start, end, check-in
rules), not the mere presence of one, and the form disables those fields with an
explanation. **This and all future events** is decided per finalized later
occurrence and now refuses with "(N of M finalized occurrences would change)"
(it used to count every occurrence in the series). A description-only series edit
from an open occurrence is refused when a finalized later occurrence differs in
type, **category** or check-in rules; the category part is new. A series save no
longer copies the edited occurrence's `attendance_finalized`, `reminders_sent`
and `validation_notification_sent` markers onto later occurrences. No migration;
an occurrence a previous series save wrongly marked finalized or unmarked is not
repaired.

### Smaller behaviour changes in this release (2026-10-05)

- **Rank vocabulary.** Once a department has any rank rows, the built-in rank
  codes (`firefighter`, …) are no longer accepted for a _new_ assignment by the
  member API, CSV import or prospect conversion unless the department's own
  ladder has that rung (ONBOARD-3); members already holding one keep their
  seats. A department that deleted a seeded rank during setup and still imports
  members with it must re-add the rung first.
- **Two-way shift exchanges** need both members cleared for the seat they would
  take; an unqualified exchange is refused when submitted. A request that lapsed
  while pending is refused at approval with `LB-SCHED-002`, and a duty officer can
  **Approve anyway** (audited).
- **Alert email wording and subjects changed.** Low stock says "at or below
  reorder point"; the certification alert subject reads "Expires Today" /
  "Expires Tomorrow" (it read "Expiring in 0 Days"); the weekly supply alert is
  "Supplies to Replace" with a Status column; the NFPA alert says "approaching or
  past". Five more emails (property return reminder, member-dropped notice,
  election results, low stock, NFPA retirement) were reflowed to fit phones. A
  mail rule that filters on an old subject needs updating.
- **Sessions survive a two-tab refresh.** A refresh that loses a rotation race is
  answered 409 `LB-AUTH-012` and revokes nothing; it no longer logs the member out
  everywhere. A refresh arriving after the first has committed is still treated
  as replay.
- **Sign-out is confirmed.** A failed sign-out is retried and then blocks the
  screen until the server confirms; offline queue entries are owned by the member
  who queued them, and entries from before the upgrade are held behind **Send as
  me** / **Discard**.
- **Scheduled-task failures** now appear on Error Monitoring ("Scheduled task"),
  so a department that never saw them may suddenly see a backlog of recurring
  ones. The end-of-shift summary is retried until its email is sent.
- **Integrations.** Every integration sender (teams, webhook, slack, discord,
  calcom, documenso, audit shipping) resolves the destination once and connects
  to that address; DNS rebinding between check and connect no longer works.
  `AUDIT_SHIP_ALLOW_PRIVATE_DESTINATION` still lifts the public-address rule only.
  Proxy-mounted clients are not pinned (KNOWN_LIMITATIONS). Google Calendar
  responses are capped at 10 MB with 5 s connect and 10 s socket timeouts.
- **Migrations `99b16109d44c`** resets stale `in_progress` prospect stage rows
  that sit ahead of the applicant's current stage (idempotent, logs the count,
  **no downgrade effect**), **`d4d0a483cdd5`** adds cohort missed-class decisions
  (downgrade drops the table and loses every decision) and **`c56303befb2c`**
  adds indexed `document_id` columns to facility documents and photos and two
  folder indexes (backfilled from `file_path`; downgrade drops them). `15802f3df5c4`
  is a no-op merge. The chain has a single head.

### Finance approvals now go to the approver each step names (2026-10-04)

Until this release an approval chain step's approver — "Treasurer position",
"members with finance.manage", a named member, an email address — was a label.
Anyone holding `finance.approve` could approve or deny any step, whatever it
named. **From this release only the named approver can.** There is no setting
to turn it off and no migration; the rule applies to requests already waiting.

- A step with **no approver** set still takes any `finance.approve` holder,
  exactly as before.
- A **position** step takes active members holding that position; a
  **permission** step takes active members granted that permission (an
  administrator holding `*` included); a **member** step takes that member; an
  **email** step takes the member with that account email, or the outside
  approver through the emailed link.
- Somebody holding `finance.configure_approvals` — the Treasurer, since
  2026-09-06 — can still approve or deny a step they are not named on by
  giving an **override reason**. It is written to the audit log at warning
  severity. It does not let anyone approve their own request.
- An emailed approval link stops working if its step has since been changed
  away from an email approver.
- The Approvals page lists only the steps the viewer can act on (plus, for an
  approvals administrator, the rest, marked as needing an override). The
  dashboard's pending-approvals count is unchanged and still counts every
  waiting request.

**What to check, before and after upgrading.** A step that names a position
nobody active holds, a member who has left, a permission nobody has or a
mistyped value now leaves its requests waiting with nobody able to act. Open
**Finance → Settings → Approval Chains** and confirm every approval step names
somebody who is still there. After upgrading,
`GET /api/v1/finance/approval-chains/approver-coverage` (needs
`finance.configure_approvals`) lists every approval step with how many active
members can act on it, a `problem` when none can (`no_value`, `not_found`,
`no_active_members`, `invalid_email`), and how many requests are waiting on it
now. Fix each flagged step, or have an approvals administrator act on the
waiting requests with an override reason in the meantime.

Saving a step now also checks its approver: a position must exist in the
department, a member must be active, a permission must be a real permission
name (`*` is allowed, a module wildcard like `finance.*` is not), and an email
step takes exactly one address. A step saved before this release keeps
working and can still be renamed; changing its approver re-checks it.

### A reverse proxy you run yourself keeps its own upload limit (2026-09-30)

The bundled proxies — the frontend container's nginx, the `production`
profile's nginx and the host-nginx site file — now all allow **60 MB**
uploads; the frontend's nginx had nginx's 1 MB default, which refused any
larger upload before it reached the application. A proxy you run yourself
(Nginx Proxy Manager, SWAG, a host nginx with your own config, a cloud load
balancer) keeps whatever limit it was given: **raise its body-size limit to at
least 60 MB** (`client_max_body_size 60M;` for nginx), or larger uploads are
still refused with 413.

### A malformed Host header is answered with 400 (2026-09-24)

Starlette 1.7.0 tightens the Host-header allowlist: wherever it is active
(`TRUSTED_HOSTS` set, or derived from `ALLOWED_ORIGINS` in production), a
request with a missing or malformed `Host` header now receives **400**. Make
sure health checks and any external proxy send the real hostname. CORS
responses now always carry `Vary: Origin`.

### Steps in this release that do not reverse (2026-09-24 – 2026-10-04)

Read this before planning a rollback past this release; the
[back-up-first](#before-every-upgrade-back-up-and-do-not-downgrade-to-fix-a-fork)
rule applies with more force than usual.

- **No downgrade at all:** `b795d1b3401b` (untouched email templates moved to
  the then-current default) and `6394fbf42581` (clears the duplicate-vote hash
  on voided ballots so the member can vote again — irreversible by design).
- **Downgrade loses data:** `34d3d56d1479` (every preferred name entered), `d4d0a483cdd5` (every cohort missed-class decision; 2026-10-05), `cdb725bb1d12` (every department's chosen certificate-file retention period), the inventory NFC revisions `b713c2e8ee26`
  (storage-area tags and every recorded scan), `7ad83f52735c` (shelf audits)
  and `45b36bae9098` (compartment tags), and the suggestion-box revisions
  `0010291816fd` (status history and responses to submitters) and
  `e79309de6735` (idea-board publishing and votes).
- **Downgrade restores from a backup table:** `15c5bc7700aa` (the email
  template reset) puts each template back from `email_template_backups`.

### Preferred names, department-only shift-report totals and one call-type list (2026-10-04)

Three migrations run on the next `alembic upgrade head`; all are safe on a
populated database and none needs a maintenance window.

- **`34d3d56d1479` adds `users.preferred_name`** (nullable, idempotent). NULL
  means the member goes by their first name, so every member renders as before
  until someone sets one. Everyday screens show the preferred name; reports,
  exports, training records, certificates, ballots, legal documents, signed
  forms, property custody and the audit log keep the legal first name. If your
  own scripts or integrations read `full_name` from the API it is unchanged and
  still the legal name; `display_name` and `preferred_name` are new fields beside
  it. Anonymizing a member now clears the preferred name.
- **`84819ea78a79` grants the new `training.view_analytics`** to seeded
  leadership positions (Chief, Deputy Chief, Assistant Chief, President,
  Training Officer) **that still hold `training.manage`**. The _Written by me_
  shift-report panel used to total every officer's reports for anyone with
  `training.manage`; it now shows the caller's own by default and the
  **Department** view needs the new permission. A position a department created
  itself, or one that had `training.manage` taken away, is not given it — grant
  it by hand if a captain-level role should see department totals. A script
  calling `GET /training/shift-reports/officer-analytics` with no `scope` now gets
  the caller's own figures, not the department's.
- **`edf608b5a8ea` folds each department's free-text shift-report call types**
  into its one call-type list (Scheduling → Settings → General). Entries already
  named by slug or label are skipped; new ones become active types, up to the
  list's cap of 50 (the old column is left intact). Training requirements that
  held call-type text now match through the department list, so a requirement
  naming `mva` will start crediting reports that list _Motor Vehicle Accident_.
  Percentages for call-type requirements can rise once.

Rollback: `84819ea78a79` and `edf608b5a8ea` reverse cleanly (the second removes
only the entries it added, and only while the department has not re-saved its
call types); **`34d3d56d1479` drops the column and discards any preferred names
entered since.**

### Requirements tagged with two or more categories were never credited — repair is manual (2026-10-04)

A training requirement linked to more than one **training category** did not
advance from a finalized training session or an imported external completion:
the match was a text search against the stored list, which only found a
requirement whose sole category was the one completed. The record was written and
general hours counted, but the pipeline requirement stayed where it was, with no
error. The query is fixed, so **new** completions credit correctly after the
upgrade. Credit already missed is **not** repaired automatically.

To see what would be repaired, then repair it (run once per deployment, after
upgrading):

```bash
docker exec -it intranet-backend python scripts/backfill_category_requirement_credit.py
docker exec -it intranet-backend python scripts/backfill_category_requirement_credit.py --apply
```

The first command is a dry run and writes nothing. `--apply` writes a rollback
file; `--restore FILE` reverses exactly what that run credited. It is idempotent,
org-scoped, audit-logged and sends no email, SMS or push, so a department will
not receive months of notifications. Member percentages and pipeline phases
move once, upward. `GET /training/requirements?position=` also treated `%` and
`_` in the filter as wildcards; it no longer does.

### Scheduled reminders no longer duplicate across workers (2026-10-04)

A worker whose scheduler claim had lapsed could take it back without learning
another worker held it, so on a multi-worker deployment two or more workers ran
every scheduled task (event and shift reminders, certification-expiry and
inactivity alerts) and members received them more than once. Renewal is now
conditional on still holding the claim (CRON-40). Nothing to configure. If you
saw duplicate reminders, they should stop after the restart.

### Probationary and junior members can sign in and be scheduled (2026-10-03)

A member whose status is **Probationary** — which includes every junior
member, whose membership type derives to it — used to be refused at sign-in
with "Account is inactive. Please contact an administrator.", and an officer
adding one to a shift was told the member "is no longer active in this
organization". Probationary now counts as an active account everywhere the
application asks whether an account is active (`ACTIVE_ACCOUNT_STATUSES` in
`models/user.py`).

After upgrading, those members can sign in, sign themselves up for open
shifts, and appear on the platoon roster, the availability summary and the
shift compliance report. **A department that does not want probationary
members signing themselves up for shifts** should add the membership type to
**Excluded from Self-Signup** in Scheduling's **Eligibility** settings —
account status is not the lever for that
policy. **If you kept a Probationary account from signing in on purpose,
it can sign in after this upgrade:** set it to Inactive or Suspended instead. About forty other screens (training compliance, rosters, quorum and
others) still count only fully active members; that is recorded as an open
decision, not a defect.

### Training requirements can exempt existing members (2026-10-03)

Migration `d058b5e7c1f4` adds three nullable date columns for it. Every
requirement keeps today's behaviour until someone sets a cutoff, so nothing
changes at upgrade. Two things do, for every department: the dashboard,
Compliance Matrix and member status now **honour role-scoped requirements**
(My Training always did), and the compliance exports and forecast print **N/A**
where a requirement does not apply to a member, rather than grading them
against it. Expect some percentages to move once.

### Seeded positions gain checklist, NFC-tag and ID-card grants (2026-09-30, 2026-10-02)

Two migrations **add** grants to the seeded positions already stored. Each is
gated on evidence that the row is still the department's seeded position, so a
position your department created, emptied, or re-purposed is left alone.

| Migration      | Position                                                        | Gains                                                       | Only while the row                       |
| -------------- | --------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------- |
| `f73b449bdb8b` | Quartermaster                                                   | `inventory.check_manage` (build equipment checklists)       | still holds `inventory.manage`           |
| `5bed4c485d2f` | President, Vice President, Chief, Deputy Chief, Assistant Chief | `apparatus.manage_nfc_tags` and `locations.manage_nfc_tags` | is not empty                             |
| `5bed4c485d2f` | Apparatus Officer                                               | `apparatus.manage_nfc_tags`                                 | is not empty                             |
| `5bed4c485d2f` | Facilities Manager                                              | `locations.manage_nfc_tags`                                 | is not empty                             |
| `5bed4c485d2f` | Assistant Membership Coordinator                                | `members.manage_id_cards`                                   | still holds `prospective_members.manage` |

The two NFC grants are new and only decide who the application **offers** the
tag writer to. `members.manage_id_cards` is not new: the Assistant Membership
Coordinator who gains it can issue and revoke ID cards and open other
members' cards. Remove any of these on the positions screen if your
department assigns that work differently. Downgrading either revision revokes
the grant from the same rows, including one added by hand afterwards.

### Only badge officers can open another member's ID card (2026-09-30)

The **ID Card** button on a colleague's profile, and the card page itself, now
require `members.manage` or `members.manage_id_cards` when the card is not
your own. A member keeps their own card. Positions holding only `members.view`
lose the button on other members' profiles; grant `members.manage_id_cards` to
anyone who prints or checks badges for others. Printing member badges
(**Print Badges** on the member list, `/members/print-labels`, and the label
API's `membership` module) follows the same rule from 2026-10-04: a position
holding only `members.view` can no longer print them, and a script calling
`/api/v1/labels/*` with `module: "membership"` as such a member now receives 403.

### Close any election that is OPEN before you upgrade (2026-09-30)

Do not upgrade over an election whose status is **Open**. Close it first, or
wait until it has closed, and do not open a new one until the upgrade is
done.

This release changes how a vote on a **ballot-item** election (a motion, an
Approve/Deny question, an officer seat set up as a ballot item rather than a
plain position) is stored and recognised as a duplicate. A vote cast from the
signed-in ballot before the upgrade carries no position; one cast after it
carries the ballot item's id, and the emailed-link route keys the same vote by
a hash of that id. The two shapes do not match each other, so a member who
voted in-app before the upgrade could vote once more on the same item
afterwards — from the app, from their emailed link, or through a proxy — and
both votes would count. Turnout on that election may also count such a member
twice.

Votes already stored are not rewritten: a closed election's tally is a
certified record and is left exactly as it was. An election that is still in
**Draft** or **Nominations** has no votes and is unaffected. Only an election
that is accepting votes across the deploy is exposed, which is why the
instruction is simply to close it, or not to upgrade until it has closed.

### An applicant on an Election Vote stage needs an election package to advance (2026-09-30)

An applicant is no longer advanced off an **Election Vote** stage, or
converted from one, until an election package exists for them. Packages are
now created by the server whenever an applicant reaches the stage by any path
— single or bulk Advance, Skip, Back, placing them on the stage, or a deleted
stage's fallback. Before, only a single Advance click in the browser created
one, so applicants who arrived any other way never appeared among the packages
waiting for a ballot.

**Applicants already sitting on a vote stage without a package are refused on
Advance** after the upgrade. Open each one and press **Create Package** in the
drawer's election package section. Draft and ready packages advance as before,
so a department that votes at a meeting and records the result by hand is not
held to a ballot. Pipelines with no vote stage are unaffected. No migration.

### Anonymous suggestions are no longer written to request logs — check your own proxy (2026-09-30)

Submitting to a suggestion box and following up with a key
(`/api/v1/suggestions/boxes/<id>/submissions`, `/api/v1/suggestions/follow-up/…`)
are no longer logged as requests anywhere The Logbook controls: the bundled
nginx configs (`frontend/nginx.conf`, `infrastructure/nginx/nginx.conf`) leave
out the access-log line and log only critical errors for them, uvicorn's access
log and the backend's IP logging skip them, and a failure on them no longer
appears on **Error Monitoring**. A log line holding the client's IP and the
exact second would show who made an anonymous submission.

**A reverse proxy of your own still records them** — a host nginx, SWAG, Nginx
Proxy Manager, a cloud load balancer's access logs, Cloudflare. Add the
`map $request_uri $access_loggable { … }` block shown in
[`deployment/aws.md`](./deployment/aws.md) and put `if=$access_loggable` on
that proxy's `access_log`, or the equivalent in your proxy. If you copied and
edited `infrastructure/nginx/nginx.conf`, merge in the new map, the
`if=$access_loggable` and the nested location that sets `error_log … crit`.

What you give up: a failed or rate-limited anonymous submission leaves no proxy
log line and no Error Monitoring row. The backend's own log still records the
failure with the route and time, without a user or IP.

### Purge Selected now deletes; Auto-Purge still does not (2026-09-30)

**Purge Selected** on the **Inactive Applications** tab used to delete nothing
— it matched withdrawn applications instead of inactive ones — while reporting
"Purged N". It now permanently deletes the selected applications that are still
inactive, removes their uploaded documents from the server, and records the
purge in the audit log (count and ids only); the message reports how many were
really deleted. Withdrawn, rejected and on-hold applications are never purged.
The pipeline's **Auto-Purge** setting is still stored but nothing reads it, so
no application is ever deleted automatically.

### Each pipeline decides what a converted applicant becomes (2026-09-30)

Migration `601fdb28ab8c` adds **When an Applicant Becomes a Member** to
Pipeline Settings: a **Member class** and **Starting status** for operational
applicants and another for administrative applicants. Until you save it, a
pipeline uses the defaults — operational applicants become probationary
operational members, administrative applicants regular administrative members —
which is what the Convert dialog already produced, so manual conversions are
unchanged. In **Convert to Member** the **Membership Type** buttons are replaced
by **Member class** and **Starting status**, pre-filled from the setting and
changeable for one applicant.

**The automatic conversion at a pipeline's final stage now follows the same
setting.** It used to make every applicant a probationary operational member,
administrative applicants included. A downgrade drops the setting.

### Training credit from an event: finalizing writes the records, and approving needs `training.manage` (2026-09-29)

Finalizing a **Training** event's attendance now completes the training credit
and links each record to the event it came from (`training_records.source_event_id`,
migration `2b15c5a8ba82`). Approving that credit through the emailed link
(`/training/approve/:token`) now requires **`training.manage`**, as viewing the
roster already did; it used to require `events.manage`, so a position holding
only `events.manage` can no longer complete an approval. Training events also
stop crediting administrative hours.

**Nothing is backfilled.** A past event credits its attendees only if it is
reopened and finalized again. Reversing `2b15c5a8ba82` drops the links.

### Re-enter Target Solutions credentials (2026-09-29)

A **Target Solutions** provider on the **External Training Integrations** page now
reads Target Solutions' Training Records API and matches members by email. It
needs both an **API key** and an **API secret**: a provider saved before this
upgrade fails every connection test and sync with "Target Solutions API key
and secret are both required" until both are entered. Syncs then run hourly,
with a daily review of the previous 30 days.

### A target role chosen before this upgrade is not applied by automatic conversion (2026-09-29)

An applicant's **target role** — the position they receive when converted —
is now held to the permission ceiling of whoever chose it (security finding
MP-31: a coordinator could otherwise convert an applicant into an
administrator account). The server records who chose each role. **A role
stored before the upgrade has no recorded chooser, so automatic conversion
skips it**: the member is created with the default position and the
applicant's activity log says a leader must assign the role. Manual
**Convert** still applies it, within the converting officer's own ceiling;
clearing and re-choosing the role records a chooser. No migration.

### The public portal's admin API requires `settings.manage` (2026-09-29)

The thirteen `/api/v1/public-portal/*` administration endpoints (API keys,
configuration, the published-fields whitelist, logs and usage) checked only
that the caller was signed in. They now require **`settings.manage`**, the same
permission the **Public Portal** screen always required. Nothing changes in the
application; **a script or integration that called these endpoints with a
plain member's credentials now receives 403** and needs an account holding
`settings.manage`.

### Refusals on finalized attendance now answer 409 (2026-09-29)

Eleven event routes that refuse a change because the event's attendance is
finalized now return **409** with one plain sentence ("Attendance for this
event has been finalized, so … is no longer available. A department leader can
reopen attendance …"). They used to return 400 or 404 with an internal
`ATTENDANCE_LOCKED::` code, or a generic error. Nothing changes in the
application; **a script or integration that matched the old status or text
should match 409.**

### A swap is cancelled when its seat goes away, and both members are emailed (2026-09-29)

A pending shift swap or seat offer is now cancelled as soon as the seat it
names is vacated: a member withdrawing or declining, an officer removing,
reassigning or cancelling the seat, the shift being cancelled, approved time
off, a leave of absence, or the same seat going to another approved swap or
accepted offer. Both members get an in-app notice and an email, "Shift swap
request cancelled", sent under the **Shift notices** email kind, so a member who
has turned those off gets only the in-app notice.

**Requests stranded before the upgrade are not swept.** Clear them from the
Requests tab by denying them, or ask the requester to cancel. In the same
release a duty officer can approve a one-way offer to a named member (the
Requests tab now reads "Offered to _name_"); approving it moves the seat to that
member, who is told in-app.

### An inventory CSV import skips negative quantities and prices (2026-09-29)

A row whose **Quantity** or **Purchase price** is below zero is now reported and
skipped — "Row 6: Quantity cannot be negative: '-3'" — while the rest of the
file imports. Before, such a row was saved, and every item list that included
it then failed with a server error, taking the Items page and item search down
for the whole department.

**Upgrading does not repair a row already stored.** If the Items page or item
search has been failing since an import, back up the database, then find the
rows:

```sql
SELECT id, organization_id, name, quantity, purchase_price
FROM inventory_items
WHERE quantity < 0 OR purchase_price < 0;
```

Set each value to the real count or price (or to 0). The list works again at
once, with no restart. If the query returns nothing, there is nothing to do.

### Meeting attendance for voting counts only meetings since the member joined, up to today (2026-09-29)

This matters only if a Membership Tier ticks **Must meet a meeting-attendance
threshold to vote**. That check used to count every meeting in the last **Over
the last (months)** — including meetings held before the member joined,
meetings held while a reinstated member was dropped, and meetings entered ahead
of time but not yet held — each as an absence. The window now runs from the
later of the look-back date and the start of the member's current stint (their
return date if they rejoined, otherwise their hire date) to the department's
today.

**Who can vote can change on upgrade, with no setting touched.** Recent hires
and departments that enter meetings in advance will usually see a higher
percentage; a member reinstated after the 2026-09-24 upgrade is judged only on
meetings since their return, which can go either way; one reinstated earlier is
still judged from their hire date until their stint is corrected on the
**Service History** card. A member with no meetings in their window reads 100%.
If an election is open across the upgrade, re-check its eligibility afterwards.
The refusal still says "over the last N months" even when a member's window is
shorter.

### Membership numbers are never reissued, and departments can set their own format (2026-09-29)

**Nothing is migrated**: stored settings keep producing numbers exactly as
before (prefix, then four digits). Three things you may notice:

- **A former member's number is kept for them.** Automatic numbering now skips
  every number any member holds or once held — archived, anonymized and
  deactivated members' included — so the counter may jump past a number you
  expected. Typing such a number on Add Member, a member's record or a
  conversion is refused with "This membership number belonged to a former
  member and is kept for them in case they return"; reactivate that member to
  give it back. Numbers already reissued before this upgrade stay with their
  current holders.
- **Add Member has one Membership Number field.** With auto-generation on,
  leave it blank and the next number is assigned; the separate override box is
  gone. With auto-generation off it is required.
- **New format options** under **Members → Administration → Settings →
  Membership IDs**: a number pattern (`{SEQ}`, `{PREFIX}`, `{YYYY}`, `{YY}`),
  minimum digits, a starting number, and an optional yearly restart on the
  calendar or a fiscal year.

### Three settings that never took effect are gone (2026-09-29)

Three controls saved a value that nothing ever read. They are removed rather
than left to suggest an effect; the stored values are kept, and no migration
runs.

- **Elections → Settings → Defaults** (voting method, victory condition, quorum,
  anonymous voting, write-ins). Each election's own form sets these. The page
  now opens on **Proxy Voting**, and an old `?tab=defaults` link lands there.
- **Public Portal → Configuration → Allowed Origins (CORS)** and **Caching.**
  Browser access to the public API has always been decided by the server's
  `ALLOWED_ORIGINS`, and the public API does not cache. If a site you listed on
  that tab cannot call the API, add it to `ALLOWED_ORIGINS`. The tab now holds
  only the default rate limit.
- **Scheduling → Settings → General → Department Defaults → Require assignment
  confirmation.** Nothing ever asked a member to confirm an assignment because
  of it.

### Waiver Management lists every leave and waiver, not just the newest 100 (2026-09-29)

**Waiver Management** and Training Admin's **Training Waivers** tab showed only
the newest 100 leaves of absence and 100 training waivers. An older leave was
missing, and its linked training waiver appeared as a standalone one;
**Deactivate** on that waiver removed it while the hidden leave stayed active and
kept excusing the member. Both screens now load everything. **If your department
has more than 100 leaves or training waivers**, open Waiver Management after
upgrading and deactivate any leave you believed you had already ended.

### Recurring events keep their local time, and series edits stop moving dates (2026-09-28)

A new recurring series is now laid out in the department's own time: a
weekly 7pm drill stays at 7pm after the clocks change, and custom weekdays,
"the 2nd Monday" patterns and dates to skip land on the department's
calendar day rather than the UTC one (which is the next day for an evening
event). The rolling 12-month extension follows the same rule.

**Edit → This and all future events** no longer copies the edited
occurrence's date onto every later one. A change to the time moves each
occurrence by the same amount; leaving the time alone leaves every date
where it was.

**Nothing already stored is changed.** Series created before this upgrade
that span a daylight-saving change, and any series edited with "This and all
future events", may have occurrences at the wrong time or on one date. Check
the department's recurring events after upgrading and fix or recreate any
that look wrong; see `docs/KNOWN_LIMITATIONS.md`.

### An applicant cannot be converted while a required stage is unfinished (2026-09-28)

**Convert to Member** used to succeed from any stage. It is now refused while
any stage marked **Required** in the applicant's pipeline is not complete, and
the refusal names the stage — for a Multi-Signer Approval stage, also the
officers who have not yet signed. The automatic conversion that follows a
pipeline's final stage is held the same way. A stage that was **skipped** does
not count as complete; optional stages never hold conversion.

Nothing is migrated, and no applicant is moved. An applicant who is already
sitting at an unsigned sign-off stage stays there until the named officers
sign. Signers do that from **Sign-offs** (linked from the dashboard's "waiting
on your sign-off" row), which lists only the applicants waiting on a role they
hold. If a pipeline has stages marked Required that your department does not
actually enforce, clear the Required flag on those stages in Pipeline Settings
rather than expecting Convert to step over them.

### Applicant badges printed before this upgrade carry the applicant's status link (2026-09-28)

Applicant labels used to encode the applicant's **status token** — the only
credential for the public status page, which can read and **withdraw** the
application. Labels now print a short record id instead (workflow review
W17-3). **Badges printed before the upgrade still carry the token: collect and
destroy them**, and reprint any you still need. The print page now also opens
for a coordinator holding only `prospective_members.manage`.

### Members are told when an equipment request is decided (2026-09-28)

A member now receives an in-app notice, a push notification where enabled and
an email when their equipment request is approved, declined or issued, through
a new **Equipment Request Update** rule (migration `fb7da5b05833`) that is on
by default. **Deny** is now **Decline**, and the quartermaster's review note is
shown to the member — write it accordingly. Switch the rule off under
notification rules if your department does not want the notices.

### The Email Notifications switch now covers every optional email (2026-09-28)

Every email the platform sends to a member's account is now classified as
**required** (account and security, ballots, department messages, leaving the
department, store receipts, skills-test results, overdue equipment) or
**optional** (reminders, shift and inventory notices, store announcements,
volunteer calls, election notices, suggestion-box notices and officer-duty
emails). A member who has **Email Notifications** switched off stops receiving
**every** optional kind — including shift, inventory, store, election and
suggestion-box emails that some senders used to send regardless. Certification
escalations likewise stop reaching an opted-out member's personal address.
Members can now also turn individual optional emails off in their notification
settings; their earlier Event and Training Reminder choices are carried over.

If an optional email must reach everyone, make it required on
**Communications → Member Emails & Texts** (`/communications/member-emails`),
which lists every member email and whether it can be turned off. Making an
email required is audited and one-way from that screen.

### Emails show the department logo, and a new logo must be a PNG or JPEG (2026-09-28)

An uploaded logo now appears at the top of every email (since 2026-09-25).
Emails link to `/api/public/v1/branding/email-logo?v=<digest>` on
`FRONTEND_URL` rather than embedding the image, which would push a message past
Gmail's clipping size. No logo is linked while `FRONTEND_URL` is a loopback
address. The path is under `/api/`, which the bundled proxy configurations
already send to the backend; **a hand-built proxy must do the same**. Replacing
the logo changes the address, so emails sent earlier show the department name
instead of the old crest.

**Settings → General → Profile** now checks a new logo the way onboarding always
has: PNG or JPEG, at most 5 MB, between 16 and 4096 pixels on each side,
re-encoded on save. Other formats are refused with the reason, and a link to an
image elsewhere is refused with "Upload the logo as a PNG or JPEG file rather
than a link." A logo already stored is not re-checked until it is changed.

### Wrong two-factor codes now count toward the account lockout (2026-09-28)

For a member with two-factor authentication on, a correct password no longer
clears the failed sign-in count. Wrong authenticator or recovery codes add to
the count the lockout uses, and only a successful code clears it. Before, typing
the password again reset the count, so the lockout never tripped on code
guesses.

A member who enters five wrong codes (`MAX_LOGIN_ATTEMPTS`) is locked for
`ACCOUNT_LOCKOUT_DURATION_MINUTES` (15 by default). With `ACCOUNT_LOCKOUT_REVEAL`
off (the default) the sign-in page still says only "Incorrect username or
password", so expect "my password stopped working". To unlock sooner, reset the
member's password from Member Management or run
`backend/scripts/reset_login_lockout.py <username> --unlock`. Password-only
accounts behave as before.

### Creating a member with a welcome email needs a password while email is off (2026-09-27)

`POST /api/v1/users` with `send_welcome_email: true` and no `password` now
returns **400** while the department's email cannot send, instead of creating
an account nobody can sign in to. **Add Member** requires **Set initial
password** in that state, the CSV import withdraws its welcome-email option,
and **Convert to Member** offers a three-way password choice. Scripts that
create members through the API should send a password, or turn the welcome
email off and set passwords afterwards.

### Every email template is reset to the new design (2026-09-27)

Every email the platform sends now uses one design: a solid tab naming the
category, the title on a tinted card, the message card, and a centred footer,
with a dark rendering for mail apps that support it.

Migration `15c5bc7700aa` **resets every stored email template to its new
default, including templates your department edited.** Subject lines, both
bodies, the footer choice and the colour are all put back to what ships. Two
kinds of row are left alone: a row that already matches the new default, and
a **custom** template, which has no default to reset to.

**Nothing you wrote is deleted.** Before a row is reset, its previous subject,
bodies, stylesheet, footer and colour are copied into the new
`email_template_backups` table, tagged `15c5bc7700aa`. To bring your wording
back, open **Email Templates** and select the template: a **Previous version
(before the redesign)** panel above the editor lists what was saved. **Load
this wording** puts your subject, message and plain-text body into the new
design in the editor; check the preview and press **Save** to keep it, or
**Discard** to drop it. The old header, colours and stylesheet are not brought
back.

**Per-template stylesheets are gone.** A template's **CSS Styles** box has
been removed. Every email renders with the built-in stylesheet, and a
stylesheet saved on a template before the upgrade is kept only in the backup.
The API still accepts `css_styles` so older clients are not refused, but it
is not stored.

Three other changes follow from the same decision:

- **Event-request emails** (the templates on **Events → Settings → Email**)
  are sent inside the design, with the subject as the heading and the public
  footer. Write only the message: a template's own
  `{{organization_logo_img}}` now fills with nothing, because the logo is in
  the masthead, and a template written as a whole HTML page is reduced to
  what its `<body>` held.
- **The election rollback and deletion alerts** now send the
  **Election Rollback Alert** and **Election Deleted** templates, so an edit
  made on the Email Templates screen reaches leadership. Both gained
  variables for the stage change, the time and the vote count.
- **Welcome emails are green**, not red. Red is kept for official notices.

A downgrade of `15c5bc7700aa` puts every reset row back exactly as it was and
drops the backup table. Anything edited after the upgrade is overwritten by
the pre-upgrade values, since only those render correctly on the older
release.

### Dates and exported times now follow the department's timezone — check it is set (2026-09-27)

Every date the server decides for itself — whether a certificate, stock lot or
maintenance item is expired or overdue, whether tonight's shift is already past,
how many days an enrollment has left, which month a drill counts toward, the day
the monthly compliance report goes out — is now taken from the department's own
calendar instead of the server's. A container's clock runs in UTC, which is
already tomorrow for a US department every evening: before this upgrade, from
about 7–8 PM Eastern, a certificate good through today read expired, tonight's
shift could not be signed up for, and an evening drill on the 31st counted
toward the next month.

The department's calendar is **Settings → General → Profile → Timezone**;
if it was never set, `America/New_York` is used. **Check it after upgrading** —
every date above depends on it, and so does every time printed in an email, a
PDF or a CSV export. The `TZ` environment variable does not set it.

What you may notice:

- Emails, PDFs and exports print the department's time. PDF timestamps and
  most export timestamps name the zone (for example `EDT`); the Admin Hours and
  QuickBooks exports print the department's local time without naming the
  zone; the store's ordering-window
  emails no longer say "UTC".
- **Items Not Seen CSV:** the column `Last Seen (UTC)` is renamed `Last Seen`,
  and each value carries its zone. Update anything that reads the header.
- **Store orders CSV:** `Submitted` is local time with its zone.
- **Admin Hours CSV** (Date, Clock In, Clock Out) and the **Finance QuickBooks
  export** (Date) use the department's day and time, so a re-export of a period
  already exported can disagree with the earlier file on evening rows.
- Equipment-check CSV timestamps carry the department's UTC offset.
- **Training records created from an event are dated by the session's day on
  the department's calendar. Records written before this upgrade keep the date
  they were given** — an evening session may sit on the following day or month.
  Nothing rewrites them; correct an individual record where it matters.

### Replies go to the department, and the "do not reply" line is removed (2026-09-25)

Every email now carries a **Reply-To** of the department's own contact
address, unless the sender names another (ballots still name the election
administrator). Make sure that mailbox is read: members can now reply to any
notice. Migration `3f3b315165ed` removes the exact seeded line "Please do not
reply to this email." from every saved footer library; nothing else in a
footer changes.

### Settings → Email shows the address emailed links use, and the IT Manager can change it (2026-09-25)

**Settings → Email** now opens with an **Email link address** card showing the
address every emailed link starts with, and where it came from: the
`FRONTEND_URL` setting, an address picked from `ALLOWED_ORIGINS` because
`FRONTEND_URL` is still `localhost`, or an address saved on this screen. It
warns in red when the address only works on the server itself, and in amber
when it is `http://`, only resolves inside the station's network, or differs
from the address you are browsing on. Check it once after upgrading.

A new permission, `system.manage_link_domain`, lets its holder change that
address on the card, with no restart. **No seeded position is given it**: the
IT Manager holds it through the all-access wildcard, and only someone who
already holds it can grant it. Everyone else with Settings access sees the card
read-only. A saved address must be a host this server already accepts
(`TRUSTED_HOSTS`, or the `ALLOWED_ORIGINS` hostnames) — on a deployment whose
`ALLOWED_ORIGINS` is still localhost-only every save is refused until one of
them names the public host. It takes priority over `FRONTEND_URL` for the whole
installation until someone presses **Go back to the server setting**, and each
change is audit-logged as `email_link_domain_changed`. It cannot make a
production server that refuses to start boot.

### Suggestion boxes: notices in the bell, a status history, an idea board, and deleting a box (2026-09-25)

**Reviewers now also get a bell notification and a push** (where web push is
configured) for every new submission and submitter reply, and each reviewer gets
**their own email** — the old email named every reviewer in To:. Named
submitters get the same for a status change, a response or a reply. Every notice
still carries a link, never the content.

- **Notifications → Notification Rules** has a new trigger, **Suggestion
  Submitted**. With no rule it is on; switched off, it stops the new-submission
  notices only.
- **Email Templates** gains a **Suggestion Boxes** category holding the
  reviewers' **Suggestion Submitted** email.
- Each box can name people to **Also notify**. They are told a submission
  arrived but cannot read it.
- **Submitters see a status history** in follow-up boxes, and reviewers can
  write a response to the submitter. Migration `0010291816fd` gives every
  suggestion already past New one history step, dated when its status last
  changed; earlier steps were never recorded.
- **The idea board is off on every box** until an administrator ticks **Public
  idea board**. Nothing is published automatically (migration `e79309de6735`).
- **A box can be deleted** by anyone with `suggestions.manage`, including a
  person who cannot read it. An empty box goes after a confirmation; one with
  submissions only after its name is typed, taking every submission,
  screenshot, reply, status step and vote with it. **Archive instead** is
  offered first, and deletions are audit-logged.

Rolling back `1ae1ffbc445e` deletes any Suggestion Submitted rule or template
edit and every Also notify list; rolling back `0010291816fd` deletes every
response reviewers have written; rolling back `e79309de6735` deletes every vote
and published idea.

### Enable Status Page stages now do what they say (2026-09-25)

An **Enable Status Page** stage used to be stored and ignored: whether
applicants could open their public status page was decided only by the
pipeline's public status page switch. Now the latest such stage an applicant has
reached overrides the switch for them — an enabling stage turns their page on
even if the switch is off, and a stage with **Enable public status page at this
stage** unticked turns it off, so their link (and self-withdrawal) stops
working, even if the switch is on. Applicants who have reached no such stage
follow the switch as before.

Nothing is migrated: it is worked out from where each applicant stands, so it
applies at once to applicants already past such a stage. From now on an
applicant who reaches an enabling stage is emailed their status link and the
stage completes itself; a disabling stage sends nothing and completes itself.
**Before upgrading, check any pipeline that contains an Enable Status Page
stage.**

### Two new seeded positions, an open Compliance suggestion box, and "Chief" (2026-09-24, 2026-09-25)

- **Assistant Membership Coordinator** (`43e9df281412`) and **Compliance
  Officer** (`3c918c06466d`) are added to every onboarded department, held by
  nobody. The Assistant Membership Coordinator receives applicant-withdrawal
  notices with the Membership Coordinator. The Compliance Officer carries
  training, compliance, reports and documents management, and becomes the copy
  recipient of certification-expiry alerts — which previously resolved to
  nobody.
- **A Compliance suggestion box, reviewed by the Compliance Officer, is seeded
  and switched on** (`3c918c06466d`, `7d2b4e8a1c35`). Members can file to it
  from the day of the upgrade, but **reports wait unread until somebody holds
  Compliance Officer.** Appoint one, or switch the box off under
  **Administration → Forms & Comms → Suggestion Boxes**. A box your department
  already edited is not switched on.
- **The seeded "Fire Chief" position and rank now read "Chief"**
  (`d4e1a7c93b58`). Only the display name changes, and only where it was still
  exactly "Fire Chief": the `fire_chief` code, its permissions and its holders
  are untouched, and a title your department chose is kept. Downgrading
  restores "Fire Chief" on the same rows, including one a department renamed to
  "Chief" itself.

Downgrading removes a seeded position only if nobody holds it, and the seeded
box only if it is unedited and empty.

### Property-return reminders now go out daily — expect one round on the first run (2026-09-24)

The 30- and 90-day reminders to dropped members still holding department
property were implemented but never scheduled. A new daily task,
`property_return_reminders` (07:45), now sends them. **On the first run after
the upgrade, which happens at server start, every dropped member who has passed
a threshold without its reminder receives one email** — the latest threshold
only, never both at once — and the configured notify roles get the matching
summary. Tell whoever handles separations before you upgrade.

### Automated email stages complete themselves (2026-09-24)

An **Automated Email** stage — the seeded **Send Welcome Email**, for example —
used to send its email when an applicant arrived and then wait, in progress,
until a coordinator clicked past it. It now completes itself once the email is
sent, and the applicant moves on to the next stage. If the send fails the
applicant stays on the stage, which is the sign to check **Settings → Email**. A
stage flagged as the pipeline's final stage is never completed this way.
**Applicants already sitting on an email stage when you upgrade are not moved**;
complete them by hand.

Migration `77d4aa7798dd` also fills in when each application was last
deactivated, reactivated and withdrawn, with the reasons, from each applicant's
activity log, so the **Inactive Applications** and **Withdrawn** tabs and the
applicant drawer show dates that used to read "—". A status change older than
the activity log stays blank.

### Length of service now leaves out time away; rolling back discards the record (2026-09-24)

Migration `500a63596f66` adds `member_service_periods`, one row per continuous
stint of membership, and writes nothing at upgrade. A member with no rows is
still counted from their hire date exactly as before, so no one's tier moves.

From now on, dropping or retiring a member closes a stint, and bringing them
back — **Reactivate** for an archived member, or a status change from Dropped or
Retired to Active, Probationary or Inactive — opens a new one, asking whether
their earlier service keeps counting. The department default is under
**Members → Administration → Settings → Membership Tiers → When a former member
rejoins**, which ships as **Continue prior service**.

**Members you reinstated before this upgrade still count the time they were
away**, because nothing recorded their break. Correct any that matter with
**Edit** on the **Service History** card of their profile (`members.manage`).
**Rolling back past `500a63596f66` drops the table**, including every stint
recorded or edited since.

### Every inventory item starts out "Needs a label" (2026-09-23)

Inventory items now record when their barcode label was printed. Migration
`5a70c5dcd138` adds two nullable columns to `inventory_items`
(`label_printed_at`, `label_printed_by`) and an index; it is additive and
reverses cleanly, losing only the print history.

**There is no backfill**, because nothing recorded which items were labelled
before. So on the first load after upgrading, **every item reads "Needs a
label"** on its detail page and matches the items list's new **Needs a Label**
filter. Nothing is wrong with your data; the department simply has no history
yet.

**If your stock is already labelled** and you want the filter to mean
something from day one, catch the records up without printing: filter the
items list to **Needs a Label**, tick one row, choose **Select all N
matching** (up to 500 at a time), press **Print Labels**, **cancel** the
browser's print dialog, and answer **Mark N items as labelled**. Repeat per
category or storage room. Only confirm for items whose labels really are on
the gear — that answer is the whole record.

After that, a mark clears itself whenever the value the label encodes changes
(barcode, else asset tag, else serial number), so an item whose barcode is
edited goes back to needing a label. Details in
[`training/05-inventory.md`](./training/05-inventory.md#knowing-which-items-still-need-a-label-2026-09-23).

### Suggestion boxes, and a new permission on five seeded positions (2026-09-23)

A new **Suggestions** item appears in every member's sidebar, and a
**Suggestion Boxes** screen under **Administration → Forms & Comms**. Nothing
is live until someone creates a box: with none, the page tells members "No suggestion boxes yet — Your department has not opened any suggestion boxes."
_(Superseded 2026-09-24: an upgrade from this point on also seeds a
**Compliance** box that is switched on — see "Two new seeded positions, an open
Compliance suggestion box, and "Chief"" above.)_

**Three migrations** (`80e2004cd691`, `394600cbfae2`, `9cb132ad83dc`). Two add
tables. The middle one **adds a grant**: `suggestions.manage` is written onto
the system **Fire Chief, Deputy Chief, Assistant Chief, President** and
**Communications Officer** positions, where absent. It only touches seeded
(`is_system`) positions — a position your department created is left alone —
and it is safe to run unconditionally because the permission did not exist
before, so no department can have removed it on purpose.

**What that grant does and does not do.** It lets the holder create boxes and
choose their reviewers. **It does not let them read any submission** — only
the reviewers named on a box can. That is deliberate: it is what lets a
department run a complaints box that its own administrators cannot open. It
also makes the **Administration** section visible to anyone holding it, which
for these five positions changes nothing.

**Suggestion boxes are not tied to the Communications module switch**, which
ships off. A department that has never enabled Communications still gets the
sidebar item; that is intended, since gating it on a switch nobody turns on
would hide it everywhere.

**Downgrade warning.** Reversing `80e2004cd691` drops the tables and with them
**every suggestion, attachment record and reply**; uploaded screenshots are left
on disk under `uploads/suggestions`. Reversing `394600cbfae2` removes the grant
from the same five seeded positions, including one your department added by
hand after upgrading — nothing distinguishes the two. Reversing `9cb132ad83dc`
drops **every forward** (a suggestion a reviewer passed to a member or position);
the suggestions themselves are untouched. Back up first if you might roll back.

**Decide who reviews a box before you announce it.** A box's reviewers are the
only people who will ever read it, so choose them with the box's purpose in
mind: a complaints box reviewed by the people most likely to be complained about
will not be used. Reviewers are emailed a link when something arrives, never the
content.

**Anonymity has limits worth telling members about.** An anonymous submission
stores no author and no exact time, but whoever administers the **server** could
correlate its arrival with access logs and mail records. The application does
not expose that to any user. See
[`KNOWN_LIMITATIONS.md`](./KNOWN_LIMITATIONS.md) before promising anonymity to
anyone on a department's behalf.

### A form no longer demands, or keeps, answers to hidden questions (2026-09-23)

Form fields with **conditional visibility** — "Previous EMT experience", shown
only when Membership Type is EMT — were hidden on screen but not on the
server. Two consequences, both fixed:

- **A required question the submitter could not see made the form impossible
  to submit.** The applicant who chose Administrative was refused with an
  **LB-API-400** "Required field … is missing" for a question they were never
  shown. If applicants have been reporting that they cannot submit an interest
  or application form, this is the likely cause, and nothing needs changing on
  the form itself.
- **An answer typed into a question that was later hidden was stored.** It is
  now discarded at submission.

**Older submissions may still hold hidden answers.** A one-off script clears
them, and it is careful about it: it only removes an answer whose rule — applied
to that submission's own answers — hid it, **and** only when neither the
question nor the question controlling it has been edited since the submission
came in (no history of rule changes is kept, so anything newer is listed for a
person instead). It is a dry run by default:

```bash
# See what it would remove — writes nothing:
docker exec -it intranet-backend python scripts/clear_hidden_form_answers.py

# Remove (the backup file is required and must not already exist):
docker exec -it intranet-backend python scripts/clear_hidden_form_answers.py \
    --apply --backup-file /tmp/hidden-answers-backup.json

# Undo:
docker exec -it intranet-backend python scripts/clear_hidden_form_answers.py \
    --restore /tmp/hidden-answers-backup.json
```

The backup holds applicants' answers; it is written readable by its owner only.
Delete it once you no longer need the undo. Running the script is optional — the
stale answers do no harm beyond sitting in the record — and it does not touch
records other features already built from those submissions. Full options in
[`backend/scripts/README.md`](../backend/scripts/README.md#clear_hidden_form_answerspy).

### The installed app now carries the department's own logo (2026-09-17)

A member who installs The Logbook from their browser — "Add to Home Screen" on
a phone, the install button in Chrome or Edge on a desktop — used to get the
stock Logbook mark as the icon. It is now the department's own logo, the same
one uploaded under Settings → Organization → Profile, rendered by the server
into each size a browser asks for. The iOS home-screen icon and the launch
screen an installed app shows while it starts are branded the same way.

**Nothing to do, and nothing to configure**, as long as the department has a
logo uploaded. A department that has not uploaded one keeps the shipped icon,
and so does an installation whose logo is stored as a link to an image
elsewhere rather than as an uploaded file — the server renders only uploaded
images, because fetching a URL out of the database on an unauthenticated
request is a door worth leaving shut.

**Members who already installed the app keep the old icon.** An icon is chosen
once, when the app is installed, and neither Android nor iOS revisits it.
Anyone who wants the new one removes the app from their home screen and adds it
again. New installs get it immediately, as does anyone who installs after a
logo is changed.

**Only if you run your own reverse proxy in front of the stack.** The icons are
served at the URLs they always had — `/pwa-192x192.png`, `/apple-touch-icon.png`,
`/apple-splash-*.png` and the new `/pwa-maskable-512x512.png` — and the
frontend container's own nginx asks the backend for them before falling back to
the file it ships. A proxy that passes these paths through to the frontend
container, which is what the bundled configurations do, needs no change. A
proxy that serves the frontend's built files directly off disk will keep
serving the stock icons, because the branded ones do not exist on disk: point
those paths at the frontend container instead.

### A meeting stage advances on finalized attendance, not on the check-in (2026-09-16)

Follows the entry below, which made a meeting stage that names an event an
attendance requirement. This changes **when** that requirement is met.

**A sign-in at the door is no longer enough.** The applicant must be checked in
**and** that event's attendance must be **finalized** — the organizer running
End Event, recording an actual end time, or pressing Finalize Attendance. Until
then the stage holds them, by hand and automatically alike.

**Why.** Checking a guest in records that they were at the door, which is not
the department's word on who attended: a guest can be signed in and struck off
ten minutes later, and until the event is closed out the roster is still being
decided. Finalizing is the act that settles it, and it is already the act that
derives the durations and lands the hours. The advance used to fire at the
sign-in, so an applicant moved on a number nobody had stood behind yet.

**What replaces the old trigger.** Finalizing an event now advances every
checked-in applicant it clears, in one pass. That covers all three routes at
once, since End Event and recording an actual end time both finalize.

**An event nobody finalizes still settles on its own.** Finalizing is a human
act that routinely never happens — the nightly post-event task only _prompts_
the organizer — so attendance also counts as settled once
`PIPELINE_ATTENDANCE_SETTLE_DAYS` (default **7**) have passed since the event
ended. A nightly `prospect_attendance_advance` task re-asks the question, since
nothing else would notice the day an unfinalized event aged into being good
enough. Set the window in `.env`; `0` settles it at the event's end.

**What you will see.** An applicant who signed in this evening no longer jumps
to the next stage during the meeting. They advance when you close the event
out, along with everyone else who was there — or, if nobody closes it out, a
week later. Trying to advance one by hand in between names the event and says
what is missing:

> This applicant is checked in at 'Recruitment Night', but that event's
> attendance has not been finalized, so 'Chief Interview' is not ready yet. A
> sign-in at the door is not the final roster — finalize the event (End Event,
> record its actual end time, or Finalize Attendance) and they advance on their
> own.

**The stage checkbox was relabelled** from "Auto-advance when attendance is
recorded" to "Auto-advance when the event's attendance is finalized". The
setting itself is unchanged — no stage needs editing.

**One wrinkle worth knowing.** Once an event is finalized, adding a missed
attendee is refused until somebody with `events.reopen_attendance` reopens it.
So if you finalize and _then_ discover an applicant's attendance was never
recorded, reopen the event, check them in, and finalize again — re-finalizing
re-runs the advance and skips anyone already moved.

### A meeting stage that names its event now requires attendance (2026-09-16)

This supersedes the 2026-09-15 entry below, which narrowed the same gate to
**Bulk Advance** only. Two changes, both to meeting stages.

**Which stages are enforced is now decided by the stage, not by who is
advancing.** A meeting stage covers two unlike things. "Meet with the Chief" is
an arrangement between two people that nothing will ever record, so the
coordinator's word is the only evidence there can be. "Attend a business
meeting" names an event you run, and check-in produces a record of who was
there. Reading the caller instead meant the same coordinator, the same
applicant and the same stage were refused in a bulk advance and allowed one
card at a time — so the way past an unattended meeting was to advance the cards
singly, which is not a decision anybody made on purpose.

A stage that names its event — it has an **Auto-Link Event Type**, or was
pinned to a specific event — is now an attendance requirement on every path:
**Advance**, a drag across the board, Bulk Advance and every automated advance
alike. A stage that names no event is unchanged and still takes the
coordinator's word, on every path.

**Attendance from before the application was opened no longer counts.**
Attendance is recorded per person and is unbounded in time, so a check-in from
years ago graded exactly like one from last week. That bit hardest in the flow
this module is built around: when a kiosk sign-in opens a prospect record at a
business meeting, that applicant carries a matching business-meeting attendance
from the moment they exist — and a later "attend a business meeting" stage was
satisfied by the sign-in that created them, without their ever attending a
second one. The cut-off is the event's check-in window closing, so the meeting
that opened the record still counts and genuinely old attendance does not.

**What you will see.** On a stage that names its event, an applicant with no
attendance recorded since their application was opened can no longer be
advanced, and the refusal names what to do:

> No attendance has been recorded for 'Chief Interview' since this application
> was opened. This stage names the event its applicants must attend, so it
> advances once they are checked in there. Add them to that event's attendees
> and check them in if they attended and it was not recorded; otherwise un-tick
> Required on the stage to skip it, or clear its Auto-Link Event Type.

Those are the three ways out, in the order to reach for them. Recording the
attendance is the one to prefer — it is how the applicant is meant to clear the
stage, and it leaves the attendance record true rather than working around it.
You can add someone to an event's attendees and check them in after the fact
from the event itself.

**Who this affects.** Only stages with an Auto-Link Event Type or a pinned
event. The stage builder leaves both empty by default, so a meeting stage
nobody configured that way behaves exactly as it does today. If you do have
such a stage with applicants parked on it who attended without it being
recorded, they will be refused until you record it — worth a look at who is
sitting on that stage before you upgrade.

**Amended on 2026-09-16** — see the entry above. Being checked in is necessary
but no longer sufficient: the event's attendance must also be finalized, and
the refusal's wording changed to say so.

### Bulk Advance is held to the meeting-attendance gate (2026-09-15)

A meeting stage set to auto-advance refuses an automated advance when no
attendance is recorded. A coordinator's single **Advance** is deliberately
exempt — they may have watched the applicant arrive and found no record of it.
**Bulk Advance** inherited that exemption and should not have.

**Why.** The exemption is written for one applicant at a time. The board lets
cards be ticked across every column, so a bulk selection routinely spans stages
and nobody formed a view about any single one of them. Every other stage gate —
checklist, interview, references, documents, medical screening, the election
vote — already refused per item on this path and named the refusal in the
result. The meeting gate was the only one a bulk advance walked straight
through, which made it the easiest way to move an applicant past an interview
they had not attended, and the way that gave the coordinator no sign it had
happened.

**What you will see.** A bulk advance now reports anyone on a meeting stage
with no recorded attendance among its skipped items, naming the stage:
"Advanced 27, skipped 3: Dana Reed (No attendance has been recorded for 'Chief
Interview' yet)…". The rest of the selection still advances — one refusal has
never stopped the others. Advancing that applicant singly still works and is
still ungated, which is the intended way to handle attendance nobody wrote
down.

**Superseded on 2026-09-16** — see the entry above. The single **Advance** is
no longer exempt on a stage that names its event, and the refusal's wording has
changed; the exemption now survives only on a stage that names no event.

Nothing else changes: the flag this uses is read only by the meeting gate, so
every other stage type behaves on a bulk advance exactly as before.

### A membership form submission no longer moves the wrong applicant (2026-09-15)

Three changes to how a submitted form affects a **Form Submission** pipeline
stage. The first is a fix with no setting attached; the second is a setting
that now does something; the third changes nothing for a stage you have not
edited.

**A submission only affects the stage the applicant is currently on.** It used
to find the stage by matching the _form_, complete it wherever the applicant
had actually got to, and advance them to the stage after it — pulling people
**backward**. An applicant at the membership vote landed back on the welcome
email. A guard normally hid this, but it tested for one status only, so a
stage a coordinator had **skipped** fell straight through: hand an applicant a
paper form, un-tick Required, Skip the stage, and any later submission of that
form for their email dragged them back. The public form endpoint runs the same
path, so this did not require an account. Duplicate detection only ever matches
an **active** application, so held, rejected and withdrawn applicants were
never reachable.

**The advance now goes through the same path as every other.** It previously
wrote the progress row by hand and moved the applicant directly, which skipped
the status guard, the stage gates, the row lock and the activity log — the one
advance in the system that moved somebody leaving no audit trail. A held
applicant is no longer advanced by a submission, and every form advance now
appears in the applicant's history.

**"Auto-advance when form is submitted" now decides something.** The box was
inert in both directions: ticked or un-ticked, a submission advanced the
applicant. Un-tick it and they stay on the stage with their answers recorded
for you to review.

**What you will see.** Nothing, unless you want to. A stage that carries no
auto-advance setting — which includes every stage in the seeded pipelines and
any stage where nobody touched the box — keeps advancing exactly as it does
today; absence means on, not off. The box now renders ticked by default to
match. If you had deliberately left it un-ticked expecting it to hold
applicants, it will now do that, which is a change from what you have been
getting.

### Direct label printing needs an approved network (2026-09-14)

The backend opens a network connection to a registered label printer, so the
addresses it may reach are now an **operator** decision rather than something
a department administrator types in. `LABEL_PRINTER_ALLOWED_NETWORKS` takes a
comma-separated list of printer IP addresses or CIDR ranges, and it is **empty
by default, which turns direct printing off**. A printer outside the list is
refused with "… does not resolve to an operator-approved label-printer
network."

A department that registered printers before this upgrade loses direct
printing until the setting is made. Add the printers' subnet to `.env`, for
example `LABEL_PRINTER_ALLOWED_NETWORKS=192.168.10.0/24`. The shipped
`docker-compose.yml` passes it through, and since 2026-10-06 so do the Unraid
compose files in `unraid/` (see
[Every backend setting in `.env` now reaches the container](#every-backend-setting-in-env-now-reaches-the-container-2026-10-06)).
A compose file of your own does not: add
`LABEL_PRINTER_ALLOWED_NETWORKS: ${LABEL_PRINTER_ALLOWED_NETWORKS:-}` to the
backend's `environment:` block, or the value in `.env` never reaches the
container. Loopback, link-local and
reserved addresses are refused whatever the list says.

### Two prospective-member stages now hold applicants where they should (2026-09-13)

Both changes are to the membership pipeline and neither touches an existing
record. **They are not gated the same way**, which matters if you are deciding
what to check after upgrading: the Election Vote gate refuses a coordinator's
**Advance** as well as an automatic one, because a vote the department has
already held is a result rather than a judgement call. The Meeting gate
withholds only the _automatic_ advance and leaves **Advance** to the
coordinator.

**An Election Vote stage now waits for the ballot.** A stage of that type
refuses **Advance** while the applicant's election package reads _Added to
Ballot_, and refuses it outright when the package comes back _Not Elected_.

**Why.** The package status was already the authoritative record of the vote —
the Elections module writes it when a package is put on a ballot and again
when the closed ballot is tallied — and nothing consulted it when moving an
applicant. An applicant the department had voted _down_ advanced on a click,
beside a panel reading "This applicant was not elected by the membership
vote"; on a pipeline with **Auto-transfer on approval** and the vote as its
final stage, that click made them a member.

**What you will see.** If your department holds its vote at a meeting and
records the result by hand, nothing changes: a stage with no package, or one
still _Draft_ or _Ready_, advances exactly as before. Only a package that
actually reached a ballot is held. If a ballot closed but the result was never
synced, the applicant stays put — un-tick **Required** on the stage and use
**Skip**, which stays audited, or record the result.

**The gate reached the Convert button on 2026-09-14.** It originally ran inside
`complete_step` alone, and **Convert** — the button shown whenever an applicant
is on the pipeline's last stage, and the documented way to finish one — calls
the transfer path directly without going through it. So for one day an
applicant the vote had rejected could still be converted to a full member by
that button. Both paths carry the gate now, with the same wording and the same
escape hatch.

**A Meeting stage that names no event no longer auto-advances at all.** The
stage builder's **Auto-Link Event Type** is what tells a meeting stage which
event counts. A stage that named none used to accept attendance at _any_ event
in the department; it now accepts none, and the stage builder refuses to save
an auto-advancing meeting stage until a type is chosen.

**Why.** Guest check-in is department-wide and is usually enabled on public
events — open houses, fundraisers, public education — which is exactly where a
prospective member turns up casually. So a stage reading "Meeting with the Fire
Chief" advanced an applicant who signed in at a pancake breakfast. **Meeting
Type** does not stand in for the event type: that field names the stage's
purpose for whoever reads it and is read by nothing.

**What you will see.** Check your meeting stages: any with _Auto-advance when
attendance is recorded_ ticked and **Auto-Link Event Type** set to _None_ will
stop advancing on their own after this upgrade. Set the event type and they
resume; the coordinator can advance by hand meanwhile. Stages that
self-schedule through **Cal.com** are unaffected — they advance when Cal.com
reports the meeting ended, not off an attendance record, so they need no
linked event.

### An email configuration that cannot send is now refused when you save it (2026-09-13, completed 2026-09-15)

Settings → Email would save an **enabled** section green that had no chance of
delivering a message. Two shapes did this: **Cloudflare** with no account ID or
API token, and the platform left at **Other**, which stores nothing at all.
(That button is now labelled **Not configured**.) Both now name the missing
field on the write, and the settings screen says so inline rather than leaving
Save to explain it. A present-but-misshapen Cloudflare account ID is rejected
too — it must be the 32-character hexadecimal value from your Cloudflare
dashboard, not the account name.

**Why this matters more than a validation message.** An enabled section short-
circuits the deployment-wide `SMTP_*` settings: `_get_smtp_config` returns early
once the organization's own section is enabled, so a hollow section did not just
fail to send on its own, **it stopped whatever server-level SMTP the deployment
had from being used.** A department that had been sending mail perfectly well
through the deployment's SMTP server and then half-filled an email section
stopped sending, with a green toast and no error anywhere.

**What to do.** If your department's mail stopped and you cannot explain it,
open Settings → Email. Either complete the section or **turn it off** — a
disabled section hands sending back to the deployment's own SMTP configuration.

**Four more things changed on the same screen.** Three are additive; the first
changes what two buttons are called.

- **Two platform buttons were renamed.** **Self-Hosted SMTP** is now **SMTP
  (any provider)**, and **Other** is now **Not configured**. Nothing beneath
  either button changed and no stored value moved — but every screenshot,
  recording and SOP that names the old labels is now wrong about them, and an
  operator following one will look for a button that is not there. The rename is
  part of the fix above rather than a separate tidy-up: both old names pointed
  departments at the one option that cannot send.
- **Twelve SMTP quick-fill presets.** Yahoo, iCloud, Zoho, Fastmail, AOL, GMX,
  SendGrid, Amazon SES, Mailgun, Postmark, Brevo and Mailjet each fill in the
  host, port and encryption the provider documents, along with what its Username
  and password fields expect — most of them require an app password generated in
  the provider's own settings once two-factor sign-in is on, which is the
  commonest reason a correct host and port still fails to authenticate. **The
  stored shape is unchanged**: still a self-hosted SMTP configuration with the
  same fields, so nothing about an existing one moves. This is a labelling fix.
  A department running on Yahoo read "Self-Hosted SMTP — your own mail server",
  reasonably concluded it was not supported, and picked "Other", which cannot
  send. Both of those names are what the rename above replaced.
- **Cloudflare departments can send ballot email.** The election ballot fan-out
  is the one batch sender, and it handed the Cloudflare path raw MIME, which
  that API does not accept — so it warned about falling back to SMTP and fell
  back to a host those organizations do not have.
- **A stored `email_service: null` no longer breaks sending.** The settings API
  accepts an explicit null and stored it, after which every read inside the
  sender raised — while the settings screen itself displayed normally, because
  the read path already guarded.

**Also fixed on 2026-09-15**, from a review of the above: an organization with
its own enabled email section is no longer overridden by a deployment-wide
Cloudflare account (that account is a default for organizations that have not
chosen, not an override for ones that have), the Cloudflare paths now carry the
`List-Unsubscribe` headers the SMTP path always did, and a partial save that
omits the platform field no longer fails with "Email cannot be enabled without
an email platform" while naming a perfectly good SMTP host.

### A click outside a dialog no longer closes it (2026-09-13)

Clicking in the margin around an open dialog used to close it. Where the dialog
held a form, that discarded the form — with no draft, no confirmation and no
undo. The case this was reported for is adding a uniform to inventory, where a
name, category, room, storage area and a set of sizes and garment style axes are
chosen before anything is saved; one click in the gutter threw all of it away
and reopened the dialog blank.

**Escape and the X in the dialog's header still close everything**, so nothing
is harder to get out of — there is just no longer a way to lose a form by
missing.

**Five surfaces deliberately keep click-away**, because none of them holds
anything you could lose: the command palette, the two equipment-check jump
sheets, the checklist picker and the "before publishing" blocker sheet. Menus
and dropdowns are unaffected — closing on an outside click is how a menu is
supposed to behave.

**Nothing to do.** This is here because it changes a habit rather than a
setting, and because a department that trains new members on video will find
that take no longer matches the application.

### Completing a repair no longer moves an inspection deadline (2026-09-13)

**This is the one item in this window that may have left bad data behind, so
read the last paragraph.**

Marking any maintenance record complete used to write the item's **last
inspection date** — a repair, a cleaning, a decontamination, anything — and
recalculate the next inspection due date from it. A structural coat inspected in
April and repaired in August had its annual NFPA 1851 inspection silently
rescheduled from the following April to the following August, and the department
read as compliant for four months longer than it actually was. Nothing raised
and nothing was logged; the only visible sign was two dates on the item page
that did not agree.

Only an **inspection** now moves that clock — routine, advanced or independent.
The type is read off the record after the update applies, so a record that is
completed and has its type corrected in the same action is judged on what it
ends up being.

⚠️ **The fix is forward-only. Items whose inspection date already slid keep the
date they hold.** If your department tracks gear on an inspection interval and
has been completing repair or cleaning records against it, **spot-check the last
inspection date on that gear against your paper records** before trusting the
next-due figure. There is no migration for this: the application cannot tell a
date that slid from one a quartermaster entered deliberately.

### The Open Shifts board no longer lists shifts you cannot take (2026-09-13)

A member picking their position off the Open Shifts board could be refused with
**"Position was filled after this request was submitted"** — a message about a
race, for a seat that had been taken for days. Two checks were answering
different questions: one asked whether the _shift_ still needed somebody, the
other whether the _member_ was cleared for anything on it, and nothing
intersected them. A shift with an empty driver's seat and a full firefighter
seat was offered to a firefighter, whose signup was then refused.

**A member's board now lists a shift only when one of its unclaimed seats is a
position they are cleared for**, so the board will be shorter than it was — and
what it drops is what the system would have refused anyway. Two related
improvements come with it: the signup picker offers only seats the server will
grant, and a shift where every seat you are cleared for is taken now says so,
instead of "you are not eligible", which was sending members to a scheduling
admin about qualifications that were fine.

**A holder of `scheduling.manage` sees no change.** That tab is also how a
scheduling admin finds the department's staffing gaps, so it keeps the
department-wide view. The short-staffed metric on the administration hub, the
MCP tool and outreach sheets are all unchanged for the same reason.

**Nothing to do**, but expect the question: a member who used to see eight open
shifts and now sees three has not lost access to anything.

### A skills test can no longer be filed with unmarked steps (2026-09-12)

Completing a skills evaluation now requires a result against every step on the
sheet. `POST /api/v1/skills-testing/tests/{id}/complete` returns **400** when
any step is still blank, listing them in `detail.unresolved_criteria`, and the
examiner screen will not offer Submit until they are resolved.

**Why.** A blank step was never neutral. A point-carrying one enlarged the
denominator and earned nothing, so it silently cost the candidate full marks,
and under `require_all_critical` a blank critical step already scored exactly
like a failure. Neither was visible anywhere on the filed result — and the two
rules pointed opposite ways, because an unmarked _deduct_ step has always been
charged nothing on the grounds that the examiner made no judgement. There was
no way to tell, reading a finished scorecard, which of those had happened.

**The way out for a step nobody could watch:** the review screen lists every
blank step and offers **Not observed** on each, which records a required reason
and takes the step out of the point pool in both directions — it credits and
penalises nothing. A **critical** step cannot be waived: that is a skill the
candidate must demonstrate, so "did not apply" is never the right answer, and
the API rejects it. This takes nothing away from an examiner, since a blank
critical step already scored as a failure.

**What you will see:** nothing changes for a test that was already fully
marked, and no stored result is re-scored. An evaluation left part-marked when
you upgrade is not stranded — reopen it, and the review screen names the steps
that still need a call.

**If you drive the API directly** (a kiosk, an import, a script), a completion
posted with blanks will now be rejected rather than filed. Send a mark for
every non-statement step, or a `{"waived": true, "waive_reason": "..."}` on the
ones that could not be observed. Statements are exempt — they are read aloud
and mark themselves.

**Also in this release, and worth knowing if you author sheets by API:** a
criterion whose `passing_score` exceeds its `max_score`, and a `score`-type
criterion with no `max_score`, are now rejected at the write. The template
builder has always refused both in the browser; a sheet posted by a script
could previously save either, and both are silent at scoring time — the first
is a step nobody can pass, the second a step that appears scored out of
something and carries no points. Existing stored templates are untouched.

### A setup wizard stuck on a 500 is fixed by this upgrade (2026-09-12)

Only relevant if you have an installation whose **first-run setup never
finished**, returning a 500 from the setup screen with no way past it. If your
department is already set up, this changes nothing you will notice.

`onboarding_status` is meant to hold exactly one row and nothing enforced it.
Two concurrent first-run requests — which the wizard's own page load issues in
parallel — could each create one, and the reader then raised on finding two, so
`GET /api/v1/onboarding/status` returned 500 **permanently**. Recovery needed
direct database access at the one moment no account exists to sign in with.

Migration `6ab7d903fae5` **collapses the duplicate rows and adds a unique
index** so they cannot recur. The surviving row is the completed one if there
is one, otherwise the furthest-progressed — so setup resumes where it actually
got to, not where an accidental twin did. Duplicate rows are deleted; they were
partial copies of a singleton, and the survivor carries the progress.

**What to do:** nothing. If setup was stuck, reload it after upgrading and it
will continue.

### Navigation layout became a department setting (2026-09-11)

Setup has always asked whether a department wants navigation across the top or
down the side. Until now the answer reached only the browser that gave it: the
wizard wrote `localStorage`, which is where the app read it, and the copy sent
to the server was stored on the onboarding session and read by nothing. So the
officer who ran setup saw their choice and every other member saw the default,
with no screen anywhere to change it.

The answer is now stored on the organization and applies to everyone.

**What you will see on the first load after upgrading:** an existing
installation has no stored layout, so every member — including the officer
whose browser held `top` — gets the `left` default. The old value lived in one
browser's local storage and was not reachable from the server, so there was
nothing to migrate.

**What to do:** if the department wants the top bar, set it once at
**Settings → General → Profile → Navigation Layout**. It applies to every
member from their next page load. Departments already on the default need do
nothing.

### Off-list event-request preferences are settled, and it does not reverse (2026-09-10)

An event request's **date flexibility**, **venue preference** and **preferred
time of day** are fixed vocabularies that the coordinator's board and the
public status page are written against. A department could rename its own
form's option values, so stored requests could carry something else and render
as a raw slug, or as nothing. Migration `0533644945cd` settles those rows the
way intake now does: trimmed and lower-cased first, and replaced with the
fallback value only when genuinely unrecognised.

**Only values outside the vocabulary are touched.** A request whose flexibility
says "specific dates" without naming one is left alone, and **outreach types
are not touched at all**, because a type missing from today's list may be one
your department genuinely offered and has since retired.

**It does not reverse.** The original off-list text is not recorded anywhere,
so the downgrade is a no-op; the settled values are valid under the older code
too.

### Published event-request forms keep working (2026-09-09)

`events.request_pipeline.accept_public_requests` shipped read by exactly one of
the two intake paths. `POST /api/v1/event-requests/public` honoured it; the
**Forms** path — the one your own "Generate Event Request Form" button
produces, and the one the settings screen tells you to publish — never looked
at it. The same release makes the Forms path honour it too.

Left alone, that would have silently stopped community requests arriving at
every installation with a published request form, **with the toggle already
showing off and no error anywhere**.

Migration `d19b2c2ae9b9` writes down what was already true: every organization
with a **published, public** form that would actually create a request today is
recorded as accepting public event requests. It sets the flag unconditionally
for those organizations rather than only where the key is absent — a stored
`false` on such an organization cannot have meant "do not take requests from my
published form", because the toggle never controlled that form.

**Organizations with no such form are untouched** and keep the shipped default
of `false`.

**What to check:** if you publish an event-request form and do _not_ want
public submissions, the toggle now genuinely controls it — turn it off at
**Events → Settings → Pipeline**.

### Applicant pipeline stages are renumbered (2026-09-08)

A stage's position is not only its column on the applicant board: **Advance**
moves an applicant to the next stage in that order. Two stages could end up
sharing a position — adding a stage numbered it from the count of stages, and
deleting a middle stage left a gap — and then both the column order and where
Advance went depended on how the tie happened to break.

Migration `a3f61c8d27b4` renumbers every pipeline's stages densely, keeping the
order a coordinator currently sees and breaking a tie toward the stage created
first. Nothing is added, dropped or deleted.

**What to check:** open the applicant board. Where two stages were tied, the
column order may settle differently from what you were used to — that is the
tie being broken deliberately rather than at random. If it is not the order you
want, reorder the stages in the pipeline settings.

### Property-return reports are no longer readable department-wide (2026-09-07)

`PropertyReturnService.save_as_document` filed each generated property-return
report into the `Reports` system folder, which carries the default
`organization` visibility. Every holder of plain `documents.view` could read a
report that names a departed member, quotes the reason for the separation —
involuntary ones included — and prints their home address so the letter can be
posted.

Reports now file into a `member-separations` folder with
`FolderVisibility.LEADERSHIP`. Migration `b1e7c3a92f45` creates that folder for
organizations whose system folders were already initialised (the service's own
`initialize_system_folders` returns early for them) and moves the reports
already written into `Reports`.

**Nothing to configure.** This is listed so you know what was exposed, and to
whom, before the upgrade — and so you can **tell whoever handles separations**
that new reports are filed in the leadership-only **member-separations** folder,
not Reports.

**The downgrade restores the disclosure.** It moves the reports back to
`Reports` and drops the folders the revision created, restoring the prior state
exactly — which is correct for a schema rollback and wrong as a decision.

### Your Treasurer can now approve purchase requests (2026-09-06)

`finance.approve` and `finance.configure_approvals` are both defined and both
gate real endpoints, but **no seeded position held either**. Only `it_manager`
could reach them, and only through its `*` wildcard — the IT administrator
rather than a finance role.

**What that cost a department.** Configure a chain _without_ also granting
`finance.approve`, and every submitted request lands in `PENDING_APPROVAL` with
nobody able to action it — and the settings screen that produces that state was
itself unreachable. (With no chain configured at all, `submit_purchase_request`
also sets `PENDING_APPROVAL`, creating no approval records, for manual
approval.)

_Corrected 2026-09-25: this entry previously said that with no chain configured
a request skips approval entirely. It does not — see the `else` branch in
`FinanceService.submit_purchase_request`._

Migration `ee7390dcdf47` grants both to the Treasurer position.

**What you will see after upgrading:** the Treasurer can action the approval
chain. This does **not** enable self-approval — `FinanceService.approve_step`
calls `assert_different_person` and refuses it whoever holds the permission.
Denial is left unguarded on purpose: withdrawing your own request is not a
conflict.

**What to check.** The grant is **gated**, not unconditional: it applies only
where the position's finance grants are exactly
`{finance.view, finance.manage}` — what the registry seeded. A row already
holding either new grant, or any other finance shape, is left alone. **If you
deliberately curated your Treasurer to exactly view + manage, meaning "no
approval powers", review that position after upgrading** — nothing in the
stored row distinguishes that decision from the untouched seed.

**Then look for a backlog.** If you built a chain that nobody could action,
requests may be sitting in _Pending Approval_; the Treasurer can now work
through them.

### A call type your department named "unclassified" is renamed (2026-09-05)

`unclassified` is the slug of the synthetic bucket a call with **no** type falls
into. A department-configured type sharing it was indistinguishable from that
remainder: the call-volume report merged its calls with the untyped ones and
labelled the total "Not categorised", and the type's own name vanished from
every screen. Migration `c9f4a2b71d38` renames such a slug, deriving the new one
from your own label, and moves the calls and filed reports that point at it.

**Nothing to do** unless you had such a type — then expect its calls to reappear
under its own name.

### The Membership Coordinator rename, and two other repairs, finally run (2026-09-05)

Four earlier migrations named the `positions` table at a point in the chain
where it was still called `roles`, and an existence guard turned the resulting
crash into a silent no-op. On every department that upgraded:

- the **Membership Committee Chair** position was never renamed to **Membership
  Coordinator**;
- role-targeted department messages were never converted from position names to
  ids;
- the default **Member** position never received the equipment-check submit
  grant, **so those members lost the checklist on upgrade**.

Migration `e8a1c04f6b27` performs all three. It skips a department that already
has a Membership Coordinator, leaves a position the department created alone,
and converts message targeting **before** renaming, so a message addressed to
the old name still resolves. A message targeting a name two positions share is
left as-is, rather than silently dropping one position's members.

### Scheduling administration moved, and six addresses stop working (2026-09-05)

Everything an officer administers about the schedule is at `/scheduling/admin`,
gated by `scheduling.manage`. These addresses stop resolving, **with no
redirect** — they land on the dashboard:

| Old address                  | New address                                                      |
| ---------------------------- | ---------------------------------------------------------------- |
| `/scheduling/settings`       | `/scheduling/admin/settings/general` (and five sibling sections) |
| `/scheduling/templates`      | `/scheduling/admin/planning/templates`                           |
| `/scheduling/patterns`       | `/scheduling/admin/planning/patterns`                            |
| `/scheduling/reports`        | `/scheduling/admin/reports`                                      |
| `/scheduling/platoons`       | `/scheduling/admin/platoons`                                     |
| `/scheduling/qualifications` | `/scheduling/admin/positions`                                    |

`/scheduling/admin/settings?tab=…` still forwards to the section it names.

**The position roster was narrowed to `scheduling.manage`.** It used to accept
the training grants too, so a training officer could open
`/scheduling/admin/positions`; the page and the API behind it
(`GET /scheduling/eligibility/roster`) now both require `scheduling.manage`
alone. Grant it if that officer needs the roster.

**Update station SOPs, pinned tabs and saved links** to these addresses, and to
the eight equipment-checklist addresses retired on 2026-08-31 (below).

### Compliance percentages may rise (2026-09-05)

Two grading defects were fixed, both in the favourable direction:

- a member exempt from a requirement could never reach 100%, because the
  percentage divided by every active requirement while counting only the ones
  that applied to that member;
- a certification that is valid today but expiring soon read as a failure.

**Expect some members' percentages to go up** after upgrading. Nothing to
configure. The Compliance Matrix's **Notify** and **Assign** buttons are gone:
they had no endpoint behind them.

### Six upgrade steps take permissions away (2026-09-05)

The old onboarding position editor saved a heuristic's checkbox defaults over
the seeded position rows, and a user's permissions are the union of every
position they hold, so the difference became live grants on every department
that finished setup. Migrations `c9a5e21f7b04`, `d1c7f4a92e63`, `f3b8d0c26a17`,
`a2e9f6b04c71`, `b6e4a0d17c93` and `d5f2b8c04a19` remove them:

| Grant                                                                                   | Comes off                                                                                                                   | What those members lose                                                                                     |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `reports.view`                                                                          | Member, Firefighter                                                                                                         | Administration → Reports, and with it the Administration section itself for anyone who had nothing else     |
| `apparatus.view`                                                                        | The rank-and-file, including the membership-standing positions (Probationary, Junior, Life, Administrative, Social, Exempt) | The fleet maintenance and compliance record                                                                 |
| `integrations.view`, `medical_supplies.view`, `mobile.view`, `prospective_members.view` | Member, Firefighter, Engineer, EMT                                                                                          | Those four workspaces                                                                                       |
| `positions.view`, `reports.view`, `settings.view`, and the `apparatus.*` wildcard       | Engineer                                                                                                                    | Engineer keeps `apparatus.view` and `apparatus.maintenance`, which is what a driver/operator is seeded with |

Two steps go the other way (`f7b3c8d2e569`, `b4d1c8e37f52`): four grants are
restored on EMT positions (seeing the department's own information, its
locations and its meetings, and asking to swap a shift), and the store-order
and equipment-check-submit grants on Member.

**⚠️ The revocation is unconditional, including where you granted it on
purpose.** Nothing in a stored position row distinguishes a deliberate grant
from the setup screen's mistake — earlier attempts to tell them apart missed
every department that had switched those modules off during setup. Because
these grants expose other members' aggregated hours, training and roster data,
they are removed wherever they are found. A position your department created
itself is never touched.

**What to do:** if your department deliberately gave members Reports, or wants
them to see the fleet, **grant it again on the positions screen after
upgrading.** The lightweight `/apparatus-basic` page, shown when the Apparatus
module is off, stays open to everyone.

### Gmail and Microsoft 365 email never sent; stored OAuth fields are deleted (2026-09-03)

The settings form saved these platforms' credentials under keys the sender never
read, so every message failed with "SMTP host and from_email are required" —
after a green "Email settings saved" toast, and **in preference to** a working
server-wide SMTP configuration, because the organization's own section wins
whenever it is enabled. Both platforms now resolve host, port, encryption and
login from a fixed preset shared by the sender and the connection test.

**What to do:** re-open **Settings → Email**, confirm the From address and app
password, and press **Test Connection**, which signs in to the provider without
saving.

**Migration `e3a9c1d5b7f2` deletes the stored Gmail and Microsoft OAuth Client
ID / Client Secret values, and does not reverse.** Nothing ever read them — no
refresh token was obtained and no send path existed.

**Microsoft 365 has a deadline.** Exchange Online is retiring Basic
authentication for SMTP submission: unchanged through December 2026, disabled by
default for existing tenants at the end of it, unavailable to tenants created
after, and removed in the second half of 2027. An App Password _is_ Basic auth.
Settings → Email offers **App registration (OAuth)** alongside it; an existing
App Password configuration keeps working, and keeps its method, until you
choose to move.

### Equipment checklists moved to Inventory; eight addresses and three permissions renamed (2026-08-31)

These addresses stop resolving with no redirect. Seven land on the dashboard;
`/scheduling?tab=equipment-checks` opens Scheduling on its **Schedule** tab,
because that page still exists and ignores the removed tab:

| Old address                               | New address                                 |
| ----------------------------------------- | ------------------------------------------- |
| `/scheduling/equipment-check-templates/…` | `/inventory/admin/checklists/templates/…`   |
| `/scheduling/equipment-check-reports`     | `/inventory/admin/checklists/reports`       |
| `/scheduling/supply/expiring`             | `/inventory/admin/checklists/supply`        |
| `/scheduling/equipment`                   | `/inventory/checklists`                     |
| `/scheduling/equipment/checks`            | `/inventory/checklists/log`                 |
| `/scheduling/equipment/{id}`              | `/inventory/checklists/apparatus/{id}`      |
| `/scheduling/apparatus-inventory`         | `/inventory/checklists/apparatus-inventory` |
| `/scheduling?tab=equipment-checks`        | `/inventory/checklists/my`                  |

**Tell your crews:** members find their checks at **Operations → My
Checklists**, and officers at **Fleet Readiness** beside it. End-of-shift
reminders **already in members' bells** carry the old address; new ones point
at the right place, and the old ones age out within a few days.

**Permissions.** Migration `ff8076f4987a` renames `equipment_check.view` /
`.manage` / `.submit` to `inventory.check_view` / `.check_manage` /
`.check_submit` on every stored position, so every position keeps exactly the
authority it had. **⚠️ A position holding the `inventory.*` wildcard now also
authors and submits equipment checklists.** No seeded position holds
`inventory.*`, so this reaches only positions your department built — typically
a quartermaster. If that is wider than you intend, replace the wildcard with the
specific `inventory.` grants you want.

### Re-check four things after the August 24–31 upgrade (2026-08-31)

- **Compliance percentages.** Clearing a compliance setting and saving used to
  keep the old value, and a compliance profile with every requirement unchecked
  was graded against every department-wide requirement. Both are fixed, so a
  percentage can move — a lot, for any group meant to have no required
  certifications.
- **Any grant or fundraising report whose range ended on the day it was run.**
  It left out that day's later records; run it again.
- **Your quartermaster.** "Checkout batch" is now **Item Distribution**
  (labels only — the data is unchanged), and stock received through the reorder
  workflow can be issued, which it could not before.
- **Empty is correct here.** Member qualifications, the organizational chart and
  testing runs all start empty after the upgrade; nothing is inferred from
  ranks, positions or members.

### The Testing Checklist is a module, and it starts switched off (2026-08-27)

`/testing` stops resolving because the checklist became a module of its own and
is off unless a department enables it: **Settings → Modules → Testing
Checklist**. Marks already on the server come back when it is on. Marks kept in
the **browser** by builds older than the server-side checklist (under
`logbook.testing-checklist.v1`) have no import path — **export that run before
you upgrade**.

### Administrative members lose their operational rank, and it does not come back (2026-08-27)

Migration `a7c4e9b13f58` clears the operational rank of every member whose
class is **administrative**. A rank carries chain-of-command permissions, so an
administrative member holding one held grants that class is outside of. The
downgrade does not restore the ranks: nothing recorded which were cleared, and
putting them back would also restore ranks an officer had cleared on purpose.

**You cannot simply set the rank again** — the API refuses an administrative
member with a rank, and the edit screen disables the control. If the rank is
right for that person, change their class first.

### Four upgrade steps take permissions away from seeded positions (2026-08-27)

Each rewrites only the positions the system seeded; nothing grants the
permission back.

| Migration      | Removes              | From                                  |
| -------------- | -------------------- | ------------------------------------- |
| `31e2816df7c3` | `compliance.view`    | Member and Firefighter                |
| `a1f7c34e9b02` | `notifications.view` | Member, Firefighter and Engineer      |
| `e4f5a6b7c8d9` | `facilities.view`    | Member, Firefighter, EMT and Engineer |
| `c7e2b9a41f83` | `facilities.view`    | the chiefs, Captain and Lieutenant    |

`compliance.view` let any member read another member's admin-hours compliance,
and `notifications.view` let any member read the Send Log of every notification
the department had sent. Facilities became a leadership and facility-manager
workspace. If someone still needs one of these, grant it in Role Management.

The chiefs keep `facilities.manage`, so they lose no access.

Two steps **add** grants, again only to seeded rows. `e3b7c25f9a41` gives
`training.configure` to the Membership Coordinator, and to the seeded chief,
officer, president, safety-officer and training-officer positions that still
hold `training.manage`. `c4a91b7e2f08` gives `users.view_consents` (the
photo-use consent roster) to the Communications Officer / PIO, Historian and
Public Outreach positions, but
only where their permissions still match the shipped default — a position your
department edited is left alone.

**Facility files uploaded before this upgrade stay readable department-wide.**
Migration `a9c4e7b2f631` gates the facility document folders on the facilities
permissions, and new uploads are filed into them, but a file already stored
outside those folders is not moved. Re-attach or re-file anything sensitive —
insurance policies, leases, capital project files.

### Who receives a ballot changes (2026-08-26)

A member's single "membership type" became two facts, a **class** and a
**status**. Two ballot categories reach a different set of members:

- A **life** member now receives a `regular` ballot, which they could not
  before.
- An **administrative** member with regular standing **no longer** receives
  ballots restricted to active or life members.

The `operational` category is unchanged: it still requires the operational
class and regular standing. Check the recipient list of your next ballot; to
include administrative voters, use an override or an explicit voter list.

### Three upgrade steps do not reverse (2026-08-26)

None loses data on the way up, and each downgrade is a deliberate no-op,
because putting the old values back would do more damage than leaving them:

- `c3d4e5f6a7b8` recovers members' class and status from the membership
  "positions" onboarding used to create (Probationary, Life and so on). Nothing
  records which members it reclassified, so undoing it would also flatten
  standings a department set by hand. The positions themselves are kept.
- `d7a4e9c31b60` and `e2c8f5a71d40` settle stored crew-seat names onto one
  spelling (`EMT` becomes `ems`, which fixes EMT seats nobody could sign up
  for). Nothing records which spelling a row had.
- `b8d5f0c24a69` adds the administrative-access flag to stored crew seats.
  Older versions read the extra field without complaint.

### Rolling back past the org chart loses every additional holder (2026-08-25)

> **⚠️ This downgrade destroys data.** `a7c93f21d5b8` lets one seat on the
> organizational chart hold several people. Its downgrade restores the
> single-holder shape by keeping **each seat's first holder only**, then drops
> the holders table: every other holder is lost, and a seat whose holders came
> only from a linked position comes back **empty**. If your department has drawn
> its chart and you may roll back, write the holders down first.

### Equipment-check item types collapse from nine to four, and it does not reverse (2026-08-23)

Migration `c3f81a4d5e72` turns the old check types into four — **Level**,
**Function**, **Count** and **Expiry** (Pass/Fail, Present and Functional all
become Function; Reading joins Level). Headings and free text are untouched. It
also writes default instructions into items that had none, and leaves any
description an author wrote alone.

The downgrade leaves the types collapsed. Nothing records which of three old
names a Function item started as, and **a wrong guess renders the wrong control
on a safety checklist.** No data is lost either way.

### ID cards, label printers and the new columns start empty (2026-08-23)

- **NFC ID cards are off** until turned on at **Settings → Integrations → NFC ID
  Cards**. Grant `members.manage_id_cards` to whoever issues cards and
  `members.check_in` to whoever runs a check-in station; the upgrade grants
  neither.
- **Register your label printers** before anyone tries to print, and set
  `LABEL_PRINTER_ALLOWED_NETWORKS` — see
  [Direct label printing needs an approved network](#direct-label-printing-needs-an-approved-network-2026-09-14).
- **Several new columns deliberately start empty**, and an empty value is not a
  failed upgrade: no compartment is sealed, no earlier check-in has an
  early-arrival figure, earlier QR check-ins stay recorded as `qr_scan`,
  training submitted before this has no start time, existing email templates
  keep their own colours, no standing shift claims are inferred from anyone's
  assignments, and a department with no metric preferences gets the built-in
  metrics on each administration page.

### Two access rules tighten for officers (2026-08-23)

- **Screening compliance needs `medical_screening.view`.** Officers who saw
  medical-screening compliance on the Members administration page through
  `members.manage` alone now see it reading _unknown_, with an empty queue,
  until they hold it.
- **Schedulers are held to position eligibility.** Assigning a member to a seat
  their rank is not cleared for is refused, with the missing qualification
  named — the same rule members already met when claiming a seat.

### Seat lists and equipment checks: two steps that do not reverse (2026-08-22)

Neither loses data:

- `1eeb053d59b7` rewrites every stored seat list into one shape, expanding a
  legacy crew **count** into that many seats. Its downgrade is a no-op: the
  original count cannot be recovered from the seats, and both old and new code
  read the new shape.
- `a17c4e9d2b61` allows one equipment check per shift per template. Historical
  duplicates are detached from their shift, not deleted, and their item
  snapshots are kept. The downgrade cannot re-attach them.

**Do not downgrade past both `d6f4a13c9e20` and `4c8d7e2a91b3`.** Both widen
`shift_equipment_check_items.compartment_name` to `TEXT`; downgrading past the
second narrows it back and truncates deep compartment paths (SCHEMA-1 in
[Known Limitations](./KNOWN_LIMITATIONS.md)).

Three further migrations in this window (`7ed8593bc904`, `5c2f6a8b1d34`,
`9f6d1c2a4b70`) repair databases that were stamped as having run work they
never ran, after earlier revisions were renumbered. On a healthy database they
do nothing.

### Legal Documents and swap approval change who can do what (2026-08-20)

- **Governance → Legal Documents** needs `legal.propose` to draft and
  `legal.publish` to publish. Migration `06adc68a8b84` grants `legal.propose` to
  every position holding `settings.view` and `legal.publish` to every position
  holding `settings.manage`. Review who that reaches before anyone drafts.
- **Nobody can review a swap or time-off request they are part of**, even with
  `scheduling.manage`. If exactly one person holds `scheduling.manage` and they
  also request swaps, their own requests will wait — grant a second person.

### Rooms can nest, storage areas get barcodes, and suppliers become vendors (2026-08-16)

- `20260816_0001` lets a facility room sit inside another. Existing rooms stay
  top-level.
- `20260816_0002` gives every storage area without a barcode the next code in
  the department's `SA-` series. Codes already in use, including on retired
  areas, are skipped.
- `20260816_0003` creates one inventory vendor for every distinct free-text
  supplier name (ignoring case) and links the items and reorders that named it.
  `Galls` and `Galls Inc.` become two vendors; merge them by hand if they are
  one.

## When adding a change that can block startup

Anything that can stop an existing deployment from booting — a new critical, a
default flipped toward fail-closed, a newly enforced flag — needs an entry in
this file naming the setting and both ways out. A fresh install passing is not
evidence: these failures only ever appear on installations that already
existed.

This file is the operator-facing record and is **not** covered by the changelog
freeze: it is per-change prose that concurrent branches rarely land on at the
same offset, and an operator upgrading has nowhere else to read it.
