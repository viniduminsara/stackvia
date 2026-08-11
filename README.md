# stackvia

Stackvia is a Lightweight, self-hosted tool that combines Docker container resource monitoring with database-level data exploration, starting with MongoDB. Built for solo devs and small teams self-hosting a database in Docker on a VPS or homelab, not for enterprise production database observability.

## Current slice

- Live Docker container CPU, memory, and network telemetry delivered by Server-Sent Events.
- SQLite metrics collector running every 10 seconds with WAL enabled.
- Responsive monitoring dashboard with a Docker connection state and per-container detail drawer.
- A production-oriented multi-stage image that builds the native `better-sqlite3` dependency.

## Getting started

Stackvia reads Docker through `/var/run/docker.sock`. It runs as an unprivileged user, so its supplementary group must match the group ID (GID) assigned to that socket on the host.

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

Then assign the Docker socket group ID to `DOCKER_GID` in that same `.env` file.

On **Docker Desktop for macOS or Windows**, use `0`. Docker Desktop exposes the mounted socket inside Linux containers as `root:root` even when the host-side socket reports a different group.

```dotenv
DOCKER_GID=0
```

On a **native Linux Docker Engine** host, use the host socket's numeric GID:

```sh
stat -c '%g' /var/run/docker.sock
```

For example, if the Linux command prints `998`, the relevant part of `.env` is:

```dotenv
ENCRYPTION_KEY=paste-the-generated-secret-here
DOCKER_GID=998
```

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

`connect EACCES /var/run/docker.sock` means Stackvia can see the socket but does not have permission to use it. On Docker Desktop, set `DOCKER_GID=0`; on native Linux, use the group ID reported by `stat -c '%g' /var/run/docker.sock`. Then recreate the service so Compose applies the supplementary group:

```sh
docker compose down
docker compose up --build -d
```

Inspect the socket from inside the running container:

```sh
docker compose exec stackvia ls -ln /var/run/docker.sock
docker compose exec stackvia id
```

The numeric group displayed by the first command must appear in the `groups=` output of the second. If your socket is mode `0600`, group access alone cannot work; change the host's Docker socket policy or use a socket proxy.

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
