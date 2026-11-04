import type { projectDecisionReceipt } from "./decision-receipt";

type Receipt = ReturnType<typeof projectDecisionReceipt>;

// Render text with the browser font so names and currency symbols survive export.
export async function createReceiptPdf(receipt: Receipt): Promise<Blob> {
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = 1240;
  canvas.height = 1754;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("PDF export is unavailable in this browser.");
  const context = ctx;
  const pages: Uint8Array<ArrayBuffer>[] = [];
  let y = 0;

  function startPage() {
    context.fillStyle = "#f7fafb";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#082433";
    context.fillRect(0, 0, canvas.width, 104);
    context.textBaseline = "top";
    context.font = "650 34px Lexend, sans-serif";
    context.fillStyle = "#fff3df";
    context.fillText("Setvia  /  Decision Receipt", 80, 32);
    y = 148;
  }

  async function finishPage() {
    const image = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("Could not render receipt page.")),
        "image/jpeg",
        0.92,
      );
    });
    pages.push(new Uint8Array(await image.arrayBuffer()));
  }

  async function write(text: string, size = 29, color = "#152d3a") {
    const font = `${size > 30 ? 650 : 400} ${size}px Lexend, sans-serif`;
    context.font = font;
    const lines: string[] = [];
    let line = "";
    for (const word of text.trim().split(/\s+/)) {
      if (line && context.measureText(`${line} ${word}`).width > 1080) {
        lines.push(line);
        line = "";
      }
      if (line) line += " ";
      for (const character of word) {
        if (line && context.measureText(line + character).width > 1080) {
          lines.push(line);
          line = "";
        }
        line += character;
      }
    }
    if (line) lines.push(line);
    for (const row of lines) {
      if (y + size * 1.45 > canvas.height - 76) {
        await finishPage();
        startPage();
      }
      context.font = font;
      context.fillStyle = color;
      context.fillText(row, 80, y);
      y += size * 1.45;
    }
    y += 12;
  }

  startPage();
  await write(receipt.title, 52);
  await write(
    `${receipt.status} · Proposal ${receipt.proposalVersion} · Generated ${new Date().toISOString()}`,
  );
  if (receipt.eventCard.description) await write(receipt.eventCard.description);
  if (receipt.eventCard.expectedAttendees !== undefined) {
    await write(`${receipt.eventCard.expectedAttendees} expected attendees`);
  }
  await write(
    `${receipt.approvalCount} of ${receipt.participantCount} room members approved`,
  );
  await write(
    receipt.readiness
      ? `Readiness: ${receipt.readiness.percentage}% · ${receipt.readiness.status.replaceAll("_", " ")}`
      : "Readiness: no current evaluation",
  );
  y += 16;
  await write(
    receipt.status === "Final" ? "What was agreed" : "What’s proposed",
    36,
  );
  for (const decision of receipt.decisions)
    await write(`${decision.label}: ${decision.value}`);
  if (!receipt.decisions.length) await write("No plan details recorded.");
  y += 16;
  await write("Reality Check findings", 36);
  for (const finding of receipt.findings) {
    await write(
      `${finding.category} · ${finding.status} · ${finding.severity}: ${finding.message}`,
    );
  }
  if (!receipt.findings.length) await write("No current findings available.");
  await finishPage();

  return encodeImagePdf(pages, canvas.width, canvas.height);
}

function encodeImagePdf(
  pages: Uint8Array<ArrayBuffer>[],
  width: number,
  height: number,
) {
  const parts: BlobPart[] = [];
  const offsets = [0];
  const encoder = new TextEncoder();
  let length = 0;
  function append(value: string | Uint8Array<ArrayBuffer>) {
    const bytes = typeof value === "string" ? encoder.encode(value) : value;
    parts.push(bytes);
    length += bytes.byteLength;
  }
  function object(id: number, data: string, stream?: Uint8Array<ArrayBuffer>) {
    offsets[id] = length;
    append(`${id} 0 obj\n${data}\n`);
    if (stream) {
      append("stream\n");
      append(stream);
      append("\nendstream\n");
    }
    append("endobj\n");
  }
  append("%PDF-1.4\n%âãÏÓ\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(
    2,
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, index) => `${3 + index * 3} 0 R`).join(" ")}] >>`,
  );
  pages.forEach((image, index) => {
    const page = 3 + index * 3;
    object(
      page,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Image ${page + 1} 0 R >> >> /Contents ${page + 2} 0 R >>`,
    );
    object(
      page + 1,
      `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.byteLength} >>`,
      image,
    );
    const commands = encoder.encode("q 595 0 0 842 0 0 cm /Image Do Q");
    object(page + 2, `<< /Length ${commands.byteLength} >>`, commands);
  });
  const xref = length;
  append(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for (const offset of offsets.slice(1))
    append(`${String(offset).padStart(10, "0")} 00000 n \n`);
  append(
    `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  );
  return new Blob(parts, { type: "application/pdf" });
}
