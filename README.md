# stackvia

Stackvia is a lightweight, self-hosted tool that combines Docker container resource monitoring with database-level data exploration (MongoDB). Built for solo devs and small teams self-hosting a database in Docker on a VPS or homelab, not for enterprise production database observability.

## Features

- Live Docker container CPU, memory, and network telemetry delivered by Server-Sent Events.
- SQLite metrics collector running every 10 seconds with WAL enabled.
- Responsive monitoring dashboard with overview metrics, per-container detail drawer, and state filtering.
- Admin authentication (JWT session cookie) with a first-run setup flow and rate-limited login.
- MongoDB explorer: save connection strings (encrypted at rest with AES-256-GCM), browse databases and collections, read collection stats, and explore documents with JSON filters in a strict read-only view.
- A production-oriented multi-stage image that builds the native `better-sqlite3` dependency.

## Getting started

Stackvia reads Docker through `/var/run/docker.sock`. The container detects the socket's group ID at startup, joins that group automatically, and then drops to the unprivileged app user.

### 1. Prerequisites

- Docker Engine or Docker Desktop is running.
- Your terminal user can run `docker ps` successfully.
- Docker Compose v2 is available: `docker compose version`.

### 2. Create the environment file

```sh
cp .env.example .env
```

Set `ENCRYPTION_KEY` and `SESSION_SECRET` in `.env` to long, random values:

```sh
openssl rand -hex 32
```

`ENCRYPTION_KEY` encrypts MongoDB connection strings before they are written to SQLite; `SESSION_SECRET` signs the login session cookie. Keep both in place and never lose them — `ENCRYPTION_KEY` cannot be changed after connections are saved, and `SESSION_SECRET` invalidates existing sessions when rotated.

No Docker socket group setting is needed anymore. Stackvia will adapt to Docker Desktop or native Linux automatically.

### 3. Build and start Stackvia

```sh
docker compose up --build -d
docker compose logs -f stackvia
```

Open `http://localhost:3000`. On the first run you will be asked to create an admin account (username and a password of at least 8 characters). This account is required before any data is shown and cannot be reset through the UI.

### 4. Confirm Docker access

After signing in, the dashboard should show **Live connection** and your running containers. You can also check the service endpoint:

```sh
curl http://localhost:3000/api/containers
```

An unauthenticated request returns `401`. Use the authenticated session from the browser, or check the raw API with a cookie. The response should contain `"connected":true` and `"mode":"docker"`.

### 5. Explore a MongoDB database

Open **Databases** in the sidebar, add a connection (name, optional default database, and a `mongodb://` or `mongodb+srv://` connection string), then open it. The explorer lists databases and collections, shows db/collection stats, and lets you page through documents with an optional JSON filter such as `{"status":"active"}`. The explorer is read-only: unsafe operators (`$where`, `$function`, `$accumulator`, `$expr`) are stripped, queries are time-limited, and system collections are blocked.

## Troubleshooting Docker access

`connect EACCES /var/run/docker.sock` usually means the host socket is not readable by the container or the bind mount is missing. Stackvia now handles the common Docker Desktop and native Linux cases automatically, so you should not need to set a socket GID by hand.

```sh
docker compose down
docker compose up --build -d
```

Inspect the socket from inside the running container:

```sh
docker compose exec stackvia ls -ln /var/run/docker.sock
docker compose exec stackvia id
```

If the socket shows mode `0600`, group access alone cannot work; change the host's Docker socket policy or use a socket proxy. If you are on a very locked-down host and the entrypoint cannot add the socket group, the next step is to confirm the Docker daemon exposes the socket with a group-readable mode such as `0660`.

If `docker ps` fails on the host, resolve that first (on Linux this commonly means adding your user to the host's `docker` group, then starting a new login session). Do not solve the problem by making the socket world-writable.

The compose file mounts the Docker socket read-only and persists the metrics database in `./data`. A read-only Docker socket remains sensitive because Docker APIs can still expose broad host control. For an internet-facing installation, place Stackvia behind authentication/HTTPS and use a Docker socket proxy that allows only the APIs it needs.

## Local development

Install the workspace dependencies, then run both services:

```sh
npm install
npm run dev
```

The Vite UI is at `http://localhost:5173` and proxies `/api` to the Express service on port 3000. If you do not have a Docker daemon available, put `DEMO_MODE=true` in `.env` to use clearly-labelled sample telemetry (containers and a mock `shop_db` MongoDB dataset):

```sh
DEMO_MODE=true npm run dev -w backend
```

## API surface

All endpoints except `GET /api/health` and the `/api/auth` routes require a valid session cookie.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Service health probe |
| `GET /api/auth/status` | Whether admin setup is still required |
| `GET /api/auth/me` | Current session user |
| `POST /api/auth/setup` | Create the admin account (first run only) |
| `POST /api/auth/login` | Sign in (rate-limited) |
| `POST /api/auth/logout` | Sign out |
| `GET /api/containers` | Latest container snapshot and collector state |
| `GET /api/containers/:id/history?hours=24` | Stored metric history, capped at 168 hours |
| `GET /api/stream/stats` | SSE stream of current snapshots |
| `GET /api/databases` | List saved MongoDB connections |
| `POST /api/databases` | Save an encrypted connection |
| `DELETE /api/databases/:id` | Delete a saved connection |
| `GET /api/databases/:id/catalog` | Available database names |
| `GET /api/databases/:id/overview?database=` | db stats and collection overview |
| `GET /api/databases/:id/collections/:collection/stats?database=` | Single collection stats |
| `GET /api/databases/:id/collections/:collection/documents?database=&page=&limit=&filter=` | Paginated read-only document explorer |

## Project layout

`backend/src/` contains the Express API, Docker collector, SQLite store, AES-256-GCM crypto utilities, and the MongoDB wrapper. `frontend/src/` contains the React interface and its live-stream and auth hooks. `data/` is created at runtime for the SQLite database (metrics, encrypted connections, and the admin user).
