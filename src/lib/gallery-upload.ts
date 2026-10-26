// Gallery upload batches (Business / Event / Location galleries) — one
// shared, crash-safe loop.
//
// Foxden owner-workflow correction: each gallery field awaited its upload
// Server Action with no try/catch inside startTransition. A request that
// fails before it reaches the server — a phone-original photo above the
// platform's request-body cap, a timeout, a dropped connection — REJECTS
// instead of returning `{ error }`, and React surfaces an async transition's
// rejection to the nearest error boundary: the whole Account page crashed.
//
// Here every file is handled on its own: photographic JPEG/PNG/WebP files
// are reduced first with the existing client preprocessing helper (HEIC/HEIF
// keeps the existing server conversion path, untouched), a file still known
// to exceed the request cap is not sent, a rejected upload is caught, and a
// failure never stops or discards the other files. Successful URLs are
// reported the moment each one resolves (selection order kept). Never
// throws.

import { isHeicLike, preprocessImageForUpload } from "./imagePreprocessing";

/** Comfortably under the hosting platform's ~4.5MB request-body cap once
 * the multipart envelope is added. A file above it can't reach the Server
 * Action at all, so it's reported instead of sent. */
export const GALLERY_REQUEST_SAFE_BYTES = 4_200_000;

export type GalleryUploadResult = { url?: string; error?: string };

export interface GalleryUploadFailure {
  name: string;
  reason: string;
}

export interface GalleryUploadDeps {
  upload: (fd: FormData) => Promise<GalleryUploadResult>;
  onUploaded: (url: string) => void;
  /** Injectable for tests; defaults to the shared client helper. */
  prepare?: (file: File) => Promise<File>;
}

const TOO_LARGE = "too large to upload — try a smaller photo or a JPEG export";

/** Uploads each file in selection order; returns the files that failed. */
export async function uploadGalleryFiles(files: readonly File[], deps: GalleryUploadDeps): Promise<GalleryUploadFailure[]> {
  const prepare = deps.prepare ?? preprocessImageForUpload;
  const failures: GalleryUploadFailure[] = [];
  for (const original of files) {
    const name = original.name || "photo";
    try {
      // HEIC/HEIF: sent as-is to the existing server conversion — but never
      // when it's already known to be too large to arrive.
      const file = isHeicLike(original) ? original : await prepare(original);
      if (file.size > GALLERY_REQUEST_SAFE_BYTES) {
        failures.push({ name, reason: TOO_LARGE });
        continue;
      }
      const fd = new FormData();
      fd.set("file", file);
      const result = await deps.upload(fd);
      if (result?.url) deps.onUploaded(result.url);
      else failures.push({ name, reason: result?.error || "couldn't be uploaded" });
    } catch {
      failures.push({ name, reason: "upload failed — check your connection and try again" });
    }
  }
  return failures;
}

/** One readable message naming every file that didn't upload. */
export function galleryUploadErrorMessage(failures: readonly GalleryUploadFailure[]): string | null {
  if (failures.length === 0) return null;
  if (failures.length === 1) return `${failures[0].name}: ${failures[0].reason}`;
  return `${failures.length} photos didn’t upload — ${failures.map((f) => `${f.name}: ${f.reason}`).join("; ")}`;
}
