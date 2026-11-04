const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const ROOM_CODE_BITS = 50n;
const ROOM_CODE_LENGTH = 10;

/** A stable room locator derived from the room's random UUID. It never grants access. */
export function roomCodeFromId(roomId: string): string {
  const hex = roomId.replaceAll("-", "");
  if (!/^[a-f\d]{32}$/i.test(hex)) throw new Error("Invalid room identifier.");
  const bits = BigInt(`0x${hex}`) >> 78n;
  let code = "";
  for (let index = 0; index < Number(ROOM_CODE_BITS / 5n); index++) {
    const shift = BigInt((ROOM_CODE_LENGTH - index - 1) * 5);
    code += ROOM_CODE_ALPHABET[Number((bits >> shift) & 31n)];
  }
  return code;
}
