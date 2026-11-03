# Setvia

**Live site:** [https://setvia.r4yv.tech](https://setvia.r4yv.tech)

![Setvia cover with the Setvia cat mascot](docs/setvia-cover.jpg)

Make plans that survive the group chat.

Setvia is a planning UI prototype. Public dashboard scenarios, participants, activity, readiness, and replies are synthetic. The public site does not provide live room collaboration or model-backed dashboard planning. The `/start` UI is preserved; text and image extraction require the separately configured local backend and are not available on the public static site.

## Local development

Requires Node.js 22.12+ or 24 LTS.

    npm install
    npm run dev:server
    npm run dev

The local backend can use Meta Muse Spark for text and image extraction when configured with a server-side `MODEL_API_KEY`. Keep `.env` and credentials out of source files, browser storage, and shared logs. Extracted details are suggestions; review evidence and uncertainty before using them. The API does not save source text or image bytes. Local draft saving is optional and stores structured form fields only.

## Routes and API

- `/`: landing page
- `/start`: text/image plan extraction UI and adaptive form
- `/join`: nickname and room-link preview
- `/demos`: fictional scenario entry point
- `/dashboard`: synthetic planning dashboard preview
- `GET /api/health`: local backend readiness
- `POST /api/ai/extract/text`: local extraction from up to 8,000 characters
- `POST /api/ai/extract/image`: local extraction from PNG, JPEG, or WebP images up to 5 MiB

## Verification

    npm test
    npm run check:server
    npm run build

Automated tests use mocked API responses and synthetic inputs; they do not make billable requests. Respect reduced-motion preferences. Lexend is provided by `@fontsource-variable/lexend` (OFL-1.1); icons use `lucide-react` (ISC).
