import { Router } from "express";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { RecordedDemoSchema, RecordingIdSchema } from "../../../shared/recorded-demo.js";

/** Read-only, schema-validated fictional projections; never reads live room storage. */
export function createRecordedDemoRouter(directory: string) {
  const router = Router();
  const root = resolve(directory);
  router.get("/:recordingId", async (request, response) => {
    const parsed = RecordingIdSchema.safeParse(request.params.recordingId);
    if (!parsed.success) return response.status(400).json({ error: "Invalid recording identifier." });
    try {
      const path = resolve(root, parsed.data + ".json");
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 * 1024)
        throw new Error("Invalid recording file");
      const recording = RecordedDemoSchema.parse(JSON.parse(await readFile(path, "utf8")));
      if (recording.recordingId !== parsed.data) throw new Error("Recording identity mismatch");
      response.setHeader("Cache-Control", "no-store");
      return response.json(recording);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return response.status(404).json({ error: "This scripted recording is unavailable." });
      return response.status(503).json({ error: "This scripted recording could not be loaded." });
    }
  });
  return router;
}
