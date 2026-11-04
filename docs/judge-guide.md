# Judge demo guide

This guide distinguishes Setvia’s bounded live role playground, its no-login fictional planning-room demo, and local Meta-enabled extraction. Each shows a different part of the project.

## Public Muse Spark role playground

Open [setvia.r4yv.tech/#meet-the-minds](https://setvia.r4yv.tech/#meet-the-minds). No account is required. Choose one of the four role cards and explicitly run a scenario to see its result and whether it was generated live or served from cache. The cards use Muse Spark through the server-side playground API. Speaker demonstrates a Question Strategist → Speaker handoff. No model call happens on page load.

These are bounded role examples, not a complete group-planning session. They do not create a room or collect approvals. The optional Listener thought is not saved or placed in a public scenario cache. See the [playground guide](living-playground.md) for the role map and safeguards.

## No-login fictional planning-room demo

Open [setvia.r4yv.tech/demos](https://setvia.r4yv.tech/demos). No account, API key, or setup is required.

1. Choose Beach Trip, Family Reunion, Project Kickoff, Group Project, or Wedding Planning.
2. Select **Try the … Demo** to open the matching planning room.
3. Switch the fictional participant view, inspect the questions and proposal, try a suggested answer or custom message, and follow the authored stages. Use **Reset demo** to start over.

Direct links can select a scenario, viewer, and stage, for example `/dashboard?scenario=family&viewer=mika&frame=initial` or `/dashboard?scenario=study&viewer=alex&frame=review`. Stages are **Initial discussion**, **Questions answered**, **Revised proposal**, **Participant review**, and **Alternative proposal**. Each regular demo has four fictional participants, distinct constraints, six Reality Check categories with scenario-specific applicability, and unresolved details. No approvals are prefilled. The technical selector also has a mountain hike, critical safety blocker, blocked analysis, unevaluated room, and loading state.

Dashboard data comes from schema-validated fixtures generated through the room domain with a scripted mock gateway. Answers, messages, and explicit demo approvals stay in the browser session; they are not shared with visitors, persisted to the server, sent to a room API, or used to trigger an AI cycle. Selecting a stage displays its authored fixture. Readiness changes only when the selected fixture contains a valid changed state. The demo makes no Meta request.

The static assets are viewer-scoped under [`public/dashboard-preview/`](https://github.com/rayvin04/setvia/tree/main/public/dashboard-preview). The family access detail and question appear only in the intended participant’s view. These URLs are publicly fetchable, so this format must contain fictional data only and must never be used for real private information.

`/demos` and `/dashboard` are synthetic previews on the static Vite site. They do not create an authenticated room or represent a completed live planning cycle. Live room cycles require the configured Express runtime and private server-side role prompts.

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