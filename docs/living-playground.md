# Meet the minds: Setvia’s Meta AI playground

The homepage’s **Meet the minds** section shows four focused examples of how Setvia’s planning roles work. Each card starts a bounded request only after someone selects a scenario and clicks its action. Results show whether they came from a live response or the scenario cache.

## The four cards

| Card | Model role(s) | What it demonstrates |
| --- | --- | --- |
| **Listener** | Listener | Turns one participant’s thought into candidate constraints and uncertainty. A private thought is returned only to that browser request; it is not saved or automatically shared with the group. |
| **Judge** | Judge | Identifies a planning blocker and explains which supplied facts support it and what still needs confirmation. |
| **Negotiator** | Negotiator | Suggests a bounded schedule overlap. The server checks the proposed interval against the scenario’s availability; it remains a suggestion until people agree. |
| **Speaker** | Question Strategist → Speaker | Drafts a finding-linked question, then presents it in Setvia’s voice using validated question and finding references. |

These cards are separate demonstrations, not a complete collaborative planning session. They do not create a room or collect participant approvals. The named roles are application tasks, not separate Meta models: each calls the same pinned **Muse Spark 1.3** model through the server-side Meta Responses API.

## Validation and privacy

- Requests can select only a supported role and predefined scenario. The optional 10–240 character free-text input is accepted only by Listener and is limited to group-planning topics.
- The API validates request and response schemas. The server applies scope checks, evidence and feasibility checks where relevant, request limits, concurrency limits, and a separate bounded inference allowance.
- Model output is a proposal. It cannot confirm a participant’s facts, override a hard constraint, or approve a plan for someone.
- Preset results may be cached. Personal Listener text and its response are not written to that cache.
- Meta credentials and role prompts stay on the server. No request is made on page load or when changing scenarios.

The mascot characters represent application roles; they are not additional models. Setvia’s public playground does not use SAM 3.1, Muse Spark Open, Muse Glimmer, or Muse Voice.

## Local setup and checks

The playground endpoint is opt-in on the API server. Enable it with `SETVIA_PLAYGROUND_ENABLED=1` after configuring the live room runtime, private prompts, server-side `MODEL_API_KEY`, and the API origin allowlist. `SETVIA_PLAYGROUND_BUDGET_MICROS` sets a separate bounded allowance and defaults to `2000000` micro-dollars ($2). Do not put the Meta key in a `VITE_` variable.

Run the isolated, mock-only playground suite with:

```bash
npm run test:playground
```

The mock suite verifies request boundaries, role handoffs, validation, caching, limits, and error handling; it makes no live Meta requests.
