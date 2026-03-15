# Script 1: Installing The Logbook — From Zero to Running

**Video Type:** Deep Dive
**Estimated Length:** 20–25 minutes
**Target Audience:** IT administrators, self-hosters, technically comfortable members
**Chapters:** 7 (each cuttable as a standalone clip)

---

## CHAPTER 1: Introduction (0:00 – 1:30)

### HOOK (0:00 – 0:30)

**[SCREEN: The Logbook dashboard fully loaded — events, member stats, scheduling
calendar all visible. Quick montage of clicking through different modules.]**

> "What if your fire department had one platform for everything — events,
> training records, scheduling, member management, elections, documents — all
> running on hardware you own, with your data staying right where it belongs?
> That's The Logbook. And in the next twenty minutes, I'm going to show you
> exactly how to install it — whether you're running it on a Raspberry Pi in the
> engine bay, a server in your closet, or a cloud VM."

### OVERVIEW (0:30 – 1:30)

**[SCREEN: Show the series overview / table of contents slide.]**

> "The Logbook is a free, open-source intranet platform built specifically for
> fire departments and emergency services. It's a full-stack application — React
> on the frontend, Python FastAPI on the backend, with MySQL and Redis under the
> hood. But you don't need to know any of that to install it. Docker handles
> everything."

> "Here's what we'll cover today:"

**[CALLOUT: Numbered list appearing one by one]**

> "One — what you need before you start. Two — the one-line install for people
> who just want it running. Three — the manual Docker setup for those who want
> to understand what's happening. Four — choosing the right installation profile
> for your hardware. Five — environment configuration. Six — verifying
> everything works. And seven — what comes next."

> "Let's get into it."

**[TRANSITION: Wipe to terminal screen]**

---

## CHAPTER 2: Prerequisites (1:30 – 4:00)

### HARDWARE REQUIREMENTS (1:30 – 2:30)

**[SCREEN: Side-by-side comparison table on screen]**

> "First, let's talk about what you need. The Logbook is designed to run on
> pretty much anything — from a Raspberry Pi 4 to a full cloud server. Here are
> the minimum specs."

**[CALLOUT: Table showing three tiers]**

| | Minimal | Standard | Full |
|---|---------|----------|------|
| **RAM** | 1–2 GB | 4 GB | 8+ GB |
| **CPU** | 2 cores | 2+ cores | 4+ cores |
| **Storage** | 10 GB | 20 GB | 50+ GB |
| **Best for** | Raspberry Pi, small VPS | Most departments | Large orgs, all features |

> "If you're running a department of under fifty members, the minimal or
> standard profile will be more than enough. The full profile adds
> Elasticsearch for advanced search and MinIO for S3-compatible file storage —
> nice to have, but not required."

### SOFTWARE REQUIREMENTS (2:30 – 4:00)

**[SCREEN: Terminal showing `docker --version` and `docker compose version`
commands]**

> "On the software side, you need exactly two things: Docker and Docker Compose.
> That's it. The application, the database, the cache layer — everything runs in
> containers."

> "If you're on a modern Linux distro, macOS, or Windows with WSL2, Docker
> Desktop or Docker Engine will work. Let me show you how to check."

**[SCREEN: Type and run the following commands, showing version output]**

```bash
docker --version
docker compose version
```

> "You'll want Docker 20 or newer and Docker Compose v2. If you don't have
> these installed yet, Docker's official documentation has guides for every
> operating system. I'll link those in the description."

> "For the one-line installer, you'll also need `curl` and `git`, which come
> pre-installed on most systems."

**[SCREEN: Quickly show `curl --version` and `git --version`]**

> "If you're on a Raspberry Pi, make sure you're running the 64-bit version of
> Raspberry Pi OS. The 32-bit version won't work with the database container."

**[CALLOUT: "Raspberry Pi users: Use 64-bit OS (ARM64)"]**

**[TRANSITION: Slide wipe to clean terminal]**

---

## CHAPTER 3: One-Line Install (4:00 – 7:30)

### THE EASY PATH (4:00 – 5:00)

**[SCREEN: Clean terminal, empty prompt]**

> "Alright, let's start with the simplest possible path. If you just want The
> Logbook running and you don't care about the internals yet, this is for you.
> One command. That's it."

**[SCREEN: Type the command slowly, character by character for readability]**

```bash
curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/scripts/universal-install.sh | bash
```

> "This universal install script detects your operating system, your
> architecture, checks for Docker, clones the repository, generates secure
> passwords and encryption keys, and starts everything up. It works on Linux,
> macOS, and Windows WSL2."

### WATCHING THE INSTALL (5:00 – 6:30)

**[SCREEN: Run the actual install command. Show the output scrolling. Highlight
key sections with callouts as they appear.]**

> "Let's watch it run. You'll see it first checking for dependencies..."

**[CALLOUT: Arrow pointing to "Checking Docker..." output line]**

> "Then it clones the repository..."

**[CALLOUT: Arrow pointing to git clone output]**

> "Now it's generating your security keys — a JWT signing key, an AES-256
> encryption key, and a salt for key derivation. These are all cryptographically
> random and unique to your installation."

**[CALLOUT: Arrow pointing to "Generating secrets..." output]**

> "And now it's pulling the Docker images and starting the services. This part
> takes a few minutes the first time because it needs to download the container
> images — MySQL, Redis, the application itself."

**[SCREEN: Speed up the Docker pull/build section with a clock overlay or
fast-forward indicator]**

> "I'll fast-forward through the image downloads. On a decent internet
> connection, this takes two to five minutes."

### CHOOSING A PROFILE (6:30 – 7:30)

> "By default, the installer uses the 'standard' profile. But if you're on
> limited hardware — say a Raspberry Pi or a small VPS with only one or two gigs
> of RAM — you can specify the minimal profile."

**[SCREEN: Show the command with the profile flag]**

```bash
curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/scripts/universal-install.sh | bash -s -- --profile minimal
```

> "The minimal profile reduces memory limits on all services — MySQL gets 128
> megabytes instead of 256, Redis gets 96 instead of 128, and the backend runs a
> single worker instead of multiple. It's everything you need, just tuned for
> constrained hardware."

> "There's also a 'full' profile for larger departments that want Elasticsearch
> and MinIO."

**[CALLOUT: Three boxes showing: "minimal (1–2 GB)" → "standard (4 GB)" → "full (8+ GB)"]**

**[TRANSITION: Fade to next section]**

---

## CHAPTER 4: Manual Docker Setup (7:30 – 13:00)

### WHY GO MANUAL? (7:30 – 8:00)

> "The one-line install is great, but maybe you want to understand what's
> actually happening under the hood, or you want to customize things before
> starting up. Let's walk through the manual setup step by step."

### CLONE THE REPOSITORY (8:00 – 8:30)

**[SCREEN: Clean terminal]**

```bash
git clone https://github.com/thegspiro/the-logbook.git
cd the-logbook
```

> "First, clone the repository and change into the directory. Everything lives
> in this one folder."

**[SCREEN: Run the commands. Show the directory listing briefly with `ls`.]**

### ENVIRONMENT FILE (8:30 – 11:00)

> "Next, we need to create our environment file. This is where all your
> passwords, encryption keys, and configuration live. The Logbook ships with two
> example files."

**[SCREEN: Show both files side by side in a text editor or terminal]**

```bash
ls .env.example .env.example.full
```

> "The `.env.example` file has about thirty variables and takes five minutes to
> set up. It's all you need for most deployments. The `.env.example.full` file
> has over a hundred variables and covers everything — OAuth providers, LDAP,
> Twilio SMS, Sentry monitoring, HIPAA compliance tuning. We'll start with the
> simple one."

**[SCREEN: Copy the example file]**

```bash
cp .env.example .env
```

> "Now let's generate our security keys. Never use the placeholder values in
> production — these need to be unique, random strings."

**[SCREEN: Run each command, showing the output]**

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(64))"
python3 -c "import secrets; print(secrets.token_hex(32))"
python3 -c "import secrets; print(secrets.token_hex(16))"
```

> "That first one is your JWT signing key — 64 characters of URL-safe random
> data. The second is your AES-256 encryption key — a 64-character hex string.
> The third is your encryption salt. Copy each of these into your `.env` file."

**[SCREEN: Open `.env` in a text editor (nano or vim). Show replacing the
`CHANGE_ME` values one by one.]**

> "Open up the `.env` file and replace each `CHANGE_ME` placeholder. Let me walk
> through the important sections."

**[CALLOUT: Highlight each section as you scroll through]**

> "**Security keys** — we just generated these. Paste them in."

> "**Database credentials** — set a strong password for both the MySQL root user
> and the application user. These can be different passwords."

> "**Redis password** — same idea. Strong, random password."

> "**ALLOWED_ORIGINS** — this is critical for security. Set this to the URL
> where your members will access The Logbook. If it's running on your local
> network, that might be something like `http://192.168.1.50:3000`. For a
> domain, it would be `https://logbook.yourdepartment.org`."

> "**Timezone** — set `TZ` to your IANA timezone. For example,
> `America/New_York`, `America/Chicago`, or `America/Los_Angeles`."

> "**Module toggles** — these are the feature flags. Everything is enabled by
> default, but you can disable modules you don't need. For instance, if your
> department doesn't run elections through the platform, set
> `MODULE_ELECTIONS_ENABLED=false`."

**[CALLOUT: Show a few module toggle lines highlighted]**

### START THE SERVICES (11:00 – 12:00)

> "With the environment file configured, we're ready to start."

**[SCREEN: Run the Docker Compose command]**

```bash
docker compose up -d
```

> "The `-d` flag runs everything in the background. Docker will pull the images
> if needed, create the containers, set up the network between them, and start
> everything."

**[SCREEN: Show the output — services starting one by one. Highlight the
service names: mysql, redis, backend, frontend.]**

> "You can see each service starting — MySQL first, then Redis, then the backend
> waits for both of those to be healthy before it starts, and the frontend waits
> for the backend. This health-check chain ensures everything comes up in the
> right order."

### VERIFY THE SERVICES (12:00 – 13:00)

> "Let's verify everything is running."

**[SCREEN: Run status commands]**

```bash
docker compose ps
```

> "All services should show 'Up' and 'healthy'. If the backend shows
> 'starting', give it another thirty seconds — it runs database migrations on
> first boot."

**[SCREEN: Show the `docker compose ps` output with all services healthy]**

> "You can also check the logs if anything looks off."

```bash
docker compose logs backend --tail 50
```

> "Look for a line that says 'Application startup complete' or 'Uvicorn running
> on' — that means the backend is ready."

**[CALLOUT: Arrow pointing to the startup complete line in logs]**

**[TRANSITION: Smooth transition to next chapter]**

---

## CHAPTER 5: Platform-Specific Notes (13:00 – 16:00)

### RASPBERRY PI (13:00 – 14:00)

**[B-ROLL: Raspberry Pi 4/5 board, optionally in a fire station setting]**

> "If you're running this on a Raspberry Pi — which is a fantastic option for
> small departments — there are a couple of extra things to know."

> "First, use the ARM compose override files."

**[SCREEN: Show the command]**

```bash
docker compose -f docker-compose.yml \
  -f docker-compose.minimal.yml \
  -f docker-compose.arm.yml \
  up -d
```

> "This stacks three compose files: the base configuration, the minimal memory
> settings, and the ARM overrides. The ARM file switches from MySQL to MariaDB,
> which has better ARM64 support and lower memory usage."

> "Second, I'd recommend using an SSD instead of an SD card for the database.
> SD cards can wear out from frequent writes, and the database does a lot of
> writing. A USB-attached SSD is cheap and reliable."

### CLOUD DEPLOYMENT (14:00 – 15:00)

> "For cloud deployments — AWS, Azure, Google Cloud, DigitalOcean — the setup is
> essentially the same, just on a VM instead of local hardware."

**[CALLOUT: Quick list of supported platforms]**

> "The key differences for cloud: make sure your firewall only exposes ports 80
> and 443 to the internet. The database and Redis ports should never be
> publicly accessible. The Logbook includes an Nginx reverse proxy in the
> 'production' Docker profile."

**[SCREEN: Show enabling the production profile]**

```bash
docker compose --profile production up -d
```

> "This starts the Nginx container which handles SSL termination and proxies
> requests to the frontend and backend. You'll need to set up your SSL
> certificates — Let's Encrypt with Certbot is the easiest free option."

### UNRAID & NAS (15:00 – 16:00)

> "For Unraid and NAS users, there's a one-command setup specifically optimized
> for those platforms."

**[SCREEN: Show the Unraid quick-start command]**

> "The Unraid template pre-configures the Docker network, volume mappings, and
> resource limits to play nicely with other containers on your NAS. Check the
> Unraid quick-start guide in the repository for the full walkthrough."

**[CALLOUT: "See: unraid/QUICK-START.md in the repository"]**

**[TRANSITION: Cut to verification section]**

---

## CHAPTER 6: Verifying Your Installation (16:00 – 19:00)

### OPEN THE APPLICATION (16:00 – 17:00)

> "Alright, everything should be running. Let's open it up."

**[SCREEN: Open a web browser. Navigate to `http://localhost:3000` (or your
server's IP).]**

> "Open your browser and go to your server's address on port 3000. If you're
> running locally, that's `localhost:3000`. On your network, it'll be your
> server's IP address — something like `192.168.1.50:3000`."

**[SCREEN: The Logbook login page / onboarding page loads.]**

> "And there it is. If this is a fresh install, you'll see the onboarding wizard
> instead of a login page. We'll walk through that entire setup process in the
> next video."

**[CALLOUT: "Next video: First-Time Setup & Onboarding Walkthrough"]**

### CHECK THE API (17:00 – 17:30)

> "While we're here, let's verify the backend API is responding."

**[SCREEN: Navigate to `http://localhost:3001/docs`]**

> "Navigate to port 3001 slash docs. This is the FastAPI interactive
> documentation. If you see this page with all the API endpoints listed, your
> backend is running correctly."

**[SCREEN: Show the Swagger UI page briefly, scroll through some endpoints]**

> "This page is great for debugging and understanding the API, but you'll want
> to disable it in production by setting `ENABLE_DOCS=false` in your environment
> file."

### HEALTH CHECK (17:30 – 18:00)

> "There's also a dedicated health check endpoint."

**[SCREEN: Navigate to `http://localhost:3001/health` or curl it]**

```bash
curl http://localhost:3001/health
```

> "If you get back a JSON response with a status of 'healthy', your backend,
> database connection, and Redis connection are all working."

### COMMON ISSUES (18:00 – 19:00)

> "Let me quickly cover the three most common installation issues I see."

**[CALLOUT: Issue #1]**

> "**Number one: Port conflicts.** If you already have something running on port
> 3000, 3001, 3306, or 6379, Docker will fail to bind. Check with
> `docker compose logs` and change the ports in your `.env` file if needed."

**[CALLOUT: Issue #2]**

> "**Number two: The backend keeps restarting.** This usually means the database
> isn't ready yet. The health check system handles this automatically, but on
> very slow hardware it can take up to a minute. Check
> `docker compose logs backend` — if it says 'waiting for database,' just give
> it time."

**[CALLOUT: Issue #3]**

> "**Number three: Permission errors on Linux.** If Docker commands fail with
> permission denied, make sure your user is in the `docker` group:
> `sudo usermod -aG docker $USER` — then log out and back in."

**[TRANSITION: Fade to conclusion]**

---

## CHAPTER 7: What's Next (19:00 – 20:30)

**[SCREEN: Show the Logbook onboarding welcome screen]**

> "You now have a running instance of The Logbook. But we haven't configured it
> for your department yet — that's the onboarding process, and it's where things
> get exciting."

> "In the next video, I'll walk you through the entire first-time setup: naming
> your organization, creating your admin account, configuring stations and
> apparatus, setting up member roles, and enabling the modules your department
> needs."

**[CALLOUT: Playlist card showing next video]**

> "If you want to jump ahead and explore on your own, go for it — the onboarding
> wizard is designed to be intuitive. But if you want a guided walkthrough with
> tips on best practices, that next video has you covered."

> "If you run into any issues, the GitHub repository has discussions and issue
> tracking. The Logbook is open source and community-supported, so don't
> hesitate to ask questions or report bugs."

**[SCREEN: Show GitHub repository URL briefly]**

> "Thanks for watching. If this was helpful, hit subscribe — we've got a full
> series covering every role in the department, from Fire Chief to the newest
> member. I'll see you in the next one."

**[SCREEN: End card with subscribe button, next video link, and playlist
link.]**

---

## Clip Extraction Guide

The following segments can be cut into standalone short videos:

| Clip | Timecode | Standalone Title |
|------|----------|-----------------|
| One-Line Install | 4:00–7:30 | "Install The Logbook in One Command" |
| Environment Setup | 8:30–11:00 | "Configuring The Logbook Environment File" |
| Raspberry Pi Setup | 13:00–14:00 | "Running The Logbook on a Raspberry Pi" |
| Troubleshooting | 18:00–19:00 | "3 Common Install Issues (and How to Fix Them)" |
