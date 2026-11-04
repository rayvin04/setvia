# Decision Receipt Event Illustration API

This feature creates at most one stored illustration for a planning room. It uses Meta Muse Image 1.0 from the server; the browser never receives a Meta credential or calls the model directly.

## Shared room status

Every authorized room snapshot, including room SSE snapshots, includes:

\`\`\`ts
type ReceiptImageStatus = {
  status: "idle" | "generating" | "ready" | "failed" | "capped";
  retryAvailable: boolean;
  proposalVersion: number | null;
  updatedAt: string | null;
};
\`\`\`

\`retryAvailable\` is true only after the initial attempt failed and before the one manual retry. It is false while generation is active, after success, after the retry is used, or when the image budget is capped. Status events contain no prompt, bytes, private participant details, or upstream error text.

## Request generation

\`POST /api/rooms/:roomId/receipt-image\`

Requires the normal participant session headers:

- \`Authorization: Bearer <participant-token>\`
- \`X-Setvia-Participant: <participant-id>\`
- \`Content-Type: application/json\`

Body:

\`\`\`ts
{
  expectedRevision: number;
  proposalVersion: number;
  retry?: boolean; // true only for an explicit user click when retryAvailable is true
}
\`\`\`

Responses use \`{ receiptImage: ReceiptImageStatus }\`:

- \`202\` when status is \`generating\`; repeated requests are idempotent and start no additional call.
- \`200\` when status is already \`ready\`, or an attempt has \`failed\`. A failed response carries the authoritative \`retryAvailable\` value.
- \`429\` when status is \`capped\`.
- \`409\` for stale revisions/versions or an invalid retry request.
- \`503\` when Meta image inference or the durable image budget is unavailable.

The browser should trigger this endpoint once from an explicit receipt action or one-time receipt entry transition. Never call it from render, polling, or SSE callbacks. Missing \`receiptImage\` state means the feature is unavailable; do not make a model call.

## Read the image

\`GET /api/rooms/:roomId/receipt-image\` requires the same participant session headers and returns authenticated \`image/webp\` bytes only after the status is \`ready\`. Fetch with the room headers and display a blob URL; an ordinary \`img src\` request cannot attach the custom authorization headers. The response is private and \`no-store\`.

The WebP bytes are kept in a separate file on the durable private volume. Room JSON stores only status, attempt count, proposal version, output length, and a content hash. The image is not placed in dashboard snapshots or SSE payloads.

## Inference and limits

The server sends one \`muse-image-1.0\` request to Meta's \`/v1/images/generations\` with \`n: 1\`, \`b64_json\`, WebP output, low reasoning, and image search, web search, and shell disabled. The server maps the room's \`eventType\` and group-visible proposal label to a coarse event theme (for example, “trip planning” plus “Weekend beach outing” becomes a beach scene). It sends only the mapped theme, never the raw label, names, chat, exact venues, or private answers. The visual uses Setvia's rounded, friendly illustration style and orange/cyan accents without copying the mascot, and requests no text or logos.

There is one initial attempt and at most one explicit retry per room. A separate private JSON ledger caps the process at 100 attempts ($1.00 worst-case at Meta's current $0.01 per returned image). Attempts with unknown provider outcome remain reserved; no automatic retry is made. A process restart converts stale \`generating\` status to \`failed\` unless the completed WebP is already durably stored. This uses the existing single-process runtime and private durable volume; no database or public static asset directory is introduced.
