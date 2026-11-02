import { createApp } from "./http/app.js";
import { createMetaClient, readMetaConfig } from "./ai/meta-client.js";

const port = Number(process.env.PORT ?? "3001");
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

const client = createMetaClient({
  config: readMetaConfig(),
  maxRetries: 1,
});
const app = createApp({ client });

app.listen(port, "127.0.0.1", () => {
  console.log("Setvia API listening at http://127.0.0.1:" + port);
});