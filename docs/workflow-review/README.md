# Workflow Review — Activity by Activity, in a Real Browser

A rotating review of **what people actually do** in The Logbook. Each run takes
one activity — adding a member, submitting a training record, signing up for a
shift, issuing a jacket — launches the real application against a real
database, and carries the activity out in a browser as the people who do it.

The [application review](../app-review/README.md) reads code. This one uses the
product. The two find different things: a screen can be correct line by line
and still send an officer in a circle, show a success toast over a request that
failed, or refuse a member who should be allowed in. Those only show up when
someone clicks through.

## How it runs

One run = **one activity**, finished completely.

```
/workflow-review            # the next pending activity, then stop
/workflow-review W23        # a specific activity
/loop /workflow-review      # one after another until the list is done
```

`/workflow-review` (see
[`.claude/commands/workflow-review.md`](../../.claude/commands/workflow-review.md))
is the unit of work.

## The files

| File                             | Purpose                                                                |
| -------------------------------- | ---------------------------------------------------------------------- |
| [`PROGRESS.md`](./PROGRESS.md)   | The activity inventory, in risk order, with status and the running log |
| [`CHECKLIST.md`](./CHECKLIST.md) | What every run checks, whatever the activity                           |
| [`_TEMPLATE.md`](./_TEMPLATE.md) | The shape of a per-activity findings file                              |
| `W<nn>-<slug>.md`                | One per completed activity: what was driven, what held, what was found |

## The harness

Everything lives under `scripts/workflow-review/` and keeps its state in
`.workflow-review/` at the repository root (gitignored: generated keys, seeded
passwords, browser sessions, logs, screenshots).

| Script       | What it does                                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `start.sh`   | Builds the schema in a dedicated database and starts the backend (`:3001`) and the Vite dev server (`:3000`)            |
| `seed.mjs`   | Onboards a department through the setup screens, enables every module, and creates one signed-in account per role below |
| `driver.mjs` | Keeps one browser open and runs each script it is sent, reporting console errors, page errors and failed API calls      |
| `send.sh`    | Sends a script from stdin to the driver and prints the JSON result                                                      |

```sh
scripts/workflow-review/start.sh --reset     # fresh install (drops the review database)
node scripts/workflow-review/seed.mjs         # about six minutes; paced by the login rate limit
node scripts/workflow-review/driver.mjs &     # the browser
echo 'await wr.as("member"); await wr.go("/training/submit"); return wr.text("main")' \
  | scripts/workflow-review/send.sh
scripts/workflow-review/start.sh --stop      # stop the servers and the driver
```

**It never touches the application or test database.** The review runs in
`logbook_workflow_review` (override with `WR_DB_NAME`) and Redis db 3
(`WR_REDIS_DB`). The backend and Vite dev server listen on `WR_BACKEND_PORT`
(default 3001) and `WR_FRONTEND_PORT` (default 3000), and run state lives in
`WR_STATE_DIR` (default `.workflow-review/`). A review onboards a department, and an organization left in
`intranet_db` makes the onboarding tests fail with "An organization has already
been created". `start.sh` refuses a `WR_DB_NAME` equal to `DB_NAME`.

Connection settings are read from the environment as the backend reads them
(`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `REDIS_*`). The encryption
key, salt and secret key are generated on first run and kept in
`.workflow-review/keys.env`: data encrypted under one key cannot be read under
the next, so they must survive a restart. `--reset` keeps them.

`start.sh` without `--reset` keeps the data: activities build on each other (the
members added in W08 are the members scheduled in W32), so a run resets only
when the database is in a state no later run can use.

### Who a run can act as

| Role                     | Positions held                | Rank              |
| ------------------------ | ----------------------------- | ----------------- |
| `admin`                  | IT Manager (the system owner) | —                 |
| `chief`                  | Chief                         | Chief             |
| `training_officer`       | Training Officer              | Captain           |
| `secretary`              | Secretary                     | Lieutenant        |
| `treasurer`              | Treasurer                     | Firefighter       |
| `quartermaster`          | Quartermaster                 | Firefighter       |
| `scheduling_officer`     | Scheduling Officer            | Lieutenant        |
| `membership_coordinator` | Membership Coordinator        | Firefighter       |
| `member`, `member2`      | Regular Member only           | Firefighter / EMT |

Every account also holds the baseline Regular Member position, and ten more
members with no sign-in fill out the roster. Each account is created by the
administrator through `POST /users`, then signs in once and replaces its
password on the forced-change screen — the path a real member takes — so a
seed that fails is a finding about those screens, not a fixture problem.

`wr.as(role)` resumes a saved session, refreshes it if only the access token
has lapsed, and signs in afresh when the session is gone. It usually is by the
next run: the server ends a session after 15 idle minutes
(`HIPAA_SESSION_TIMEOUT_MINUTES`). Sign-ins are limited to five a minute per
address, so the driver spaces sign-ins 13 seconds apart — across every driver
on the machine, not only its own: the moment of the last sign-in is kept in
`.workflow-review/last-signin` and taken under a lock. A test that
deliberately trips the limit, or locks an account, should clear what it left
behind — the `rate_limit:auth:login:*` and `suspicious_ip:*` keys in Redis
db 3, and the account's `failed_login_attempts` / `locked_until` — so the next
run can sign in (see W02).

**A second driver** lets one browser carry an activity while another checks
it from the other side — a member's view of what an officer just did, a
refusal probe, the phone viewport — without either losing the page it is on.
Give it its own state directory holding copies of `env.json` and
`accounts.json` (no `auth-*.json`, so its sessions are its own and one
driver's token refresh cannot invalidate the other's), its own port, and the
first driver's pace file:

```sh
mkdir -p /tmp/wr-b && cp .workflow-review/env.json .workflow-review/accounts.json /tmp/wr-b/
WR_STATE_DIR=/tmp/wr-b WR_DRIVER_PORT=9556 \
  WR_SIGNIN_PACE_FILE=$PWD/.workflow-review/last-signin \
  node scripts/workflow-review/driver.mjs &
echo 'await wr.as("member"); return wr.text("h1")' \
  | WR_STATE_DIR=/tmp/wr-b WR_DRIVER_PORT=9556 scripts/workflow-review/send.sh
```

The public ballot endpoints have their own per-address limits (ten lookups
and five submissions a minute, `rate_limit:auth:ballot_read:*` and
`rate_limit:auth:ballot_vote:*` in Redis db 3), and two drivers share them
the same way.

### What a script can use

A script sent to the driver is the body of an async function receiving `wr`:

| Helper                        | Does                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| `wr.page`                     | The current Playwright page                                                               |
| `wr.as(role, viewport?)`      | A browser signed in as that role; pass `{ width: 390, height: 844 }` to review on a phone |
| `wr.fresh(viewport?)`         | A signed-out browser                                                                      |
| `wr.login(role)`              | Sign in through the login screen and save the session                                     |
| `wr.go(path)`                 | Navigate and wait for the network to settle; returns where the app landed                 |
| `wr.text(selector?, max?)`    | The visible text of the page or of one element                                            |
| `wr.shot(name)`               | A full-page screenshot in `.workflow-review/shots/`                                       |
| `wr.api(method, path, body?)` | An API call as the signed-in user, CSRF header included                                   |
| `wr.accounts()`               | The seeded accounts                                                                       |

The result comes back with `events`: every console error, uncaught page error,
and `/api/` response of 400 or above since the previous script. Read them on
every step. A screen that looks right while a request behind it failed is the
most common thing this review exists to catch.

## What a run may change

The same contract as the [application review](../app-review/README.md):

- **Fix** what is clearly broken and verifiable — a button that does nothing, a
  field whose value never reaches the API, an unlabeled input, a toast that
  claims success over a failure. Every fix gets a regression test at the lowest
  level that reproduces it (a Vitest component test, a pytest).
- **Flag** anything that changes behaviour someone may rely on, needs a
  migration, or needs a product decision. Write it up so the owner can decide.
- **Never** silence an error. The [CLAUDE.md completion gate](../../CLAUDE.md)
  applies to every run.

## Finding IDs

`W<nn>-<n>`, numbered within the activity: `W08-3` is the third finding from
adding a member. Severity is **CRITICAL / HIGH / MED / LOW / NIT**, scored by
what happens to the department, not by how hard the fix is: a member who cannot
sign in is HIGH however small the patch.
