# Judge demo guide

This guide separates the public synthetic preview from local Meta-enabled code. Both are useful for evaluation, but they demonstrate different parts of the repository.

## Public synthetic demonstration

Open [setvia.r4yv.tech/demos](https://setvia.r4yv.tech/demos). No account is required.

1. Choose one of the fictional examples: Beach Trip, Family Reunion, Project Kickoff, Group Project, or Wedding Planning.
2. Select **Explore the planning dashboard**.
3. Explore the available dashboard views and synthetic preview interactions. The dashboard can show different fictional participants and preview states.

The preview data is loaded from static JSON files in [`public/dashboard-preview/`](https://github.com/rayvin04/setvia/tree/1c6a4894a8acc562830dce89a770a126c2f332bb/public/dashboard-preview). The route makes no Meta request. Names, participant input, group activity, readiness, questions, replies, and proposals are fictional. Dashboard preview interactions are local to the browser session and are not shared with other visitors.

The landing page, `/demos`, `/dashboard`, and `/start` UI can be viewed on the public site. The deployed site is a static Vite app. It does not include the local Express API or authenticated room transport, so the public page is not a live group-planning service. The `/start` form's Meta extraction path requires a separately running local server.

**Video:** The submission video does not have a verified URL yet. Add it to the README after recording and checking the final link.

## Local Meta-enabled development

This path tests the real server-side extraction integration. It is separate from the public synthetic preview.

### Requirements

- Node.js 24 LTS.
- A Meta Model API key configured only on the local server as `MODEL_API_KEY`.
- Synthetic text and images for demonstration. Text and uploaded image content are sent to Meta when a request is made.

### Start the API and frontend

In the repository root:

```powershell
npm ci
Copy-Item .env.example .env
# Use a private editor to set MODEL_API_KEY in .env.
npm run dev:server
```

In a second terminal:

```powershell
npm run dev
```

Open [http://127.0.0.1:5173/start](http://127.0.0.1:5173/start). Vite serves the frontend on port 5173 and proxies `/api` to the local Express API on port 3001. The supported API routes are:

- `GET /api/health`
- `POST /api/ai/extract/text`
- `POST /api/ai/extract/image`

Muse Spark returns structured candidate details. The page lets a person review and edit them; model suggestions are not decisions. The image route accepts PNG, JPEG, or WebP up to 5 MiB. The text route accepts up to 8,000 characters. No image-generation model is called.

### What is not a live demo

The public `main` snapshot does not connect the browser to `AgentEngine`, create authenticated planning rooms, or run live multi-device collaboration. The agent gateway requires role prompts loaded by a server adapter; those prompt files are intentionally not part of this public repository. The offline suite uses a mock gateway and synthetic fixtures.

The separate local Stage B integration branch is unpublished. Its latest recorded checks cover three targeted live model contracts; a complete real planning-room cycle has not been verified. No statement here presents Stage B as deployed or merged.

### Optional API smoke command

The repository also has `npm run test:meta`. This script makes real Meta API requests and may incur account usage. It is not part of `npm test` or CI. Before running it, check account credits and limits in Meta's dashboard, use synthetic inputs only, and follow the script's explicit billing-check requirement. The recorded cost estimate is not an account invoice.

## Evaluation trail

For source-backed details, start with:

- [Meta API implementation](https://github.com/rayvin04/setvia/blob/1c6a4894a8acc562830dce89a770a126c2f332bb/server/src/ai/meta-client.ts)
- [Extraction UI](https://github.com/rayvin04/setvia/blob/1c6a4894a8acc562830dce89a770a126c2f332bb/client/StartPlanning.tsx)
- [Express extraction routes](https://github.com/rayvin04/setvia/blob/1c6a4894a8acc562830dce89a770a126c2f332bb/server/src/http/app.ts)
- [Agent tests](https://github.com/rayvin04/setvia/blob/1c6a4894a8acc562830dce89a770a126c2f332bb/server/src/agents/agents.test.ts)
- [Existing live-call accounting](agent-foundation.md#recorded-muse-spark-evaluation)
