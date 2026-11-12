# Going live

How to put the Hearth server online and ship the app to Android and iPhone. Do the steps in order. Account setup, live checks, and signed-device testing are still required before release.

## What the app does in each mode

| | Sandbox build (`eas build --profile sandbox`) | Live build (`preview` / `production`) |
|---|---|---|
| Sign-in | Passkey shown on screen, accounts on the phone | Name + number, then the passkey you issue from the admin console |
| Data | This phone only | Shared by everyone in the home |
| Understanding messages | On-phone rules | On-phone rules first; anything they don't recognise goes to Ollama on the server |

The live build is chosen by `EXPO_PUBLIC_API_URL` in `mobile/eas.json`. Empty means sandbox.

## 1. Put the server online (you, about 15 minutes)

The repo has a one-click blueprint for Render: `render.yaml` at the repo root. It creates the API (Docker) and a Postgres database in Singapore, the closest region to India.

1. Push this repo to GitHub.
2. render.com → **New → Blueprint** → pick the repo. Render reads `render.yaml`.
3. When the deploy is green, open `https://<your-service>.onrender.com/healthz`. It should say `{"ok":true}`.
4. If the address is not `https://hearth-api.onrender.com`, put yours in `mobile/eas.json` (both `preview` and `production`).

Any other Docker host works too (Railway, Fly.io, a VPS). Build `backend/Dockerfile` and set the variables in `backend/.env.example`. The server creates its tables on start and refuses to start in production without `AUTH_SECRET`.

## 2. Sign-in: passkeys from the admin console (you, a minute per person)

There are no texted codes. A person opens the app, types their name and number, and the phone says "Please ask the admin for your passkey". You see them waiting in the admin console (`scripts/admin.sh live`, page **Passkey Issue**; it checks every 20 seconds and pops up "… is trying to sign in"). Pick their home and who they are, click **Generate passkey**, and read the passkey (`K7M4-PX9Q`) out to them. It is shown once and stored only as a slow, salted hash mixed with `AUTH_SECRET`, so **changing `AUTH_SECRET` makes every passkey stop working**.

People who joined before passkeys stay signed in. To give them one for a new phone, use **Everyone in a home → Generate passkey**. A lost passkey: **Reset passkey**, which also signs that person out until they type the new one.

Limits in the server: 5 wrong passkeys lock that number for 15 minutes; 30 join requests or passkey tries per IP address per hour; at most 50 people waiting at once. Every mismatch (unknown number, wrong name, wrong passkey) gets the same answer, and asking to join never says whether a number is set up. A phone unused for 90 days is signed out.

The per-IP limit reads `X-Forwarded-For` from the right, because the left side is whatever the caller sent. `TRUSTED_PROXY_HOPS` (default 1) is how many proxies sit in front of the server. If everyone starts hitting "Too many tries" together on Render, a CDN is in front, so set it to 2.

## 2b. The AI (Ollama), for everyone

How a message is understood: the phone's own rules answer first. They're instant, work offline, and own every question, chip and memory rule. Only a message they don't recognise goes to the server, and the server asks Ollama: other languages ("biyyam aipovachindi"), several items at once ("ek kilo tamatar aur dahi"), or unusual wording ("what do we need to buy"). What Ollama extracts is turned back into plain commands for the rules (`mobile/src/services/HybridAIService.ts`). If Ollama is unreachable or slow (more than 25 s), the rules answer anyway.

Ollama needs about 6 GB of memory for an 8B model, far more than the small Render server has. So it runs on a computer you own, with the server reaching it through a tunnel:

1. On the Mac with Ollama: `brew install cloudflared`, then run `scripts/share-ollama.sh`. It starts Ollama, a **locked gate** in front of it (`backend/app/ollama_gate.py`: only chat requests that carry a secret key get through), and a tunnel. It keeps the Mac awake and prints three values.
2. Paste those values into Render → hearth-api → Environment: `OLLAMA_HOST`, `OLLAMA_API_KEY`, `OLLAMA_MODEL`. The server restarts with them.
3. For an address that never changes, make a free account at ngrok.com, claim the free static domain, run `brew install ngrok` and `ngrok config add-authtoken …`, then start the script with `NGROK_DOMAIN=your-name.ngrok-free.app scripts/share-ollama.sh`. Without that, the Cloudflare quick-tunnel address changes every time the script starts, and you'd have to update `OLLAMA_HOST` each time.

The Mac must be on, awake and online for the AI to answer. When it isn't, nothing breaks; Hearth just understands less. To run it around the clock without the Mac, use a cloud machine with a GPU instead (about $150+ a month). A cheap machine without a GPU would take 20–40 s per message.

Model: `llama3:8b` passes 24 of 26 phrases in the eval set (`OLLAMA_MODEL=llama3:8b .venv/bin/pytest -m llm -s tests/test_understanding_live.py`), taking about 5–9 s per message on an M5. To try a different model, run `ollama pull <model>`, re-run the eval, and change `OLLAMA_MODEL`. To chat with it from the terminal: `OLLAMA_MODEL=llama3:8b .venv/bin/python -m app.understanding`.

## 3. Privacy policy (you, 2 minutes)

The server publishes it at `https://<your-service>/privacy` (`backend/app/static/privacy.html`). The contact is **rithvika.tiruveedhula51@gmail.com**. Override it with `PRIVACY_CONTACT_EMAIL` if needed. Both stores ask for this URL.

## 4. Build the apps

```
cd mobile
npx eas-cli@latest login
npx eas-cli@latest build -p android --profile preview      # .apk to install directly
npx eas-cli@latest build -p android --profile production   # .aab for Google Play
npx eas-cli@latest build -p ios --profile production       # for TestFlight / App Store
npx eas-cli@latest submit -p ios                           # uploads to App Store Connect → TestFlight
```

- **Android:** open the build link on the phone, download the `.apk`, and allow "install unknown apps". For Google Play, a developer account costs $25 once; upload the `.aab`.
- **iPhone / iPad:** needs the Apple Developer Program ($99/year). TestFlight is the easy way for family: up to 10,000 testers, and each build lasts 90 days. App Store review needs the privacy URL, a test account the reviewer can sign in with, and in-app account deletion (More → Delete my account, already built).

Store data-safety answers, from what the app actually does: it collects name and phone number (account), plus user content (lists, tasks, family members' diet notes). Nothing is used for tracking or ads, and data is encrypted in transit. Deletion is in the app.

## 5. Bringing the family in

1. Everyone installs the live build → **Get started** → types their name and number. The phone says "Please ask the admin for your passkey".
2. You open the admin console (`scripts/admin.sh live`) → **Passkey Issue**. For the first person, choose **New home** (they become its owner); for everyone after, choose that home. Click **Generate passkey** and read it out.
3. They type the passkey and are in. They see the same list, pantry, and tasks, updated every 15 seconds and whenever the app opens.

## Developing against a local server

```
cd backend && .venv/bin/uvicorn app.main:app --host 0.0.0.0 --reload
cd mobile && EXPO_PUBLIC_API_URL=http://<your-mac's-LAN-IP>:8000 npx expo start
scripts/admin.sh local        # issue passkeys to your test phones
```

## Release verification

The API now requires Node.js as well as Python: reporting replays a bundled copy of the exact
mobile grocery/task reducers. The Dockerfile installs Node automatically. When changing those
reducers, run `node scripts/build-reporting.cjs` from the repository root and commit the generated
`backend/app/reporting/replay.cjs`. CI rejects stale bundles, runs all automated checks and builds
the Docker image. Event writes and their report updates commit together; PostgreSQL serializes
writers per household. Startup backfills existing logs. No destructive schema migration is needed
for the new `report_state` table. The access-policy table keeps its existing schema.

Production startup requires `AUTH_SECRET` of at least 32 characters and an explicit PostgreSQL
`DATABASE_URL`. Set `CORS_ORIGINS` to your browser site's HTTPS origin; leave it empty for native
apps only. The Render blueprint deploys the API/database, not the web frontend or admin console.
Host `mobile/dist` separately for browser users and keep admin on loopback/VPN/SSO as described
in the admin README. Verify that both EAS live profiles point at your actual API URL.

After deployment, run this read-only check from the repository root:

```bash
python3 scripts/check-deployment.py https://YOUR-API-HOST --web-origin https://YOUR-WEB-HOST
```

Before inviting real households, complete a two-device acceptance run on signed builds:

1. Issue two passkeys into the same household. Sign in on both devices.
2. Add groceries and tasks on each device; check the other device within 15 seconds.
3. Mark a purchase and complete a task. Confirm the admin reports agree. Reassign/reopen the
   task from admin and confirm the other device receives the repair.
4. Disconnect one device, make changes, reconnect, and verify each change appears exactly once.
5. Suspend the home: existing sessions and fresh sign-in must be blocked. Resume it and retry.
6. Sign out/reload/relaunch, then delete a test account; verify access ends and the remaining
   family member keeps access. Deleting the last member removes the shared log and report rows.

Configure database backups, test a restore, and set up uptime/error monitoring with your host.
These operational checks and signed Android/iOS testing cannot be established by unit tests.

## Production web build and admin image

From the repository root, build browser assets with:

```bash
EXPO_PUBLIC_API_URL=https://YOUR-API-HOST node scripts/build-web-production.cjs
```

This fails if the HTTPS API origin is missing or malformed, preventing an accidental sandbox
release. Publish `mobile/dist` with your static host over HTTPS, then set API `CORS_ORIGINS` to
that exact origin and run `scripts/check-deployment.py` with `--web-origin`.

The admin now has its own root-context Dockerfile and named operator tokens; follow
`admin/README.md` and `admin/.env.example`. Keep the admin behind private access. Configure
host-managed database backups and monitoring, then perform a restore into a separate database
and the signed two-device acceptance run above before inviting real families. Hosting accounts,
credentials, restore evidence, and signed-device checks require the actual deployment environment.

## Current free deployment: Neon PostgreSQL

The hosted API uses Neon project `calm-king-20620046` (`hearth` database, `production`
branch) in Singapore. Its connection is stored only in Render's `DATABASE_URL`. The API's
`AUTH_SECRET` is unchanged. `DATABASE_URL` uses `sync: false` in the Blueprint so subsequent
syncs preserve the external connection; new deployments must supply their own Neon connection.

`/healthz` is a database-free liveness probe for Render. `/readyz` explicitly queries PostgreSQL;
use it for release verification, not frequent uptime polling, so the database can scale to zero.
The deployment checker verifies both. Real user traffic and the daily retention job still query
PostgreSQL. Monitor Neon compute, storage and transfer quotas, and export backups.

The previous empty Render database is retained for rollback and expires on 12 December 2026.
Its expiry does not affect the API after the Neon cutover. No household records existed at cutover;
the new database initializes its schema and catalog through normal backend startup.
For admin, use the Neon connection and the unchanged API auth secret as in `admin/README.md`.
Never put either credential in source control or the website build.
