# Setvia agent foundation

## Scope

`server/src/agents` contains a transport-independent planning engine. It is tested with synthetic fixtures and a mock gateway. The public Vercel deployment remains a static Vite frontend. The checked-in Express server serves local text and image extraction; it does not mount authenticated room routes or multi-device delivery.

## Roles and control flow

- **Listener** extracts candidate facts from new input. Candidates are unconfirmed until the owner explicitly confirms or shares them.
- **Judge** checks evidence, findings, options, participant constraints, and the next useful action.
- **Negotiator** proposes alternatives; the server independently checks options against confirmed facts and constraints.
- **Question Strategist** creates a small, typed set of clarifying or decision questions and can target a participant when allowed.
- **Speaker** selects validated questions and findings for presentation and returns a bounded mascot state. The backend renders their authorized text, and a final Judge pass must accept the presentation before publication.

The scheduler follows typed Judge instructions and skips unnecessary roles. Cycles have bounded role invocations, HTTP attempts, revisions, elapsed time, token reservations, and estimated cost. Room-level reservations persist across retries. Repetition, stale revisions, cancellation, malformed output, and interrupted work fail closed. Cycles finish as `CONTINUE`, `WAIT_FOR_PARTICIPANT`, `COMPLETED`, or `BLOCKED`; a waiting cycle does not poll. AI completion and readiness do not approve a proposal.

## Reality Checks and deterministic readiness

Every room policy contains exactly six categories: Schedule, Budget, People, Logistics, Preparation, and Safety Checks. Policy controls applicability, weights, required information, and per-participant coverage. Readiness is calculated in `readiness.ts`, not accepted from model output.

Readiness uses confirmed group-visible facts. Unknown required values score as incomplete; private facts do not change the group score. Owner-scoped schedules, budgets, and preferences are not treated as contradictory merely because participants differ. Explicitly shared claims can conflict, and each participant's hard constraints are tested against the same proposal. Hard-constraint violations and critical unresolved findings block the result. Findings need confirmed evidence to be considered resolved. The final positive state is `ready_for_human_review`, never a safety assurance or a vote.

The six checks cover:

| Check | What it evaluates |
| --- | --- |
| Schedule | Availability, timing conflicts, realistic durations, deadlines |
| Budget | Confirmed limits, totals, unclear costs, fit with participant constraints |
| People | Responses, accessibility, attendance conflicts, responsibilities |
| Logistics | Transportation, locations, routes, venues, practical coordination |
| Preparation | Equipment, supplies, materials, preparation responsibilities |
| Safety | Hazards, precautions, emergency preparation, weather and route risks |

The model does not verify current prices, route conditions, weather, venue access, or local safety guidance. Those checks need reliable external evidence and human review.

## Private and group-visible information

Facts, constraints, responses, questions, and messages carry an owner and visibility. Shared model context contains only authorized group-visible information. Private Listener candidates cannot be included in the group context automatically. Private answers can be analyzed for their owner without changing shared readiness. An explicit owner action is required before a candidate enters the group plan. Public targeting of a participant requires that participant's consent.

`RoomService.view` builds an authorized participant projection. Raw room snapshots, pending inputs, private analyses, credentials, model traces, and prompts are internal data and must not be serialized to participants. Private replies are visible to their owner; group replies can be projected to the room. Withdrawal revokes the participant's access. Human approvals bind to an exact proposal version and reset after relevant revisions.

Event attendee estimates are separate from active room members. Room response counts and required approvals are based on actual room members. The room contract caps membership at 100.

## Meta gateway and runtime configuration

`createMetaGateway` wraps the existing pinned Meta Responses client and `muse-spark-1.3`. The API credential is read from the server environment as `MODEL_API_KEY`. The gateway requires role-specific prompt text as input and records prompt hashes and a version; no prompt files or private development instructions are included in the repository. A deployment adapter must load those prompts from a private configuration source and pass them to the gateway.

Agent calls disable automatic retries so every request attempt can be reserved before it starts. `LiveBudgetJournal` stores request hashes, status, usage, and estimated allowances outside the public repository. It does not store credentials or raw requests. Estimates are not invoices. The separate billable `npm run test:meta` path is not part of `npm test` or GitHub Actions.

## Storage and deployment boundary

`RoomStore` serializes writes per room within one process. `JsonPersistence` validates snapshots, requires an absolute path outside the public repository, writes restricted-permission temporary files, and atomically renames them. Corrupt snapshots fail closed; in-flight work is marked blocked after restart while known reservations remain consumed.

This is a single-process storage adapter, not a production deployment design. Multi-instance coordination, durable host volumes, backup and restore, retention and deletion, filesystem permissions, and operational recovery need deployment-specific validation. The public Express app does not currently wire this room core to an authenticated HTTP or event-stream transport. There is no Dockerfile or Compose configuration until those boundaries are ready and testable.

## Verification

`npm test` includes offline extraction, frontend, agent, and live-budget journal tests. Agent tests cover bounded role paths, repeated revisions, participant-owned constraints, private input isolation, targeted questions, explicit sharing, exact-version approvals, cancellation, stale results, budget reservation, snapshots, and corrupt-state handling. The live-budget journal tests use fake responses and temporary files. None of these tests calls Meta. `npm run check:server` type-checks the backend, and `npm run build` checks the frontend build.

GitHub Actions runs `npm ci`, `npm test`, `npm run check:server`, and `npm run build` on pushes and pull requests. It does not receive `MODEL_API_KEY` and does not execute `npm run test:meta`.

## Recorded Muse Spark evaluation

The recorded evaluation covers 11 synthetic runs across five scenario templates. Reconciliation by evaluation run ID gives 39 client-side outbound HTTP attempts and 39 attempt reservations. The client initiated each HTTP attempt after its budget reservation. Thirty-eight received HTTP 200 responses and usage records; one attempt was cancelled/ended in a transport error before an HTTP status or usage record was available.

| Measure | Result | Meaning |
| --- | ---: | --- |
| Client-side outbound HTTP attempts | 39 | Includes one cancelled/transport-error attempt without a response |
| Ledger attempt reservations | 39 | Budget is reserved before each attempt |
| Successful HTTP responses | 38 | All recorded responses returned HTTP 200 |
| Cancelled/transport-error reservation | 1 (US$0.104) | No HTTP status or usage record; included only in at-risk amount |
| Automated assertions | 48 passed | No completed human ratings are available |
| Estimated token usage | US$0.296678 | Sum from the 38 usage records at published Standard rates |
| At-risk ledger amount | US$0.400678 | US$0.296678 estimated usage plus the US$0.104 reservation for the attempt with unknown usage |

The estimate uses Meta's published Standard rates of US$1.25 per million input tokens and US$4.25 per million output tokens. The calculation does not apply cached-input discounts, and it is not a provider invoice. The US$0.104 reservation is budget exposure for an attempt with unknown usage; it is not money spent or a promotional-credit deduction. Automated assertions check expected protocol behavior on synthetic inputs. They are not human ratings and do not establish that the agents are fully reliable or that their plans are accurate in real-world use. Individual model outputs, private prompts, Lab histories, and participant data are not included. See [Meta Model API pricing](https://dev.meta.ai/docs/pricing-rate-limits).

## Remaining work

Authenticated room HTTP handlers, production event delivery, invitation/session recovery, retention and administration, deployment-grade persistence, multi-instance safety, and external sources for Reality Checks are not part of the public deployment. A successful mock test cannot establish model quality or guarantee that a real group can collaborate in live rooms.

