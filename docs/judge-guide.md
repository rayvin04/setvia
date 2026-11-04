# Judge demo guide

This guide distinguishes the homepage’s bounded live role playground from the synthetic scenario preview and the full planning-room flow.

## Public Muse Spark role playground

Open [setvia.r4yv.tech/#meet-the-minds](https://setvia.r4yv.tech/#meet-the-minds). No account is required. Choose one of the four role cards and explicitly run a scenario to see the returned result and whether it was generated live or served from cache. The cards use Muse Spark 1.3 through the server-side playground API. Speaker demonstrates a Question Strategist → Speaker handoff. No model call happens on page load.

These are bounded role examples, not a complete group-planning session. They do not create a room or collect approvals. The optional Listener thought is not saved or placed in a public scenario cache. See the [playground guide](living-playground.md) for the role map and safeguards.

## Public synthetic demonstration

Open [setvia.r4yv.tech/demos](https://setvia.r4yv.tech/demos). No account is required.

1. Choose one of the fictional examples: Beach Trip, Family Reunion, Project Kickoff, Group Project, or Wedding Planning.
2. Select **Explore the planning dashboard**.
3. Explore the available dashboard views and synthetic preview interactions. The dashboard can show different fictional participants and preview states.

The preview data is loaded from static JSON files in [`public/dashboard-preview/`](https://github.com/rayvin04/setvia/tree/main/public/dashboard-preview). The route makes no Meta request. Names, participant input, group activity, readiness, questions, replies, and proposals are fictional. Dashboard preview interactions are local to the browser session and are not shared with other visitors.

The deployed site is a static Vite frontend. Model-backed operations use the separate Express API; `/demos` and `/dashboard` remain synthetic previews. The homepage playground does not create an authenticated room. See the local setup below for running the development server.

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

### What the playground does not demonstrate

The role cards do not show a complete real group-planning cycle or multi-device room. Room cycles require the configured API runtime and private server-side role prompts; those prompt files are intentionally not part of this public repository. The offline suite uses a mock gateway and synthetic fixtures.

### Optional API smoke command

The repository also has `npm run test:meta`. This script makes real Meta API requests and may incur account usage. It is not part of `npm test` or CI. Before running it, check account credits and limits in Meta's dashboard, use synthetic inputs only, and follow the script's explicit billing-check requirement. The recorded cost estimate is not an account invoice.

## Evaluation trail

For source-backed details, start with:

- [Meta API implementation](https://github.com/rayvin04/setvia/blob/main/server/src/ai/meta-client.ts)
- [Extraction UI](https://github.com/rayvin04/setvia/blob/main/client/StartPlanning.tsx)
- [Express routes](https://github.com/rayvin04/setvia/blob/main/server/src/http/app.ts)
- [Agent tests](https://github.com/rayvin04/setvia/blob/main/server/src/agents/agents.test.ts)
- [Existing live-call accounting](agent-foundation.md#recorded-muse-spark-evaluation)
