# Planning dashboard — Stage A

The `/dashboard` route is a responsive planning-room preview built around the existing agent and room contracts. It preserves Setvia's Lexend typography, dark palette, original cat, and character avatars. The default example is a fictional mountain hike.

## Run locally

Run `npm run dev` and open `http://127.0.0.1:5173/dashboard`. The dashboard's synthetic fixtures need no API key or extraction server. The existing `/start` extraction flow still uses its separate backend when explicitly invoked.

The scenario and viewer selectors are simulation controls. They select authored synthetic identities, not authenticated access to real rooms. `/rooms/:roomId` deliberately loads no participant data until authenticated room delivery is implemented.

## Implemented UI

- Desktop: participants, response progress and activity on the left; animated readiness, the evolving proposal, location summary, compromises and history in the center; the original cat, structured questions and six Reality Checks on the right.
- Mobile/tablet: prominent readiness and latest question, followed by keyboard-accessible Plan, People, Issues and Activity tabs.
- Readiness: deterministic percentage, category scores, unresolved findings, previous/current scores, deltas and explanations. A critical blocker overrides ordinary thresholds. In the safety fixture, **83% remains BLOCKED**. A blocked agent cycle labels its retained score historical. No evaluation produces no percentage.
- Responses and approvals: separate counts. Approvals refer to one exact proposal version and clear after material revisions. A complete evaluation or 100% score does not approve a plan.
- Speaker: published structured backend question/message content, recipient labels, validated answer options, additional-information preview and finding inspection. No animation or copy claims that inference is running.
- Decisions: expandable validated compromise options. Previewing a revision replays an actual `RoomService.revise` operation and independently evaluated fixture snapshot.
- Checks: Schedule, Budget, People, Logistics, Preparation and Safety, with status, count, severity, explanation and required action. Safety information never establishes that an activity is safe.

## Data and privacy boundaries

`shared/dashboard.ts` defines strict snapshot and action schemas. `projectDashboardRoom` explicitly selects dashboard-safe fields from an authorized `RoomService.view` result. The browser never receives raw room snapshots, private facts, Listener candidates, credentials, pending responses, traces or prompts.

The additive room-view fields are room/viewer IDs, current-version participant approval IDs and current validated shared findings. Existing authorization, question targeting, stale-analysis suppression and exact-version approval remain server responsibilities.

The development/preview Vite middleware serves only synthetic projections at `/api/dashboard-preview/:scenario/:viewer`. Each fixture runs the real in-memory room service and bounded engine with a scripted gateway. Per-recipient questions and activity are projected on the server before serialization. Fixture credentials and raw private inputs stay in server memory; there is no real-room API in this middleware.

Snapshots carry room identity, viewer identity, proposal version, room revision and a monotonic sequence. The UI rejects malformed, duplicate, regressive or foreign snapshots. This is a transport boundary for a later authenticated controller or Socket.IO delivery, not a production synchronization implementation.

The existing room model has no durable versioned response ledger. Synthetic response counts come from explicit authored submissions. A real snapshot must use `responseTracking: "unavailable"` and no fabricated response records. The shared participant/response bounds follow the foundation's 100-person cap.

## Synthetic and real behavior

All visible demo participants and activity are fictional. Answer buttons and text forms preview a choice within the page; they neither submit real responses nor change readiness or approval. The separately labeled update/revision controls replay deterministic fixture steps. The default sequence demonstrates 72% to 92%, changed explanations and cleared approvals.

The actual foundation, deterministic scorer, authorized projection, validation and stale-update adapter are real code. Production authentication/HTTP room controllers, invitations/recovery, response persistence, event synchronization, external evidence verification and Socket.IO remain later integration work. Location is a text summary; maps, routing, image generation and exports are out of scope.

## Verification

Run `npm test`, `npm run build` and `npm run lab`. Offline dashboard tests cover readiness/critical gates, private/group question projections, action validation, stale updates, analysis failure, unknown scores, semantic Lab regressions and the 58-person schema boundary.

Playwright checks cover desktop/tablet/mobile composition, both decision types, readiness progression, approval invalidation, privacy in server JSON and DOM, real-room fail-closed behavior, retry/loading/empty states, native disclosures, mobile keyboard tabs, reduced motion and horizontal overflow from 320px through 1672px. Screenshots and execution evidence are kept in the private development workspace, outside the repository.

No live or billable Meta requests are needed for these checks. No production deployment is part of Stage A.
