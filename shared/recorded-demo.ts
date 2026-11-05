import { z } from "zod";
import { DashboardSnapshotSchema } from "./dashboard.js";

export const RecordingIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/);
export const RecordedDemoSchema = z.object({
  formatVersion: z.literal("setvia-recorded-demo-v1"),
  recordingId: RecordingIdSchema,
  title: z.string().min(1).max(120),
  fictional: z.literal(true),
  inference: z.literal("mock"),
  createdAt: z.iso.datetime(),
  frames: z.array(z.object({
    label: z.string().min(1).max(60),
    snapshot: DashboardSnapshotSchema,
  }).strict()).min(1).max(5),
}).strict().superRefine((recording, context) => {
  for (const [index, { snapshot }] of recording.frames.entries()) {
    if (snapshot.source !== "synthetic" ||
        snapshot.contributions.some((entry) => entry.visibility !== "group" || entry.targetId !== null) ||
        snapshot.room.candidates.some((entry) => entry.visibility !== "group") ||
        snapshot.room.questions.some((entry) => entry.visibility !== "group" || entry.targetId !== null) ||
        snapshot.room.messages.some((entry) => entry.visibility !== "group" || entry.targetId !== null)) {
      context.addIssue({ code: "custom", path: ["frames", index],
        message: "Public recordings accept only fictional, shared, synthetic projections." });
    }
  }
});
export type RecordedDemo = z.infer<typeof RecordedDemoSchema>;
