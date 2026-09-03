// Minimal ambient types for `heic-convert` — it ships no TypeScript
// declarations and no @types package exists. Scoped to exactly the shape
// lib/imageUploadValidation.ts actually calls (single-image conversion),
// not the full library surface (e.g. its `.all()` multi-image API).
declare module "heic-convert" {
  interface HeicConvertOptions {
    buffer: Buffer | Uint8Array;
    format: "JPEG" | "PNG";
    quality?: number;
  }

  function convert(options: HeicConvertOptions): Promise<Buffer>;

  export default convert;
}
