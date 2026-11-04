# Synthetic Scenario Demo Studio

The local Demo Studio creates, reviews, saves, and plays fictional group-planning scenarios. It does not replace the fixed Setvia Lab regression fixtures.

## Local setup

The Setvia API mounts the Muse generator route only when live rooms are enabled and `SETVIA_DEMO_API_TOKEN` is configured. Both endpoints require that bearer token, reject browser-origin requests, and use the active `RoomRuntime.getAuxiliaryInferenceHooks()` adapter:

```ts
app.use("/api/demo/scenarios", createScenarioGenerationRouter({
  hooks: roomRuntime.getAuxiliaryInferenceHooks(),
  env: process.env,
  internalToken: process.env.SETVIA_DEMO_API_TOKEN!,
}));
```

The server-to-server token belongs in the Setvia API environment and the private Studio service environment. Do not put it in Vite variables or browser storage. The shared hook reserves every request before fetch and journals `Scenario Generator` with its request hash and prompt version. The router is bounded to one HTTP attempt per generation. It has no independent budget counter.

Point the Studio's `SETVIA_PRIVATE_ROOT` at a private workspace outside the public repository. The room simulator can use the local API by default or an HTTPS Setvia API by setting `SETVIA_ROOM_API_ORIGIN`; remote HTTP and credential-bearing origins are rejected. For a hosted test, set the Studio process to `https://api.setvia.r4yv.tech` and set `VITE_SETVIA_API_ORIGIN` to the same HTTPS origin for its embedded dashboard. If the dashboard runs from local Vite, explicitly add that exact local origin to the API's `SETVIA_ROOM_ORIGINS` allowlist for the test.

Start the Stage B Setvia API, Studio API, and Vite app in three separate terminals. Configure the same randomly generated `SETVIA_DEMO_API_TOKEN` in the API and Studio process environments; keep it outside the repository:

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

Scenario versions and simulation snapshots live under the Studio's private `SETVIA_PRIVATE_ROOT/lab/synthetic-scenarios/`; room state and inference journals live under the API server's separate private root. Do not commit either tree. The existing integration budget remains authoritative for both scenario generation and room-agent requests. Request events label the generator separately; token and published-price estimates are displayed with provenance.

## Verification

`npm run check:server`, `npm run build`, and `npx tsx --test server/src/synthetic/synthetic.test.ts` cover the public code path without live Meta calls. The focused suite uses a mocked Meta HTTP response and makes zero live requests. The app-wide test suite also opens loopback servers and performs atomic file replacement; those tests may require a less restricted Windows runner than the current sandbox.
