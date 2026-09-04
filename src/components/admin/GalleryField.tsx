"use client";

import { useState, useTransition } from "react";
import { uploadImage } from "@/lib/admin/upload";

/** Final refinement pass, items 9/10 — shared multi-image uploader for
 * both the Event Gallery and the About the Venue gallery (also used by
 * BusinessForm.tsx's own admin Gallery field). Same "current config, not
 * economic history" delete-then-reinsert-on-save approach already used
 * for product fulfillment options: every image URL renders as a hidden
 * input sharing one `name`, so the server reads the final, reordered
 * list in one shot via `formData.getAll(name)` and DOM order IS display
 * order — no separate order-index bookkeeping, no new/existing-row
 * tracking needed.
 *
 * Event Gallery Multi-Image Upload Parity pass — the file input now
 * accepts multiple files in one picker action, same as the member-facing
 * Business gallery (MemberGalleryField.tsx): uploads run sequentially
 * (not Promise.all) so selection order is preserved and one failed file
 * never discards images that already uploaded successfully — each
 * success is appended to `urls` as soon as it resolves. `isPending`
 * still covers the whole batch, so the input stays disabled (and the
 * label reads "Uploading…") until every selected file has been
 * attempted, the same duplicate-submission guard as before, just
 * covering a batch instead of one file. */
export default function GalleryField({
  label,
  name,
  initialUrls,
  hint,
}: {
  label: string;
  name: string;
  initialUrls: string[];
  hint?: string;
}) {
  const [urls, setUrls] = useState<string[]>(initialUrls);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setError(null);
    startTransition(async () => {
      let lastError: string | null = null;
      for (const file of files) {
        const fd = new FormData();
        fd.set("file", file);
        const result = await uploadImage(fd);
        if (result.error) lastError = result.error;
        else if (result.url) setUrls((prev) => [...prev, result.url!]);
      }
      if (lastError) setError(lastError);
    });
  }

  function removeAt(i: number) {
    setUrls((prev) => prev.filter((_, idx) => idx !== i));
  }

  function move(i: number, dir: -1 | 1) {
    setUrls((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      {hint && <p className="mb-2 text-xs text-ink/45">{hint}</p>}

      {urls.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {urls.map((url, i) => (
            <div key={`${url}-${i}`} className="relative h-20 w-20 overflow-hidden rounded-xl border border-black/10 bg-black/5">
              <input type="hidden" name={name} value={url} />
              {/* eslint-disable-next-line @next/next/no-img-element -- preview only, arbitrary/mid-edit URLs shouldn't need next/image's remote-host allowlist */}
              <img src={url} alt="" className="h-full w-full object-cover" />
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/55 px-1 py-0.5">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label="Move earlier"
                  className="px-1 text-xs font-bold text-white disabled:opacity-30"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  aria-label="Remove"
                  className="px-1 text-xs font-bold text-white"
                >
                  ✕
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === urls.length - 1}
                  aria-label="Move later"
                  className="px-1 text-xs font-bold text-white disabled:opacity-30"
                >
                  ›
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-xs font-semibold text-ink/70 transition hover:border-ink/30">
        {isPending ? "Uploading…" : "Add Images"}
        <input type="file" accept="image/*" multiple className="hidden" onChange={handleFile} disabled={isPending} />
      </label>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
