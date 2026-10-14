import "server-only";
// Unified Event Import — the IMAGE adapter's input check. An uploaded
// flyer / screenshot is validated by its real bytes (the same validation
// every Findmi image upload gets), then handed to the multimodal reading
// (./ai.ts readEventImageWithAi) as base64 for that one reading only. It is
// NEVER written to Storage here and never becomes the Event's cover.
import { validateImageFile } from "../imageUploadValidation";
import type { EventImportImageMediaType } from "./ai";
import { EVENT_IMPORT_IMAGE_MAX_BYTES } from "./types";

const ALLOWED = new Set<EventImportImageMediaType>(["image/jpeg", "image/png", "image/webp"]);

export async function readEventImportImage(
  file: unknown
): Promise<{ ok: true; image: { mediaType: EventImportImageMediaType; base64: string } } | { ok: false; code: "unsupported_image" | "image_too_large" }> {
  if (!(file instanceof File) || file.size === 0) return { ok: false, code: "unsupported_image" };
  if (file.size > EVENT_IMPORT_IMAGE_MAX_BYTES) return { ok: false, code: "image_too_large" };
  try {
    const validated = await validateImageFile(file);
    if ("error" in validated) return { ok: false, code: "unsupported_image" };
    // The detected type decides (a GIF / SVG / anything else is refused; an
    // iPhone HEIC photo arrives here already converted to JPEG).
    const mediaType = validated.contentType as EventImportImageMediaType;
    if (!ALLOWED.has(mediaType)) return { ok: false, code: "unsupported_image" };
    const bytes = validated.converted?.buffer ?? Buffer.from(await file.arrayBuffer());
    if (bytes.length > EVENT_IMPORT_IMAGE_MAX_BYTES) return { ok: false, code: "image_too_large" };
    return { ok: true, image: { mediaType, base64: bytes.toString("base64") } };
  } catch {
    return { ok: false, code: "unsupported_image" };
  }
}
