import assert from "node:assert/strict";
import test from "node:test";
import { CreateRoomRequestSchema } from "../../shared/room-api.js";
import { BEACH_TRIP_DEMO_BATCHES, BEACH_TRIP_DEMO_PARTICIPANTS, beachTripDemoRequest } from "./beach-trip-demo.js";

test("live Beach Trip demo uses an authored room and four unique fictional participant actions", () => {
  const room = CreateRoomRequestSchema.parse(beachTripDemoRequest("Alex"));
  assert.equal(room.eventType, "Weekend Beach Trip");
  assert.equal(room.proposal.label, "Weekend Beach Trip");
  assert.equal(room.estimatedAttendeeCount, 5);
  assert.equal(BEACH_TRIP_DEMO_PARTICIPANTS.length, 4);
  assert.equal(new Set(BEACH_TRIP_DEMO_PARTICIPANTS.map((participant) => participant.name)).size, 4);
  assert.equal(BEACH_TRIP_DEMO_BATCHES.flat().length, 4);
  assert.match(BEACH_TRIP_DEMO_PARTICIPANTS[0]!.message, /Saturday/);
  assert.match(BEACH_TRIP_DEMO_PARTICIPANTS[1]!.message, /₱2,500/);
});
