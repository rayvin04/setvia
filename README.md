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