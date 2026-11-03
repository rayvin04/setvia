# Setvia

Make plans that survive the group chat.

Setvia turns a rough plan or invitation into an editable, reviewable form. Phase 2C connects the local /start flow to the server-side Meta Muse Spark 1.3 Standard API for text and image extraction. Rooms, collaboration, and export generation remain previews.

## Local development

Requires Node.js 22.12+ or 24 LTS.

    npm install
    Copy-Item .env.example .env

Add your Meta Model API key to the local .env file as MODEL_API_KEY. Keep credentials out of source files, browser storage, and shared logs.

Run the backend and frontend in separate terminals:

    npm run dev:server
    npm run dev

Open http://127.0.0.1:5173. The Vite server proxies same-origin /api requests to the local backend on port 3001. The API key stays on the server.

## Routes and API

- /: landing page
- /start: text/image plan extraction and adaptive form
- /join: nickname and room link preview
- /demos: fictional scenario entry point
- /demo-studio: local synthetic scenario review and playback workspace
- GET /api/health: local backend readiness
- POST /api/ai/extract/text: extracts from up to 8,000 characters
- POST /api/ai/extract/image: extracts from PNG, JPEG, or WebP images up to 5 MiB

Extracted details are suggestions. Review evidence and uncertainty, resolve conflicts, and confirm information before using it. Image bytes and source text are sent to Meta for extraction; the app does not save them. Local draft saving is optional and stores only structured form fields on this device. It excludes source text, images, extraction evidence, and proxy statements.

## Verification

    npm test
    npm run build

Automated tests and the browser walkthrough use mocked API responses and synthetic inputs. They do not make billable requests. The separately gated live verification from Phase 2B is documented in docs/meta-api.md. Phase 2C has not been live-verified through the UI.

The deployed application is planned to use Meta models only. Lexend is provided by @fontsource-variable/lexend (OFL-1.1); icons use lucide-react (ISC). Respect reduced-motion preferences.

## Bounded agents and private Lab

The transport-independent multi-agent foundation and Setvia Lab are available locally. Run `npm run lab` for the existing mock regressions plus five realistic synthetic scenarios (8, 6, 14, 22, and 58 participants) and open the printed private HTML report. Use `npm run lab:review -- <private-report.json>` for manual reasoning-quality ratings.

`npm run lab:live -- --scenario A,B --confirm-billable` is a separate, gated Muse Spark evaluation using only fixed synthetic scenarios. It requires a billing-check attestation and an exact interactive approval phrase, and caps each selected scenario at 10 HTTP attempts and $0.82 in reserved cost. It is not run automatically. The mock Lab never loads `.env` or calls the network. See [the foundation documentation](docs/agent-foundation.md) for scope, privacy, limits, and verification. The Stage B local room runtime is connected to the browser dashboard; production deployment remains unverified.

## Planning dashboard preview

Run `npm run dev` and open `/dashboard` for the Stage A planning dashboard. It uses real typed room projections and deterministic readiness with clearly labeled, server-projected synthetic fixtures. Explore the mountain hike, participant-specific family questions, proposal revisions, 83% safety blocker, and empty or blocked-analysis states. No API key is required for the dashboard preview.

See [the Stage A dashboard documentation](docs/dashboard-stage-a.md) for the data boundary, synthetic interactions, and validation. The expanded mock Lab now includes the five foundation records plus five realistic group-planning scenarios. Stage B adds authenticated local rooms, SSE updates, and deterministic readiness; production deployment remains separate.

## Synthetic scenario Demo Studio

The local [Demo Studio](docs/synthetic-scenario-studio.md) reviews and versions Muse-generated fictional scenarios, then replays saved room outputs or uses the authenticated live-room API. It requires the Stage B room API/dashboard integration and its shared-budget generator route. Set `SETVIA_PRIVATE_ROOT` to a private folder outside the repository, run `npm run dev:server`, `npm run demo:studio`, and `npm run dev` in separate terminals, then open `/demo-studio`. Generation and live playback remain explicit actions. Private datasets and simulation runs stay outside Git.
