import { z } from "zod";

const certaintySchema = z.enum(["confirmed", "tentative", "uncertain"]);
const detailKindSchema = z.enum(["hard_requirement", "preference", "unknown"]);

const evidenceDetailSchema = z
  .object({
    description: z.string().min(1).max(240),
    evidence: z.string().max(300).nullable(),
    kind: detailKindSchema,
    certainty: certaintySchema,
  })
  .strict();

export const PlanExtractionSchema = z
  .object({
    title: z.string().max(100).nullable(),
    eventType: z
      .enum(["trip", "gathering", "meeting", "school", "work", "other"])
      .nullable(),
    description: z.string().max(500).nullable(),
    estimatedParticipants: z
      .object({
        value: z.number().int().positive().nullable(),
        isApproximate: z.boolean(),
        evidence: z.string().max(300).nullable(),
      })
      .strict(),
    dateOrDateRange: z
      .object({
        value: z.string().max(160).nullable(),
        isRelative: z.boolean(),
        isAmbiguous: z.boolean(),
        evidence: z.string().max(300).nullable(),
      })
      .strict(),
    location: z
      .object({
        value: z.string().max(160).nullable(),
        isConfirmed: z.boolean(),
        evidence: z.string().max(300).nullable(),
      })
      .strict(),
    budget: z
      .object({
        amount: z.number().nonnegative().nullable(),
        currency: z.string().max(24).nullable(),
        isPerPerson: z.boolean().nullable(),
        isApproximate: z.boolean(),
        evidence: z.string().max(300).nullable(),
      })
      .strict(),
    constraints: z.array(evidenceDetailSchema).max(12),
    preferences: z.array(evidenceDetailSchema).max(12),
    uncertainties: z.array(z.string().min(1).max(240)).max(8),
    missingInformation: z.array(z.string().min(1).max(240)).max(8),
    suggestedQuestions: z.array(z.string().min(1).max(180)).max(5),
  })
  .strict();

export type PlanExtraction = z.infer<typeof PlanExtractionSchema>;

function nullableString(maxLength = 300) {
  return {
    anyOf: [{ type: "string", maxLength }, { type: "null" }],
  };
}

const nullableBoolean = {
  anyOf: [{ type: "boolean" }, { type: "null" }],
};

const evidenceDetailJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["description", "evidence", "kind", "certainty"],
  properties: {
    description: { type: "string", maxLength: 240 },
    evidence: nullableString(),
    kind: {
      type: "string",
      enum: ["hard_requirement", "preference", "unknown"],
    },
    certainty: {
      type: "string",
      enum: ["confirmed", "tentative", "uncertain"],
    },
  },
};

export const PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "eventType",
    "description",
    "estimatedParticipants",
    "dateOrDateRange",
    "location",
    "budget",
    "constraints",
    "preferences",
    "uncertainties",
    "missingInformation",
    "suggestedQuestions",
  ],
  properties: {
    title: nullableString(100),
    eventType: {
      anyOf: [
        {
          type: "string",
          enum: ["trip", "gathering", "meeting", "school", "work", "other"],
        },
        { type: "null" },
      ],
    },
    description: nullableString(500),
    estimatedParticipants: {
      type: "object",
      additionalProperties: false,
      required: ["value", "isApproximate", "evidence"],
      properties: {
        value: {
          anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }],
        },
        isApproximate: { type: "boolean" },
        evidence: nullableString(),
      },
    },
    dateOrDateRange: {
      type: "object",
      additionalProperties: false,
      required: ["value", "isRelative", "isAmbiguous", "evidence"],
      properties: {
        value: nullableString(160),
        isRelative: { type: "boolean" },
        isAmbiguous: { type: "boolean" },
        evidence: nullableString(),
      },
    },
    location: {
      type: "object",
      additionalProperties: false,
      required: ["value", "isConfirmed", "evidence"],
      properties: {
        value: nullableString(160),
        isConfirmed: { type: "boolean" },
        evidence: nullableString(),
      },
    },
    budget: {
      type: "object",
      additionalProperties: false,
      required: [
        "amount",
        "currency",
        "isPerPerson",
        "isApproximate",
        "evidence",
      ],
      properties: {
        amount: {
          anyOf: [{ type: "number", minimum: 0 }, { type: "null" }],
        },
        currency: nullableString(24),
        isPerPerson: nullableBoolean,
        isApproximate: { type: "boolean" },
        evidence: nullableString(),
      },
    },
    constraints: {
      type: "array",
      maxItems: 12,
      items: evidenceDetailJsonSchema,
    },
    preferences: {
      type: "array",
      maxItems: 12,
      items: evidenceDetailJsonSchema,
    },
    uncertainties: {
      type: "array",
      maxItems: 8,
      items: { type: "string", minLength: 1, maxLength: 240 },
    },
    missingInformation: {
      type: "array",
      maxItems: 8,
      items: { type: "string", minLength: 1, maxLength: 240 },
    },
    suggestedQuestions: {
      type: "array",
      maxItems: 5,
      items: { type: "string", minLength: 1, maxLength: 180 },
    },
  },
} satisfies Record<string, unknown>;
