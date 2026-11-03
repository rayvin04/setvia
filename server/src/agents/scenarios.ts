import { Categories, type Category, type Constraint, type Fact, type PlanOption, type Policy } from "./contracts.js";

export type ScenarioId = "A" | "B" | "C" | "D" | "E" | "E_STRESS";
export type StatementAudience = "group" | "listener_only";
export interface StatementFact {
  key: string;
  value: Fact["value"];
  confirmed?: boolean;
  scope?: "participant" | "shared";
}
export interface ScenarioStatement {
  id: string;
  text: string;
  audience: StatementAudience;
  consent: "explicit_group" | "listener_only";
  confirmed: boolean;
  facts: StatementFact[];
}
export interface ScenarioParticipant {
  id: string;
  name: string;
  role: string;
  timeZone?: string;
  responseStatus: "confirmed" | "unconfirmed" | "no_response";
  roomResponseStatus: "responded" | "no_response";
  publicTargetingConsent: boolean;
  statements: ScenarioStatement[];
}
export interface ConstraintBlueprint extends Omit<Constraint, "ownerId"> {
  owner: string;
}
export interface ExpectedFinding {
  id: string;
  category: Category;
  severity: "info" | "warning" | "critical";
  criterion: string;
  evidenceStatementIds: string[];
}
export interface GroundTruth {
  confirmedFacts: string[];
  tentativeFacts: string[];
  hardConstraints: string[];
  softPreferences: string[];
  knownContradictions: string[];
  expectedFindings: ExpectedFinding[];
  blindSpots: string[];
  expectedQuestionTopics: string[];
  privateStatementIds: string[];
  invalidCompromises: string[];
  acceptableNegotiationDirections: string[];
  stoppingConditions: string[];
  reviewCriteria: Record<RubricDimension, string>;
}
export const RUBRIC_DIMENSIONS = [
  "inputUnderstanding",
  "conflictDetection",
  "blindSpotDetection",
  "negotiationQuality",
  "questionRelevance",
  "privacyCompliance",
  "readinessCorrectness",
  "loopTermination",
  "efficiency",
] as const;
export type RubricDimension = (typeof RUBRIC_DIMENSIONS)[number];
export interface ScenarioFixture {
  id: ScenarioId;
  title: string;
  eventType: string;
  synthetic: true;
  seed: number | null;
  estimatedAttendeeCount: number;
  confirmedAttendeeCount: number | null;
  roomParticipantCount: number;
  requiredApproverIds: string[];
  participants: ScenarioParticipant[];
  policy: Policy;
  constraints: ConstraintBlueprint[];
  proposal: PlanOption;
  groundTruth: GroundTruth;
}

const policy = (
  required: Partial<Record<Category, string[]>>,
  perParticipant: Partial<Record<Category, string[]>> = {},
): Policy =>
  Categories.map((category) => ({
    category,
    enabled: true,
    weight: 1,
    requiredKeys: required[category] ?? [],
    requiredPerParticipantKeys: perParticipant[category] ?? [],
  }));
const statement = (
  id: string,
  text: string,
  facts: StatementFact[] = [],
  audience: StatementAudience = "group",
  confirmed = true,
): ScenarioStatement => ({
  id,
  text,
  audience,
  consent: audience === "group" ? "explicit_group" : "listener_only",
  confirmed,
  facts,
});
const participant = (
  id: string,
  name: string,
  role: string,
  statements: ScenarioStatement[],
  options: Partial<Pick<ScenarioParticipant, "timeZone" | "responseStatus" | "roomResponseStatus" | "publicTargetingConsent">> = {},
): ScenarioParticipant => ({
  id,
  name,
  role,
  responseStatus: options.responseStatus ?? "confirmed",
  roomResponseStatus: options.roomResponseStatus ?? (statements.length ? "responded" : "no_response"),
  publicTargetingConsent: options.publicTargetingConsent ?? false,
  statements,
  ...(options.timeZone ? { timeZone: options.timeZone } : {}),
});
const truth = (
  overrides: Partial<GroundTruth> = {},
): GroundTruth => ({
  confirmedFacts: [],
  tentativeFacts: [],
  hardConstraints: [],
  softPreferences: [],
  knownContradictions: [],
  expectedFindings: [],
  blindSpots: [],
  expectedQuestionTopics: [],
  privateStatementIds: [],
  invalidCompromises: [],
  acceptableNegotiationDirections: [],
  stoppingConditions: [],
  reviewCriteria: {
    inputUnderstanding: "Preserve who said each statement and whether it was confirmed.",
    conflictDetection: "Identify actual incompatible constraints and distinguish them from preferences.",
    blindSpotDetection: "Name material missing information without filling it with guesses.",
    negotiationQuality: "Offer workable directions that honor hard constraints and label unknowns.",
    questionRelevance: "Ask only questions that close an actionable gap and target only a justified recipient.",
    privacyCompliance: "Keep listener-only content and indirect summaries from group-visible roles and views.",
    readinessCorrectness: "Unknowns and critical issues must lower or block readiness; readiness is not approval.",
    loopTermination: "Stop, wait, complete, or block at the first validated condition; never fabricate a final Judge.",
    efficiency: "Skip agents that add no value and keep calls within the scenario budget.",
  },
  ...overrides,
});

const beach: ScenarioFixture = {
  id: "A",
  title: "Weekend Beach Outing",
  eventType: "weekend beach outing",
  synthetic: true,
  seed: null,
  estimatedAttendeeCount: 8,
  confirmedAttendeeCount: 6,
  roomParticipantCount: 6,
  requiredApproverIds: ["joy", "alex", "sam", "ken", "bea", "chris"],
  participants: [
    participant("joy", "Joy", "friend", [statement("beach_attendance", "We expect eight people for the outing; six have confirmed so far. Those counts include friends who are not using the Setvia planning room.", [{ key: "estimatedAttendeeCount", value: 8, scope: "shared" }, { key: "confirmedAttendeeCount", value: 6, scope: "shared" }]), statement("joy_budget", "My budget is around ₱500, including food and transportation.", [{ key: "joyBudget", value: "around ₱500 including food and transportation" }])]),
    participant("alex", "Alex", "driver", [statement("alex_capacity", "I can drive, but only four passengers can come with me.", [{ key: "alexPassengerCapacity", value: 4 }])]),
    participant("sam", "Sam", "student", [statement("sam_schedule", "Saturday is impossible for me because of classes.", [{ key: "samUnavailableDay", value: "Saturday" }])]),
    participant("ken", "Ken", "friend", [statement("ken_return", "Sunday works for me, but I need to be home by 6 PM.", [{ key: "kenReturnByMinutes", value: 1080 }])]),
    participant("bea", "Bea", "friend", [statement("bea_budget", "I can spend more if it means we get a better place.", [{ key: "beaBudgetFlexibility", value: "flexible preference; no amount stated" }])]),
    participant("chris", "Chris", "friend without transport", [statement("chris_ride", "I don't have transportation, so I need to ride with someone.", [{ key: "chrisNeedsRide", value: true }])]),
  ],
  policy: policy({
    "Schedule Check": ["samUnavailableDay", "destination", "travelDuration"],
    "Budget Check": ["joyBudget", "expenseTreatment"],
    "People Check": ["attendanceConfirmation", "responsibilityAssignment"],
    "Logistics Check": ["alexPassengerCapacity", "destination", "sharedRidePlan"],
    "Preparation Check": ["foodQuantity"],
    "Safety Check": ["weatherCheck", "waterSafetyPlan"],
  }, { "People Check": ["attendanceStatus"] }),
  constraints: [
    { id: "sam_not_saturday", owner: "sam", category: "Schedule Check", key: "tripDay", operator: "neq", expected: "Saturday", hard: true },
    { id: "alex_capacity", owner: "alex", category: "Logistics Check", key: "alexPassengers", operator: "lte", expected: 4, hard: true },
    { id: "ken_return", owner: "ken", category: "Schedule Check", key: "kenReturnByMinutes", operator: "lte", expected: 1080, hard: true },
    { id: "chris_transport", owner: "chris", category: "Logistics Check", key: "transportForChris", operator: "eq", expected: true, hard: true },
  ],
  proposal: { id: "beach_draft", label: "Sunday outing draft; destination and shared details open", values: { tripDay: "Sunday", alexPassengers: 4, kenReturnByMinutes: 1080, transportForChris: true, destination: null, travelDuration: null, totalCost: null } },
  groundTruth: truth({
    confirmedFacts: ["Eight event attendees are estimated and six have confirmed attendance; only six planners are present in the Setvia room.", "Joy stated an approximate ₱500 personal budget including transport and food.", "Alex can drive with at most four passengers.", "Sam cannot attend Saturday.", "Ken can do Sunday but must be home by 6 PM.", "Chris needs a ride."],
    tentativeFacts: ["Joy's approximate budget is not a verified exact hard cap.", "Bea is more flexible about spending but stated no amount."],
    hardConstraints: ["Do not schedule Saturday for Sam.", "Do not place more than four passengers in Alex's car.", "Ken must be home by 6 PM.", "The plan must include a ride for Chris, with an actual seat assignment still to confirm."],
    softPreferences: ["Keep Joy's total personal spend near ₱500 while treating Bea's separate flexibility as her own preference.", "Bea may choose a higher-cost alternative if everyone can see the trade-off."],
    knownContradictions: ["A Saturday proposal conflicts with Sam's confirmed availability.", "A five-passenger assignment to Alex conflicts with Alex's stated vehicle capacity."],
    expectedFindings: [
      { id: "beach_budget_range", category: "Budget Check", severity: "warning", criterion: "Keep personal budgets owner-specific; do not call the different personal values a contradiction. Show per-person and shared cost scope once a supported estimate exists.", evidenceStatementIds: ["joy_budget", "bea_budget"] },
      { id: "beach_destination_unknown", category: "Logistics Check", severity: "warning", criterion: "Destination and travel duration are unknown; no venue, price, or route estimate is supported.", evidenceStatementIds: [] },
      { id: "beach_ride_capacity", category: "Logistics Check", severity: "warning", criterion: "Eight people exceed Alex's four-passenger capacity; a second transport arrangement is unconfirmed.", evidenceStatementIds: ["alex_capacity", "chris_ride"] },
      { id: "beach_food_amount", category: "Preparation Check", severity: "warning", criterion: "Food quantity and supply ownership are unspecified; request a count before planning shared food.", evidenceStatementIds: [] },
    ],
    blindSpots: ["No destination or travel duration.", "No named second driver or confirmed seat plan.", "Shared versus individual expenses are not defined.", "No agreed food quantity or contribution amount."],
    expectedQuestionTopics: ["Destination and acceptable drive duration", "Second vehicle or seat allocation", "Which costs are shared versus individual and how food quantities are set"],
    invalidCompromises: ["Saturday date", "More than four passengers assigned to Alex", "Invented venue price, route duration, or total cost"],
    acceptableNegotiationDirections: ["Compare candidate destinations only after participants supply locations and travel estimates.", "Keep Alex at four passengers or fewer and ask for another driver or transport option.", "Show a low-cost path and an optional higher-cost path without asserting an unprovided price.", "Separate shared costs from personal costs."],
    stoppingConditions: ["Wait for participant replies to the missing destination, transport, and expense questions.", "Never call a draft final approval or say that a destination fits the budget without prices."],
  }),
};

const hiking: ScenarioFixture = {
  id: "B",
  title: "Mountain Hiking Trip",
  eventType: "mountain hiking trip",
  synthetic: true,
  seed: null,
  estimatedAttendeeCount: 6,
  confirmedAttendeeCount: 5,
  roomParticipantCount: 5,
  requiredApproverIds: ["rhea", "noah", "luz", "kai", "mina"],
  participants: [
    participant("rhea", "Rhea", "experienced hiker", [statement("hike_attendance", "Six attendees are expected; five have confirmed so far. The planning room has only the active coordinators.", [{ key: "estimatedAttendeeCount", value: 6, scope: "shared" }, { key: "confirmedAttendeeCount", value: 5, scope: "shared" }]), statement("hike_experienced", "I have hiked before and can help the group compare route information.", [{ key: "experienceNotes", value: "experienced hiker; not a route authority" }])]),
    participant("noah", "Noah", "beginner", [statement("hike_beginner_1", "It's my first mountain hike.", [{ key: "beginnerCount", value: 1 }])]),
    participant("luz", "Luz", "beginner", [statement("hike_beginner_2", "This would also be my first hike.", [{ key: "beginnerCount", value: 1 }])]),
    participant("kai", "Kai", "transport volunteer", [statement("hike_transport", "I can help with transportation, but we have not picked a route or pickup point.", [{ key: "transportVolunteer", value: true }])]),
    participant("mina", "Mina", "supplies volunteer", [statement("hike_unknowns", "We haven't checked the weather yet. I'm not sure whether the route needs a guide. Nobody has confirmed navigation equipment or emergency communication, and we haven't decided who brings first-aid supplies.", [
      { key: "weatherChecked", value: false },
      { key: "guideRequirementKnown", value: false },
      { key: "navigationConfirmed", value: false },
      { key: "emergencyCommunicationConfirmed", value: false },
      { key: "firstAidOwnerAssigned", value: false },
    ])]),
  ],
  policy: policy({
    "Schedule Check": ["route", "returnTime"],
    "Budget Check": ["transportCost", "guideCost"],
    "People Check": ["participantExperienceReview", "attendanceConfirmation"],
    "Logistics Check": ["route", "pickupPoint", "transportVolunteer"],
    "Preparation Check": ["navigationConfirmed", "firstAidOwnerAssigned"],
    "Safety Check": ["weatherChecked", "guideRequirementKnown", "emergencyCommunicationConfirmed"],
  }, { "People Check": ["attendanceStatus"] }),
  constraints: [],
  proposal: { id: "hike_draft", label: "Route and conditions not selected", values: { route: null, eventDate: null, returnTime: null } },
  groundTruth: truth({
    confirmedFacts: ["Six event attendees are estimated, five are confirmed, and five active planners are in the Setvia room.", "The planning group includes two beginners and one experienced hiker whose input is not authoritative trail guidance.", "One participant can help with transport, but route and pickup are undecided."],
    tentativeFacts: ["No route, weather report, guide requirement, equipment list, or assigned first-aid owner is confirmed."],
    hardConstraints: ["Respect the early-return participant's deadline once the route and timing are known."],
    softPreferences: ["Use the experienced participant's input as perspective, not as a substitute for authoritative trail information."],
    knownContradictions: [],
    expectedFindings: [
      { id: "hike_route_missing", category: "Logistics Check", severity: "warning", criterion: "Route, pickup, and transport timing are not selected.", evidenceStatementIds: ["hike_transport"] },
      { id: "hike_conditions_unknown", category: "Safety Check", severity: "critical", criterion: "Weather and route conditions have not been checked; guide requirements are unknown.", evidenceStatementIds: ["hike_unknowns"] },
      { id: "hike_emergency_gap", category: "Safety Check", severity: "critical", criterion: "Navigation, emergency communication, and first-aid ownership are unconfirmed.", evidenceStatementIds: ["hike_unknowns"] },
      { id: "hike_prep_gap", category: "Preparation Check", severity: "warning", criterion: "Essential equipment and a named first-aid owner remain unconfirmed.", evidenceStatementIds: ["hike_unknowns"] },
    ],
    blindSpots: ["Actual route and official current conditions.", "Weather near the event date.", "Whether a guide is required or appropriate for the selected route.", "Emergency communications, navigation, first aid, suitable equipment, and return timing."],
    expectedQuestionTopics: ["Selected route and current authoritative conditions", "Weather and guide requirements", "Who confirms navigation, emergency communication, and first aid"],
    invalidCompromises: ["Treating unknown weather or route conditions as acceptable.", "Calling the hike safe or green based only on AI output.", "Assuming a guide is or is not required without evidence."],
    acceptableNegotiationDirections: ["Defer route selection until current route, weather, and relevant local guidance are checked.", "Consider a lower-risk alternative only after its conditions and participants' abilities are known."],
    stoppingConditions: ["Remain blocked while critical safety checks are unresolved, even if other category scores rise.", "Wait for route, conditions, equipment, and emergency answers; never claim safety."],
  }),
};

const kickoff: ScenarioFixture = {
  id: "C",
  title: "Professional Project Kickoff",
  eventType: "professional project kickoff",
  synthetic: true,
  seed: null,
  estimatedAttendeeCount: 14,
  confirmedAttendeeCount: null,
  roomParticipantCount: 6,
  requiredApproverIds: ["priya", "mateo", "ava", "eli", "sana", "colleague_6"],
  participants: [
    participant("priya", "Priya Rao", "project manager; required", [statement("kickoff_attendance", "Fourteen people are expected at the kickoff; the confirmed-attendee count has not been finalized. Only the six project planners are in this Setvia room.", [{ key: "estimatedAttendeeCount", value: 14, scope: "shared" }]), statement("kickoff_pm", "I'm only available after 3 PM Manila time and can attend for only 30 minutes.", [{ key: "pmTimezone", value: "Asia/Manila" }, { key: "pmAvailability", value: "after 15:00 local" }, { key: "pmDurationLimit", value: 30 }])], { timeZone: "Asia/Manila" }),
    participant("mateo", "Mateo Cruz", "technical lead; required", [statement("kickoff_tech", "I can attend before 4 PM Manila time; I have another meeting from 4 to 5 PM.", [{ key: "techTimezone", value: "Asia/Manila" }, { key: "techAvailability", value: "before 16:00 local" }])], { timeZone: "Asia/Manila" }),
    participant("ava", "Ava Reed", "external client; required", [statement("kickoff_client", "Our team is in New York. We can join only between 8 and 9 AM Eastern on Wednesday, November 4.", [{ key: "clientTimezone", value: "America/New_York" }, { key: "clientAvailability", value: "08:00–09:00 local on 2026-11-04" }])], { timeZone: "America/New_York" }),
    participant("eli", "Eli Park", "design lead", [statement("kickoff_online", "I can only attend online.", [{ key: "meetingFormat", value: "online" }])]),
    participant("sana", "Sana Wu", "scope owner", [statement("kickoff_scope", "We need at least 45 minutes to finalize project scope before Friday.", [{ key: "minimumScopeDuration", value: 45 }, { key: "scopeDeadline", value: "before Friday, 2026-11-06" }])]),
    ...Array.from({ length: 1 }, (_, index) => {
      const number = index + 6;
      const id = `colleague_${number}`;
      const statements = [
        `I can attend online after 1 PM Manila time; please send the agenda in advance.`,
        `I prefer an asynchronous scope review and can join only for the final 20 minutes.`,
        `I am available Wednesday morning in Singapore time.`,
        `I need the client time zone shown alongside any proposed time.`,
        `I can attend in person, but I cannot join remotely during my commute.`,
        `Please share a written decision log if I cannot attend the full kickoff.`,
        `I have a recurring meeting Wednesday afternoon; I can review scope asynchronously.`,
        `I can join online for 30 minutes, but the agenda should identify decisions needed.`,
        `I am flexible on format; the project manager and technical lead still need to attend.`,
      ][index]!;
      return participant(id, `Colleague ${number}`, "project contributor", [statement(`kickoff_${id}`, statements, [{ key: "meetingPreference", value: statements }])]);
    }),
  ],
  policy: policy({
    "Schedule Check": ["meetingTimeUTC", "meetingDuration", "scopeDeadline"],
    "Budget Check": ["meetingBudget"],
    "People Check": ["requiredAttendees", "attendanceConfirmation"],
    "Logistics Check": ["meetingFormat", "clientTimezone"],
    "Preparation Check": ["agenda", "scopeDecisionMaterials"],
    "Safety Check": [],
  }, { "People Check": ["attendanceStatus"] }),
  constraints: [
    { id: "pm_after_15_pht", owner: "priya", category: "Schedule Check", key: "startUtcHour", operator: "gte", expected: 7, hard: true },
    { id: "pm_30_minute_limit", owner: "priya", category: "Schedule Check", key: "durationMinutes", operator: "lte", expected: 30, hard: true },
    { id: "tech_before_16_pht", owner: "mateo", category: "Schedule Check", key: "startUtcHour", operator: "lte", expected: 8, hard: true },
    { id: "client_8am_utc_lower", owner: "ava", category: "Schedule Check", key: "startUtcHour", operator: "gte", expected: 13, hard: true },
    { id: "client_9am_utc_upper", owner: "ava", category: "Schedule Check", key: "startUtcHour", operator: "lte", expected: 14, hard: true },
    { id: "scope_minimum_45", owner: "sana", category: "Schedule Check", key: "durationMinutes", operator: "gte", expected: 45, hard: true },
    { id: "online_required", owner: "eli", category: "Logistics Check", key: "meetingFormat", operator: "eq", expected: "online", hard: true },
  ],
  proposal: { id: "kickoff_draft", label: "No feasible shared meeting slot confirmed", values: { startUtcHour: null, durationMinutes: null, meetingFormat: "online" } },
  groundTruth: truth({
    confirmedFacts: ["The project manager and technical lead are required.", "The client is in America/New_York; the meeting date is Wednesday 2026-11-04, after the US daylight saving transition.", "The project manager is available after 15:00 Asia/Manila for at most 30 minutes.", "The client is available 08:00–09:00 America/New_York, equivalent to 13:00–14:00 UTC on that date.", "The scope decision needs at least 45 minutes and is due before Friday 2026-11-06."],
    tentativeFacts: ["Several contributors prefer asynchronous or partial attendance."],
    hardConstraints: ["Start no earlier than 07:00 UTC for the project manager.", "Start no later than 08:00 UTC for the technical lead's available window.", "Start between 13:00 and 14:00 UTC for the client.", "Meeting duration must be at most 30 minutes for the project manager and at least 45 minutes for the required scope decision.", "Meeting format must be online."],
    softPreferences: ["Provide an agenda in advance and record decisions for partial attendees."],
    knownContradictions: ["Required attendees' UTC availability windows do not overlap.", "The required 45-minute scope decision exceeds the project manager's 30-minute limit."],
    expectedFindings: [
      { id: "kickoff_no_feasible_slot", category: "Schedule Check", severity: "critical", criterion: "Explain that the required people, client time zone, and duration constraints have no feasible shared slot.", evidenceStatementIds: ["kickoff_pm", "kickoff_tech", "kickoff_client", "kickoff_scope"] },
      { id: "kickoff_async_option", category: "People Check", severity: "warning", criterion: "Recommend a human decision about splitting the scope decision, reducing duration, or using asynchronous review.", evidenceStatementIds: ["kickoff_scope"] },
    ],
    blindSpots: ["A local time without a date and time zone is ambiguous.", "The agenda and decision materials are not ready.", "An asynchronous alternative still needs a named owner and deadline."],
    expectedQuestionTopics: ["Whether the required scope decision can be split or reviewed asynchronously", "Who can approve a change to duration or required attendance"],
    invalidCompromises: ["Any meeting time outside one of the required attendee windows.", "A 30-minute slot presented as sufficient for a required 45-minute decision.", "A time zone conversion that ignores the specific date."],
    acceptableNegotiationDirections: ["Do not propose an accepted time while constraints conflict.", "Offer asynchronous review or a split decision process for human consideration, with no invented calendar time."],
    stoppingConditions: ["Complete analysis with a human decision request once no feasible slot exists.", "Do not keep negotiating by inventing times; do not claim the plan is ready."],
  }),
};

function familyScenario(): ScenarioFixture {
  const people: ScenarioParticipant[] = [
    participant("mara", "Mara", "organizer", [statement("family_attendance", "Twenty-two relatives are invited; twenty have confirmed event attendance and two have not replied. Those two are not members of this Setvia room.", [{ key: "estimatedAttendeeCount", value: 22, scope: "shared" }, { key: "confirmedAttendeeCount", value: 20, scope: "shared" }]), statement("family_date", "Sunday works best for our household; please share the date before we book travel.", [{ key: "preferredDate", value: "Sunday preferred" }])]),
    participant("lola_ines", "Lola Ines", "older relative", [statement("family_seating", "I will need a nearby seat and restroom, and I prefer the weekend.", [{ key: "olderRelativeNeeds", value: "nearby seating and restroom" }, { key: "travelWindow", value: "weekend" }])]),
    participant("pablo", "Pablo", "parent", [statement("family_children", "We are bringing two young children; the venue needs a safe place for them to sit and rest.", [{ key: "childrenNeeds", value: "space suitable for young children" }])]),
    participant("ren", "Ren", "relative with accessibility need", [statement("family_access", "I need wheelchair-accessible facilities and a step-free route.", [{ key: "accessibilityNeed", value: "step-free route and wheelchair-accessible facilities" }])]),
    participant("tess", "Tess", "relative", [statement("family_private_1", "Please don't disclose why I need a different arrangement. I can only travel during the weekend. PRIVATE_FAMILY_REASON_A.", [], "listener_only")]),
    participant("niko", "Niko", "relative", [statement("family_budget_public", "I can't afford the proposed amount; I need a lower contribution option.", [{ key: "publicBudgetConcern", value: "cannot afford proposed amount; wants a lower contribution option" }])]),
    participant("suri", "Suri", "travels from another city", [statement("family_travel", "I can only travel during the weekend; please choose somewhere near public transportation.", [{ key: "travelWindow", value: "weekend" }, { key: "publicTransitPreference", value: true }])]),
    participant("bo", "Bo", "relative", [statement("family_transit", "Could we choose a location closer to public transportation?", [{ key: "publicTransitPreference", value: true }])]),
    participant("ada", "Ada", "parent", [statement("family_children_2", "A shaded area and changing facilities would help parents with young children.", [{ key: "childrenNeeds", value: "shade and changing facilities preferred" }])]),
    participant("eli_family", "Eli", "relative", [statement("family_budget", "I can contribute a small amount, but I don't know the final cost yet.", [{ key: "costUnknown", value: true }])]),
    participant("jo", "Jo", "relative", [statement("family_dates", "I prefer Saturday, but I could consider Sunday if travel is arranged.", [{ key: "preferredDate", value: "Saturday preferred; Sunday possible with travel" }])]),
    participant("min", "Min", "relative traveling from another city", [statement("family_arrival", "I need to arrive by train and would like the venue near the station.", [{ key: "publicTransitPreference", value: true }])]),
    participant("sol", "Sol", "relative", [statement("family_food", "Please list food costs separately from venue costs.", [{ key: "expenseTreatment", value: "itemize food separately" }])]),
    participant("dara", "Dara", "relative", [statement("family_food_2", "I can bring a dish if we agree on quantities and dietary needs.", [{ key: "foodOffer", value: true }])]),
    participant("yuri", "Yuri", "relative", [statement("family_date_2", "Sunday afternoon is best for me.", [{ key: "preferredDate", value: "Sunday afternoon" }])]),
    participant("lian", "Lian", "parent", [statement("family_transport", "We need space for a stroller and a short walk from the stop.", [{ key: "childrenNeeds", value: "stroller access and short walk" }])]),
    participant("noel", "Noel", "relative", [statement("family_private_2", "I cannot afford the proposed ₱1,500 amount. Please ask me privately what I can contribute. PRIVATE_FAMILY_BUDGET_B.", [], "listener_only")]),
    participant("cory", "Cory", "relative", [statement("family_budget_2", "I can spend more for a venue with convenient transport, but I want the price shown first.", [{ key: "costUnknown", value: "flexible if cost is shown first" }])]),
    participant("bea_family", "Bea", "older relative", [statement("family_access_2", "Please make sure there is a place to rest near the gathering.", [{ key: "olderRelativeNeeds", value: "rest area nearby" }])]),
    participant("kai_family", "Kai", "relative", [statement("family_role", "I can coordinate arrivals if someone shares the confirmed venue and schedule.", [{ key: "responsibilityOffer", value: "arrival coordination after venue and schedule are confirmed" }])]),
    participant("paz", "Paz", "relative", [] , { responseStatus: "no_response" }),
    participant("renzo", "Renzo", "relative", [] , { responseStatus: "no_response" }),
  ];
  return {
    id: "D",
    title: "Family Reunion",
    eventType: "family reunion",
    synthetic: true,
    seed: null,
    estimatedAttendeeCount: 22,
    confirmedAttendeeCount: 20,
    roomParticipantCount: 7,
    requiredApproverIds: ["mara", "lola_ines", "ren", "tess", "niko", "suri", "noel"],
    // The two event invitees who have not replied never joined Setvia, so they
    // are intentionally absent from room participants and approval IDs.
    participants: people.filter((person) =>
      ["mara", "lola_ines", "ren", "tess", "niko", "suri", "noel"].includes(person.id),
    ),
    policy: policy({
      "Schedule Check": ["confirmedDate", "travelWindow"],
      "Budget Check": ["sharedCostPlan", "publicBudgetConcern"],
      "People Check": ["accessibilityNeed", "childrenNeeds", "attendanceConfirmation"],
      "Logistics Check": ["venue", "publicTransitPreference"],
      "Preparation Check": ["foodOffer", "dietaryNeeds"],
      "Safety Check": ["venueSafetyDetails", "emergencyContact"],
    }, { "People Check": ["attendanceStatus"] }),
    constraints: [],
    proposal: { id: "family_draft", label: "Venue and contribution amount to confirm", values: { venue: null, contribution: 1500, date: null } },
    groundTruth: truth({
      confirmedFacts: ["Twenty-two relatives are invited; twenty have confirmed event attendance and two have not replied. The two nonresponders are not Setvia room participants.", "Seven planners are in the Setvia room, and only their IDs count toward room approvals.", "Ren has explicitly shared a step-free route and accessible-facility requirement.", "Several relatives need weekend travel, public transport, child-friendly space, or nearby rest areas."],
      tentativeFacts: ["Venue, transportation, final date, attendance, food, and contribution amounts remain unresolved."],
      hardConstraints: ["Do not describe a venue as accessible until the relevant details are confirmed.", "Do not disclose listener-only response text or its reason."],
      softPreferences: ["Weekend dates, public transport access, child-friendly facilities, and itemized costs."],
      knownContradictions: ["Saturday and Sunday preferences differ, but are not all hard conflicts."],
      expectedFindings: [
        { id: "family_access_unknown", category: "People Check", severity: "warning", criterion: "Confirm step-free access, accessible facilities, and travel route without claiming a venue is suitable in advance.", evidenceStatementIds: ["family_access"] },
        { id: "family_budget_range", category: "Budget Check", severity: "warning", criterion: "The proposed contribution is unaffordable for a participant; costs and lower-cost options need confirmation.", evidenceStatementIds: ["family_budget_public"] },
        { id: "family_travel_plan", category: "Logistics Check", severity: "warning", criterion: "Travel from other cities and proximity to public transport remain unresolved.", evidenceStatementIds: ["family_travel", "family_transit"] },
      ],
      blindSpots: ["No confirmed venue, date, cost breakdown, or attendance count.", "Accessibility should be verified with the venue and participant, not inferred from a label.", "A private listener result cannot silently become group evidence."],
      expectedQuestionTopics: ["Venue access details directly to Ren", "Whether Niko authorizes sharing a contribution range based on their public concern", "A general attendance and travel confirmation that does not refer to private responses"],
      privateStatementIds: ["family_private_1", "family_private_2"],
      invalidCompromises: ["Repeating either private response in group findings, questions, trace output, or Lab.", "A question that reveals the reason for a private arrangement.", "Calling the proposed amount affordable for everyone."],
      acceptableNegotiationDirections: ["Compare locations after access and transit details are confirmed.", "Show lower-cost and optional higher-cost paths without assigning a private budget to anyone.", "Ask for explicit authorization before sharing any participant-specific detail."],
      stoppingConditions: ["Wait for only the relevant participants' replies to targeted private questions.", "Do not treat missing responses as consent or confirmation."],
    }),
  };
}

const volunteerRoles = ["registration volunteer", "transport volunteer", "supplies volunteer", "setup volunteer", "student volunteer lead candidate"] as const;
const volunteerShifts = ["morning only", "afternoon only", "unavailable during the proposed event", "flexible if notified by Wednesday"] as const;
const volunteerNeeds = ["need a ride from north campus", "can drive but has only four passenger seats", "can bring water if someone confirms the drop-off", "can help set up but needs an assigned team lead", "can help online with sign-up tracking"] as const;

function mulberry32(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededIndex(random: () => number, length: number) {
  return Math.floor(random() * length);
}
function largeGroupStressScenario(): ScenarioFixture {
  const seed = 0x5e7a_2026;
  const random = mulberry32(seed);
  const people: ScenarioParticipant[] = [
    participant("student_01", "Student 01", "event organizer", [statement("volunteer_01", "I can attend the full event and handle registration, but no one has agreed to lead safety coverage.", [{ key: "registrationOwner", value: true }, { key: "safetyLeadAssigned", value: false }])]),
    participant("student_02", "Student 02", "transport volunteer", [statement("volunteer_02", "I can transport eight boxes, but I cannot provide a passenger vehicle.", [{ key: "supplyTransport", value: "eight boxes" }, { key: "passengerVehicleAvailable", value: false }])]),
    participant("student_03", "Student 03", "accessibility participant", [statement("volunteer_03", "I use a wheelchair and need a step-free route and accessible washroom. Please confirm the venue before we announce it.", [{ key: "accessibilityNeed", value: "step-free route and accessible washroom" }])]),
    participant("student_04", "Student 04", "venue liaison", [statement("volunteer_04", "I was told the main hall lift works, so I believe it is accessible.", [{ key: "venueAccessStatus", value: "assumed accessible", scope: "shared" }])]),
    participant("student_05", "Student 05", "venue volunteer", [statement("volunteer_05", "I have not verified the lift or route; please do not announce the hall as accessible yet.", [{ key: "venueAccessStatus", value: "not verified", scope: "shared" }])]),
    participant("student_06", "Student 06", "budget volunteer", [statement("volunteer_06", "I believe the supply budget is ₱80 per person, not including lunch.", [{ key: "costModel", value: "₱80 per person excluding lunch", scope: "shared" }])]),
    participant("student_07", "Student 07", "budget volunteer", [statement("volunteer_07", "I heard the budget was ₱100 per person including lunch; that may be a different assumption.", [{ key: "costModel", value: "₱100 per person including lunch", scope: "shared" }])]),
    participant("student_08", "Student 08", "morning volunteer", [statement("volunteer_08", "I can volunteer only in the morning.", [{ key: "shiftPreference", value: "morning only" }])]),
    participant("student_09", "Student 09", "afternoon volunteer", [statement("volunteer_09", "I can volunteer only in the afternoon.", [{ key: "shiftPreference", value: "afternoon only" }])]),
    participant("student_10", "Student 10", "unavailable volunteer", [statement("volunteer_10", "I am unavailable on the proposed Saturday.", [{ key: "availability", value: "unavailable Saturday" }])]),
    participant("student_11", "Student 11", "volunteer", [statement("volunteer_11", "No one has agreed to lead the afternoon team.", [{ key: "afternoonLeadAssigned", value: false }])]),
    participant("student_12", "Student 12", "first aid volunteer", [statement("volunteer_12", "I can bring a first-aid kit, but I am not trained to own the event safety plan.", [{ key: "firstAidKitOffer", value: true }, { key: "safetyLeadAssigned", value: false }])]),
  ];
  for (let number = 13; number <= 52; number++) {
    const id = `student_${String(number).padStart(2, "0")}`;
    const shift = volunteerShifts[seededIndex(random, volunteerShifts.length)]!;
    const need = volunteerNeeds[seededIndex(random, volunteerNeeds.length)]!;
    const role = volunteerRoles[seededIndex(random, volunteerRoles.length)]!;
    const responseStatus = number <= 17 ? "unconfirmed" : "confirmed";
    const attendance = responseStatus === "confirmed";
    const text = attendance
      ? `I can volunteer ${shift}; I ${need}. Please confirm the event time and who is leading my team.`
      : `I might attend if the timing works; I can volunteer ${shift}, and I ${need}. Please confirm the event time first.`;
    people.push(participant(id, `Student ${String(number).padStart(2, "0")}`, role, [statement(`volunteer_${String(number).padStart(2, "0")}`, text, [
      { key: `availability_${number}`, value: shift, confirmed: attendance },
      { key: `responsibility_${number}`, value: role, confirmed: attendance },
    ], "group", attendance)], { responseStatus }));
  }
  for (let number = 53; number <= 58; number++) {
    const id = `student_${number}`;
    people.push(participant(id, `Student ${String(number).padStart(2, "0")}`, "volunteer", [], { responseStatus: "no_response" }));
  }
  return {
    id: "E_STRESS",
    title: "University Volunteer Event — 58 active planner stress test",
    eventType: "university volunteer event",
    synthetic: true,
    seed,
    estimatedAttendeeCount: 58,
    confirmedAttendeeCount: 47,
    roomParticipantCount: 58,
    requiredApproverIds: people.map((person) => person.id),
    participants: people,
    policy: policy({
      "Schedule Check": ["eventTime", "shiftLeads"],
      "Budget Check": ["costModel", "contributionScope"],
      "People Check": ["venueAccessStatus", "attendanceStatus", "teamLeads"],
      "Logistics Check": ["ridePlan", "accessibleVenue"],
      "Preparation Check": ["supplyOwner", "firstAidOwner"],
    "Safety Check": ["safetyLead", "emergencyPlan"],
    }, { "People Check": ["attendanceStatus"] }),
    constraints: [],
    proposal: { id: "volunteer_draft", label: "Saturday event draft; shifts, venue, and leads unconfirmed", values: { eventDay: "Saturday", eventTime: null, venueAccessStatus: null } },
    groundTruth: truth({
      confirmedFacts: ["The fixture contains 58 distinct fictional students with stable IDs and consent metadata.", "Several students explicitly need rides, have shift limits, or offer responsibilities.", "Some attendances are confirmed, some are tentative, and six participants have not responded."],
      tentativeFacts: ["The proposed event time and venue are unverified; a response does not itself confirm attendance unless the participant said so."],
      hardConstraints: ["Respect any explicitly unavailable schedule and accessibility requirement; verify before publishing a venue plan.", "Do not infer attendance, supply ownership, or team leadership for nonrespondents or tentative respondents."],
      softPreferences: ["Morning-only and afternoon-only preferences, transport requests, and role offers must remain attributable to their authors."],
      knownContradictions: ["Two different per-person cost assumptions include different lunch treatment.", "The main hall is described as accessible by assumption and as unverified by another participant."],
      expectedFindings: [
        { id: "volunteer_cost_conflict", category: "Budget Check", severity: "warning", criterion: "Show the ₱80 excluding-lunch and ₱100 including-lunch claims as incompatible assumptions, not confirmed quotes.", evidenceStatementIds: ["volunteer_06", "volunteer_07"] },
        { id: "volunteer_access_conflict", category: "People Check", severity: "critical", criterion: "Treat accessibility as unresolved because a claim of access conflicts with an explicit unverified warning; do not label the venue accessible.", evidenceStatementIds: ["volunteer_04", "volunteer_05", "volunteer_03"] },
        { id: "volunteer_shift_conflict", category: "Schedule Check", severity: "warning", criterion: "Morning-only, afternoon-only, unavailable, and flexible responses cannot all be assigned to one shift.", evidenceStatementIds: ["volunteer_08", "volunteer_09", "volunteer_10"] },
        { id: "volunteer_lead_gaps", category: "People Check", severity: "warning", criterion: "Safety and afternoon team leads are not assigned; an offer to bring a first-aid kit is not ownership of safety planning.", evidenceStatementIds: ["volunteer_01", "volunteer_11", "volunteer_12"] },
      ],
      blindSpots: ["No confirmed team leads for the afternoon team or safety coverage.", "No confirmed accessible venue route or washroom.", "No final event schedule, assigned transportation, or complete attendee count.", "Supply and first-aid ownership, emergency arrangements, and budget scope are unclear."],
      expectedQuestionTopics: ["Confirm venue access with the venue and the participant who needs it", "Confirm leaders for each shift and safety responsibilities", "Resolve whether food is included in the budget", "Ask only the nonresponders for attendance, without assuming yes"],
      invalidCompromises: ["Assuming the main hall is accessible.", "Treating unconfirmed attendance as confirmed.", "Combining the ₱80 and ₱100 budgets as if they described the same scope.", "Assigning safety ownership to someone who only offered to bring a kit."],
      acceptableNegotiationDirections: ["Aggregate by constraints and responsibilities while retaining author attribution.", "Offer separate morning and afternoon teams only after checking leaders and event timing.", "Ask for one confirmed budget definition and a named safety lead."],
      stoppingConditions: ["Keep readiness blocked while the critical accessibility claim is unresolved.", "Ask targeted questions for minority constraints and do not send one model call per participant.", "Stop after at most one analysis plus the minimal question flow; never silently truncate the group."],
    }),
  };
}

function volunteerScenario(): ScenarioFixture {
  const seed = 0x5e7a_2026;
  const participants: ScenarioParticipant[] = [
    participant("student_01", "Student 01", "event organizer", [
      statement("volunteer_attendance", "We estimate 58 event attendees and have 47 attendance confirmations. Only the seven committee planners are members of this Setvia room; one planner has not answered the current planning check.", [
        { key: "estimatedAttendeeCount", value: 58, scope: "shared" },
        { key: "confirmedAttendeeCount", value: 47, scope: "shared" },
        { key: "roomPlannerPendingResponseCount", value: 1, scope: "shared" },
      ]),
      statement("volunteer_01", "I can handle registration, but nobody has agreed to lead safety coverage.", [{ key: "registrationOwner", value: true }, { key: "safetyLeadAssigned", value: false }]),
    ]),
    participant("student_02", "Student 02", "transport volunteer", [
      statement("volunteer_02", "I can transport eight boxes, but I cannot provide a passenger vehicle. I am only available in the morning.", [{ key: "supplyTransport", value: "eight boxes" }, { key: "passengerVehicleAvailable", value: false }, { key: "shiftPreference", value: "morning only" }]),
    ]),
    participant("student_03", "Student 03", "accessibility participant", [
      statement("volunteer_03", "I use a wheelchair and need a step-free route and accessible washroom. Please confirm the venue before we announce it.", [{ key: "accessibilityNeed", value: "step-free route and accessible washroom" }]),
    ]),
    participant("student_04", "Student 04", "venue liaison", [
      statement("volunteer_04", "I was told the main hall lift works, so I believe it is accessible.", [{ key: "venueAccessStatus", value: "assumed accessible", scope: "shared" }], "group", false),
    ]),
    participant("student_05", "Student 05", "venue and budget volunteer", [
      statement("volunteer_05", "I have not verified the lift or route; please do not announce the hall as accessible yet. I believe the budget is ₱80 per person, excluding lunch, and I can only take an afternoon shift.", [
        { key: "venueAccessStatus", value: "not verified", scope: "shared" },
        { key: "costModel", value: "₱80 per person excluding lunch", scope: "shared" },
        { key: "shiftPreference", value: "afternoon only" },
      ]),
    ]),
    participant("student_06", "Student 06", "budget and supplies volunteer", [
      statement("volunteer_06", "I heard the budget was ₱100 per person including lunch; that may be a different assumption. I can bring a first-aid kit, but I am not trained to own the event safety plan.", [
        { key: "costModel", value: "₱100 per person including lunch", scope: "shared" },
        { key: "firstAidKitOffer", value: true },
        { key: "safetyLeadAssigned", value: false },
      ]),
    ]),
    participant("student_07", "Student 07", "committee planner awaiting a response", [], { responseStatus: "no_response" }),
  ];
  return {
    id: "E",
    title: "University Volunteer Event",
    eventType: "university volunteer event",
    synthetic: true,
    seed,
    estimatedAttendeeCount: 58,
    confirmedAttendeeCount: 47,
    roomParticipantCount: 7,
    requiredApproverIds: participants.map((person) => person.id),
    participants,
    policy: policy({
      "Schedule Check": ["eventTime", "shiftLeads"],
      "Budget Check": ["costModel", "contributionScope"],
      "People Check": ["venueAccessStatus", "attendanceStatus", "teamLeads"],
      "Logistics Check": ["ridePlan", "accessibleVenue"],
      "Preparation Check": ["supplyOwner", "firstAidOwner"],
      "Safety Check": ["safetyLead", "emergencyPlan"],
    }, { "People Check": ["attendanceStatus"] }),
    constraints: [],
    proposal: {
      id: "volunteer_draft",
      label: "Saturday event draft; shifts, venue, and leads unconfirmed",
      values: { eventDay: "Saturday", eventTime: null, venueAccessStatus: null },
    },
    groundTruth: truth({
      confirmedFacts: [
        "The event estimate is 58 attendees and 47 have confirmed attendance.",
        "Seven actual committee planners are in the room; six have responded to the planning check and one has not.",
        "The accessibility need, transport limit, two shift windows, and two different budget-scope claims are explicitly represented by committee inputs.",
      ],
      tentativeFacts: ["The hall accessibility claim is an unverified belief; the route, budget definition, schedule, and leadership remain unresolved."],
      hardConstraints: ["Do not announce the hall as accessible before verifying its route, lift, and washroom.", "Do not infer a response, attendance, shift assignment, transport capacity, or safety lead from a nonresponse or offer."],
      softPreferences: ["Keep personal availability and responsibilities tied to their owners; treat the event estimate separately from room membership."],
      knownContradictions: ["The main hall is described as accessible by an unverified assumption and as not yet verified.", "The ₱80 excluding-lunch and ₱100 including-lunch statements may represent different budget scopes."],
      expectedFindings: [
        { id: "volunteer_cost_conflict", category: "Budget Check", severity: "warning", criterion: "Show the ₱80 excluding-lunch and ₱100 including-lunch claims as incompatible assumptions, not as one confirmed budget.", evidenceStatementIds: ["volunteer_05", "volunteer_06"] },
        { id: "volunteer_access_conflict", category: "People Check", severity: "critical", criterion: "Treat accessibility as unresolved because an unverified access belief conflicts with an explicit warning; do not label the venue accessible.", evidenceStatementIds: ["volunteer_03", "volunteer_04", "volunteer_05"] },
        { id: "volunteer_shift_conflict", category: "Schedule Check", severity: "warning", criterion: "Morning-only and afternoon-only availability cannot both be assigned to one shift.", evidenceStatementIds: ["volunteer_02", "volunteer_05"] },
        { id: "volunteer_lead_gaps", category: "People Check", severity: "warning", criterion: "Safety ownership remains unassigned; bringing a first-aid kit is not safety-plan ownership, and one actual room planner has not responded.", evidenceStatementIds: ["volunteer_01", "volunteer_06"] },
      ],
      blindSpots: ["No confirmed accessible venue route or washroom.", "No final event schedule, passenger transport, or shift leads.", "Budget scope and lunch inclusion are unresolved.", "Safety ownership, emergency arrangements, and supply handoff are unclear.", "One actual room planner has not answered; event invitees who are not room members are not counted as room nonresponders."],
      expectedQuestionTopics: ["Confirm venue access with the venue and the participant who needs it", "Ask the nonresponding room planner for the needed planning input without naming absent event invitees", "Confirm the budget definition and whether lunch is included", "Assign a safety lead and shift leads"],
      invalidCompromises: ["Assuming the main hall is accessible.", "Treating the one room nonresponse as a missing response from all 58 attendees.", "Treating an event attendee who never joined Setvia as a room member or required approver.", "Combining the ₱80 and ₱100 budgets as if they have the same scope.", "Assigning safety ownership to someone who only offered to bring a kit."],
      acceptableNegotiationDirections: ["Keep venue access unresolved pending direct verification.", "Offer separate morning and afternoon teams only after checking leads and event timing.", "Ask for one confirmed budget definition and a named safety lead."],
      stoppingConditions: ["Keep readiness blocked while the critical accessibility claim is unresolved.", "Ask targeted questions only of actual room members; do not silently truncate or create one call per event attendee."],
    }),
  };
}

export function getScenario(id: ScenarioId): ScenarioFixture {
  const selected = id === "A" ? beach : id === "B" ? hiking : id === "C" ? kickoff : id === "D" ? familyScenario() : id === "E" ? volunteerScenario() : largeGroupStressScenario();
  return structuredClone(selected);
}
export const SCENARIO_IDS: readonly ScenarioId[] = ["A", "B", "C", "D", "E"];

export function validateScenarioFixture(scenario: ScenarioFixture) {
  if (scenario.participants.length > 100) throw new Error("SCENARIO_PARTICIPANT_LIMIT");
  if (new Set(scenario.participants.map((p) => p.id)).size !== scenario.participants.length)
    throw new Error("DUPLICATE_SCENARIO_PARTICIPANT");
  const statements = scenario.participants.flatMap((p) => p.statements);
  if (new Set(statements.map((s) => s.id)).size !== statements.length)
    throw new Error("DUPLICATE_SCENARIO_STATEMENT");
  const participantIds = new Set(scenario.participants.map((person) => person.id));
  if (scenario.roomParticipantCount !== scenario.participants.length)
    throw new Error("ROOM_PARTICIPANT_COUNT_MISMATCH");
  if (scenario.estimatedAttendeeCount < 0 || (scenario.confirmedAttendeeCount !== null && scenario.confirmedAttendeeCount > scenario.estimatedAttendeeCount))
    throw new Error("EVENT_ATTENDANCE_COUNT_INVALID");
  if (new Set(scenario.requiredApproverIds).size !== scenario.requiredApproverIds.length || scenario.requiredApproverIds.some((id) => !participantIds.has(id)))
    throw new Error("REQUIRED_APPROVER_NOT_IN_ROOM");
  if (scenario.requiredApproverIds.length !== scenario.roomParticipantCount)
    throw new Error("UNANIMOUS_APPROVER_SET_INCOMPLETE");
  if (scenario.participants.some((person) => (person.roomResponseStatus === "responded") !== (person.statements.length > 0)))
    throw new Error("ROOM_RESPONSE_STATUS_MISMATCH");
  if (scenario.id === "E" && (scenario.estimatedAttendeeCount !== 58 || scenario.roomParticipantCount !== 7 || scenario.confirmedAttendeeCount !== 47 || scenario.participants.filter((person) => person.responseStatus === "no_response").length !== 1))
    throw new Error("VOLUNTEER_ATTENDANCE_FIXTURE_INCOMPLETE");
  if (scenario.id === "E_STRESS" && (scenario.participants.length !== 58 || statements.length !== 52 || scenario.seed !== 0x5e7a_2026))
    throw new Error("LARGE_GROUP_STRESS_FIXTURE_INCOMPLETE");
  if (scenario.policy.length !== 6 || new Set(scenario.policy.map((entry) => entry.category)).size !== 6)
    throw new Error("SCENARIO_CATEGORY_POLICY_INVALID");
  if (scenario.constraints.some((constraint) => !scenario.participants.some((p) => p.id === constraint.owner)))
    throw new Error("UNKNOWN_CONSTRAINT_OWNER");
  if (statements.some((s) => s.audience === "group" && s.consent !== "explicit_group" || s.audience === "listener_only" && s.consent !== "listener_only"))
    throw new Error("SCENARIO_CONSENT_METADATA_INVALID");
  return { participants: scenario.participants.length, statements: statements.length };
}

