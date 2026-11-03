# Synthetic Scenario Demo Studio

The local Demo Studio creates, reviews, saves, and plays fictional group-planning scenarios. It does not replace the fixed Setvia Lab regression fixtures.

## Local setup

The room API and dashboard must be integrated and running with the Stage B real-room work before live playback is available. The Muse generator router is deliberately exported but not mounted in this branch. Mount it on the Setvia API process at `POST /api/demo/scenarios` and `GET /api/demo/scenarios/health`, using the active `RoomRuntime.getAuxiliaryInferenceHooks()` adapter:

```ts
app.use("/api/demo/scenarios", createScenarioGenerationRouter({
  hooks: roomRuntime.getAuxiliaryInferenceHooks(),
  env: process.env,
}));
```

The shared hook reserves every request before fetch and journals `Scenario Generator` with its request hash and prompt version. The router is bounded to one HTTP attempt per generation. It has no independent budget counter.

Point `SETVIA_PRIVATE_ROOT` at a local private workspace outside the public repository. Start the Stage B Setvia API, Studio API, and Vite app in three separate terminals:

```powershell
npm run dev:server
```

```powershell
$env:SETVIA_PRIVATE_ROOT = 'C:\path\to\private\setvia-workspace'
npm run demo:studio
```

```powershell
npm run dev
```

Open `http://127.0.0.1:5173/demo-studio`. The Vite development proxy forwards `/api/demo-studio/*` to the loopback-only Studio API on port 4318. The route is enabled only in Vite development on a loopback hostname. Use the same host (`127.0.0.1` or `localhost`) for the whole browser session so the dashboard's tab-only session remains available to its embedded room route.

## Workflow and privacy

1. Choose event category, difficulty, expected attendees, active room planners, message count, timezone, and optional date.
2. Select **Generate with Muse Spark**. Generation is explicit; it never starts playback.
3. Review and edit the event, distinct fictional profiles, ordered participant messages, and group/private visibility. Advanced JSON editing exposes every scenario field. Ground-truth annotations stay in the Studio and are not sent to room agents.
4. Save a new version, then approve the specific version before live playback.
5. Choose recorded playback for a prior run's saved snapshots, or **Synthetic participants · Live Meta AI** for authenticated room actions.

The live simulator creates rooms and submits each fictional planner's actions through the existing validated room API. Event attendees who are not in `participants` never join or approve. Optional answers to model-generated questions wait for a matching room question. Playback waits for actual room-analysis status; inference timing is not fabricated.

At live room creation the API returns the creator's tab session to the Studio UI once. The UI stores it in the same tab's established `sessionStorage` keys and embeds `/rooms/:roomId`; no session token is placed in any URL or saved run. The embedded dashboard renders actual room state, while the Studio keeps playback controls visible.

Scenario versions, simulation snapshots, and private room outputs live under `SETVIA_PRIVATE_ROOT/lab/synthetic-scenarios/`. Do not commit those files. The existing integration budget remains authoritative for both scenario generation and room-agent requests. Request events label the generator separately; token and published-price estimates are displayed with provenance.

## Verification

`npm run check:server`, `npm run build`, and `npx tsx --test server/src/synthetic/synthetic.test.ts` cover the public code path without live Meta calls. The focused suite uses a mocked Meta HTTP response and makes zero live requests. The app-wide test suite also opens loopback servers and performs atomic file replacement; those tests may require a less restricted Windows runner than the current sandbox.
