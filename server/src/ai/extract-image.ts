import { InvalidImageError } from "./errors.js";
import { extractPlanFromInputs } from "./extract-plan.js";
import { createMetaClient, type MetaApiClient } from "./meta-client.js";
import type { PlanExtraction } from "./schemas.js";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 16_000_000;

export type SupportedImageType = "image/png" | "image/jpeg" | "image/webp";

export interface PlanningImage {
  bytes: Uint8Array;
  mimeType: string;
}

interface ImageDimensions {
  width: number;
  height: number;
}

function matches(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

function readPngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (
    bytes.length < 24 ||
    !matches(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ||
    !matches(bytes.subarray(12, 16), [0x49, 0x48, 0x44, 0x52])
  ) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function readJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (
    bytes.length < 4 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[bytes.length - 2] !== 0xff ||
    bytes[bytes.length - 1] !== 0xd9
  ) {
    return null;
  }

  const frameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
    0xcf,
  ]);
  let offset = 2;
  while (offset + 4 <= bytes.length - 2) {
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined) return null;
    if (marker === 0xd9 || marker === 0xda) break;
    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      continue;
    }
    if (offset + 2 > bytes.length) return null;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if (frameMarkers.has(marker)) {
      if (segmentLength < 7) return null;
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      return { width, height };
    }
    offset += segmentLength;
  }
  return null;
}

function readWebpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (
    bytes.length < 20 ||
    !matches(bytes.subarray(0, 4), [0x52, 0x49, 0x46, 0x46]) ||
    !matches(bytes.subarray(8, 12), [0x57, 0x45, 0x42, 0x50])
  ) {
    return null;
  }

  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunk === "VP8X" && bytes.length >= 30) {
    return {
      width: 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16),
      height: 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16),
    };
  }
  if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    return {
      width: 1 + bytes[21]! + ((bytes[22]! & 0x3f) << 8),
      height:
        1 +
        ((bytes[22]! & 0xc0) >> 6) +
        (bytes[23]! << 2) +
        ((bytes[24]! & 0x0f) << 10),
    };
  }
  if (
    chunk === "VP8 " &&
    bytes.length >= 30 &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return {
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    };
  }
  return null;
}

function dimensionsFor(
  bytes: Uint8Array,
  mimeType: SupportedImageType,
): ImageDimensions | null {
  if (mimeType === "image/png") return readPngDimensions(bytes);
  if (mimeType === "image/jpeg") return readJpegDimensions(bytes);
  return readWebpDimensions(bytes);
}

export function validatePlanningImage(
  image: PlanningImage,
): SupportedImageType {
  if (!(image.bytes instanceof Uint8Array) || image.bytes.length === 0) {
    throw new InvalidImageError("Image upload is empty or unreadable.");
  }
  if (image.bytes.length > MAX_IMAGE_BYTES) {
    throw new InvalidImageError("Image exceeds the 5 MiB upload limit.");
  }
  if (
    image.mimeType !== "image/png" &&
    image.mimeType !== "image/jpeg" &&
    image.mimeType !== "image/webp"
  ) {
    throw new InvalidImageError(
      "Unsupported image type. Use PNG, JPEG, or WebP.",
    );
  }

  const dimensions = dimensionsFor(image.bytes, image.mimeType);
  if (!dimensions) {
    throw new InvalidImageError(
      "Image content does not match a readable PNG, JPEG, or WebP file.",
    );
  }
  if (
    dimensions.width < 1 ||
    dimensions.height < 1 ||
    dimensions.width * dimensions.height > MAX_IMAGE_PIXELS
  ) {
    throw new InvalidImageError(
      "Image dimensions are invalid or exceed the 16 megapixel limit.",
    );
  }
  return image.mimeType;
}

export async function extractPlanFromImage(
  image: PlanningImage,
  client: MetaApiClient = createMetaClient(),
): Promise<PlanExtraction> {
  const mimeType = validatePlanningImage(image);
  const base64 = Buffer.from(image.bytes).toString("base64");
  const dataUrl = "data:" + mimeType + ";base64," + base64;
  return extractPlanFromInputs(
    [
      {
        type: "input_text",
        text: "Read this planning image and extract only explicit details. Mark unreadable or uncertain text as unknown.",
      },
      { type: "input_image", image_url: dataUrl },
    ],
    client,
  );
}
