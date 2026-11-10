# Hearth — AI Grocery Agent

A household assistant for groceries, pantry stock, purchase history and family tasks.
The Expo app runs on web, Android and iOS. Use it entirely on this device with rule-based
understanding, or connect to the FastAPI backend for household sharing and optional Ollama
extraction. A separate admin console approves sign-in requests and manages households.

## Quick start: local sandbox

Install Node.js LTS and npm, then from the repository root:

```bash
cd mobile
npm ci
cd ..
bash scripts/dev.sh
```

Open **http://localhost:8081**. Select **Get started**, enter a test name and a valid-format mobile
number, then use the sandbox passkey displayed on screen. No SMS is sent. Complete household
setup to use the app. Sandbox data is saved in this browser/device; it is not shared.

For a phone, run `cd mobile && npm start` and use an Expo Go version compatible with the
project's Expo SDK 57, or a development build. Keep the phone and computer on the same network.

## Run the API, admin and browser together

Python 3.11+ is required. Set up once:

```bash
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -e './backend[dev]' -e './admin[dev]'
```

Start local PostgreSQL and create the database once if it does not already exist:

```bash
createdb -h localhost ai_grocery_agent
```

Then from the root (stop any existing Expo server on port 8081 first):

```bash
bash scripts/dev.sh full
```

| Service | Address |
|---|---|
| Family app | http://localhost:8081 |
| API health | http://127.0.0.1:8000/healthz |
| Admin console | http://127.0.0.1:8100 |

The launcher uses PostgreSQL at `localhost:5432/ai_grocery_agent`, creates any missing schema/catalog,
and connects both the API and admin console to that database. It uses your local PostgreSQL role
(by default your OS username). To use a different local connection, set `HEARTH_LOCAL_DATABASE_URL`.
The local admin token is `local-development-only`, or the value
of `ADMIN_TOKEN` if you set it. These settings are for local development. Ctrl-C stops all services.

In DBeaver, create a **PostgreSQL** connection with host `localhost`, port `5432`, database
`ai_grocery_agent` and your local PostgreSQL username. On this Mac the role is `rithvikat`, and
the local connection works without a password. Click **Test Connection**, then **Finish**.
The app tables are under **Schemas → public → Tables**.

The earlier SQLite file at `backend/local.db` is preserved. To explicitly run against it:

```bash
HEARTH_LOCAL_DATABASE_URL="sqlite:///$PWD/backend/local.db" bash scripts/dev.sh full
```

For shared sign-in: request access in the family app, open the admin console and enter the admin
token, then approve the request under **Passkey Issue**. Use the generated passkey in the family
app. Sandbox accounts do not become server accounts. Web tokens survive reloads in the same
browser tab using session storage; native tokens use the OS secure store.

For separate processes or a phone connecting to the API, copy `mobile/.env.example` to
`mobile/.env` and set `EXPO_PUBLIC_API_URL` to the server address (your computer's LAN address
on a phone). Restart Expo after changing it. The full launcher binds the API to loopback for
browser use; phone access requires starting uvicorn with `--host 0.0.0.0`.

Ollama is optional. Without it, the app's rules still understand everyday grocery requests.
Set `OLLAMA_HOST` and `OLLAMA_MODEL` to enable extraction for unfamiliar messages. See
[backend configuration](backend/.env.example), [deployment](backend/DEPLOY.md) and
[admin documentation](admin/README.md) for production setup. The API allows local web origins
by default; set `CORS_ORIGINS` to your site's origin for a hosted browser client.
Environment example files document configuration; uvicorn does not load them automatically.

## Checks

```bash
cd mobile
npm run typecheck
npm run lint
npm test -- --runInBand
npm run build:web
cd ../backend
.venv/bin/python -m pytest -m 'not llm' -q
cd ../admin
../backend/.venv/bin/python -m pytest -q
```

`pytest -m llm` in `backend/` additionally requires a running Ollama instance.
The static web build is written to `mobile/dist/`.

## Repository layout

```text
mobile/    Expo + React Native + TypeScript client and unit tests
backend/   FastAPI, SQLModel, PostgreSQL/SQLite, optional Ollama and API tests
admin/     Separate FastAPI admin console and tests
scripts/   Local development and operations launchers
docs/      Architecture, schema and API notes
plans/     Milestone plans
tests/     Cross-cutting evaluation data
```
