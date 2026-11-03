# Bounded agent foundation

The server domain core is in server/src/agents. The existing text/image extraction API remains unchanged. The new negotiation core is not yet connected to browser room routes or Socket.IO.

## Offline development

    npm test
    npm run build
    npm run lab
    npm run lab:review -- <private-report.json>

`npm run lab` is mock-only: it never loads `.env` and disables fetch. It runs the five fixed synthetic scenarios and writes JSON plus a self-contained HTML report to the sibling `setvia-local/lab` directory. The 8-, 6-, 14-, 22-, and 58-person cases exercise different plan conflicts, private responses, safety gaps, and nonresponses. Open the printed HTML path to inspect the role path, structured handoffs, accepted/rejected options, findings, readiness, usage metadata, and reserved allowances. Listener input/output is redacted in saved records. Mock runs test orchestration, not model quality.

`npm run lab:review -- <private-report.json>` collects human ratings for the nine reasoning-quality dimensions and saves a new reviewed report under `setvia-local/lab/reviews`; it never overwrites the source. It accepts only authored synthetic scenario records and refuses unredacted Listener-only text.

Live evaluation is separate and is never run by `npm run lab`:

    npm run lab:live -- --scenario A,B --confirm-billable

Before any request, the live command prints selected participant counts, maximum attempts/tokens/cost, and assumptions. It requires `SETVIA_LAB_BILLING_CHECKED=1` and an exact interactive approval phrase. The environment flag is an attestation only; the application cannot inspect account billing or credits. Inputs are fixed synthetic fixtures; arbitrary production input is not accepted. Each selected scenario is capped at ten attempts and $0.82 reserved cost; all five together are capped at fifty attempts and $4.10. Retries are disabled. Per-call request bytes are capped at 50,000, and local fixture measurement found a maximum 46,454-byte request envelope for the 58-person Judge input. A saved private checkpoint is written after each scenario. Live reasoning and model/schema compatibility still require human review and have not been verified by this implementation.

## Roles and control

Listener interprets new private input into private unconfirmed candidates. Only an authenticated participant action can confirm or share a fact. Judge audits findings and options. Negotiator proposes and revises options. Question Strategist creates targeted questions. Speaker selects validated question/finding references and a bounded mascot state; the backend renders their authorized text. VisualPlanner is an extension interface with no image generation implementation.

The scheduler follows typed Judge tasks and may skip roles. It supports repeated Judge/Negotiator revisions. It detects canonical repetition, checks state revisions, and enforces invocation, attempt, revision, time, token-reservation and cost-reservation limits. Successful cycles end with a Judge evaluation; where no further artifact is needed, the last Judge assessment is final without a redundant call. Speaker drafts require a subsequent final Judge acceptance before publication.

Outcomes are CONTINUE, WAIT_FOR_PARTICIPANT, COMPLETED, and BLOCKED. Waiting/completed cycles do not poll. New input resumes a new revision. Failed, cancelled, stale or interrupted work cannot fabricate a final evaluation. A controlled retry retains lifetime reservations.

## Privacy and authorization

RoomService authenticates high-entropy participant credentials using server-side hashes. Shared role input is projected from group-authorized facts only. Private Listener candidates cannot automatically become shared constraints. Public targeting requires the target's explicit consent. Each participant can change only their own facts and constraints. Participant views filter private facts, candidates, questions, and messages; withdrawal revokes access.

Cycle objects, traces, and snapshots are trusted server-internal objects. They must never be serialized as participant API responses. Use RoomService.view for an authenticated participant projection. The Lab exporter writes only to private storage outside the repository and permits live records only when they are explicitly marked synthetic simulations; traces must never be exposed through a public endpoint. No new public or unauthenticated Lab route was added.

Proposal, policy, requirement and membership changes invalidate relevant approvals. Human votes bind the exact proposal version; answers and AI completion do not vote. Every currently required real participant must approve. Future organizer-only administration requires its own authorization policy.

## Reality Checks and readiness

These exact six names are preserved:

- **Schedule Check:** Detects conflicting availability, impossible timing, overlapping schedules, unrealistic durations, and missing deadlines.
- **Budget Check:** Evaluates per-person spending limits, total estimated costs, budget conflicts, unclear expenses, and whether proposed plans fit confirmed financial constraints.
- **People Check:** Identifies missing participant responses or confirmations, accessibility needs, unassigned responsibilities, attendance conflicts, and unclear roles.
- **Logistics Check:** Evaluates transportation, locations, routes, travel arrangements, venue details, and other practical coordination requirements.
- **Preparation Check:** Identifies missing equipment, materials, supplies, things to bring, and incomplete preparation responsibilities. Adapt this category to the event type, such as hiking equipment for outdoor trips or presentation materials for meetings.
- **Safety Check:** Identifies potential hazards, missing safety precautions, emergency preparedness gaps, and unresolved safety-related requirements. For outdoor activities, consider route conditions, suitable equipment, weather-related risks, emergency communications, and relevant local guidance. Never claim an activity is safe based solely on AI evaluation.

Each room supplies an event-adaptive six-category policy with applicability, weights, and required information keys. Only an authenticated human action can change policy; the model cannot shrink the denominator. Initial policy selection is required, rather than inferred as a completed checklist.

Readiness-v1 uses weighted category completeness. Only confirmed, group-authorized facts count toward required information. Facts are owner-aware: different participant-scoped budgets, schedules, or preferences do not conflict merely because their values differ. Explicitly shared claims about the same required fact can conflict, and contradictory claims by one owner can still require verification. Each participant's hard constraints are evaluated against the proposed group plan, so individually valid personal constraints can still make the combined plan infeasible. `requiredPerParticipantKeys` checks coverage per person using group-visible facts. Private Listener responses never raise or lower the group-wide score, and private values are not included in group explanations. Generic deterministic predicates support required values, equality/inequality, and numeric upper/lower limits. Hard-constraint violations and critical unresolved findings block readiness. Unknown categories score zero. Unresolved findings cap a category; critical issues block ready status even in a category marked not applicable. Omitted unresolved findings carry forward, and a claimed resolution needs valid confirmed category evidence. The final label is ready_for_human_review, never a safety assurance or group approval.

Real-world prices, routes, weather, venue access, dates and hazards are not externally verified by this foundation. More complex domain-specific predicates or external evidence tools remain future work. Model findings carry evidence references, severity, status, uncertainty, and a recommended action.

## Persistence and Meta boundary

RoomStore provides one serialized writer per room. JsonPersistence requires an absolute private storage root outside the public repository. It validates snapshots, flushes temporary files, and atomically renames them. Corrupt files are quarantined and fail closed rather than silently rolling back approvals or spending. Restart recovery marks interrupted work BLOCKED and retains known readiness/reservations.

This is a single-process design. Filesystem durability, directory permissions/Windows ACLs, backup protection, retention, and deletion need deployment-specific validation. Ephemeral hosting storage is not durable room storage.

The Meta gateway reuses the existing pinned official Responses client and muse-spark-1.3 Standard model. Prompts are supplied from the private workspace, with hashes in traces. Automatic retries are disabled for agent calls. The existing client now offers an awaited hook immediately before each HTTP attempt, including retries, so reservations can be persisted before a request starts.

Live gateways require explicit limits, private prompts, request/output bounds, and dated pricing/allowances. Per-cycle, per-room, and selected-suite ceilings are enforced outside model output. Unknown usage stays unknown, while conservative reservations remain consumed. Allowances are estimates, not invoices; the new role schemas/prompt behavior have not been live-verified. The separately gated command requires fresh explicit approval before any billable request. No live inference was made during this implementation.

## Verification scope

The deterministic tests cover conditional role paths, bounded revision and request loops, owner-aware personal versus shared facts, incompatible per-person constraints, private Listener isolation/redaction, exact-version votes, queued input, cancellation, withdrawal, schema failures, budget accounting/resumption, stale findings, critical issues, snapshots, corruption, and Lab escaping. The five scenario mocks include the 58-person no-truncation and call-efficiency checks. Existing extraction/form tests remain part of the same offline suite. A passing scripted mock does not establish real-model reasoning quality; use the manual rubric and only separately approved live evaluation for that.

Production room routes, Socket.IO transport, live multi-device collaboration, external Reality Check tools, production retention/administration, and Visual Planner inference are not implemented by this foundation.
