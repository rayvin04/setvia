# Bounded agent foundation

The server domain core is in server/src/agents. The existing text/image extraction API remains unchanged. The new negotiation core is not yet connected to browser room routes or Socket.IO.

## Offline development

    npm test
    npm run build
    npm run lab

Lab has no live mode, never loads .env, and disables fetch. It runs five synthetic scenarios and writes private JSON history plus a self-contained HTML report to the sibling setvia-local/lab directory. Open the printed HTML path to inspect the real role path, structured handoffs, accepted/rejected options, final evaluation, readiness, usage metadata, and reserved allowances. Native disclosure controls expose trace details. Private Listener input/output is redacted. These runs test orchestration, not model accuracy.

## Roles and control

Listener interprets new private input into private unconfirmed candidates. Only an authenticated participant action can confirm or share a fact. Judge audits findings and options. Negotiator proposes and revises options. Question Strategist creates targeted questions. Speaker selects validated question/finding references and a bounded mascot state; the backend renders their authorized text. VisualPlanner is an extension interface with no image generation implementation.

The scheduler follows typed Judge tasks and may skip roles. It supports repeated Judge/Negotiator revisions. It detects canonical repetition, checks state revisions, and enforces invocation, attempt, revision, time, token-reservation and cost-reservation limits. Successful cycles end with a Judge evaluation; where no further artifact is needed, the last Judge assessment is final without a redundant call. Speaker drafts require a subsequent final Judge acceptance before publication.

Outcomes are CONTINUE, WAIT_FOR_PARTICIPANT, COMPLETED, and BLOCKED. Waiting/completed cycles do not poll. New input resumes a new revision. Failed, cancelled, stale or interrupted work cannot fabricate a final evaluation. A controlled retry retains lifetime reservations.

## Privacy and authorization

RoomService authenticates high-entropy participant credentials using server-side hashes. Shared role input is projected from group-authorized facts only. Private Listener candidates cannot automatically become shared constraints. Public targeting requires the target's explicit consent. Each participant can change only their own facts and constraints. Participant views filter private facts, candidates, questions, and messages; withdrawal revokes access.

Cycle objects, traces, and snapshots are trusted server-internal objects. They must never be serialized as participant API responses. Use RoomService.view for an authenticated participant projection. The Lab exporter is for synthetic MOCK records only; live traces require a separately reviewed projection/retention policy. No new public or unauthenticated Lab route was added.

Proposal, policy, requirement and membership changes invalidate relevant approvals. Human votes bind the exact proposal version; answers and AI completion do not vote. Every currently required real participant must approve. Future organizer-only administration requires its own authorization policy.

## Reality Checks and readiness

These exact six names are preserved:

| Category          | Purpose                                                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schedule Check    | Availability conflicts, impossible timing, overlaps, unrealistic duration, missing deadlines.                                                      |
| Budget Check      | Per-person limits, estimates, unclear expenses, conflicts with confirmed financial constraints.                                                    |
| People Check      | Missing responses/confirmations, accessibility, attendance, responsibilities and roles.                                                            |
| Logistics Check   | Transport, venues, locations, routes, travel arrangements and practical coordination.                                                              |
| Preparation Check | Event-specific equipment, materials, supplies, things to bring and preparation responsibilities.                                                   |
| Safety Check      | Hazards, precautions, emergency planning/communications, weather and route risks, relevant local guidance. AI evaluation never establishes safety. |

Each room supplies an event-adaptive six-category policy with applicability, weights, and required information keys. Only an authenticated human action can change policy; the model cannot shrink the denominator. Initial policy selection is required, rather than inferred as a completed checklist.

Readiness-v1 uses weighted category completeness. Only confirmed, group-authorized facts count toward required information. Generic deterministic predicates support required values, equality, and numeric upper/lower limits. Conflicting confirmed facts and hard-constraint violations block readiness. Unknown categories score zero. Unresolved findings cap a category; critical issues block ready status even in a category marked not applicable. Omitted unresolved findings carry forward, and a claimed resolution needs valid confirmed category evidence. The final label is ready_for_human_review, never a safety assurance or group approval.

Real-world prices, routes, weather, venue access, dates and hazards are not externally verified by this foundation. More complex domain-specific predicates or external evidence tools remain future work. Model findings carry evidence references, severity, status, uncertainty, and a recommended action.

## Persistence and Meta boundary

RoomStore provides one serialized writer per room. JsonPersistence requires an absolute private storage root outside the public repository. It validates snapshots, flushes temporary files, and atomically renames them. Corrupt files are quarantined and fail closed rather than silently rolling back approvals or spending. Restart recovery marks interrupted work BLOCKED and retains known readiness/reservations.

This is a single-process design. Filesystem durability, directory permissions/Windows ACLs, backup protection, retention, and deletion need deployment-specific validation. Ephemeral hosting storage is not durable room storage.

The Meta gateway reuses the existing pinned official Responses client and muse-spark-1.3 Standard model. Prompts are supplied from the private workspace, with hashes in traces. Automatic retries are disabled for agent calls. The existing client now offers an awaited hook immediately before each HTTP attempt, including retries, so reservations can be persisted before a request starts.

Live gateways require explicit limits, private prompts, request/output bounds, and caller-supplied dated pricing/allowances. Per-cycle and per-room ceilings are enforced outside model output. Unknown usage stays unknown, while conservative reservations remain consumed. Allowances are estimates, not invoices; the new role schemas/prompt behavior have not been live-verified. No live inference is enabled by the Lab command. New billable checks require separate approval.

## Verification scope

The foundation's deterministic tests cover the ten required loop behaviors plus privacy projection, exact-version votes, queued input, cancellation, withdrawal, schema failures, budget accounting/resumption, stale findings, critical issues, snapshots, corruption, and Lab escaping. Existing extraction/form tests remain part of the same offline suite.

Production room routes, Socket.IO transport, live multi-device collaboration, external Reality Check tools, production retention/administration, and Visual Planner inference are not implemented by this foundation.
