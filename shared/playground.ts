import { z } from "zod";

export const PlaygroundAgents = [
  "listener",
  "judge",
  "negotiator",
  "speaker",
] as const;
export type PlaygroundAgent = (typeof PlaygroundAgents)[number];

export const playgroundScenarios = {
  listener: [
    {
      id: "listener-budget",
      title: "A budget worth hearing",
      text: "I’d love to join the beach trip, but I’m worried about spending more than ₱800 in total.",
      cue: "Can a concern become a useful constraint?",
    },
    {
      id: "listener-time",
      title: "An early way home",
      text: "I can come to the picnic on Sunday, but I need to be home by 3 PM. I don’t know how long the ride takes.",
      cue: "What’s known, and what still needs asking?",
    },
  ],
  judge: [
    {
      id: "judge-seats",
      title: "Six people. Four seats.",
      text: "Six attendees. One car with four seats in total. No other transport is confirmed.",
      cue: "Find the blocker before departure.",
    },
    {
      id: "judge-budget",
      title: "A plan over the limit",
      text: "The lunch costs ₱950 per person. Everyone’s confirmed limit is ₱800, including food.",
      cue: "A good idea still has to fit the budget.",
    },
  ],
  negotiator: [
    {
      id: "negotiator-sunday",
      title: "Find a little overlap",
      text: "Ana: Sunday, 8 AM–12 PM. Ben: Sunday, 10 AM–3 PM. Travel time is unknown.",
      cue: "Two schedules. Is there common ground?",
    },
    {
      id: "negotiator-saturday",
      title: "Make the afternoon work",
      text: "Ana: Saturday, 1–5 PM. Ben: Saturday, 3–7 PM. Travel time is unknown.",
      cue: "Suggest a window without assuming agreement.",
    },
  ],
  speaker: [
    {
      id: "speaker-transport",
      title: "Ask what matters next",
      text: "Sunday is tentative. Transportation is unconfirmed. The group hasn’t decided how to get there.",
      cue: "One useful question can move a plan forward.",
    },
    {
      id: "speaker-food",
      title: "The missing picnic piece",
      text: "The picnic is tentatively Sunday at noon. No one has confirmed who will bring food.",
      cue: "Turn a missing detail into a natural question.",
    },
  ],
} as const;

export const PlaygroundRequestSchema = z
  .object({
    agent: z.enum(PlaygroundAgents),
    scenarioId: z.string().min(1).max(40),
    sessionId: z.string().uuid(),
    text: z.string().trim().min(10).max(240).optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (
      !playgroundScenarios[request.agent].some(
        (scenario) => scenario.id === request.scenarioId,
      )
    )
      context.addIssue({
        code: "custom",
        message: "Choose a supported scenario.",
        path: ["scenarioId"],
      });
    if (request.text !== undefined && request.agent !== "listener")
      context.addIssue({
        code: "custom",
        message: "Only Listener accepts a personal thought.",
        path: ["text"],
      });
  });
export type PlaygroundRequest = z.infer<typeof PlaygroundRequestSchema>;

export const PlaygroundResultSchema = z
  .object({
    agent: z.enum(PlaygroundAgents),
    scenarioId: z.string(),
    source: z.enum(["live", "cached"]),
    model: z.literal("muse-spark-1.3"),
    generatedAt: z.iso.datetime(),
    roles: z
      .array(
        z.enum([
          "Listener",
          "Judge",
          "Negotiator",
          "Question Strategist",
          "Speaker",
        ]),
      )
      .min(1)
      .max(2),
    sections: z
      .array(
        z
          .object({ label: z.string().max(60), text: z.string().max(1600) })
          .strict(),
      )
      .min(1)
      .max(5),
    personal: z.boolean(),
  })
  .strict();
export type PlaygroundResult = z.infer<typeof PlaygroundResultSchema>;
