// Image metadata privacy (Trust & Privacy Phase 2A). Photos straight off a
// phone carry EXIF (often GPS coordinates, device model, capture time),
// XMP and IPTC blocks. Findmi never needs them, so every user-uploaded
// original is stripped before it is stored, in BOTH buckets:
//   journal-media  (private Moment photos; public Moments are signed views)
//   findmi-media   (public Business / Event / Product / Location images)
// Display variants were already metadata-free (sharp drops metadata unless
// asked to keep it); this closes the original-file gap, including small
// photos the browser uploads without re-encoding.
//
// Behavior: if a JPEG / PNG / WebP carries EXIF, XMP, IPTC or text
// comments, it is re-encoded once with its orientation applied (so it
// still displays upright) and its color profile kept, and nothing else.
// A file with no such metadata is returned unchanged (no quality cost).
// GIF is left as-is (re-encoding would flatten animation; GIF has no EXIF
// block in practice).
import sharp from "sharp";

const MAX_INPUT_PIXELS = 100_000_000;

export interface MetadataSummary {
  exif: boolean;
  xmp: boolean;
  iptc: boolean;
  comments: boolean;
}

export async function readMetadataSummary(buffer: Buffer): Promise<MetadataSummary> {
  const meta = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "none" }).metadata();
  return {
    exif: Boolean(meta.exif && meta.exif.length > 0),
    xmp: Boolean(meta.xmp && meta.xmp.length > 0),
    iptc: Boolean(meta.iptc && meta.iptc.length > 0),
    comments: Array.isArray((meta as { comments?: unknown[] }).comments) && ((meta as { comments?: unknown[] }).comments ?? []).length > 0,
  };
}

function hasSensitive(m: MetadataSummary): boolean {
  return m.exif || m.xmp || m.iptc || m.comments;
}

export type StripResult = { buffer: Buffer; changed: boolean } | { error: string };

/** Returns a metadata-free version of an uploaded image (see module
 * note). Never throws; an undecodable image returns an error so callers
 * can refuse to store an original they couldn't clean. */
export async function stripImageMetadata(buffer: Buffer, contentType: string): Promise<StripResult> {
  const type = contentType.toLowerCase();
  if (!/^image\/(jpeg|png|webp)$/.test(type)) return { buffer, changed: false };
  try {
    const summary = await readMetadataSummary(buffer);
    if (!hasSensitive(summary)) return { buffer, changed: false };
    let pipeline = sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "none" }).rotate().keepIccProfile();
    if (type === "image/jpeg") pipeline = pipeline.jpeg({ quality: 92, mozjpeg: true });
    else if (type === "image/png") pipeline = pipeline.png({ compressionLevel: 9 });
    else pipeline = pipeline.webp({ quality: 92, alphaQuality: 100 });
    const out = await pipeline.toBuffer();
    return { buffer: out, changed: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't process that image." };
  }
}

/** Whether an already-stored buffer still carries location or other
 * identifying metadata (used by verification tooling and tests). */
export async function hasSensitiveImageMetadata(buffer: Buffer): Promise<boolean> {
  try {
    return hasSensitive(await readMetadataSummary(buffer));
  } catch {
    return false;
  }
}
