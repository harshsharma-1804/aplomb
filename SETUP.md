# Setting Up the Orchestrator Locally (Current Stage)

This guide gets a fresh instance of the API Orchestrator running on your machine using Docker — one container serving both the config dashboard and the API runtime, with SQLite storage.

## 1. Prerequisites

- **Docker Desktop** (or Docker Engine + Compose v2) — running
- **Git**
- Free ports: **3004** (app) — plus **11434** if you enable the optional local Ollama service
- OS note (Mac/Windows): containers reach services on your host machine via `host.docker.internal`

## 2. Get the code

```bash
git clone https://github.com/harshsharma-1804/api-orchestrator.git
cd api-orchestrator
git checkout sqlite-orchestrator-unification
git pull
```

## 3. Configure environment (optional but recommended)

Create a `.env` file next to `docker-compose.sqlite.yml`:

```env
SESSION_SECRET=change-me-to-a-long-random-string
SECRETS_ENCRYPTION_KEY=00000000000000000000000000000000   # 32 hex chars — generate your own and KEEP IT SAFE
BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_PASSWORD=Admin@1234567890                 # change before exposing to any real network
UPSTREAM_HOST_ALLOWLIST=mock-server,localhost,host.docker.internal
AI_ENABLED=true
```

> ⚠️ `SECRETS_ENCRYPTION_KEY` encrypts stored secrets. If you lose/change it, existing secrets become unreadable. Never commit the `.env` file.

## 4. Start the app (unified mode — recommended)

```bash
docker compose -f docker-compose.sqlite.yml up -d --build orchestrator-unified
```

- **Dashboard + API (same origin):** http://localhost:3004
- **Health check:** `curl http://localhost:3004/__health` → `200`
- Data persists in `./data/sqlite-unified/orchestrator.db` on your machine.

*(Alternative split mode: `docker compose -f docker-compose.sqlite.yml up -d api-orchestrator-sqlite api-config-dashboard-sqlite` — API on :3003, dashboard on :5001. Use the unified mode unless you have a reason.)*

## 5. First login

Open http://localhost:3004 → log in with the bootstrap admin credentials from your `.env` (defaults: `admin` / `Admin@1234567890`). Change the password in **Admin → Users**.

## 6. Import your applications

The easiest way to move apps between installations is the **export/import bundle**.

**On the source installation** (e.g., your existing one):

- Dashboard → Apps → **Export** on the app, or API:

  ```bash
  curl -H "Authorization: Bearer <dashboard-session-token>" \
    "http://<source>:3004/__config/admin/apps/<APP_ID>/export?include=endpoints,scripts&env=values" \
    -o myapp-export.json
  ```

  - `env=keys` (default): secret env vars are exported as **references only** (safe to share).
  - `env=values`: plaintext values are included (use only for transfers you control).

**On your new installation:**

- Dashboard → Apps → **Import** → upload the JSON.

**Important — secrets:** if the bundle used `env=keys`, re-enter the secret values after import (App → Environment / Env Vars). If you change `SECRETS_ENCRYPTION_KEY` between installations, values encrypted on the source cannot be decrypted on the target.

## 7. Set up an AI bot (manual — bot export is not available yet)

Bot definitions are **not** part of the app export at this stage. Recreate them by hand:

1. **Admin → AI Providers → Add**: name, base URL (e.g., `https://<your-llm-host>/v1`), API key, model name.
2. **Bots → Create**: name, select the provider, bind the app(s) it may use tools from, add **Rules** (verbatim instructions the gateway passes to the model) and optionally a **Persona**.
3. In the bot's **Limits** tab, set rate limits and scope enforcement as needed.
4. Your frontend calls the bot via `POST {app_base_path}/__ai/chat` with the `X-Bot-Key` header (key shown on the bot page), sending `{ "messages": [...] }` (+ `user.id` for bot-key callers).
5. Optional: run a local LLM — either `docker compose -f docker-compose.sqlite.yml up -d ollama` (bundled service), or your own host Ollama at `http://host.docker.internal:11434/v1` (add it as a provider).

## 8. Verify everything works

1. Health: `curl http://localhost:3004/__health`
2. Login to the dashboard.
3. Imported app visible with endpoints; hit one endpoint through the gateway (base path from the app config) and confirm a response.
4. Send a chat message to your bot and confirm a reply (check the bot's call log if it fails).

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| Port 3004 already in use | Stop the conflicting service or edit the port mapping in `docker-compose.sqlite.yml` |
| Upstream calls fail with `HOST_NOT_ALLOWED` | Add the upstream host to `UPSTREAM_HOST_ALLOWLIST` (also check the app's env values for stray spaces) |
| Imported secrets unreadable | `SECRETS_ENCRYPTION_KEY` differs from the source — re-enter secret values |
| AI replies with `AI_PROVIDER_ERROR` | Provider unreachable — check base URL/key; from a container use `host.docker.internal` for host services |
| Dashboard can't reach API (split mode) | Use unified mode, or check `CORS_ALLOWED_ORIGINS` on the API service |
| Want a clean slate | `docker compose -f docker-compose.sqlite.yml down` and delete `./data/sqlite-unified/` (destroys all data) |
