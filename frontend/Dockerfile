# Multi-stage build for React frontend
#
# BUILD CONTEXT IS THE REPOSITORY ROOT, not ./frontend. The npm workspace
# keeps a single lockfile at the root (see CLAUDE.md, "Package Manager"), and
# reproducible installs need it inside the context. Build with:
#
#   docker build -f frontend/Dockerfile .
#
# Compose does this via `context: .` + `dockerfile: frontend/Dockerfile`.
# See .dockerignore at the root for what the context excludes.

# Development stage
FROM node:26-alpine AS development

# Upgrade to npm 11.9.0 (latest stable)
RUN npm install -g npm@11.9.0

# The root `prepare` script runs husky to install git hooks. .git is not in
# the build context and containers never commit, so skip it.
ENV HUSKY=0

WORKDIR /app

# Manifests before source so the dependency layer caches independently of it.
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/

# `npm ci` installs exactly the tree the lockfile pins. `npm install` re-resolves
# it and silently drifts from what CI tested — the image would ship dependency
# versions no test ever ran against.
RUN npm ci

# Copy source code
COPY frontend/ frontend/

WORKDIR /app/frontend

# Expose port
EXPOSE 3000

# Start development server
CMD ["npm", "run", "dev", "--", "--host"]

# Build stage
FROM node:26-alpine AS build

# Upgrade to npm 11.9.0 (latest stable)
RUN npm install -g npm@11.9.0

ENV HUSKY=0

# Accept build arguments for environment variables
ARG VITE_API_URL=/api/v1

WORKDIR /app

COPY package.json package-lock.json ./
COPY frontend/package.json frontend/

RUN npm ci

# Copy source code
COPY frontend/ frontend/

WORKDIR /app/frontend

# Build the app with environment variables
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

# Production stage
FROM nginx:alpine AS production

# Limit worker processes — 'auto' detects host CPUs, not container limits,
# which can spawn dozens of unnecessary workers in Docker.
RUN sed -i 's/worker_processes\s*auto;/worker_processes 2;/' /etc/nginx/nginx.conf

# Copy custom nginx config
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built files from build stage
COPY --from=build /app/frontend/dist /usr/share/nginx/html

# Add healthcheck.
#
# Targets 127.0.0.1, not localhost. nginx.conf binds IPv4 only (`listen 80;`),
# but the container's /etc/hosts maps localhost to both 127.0.0.1 and ::1, and
# musl's resolver returns ::1 first (RFC 6724 gives loopback IPv6 the higher
# precedence). BusyBox wget takes the first address and gets ECONNREFUSED, so
# the check never passes against `localhost`. The literal address removes the
# ambiguity.
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1/ || exit 1

# Expose port
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
