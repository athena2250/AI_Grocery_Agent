# Going live

How to put the Hearth server online and ship the app to Android and iPhone. Do the steps in order. Everything marked **you** needs your own account or a decision; the code is ready.

## What the app does in each mode

| | Sandbox build (`eas build --profile sandbox`) | Live build (`preview` / `production`) |
|---|---|---|
| Sign-in | Code shown on screen, accounts on the phone | Code texted by SMS |
| Data | This phone only | Shared by everyone in the home |
| Understanding messages | On-phone rules | On-phone rules first; anything they don't recognise goes to Ollama on the server |

The live build is chosen by `EXPO_PUBLIC_API_URL` in `mobile/eas.json`. Empty means sandbox.

## 1. Put the server online (you, about 15 minutes)

The repo has a one-click blueprint for Render: `render.yaml` at the repo root. It creates the API (Docker) and a Postgres database in Singapore, the closest region to India.

1. Push this repo to GitHub.
2. render.com → **New → Blueprint** → pick the repo. Render reads `render.yaml`.
3. When asked, fill in `MSG91_AUTH_KEY` and `MSG91_TEMPLATE_ID` (step 2 below). You can deploy first and add them after.
4. When the deploy is green, open `https://<your-service>.onrender.com/healthz`. It should say `{"ok":true}`.
5. If the address is not `https://hearth-api.onrender.com`, put yours in `mobile/eas.json` (both `preview` and `production`).

Any other Docker host works too (Railway, Fly.io, a VPS). Build `backend/Dockerfile` and set the variables in `backend/.env.example`. The server creates its tables on start and refuses to start in production without `AUTH_SECRET`, or with the on-screen "console" SMS sender.

## 2. Text messages (you, can take a few days)

Indian numbers only receive OTP texts from **DLT-registered** senders. That is a TRAI rule, not something the code can avoid.

- **MSG91** (set up for India): register your entity, sender ID, and an OTP template on DLT through MSG91. The template must contain `##OTP##`. Set `SMS_PROVIDER=msg91`, `MSG91_AUTH_KEY`, and `MSG91_TEMPLATE_ID`.
- **Twilio** (outside India): set `SMS_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM`.

Limits already in the server: 30 s between codes, 5 per number per hour, 10 per day, and 30 per IP address per hour.

## 2b. The AI (Ollama), for everyone

How a message is understood: the phone's own rules answer first. They're instant, work offline, and own every question, chip and memory rule. Only a message they don't recognise goes to the server, and the server asks Ollama: other languages ("biyyam aipovachindi"), several items at once ("ek kilo tamatar aur dahi"), or unusual wording ("what do we need to buy"). What Ollama extracts is turned back into plain commands for the rules (`mobile/src/services/HybridAIService.ts`). If Ollama is unreachable or slow (more than 25 s), the rules answer anyway.

Ollama needs about 6 GB of memory for an 8B model, far more than the small Render server has. So it runs on a computer you own, with the server reaching it through a tunnel:

1. On the Mac with Ollama: `brew install cloudflared`, then run `scripts/share-ollama.sh`. It starts Ollama, a **locked gate** in front of it (`backend/app/ollama_gate.py`: only chat requests that carry a secret key get through), and a tunnel. It keeps the Mac awake and prints three values.
2. Paste those values into Render → hearth-api → Environment: `OLLAMA_HOST`, `OLLAMA_API_KEY`, `OLLAMA_MODEL`. The server restarts with them.
3. For an address that never changes, make a free account at ngrok.com, claim the free static domain, run `brew install ngrok` and `ngrok config add-authtoken …`, then start the script with `NGROK_DOMAIN=your-name.ngrok-free.app scripts/share-ollama.sh`. Without that, the Cloudflare quick-tunnel address changes every time the script starts, and you'd have to update `OLLAMA_HOST` each time.

The Mac must be on, awake and online for the AI to answer. When it isn't, nothing breaks; Hearth just understands less. To run it around the clock without the Mac, use a cloud machine with a GPU instead (about $150+ a month). A cheap machine without a GPU would take 20–40 s per message.

Model: `llama3:8b` passes 24 of 26 phrases in the eval set (`OLLAMA_MODEL=llama3:8b .venv/bin/pytest -m llm -s tests/test_understanding_live.py`), taking about 5–9 s per message on an M5. To try a different model, run `ollama pull <model>`, re-run the eval, and change `OLLAMA_MODEL`. To chat with it from the terminal: `OLLAMA_MODEL=llama3:8b .venv/bin/python -m app.understanding`.

## 3. Privacy policy (you, 2 minutes)

The server publishes it at `https://<your-service>/privacy` (`backend/app/static/privacy.html`). Replace **[CONTACT EMAIL]** with the address people should write to, then redeploy. Both stores ask for this URL.

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

1. Mom (or whoever sets it up) installs the live build → **Create an account** → leaves *Home code* empty. This starts the home, and anything already on her phone becomes the home's starting data.
2. More → **Invite family** → **Share code** (for example `HRTH-4K9P`, valid 7 days).
3. Everyone else installs → **Create an account** → enters the home code. They see the same list, pantry, and tasks, updated every 15 seconds and whenever the app opens.

## Developing against a local server

```
cd backend && SMS_PROVIDER=console .venv/bin/uvicorn app.main:app --host 0.0.0.0 --reload
cd mobile && EXPO_PUBLIC_API_URL=http://<your-mac's-LAN-IP>:8000 npx expo start
```

The code appears in the server log and on the screen (sandbox banner).
