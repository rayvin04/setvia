import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import {
  createPreviewFixture,
  PreviewFrames,
  PreviewScenarios,
  PreviewViewers,
  type PreviewFixture,
  type PreviewScenario,
  type PreviewFrame,
  type PreviewViewer,
} from "./fixtures.js";

export function dashboardPreviewPlugin(): Plugin {
  const fixtures = new Map<PreviewScenario, Promise<PreviewFixture>>();
  const middleware = async (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (!url.pathname.startsWith("/api/dashboard-preview/")) return next();
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    const parts = url.pathname.split("/");
    const scenario = parts[3] as PreviewScenario;
    const viewer = parts[4] as PreviewViewer;
    const frame = (url.searchParams.get("frame") ?? "initial") as PreviewFrame;
    if (
      request.method !== "GET" ||
      parts.length !== 5 ||
      !PreviewScenarios.includes(scenario) ||
      !PreviewViewers.includes(viewer) ||
      !PreviewFrames.includes(frame)
    ) {
      response.statusCode = 400;
      response.end(
        JSON.stringify({
          error: "Choose a supported synthetic scenario and viewer.",
        }),
      );
      return;
    }
    try {
      if (!fixtures.has(scenario))
        fixtures.set(scenario, createPreviewFixture(scenario));
      const snapshot = (await fixtures.get(scenario)!)[frame][viewer];
      response.end(JSON.stringify(snapshot));
    } catch {
      fixtures.delete(scenario);
      response.statusCode = 503;
      response.end(
        JSON.stringify({
          error: "The synthetic preview could not load. Try again.",
        }),
      );
    }
  };
  return {
    name: "setvia-synthetic-dashboard",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
