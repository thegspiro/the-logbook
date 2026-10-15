# Building and Publishing Docker Images to GitHub Container Registry

The project does not publish Docker images: no CI workflow builds or pushes
them, and every shipped compose file — including the Unraid ones, which tag
their builds `the-logbook-backend:local` / `the-logbook-frontend:local` —
builds the backend and frontend on the host that runs them.

This guide is for an operator who wants to publish their own images to GitHub
Container Registry (ghcr.io) by hand — for example, to build once on a fast
machine and run the result on a slower server. `scripts/build-and-push-images.sh`
automates Steps 4-5 (it takes an optional tag argument, defaulting to
`latest`). It pushes to the `ghcr.io/thegspiro/` namespace, which needs write
access to that account; to publish under your own account, change
`GITHUB_USERNAME` at the top of the script and the `thegspiro` in the commands
below.

## Prerequisites

- Docker installed on your development machine (Mac, Windows, or Linux)
- GitHub account with access to the `thegspiro/the-logbook` repository
- GitHub Personal Access Token with `write:packages` permission

---

## Step 1: Create GitHub Personal Access Token

1. Go to GitHub Settings → Developer settings → Personal access tokens → **Tokens (classic)**
   - URL: https://github.com/settings/tokens

2. Click **"Generate new token"** → **"Generate new token (classic)"**

3. Configure the token:
   - **Note**: `Docker Package Publishing` (or similar description)
   - **Expiration**: 90 days or longer
   - **Scopes**: Check these boxes:
     - ✅ `write:packages` - Upload packages to GitHub Package Registry
     - ✅ `read:packages` - Download packages from GitHub Package Registry
     - ✅ `delete:packages` - Delete packages from GitHub Package Registry (optional)

4. Click **"Generate token"**

5. **IMPORTANT**: Copy the token immediately (it won't be shown again)
   - Example: `ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890`

---

## Step 2: Authenticate Docker with GitHub Container Registry

On your development machine, run:

```bash
# Login to GitHub Container Registry
echo YOUR_GITHUB_TOKEN | docker login ghcr.io -u thegspiro --password-stdin

# Example (replace with your actual token):
# echo ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890 | docker login ghcr.io -u thegspiro --password-stdin
```

You should see:

```
Login Succeeded
```

---

## Step 3: Clone the Repository (if not already done)

```bash
# Clone the repository
git clone https://github.com/thegspiro/the-logbook.git
cd the-logbook

# Or if already cloned, pull latest changes
git pull origin main
```

---

## Step 4: Build and Push Backend Image

```bash
# Navigate to backend directory
cd backend

# Build the backend image (this may take 5-10 minutes)
docker build --target production -t ghcr.io/thegspiro/the-logbook-backend:latest .

# Optional: Test the backend image locally
# docker run -p 3001:3001 --env-file .env ghcr.io/thegspiro/the-logbook-backend:latest

# Push the backend image to GitHub Container Registry
docker push ghcr.io/thegspiro/the-logbook-backend:latest

# Navigate back to project root
cd ..
```

**Expected output:**

```
[+] Building 123.4s (15/15) FINISHED
 => [internal] load build definition from Dockerfile
 => [internal] load .dockerignore
 => [production 1/6] COPY main.py .
 => [production 2/6] COPY app/ ./app/
 ...
 => exporting to image
 => => writing image sha256:abc123...
 => => naming to ghcr.io/thegspiro/the-logbook-backend:latest

The push refers to repository [ghcr.io/thegspiro/the-logbook-backend]
latest: digest: sha256:xyz789... size: 1234
```

---

## Step 5: Build and Push Frontend Image

```bash
# Run from the repository root — the frontend image installs from the npm
# workspace lockfile at the root, so the root must be the build context.
cd /path/to/the-logbook

# Build the frontend image (this may take 10-15 minutes)
docker build -f frontend/Dockerfile --target production -t ghcr.io/thegspiro/the-logbook-frontend:latest .

# Optional: Test the frontend image locally
# docker run -p 3000:80 ghcr.io/thegspiro/the-logbook-frontend:latest

# Push the frontend image to GitHub Container Registry
docker push ghcr.io/thegspiro/the-logbook-frontend:latest
```

**Expected output:**

```
[+] Building 234.5s (18/18) FINISHED
 => [build 1/6] COPY package*.json ./
 => [build 2/6] RUN npm ci
 => [build 3/6] COPY . .
 => [build 4/6] RUN npm run build
 => [production 1/3] COPY nginx.conf /etc/nginx/conf.d/default.conf
 ...
 => exporting to image
 => => writing image sha256:def456...
 => => naming to ghcr.io/thegspiro/the-logbook-frontend:latest

The push refers to repository [ghcr.io/thegspiro/the-logbook-frontend]
latest: digest: sha256:uvw901... size: 2345
```

---

## Step 6: Make Images Public (Optional)

By default, GitHub Container Registry images are **private**. Make them public if the host that runs them should pull without logging in.

1. Go to your GitHub profile → **Packages** tab
   - URL: https://github.com/thegspiro?tab=packages

2. You should see two packages:
   - `the-logbook-backend`
   - `the-logbook-frontend`

3. For **each package**:
   - Click on the package name
   - Click **"Package settings"** (right sidebar)
   - Scroll down to **"Danger Zone"**
   - Click **"Change visibility"**
   - Select **"Public"**
   - Type the package name to confirm
   - Click **"I understand the consequences, change package visibility"**

---

## Step 7: Verify Images are Accessible

```bash
# Test pulling the backend image (no login required if public)
docker pull ghcr.io/thegspiro/the-logbook-backend:latest

# Test pulling the frontend image (no login required if public)
docker pull ghcr.io/thegspiro/the-logbook-frontend:latest
```

If both commands succeed, your images are ready!

---

## Step 8: Run the Published Images

No shipped compose file references these images, so point yours at them. On
the host that runs the stack, add a `docker-compose.override.yml` (git-ignored,
and merged automatically when neither `-f` nor `COMPOSE_FILE` names the files)
next to `docker-compose.yml`:

```yaml
services:
  backend:
    image: ghcr.io/thegspiro/the-logbook-backend:latest
  frontend:
    image: ghcr.io/thegspiro/the-logbook-frontend:latest
```

If `.env` pins `COMPOSE_FILE` (the installers' production setup does), append
`:docker-compose.override.yml` to it instead of relying on the automatic merge.
Then pull and start:

```bash
docker compose pull backend frontend
docker compose up -d --no-build
```

---

## Troubleshooting

### "denied: permission_denied" error

**Problem**: GitHub Container Registry is denying access.

**Solutions**:

1. Make sure images are set to **Public** (Step 6)
2. If private, log in on the host that pulls them:
   ```bash
   echo YOUR_GITHUB_TOKEN | docker login ghcr.io -u thegspiro --password-stdin
   docker compose pull backend frontend
   ```

### "manifest unknown" error

**Problem**: Image doesn't exist or tag is wrong.

**Solutions**:

1. Verify image was pushed successfully (check Step 4 & 5 output)
2. Check package exists on GitHub: https://github.com/thegspiro?tab=packages
3. Verify tag name is `latest`

### Build fails with "No such file or directory"

**Problem**: Missing files in build context.

**Solutions**:

1. Make sure you're in the correct directory: `backend/` for the backend image, the repository root for the frontend image (it builds with `-f frontend/Dockerfile .`)
2. Check that all required files exist (main.py, app/, package.json, etc.)
3. Pull latest code: `git pull origin main`
4. If you build through a compose file rather than these `docker build` commands, check the contexts it declares against the Dockerfiles: `./scripts/sync-compose-build-context.sh -f docker-compose.yml` (add `--fix` to repair them in place). `docker compose config` validates YAML and interpolation only and never opens the Dockerfile, so a stale context passes validation and fails the build — the frontend's `"/frontend/nginx.conf": not found` is this.

### Images too large / build takes forever

**Problem**: Docker build is slow or images are very large.

**Solutions**:

1. Check your internet connection (npm install downloads packages)
2. Use BuildKit for faster builds:
   ```bash
   export DOCKER_BUILDKIT=1
   docker build ...
   ```
3. Clean up Docker cache periodically:
   ```bash
   docker system prune -a
   ```

### "authentication required" when pulling

**Problem**: The host can't pull images even though they're public.

**Solutions**:

1. Wait a few minutes for GitHub to update visibility settings
2. Try logging out and pulling again:
   ```bash
   docker logout ghcr.io
   docker pull ghcr.io/thegspiro/the-logbook-backend:latest
   ```

---

## Quick Reference Commands

```bash
# Build and push everything (run from project root)
docker build -f backend/Dockerfile --target production -t ghcr.io/thegspiro/the-logbook-backend:latest ./backend
docker push ghcr.io/thegspiro/the-logbook-backend:latest
# Frontend builds from the repository root — it installs from the workspace
# lockfile there, which is outside frontend/.
docker build -f frontend/Dockerfile --target production -t ghcr.io/thegspiro/the-logbook-frontend:latest .
docker push ghcr.io/thegspiro/the-logbook-frontend:latest

# On the host that runs them (with the Step 8 override in place)
docker compose pull backend frontend
docker compose up -d --no-build
```

---

## Updating Images

When you make code changes and want to update the images:

```bash
# Pull latest code
git pull origin main

# If you build via compose, reconcile its contexts with the pulled Dockerfiles
./scripts/sync-compose-build-context.sh --fix -f docker-compose.yml

# Rebuild and push backend
docker build -f backend/Dockerfile --target production -t ghcr.io/thegspiro/the-logbook-backend:latest ./backend
docker push ghcr.io/thegspiro/the-logbook-backend:latest

# Rebuild and push frontend (root context — see above)
docker build -f frontend/Dockerfile --target production -t ghcr.io/thegspiro/the-logbook-frontend:latest .
docker push ghcr.io/thegspiro/the-logbook-frontend:latest

# On the host that runs them, pull the new images and restart
docker compose pull backend frontend
docker compose up -d --no-build
```

---

## Image Tags Best Practices

For production, consider using version tags instead of just `latest`:

```bash
# Tag with version number
docker build --target production -t ghcr.io/thegspiro/the-logbook-backend:v1.0.0 .
docker build --target production -t ghcr.io/thegspiro/the-logbook-backend:latest .

docker push ghcr.io/thegspiro/the-logbook-backend:v1.0.0
docker push ghcr.io/thegspiro/the-logbook-backend:latest
```

Then in the Step 8 `docker-compose.override.yml`, you can pin to a specific version:

```yaml
backend:
  image: ghcr.io/thegspiro/the-logbook-backend:v1.0.0 # Pinned version
```

Or use latest for automatic updates:

```yaml
backend:
  image: ghcr.io/thegspiro/the-logbook-backend:latest # Always latest
```

---

## Automation

No workflow in `.github/workflows/` builds or publishes images, so publishing
stays a manual step: run `scripts/build-and-push-images.sh [tag]` (or the
commands above) whenever you want new images in the registry.
