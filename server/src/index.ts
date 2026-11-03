import { resolve } from "node:path";
import { createApp } from "./http/app.js";
import { createMetaClient, readMetaConfig } from "./ai/meta-client.js";
import { createLocalRoomRuntime } from "./rooms/runtime.js";

const port = Number(process.env.PORT ?? "3001");
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

const client = createMetaClient({
  config: readMetaConfig(),
  maxRetries: 1,
});
const appRoot = resolve(process.cwd());
const enabled = process.env.SETVIA_LIVE_ENABLED === "1";
const liveEnabled = enabled;
if (liveEnabled && process.env.SETVIA_LIVE_BILLING_CHECKED !== "1") {
  throw new Error("Set SETVIA_LIVE_BILLING_CHECKED=1 only after reviewing the Meta billing limits.");
}
if (process.env.SETVIA_SYNTHETIC_DEMO === "1" && !liveEnabled) {
  throw new Error("Synthetic live room mode requires SETVIA_LIVE_ENABLED=1.");
}

const roomOrigins = (process.env.SETVIA_ROOM_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const privateRoot = resolve(
  process.env.SETVIA_PRIVATE_ROOT ?? resolve(appRoot, "..", "setvia-local"),
);
const runtime = liveEnabled
  ? await createLocalRoomRuntime({
      privateRoot,
      publicRoot: appRoot,
      promptVersion: process.env.SETVIA_PROMPT_VERSION ?? "agents-v7",
      syntheticDemo: process.env.SETVIA_SYNTHETIC_DEMO === "1",
    })
  : undefined;
const app = createApp({
  client,
  rooms: runtime,
  roomOrigins: roomOrigins.length ? roomOrigins : undefined,
});
const server = app.listen(port, "127.0.0.1");
await new Promise<void>((resolveReady, reject) => {
  server.once("listening", resolveReady);
  server.once("error", reject);
});
console.log(
  `Setvia API listening at http://127.0.0.1:${port}${runtime ? " (local live rooms enabled)" : ""}`,
);
let closing = false;
const close = () => {
  if (closing) return;
  closing = true;
  const closedRuntime = runtime?.close();
  server.close();
  void closedRuntime?.catch(() => { process.exitCode = 1; });
};
process.once("SIGINT", close);
process.once("SIGTERM", close);
