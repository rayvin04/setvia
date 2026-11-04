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
  MAX_ROOM_PARTICIPANTS,
  ConstraintSchema,
  PolicySchema,
  OptionSchema,
  type Auth,
  type FactInput,
  type PolicyInput,
  type Room,
  type PlanOption,
  type Constraint,
} from "./contracts.js";
import { RoomStore, StateError } from "./store.js";
export const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
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
    facts: room.facts.filter((f) => f.visibility === "group"),
    policy: room.policy,
    constraints: room.constraints,
    proposal: room.proposal,
  };
}
export class RoomService {
  constructor(
    readonly store: RoomStore,
    private onChange: (id: string) => void = () => {},
  ) {}
  async create(
    eventType: string,
    policy: PolicyInput,
    proposal: PlanOption,
    attendance: {
      estimatedAttendeeCount: number | null;
      confirmedAttendeeCount: number | null;
    } = { estimatedAttendeeCount: null, confirmedAttendeeCount: null },
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
      revision: 0,
      eventType,
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
      room.revision++;
      room.proposalVersion++;
      room.approvals = {};
      room.questions = [];
    });
    this.onChange(roomId);
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
      if (room.revision !== expectedRevision)
        throw new StateError("STALE_STATE");
      action(room);
      room.activeCycleId = null;
      RoomSchema.parse(room);
      room.revision++;
    });
    this.onChange(roomId);
  }
  async submit(
    roomId: string,
    auth: Auth,
    expectedRevision: number,
    text: string,
    questionId?: string,
  ) {
    return this.update(roomId, auth, expectedRevision, (room) => {
      if (questionId) {
        const q = room.questions.find((q) => q.id === questionId);
        if (!q || (q.targetId && q.targetId !== auth.participantId))
          throw new StateError("UNAUTHORIZED_ANSWER");
        room.questions = room.questions.filter((q) => q.id !== questionId);
      }
      if (room.pendingInputs.length >= 50)
        throw new StateError("INPUT_QUEUE_LIMIT");
      room.pendingInputs.push({
        id: randomUUID(),
        actorId: auth.participantId,
        text: z.string().trim().min(1).max(4000).parse(text),
      });
    });
  }
  async confirmFact(roomId: string, auth: Auth, revision: number, fact: FactInput) {
    return this.update(roomId, auth, revision, (room) => {
      const parsed = FactSchema.parse(fact);
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
    constraints: Constraint[],
  ) {
    return this.update(roomId, auth, revision, (room) => {
      // Room-wide constraints are explicit shared participant actions. No model or
      // private extraction can install one. Future organizer policy can narrow this.
      const own = z.array(ConstraintSchema).max(100).parse(constraints);
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
      room.proposalVersion++;
      room.approvals = {};
      room.questions = [];
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
      room.proposalVersion++;
      room.approvals = {};
      room.questions = [];
    });
  }
  async approve(roomId: string, auth: Auth, version: number) {
    await this.store.transaction(roomId, (room) => {
      if (!room) throw new StateError("ROOM_NOT_FOUND");
      authorize(room, auth);
      if (room.proposalVersion !== version)
        throw new StateError("STALE_PROPOSAL");
      room.approvals[auth.participantId] = version;
    });
  }
  async view(roomId: string, auth: Auth) {
    const room = await this.store.read(roomId);
    authorize(room, auth);
    const latest = room.lastCycle?.baseRevision === room.revision;
    return {
      ...sharedContext(room),
      roomId: room.id,
      viewerId: auth.participantId,
      participantApprovals: room.participants
        .filter((p) => room.approvals[p.id] === room.proposalVersion)
        .map((p) => p.id),
      findings: latest ? (room.lastCycle?.finalEvaluation?.findings ?? []) : [],
      privateFacts: room.facts.filter(
        (f) => f.ownerId === auth.participantId && f.visibility === "private",
      ),
      candidates: room.candidates.filter(
        (f) => f.ownerId === auth.participantId,
      ),
      questions: room.questions.filter(
        (q) => q.visibility === "group" || q.targetId === auth.participantId,
      ),
      readiness: room.readiness,
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
              code: room.lastCycle.reason,
              role:
                [...(room.lastCycle.traces ?? [])]
                  .reverse()
                  .find((trace) => trace.failureCode || trace.status === "failed")
                  ?.role ?? null,
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
}
