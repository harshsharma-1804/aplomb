

# Aplomb — API Orchestrator

> **Start here: [EXPLOREAPLOMB.md](EXPLOREAPLOMB.md)** — a guided tour of the product with live-demo access, light-mode screenshots, a change-goes-live GIF, architecture notes, and run-locally instructions.

A self-hosted API gateway and configuration platform. You register an app, define its endpoints declaratively (upstream, auth, schemas, mappings, scripts), and every configuration change is live on the gateway instantly — no build, no restart, no redeploy.

---

## How it works

The dashboard and the gateway run as **one unified service on port `3004`**:

- The dashboard is a React / Vite SPA served same-origin; it talks to the config API under `/__config`.
- The gateway executes published endpoints through a fixed pipeline: **authenticate → validate request → call upstream → map response → run scripts**.
- Configuration is data, not code: endpoints are declarative records, every change is a versioned snapshot, and rollback is one click.
- State lives in a single **SQLite** database managed by ordered **Drizzle** migrations — one file to back up, zero infrastructure to run.

### Platform capabilities

- **App Registry** — versioned apps with base paths and lifecycle (Active / Draft / Deprecated)
- **Endpoint configuration** — request/response JSON Schemas, field mappings, environment-variable templating, pre/post scripts
- **Test console** — fire a real request through the full pipeline and inspect the transformed response
- **Tenant Settings** — identity providers (OIDC SSO), host allowlist, allowed origins (CORS), mail/SMTP routing, AI & MCP providers, encrypted secrets vault, users
- **Bot Registry** — governed AI assistants: app bindings, behaviour guardrails (persona, domain scope, topic blocklist), limits, and a full tool-call audit trail; AI-exposed endpoints become MCP tools automatically
- **Member portals** — per-app user stores, session auth, verification/OTP mail
- **Org-wide appearance** — the admin's theme and palette apply to every fresh browser, including the pre-auth sign-in page
- **Security** — AES-256-GCM secrets at rest, upstream host allowlist with private-range blocking, 2FA and lockout policy

---

## Quick Start (Docker Compose)

```bash
# build and start the unified container (dashboard + gateway on :3004)
docker compose -f docker-compose.sqlite.yml up --build -d orchestrator-unified

# verify
curl http://localhost:3004/__health
```

Open `http://localhost:3004` and sign in with the bootstrap admin (seeded on first boot only, when no users exist — see `BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_PASSWORD` below).

### Alternative: split services

`docker-compose.sqlite.yml` also defines split SQLite services — API on `:3003`, dashboard on `:5001` — plus an optional local Ollama container (`:11434`) for AI providers. The legacy `docker-compose.yml` (MongoDB + Redis, two-service) is kept for reference but is no longer the supported path.

---

## Environment Variables

Each service ships an `.env.example` listing all supported variables. Copy it to `.env` and fill in values before starting:

```bash
cp api-orchestrator/.env.example api-orchestrator/.env
```

Key variables:

| Variable | Description |
|---|---|
| `SESSION_SECRET` | Random string used to sign session cookies |
| `SECRETS_ENCRYPTION_KEY` | Exactly 32-character key for AES-256-GCM secrets at rest |
| `BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_PASSWORD` | Initial admin (seeded only on first boot) |
| `UPSTREAM_HOST_ALLOWLIST` | Comma-separated list of allowed upstream hostnames |
| `DB_PATH` | SQLite database file location |
| `AUTH_MAX_FAILED_ATTEMPTS` / `AUTH_LOCKOUT_DURATION_MS` | Sign-in lockout policy |
| `AI_ENABLED` | Enables the AI bot layer |

---

## Project Structure

```
orchestrator/
├── api-orchestrator/           # Node.js/TypeScript gateway + config API
│   ├── src/                    # Application source (routes, db, ai, scripts)
│   ├── Dockerfile.unified      # Unified image: SPA + gateway in one container
│   ├── Dockerfile.sqlite       # Split API image (SQLite build)
│   └── .env.example
├── api-config-dashboard/       # React/Vite dashboard (served by the unified image)
│   ├── src/
│   ├── Dockerfile.sqlite
│   └── .env.example
├── docs/screenshots/           # Screenshots and walkthrough GIFs
├── docker-compose.sqlite.yml   # Current stack: unified (:3004) or split services
└── docker-compose.yml          # Legacy MongoDB/Redis stack (reference only)
```

---

## Branch Strategy

| Branch    | Purpose                                      |
|-----------|----------------------------------------------|
| `main`    | Stable, production-ready releases only        |
| `develop` | Active development — all PRs target here     |
