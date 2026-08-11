# stackvia

Stackvia is a Lightweight, self-hosted tool that combines Docker container resource monitoring with database-level data exploration, starting with MongoDB. Built for solo devs and small teams self-hosting a database in Docker on a VPS or homelab, not for enterprise production database observability.

## Current slice

- Live Docker container CPU, memory, and network telemetry delivered by Server-Sent Events.
- SQLite metrics collector running every 10 seconds with WAL enabled.
- Responsive monitoring dashboard with a Docker connection state and per-container detail drawer.
- A production-oriented multi-stage image that builds the native `better-sqlite3` dependency.

## Getting started

Stackvia reads Docker through `/var/run/docker.sock`. The container now detects the socket's group ID at startup, joins that group automatically, and then drops to the unprivileged app user.

### 1. Prerequisites

- Docker Engine or Docker Desktop is running.
- Your terminal user can run `docker ps` successfully.
- Docker Compose v2 is available: `docker compose version`.

### 2. Create the environment file

```sh
cp .env.example .env
```

Set `ENCRYPTION_KEY` in `.env` to a long, random value:

```sh
openssl rand -hex 32
```

No Docker socket group setting is needed anymore. Keep `ENCRYPTION_KEY` in place, and Stackvia will adapt to Docker Desktop or native Linux automatically.

### 3. Build and start Stackvia

```sh
docker compose up --build -d
docker compose logs -f stackvia
```

Open `http://localhost:3000`. It may take one collector interval (up to 10 seconds) for the first container snapshot to appear.

### 4. Confirm Docker access

The dashboard should show **Live connection** and your running containers. You can also check the service endpoint:

```sh
curl http://localhost:3000/api/containers
```

The response should contain `"connected":true` and `"mode":"docker"`.

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

The Vite UI is at `http://localhost:5173` and proxies `/api` to the Express service on port 3000. If you do not have a Docker daemon available, put `DEMO_MODE=true` in `.env` to use clearly-labelled sample telemetry:

```sh
DEMO_MODE=true npm run dev -w backend
```

## API surface

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Service health probe |
| `GET /api/containers` | Latest container snapshot and collector state |
| `GET /api/containers/:id/history?hours=24` | Stored metric history, capped at 168 hours |
| `GET /api/stream/stats` | SSE stream of current snapshots |

## Project layout

`backend/src/` contains the Express API, Docker collector, and SQLite store. `frontend/src/` contains the React interface and its live-stream hook. `data/` is created at runtime for the SQLite database.
