import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  createPreviewFixture,
  PreviewFrames,
  PreviewScenarios,
  PreviewViewers,
} from "../server/src/dashboard/fixtures.js";
import { DashboardSnapshotSchema } from "../shared/dashboard.js";

const outputRoot = resolve(process.cwd(), "public", "dashboard-preview");
for (const scenario of PreviewScenarios) {
  const fixture = await createPreviewFixture(scenario);
  const scenarioDirectory = join(outputRoot, scenario);
  await mkdir(scenarioDirectory, { recursive: true });
  for (const viewer of PreviewViewers) {
    const authorizedViews: Record<string, unknown> = {};
    for (const frame of PreviewFrames) {
      const snapshot = fixture[frame][viewer];
      if (!snapshot)
        throw new Error("Missing synthetic view: " + scenario + "/" + viewer + "/" + frame);
      authorizedViews[frame] = DashboardSnapshotSchema.parse(snapshot);
    }
    await writeFile(
      join(scenarioDirectory, viewer + ".json"),
      JSON.stringify(authorizedViews, null, 2) + "\n",
      "utf8",
    );
  }
}
// Remove the old aggregate files, which bundled every participant projection
// together. Only delete known generated files directly under this directory.
const legacyFixtureNames = new Set(PreviewScenarios.map((scenario) => scenario + ".json"));
for (const entry of await readdir(outputRoot, { withFileTypes: true }))
  if (entry.isFile() && legacyFixtureNames.has(entry.name))
    await unlink(join(outputRoot, entry.name));
console.log("Wrote schema-validated, viewer-scoped offline preview fixtures.");
