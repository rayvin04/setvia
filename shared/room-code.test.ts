import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { roomCodeFromId } from "./room-code.js";

test("room codes are stable, human-readable locators with no session-token material", () => {
  const id = randomUUID();
  const code = roomCodeFromId(id);
  assert.equal(code, roomCodeFromId(id));
  assert.match(code, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/);
  assert.notEqual(code, roomCodeFromId(randomUUID()));
});

test("room codes reject anything except UUID-shaped room identifiers", () => {
  assert.throws(() => roomCodeFromId("not-a-room-id"), /Invalid room identifier/);
});
