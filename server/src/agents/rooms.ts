import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import {
  RoomSchema,
  FactSchema,
  Roles,
  MAX_ROOM_PARTICIPANTS,
  ConstraintSchema,
  PolicySchema,
  OptionSchema,
  type Auth,
  type FactInput,
  type PolicyInput,
  type Room,
  type PlanOption,
  type ConstraintInput,
  type RoomActivity,
  type RoomResponse,
} from "./contracts.js";
import { RoomStore, StateError } from "./store.js";
import { ReviewedDraftKeySchema } from "../../../shared/room-api.js";
export const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const GROUP_RESPONSE_CONTEXT_LIMIT = 6;
export const groupResponseEvidenceId = (messageId: string) =>
  `groupmsg_${digest(messageId).slice(0, 32)}`;
export const currentGroupResponses = (room: Room) => room.responses.filter(
  (response) => response.visibility === "group" && response.proposalVersion === room.proposalVersion,
);
const secret = () => randomBytes(32).toString("hex");
export function authorize(room: Room, auth: Auth) {
  const participant = room.participants.find(
    (p) => p.id === auth.participantId,
  );
  const actual = Buffer.from(digest(auth.token), "hex");
  if (
    !participant ||
    !timingSafeEqual(actual, Buffer.from(participant.tokenHash, "hex"))
  )
    throw new StateError("UNAUTHORIZED");
  return participant;
}
export function sharedContext(room: Room) {
  return {
    eventType: room.eventType,
    attendance: {
      estimatedAttendeeCount: room.estimatedAttendeeCount ?? null,
      confirmedAttendeeCount: room.confirmedAttendeeCount ?? null,
      roomParticipantCount: room.participants.length,
      // The current product rule is unanimous approval by joined planners.
      // Event attendees who have not joined are never added to this list.
      requiredApproverIds: room.participants.map((participant) => participant.id),
    },
    revision: room.revision,
    proposalVersion: room.proposalVersion,
    participants: room.participants.map((p) => ({
      id: p.id,
      name: p.name,
      publicTargetingAllowed: p.publicTargetingConsent,
    })),
    // Only messages participants explicitly shared with the group enter model
    // context. Keep a small tail; older confirmed details live in facts and the
    // full transcript remains available in the room projection.
    groupResponses: currentGroupResponses(room)
      .slice(-GROUP_RESPONSE_CONTEXT_LIMIT)
      .map((response) => ({
        evidenceId: groupResponseEvidenceId(response.id),
        ownerId: response.ownerId,
        proposalVersion: response.proposalVersion,
        questionId: response.questionId,
        replyOption: response.replyOption,
        confirmed: false,
        text: response.text,
      })),
    facts: room.facts.filter((f) => f.visibility === "group"),
    policy: room.policy,
    constraints: room.constraints.filter((constraint) => constraint.visibility === "group"),
    proposal: room.proposal,
  };
}
type ActivityInput = Pick<
  RoomActivity,
  "kind" | "actorId" | "summary" | "category"
> & Partial<Pick<RoomActivity, "visibility" | "targetId">>;
type SubmitRoomInput = {
  messageId: string;
  expectedRevision: number;
  proposalVersion: number;
  text: string;
  visibility: "group" | "private";
  questionId: string | null;
  replyOption: string | null;
};

function addActivity(room: Room, input: ActivityInput) {
  const activity = {
    id: randomUUID(),
    kind: input.kind,
    revision: room.revision,
    proposalVersion: room.proposalVersion,
    occurredAt: new Date().toISOString(),
    actorId: input.actorId,
    summary: input.summary,
    category: input.category,
    visibility: input.visibility ?? "group",
    targetId: input.targetId ?? null,
  } satisfies RoomActivity;
  room.activity = [...room.activity, activity].slice(-100);
}
export class RoomService {
  constructor(
    readonly store: RoomStore,
    private onGroupChange: (id: string) => void = () => {},
    private onPrivateChange: (id: string, ownerId: string) => void = () => {},
  ) {}
  private bumpGroup(room: Room) {
    room.revision++;
    room.publicSequence++;
    room.eventSequence++;
  }
  private bumpPrivate(room: Room, ownerId: string) {
    room.privateRevisions[ownerId] = (room.privateRevisions[ownerId] ?? 0) + 1;
    room.privateSequences[ownerId] = (room.privateSequences[ownerId] ?? 0) + 1;
    room.eventSequence++;
  }
  async acceptReviewedDraft(roomId: string, auth: Auth, keys: string[]) {
    await this.store.transaction(roomId, (room) => {
      if (!room) throw new StateError("ROOM_NOT_FOUND");
      authorize(room, auth);
      if (room.lastCycle || room.responses.length || room.participants.length !== 1)
        throw new StateError("STALE_STATE");
      for (const key of new Set(keys.map((key) => ReviewedDraftKeySchema.parse(key)))) {
        const value = room.proposal.values[key];
        if (value === undefined || value === null || value === "") continue;
        room.facts.push(FactSchema.parse({ id: randomUUID(), key, value,
          ownerId: auth.participantId, visibility: "group", scope: "shared", confirmed: true }));
      }
      // These describe the organizer's reviewed draft, not participant approval.
      if (keys.length) this.bumpGroup(room);
    });
  }

  async queueAnalysis(roomId: string, auth: Auth, expectedRevision?: number) {
    const queued = await this.store.transaction(roomId, (room) => {
      if (!room) throw new StateError("ROOM_NOT_FOUND");
      authorize(room, auth);
      if (expectedRevision !== undefined && expectedRevision !== room.revision + (room.privateRevisions[auth.participantId] ?? 0))
        throw new StateError("STALE_STATE");
      if (room.activeCycleId || room.analysisStatus === "queued") return false;
      if (expectedRevision === undefined && room.lastCycle) return false;
      if (expectedRevision !== undefined && room.lastCycle?.outcome !== "BLOCKED")
        throw new StateError("ANALYSIS_NOT_BLOCKED");
      room.analysisStatus = "queued";
      this.bumpGroup(room);
      return true;
    });
    if (queued) this.onGroupChange(roomId);
    return queued;
  }
  async queuePrivateAnswerFollowUp(roomId: string, ownerId: string) {
    const queued = await this.store.transaction(roomId, (room) => {
      if (!room || !room.participants.some((participant) => participant.id === ownerId))
        throw new StateError("UNAUTHORIZED");
      if (room.activeCycleId || room.analysisStatus !== "complete" ||
          room.lastCycle?.outcome !== "WAIT_FOR_PARTICIPANT" || room.lastCycle.baseRevision !== room.revision)
        return false;
      const answered = room.privateAnalyses.filter((analysis) => {
        if (analysis.ownerId !== ownerId || analysis.sharedFollowUpQueued ||
            analysis.proposalVersion !== room.proposalVersion || analysis.cycle.outcome !== "COMPLETED") return false;
        const response = room.responses.find((entry) => entry.id === analysis.sourceMessageId &&
          entry.ownerId === ownerId && entry.visibility === "private" && entry.proposalVersion === room.proposalVersion);
        return response?.questionId && room.lastCycle!.questions.some((question) =>
          question.id === response.questionId && question.visibility === "private" && question.targetId === ownerId);
      });
      if (!answered.length) return false;
      for (const analysis of answered) analysis.sharedFollowUpQueued = true;
      // Only the workflow resumes. No private text, candidate, fact, proposal
      // version, approval, readiness value or public revision is promoted.
      room.analysisStatus = "queued";
      room.publicSequence++;
      room.eventSequence++;
      return true;
    });
    if (queued) this.onGroupChange(roomId);
    return queued;
  }

  async create(
    eventType: string,
    policy: PolicyInput,
    proposal: PlanOption,
    attendance: {
      estimatedAttendeeCount: number | null;
      confirmedAttendeeCount: number | null;
    } = { estimatedAttendeeCount: null, confirmedAttendeeCount: null },
    options: { syntheticDemo?: boolean } = {},
  ) {
    if (
      attendance.estimatedAttendeeCount != null &&
      attendance.confirmedAttendeeCount != null &&
      attendance.confirmedAttendeeCount > attendance.estimatedAttendeeCount
    )
      throw new StateError("INVALID_ATTENDEE_COUNTS");
    const invitation = secret();
    const room = RoomSchema.parse({
      schemaVersion: 1,
      id: randomUUID(),
      eventSequence: 0,
      publicSequence: 0,
      revision: 0,
      analysisStatus: "idle",
      eventType,
      syntheticDemo: options.syntheticDemo ?? false,
      estimatedAttendeeCount: attendance.estimatedAttendeeCount,
      confirmedAttendeeCount: attendance.confirmedAttendeeCount,
      invitationHash: digest(invitation),
      participants: [],
      policy: PolicySchema.parse(policy),
      constraints: [],
      facts: [],
      candidates: [],
      proposal: OptionSchema.parse(proposal),
      proposalVersion: 1,
      approvals: {},
      pendingInputs: [],
      responses: [],
      activity: [],
      readinessHistory: [],
      questions: [],
      options: [],
      readiness: null,
      lastCycle: null,
      activeCycleId: null,
      lifetimeAttempts: 0,
      lifetimeReservedTokens: 0,
      lifetimeReservedCostMicros: 0,
    });
    await this.store.create(room);
    return { roomId: room.id, invitation };
  }
  async join(roomId: string, invitation: string, name: string) {
    const token = secret();
    const participantId = randomUUID();
    await this.store.transaction(roomId, (room) => {
      if (
        !room ||
        !timingSafeEqual(
          Buffer.from(digest(invitation), "hex"),
          Buffer.from(room.invitationHash, "hex"),
        )
      )
        throw new StateError("UNAUTHORIZED");
      if (room.participants.length >= MAX_ROOM_PARTICIPANTS)
        throw new StateError("PARTICIPANT_LIMIT");
      room.participants.push({
        id: participantId,
        name: z.string().trim().min(1).max(40).parse(name),
        tokenHash: digest(token),
        publicTargetingConsent: false,
      });
      room.activeCycleId = null;
      room.analysisStatus = "idle";
      this.bumpGroup(room);
      addActivity(room, {
        kind: "participant_joined",
        actorId: participantId,
        summary: `${room.participants.at(-1)!.name} joined the planning room.`,
        category: null,
      });
    });
    this.onGroupChange(roomId);
    return { participantId, token };
  }
  async update(
    roomId: string,
    auth: Auth,
    expectedRevision: number,
    action: (room: Room) => void,
  ) {
    await this.store.transaction(roomId, (room) => {
      if (!room) throw new StateError("ROOM_NOT_FOUND");
      authorize(room, auth);
      const viewerRevision = room.revision + (room.privateRevisions[auth.participantId] ?? 0);
      if (viewerRevision !== expectedRevision)
        throw new StateError("STALE_STATE");
      action(room);
      room.activeCycleId = null;
      room.analysisStatus = "idle";
      RoomSchema.parse(room);
      this.bumpGroup(room);
    });
    this.onGroupChange(roomId);
  }
  async submit(roomId: string, auth: Auth, input: SubmitRoomInput): Promise<{ receipt: RoomResponse; duplicate: boolean }>;
  async submit(roomId: string, auth: Auth, revision: number, text: string, questionId?: string): Promise<{ receipt: RoomResponse; duplicate: boolean }>;
  async submit(
    roomId: string,
    auth: Auth,
    supplied: SubmitRoomInput | number,
    legacyText?: string,
    legacyQuestionId?: string,
  ): Promise<{ receipt: RoomResponse; duplicate: boolean }> {
    let input: SubmitRoomInput;
    if (typeof supplied === "number") {
      const room = await this.store.read(roomId);
      authorize(room, auth);
      const question = legacyQuestionId
        ? room.questions.find((candidate) => candidate.id === legacyQuestionId)
        : undefined;
      input = {
        messageId: randomUUID(),
        expectedRevision: supplied,
        proposalVersion: room.proposalVersion,
        text: legacyText ?? "",
        visibility: question?.visibility ?? "private",
        questionId: legacyQuestionId ?? null,
        replyOption: null,
      };
    } else input = supplied;
    const parsedMessage = z
      .object({
        messageId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
        expectedRevision: z.number().int().nonnegative(),
        proposalVersion: z.number().int().positive(),
        text: z.string().trim().min(1).max(1_000),
        visibility: z.enum(["group", "private"]),
        questionId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).nullable(),
        replyOption: z.string().min(1).max(160).nullable(),
      })
      .strict()
      .parse(input);
    const result = await this.store.transaction(roomId, (room) => {
      if (!room) throw new StateError("ROOM_NOT_FOUND");
      authorize(room, auth);
      const prior = room.responses.find((item) => item.id === parsedMessage.messageId);
      if (prior) {
        if (prior.ownerId !== auth.participantId)
          throw new StateError("DUPLICATE_MESSAGE_ID");
        return { receipt: structuredClone(prior), duplicate: true };
      }
      // Revision-only conflicts can arise when two people send together. Accept
      // either contribution if it still targets the same proposal version.
      if (
        parsedMessage.expectedRevision >
          room.revision + (room.privateRevisions[auth.participantId] ?? 0) ||
        parsedMessage.proposalVersion !== room.proposalVersion
      )
        throw new StateError("STALE_STATE");
      let question: Room["questions"][number] | undefined;
      if (parsedMessage.questionId !== null) {
        question = room.questions.find((q) => q.id === parsedMessage.questionId);
        if (!question || (question.targetId && question.targetId !== auth.participantId))
          throw new StateError("UNAUTHORIZED_ANSWER");
        if (question.visibility === "private" && parsedMessage.visibility !== "private")
          throw new StateError("PRIVATE_ANSWER_REQUIRED");
        if (
          parsedMessage.replyOption !== null &&
          !question.options.includes(parsedMessage.replyOption)
        )
          throw new StateError("INVALID_REPLY_OPTION");
        if (parsedMessage.replyOption !== null && parsedMessage.text !== parsedMessage.replyOption)
          throw new StateError("INVALID_REPLY_OPTION");
      } else if (parsedMessage.replyOption !== null) {
        throw new StateError("REPLY_WITHOUT_QUESTION");
      }
      const queue = parsedMessage.visibility === "group"
        ? room.pendingInputs
        : room.privatePendingInputs;
      if (queue.length >= (parsedMessage.visibility === "group" ? 50 : 100))
        throw new StateError("INPUT_QUEUE_LIMIT");
      if (room.responses.length >= 500) throw new StateError("RESPONSE_LIMIT");
      const receipt = {
        id: parsedMessage.messageId,
        ownerId: auth.participantId,
        visibility: parsedMessage.visibility,
        text: parsedMessage.text,
        questionId: parsedMessage.questionId,
        replyOption: parsedMessage.replyOption,
        proposalVersion: room.proposalVersion,
        occurredAt: new Date().toISOString(),
      } satisfies RoomResponse;
      queue.push({
        id: randomUUID(),
        actorId: auth.participantId,
        messageId: parsedMessage.messageId,
        text: parsedMessage.text,
        visibility: parsedMessage.visibility,
        questionId: parsedMessage.questionId,
        replyOption: parsedMessage.replyOption,
      });
      room.responses.push(receipt);
      // A private reply to a group question remains personal and must not
      // consume the shared question. Matching-audience answers close it.
      if (question && parsedMessage.visibility === question.visibility)
        room.questions = room.questions.filter((q) => q.id !== question!.id);
      if (parsedMessage.visibility === "group") {
        room.activeCycleId = null;
        room.analysisStatus = "queued";
        this.bumpGroup(room);
      } else {
        room.privateAnalysisStatus[auth.participantId] = "queued";
        this.bumpPrivate(room, auth.participantId);
      }
      const participant = room.participants.find((p) => p.id === auth.participantId)!;
      addActivity(room, {
        kind: "participant_responded",
        actorId: auth.participantId,
        summary: parsedMessage.visibility === "private"
          ? "Your private response was recorded."
          : `${participant.name} responded to the room.`,
        category: null,
        visibility: parsedMessage.visibility,
        targetId: parsedMessage.visibility === "private" ? auth.participantId : null,
      });
      RoomSchema.parse(room);
      return { receipt, duplicate: false };
    });
    if (!result.duplicate) {
      if (parsedMessage.visibility === "group") this.onGroupChange(roomId);
      else this.onPrivateChange(roomId, auth.participantId);
    }
    return result;
  }
  async confirmFact(roomId: string, auth: Auth, revision: number, fact: FactInput) {
    const parsed = FactSchema.parse(fact);
    const isOrWasGroup = await this.store.read(roomId).then((room) =>
      room.facts.some((item) => item.id === parsed.id && item.visibility === "group") ||
      parsed.visibility === "group",
    );
    const update = isOrWasGroup ? this.update.bind(this) : this.updatePrivate.bind(this);
    return update(roomId, auth, revision, (room) => {
      if (parsed.ownerId !== auth.participantId)
        throw new StateError("UNAUTHORIZED");
      const old = room.facts.find((f) => f.id === parsed.id);
      if (old && old.ownerId !== auth.participantId)
        throw new StateError("UNAUTHORIZED");
      room.facts = [
        ...room.facts.filter((f) => f.id !== parsed.id),
        { ...parsed, confirmed: true },
      ];
      room.candidates = room.candidates.filter((f) => f.id !== parsed.id);
      if (parsed.visibility === "group")
        addActivity(room, {
          kind: "constraint_confirmed",
          actorId: auth.participantId,
          summary: "A participant confirmed information for the group plan.",
          category: null,
        });
      if (
        old?.visibility === "group" &&
        parsed.visibility === "private" &&
        room.lastCycle
      ) {
        // Historical findings may contain the now-revoked shared value. Do not
        // carry them into a new shared analysis. Keep only the historical score.
        room.lastCycle.finalEvaluation = null;
        room.options = [];
      }
      if (parsed.visibility === "group" || old?.visibility === "group") {
        room.proposalVersion++;
        room.approvals = {};
        room.questions = [];
      }
    });
  }
  async setConstraints(
    roomId: string,
    auth: Auth,
    revision: number,
    constraints: ConstraintInput[],
  ) {
    const own = z.array(ConstraintSchema).max(100).parse(constraints);
    const roomBefore = await this.store.read(roomId);
    authorize(roomBefore, auth);
    const groupImpact =
      own.some((constraint) => constraint.visibility === "group") ||
      roomBefore.constraints.some(
        (constraint) =>
          constraint.ownerId === auth.participantId && constraint.visibility === "group",
      );
    const update = groupImpact ? this.update.bind(this) : this.updatePrivate.bind(this);
    return update(roomId, auth, revision, (room) => {
      // Room-wide constraints are explicit shared participant actions. No model or
      // private extraction can install one. Future organizer policy can narrow this.
      if (
        own.some(
          (c) =>
            c.ownerId !== auth.participantId ||
            room.constraints.some(
              (old) => old.id === c.id && old.ownerId !== auth.participantId,
            ),
        )
      )
        throw new StateError("UNAUTHORIZED");
      room.constraints = [
        ...room.constraints.filter((c) => c.ownerId !== auth.participantId),
        ...own,
      ];
      if (groupImpact) {
        room.proposalVersion++;
        room.approvals = {};
        room.questions = [];
      }
    });
  }
  async configurePolicy(
    roomId: string,
    auth: Auth,
    revision: number,
    policy: PolicyInput,
  ) {
    return this.update(roomId, auth, revision, (room) => {
      room.policy = PolicySchema.parse(policy);
      room.proposalVersion++;
      room.approvals = {};
      room.questions = [];
    });
  }
  async setPublicTargeting(
    roomId: string,
    auth: Auth,
    revision: number,
    consent: boolean,
  ) {
    return this.update(roomId, auth, revision, (room) => {
      authorize(room, auth).publicTargetingConsent = consent;
    });
  }
  async revise(
    roomId: string,
    auth: Auth,
    revision: number,
    proposal: PlanOption,
  ) {
    return this.update(roomId, auth, revision, (room) => {
      room.proposal = OptionSchema.parse(proposal);
      room.proposalVersion++;
      room.approvals = {};
      room.questions = [];
    });
  }
  async leave(roomId: string, auth: Auth, revision: number) {
    return this.update(roomId, auth, revision, (room) => {
      room.participants = room.participants.filter(
        (p) => p.id !== auth.participantId,
      );
      if (room.lastCycle) room.lastCycle.finalEvaluation = null;
      room.options = [];
      room.facts = room.facts.filter((f) => f.ownerId !== auth.participantId);
      room.candidates = room.candidates.filter(
        (f) => f.ownerId !== auth.participantId,
      );
      room.constraints = room.constraints.filter(
        (c) => c.ownerId !== auth.participantId,
      );
      room.pendingInputs = room.pendingInputs.filter(
        (e) => e.actorId !== auth.participantId,
      );
      room.privatePendingInputs = room.privatePendingInputs.filter(
        (e) => e.actorId !== auth.participantId,
      );
      room.responses = room.responses.filter(
        (response) => response.visibility !== "private" || response.ownerId !== auth.participantId,
      );
      room.activity = room.activity.filter(
        (entry) => entry.visibility !== "private" || entry.targetId !== auth.participantId,
      );
      room.privateAnalyses = room.privateAnalyses.filter(
        (analysis) => analysis.ownerId !== auth.participantId,
      );
      room.questions = room.questions.filter(
        (question) => question.visibility !== "private" || question.targetId !== auth.participantId,
      );
      if (room.lastCycle) {
        room.lastCycle.questions = room.lastCycle.questions.filter(
          (question) => question.visibility !== "private" || question.targetId !== auth.participantId,
        );
        room.lastCycle.messages = room.lastCycle.messages.filter(
          (message) => message.visibility !== "private" || message.targetId !== auth.participantId,
        );
      }
      delete room.privateAnalysisStatus[auth.participantId];
      delete room.privateRevisions[auth.participantId];
      delete room.privateSequences[auth.participantId];
      delete room.approvals[auth.participantId];
    });
  }
  async approve(roomId: string, auth: Auth, version: number) {
    await this.store.transaction(roomId, (room) => {
      if (!room) throw new StateError("ROOM_NOT_FOUND");
      authorize(room, auth);
      if (room.proposalVersion !== version)
        throw new StateError("STALE_PROPOSAL");
      if (
        room.lastCycle?.baseRevision !== room.revision ||
        room.lastCycle.outcome !== "COMPLETED" ||
        room.readiness?.status !== "ready_for_human_review"
      )
        throw new StateError("REVIEW_NOT_READY");
      room.approvals[auth.participantId] = version;
      room.publicSequence++;
      room.eventSequence++;
      addActivity(room, {
        kind: "participant_approved",
        actorId: auth.participantId,
        summary: "A planner approved this proposal version.",
        category: null,
      });
    });
    this.onGroupChange(roomId);
  }
  async shareCandidate(
    roomId: string,
    auth: Auth,
    expectedRevision: number,
    candidateId: string,
  ) {
    const room = await this.store.read(roomId);
    authorize(room, auth);
    const candidate = room.candidates.find(
      (item) => item.id === candidateId && item.ownerId === auth.participantId,
    );
    if (!candidate) throw new StateError("CANDIDATE_NOT_FOUND");
    return this.confirmFact(roomId, auth, expectedRevision, {
      ...candidate,
      visibility: "group",
      confirmed: true,
    });
  }
  async view(roomId: string, auth: Auth) {
    let room = await this.store.read(roomId);
    authorize(room, auth);
    // Reading a projection must never publish private suggestions or mutate a plan.
    const latest = room.lastCycle?.baseRevision === room.revision && room.activeCycleId === null &&
      room.analysisStatus !== "queued" && room.analysisStatus !== "running";
    const failedTrace = latest && room.lastCycle?.outcome === "BLOCKED"
      ? [...(room.lastCycle.traces ?? [])]
          .reverse()
          .find((trace) => trace.failureCode || trace.status === "failed")
      : undefined;
    const viewerRevision = room.revision + (room.privateRevisions[auth.participantId] ?? 0);
    return {
      ...sharedContext(room),
      roomId: room.id,
      viewerId: auth.participantId,
      sequence: room.publicSequence + (room.privateSequences[auth.participantId] ?? 0),
      revision: viewerRevision,
      eventAttendance: {
        estimatedAttendeeCount: room.estimatedAttendeeCount ?? null,
        confirmedAttendeeCount: room.confirmedAttendeeCount ?? null,
      },
      analysisStatus: room.analysisStatus,
      analysisRoles: Roles.map((role) => {
        if (role === "Listener" && room.privateAnalysisStatus[auth.participantId] === "running")
          return { role, status: "running" as const };
        const cycle = room.analysisStatus !== "queued" && room.lastCycle?.baseRevision === room.revision ? room.lastCycle : null;
        const trace = cycle?.traces.filter((trace) => trace.role === role).at(-1);
        const status = !trace
          ? cycle && cycle.outcome !== "CONTINUE" ? "not_required" as const : "idle" as const
          : trace.failureCode ? "failed" as const
            : room.analysisStatus === "running" && trace === cycle?.traces.at(-1)
              ? "running" as const : "complete" as const;
        return { role, status };
      }),
      privateAnalysisStatus: room.privateAnalysisStatus[auth.participantId] ?? "idle",
      participantApprovals: room.participants
        .filter((p) => room.approvals[p.id] === room.proposalVersion)
        .map((p) => p.id),
      findings: latest ? (room.lastCycle?.finalEvaluation?.findings ?? []) : [],
      privateFacts: room.facts.filter(
        (f) => f.ownerId === auth.participantId && f.visibility === "private",
      ),
      candidates: room.candidates.filter(
        (f) => f.visibility === "group" || (f.ownerId === auth.participantId && f.value !== null),
      ),
      responses: room.responses.filter(
        (response) =>
          response.visibility === "group" || response.ownerId === auth.participantId,
      ),
      activity: room.activity.filter(
        (entry) => entry.visibility === "group" || entry.targetId === auth.participantId,
      ),
      questions: room.questions.filter(
        (q) => q.visibility === "group" || q.targetId === auth.participantId,
      ),
      readiness: room.readiness,
      readinessHistory: room.readinessHistory,
      analysisCurrent: latest,
      options: latest
        ? room.options.filter((o) =>
            room.lastCycle?.finalEvaluation?.verdicts.some(
              (v) => v.optionId === o.id && v.accepted,
            ),
          )
        : [],
      messages: latest
        ? (room.lastCycle?.messages.filter(
            (m) =>
              m.visibility === "group" || m.targetId === auth.participantId,
          ) ?? [])
        : [],
      mascot: latest ? (room.lastCycle?.mascot ?? null) : null,
      loopState: latest ? (room.lastCycle?.outcome ?? null) : null,
      analysisIncomplete: !latest || room.lastCycle?.outcome === "BLOCKED",
      analysisError:
        latest && room.lastCycle?.outcome === "BLOCKED"
          ? {
              code: failedTrace?.failureCode ?? room.lastCycle.reason,
              role: failedTrace?.role ?? null,
            }
          : null,
      finalEvaluationAvailable:
        latest && room.lastCycle?.finalEvaluation !== null,
      approved:
        room.participants.length > 0 &&
        room.participants.every(
          (p) => room.approvals[p.id] === room.proposalVersion,
        ),
      approvalCount: room.participants.filter(
        (p) => room.approvals[p.id] === room.proposalVersion,
      ).length,
    };
  }

  async updatePrivate(
    roomId: string,
    auth: Auth,
    expectedRevision: number,
    action: (room: Room) => void,
  ) {
    await this.store.transaction(roomId, (room) => {
      if (!room) throw new StateError("ROOM_NOT_FOUND");
      authorize(room, auth);
      const viewerRevision = room.revision + (room.privateRevisions[auth.participantId] ?? 0);
      if (viewerRevision !== expectedRevision) throw new StateError("STALE_STATE");
      action(room);
      RoomSchema.parse(room);
      this.bumpPrivate(room, auth.participantId);
    });
    this.onPrivateChange(roomId, auth.participantId);
  }

  async completePrivateAnalysis(
    roomId: string,
    ownerId: string,
    inputId: string,
    analysis: Room["privateAnalyses"][number],
  ) {
    await this.store.transaction(roomId, (room) => {
      if (!room) throw new StateError("ROOM_NOT_FOUND");
      const input = room.privatePendingInputs.find(
        (item) => item.id === inputId && item.actorId === ownerId,
      );
      if (!input || analysis.ownerId !== ownerId || analysis.sourceMessageId !== (input.messageId ?? input.id))
        throw new StateError("STALE_PRIVATE_ANALYSIS");
      const participant = room.participants.find((item) => item.id === ownerId);
      if (!participant) throw new StateError("UNAUTHORIZED");
      const candidates = analysis.candidates.map((candidate) => ({
        ...candidate,
        ownerId,
        confirmed: false,
        visibility: "private" as const,
        scope: "participant" as const,
      }));
      room.candidates = [...room.candidates, ...candidates].slice(-200);
      room.privateAnalyses = [...room.privateAnalyses, analysis].slice(-100);
      room.privatePendingInputs = room.privatePendingInputs.filter(
        (item) => item.id !== inputId,
      );
      room.privateAnalysisStatus[ownerId] = "complete";
      this.bumpPrivate(room, ownerId);
      addActivity(room, {
        kind: "analysis_completed",
        actorId: null,
        summary: "Your private response is ready for review.",
        category: null,
        visibility: "private",
        targetId: ownerId,
      });
      RoomSchema.parse(room);
    });
    this.onPrivateChange(roomId, ownerId);
  }

  async markPrivateAnalysisRunning(roomId: string, ownerId: string) {
    await this.store.transaction(roomId, (room) => {
      if (!room) throw new StateError("ROOM_NOT_FOUND");
      if (!room.participants.some((participant) => participant.id === ownerId))
        throw new StateError("UNAUTHORIZED");
      if (!room.privatePendingInputs.some((input) => input.actorId === ownerId)) return;
      room.privateAnalysisStatus[ownerId] = "running";
      this.bumpPrivate(room, ownerId);
      addActivity(room, {
        kind: "analysis_started",
        actorId: null,
        summary: "Setvia is reviewing your private response.",
        category: null,
        visibility: "private",
        targetId: ownerId,
      });
    });
    this.onPrivateChange(roomId, ownerId);
  }

  async failPrivateAnalysis(
    roomId: string,
    ownerId: string,
    inputId: string,
    analysis?: Room["privateAnalyses"][number],
  ) {
    await this.store.transaction(roomId, (room) => {
      if (!room) throw new StateError("ROOM_NOT_FOUND");
      const input = room.privatePendingInputs.find(
        (item) => item.id === inputId && item.actorId === ownerId,
      );
      if (!input) return;
      room.privatePendingInputs = room.privatePendingInputs.filter(
        (item) => item.id !== inputId,
      );
      room.privateAnalysisStatus[ownerId] = "blocked";
      if (analysis) room.privateAnalyses = [...room.privateAnalyses, analysis].slice(-100);
      this.bumpPrivate(room, ownerId);
      addActivity(room, {
        kind: "analysis_blocked",
        actorId: null,
        summary: "Your private response could not be analyzed. It was saved for you.",
        category: null,
        visibility: "private",
        targetId: ownerId,
      });
      RoomSchema.parse(room);
    });
    this.onPrivateChange(roomId, ownerId);
  }
}
