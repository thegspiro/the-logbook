# Port Configuration Guide

This document explains the different port configurations used by The Logbook depending on your deployment method.

**The frontend never needs the backend's port.** `VITE_API_URL` is the relative
path `/api/v1` in every deployment: the compose files pass it as a fixed build
argument, and the browser sends API requests to the same origin it loaded the
page from. The frontend's nginx (in Docker) or the Vite dev server's proxy
(in native development) forwards `/api` to the backend. Changing a published
port therefore needs no frontend change — only `.env` and `ALLOWED_ORIGINS`.

## Port Configurations

### 1. **Unraid Deployment** (Recommended for Unraid users)

**Access Points:**

- **Frontend (Web UI)**: http://YOUR-UNRAID-IP:**7880**
- **Backend API**: http://YOUR-UNRAID-IP:**7881**
- **API Documentation**: http://YOUR-UNRAID-IP:**7881/docs**

**Configuration:**

```env
# In .env file
FRONTEND_PORT=7880
BACKEND_PORT=7881
```

**Why these ports?**

- Unraid uses ports 7880/7881 to avoid conflicts with other common services
- These ports are less likely to be blocked by firewalls
- Follows Unraid community conventions for custom applications

---

### 2. **Standard Docker Compose** (Default for Docker deployments)

**Access Points:**

- **Frontend (Web UI)**: http://localhost:**3000**
- **Backend API**: http://localhost:**3001**
- **API Documentation**: http://localhost:**3001/docs**

**Configuration:**

```env
# In .env file
FRONTEND_PORT=3000
BACKEND_PORT=3001
```

With the production override (`docker-compose.prod.yml`), port 3001 is not
published on the host; reach the API through the frontend at
`http://localhost:3000/api/v1`.

**Why these ports?**

- Port 3000 is the standard for React development servers
- Port 3001 is commonly used for API servers
- These are Docker Compose defaults

---

### 3. **Native Development** (Without Docker)

**Access Points:**

- **Frontend (Vite Dev Server)**: http://localhost:**3000**
- **Backend API**: http://localhost:**3001**
- **API Documentation**: http://localhost:**3001/docs**

**Configuration:**

```env
# In frontend/.env file (the default from frontend/.env.example)
VITE_API_URL=/api/v1
# Where the Vite dev proxy forwards /api — only needed if the backend is not
# at the default http://localhost:3001
# VITE_BACKEND_URL=http://localhost:3001
```

**Why these ports?**

- Port 3000 is set in `frontend/vite.config.ts` (`server.port`), replacing
  Vite's 5173 default
- Port 3001 is the configured backend API port
- These are used when running `npm run dev` and `uvicorn main:app --reload`

---

### 4. **Production with Nginx** (Enterprise deployments)

**Access Points:**

- **Frontend & Backend**: https://your-domain.com (**443**)
- **HTTP Redirect**: http://your-domain.com (**80**)

**Configuration:**

```env
# In .env file
NGINX_HTTP_PORT=80
NGINX_HTTPS_PORT=443
FRONTEND_PORT=3000  # Internal only
BACKEND_PORT=3001   # Internal only
```

**Why these ports?**

- Port 443 is standard for HTTPS
- Port 80 is standard for HTTP (redirects to HTTPS)
- Nginx acts as reverse proxy, internal services use 3000/3001

---

## Quick Reference Table

| Deployment         | Frontend Port | Backend Port | Access URL              |
| ------------------ | ------------- | ------------ | ----------------------- |
| **Unraid**         | **7880**      | **7881**     | http://unraid-ip:7880   |
| Docker Compose     | 3000          | 3001         | http://localhost:3000   |
| Native Dev         | 3000          | 3001         | http://localhost:3000   |
| Production (Nginx) | 443           | 443          | https://your-domain.com |

---

## Changing Ports

### For Unraid:

1. Edit `/mnt/user/appdata/the-logbook/.env`:
   ```bash
   nano /mnt/user/appdata/the-logbook/.env
   ```
2. Set:
   ```env
   FRONTEND_PORT=7880
   BACKEND_PORT=7881
   ```
3. Restart containers:
   ```bash
   docker-compose down
   docker-compose up -d
   ```

### For Docker Compose:

1. Edit `.env` in project root
2. Update `FRONTEND_PORT` and `BACKEND_PORT`
3. Update `ALLOWED_ORIGINS` (and `FRONTEND_URL`) if the frontend port changed
4. Apply: `docker compose up -d` (a `restart` keeps the old port mappings)

### For Native Development:

1. **Frontend**: Edit `vite.config.ts` to change port
2. **Backend**: Change `PORT` in backend `.env` or use `--port` flag:
   ```bash
   uvicorn main:app --reload --port 8000
   ```
3. If the backend port changed, set `VITE_BACKEND_URL` in `frontend/.env` so the
   Vite dev proxy forwards `/api` to it

---

## Database & Redis Ports

These are typically **internal only** (not exposed to host):

| Service       | Port | Exposed? | Configuration                |
| ------------- | ---- | -------- | ---------------------------- |
| MySQL         | 3306 | Optional | `DB_PORT` in .env            |
| Redis         | 6379 | Optional | `REDIS_PORT` in .env         |
| Elasticsearch | 9200 | Optional | `ELASTICSEARCH_PORT` in .env |
| MinIO API     | 9000 | Optional | `MINIO_PORT` in .env         |
| MinIO Console | 9001 | Optional | `MINIO_CONSOLE_PORT` in .env |

**Note**: For security, these ports should only be exposed if you need direct access for administration.

---

## Troubleshooting

### Port Already in Use

**Error**: `Error: bind: address already in use`

**Solution**:

1. Check what's using the port:

   ```bash
   # Linux/Mac
   sudo lsof -i :7880

   # Windows
   netstat -ano | findstr :7880
   ```

2. Either stop that service or change the port in `.env`

### Cannot Access Frontend/Backend

**Checklist**:

- ✅ Containers are running: `docker ps`
- ✅ Correct ports in `.env` files
- ✅ Firewall allows the ports
- ✅ `ALLOWED_ORIGINS` names the address you open the frontend at
- ✅ Using correct IP (localhost vs server IP)

### Unraid: Cannot Access from Other Devices

1. **Check Unraid IP**: Go to Settings → Network Settings
2. **Update `ALLOWED_ORIGINS`** in `/mnt/user/appdata/the-logbook/.env` to the
   address the other devices open (no frontend rebuild is needed — the frontend
   calls the API on its own origin):
   ```env
   ALLOWED_ORIGINS=http://UNRAID-IP:7880
   ```
3. **Apply it**:
   ```bash
   cd /mnt/user/appdata/the-logbook
   docker compose up -d
   ```

---

## CORS Configuration

If frontend and backend are on **different ports or domains**, ensure CORS is configured:

**In backend `.env`**:

```env
# For Unraid (both on same IP, different ports)
ALLOWED_ORIGINS=["http://YOUR-UNRAID-IP:7880"]

# For Docker Compose
ALLOWED_ORIGINS=["http://localhost:3000"]

# For development
ALLOWED_ORIGINS=["http://localhost:3000"]

# For production
ALLOWED_ORIGINS=["https://your-domain.com"]
```

---

## Environment-Specific Configuration

### Development (.env.development)

```env
FRONTEND_PORT=3000
BACKEND_PORT=3001
```

### Staging (.env.staging)

```env
FRONTEND_PORT=3000
BACKEND_PORT=3001
```

### Production (.env.production)

```env
NGINX_HTTP_PORT=80
NGINX_HTTPS_PORT=443
```

### Unraid (.env.unraid)

```env
FRONTEND_PORT=7880
BACKEND_PORT=7881
```

---

## Summary

- **Unraid**: Use ports **7880** (frontend) and **7881** (backend)
- **Docker Compose**: Use ports **3000** (frontend) and **3001** (backend)
- **Native Dev**: Use ports **3000** (frontend) and **3001** (backend)
- **Production**: Use ports **80/443** with Nginx reverse proxy

When changing ports, update `.env` and `ALLOWED_ORIGINS`; `VITE_API_URL` stays `/api/v1`.
