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
  "study",
  "wedding",
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
  "review",
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
  study: "A fair plan for the group project",
  wedding: "A celebration with room to breathe",
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
  study: {
    date: "Friday, 20 November",
    time: "6:00 PM – 7:00 PM",
    location: "Campus library · room to confirm",
    cost: 0,
    currency: "PHP",
    agenda: "Scope review, research, outline & peer review",
    preparation: "Laptop, source notes & shared outline",
  },
  wedding: {
    date: "Saturday, 19 December",
    time: "4:00 PM – 10:00 PM",
    location: "Garden venue · hold to confirm",
    cost: 8500,
    currency: "PHP",
    transport: "Guest shuttle · quote pending",
    preparation: "Final guest list, vows & day-of kit",
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
function resolvedFinding(
  id: string,
  category: Finding["category"],
  message: string,
  recommendedAction: string,
  evidenceId: string,
): Finding {
  return {
    ...openFinding(id, category, message, recommendedAction),
    status: "resolved",
    uncertainty: "none",
    evidenceIds: [evidenceId],
  };
}
function scenarioFindings(
  scenario: PreviewScenario,
  phase: "initial" | "followup" | "complete" | "alternative" = "initial",
): Finding[] {
  if (scenario === "safety")
    return [openFinding("emergency_plan", "Safety Check", "Emergency communications are unconfirmed for the fieldwork site.", "Verify emergency contacts, communications and local guidance before proceeding.", "critical")];
  if (scenario === "empty") return [];
  if (scenario === "family") {
    const access = resolvedFinding("venue_access", "People Check", "The venue was checked against the group’s shared requirements.", "Review the venue information shared by the group.", "shared_access");
    const meals = resolvedFinding("meal_owner", "Preparation Check", "A participant agreed to coordinate the shared potluck menu.", "Review who is bringing each dish.", "shared_owners");
    const openMeals = openFinding("meal_owner", "Preparation Check", "The potluck menu still needs an owner.", "Choose who will coordinate the shared meal list.");
    if (phase === "alternative") return [access, meals, openFinding("meal_host", "Preparation Check", "The potluck still needs a confirmed host.", "Choose who will coordinate the shared meal list.")];
    if (phase === "complete") return [access, meals];
    if (phase === "followup") return [access, openMeals];
    return [
      openFinding("venue_access", "People Check", "The venue details still need confirmation.", "Review the venue’s features with the group before it is selected."),
      openMeals,
    ];
  }
  if (scenario === "kickoff") {
    const time = resolvedFinding("meeting_time", "Schedule Check", "The team selected a shared 45-minute kickoff slot.", "Review the calendar invitation.", "shared_availability");
    const owner = resolvedFinding("agenda_owner", "Preparation Check", "An agenda owner was selected for the kickoff.", "Review the agenda before the meeting.", "shared_owners");
    const openOwner = openFinding("agenda_owner", "Preparation Check", "No one has confirmed ownership of the kickoff agenda.", "Assign who will collect priorities and circulate the agenda.");
    if (phase === "alternative") return [time, owner, openFinding("facilitator", "People Check", "The alternate meeting slot needs a facilitator.", "Assign a facilitator before sending the invite.")];
    if (phase === "complete") return [time, owner];
    if (phase === "followup") return [time, openOwner];
    return [
      openFinding("meeting_time", "Schedule Check", "The proposed hour overlaps with a participant’s time-zone availability.", "Confirm a shared 45-minute slot across the team’s time zones."),
      openOwner,
    ];
  }
  if (scenario === "study") {
    const deadline = resolvedFinding("project_deadline", "Schedule Check", "The outline review was moved ahead of exam week.", "Review the project milestone dates.", "shared_deadline");
    const owner = resolvedFinding("workload_owner", "Preparation Check", "The final slide deck has an assigned owner.", "Review the workload split before the deadline.", "shared_owners");
    const openOwner = openFinding("workload_owner", "Preparation Check", "The final slide deck still needs an owner.", "Assign the slide deck to a participant with time before the deadline.");
    if (phase === "alternative") return [deadline, owner, openFinding("peer_review", "People Check", "The alternate work split needs a peer reviewer.", "Choose a reviewer before the submission deadline.")];
    if (phase === "complete") return [deadline, owner];
    if (phase === "followup") return [deadline, openOwner];
    return [
      openFinding("project_deadline", "Schedule Check", "The outline review is not aligned with the group’s exam week.", "Confirm a review date that leaves time for exams and final edits."),
      openOwner,
    ];
  }
  if (scenario === "wedding") {
    const budget = resolvedFinding("budget_range", "Budget Check", "The estimate is within the group’s per-person ceiling.", "Keep contingency funds separate from the current estimate.", "shared_budget");
    const venue = resolvedFinding("venue_hold", "Logistics Check", "The venue hold and shuttle quote were reviewed.", "Reconfirm both before making a booking.", "shared_venue");
    const owner = resolvedFinding("supplier_owner", "Preparation Check", "A supplier follow-up owner was assigned.", "Review supplier deadlines before the RSVP cutoff.", "shared_owners");
    const openOwner = openFinding("supplier_owner", "Preparation Check", "The supplier follow-up still needs an owner.", "Assign who will confirm the venue and supplier deadlines.");
    if (phase === "alternative") return [budget, venue, owner, openFinding("supplier_deposit", "Budget Check", "The alternate supplier deposit needs confirmation against the contingency.", "Confirm the deposit and remaining contingency before booking.")];
    if (phase === "complete") return [budget, venue, owner];
    if (phase === "followup") return [budget, venue, openOwner];
    return [
      openFinding("budget_range", "Budget Check", "The per-person estimate has not been checked against the shared ceiling.", "Confirm the estimate and keep the agreed contingency available."),
      openFinding("venue_hold", "Logistics Check", "The venue hold and transport quote are still pending.", "Confirm the venue hold and guest shuttle quote."),
      openOwner,
    ];
  }
  const meal = resolvedFinding("meal_costs", "Budget Check", "Shared meal costs fit the confirmed group budget.", "Review the current proposal.", "shared_meal_cost");
  const transport = resolvedFinding("van_quote", "Logistics Check", "The shared transport pickup and quote were confirmed.", "Review the pickup point.", "shared_transport");
  const kit = resolvedFinding("picnic_kit", "Preparation Check", scenario === "hike" ? "Shared hiking gear has an assigned owner." : "The picnic kit has an assigned owner.", "Review the preparation list.", "shared_owners");
  const openKit = openFinding("picnic_kit", "Preparation Check", scenario === "hike" ? "Shared hiking gear still needs an owner." : "The picnic kit still needs an owner.", scenario === "hike" ? "Choose who will bring the shared hiking equipment." : "Choose who will bring the shared picnic kit.", "info");
  if (phase === "alternative") return [meal, transport, kit, openFinding("carpool_drivers", "Logistics Check", "The carpool alternative needs confirmed drivers.", "Confirm two drivers and their pickup points.")];
  if (phase === "complete") return [meal, transport, kit];
  if (phase === "followup") return [meal, transport, openKit];
  return [
    openFinding("meal_costs", "Budget Check", "Shared meal costs still need confirmation.", scenario === "hike" ? "Confirm meals fit the group’s ₱3,000 per-person ceiling." : "Confirm meals fit the group’s ₱2,000 per-person ceiling."),
    openFinding("van_quote", "Logistics Check", scenario === "hike" ? "The shared ride pickup point needs confirmation." : "The shared van quote is still outstanding.", "Confirm the transport arrangements and pickup point."),
    openKit,
  ];
}

const participantNames: Record<PreviewScenario, readonly [string, string, string, string]> = {
  hike: ["Alex", "Sam", "Jo", "Mika"], beach: ["Alex", "Sam", "Jamie", "Drew"],
  family: ["Robin", "Chris", "Taylor", "Pat"], kickoff: ["Morgan", "Casey", "Jordan", "Lee"],
  study: ["Ari", "Quinn", "Riley", "Charlie"], wedding: ["Jules", "Sky", "Reese", "Blake"],
  safety: ["Alex", "Sam", "Jo", "Mika"], blocked: ["Alex", "Sam", "Jo", "Mika"], empty: ["Alex", "Sam", "Jo", "Mika"],
};
const openingMessages: Record<PreviewScenario, readonly [string, string, string, string]> = {
  hike: ["I can start early, but I need the route and pickup confirmed first.", "I can join after breakfast; an 8:30 start is easier for me.", "I can drive if we split fuel fairly.", "I have the first-aid kit, but need to know who is bringing water."],
  beach: ["I can leave early, but I need the total under ₱2,000 per person.", "Saturday morning is difficult for me; Sunday works better.", "I can drive if we can split the passengers across cars.", "I can help with supplies once the pickup point is clear."],
  family: ["Sunday lunch works for me; I can bring a vegetarian dish.", "I can coordinate food, but I need the allergy list first.", "I can help with setup if we keep the travel plan simple.", "I can confirm venue details after we settle the meal plan."],
  kickoff: ["10:00 Manila time works; I cannot start earlier than 9.", "I am three hours behind, so a later slot is easier for me.", "Let’s agree on priorities before we assign owners.", "I can take notes, but I have a conflict after 10:45."],
  study: ["I have exams next week, so Thursday is better than Wednesday.", "I can outline the report if the source review is shared fairly.", "I am free Tuesday and Thursday evenings.", "I can make the final slides once the draft is ready."],
  wedding: ["Please keep the per-person estimate within our ₱8,500 ceiling.", "I can compare guest shuttle quotes before the RSVP deadline.", "Let’s keep a little budget aside for last-minute costs.", "I can coordinate catering once the guest count is confirmed."],
  safety: ["I can attend, but I need the emergency contact plan first.", "The shuttle pickup point needs to be accessible.", "I can bring field notes and protective equipment.", "Please confirm the field lead before we proceed."],
  blocked: ["I can leave early, but I need the total under ₱2,000 per person.", "Saturday morning is difficult for me; Sunday works better.", "I can drive if we can split the passengers across cars.", "I can help with supplies once the pickup point is clear."],
  empty: ["I am interested in helping shape the plan.", "I can share my availability once we know the dates.", "I can help with a task after we agree on the scope.", "I am still deciding what I can take on."],
};
const missingKeys: Record<PreviewScenario, readonly string[]> = {
  hike: ["transport", "equipment", "owners"], beach: ["transport", "equipment", "owners"],
  family: ["access", "meal_cost", "owners"], kickoff: ["availability", "owners"],
  study: ["availability", "deadline", "equipment", "owners"], wedding: ["budget", "venue", "transport", "owners"],
  safety: [], blocked: ["transport", "equipment", "owners"], empty: requiredKeys.flat(),
};
const followupKeys: Record<PreviewScenario, readonly string[]> = {
  hike: ["meal_cost", "transport", "equipment"], beach: ["meal_cost", "transport", "equipment"],
  family: ["access"], kickoff: ["availability"], study: ["availability", "deadline", "equipment"],
  wedding: ["budget", "venue", "transport"], safety: [], blocked: ["meal_cost", "transport", "equipment"], empty: [],
};
function notApplicableCategories(scenario: PreviewScenario): Set<string> {
  if (scenario === "kickoff") return new Set(["Budget Check", "Logistics Check", "Safety Check"]);
  if (scenario === "study") return new Set(["Logistics Check", "Safety Check"]);
  return new Set();
}
function requiredKeysFor(scenario: PreviewScenario) {
  return requiredKeys.map((keys, index) => {
    const category = Categories[index];
    if (notApplicableCategories(scenario).has(category)) return [];
    if (scenario === "kickoff" && category === "Preparation Check") return ["agenda", "owners"];
    if (scenario === "study" && category === "Schedule Check") return ["date", "deadline", "availability"];
    return keys;
  });
}
function eventTypeFor(scenario: PreviewScenario): string {
  const values: Record<PreviewScenario, string> = {
    hike: "Mountain hike", beach: "Beach trip", family: "Family reunion", kickoff: "Project kickoff",
    study: "Group project", wedding: "Wedding planning", safety: "Outdoor group project",
    blocked: "Beach trip", empty: "Planning idea",
  };
  return values[scenario];
}


export async function createPreviewFixture(
  scenario: PreviewScenario,
): Promise<PreviewFixture> {
  const store = new RoomStore(new MemoryPersistence());
  const rooms = new RoomService(store);
  const policyKeys = requiredKeysFor(scenario);
  const notApplicable = notApplicableCategories(scenario);
  const created = await rooms.create(
    eventTypeFor(scenario),
    Categories.map((category, index) => ({
      category,
      enabled: !notApplicable.has(category),
      weight: 1,
      requiredKeys: policyKeys[index],
      requiredPerParticipantKeys: [],
    })),
    { id: "group_plan", label: titles[scenario], values: planValues[scenario] },
  );
  const auths = new Map<PreviewViewer, Auth>();
  for (const [index, viewer] of PreviewViewers.entries())
    auths.set(
      viewer,
      await rooms.join(
        created.roomId,
        created.invitation,
        participantNames[scenario][index],
      ),
    );
  const alex = auths.get("alex")!;
  const read = () => store.read(created.roomId);
  const readRevision = async (auth: Auth = alex) =>
    (await rooms.view(created.roomId, auth)).revision;
  const confirmedKeys = new Set<string>();
  const confirm = async (key: string, owner: Auth = alex) => {
    if (confirmedKeys.has(key)) return;
    await rooms.confirmFact(created.roomId, owner, await readRevision(owner), {
      id: "shared_" + key,
      key,
      value: true,
      confirmed: true,
      visibility: "group",
      scope: "shared",
      ownerId: owner.participantId,
    });
    confirmedKeys.add(key);
  };
  const missing = new Set(missingKeys[scenario]);
  if (scenario === "safety") missing.clear();
  for (const key of new Set(policyKeys.flat()))
    if (!missing.has(key)) await confirm(key);

  const costCeiling =
    scenario === "hike" ? 3000 :
      scenario === "beach" || scenario === "blocked" ? 2000 :
        scenario === "wedding" ? 8500 : null;
  if (costCeiling !== null)
    await rooms.setConstraints(created.roomId, alex, await readRevision(), [
      {
        id: "group_budget",
        ownerId: alex.participantId,
        category: "Budget Check",
        key: "cost",
        operator: "lte",
        expected: costCeiling,
        hard: true,
      },
    ]);

  type PrivateEvent = { event: DashboardActivity; targetId: string | null };
  const events: PrivateEvent[] = [];
  const history: DashboardSnapshot["history"] = [];
  let tick = 0;
  let messageSerial = 0;
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
  const submitMessage = async (
    viewer: PreviewViewer,
    text: string,
    visibility: "group" | "private" = "group",
    questionId: string | null = null,
    replyOption: string | null = null,
  ) => {
    const auth = auths.get(viewer)!;
    const view = await rooms.view(created.roomId, auth);
    const result = await rooms.submit(created.roomId, auth, {
      messageId: "fixture_" + scenario + "_" + viewer + "_" + ++messageSerial,
      expectedRevision: view.revision,
      proposalVersion: view.proposalVersion,
      text,
      visibility,
      questionId,
      replyOption,
    });
    return result.receipt;
  };

  for (const [index, viewer] of PreviewViewers.entries()) {
    const auth = auths.get(viewer)!;
    const name = participantNames[scenario][index];
    await record("participant_joined", name + " joined the plan.", auth.participantId);
  }
  if (scenario !== "empty") {
    for (const [index, viewer] of PreviewViewers.entries()) {
      const auth = auths.get(viewer)!;
      await submitMessage(viewer, openingMessages[scenario][index]);
      await record(
        "participant_responded",
        participantNames[scenario][index] + " added a planning detail.",
        auth.participantId,
      );
    }
  }
  if (scenario === "family") {
    const pat = auths.get("mika")!;
    await submitMessage(
      "mika",
      "I need a step-free entrance and accessible restroom. Please keep those details private until I share them.",
      "private",
    );
    await record(
      "participant_responded",
      "A private planning detail was recorded for Pat.",
      pat.participantId,
      null,
      pat.participantId,
    );
  }

  const options: PlanOption[] = (() => {
    if (scenario === "hike" || scenario === "beach" || scenario === "blocked")
      return [
        {
          id: "shared_van",
          label: scenario === "hike" ? "A later start, the same adventure" : "An earlier start, a shared ride",
          values: {
            ...planValues[scenario],
            cost: scenario === "hike" ? 2400 : 1700,
            time: scenario === "hike" ? "8:30 AM – 4:30 PM" : "6:30 AM – 6:00 PM",
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
      ];
    if (scenario === "family")
      return [
        { id: "accessible_venue", label: "Accessible hall, shared potluck", values: { ...planValues.family, location: "Accessible community hall · fictional venue", cost: 800 } },
        { id: "family_home", label: "Family home, smaller setup", values: { ...planValues.family, location: "Family home · access to confirm", cost: 650 } },
      ];
    if (scenario === "kickoff")
      return [
        { id: "shorter_slot", label: "45-minute kickoff with a focused agenda", values: { ...planValues.kickoff, time: "10:00 AM – 10:45 AM", agenda: "Priorities, decisions, owners & next steps" } },
        { id: "later_slot", label: "Later slot for more time zones", values: { ...planValues.kickoff, time: "11:00 AM – 11:45 AM", agenda: "Priorities, decisions, owners & next steps" } },
      ];
    if (scenario === "study")
      return [
        { id: "scope_trim", label: "Smaller scope, balanced review", values: { ...planValues.study, date: "Thursday, 19 November", time: "6:30 PM – 7:15 PM", agenda: "Research summary, outline & peer review" } },
        { id: "paired_work", label: "Pair on the outline, keep Friday review", values: { ...planValues.study, agenda: "Paired outline, source check & final slides" } },
      ];
    if (scenario === "wedding")
      return [
        { id: "supplier_hold", label: "Hold the venue, confirm suppliers by RSVP", values: { ...planValues.wedding, cost: 8200, location: "Garden venue · provisional hold", transport: "Guest shuttle · quote requested" } },
        { id: "contingency_plan", label: "Keep the venue flexible and protect contingency", values: { ...planValues.wedding, cost: 7900, location: "Garden venue · second option pending", transport: "Guest shuttle · compare two quotes" } },
      ];
    return [];
  })();

  const makeQuestion = (
    phase: "initial" | "followup" | "complete" | "alternative",
  ): Question | null => {
    if (phase === "complete" || phase === "alternative" || scenario === "empty" || scenario === "blocked") return null;
    if (scenario === "safety")
      return phase === "initial" ? {
        id: "emergency_question", findingId: "emergency_plan", targetId: null,
        visibility: "group", kind: "clarification",
        text: "Who can verify emergency communications before the fieldwork?",
        options: ["I can verify the contacts", "Name another field lead", "Still deciding"],
      } : null;
    if (scenario === "family" && phase === "initial")
      return {
        id: "venue_access_question", findingId: "venue_access",
        targetId: auths.get("mika")!.participantId, visibility: "private",
        kind: "clarification",
        text: "Pat, should we ask the venue to confirm step-free access and an accessible restroom?",
        options: ["Yes, confirm both", "I will share another requirement", "Still deciding"],
      };
    if (scenario === "family")
      return {
        id: "meal_plan_question", findingId: "meal_owner", targetId: null,
        visibility: "group", kind: "choice",
        text: "Who can coordinate the vegetarian dishes and allergy list?",
        options: ["Robin can coordinate the menu", "Chris can coordinate the menu", "Still deciding"],
      };
    if (scenario === "kickoff" && phase === "initial")
      return {
        id: "meeting_slot_question", findingId: "meeting_time", targetId: null,
        visibility: "group", kind: "choice",
        text: "Which 45-minute kickoff slot works across the team’s time zones?",
        options: ["10:00–10:45 AM Manila time", "11:00–11:45 AM Manila time", "Suggest another time", "Still deciding"],
      };
    if (scenario === "kickoff")
      return {
        id: "agenda_owner_question", findingId: "agenda_owner", targetId: null,
        visibility: "group", kind: "choice",
        text: "Who can collect priorities and circulate the kickoff agenda?",
        options: ["Morgan can own the agenda", "Jordan can own the agenda", "Still deciding"],
      };
    if (scenario === "study" && phase === "initial")
      return {
        id: "project_deadline_question", findingId: "project_deadline", targetId: null,
        visibility: "group", kind: "choice",
        text: "When should the group review the outline before exams begin?",
        options: ["Thursday evening", "Friday afternoon", "Choose another date", "Still deciding"],
      };
    if (scenario === "study")
      return {
        id: "workload_owner_question", findingId: "workload_owner", targetId: null,
        visibility: "group", kind: "choice",
        text: "Who can own the final slide deck before the submission deadline?",
        options: ["Charlie can own the slides", "Ari can own the slides", "Still deciding"],
      };
    if (scenario === "wedding" && phase === "initial")
      return {
        id: "wedding_budget_question", findingId: "budget_range", targetId: null,
        visibility: "group", kind: "choice",
        text: "Can the per-person estimate stay at or below ₱8,500, with contingency left aside?",
        options: ["Yes, keep the ₱8,500 ceiling", "Reduce the estimate", "Choose another amount", "Still deciding"],
      };
    if (scenario === "wedding")
      return {
        id: "supplier_owner_question", findingId: "supplier_owner", targetId: null,
        visibility: "group", kind: "choice",
        text: "Who can confirm the venue hold and supplier deadlines?",
        options: ["Jules can coordinate suppliers", "Sky can coordinate suppliers", "Still deciding"],
      };
    const isHike = scenario === "hike";
    const followup = phase === "followup";
    return {
      id: followup ? "kit_owner_question" : "meal_cost_question",
      findingId: followup ? "picnic_kit" : "meal_costs",
      targetId: null, visibility: "group", kind: "choice",
      text: followup
        ? (isHike ? "Who can bring the shared hiking gear?" : "Who can bring the shared picnic kit?")
        : isHike
          ? "Would an 8:30 AM departure and a ₱2,400 budget work for you?"
          : "Would a ₱1,800 per-person plan work for you, including shared meals?",
      options: followup
        ? ["Alex can bring the kit", "Sam can bring the kit", "Still deciding"]
        : isHike
          ? ["Yes, 8:30 AM works", "Suggest another departure", "Still deciding"]
          : ["Yes, within ₱1,800", "Choose a lower budget", "Choose another amount", "Still deciding"],
    };
  };

  const evaluate = async (
    phase: "initial" | "followup" | "complete" | "alternative",
    fail = false,
  ) => {
    const findings = scenarioFindings(scenario, phase);
    const question = makeQuestion(phase);
    const canNegotiate = options.length > 0 && (phase === "initial" || phase === "followup");
    const evaluation = judge({
      findings,
      next: question ? "question" : "stop",
      taskFindingIds: [],
      participantInputRequired: Boolean(question),
    });
    const currentRoom = await read();
    const steps: Step[] = currentRoom.pendingInputs.filter((pending) => {
      const source = currentRoom.responses.find((response) => response.id === pending.messageId);
      return source?.proposalVersion === currentRoom.proposalVersion;
    }).map(() => ({
      role: "Listener" as const,
      output: { candidates: [] },
    }));
    if (fail) steps.push({ role: "Judge", error: new Error("Synthetic unavailable analysis") });
    else {
      if (canNegotiate) {
        steps.push(
          {
            role: "Judge",
            output: {
              ...evaluation,
              next: "negotiate",
              taskFindingIds: [findings.find((item) => item.status !== "resolved")!.id],
              anotherPassUseful: true,
              canStop: false,
            },
          },
          { role: "Negotiator", output: { options } },
        );
        evaluation.verdicts = options.map((option) => ({ optionId: option.id, accepted: true }));
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
                ...findings.slice(0, 1).map((finding) => ({ questionId: null, findingId: finding.id, text: finding.message })),
              ],
              mascot: scenario === "safety" ? "concerned" : "curious",
            },
          },
          { role: "Judge", output: { ...evaluation, acceptedQuestionIds: [question.id] } },
        );
    }
    const scripted = scriptedGateway(steps);
    const engine = new AgentEngine(store, scripted.gateway);
    const cycle = await engine.run(created.roomId, alex);
    if (cycle.outcome === "BLOCKED" && !fail) {
      const failures = cycle.traces.map((trace) => ({
        role: trace.role, status: trace.status, failureCode: trace.failureCode, failureMessage: trace.failureMessage,
      }));
      throw new Error("Unexpected preview fixture failure: " + cycle.reason + " " + JSON.stringify(failures));
    }
    return cycle;
  };
  const addHistory = async (explanation: string) => {
    const room = await read();
    if (!room.readiness) return;
    history.push({
      id: "evaluation_" + history.length,
      revision: room.revision,
      proposalVersion: room.proposalVersion,
      occurredAt: new Date(Date.UTC(2026, 10, 3, 3, 31 + history.length * 5)).toISOString(),
      readiness: room.readiness,
      explanation,
    });
    await record("readiness_changed", "Readiness evaluated at " + room.readiness.percentage + "%.");
  };
  const capture = async (sequence: number) => {
    const result: Partial<Record<PreviewViewer, DashboardSnapshot>> = {};
    for (const [viewer, auth] of auths) {
      const authorizedView = await rooms.view(created.roomId, auth);
      const room = projectDashboardRoom(authorizedView);
      const currentResponses = authorizedView.responses.filter(
        (response) => response.proposalVersion === room.proposalVersion,
      );
      const participantById = new Map(room.participants.map((person) => [person.id, person]));
      result[viewer] = DashboardSnapshotSchema.parse({
        schemaVersion: "dashboard-v1",
        source: "synthetic",
        sequence,
        room,
        responseTracking: "synthetic",
        responses: room.participants.map((person) => ({
          participantId: person.id,
          proposalVersion: room.proposalVersion,
          responded: currentResponses.some((response) => response.ownerId === person.id),
        })),
        contributions: currentResponses.map((response) => ({
          id: response.id,
          participantId: response.ownerId,
          participantName: participantById.get(response.ownerId)?.name ?? "Fictional participant",
          visibility: response.visibility,
          targetId: response.visibility === "private" ? response.ownerId : null,
          text: response.text,
          questionId: response.questionId,
          recordedAt: response.occurredAt,
          proposalVersion: response.proposalVersion,
        })),
        activity: events
          .filter((entry) => !entry.targetId || entry.targetId === auth.participantId)
          .map((entry) => entry.event),
        history,
      });
    }
    return result;
  };

  if (scenario !== "empty") {
    await evaluate("initial");
    const initialQuestion = makeQuestion("initial");
    for (const finding of scenarioFindings(scenario, "initial"))
      await record("finding_detected", finding.message, null, finding.category);
    if (initialQuestion)
      await record(
        "question_asked",
        initialQuestion.visibility === "private" ? "Setvia sent a private planning question." : initialQuestion.text,
        null,
        initialQuestion.visibility === "private" ? "People Check" : null,
        initialQuestion.visibility === "private" ? initialQuestion.targetId : null,
      );
    const explanations: Record<PreviewScenario, string> = {
      hike: "The fictional group has a proposed route and budget. Pickup details and shared gear remain open.",
      beach: "The fictional group has an initial trip plan. Budget, transport and the picnic kit need confirmation.",
      family: "The fictional reunion has an access question for Pat and a shared meal plan to settle.",
      kickoff: "The team has a draft agenda and time. Time-zone availability and an agenda owner remain open.",
      study: "The group has a draft scope. The exam-week review date and slide owner need confirmation.",
      wedding: "The wedding outline has a budget estimate. Venue, transport and supplier ownership remain open.",
      safety: "Five categories are applicable. Unconfirmed emergency communications keep Safety Check blocked.",
      blocked: "A prior readiness result is retained while the latest analysis is blocked.",
      empty: "No analysis has run.",
    };
    await addHistory(explanations[scenario]);
  }
  if (scenario === "blocked") {
    await rooms.revise(created.roomId, alex, await readRevision(), (await read()).proposal);
    const revision = await readRevision();
    await rooms.submit(created.roomId, alex, revision, "Synthetic additional question.");
    await evaluate("initial", true);
  }
  const initial = await capture(1);
  if (scenario === "empty" || scenario === "safety" || scenario === "blocked")
    return { initial, updated: initial, revised: initial, review: initial, carpool: initial };

  const answerQuestion = async (
    phase: "initial" | "followup",
    replyIndex = 0,
  ) => {
    const question = makeQuestion(phase);
    if (!question) return;
    const targetViewer = question.targetId
      ? PreviewViewers.find((viewer) => auths.get(viewer)!.participantId === question.targetId)!
      : "alex";
    const answerAuth = auths.get(targetViewer)!;
    const option = question.options[replyIndex] ?? question.options[0];
    await submitMessage(targetViewer, option, question.visibility, question.id, option);
    await record(
      "participant_responded",
      question.visibility === "private" ? "A private answer was recorded." : participantNames[scenario][PreviewViewers.indexOf(targetViewer)] + " answered a planning question.",
      answerAuth.participantId,
      null,
      question.visibility === "private" ? answerAuth.participantId : null,
    );
  };
  await answerQuestion("initial");
  for (const key of followupKeys[scenario]) {
    const owner = scenario === "family" && key === "access" ? auths.get("mika")! : alex;
    await confirm(key, owner);
    await record(
      "constraint_confirmed",
      key.replaceAll("_", " ") + " was confirmed in the fictional plan.",
      owner.participantId,
    );
  }
  await evaluate("followup");
  await addHistory("The first question was answered and confirmed details were added. One planning responsibility still needs an owner.");
  const updated = await capture(2);

  await answerQuestion("followup");
  for (const key of new Set(policyKeys.flat())) {
    const owner = scenario === "family" && key === "access" ? auths.get("mika")! : alex;
    await confirm(key, owner);
  }
  if (options.length)
    await rooms.revise(created.roomId, alex, await readRevision(), options[0]);
  await record(
    "proposal_revised",
    "A revised fictional proposal is ready for participant review.",
    alex.participantId,
  );
  await evaluate("complete");
  await addHistory("All required fictional planning details are confirmed. The proposal is ready for participants to review; no one has approved it yet.");
  const revised = await capture(3);
  await record("analysis_completed", "This proposal is ready for each participant to review.", null);
  const review = await capture(4);

  if (options.length > 1)
    await rooms.revise(created.roomId, alex, await readRevision(), options[1]);
  await record(
    "proposal_revised",
    "An alternative fictional proposal is open for review.",
    alex.participantId,
  );
  await evaluate("alternative");
  await addHistory("This alternative has a follow-up item. Readiness is recalculated from its open finding; participant approval remains separate.");
  return { initial, updated, revised, review, carpool: await capture(5) };
}
