# Meta Model API integration

The local backend foundation uses the Meta Model API Responses endpoint:

- Host: https://api.meta.ai/v1
- Endpoint: /responses
- Model: muse-spark-1.3 Standard
- Authentication: server-side MODEL_API_KEY

The React client does not contain or receive the API key. The client pins the host and model and rejects a Contributor model ID. It does not use web search, tools, Muse Image generation, or a database.

## Local configuration

Copy .env.example to .env and add a Meta Model API key locally. Keep .env out of version control. Do not paste credentials into source files, terminal output, browser storage, client code, or shared logs.

    npm install
    npm test
    npm run build

The automated test suite uses mocked HTTP responses and synthetic inputs. It does not make billable requests.

## Live smoke and extraction run

Before live testing, inspect the Meta Model API dashboard for available credits or billing limits and the current team limits. This repository cannot inspect account-specific billing. The live script requires a local MODEL_API_KEY and a deliberate billing-check marker:

    META_TESTS_BILLING_CHECKED=1 npm run test:meta

In PowerShell:

    $env:META_TESTS_BILLING_CHECKED = "1"
    npm run test:meta

The command sends three small requests using Muse Spark Standard: a short connectivity prompt, one planning extraction, and one synthetic screenshot extraction. A shared cap stops after four HTTP attempts total, including a single retry. It never calls Muse Image. Do not use real private group chats in this test.

The command prints the answer or candidate extraction, returned model, elapsed time, token counts when supplied, and a cost estimate based on the published Standard prices checked on 2026-11-03. It compares the text and screenshot outputs with the known synthetic inputs and stops with a review result if key facts are missing. Actual account billing and credits must be checked in Meta's dashboard; the displayed estimate is not a statement of account balance. Refresh the published rates before running this script on a later date.

## Data handling

Screenshot bytes are validated in memory and sent as a data URL to Meta. This implementation creates no upload temp file and does not persist prompts, images, responses, or request bodies. Standard mode is selected by model ID; this is not a zero-retention promise. Treat extracted values as unconfirmed candidates for a person to review.

## Implemented scope

- Shared Meta Responses API client with configuration checks, timeouts, safe errors, bounded retries, and safe usage metadata.
- Zod-validated planning extraction with structured JSON output.
- In-memory PNG, JPEG, and WebP validation and image extraction.
- Offline fixtures for English, Tagalog, uncertain dates, and unspecified budget concerns.

## Phase 2C local API and form integration

The local Express server exposes these same-origin routes through the Vite proxy:

- GET /api/health for readiness.
- POST /api/ai/extract/text accepts JSON with up to 8,000 characters; the request body limit is 40 KiB.
- POST /api/ai/extract/image accepts raw PNG, JPEG, or WebP bytes up to 5 MiB.

The backend enforces per-IP rate limiting, safe errors, response validation, security headers, and no-store caching. It pins Muse Spark 1.3 Standard using the existing server-only Meta client. The local browser never receives the key. Input text and image bytes are sent to Meta for extraction and are not persisted by this app. No upload temp files are created.

The /start form accepts text or an invitation image, maps extracted candidates to adaptive form fields, and shows evidence, uncertainty, approximate counts or costs, and invited/confirmed/estimated attendance. Users can accept, reject, keep their edit, or use a conflicting suggestion. Missing values remain blank. Proxy statements are session-only and unconfirmed by default.

Optional device-local draft saving stores only structured editable form fields. It does not store source text, image data, extraction evidence, or proxy statements. Users can disable and clear it.

Phase 2C build, offline tests, and browser checks used mocked API responses. No Phase 2C live Meta requests were made, so the UI-to-Meta path still needs a separately authorized live smoke check. This note records the actual verification scope as of 2026-11-03.

## Official API references

- [Meta Model API quickstart](https://dev.meta.ai/docs/quickstart)
- [Models](https://dev.meta.ai/docs/models)
- [Structured output](https://dev.meta.ai/docs/structured-output)
- [Image understanding](https://dev.meta.ai/docs/image-understanding)
- [Responses API](https://dev.meta.ai/docs/protocols/responses)
- [Pricing and rate limits](https://dev.meta.ai/docs/pricing-rate-limits)
