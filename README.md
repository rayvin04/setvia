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

`npm run lab:live -- --scenario A,B --confirm-billable` is a separate, gated Muse Spark evaluation using only fixed synthetic scenarios. It requires a billing-check attestation and an exact interactive approval phrase, and caps each selected scenario at 10 HTTP attempts and $0.82 in reserved cost. It is not run automatically. The mock Lab never loads `.env` or calls the network. See [the foundation documentation](docs/agent-foundation.md) for scope, privacy, limits, and verification. Room collaboration is not yet connected to the production UI.

## Planning dashboard preview

Run `npm run dev` and open `/dashboard` for the Stage A planning dashboard. It uses real typed room projections and deterministic readiness with clearly labeled, server-projected synthetic fixtures. Explore the mountain hike, participant-specific family questions, proposal revisions, 83% safety blocker, and empty or blocked-analysis states. No API key is required for the dashboard preview.

See [the Stage A dashboard documentation](docs/dashboard-stage-a.md) for the preview data boundary and synthetic interactions. The expanded mock Lab includes the five foundation records plus five realistic group-planning scenarios. Local room delivery now uses authenticated HTTP writes and authorized SSE snapshots; production hosting remains separate work.

## Local room verification

The local room runtime supports invitations, participant sessions, private and group responses, version-specific approvals, deterministic readiness, and private JSON snapshots. Run one authoritative backend process. Private prompts, credentials, snapshots and Lab reports must remain outside this checkout.

For an offline browser check, set `SETVIA_PRIVATE_ROOT` to that external private workspace, run `node --import tsx scripts/serve-room-offline.ts`, and start the frontend with `npm run dev -- --port 5175`. The room banner identifies mock inference; the harness sends no Meta requests. Its canned responses exercise the actual room service, agent loop and SSE projection. Extraction is disabled in this harness.

For authorized live execution, set `SETVIA_LIVE_ENABLED=1`, `SETVIA_ROOM_ORIGINS=http://127.0.0.1:5175`, and `SETVIA_PRIVATE_ROOT`. Set `SETVIA_LIVE_BILLING_CHECKED=1` only after the manual billing check and explicit request authorization. Start with `node --env-file="C:\private\setvia.env" --import tsx server/src/index.ts`, substituting the existing private environment file. The current private prompt version is `agents-v7`. Credentials are loaded into the backend process; a worktree-local `.env` copy is unnecessary.

Live inference uses persistent Stage B and global ledgers. The runtime holds the complete bounded cycle allowance before its first request and returns unused capacity afterward. Restarting preserves consumed reservations. Exhausted caps require fresh developer authorization. Text and image autofill are unavailable while this bounded room runtime is active because the standalone extractor has no shared ledger adapter; enter the initial plan manually. The separate `scripts/verify-room-contracts.ts --execute` performs three gated synthetic live contract checks; it never publishes a planning-room result.
