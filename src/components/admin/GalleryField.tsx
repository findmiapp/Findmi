"use client";

import { useState, useTransition } from "react";
import { uploadImage } from "@/lib/admin/upload";

/** Final refinement pass, items 9/10 — shared multi-image uploader for
 * both the Event Gallery and the About the Venue gallery. Same "current
 * config, not economic history" delete-then-reinsert-on-save approach
 * already used for product fulfillment options: every image URL renders
 * as a hidden input sharing one `name`, so the server reads the final,
 * reordered list in one shot via `formData.getAll(name)` and DOM order
 * IS display order — no separate order-index bookkeeping, no
 * new/existing-row tracking needed. */
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
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    startTransition(async () => {
      const result = await uploadImage(fd);
      if (result.error) setError(result.error);
      else if (result.url) setUrls((prev) => [...prev, result.url!]);
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
        {isPending ? "Uploading…" : "Add Image"}
        <input type="file" accept="image/*" className="hidden" onChange={handleFile} disabled={isPending} />
      </label>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
