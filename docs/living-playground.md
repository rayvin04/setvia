# Meet the minds: Setvia’s Meta AI playground

The homepage’s **Meet the minds** section shows four focused examples of how Setvia’s planning roles work. Each card cycles through three fictional scenarios and attempts a fresh model request after someone clicks Run, even when a previous answer has been saved. During the request, that card shows the input and a thinking state; when it completes, the same card shows a compact model response in orange. Results identify whether they came from a live response or a saved fallback. The other cards stay in their preview state. All four mascots sit above their cards and sway at different timings; the loops pause outside the viewport, in a hidden tab, and for reduced motion.

## The four cards

| Card           | Model role(s)                 | What it demonstrates                                                                                                                                                                            |
| -------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Listener**   | Listener                      | Turns one participant’s thought into candidate constraints and uncertainty. A private thought is returned only to that browser request; it is not saved or automatically shared with the group. |
| **Judge**      | Judge                         | Identifies a planning blocker and explains which supplied facts support it and what still needs confirmation.                                                                                   |
| **Negotiator** | Negotiator                    | Suggests a bounded schedule overlap. The server checks the proposed interval against the scenario’s availability; it remains a suggestion until people agree.                                   |
| **Speaker**    | Question Strategist → Speaker | Drafts a finding-linked question, then presents it in Setvia’s voice using validated question and finding references.                                                                           |

These cards are separate demonstrations, not a complete collaborative planning session. They do not create a room or collect participant approvals. The named roles are application tasks, not separate Meta models: each calls the same pinned **Muse Spark 1.3** model through the server-side Meta Responses API.

## Validation and privacy

- Homepage cards use predefined scenarios only. The API also accepts an optional 10–240 character free-text input for Listener, limited to group-planning topics; it is private to that request.
- The API validates request and response schemas. The server applies scope checks, evidence and feasibility checks where relevant, per-minute abuse throttles, and a small concurrency limit. It records every live request and reported usage; historical usage estimates do not act as a lifetime cap.
- Model output is a proposal. It cannot confirm a participant’s facts, override a hard constraint, or approve a plan for someone.
- Successful preset results are saved for up to seven days. A saved answer is returned only if fresh inference fails or is unavailable, with its original generation timestamp and a sanitized `fallbackCode`. A later click tries live inference again. Simultaneous requests for the same preset share one in-progress execution. Personal Listener text and its response are never saved or replaced by a public preset fallback.
- Meta credentials and role prompts stay on the server. No request is made on page load or when changing scenarios.

The mascot characters represent application roles; they are not additional models. Setvia’s public playground does not use SAM 3.1, Muse Spark Open, Muse Glimmer, or Muse Voice.

## Matching frontend and backend releases

Deploy the frontend and API from the same reviewed revision. A newer browser can otherwise display a preset that an older API does not recognize, such as `listener-school-day`; that is a scenario mismatch rather than a personal-text length error. Request validation reports separate `scenario_unavailable`, `invalid_text`, and `invalid_session` codes.

`GET /api/playground/status` reports contract version `2`, supported scenario IDs, the pinned model, whether the playground is configured, and whether inference is enabled. This read-only endpoint makes no model calls and exposes no credentials, prompts, or participant data. A healthy status confirms configuration only; a successful live response is still required to verify Meta connectivity.

## Local setup and checks

The playground endpoint is opt-in on the API server. Enable it with `SETVIA_PLAYGROUND_ENABLED=1` after configuring the live room runtime, private prompts, server-side `MODEL_API_KEY`, and the API origin allowlist. Provider billing and usage are controlled through the Meta account and recorded in the private request journal; the application does not impose an hourly inference-spend quota. Do not put the Meta key in a `VITE_` variable.

Run the isolated, mock-only playground suite with:

```bash
npm run test:playground
```

The mock suite verifies request boundaries, role handoffs, validation, caching, per-minute abuse throttles, and error handling; it makes no live Meta requests.
