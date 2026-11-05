<p align="center">
  <img src="docs/setvia-cover-2026-11-03.jpg" width="100%" alt="Setvia helps a group turn a chat into a plan everyone can review." />
</p>

<h1 align="center">Setvia</h1>

<p align="center">
  <a href="https://github.com/rayvin04/setvia">Public GitHub repository</a> ·
  <a href="https://setvia.r4yv.tech">Website</a> ·
  <a href="https://setvia.r4yv.tech/#meet-the-minds">Live Muse Spark playground</a> ·
  <a href="https://setvia.r4yv.tech/demos">Planning demos</a> ·
  <a href="docs/architecture.md">Architecture</a> ·
  <a href="LICENSE">Apache-2.0</a>
</p>

<p align="center">
  <a href="https://github.com/rayvin04/setvia/actions/workflows/ci.yml"><img alt="CI workflow" src="https://github.com/rayvin04/setvia/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://dev.meta.ai/docs/overview"><img alt="Meta Muse Spark 1.3" src="https://img.shields.io/badge/Meta%20AI-Muse%20Spark%201.3-0866FF?style=flat-square"></a>
</p>

**Make plans that survive the group chat.**

Setvia helps people turn scattered ideas, private concerns, and practical constraints into a plan the whole group can inspect and decide on together.

> Built from scratch during the Meta Global AI Developer Hackathon, October 26–November 4, 2026.

## The problem

In the Philippines, a plan that never happens may be called **“drawing lang”**—an idea that stays in the group chat. People may want the same outing, reunion, or school project while facing different schedules, budgets, transport options, accessibility needs, and responsibilities. Those details are easy to lose in a fast-moving conversation.

Setvia gives the group a shared planning process: preserve each person’s concerns, make unresolved facts visible, compare options against constraints, and let participants review the same proposal before they agree.

## Try Setvia

- **[Run the live role playground](https://setvia.r4yv.tech/#meet-the-minds).** Choose a Listener, Judge, Negotiator, or Speaker example and click Run to request a fresh Muse Spark 1.3 response. The Speaker card demonstrates a Question Strategist → Speaker handoff. If fresh inference is unavailable, the card identifies its saved fallback. No model call happens until you run a card.
- **[Explore the planning-room demos](https://setvia.r4yv.tech/demos).** Open a fictional Beach Trip, Family Reunion, Project Kickoff, Group Project, or Wedding Planning scenario without an account. The playground and scenario demos require no third-party OAuth, login, or local API key. The authored scenarios let you inspect participant views, questions, proposals, and review states; they do not create a shared room or make model calls.

## How Meta AI powers Setvia

Setvia uses Meta’s **Muse Spark 1.3** through the server-side Meta Responses API (`https://api.meta.ai/v1/responses`). The five names below are distinct application roles with separate instructions and typed contracts; they are not five different models. The API key stays on the server.

| Role | Responsibility | Application boundary |
| --- | --- | --- |
| **Listener** | Interprets one participant’s input as possible facts, needs, or constraints. | Produces private, unconfirmed candidates. The participant reviews them before they enter shared room context. |
| **Judge** | Reviews the authorized facts, evidence, constraints, and open findings. | Chooses the next workflow step. The application calculates readiness independently. |
| **Negotiator** | Suggests bounded alternatives when the current plan needs another option. | The application parses proposals and checks them against hard constraints; a suggestion is not an agreement. |
| **Question Strategist** | Creates a question linked to a specific unresolved finding and participant. | The application validates its schema, evidence references, recipient, consent, and repeated-question status. |
| **Speaker** | Selects validated findings or questions to present clearly to the group. | The application renders from validated objects and runs a final Judge review before publication. |

The [role contracts](server/src/agents/contracts.ts), [orchestration engine](server/src/agents/engine.ts), and [Meta gateway](server/src/agents/meta-gateway.ts) show how the roles work together. Output is treated as a proposal: strict schemas, evidence checks, revision checks, and application-owned rules determine what can affect a room.

The project uses Meta-hosted Muse Spark 1.3; it does not depend on or ship fine-tuned adapters or custom model-weight files.

## Six Reality Checks

Each room can apply the checks relevant to its plan. They highlight what is known, what conflicts, and what still needs evidence or a person’s decision.

| Check | What it reviews | Example question |
| --- | --- | --- |
| **Schedule** | Availability, timing conflicts, duration, and deadlines. | Do the proposed hours fit everyone’s confirmed availability? |
| **Budget** | Individual limits, shared costs, and estimates. | Is the estimated cost within each person’s stated limit? |
| **People** | Attendance, accessibility needs, responses, and responsibilities. | Are the required participants accounted for, and is each task owned? |
| **Logistics** | Destination, transport, route, and coordination. | Is there a confirmed way for everyone to reach the venue? |
| **Preparation** | Supplies, equipment, materials, and preparation tasks. | What needs to be brought, and who will bring it? |
| **Safety** | Hazards, precautions, current guidance, and missing information. | Has someone reviewed current conditions and relevant guidance? |

For example, a fictional beach-trip plan might show a Sunday 10 AM–12 PM availability overlap while leaving travel time unknown. Setvia can surface the open logistics question; it cannot verify a route, forecast, price, venue, or safety condition by itself. Examples in the public demos are fictional.

## From conversation to a decision

1. A participant shares a preference or concern. The Listener turns it into a private candidate for that participant to review.
2. The participant can confirm, edit, or share information. Only authorized, confirmed facts enter the group context.
3. The Judge chooses whether to assess the plan, seek another option, ask a participant, or stop for missing information.
4. The application validates evidence and constraints, computes readiness deterministically, and publishes an authorized room view.
5. Participants review and approve the same proposal version. A changed proposal requires fresh approval; the AI cannot approve on anyone’s behalf.

## Engineering and trust boundaries

- **Conditional orchestration:** the Judge selects the next role needed; Setvia does not run a fixed chain of five model calls for every update.
- **Structured model output:** role responses are checked against strict Zod contracts and known evidence references before use.
- **Deterministic readiness:** the application evaluates confirmed room data and hard constraints. Model-generated percentages do not become the room score.
- **Participant privacy:** private answers and targeted questions are returned only to authorized participant views. Personal Listener inputs in the public playground are not saved or added to a shared cache.
- **Freshness and human control:** room revisions prevent stale work from being published; approvals bind to a specific proposal version.
- **Bounded execution:** provider limits, timeouts, cancellation, request accounting, and no-progress safeguards protect inference and room workflows.

See the [architecture](docs/architecture.md), [judge guide](docs/judge-guide.md), [living playground details](docs/living-playground.md), and [Meta API notes](docs/meta-api.md) for implementation specifics.

## Judge quickstart and reproducibility

The client and API source, lockfile, synthetic scenarios, tests, and CI workflow are all in this public repository. The public demos above open directly in a browser. To reproduce the repository checks from a clean clone, use Node.js 24 or newer:

```bash
git clone https://github.com/rayvin04/setvia.git
cd setvia
npm ci
npm test
npm run build
npm run lab
```

`npm test` passed **210 tests**, and `npm run lab` passed **16 of 16 synthetic scenarios** in the reviewed release. The lab uses a mock gateway and makes **zero live model requests**; the test suite and production build also need no Meta key or GPU.

For local model-backed text/image extraction, copy `.env.example` to `.env` and supply `MODEL_API_KEY` there. Start `npm run dev:server` in one terminal and `npm run dev` in another. The browser never receives the key; do not rename it to a `VITE_` variable. See the [judge guide](docs/judge-guide.md) for API details.

### Observed live inference

In one production smoke check, the four public cards returned **five successful Muse Spark 1.3 responses**: one each for Listener, Judge, and Negotiator, plus the Question Strategist → Speaker pair. The provider journal recorded these response times:

| Role | Observed time |
| --- | ---: |
| Listener | 5.1 s |
| Judge | 8.8 s |
| Negotiator | 4.2 s |
| Question Strategist | 9.4 s |
| Speaker | 5.5 s |

These are single-run smoke measurements, not a statistically sized latency or model-quality benchmark. They show successful live inference; they should not be read as a performance guarantee.

## Key source files

| Area | Source |
| --- | --- |
| Meta API client and extraction | [`server/src/ai/meta-client.ts`](server/src/ai/meta-client.ts) · [`server/src/ai/extract-plan.ts`](server/src/ai/extract-plan.ts) · [`server/src/ai/extract-image.ts`](server/src/ai/extract-image.ts) |
| Role contracts and orchestration | [`server/src/agents/contracts.ts`](server/src/agents/contracts.ts) · [`server/src/agents/engine.ts`](server/src/agents/engine.ts) · [`server/src/agents/meta-gateway.ts`](server/src/agents/meta-gateway.ts) |
| Readiness and room state | [`server/src/agents/readiness.ts`](server/src/agents/readiness.ts) · [`server/src/agents/rooms.ts`](server/src/agents/rooms.ts) · [`shared/room-model.ts`](shared/room-model.ts) |
| Public Muse Spark playground | [`client/LivingPlayground.tsx`](client/LivingPlayground.tsx) · [`server/src/playground/router.ts`](server/src/playground/router.ts) · [`server/src/playground/service.ts`](server/src/playground/service.ts) |
| Tests and CI | [`server/src/agents/agents.test.ts`](server/src/agents/agents.test.ts) · [`server/src/playground/playground.test.ts`](server/src/playground/playground.test.ts) · [CI workflow](.github/workflows/ci.yml) |

## License

Setvia’s original software and documentation are available under the [Apache License 2.0](LICENSE). Third-party packages and assets retain their respective licenses; see [third-party notices](docs/third-party-notices.md) and [asset provenance](docs/ASSETS.md).
