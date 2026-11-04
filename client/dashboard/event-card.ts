export interface EventCardDetails {
  title: string;
  status: "Draft" | "Blocked" | "Final";
  date?: string;
  time?: string;
  location?: string;
  description?: string;
  expectedAttendees?: number;
}

export async function createEventCard(
  details: EventCardDetails,
): Promise<Blob> {
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image export is unavailable in this browser.");

  const width = 960;
  const inset = 72;
  const blocks: {
    font: string;
    color: string;
    lines: string[];
    height: number;
  }[] = [];

  function add(
    text: string | undefined,
    font: string,
    color: string,
    height: number,
  ) {
    if (!text?.trim()) return;
    ctx!.font = font;
    const lines: string[] = [];
    let line = "";
    for (const word of text.trim().split(/\s+/)) {
      if (
        line &&
        ctx!.measureText(`${line} ${word}`).width > width - inset * 2
      ) {
        lines.push(line);
        line = "";
      }
      if (line) line += " ";
      for (const character of word) {
        if (
          line &&
          ctx!.measureText(line + character).width > width - inset * 2
        ) {
          lines.push(line);
          line = "";
        }
        line += character;
      }
    }
    if (line) lines.push(line);
    blocks.push({ font, color, lines, height });
  }

  add("Setvia", "650 34px Lexend, sans-serif", "#fff3df", 48);
  add(
    details.status,
    "550 25px Lexend, sans-serif",
    details.status === "Final" ? "#78d9ad" : "#ffc080",
    34,
  );
  add(details.title, "650 76px Lexend, sans-serif", "#fff3df", 92);
  add(
    [details.date, details.time].filter(Boolean).join(" · "),
    "550 38px Lexend, sans-serif",
    "#83ddff",
    54,
  );
  add(details.location, "550 38px Lexend, sans-serif", "#83ddff", 54);
  add(details.description, "400 34px Lexend, sans-serif", "#d2e1e8", 48);
  if (details.expectedAttendees !== undefined) {
    add(
      `${details.expectedAttendees} expected`,
      "400 30px Lexend, sans-serif",
      "#d2e1e8",
      44,
    );
  }

  const gap = 26;
  canvas.width = width;
  canvas.height =
    inset * 2 +
    blocks.reduce(
      (height, block) => height + block.lines.length * block.height + gap,
      0,
    ) -
    gap;
  const background = ctx.createLinearGradient(
    0,
    0,
    canvas.width,
    canvas.height,
  );
  background.addColorStop(0, "#0b3446");
  background.addColorStop(0.66, "#07131b");
  background.addColorStop(1, "#40271e");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#fc734d";
  ctx.fillRect(inset, inset - 24, 56, 5);
  ctx.textBaseline = "top";
  let y = inset;
  for (const block of blocks) {
    ctx.font = block.font;
    ctx.fillStyle = block.color;
    for (const line of block.lines) {
      ctx.fillText(line, inset, y);
      y += block.height;
    }
    y += gap;
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Could not create the event card.")),
      "image/png",
    );
  });
}
