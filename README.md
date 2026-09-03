# API Orchestrator

A self-hosted, generic API gateway and configuration platform. It consists of two services that work together to provide secure, audited, and configurable upstream API proxying.

---

## Services

### `api-orchestrator` (Backend — port 3002)

Node.js / TypeScript REST API that acts as the orchestration layer between clients and upstream APIs. Key responsibilities:

- **Session-based authentication** with admin bootstrap on first boot
- **Encrypted secret storage** — upstream credentials are encrypted at rest using AES-256-GCM
- **API proxy engine** — routes requests to registered upstream APIs with per-API auth, headers, and retry logic
- **Circuit breaker** — protects upstream services from cascading failures
- **Request / response logging** with configurable retention
- **Host allowlist** — blocks requests to private IP ranges and non-whitelisted hosts

### `api-config-dashboard` (Frontend — port 5000)

React / Vite single-page application that provides a UI for managing the orchestrator:

- Register and configure upstream APIs
- Manage encrypted credentials per API
- View live request logs and circuit breaker status
- Admin user management

---

## Branch Strategy

| Branch    | Purpose                                      |
|-----------|----------------------------------------------|
| `main`    | Stable, production-ready releases only        |
| `develop` | Active development — all PRs target here     |

---

## Quick Start (Docker Compose)

```bash
# 1. Copy and fill in environment variables
cp api-orchestrator/.env.example api-orchestrator/.env
# Edit api-orchestrator/.env with real values

# 2. Start all services
docker compose up --build

# Services available at:
#   API Orchestrator:     http://localhost:3002
#   Config Dashboard:     http://localhost:5000
```

> On first boot, the orchestrator seeds a bootstrap admin user using `BOOTSTRAP_ADMIN_USERNAME` and `BOOTSTRAP_ADMIN_PASSWORD` from the environment — only if no users exist.

---

## Environment Variables

Each service ships an `.env.example` file listing all supported variables with descriptions. Copy it to `.env` and fill in values before starting:

```bash
cp api-orchestrator/.env.example api-orchestrator/.env
```

Key variables to set for production:

| Variable                  | Description                                         |
|---------------------------|-----------------------------------------------------|
| `SESSION_SECRET`          | Random string used to sign session cookies          |
| `SECRETS_ENCRYPTION_KEY`  | Exactly 32-character key for AES-256-GCM encryption |
| `BOOTSTRAP_ADMIN_PASSWORD`| Initial admin password (used only on first boot)    |
| `UPSTREAM_HOST_ALLOWLIST` | Comma-separated list of allowed upstream hostnames  |

---

## Project Structure

```
orchestrator/
├── api-orchestrator/        # Node.js/TypeScript backend
│   ├── src/                 # Application source
│   ├── Dockerfile
│   └── .env.example
├── api-config-dashboard/    # React/Vite frontend
│   ├── src/                 # Application source
│   ├── Dockerfile
│   └── .env.example
└── docker-compose.yml       # Compose file for all services
```
