# Planning dashboard — Stage A

The `/dashboard` route is a responsive planning-room preview built around the existing agent and room contracts. It preserves Setvia's Lexend typography, dark palette, original cat, and character avatars. The default example is a fictional mountain hike.

## Run locally

Run `npm run dev` and open `http://127.0.0.1:5173/dashboard`. The dashboard's synthetic fixtures need no API key or extraction server. The existing `/start` extraction flow still uses its separate backend when explicitly invoked.

The scenario and viewer selectors are simulation controls. They select authored synthetic identities, not authenticated access to real rooms. `/rooms/:roomId` deliberately loads no participant data until authenticated room delivery is implemented.

## Implemented UI

- Desktop: a compact header and preview toolbar above three coordinated columns. Participants and response progress stay visible on the left; the gauge and evolving proposal share the center; the original cat explains the finding above six Reality Checks. Secondary activity scrolls internally, and plan decisions/history expand on demand. The primary content and floating composer fit ordinary desktop viewports without whole-page scrolling.
- Mobile/tablet: compact room identity and actual room-member status, then keyboard-accessible Overview, Plan, People, Issues and Activity tabs. Overview prioritizes readiness and the mascot finding. The composer stays accessible across tabs; bottom spacing and visual-viewport offsets keep content reachable around safe areas and overlay keyboards.
- Readiness: deterministic percentage, category scores, unresolved findings, previous/current scores, deltas and explanations. A critical blocker overrides ordinary thresholds. In the safety fixture, **83% remains BLOCKED**. A blocked agent cycle labels its retained score historical. No evaluation produces no percentage.
- Responses and approvals: separate counts. Approvals refer to one exact proposal version and clear after material revisions. A complete evaluation or 100% score does not approve a plan.
- Speaker: published authorized findings and recipient labels. The current actionable question appears once, immediately above the floating input with its validated options. A restrained cat reaction acknowledges a new question or local response. No animation or copy claims that inference is running.
- Decisions: expandable validated compromise options. Previewing a revision replays an actual `RoomService.revise` operation and independently evaluated fixture snapshot.
- Checks: Schedule, Budget, People, Logistics, Preparation and Safety, with status, count, severity, explanation and required action. Safety information never establishes that an activity is safe.

## Data and privacy boundaries

`shared/dashboard.ts` defines strict snapshot and action schemas. `projectDashboardRoom` explicitly selects dashboard-safe fields from an authorized `RoomService.view` result. The browser never receives raw room snapshots, private facts, Listener candidates, credentials, pending responses, traces or prompts.

The additive room-view fields are room/viewer IDs, current-version participant approval IDs and current validated shared findings. Existing authorization, question targeting, stale-analysis suppression and exact-version approval remain server responsibilities.

The development/preview Vite middleware serves only synthetic projections at `/api/dashboard-preview/:scenario/:viewer`. Each fixture runs the real in-memory room service and bounded engine with a scripted gateway. Per-recipient questions and activity are projected on the server before serialization. Fixture credentials and raw private inputs stay in server memory; there is no real-room API in this middleware.

Snapshots carry room identity, viewer identity, proposal version, room revision and a monotonic sequence. The UI rejects malformed, duplicate, regressive or foreign snapshots. This is a transport boundary for a later authenticated controller or Socket.IO delivery, not a production synchronization implementation.

The existing room model has no durable versioned response ledger. Synthetic response counts come from explicit authored submissions. A real snapshot must use `responseTracking: "unavailable"` and no fabricated response records. The shared participant/response bounds follow the foundation's 100-person cap.

## Synthetic and real behavior

All visible demo participants and activity are fictional. The composer records genuine temporary local preview contributions under the selected synthetic member. It accepts trimmed text up to 1,000 characters, multiline input, Ctrl/Command+Enter, private/group visibility and exact validated quick replies. Alternative choices focus the input; Review details opens the relevant check. Pending/error states retain a recoverable draft. Answering a question never approves the proposal.

`shared/planning-message.ts` defines the reusable message, receipt and asynchronous submission-handler types. Its validator checks the room, current member, revision, proposal version, authorized question, allowed reply and audience, reusing the existing dashboard action validator. `MessageComposer` receives identity, question/options, visibility choices, submission handler, disabled/pending state and safe errors. It contains no scenario-specific answers or agent implementation.

`createPreviewInteractions` is a separate, bounded, in-memory adapter. It validates again immediately before recording, supports cancellation and projects group messages to room members while showing private text only to its author. Switching viewers clears the composer draft. Reset/reload clears temporary data; nothing is persisted or sent to Meta. Only synthetic current-version response flags and the author's answered-question display change. Readiness, approval, proposal versions and engine state do not change after a submission. Private preview projection is a simulation boundary, not production access control.

The visibility selector explains that private answers are hidden from other participants, not from the AI provider. Real AI processing sends submitted content to Meta's Model API. Production transport must enforce audience rules on the server before serialization and retain the existing authenticated action/authorized-view boundaries.

The separately labeled update/revision controls replay deterministic fixture steps. The default sequence demonstrates 72% to 92%, changed explanations and cleared approvals. These evaluated fixture snapshots are independent of composer submissions and remain compatible with later scripted demo playback.

Room members and event attendees are separate. Response and approval denominators use actual room members; an optional expected-attendee count appears only in plan details.

The foundation, deterministic scorer, authorized projection, validation and stale-update adapter are real code. Stage B now provides the local authenticated handler through `/api/rooms`: it derives participant identity from the session, revalidates each submission, persists audience metadata and response receipts, and delivers per-viewer snapshots over SSE. Invitations and refresh recovery are implemented locally. Extracted facts still require owner confirmation; approval stays a separate exact-version action. See the README's local room verification commands. Production hosting remains pending. Location is a text summary; maps, routing, image generation and exports are out of scope.

## Verification

Run `npm test`, `npm run build` and `npm run lab`. Offline dashboard tests cover composer validation, privacy projection, current identity/version leases, cancellation and pending races, reply definitions, safe errors, attendee/member separation, keyboard insets, readiness/critical gates, action validation, stale updates, analysis failure, unknown scores, semantic Lab regressions and the 58-person schema boundary.

Playwright checks cover the composer/quick-reply flow, multiline and keyboard submission, private/group visibility across viewers, pending/error/retry, preview progression and approval invalidation, critical/blocked/unknown states, mobile tab navigation, simulated visual-viewport keyboard positioning and real-room fail-closed behavior. Refinement captures cover 1280×720, 1366×768, 1440×900, 1920×1080, 360×780, 390×844, 430×932, 768×1024 and 1024×768 with no horizontal overflow. Hardware mobile keyboard behavior still needs a real-device check. Screenshots and execution evidence are kept in the private development workspace, outside the repository.

No live or billable Meta requests are needed for these checks. No production deployment is part of Stage A.
