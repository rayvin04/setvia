import {
  Categories,
  type Auth,
  type Finding,
  type PlanOption,
  type Question,
} from "../agents/contracts.js";
import { AgentEngine } from "../agents/engine.js";
import { RoomStore, MemoryPersistence } from "../agents/store.js";
import { RoomService } from "../agents/rooms.js";
import { judge, scriptedGateway, type Step } from "../agents/fixtures.js";
import {
  DashboardSnapshotSchema,
  type DashboardActivity,
  type DashboardSnapshot,
} from "../../../shared/dashboard.js";
import { projectDashboardRoom } from "./projection.js";

export const PreviewScenarios = [
  "hike",
  "beach",
  "family",
  "kickoff",
  "safety",
  "blocked",
  "empty",
] as const;
export type PreviewScenario = (typeof PreviewScenarios)[number];
export const PreviewViewers = ["alex", "sam", "jo", "mika"] as const;
export type PreviewViewer = (typeof PreviewViewers)[number];
export const PreviewFrames = [
  "initial",
  "updated",
  "revised",
  "carpool",
] as const;
export type PreviewFrame = (typeof PreviewFrames)[number];
export type PreviewFixture = Record<
  PreviewFrame,
  Partial<Record<PreviewViewer, DashboardSnapshot>>
>;

const requiredKeys = [
  ["date", "availability"],
  ["budget", "meal_cost"],
  ["attendance", "access"],
  ["venue", "transport"],
  ["equipment", "owners"],
  ["emergency", "guidance"],
];
const titles: Record<PreviewScenario, string> = {
  hike: "Weekend Mountain Hike",
  beach: "A little sun. All our people.",
  family: "The Sunday family reunion",
  kickoff: "A good start, together.",
  safety: "The outdoor fieldwork plan",
  blocked: "A little sun. All our people.",
  empty: "Something worth getting together for.",
};
const planValues: Record<PreviewScenario, PlanOption["values"]> = {
  hike: {
    date: "Saturday, 21 November",
    time: "8:00 AM – 4:00 PM",
    location: "Mt. Aya trailhead · fictional venue",
    cost: 2500,
    currency: "PHP",
    transport: "Shared car · pickup to confirm",
    preparation: "Day packs, water & trail essentials",
  },
  beach: {
    date: "Saturday, 14 November",
    time: "7:00 AM – 6:00 PM",
    location: "Laiya, Batangas · venue to confirm",
    cost: 1800,
    currency: "PHP",
    transport: "Shared van · quote pending",
    preparation: "Picnic kit & beach essentials",
  },
  family: {
    date: "Sunday, 22 November",
    time: "11:00 AM – 4:00 PM",
    location: "Family venue · access to confirm",
    cost: 750,
    currency: "PHP",
    transport: "Family carpools",
    preparation: "Potluck dishes & family photos",
  },
  kickoff: {
    date: "Monday, 16 November",
    time: "10:00 AM – 11:00 AM",
    location: "Online · meeting link to confirm",
    agenda: "Scope, priorities, owners & next steps",
    preparation: "Read the brief before the meeting",
  },
  safety: {
    date: "Saturday, 21 November",
    time: "8:00 AM – 2:00 PM",
    location: "Fieldwork site · final access to confirm",
    cost: 400,
    currency: "PHP",
    transport: "Campus shuttle",
    preparation: "Field notes, equipment & protective gear",
  },
  blocked: {
    date: "Saturday, 14 November",
    time: "7:00 AM – 6:00 PM",
    location: "Laiya, Batangas · venue to confirm",
    cost: 1800,
    currency: "PHP",
    transport: "Shared van · quote pending",
    preparation: "Picnic kit & beach essentials",
  },
  empty: {},
};

function openFinding(
  id: string,
  category: Finding["category"],
  message: string,
  recommendedAction: string,
  severity: Finding["severity"] = "warning",
): Finding {
  return {
    id,
    category,
    message,
    recommendedAction,
    severity,
    status: "open",
    uncertainty: "missing",
    evidenceIds: [],
  };
}
function scenarioFindings(
  scenario: PreviewScenario,
  improved = false,
): Finding[] {
  if (scenario === "family")
    return [
      openFinding(
        "venue_access",
        "People Check",
        "Venue access requirements still need confirmation for the reunion.",
        "Confirm a step-free entrance and accessible restroom with the venue.",
      ),
    ];
  if (scenario === "safety")
    return [
      openFinding(
        "emergency_plan",
        "Safety Check",
        "Emergency communications are unconfirmed for the fieldwork site.",
        "Ask the fieldwork lead to verify emergency contacts, communications and relevant local guidance before proceeding.",
        "critical",
      ),
    ];
  if (scenario === "kickoff" || scenario === "empty") return [];
  const preparation = openFinding(
    "picnic_kit",
    "Preparation Check",
    scenario === "hike"
      ? "Shared hiking gear still needs an owner."
      : "The picnic kit still needs an owner.",
    scenario === "hike"
      ? "Choose who will bring the shared hiking equipment."
      : "Choose who will bring the shared picnic kit.",
    "info",
  );
  return improved
    ? [
        {
          ...openFinding(
            "meal_costs",
            "Budget Check",
            "Shared meals fit the confirmed group budget.",
            "Review the current proposal.",
          ),
          status: "resolved",
          uncertainty: "none",
          evidenceIds: ["shared_meal_cost"],
        },
        {
          ...openFinding(
            "van_quote",
            "Logistics Check",
            "The shared transport quote and pickup point are confirmed.",
            "Review the pickup time.",
          ),
          status: "resolved",
          uncertainty: "none",
          evidenceIds: ["shared_transport"],
        },
        preparation,
      ]
    : [
        openFinding(
          "meal_costs",
          "Budget Check",
          "Shared meal costs still need confirmation.",
          scenario === "hike"
            ? "Confirm meals fit the group’s ₱3,000 per-person ceiling."
            : "Confirm meals fit the group’s ₱2,000 per-person ceiling.",
        ),
        openFinding(
          "van_quote",
          "Logistics Check",
          scenario === "hike"
            ? "The shared ride pickup point needs confirmation."
            : "The shared van quote is still outstanding.",
          "Confirm the transport arrangements and pickup point.",
        ),
        preparation,
      ];
}

export async function createPreviewFixture(
  scenario: PreviewScenario,
): Promise<PreviewFixture> {
  const store = new RoomStore(new MemoryPersistence());
  const rooms = new RoomService(store);
  const created = await rooms.create(
    scenario === "hike"
      ? "Mountain hike"
      : scenario === "family"
        ? "Family reunion"
        : scenario === "kickoff"
          ? "Project kickoff"
          : scenario === "safety"
            ? "Outdoor group project"
            : "Beach trip",
    Categories.map((category, index) => ({
      category,
      enabled: true,
      weight: 1,
      requiredKeys: requiredKeys[index],
      requiredPerParticipantKeys: [],
    })),
    {
      id: "group_plan",
      label: titles[scenario],
      values: planValues[scenario],
    },
  );
  const auths = new Map<PreviewViewer, Auth>();
  const names = ["Alex", "Sam", "Jo", "Mika"];
  for (const [index, viewer] of PreviewViewers.entries())
    auths.set(
      viewer,
      await rooms.join(created.roomId, created.invitation, names[index]),
    );
  const alex = auths.get("alex")!;
  const read = () => store.read(created.roomId);
  const readRevision = async () => (await rooms.view(created.roomId, alex)).revision;
  const confirm = async (key: string) => {
    await rooms.confirmFact(created.roomId, alex, await readRevision(), {
      id: "shared_" + key,
      key,
      value: true,
      confirmed: true,
      visibility: "group",
      scope: "shared",
      ownerId: alex.participantId,
    });
  };
  const missing = new Set(
    scenario === "empty"
      ? requiredKeys.flat()
      : scenario === "family"
        ? ["access"]
        : ["transport", "equipment", "owners"],
  );
  if (scenario === "kickoff" || scenario === "safety") missing.clear();
  for (const key of requiredKeys.flat())
    if (!missing.has(key)) await confirm(key);
  if (scenario === "family") {
    await rooms.confirmFact(created.roomId, alex, await readRevision(), {
      id: "private_access",
      key: "access_preference",
      value: "PRIVATE_CANARY_ALEX: synthetic access preference",
      ownerId: alex.participantId,
      visibility: "private",
      scope: "participant",
      confirmed: true,
    });
  }
  const constraints =
    scenario === "hike" || scenario === "beach" || scenario === "blocked"
      ? [
          {
            id: "group_budget",
            ownerId: alex.participantId,
            category: "Budget Check" as const,
            key: "cost",
            operator: "lte" as const,
            expected: scenario === "hike" ? 3000 : 2000,
            hard: true,
          },
        ]
      : [];
  if (constraints.length)
    await rooms.setConstraints(
      created.roomId,
      alex,
      await readRevision(),
      constraints,
    );

  type PrivateEvent = { event: DashboardActivity; targetId: string | null };
  const events: PrivateEvent[] = [];
  const history: DashboardSnapshot["history"] = [];
  let tick = 0;
  const record = async (
    kind: DashboardActivity["kind"],
    summary: string,
    actorId: string | null = null,
    category: DashboardActivity["category"] = null,
    targetId: string | null = null,
  ) => {
    const room = await read();
    events.push({
      targetId,
      event: {
        id: "activity_" + ++tick,
        kind,
        summary,
        actorId,
        category,
        revision: room.revision,
        proposalVersion: room.proposalVersion,
        occurredAt: new Date(
          Date.UTC(2026, 10, 3, 3, 30, tick * 20),
        ).toISOString(),
      },
    });
  };
  for (const [viewer, auth] of auths)
    await record(
      "participant_joined",
      `${names[PreviewViewers.indexOf(viewer)]} joined the plan.`,
      auth.participantId,
    );
  const responded = new Set<string>();
  if (scenario !== "empty")
    for (const viewer of ["alex", "sam", "jo"] as const) {
      const auth = auths.get(viewer)!;
      await rooms.submit(
        created.roomId,
        auth,
        (await rooms.view(created.roomId, auth)).revision,
        "Synthetic planning response. This fixture contains no participant-authored content.",
      );
      responded.add(auth.participantId);
      await record(
        "participant_responded",
        `${names[PreviewViewers.indexOf(viewer)]} responded to this proposal.`,
        auth.participantId,
      );
    }
  const options: PlanOption[] =
    scenario === "hike" || scenario === "beach" || scenario === "blocked"
      ? [
          {
            id: "shared_van",
            label:
              scenario === "hike"
                ? "A later start, the same adventure"
                : "An earlier start, a shared ride",
            values: {
              ...planValues[scenario],
              cost: scenario === "hike" ? 2400 : 1700,
              time:
                scenario === "hike" ? "8:30 AM – 4:30 PM" : "6:30 AM – 6:00 PM",
              transport: "Shared ride · group pickup",
            },
          },
          {
            id: "carpool",
            label: "Same day, a simpler carpool",
            values: {
              ...planValues[scenario],
              cost: scenario === "hike" ? 2250 : 1550,
              transport: "Two carpools · drivers to confirm",
            },
          },
        ]
      : [];
  const makeQuestion = (improved = false): Question | null => {
    if (
      scenario === "empty" ||
      scenario === "blocked" ||
      scenario === "kickoff"
    )
      return null;
    const isFamily = scenario === "family";
    return {
      id: improved ? "kit_owner" : "current_question",
      findingId:
        scenario === "safety"
          ? "emergency_plan"
          : isFamily
            ? "venue_access"
            : improved
              ? "picnic_kit"
              : "meal_costs",
      targetId: isFamily ? alex.participantId : null,
      visibility: isFamily ? "private" : "group",
      kind: isFamily ? "clarification" : "choice",
      text: isFamily
        ? "Alex, what access requirements would you like the reunion venue to meet?"
        : scenario === "safety"
          ? "Who can verify emergency communications before the fieldwork?"
          : improved
            ? scenario === "hike"
              ? "Who can take care of the shared hiking gear?"
              : "Who can take care of the shared picnic kit?"
            : scenario === "hike"
              ? "Would an 8:30 AM departure and a ₱2,400 budget work for you?"
              : "Would a ₱1,800 per-person plan work for you, including shared meals?",
      options: isFamily
        ? []
        : scenario === "safety"
          ? ["I can verify the plan", "Suggest another time", "Review details"]
          : improved
            ? ["I can bring the kit", "Ask the group"]
            : scenario === "hike"
              ? ["Yes", "No", "Another time"]
              : ["Yes, that works", "Suggest another budget", "Review details"],
    };
  };
  const evaluate = async (improved = false, fail = false, carpool = false) => {
    const findings = scenarioFindings(scenario, improved);
    if (carpool)
      findings.push(
        openFinding(
          "carpool_drivers",
          "Logistics Check",
          "The carpool alternative needs confirmed drivers.",
          "Ask the group to confirm two drivers and their pickup points.",
        ),
      );
    const question = makeQuestion(improved);
    const evaluation = judge({
      findings,
      next: question ? "question" : "stop",
      participantInputRequired: Boolean(question),
    });
    const steps: Step[] = (await read()).pendingInputs.map(() => ({
      role: "Listener" as const,
      output: { candidates: [] },
    }));
    if (fail)
      steps.push({
        role: "Judge",
        error: new Error("Synthetic unavailable analysis"),
      });
    else {
      if (options.length && !improved) {
        steps.push(
          {
            role: "Judge",
            output: {
              ...evaluation,
              next: "negotiate",
              taskFindingIds: ["meal_costs"],
              anotherPassUseful: true,
              canStop: false,
            },
          },
          { role: "Negotiator", output: { options } },
        );
        evaluation.verdicts = options.map((option) => ({
          optionId: option.id,
          accepted: true,
        }));
      }
      steps.push({ role: "Judge", output: evaluation });
      if (question)
        steps.push(
          { role: "Question Strategist", output: { questions: [question] } },
          {
            role: "Speaker",
            output: {
              replies: [
                { questionId: question.id, findingId: null, text: question.text },
                ...findings.slice(0, 1).map((finding) => ({
                  questionId: null,
                  findingId: finding.id,
                  text: finding.message,
                })),
              ],
              mascot: scenario === "safety" ? "concerned" : "curious",
            },
          },
          {
            role: "Judge",
            output: { ...evaluation, acceptedQuestionIds: [question.id] },
          },
        );
    }
    const engine = new AgentEngine(store, scriptedGateway(steps).gateway);
    const cycle = await engine.run(created.roomId, alex);
    if (cycle.outcome === "BLOCKED" && !fail)
      throw new Error("Unexpected preview fixture failure: " + cycle.reason);
    return cycle;
  };
  const addHistory = async (explanation: string) => {
    const room = await read();
    if (!room.readiness) return;
    history.push({
      id: "evaluation_" + history.length,
      revision: room.revision,
      proposalVersion: room.proposalVersion,
      occurredAt: new Date(
        Date.UTC(2026, 10, 3, 3, 31 + history.length * 5),
      ).toISOString(),
      readiness: room.readiness,
      explanation,
    });
    await record(
      "readiness_changed",
      "Readiness evaluated at " +
        room.readiness.percentage +
        "%" +
        (room.readiness.status === "blocked"
          ? " · blocked by a critical requirement."
          : ". Review the progress history for details."),
    );
  };
  const capture = async (sequence: number) => {
    const result: Partial<Record<PreviewViewer, DashboardSnapshot>> = {};
    for (const [viewer, auth] of auths) {
      const room = projectDashboardRoom(await rooms.view(created.roomId, auth));
      result[viewer] = DashboardSnapshotSchema.parse({
        schemaVersion: "dashboard-v1",
        source: "synthetic",
        sequence,
        room,
        responseTracking: "synthetic",
        responses: room.participants.map((p) => ({
          participantId: p.id,
          proposalVersion: room.proposalVersion,
          responded: responded.has(p.id),
        })),
        activity: events
          .filter(
            (entry) => !entry.targetId || entry.targetId === auth.participantId,
          )
          .map((entry) => entry.event),
        history,
      });
    }
    return result;
  };
  if (scenario !== "empty") {
    await evaluate();
    for (const finding of scenarioFindings(scenario))
      await record("finding_detected", finding.message, null, finding.category);
    const question = makeQuestion();
    if (question)
      await record(
        "question_asked",
        question.text,
        null,
        scenario === "family" ? "People Check" : null,
        question.visibility === "private" ? alex.participantId : null,
      );
    await addHistory(
      scenario === "safety"
        ? "Five categories checked. Unconfirmed emergency communications keep Safety Check blocked."
        : scenario === "kickoff"
          ? "All six checks have supporting information. Participant approval is still separate."
          : scenario === "family"
            ? "The venue access question is unresolved. People Check needs participant input."
            : scenario === "hike"
              ? "Required schedule and safety information is recorded. Meals, pickup and shared hiking gear remain open."
              : "Required schedule and safety information is recorded. Meals, transport and the picnic kit remain open.",
    );
  }
  if (scenario === "blocked") {
    await rooms.revise(created.roomId, alex, await readRevision(), (await read()).proposal);
    await rooms.submit(
      created.roomId,
      alex,
      await readRevision(),
      "Synthetic additional question.",
    );
    await evaluate(false, true);
  }
  const initial = await capture(1);
  if (scenario !== "beach" && scenario !== "hike")
    return { initial, updated: initial, revised: initial, carpool: initial };
  for (const key of ["meal_cost", "transport", "equipment"]) {
    await confirm(key);
    await record(
      "constraint_confirmed",
      key === "meal_cost"
        ? "Shared meals were confirmed within the group budget."
        : key === "transport"
          ? "The group pickup and transport quote were confirmed."
          : "The shared picnic equipment was confirmed.",
      alex.participantId,
      key === "meal_cost"
        ? "Budget Check"
        : key === "transport"
          ? "Logistics Check"
          : "Preparation Check",
    );
  }
  responded.clear();
  await evaluate(true);
  await record(
    "issue_resolved",
    "Meal costs and transport are now confirmed.",
    null,
    "Logistics Check",
  );
  await addHistory(
    scenario === "hike"
      ? "Meal costs and pickup are confirmed. Shared hiking gear still needs an owner. The revised facts reset earlier approvals."
      : "Meal costs and transport are confirmed. The picnic kit still needs an owner. The revised facts reset earlier approvals.",
  );
  const updated = await capture(2);
  await rooms.revise(created.roomId, alex, await readRevision(), options[0]);
  responded.clear();
  await record(
    "proposal_revised",
    "Alex previewed the earlier start and shared ride. Previous approvals were cleared.",
    alex.participantId,
  );
  await evaluate(true);
  await addHistory(
    "The shared-ride proposal is within the confirmed budget. Readiness is unchanged; this new version needs fresh responses and approvals.",
  );
  const revised = await capture(3);
  await rooms.revise(created.roomId, alex, await readRevision(), options[1]);
  await record(
    "proposal_revised",
    "Alex previewed the carpool alternative. This proposal needs fresh responses and approvals.",
    alex.participantId,
  );
  await evaluate(true, false, true);
  await addHistory(
    "The carpool proposal fits the confirmed spending ceiling. Driver confirmation remains a practical follow-up; this version has no approvals.",
  );
  return { initial, updated, revised, carpool: await capture(4) };
}
