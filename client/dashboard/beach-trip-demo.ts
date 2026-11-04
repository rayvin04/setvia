import type { CreateRoomRequest } from "../../shared/room-api.js";

export const BEACH_TRIP_DEMO_QUERY = "beach-trip-demo";
export const BEACH_TRIP_DEMO_EVENT_TYPE = "Weekend Beach Trip";

export const BEACH_TRIP_DEMO_PARTICIPANTS = [
  { id: "hu-tao", name: "Hu Tao · demo", message: "I can't make Saturday because I have class." },
  { id: "selena", name: "Selena · demo", message: "I can spend up to ₱2,500 per person." },
  { id: "furina", name: "Furina · demo", message: "I can drive, but we need to leave early." },
  { id: "manta-ray", name: "Manta Ray · demo", message: "I'd prefer somewhere nearby if we can." },
] as const;

export const BEACH_TRIP_DEMO_BATCHES = [
  [BEACH_TRIP_DEMO_PARTICIPANTS[0], BEACH_TRIP_DEMO_PARTICIPANTS[1]],
  [BEACH_TRIP_DEMO_PARTICIPANTS[2], BEACH_TRIP_DEMO_PARTICIPANTS[3]],
] as const;

export function beachTripDemoRequest(creatorName: string): CreateRoomRequest {
  return {
    creatorName,
    eventType: BEACH_TRIP_DEMO_EVENT_TYPE,
    proposal: {
      id: BEACH_TRIP_DEMO_QUERY,
      label: "Weekend Beach Trip",
      values: {
        category: "trip",
        location: "Laiya, Batangas",
        date: "Saturday · date to confirm",
        time: "Early morning",
        description: "A weekend beach trip for five. The group is still working out timing and transportation.",
        attendeeCount: 5,
      },
    },
    estimatedAttendeeCount: 5,
    confirmedAttendeeCount: null,
  };
}
