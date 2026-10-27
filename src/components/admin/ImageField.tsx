"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { uploadImage } from "@/lib/admin/upload";
import { imageVariantUrl } from "@/lib/image-variants";

/** A URL text field plus an optional file-upload shortcut that fills it in.
 * Either path works: paste a URL directly, or upload a file and the field
 * fills itself in with the resulting Storage URL. */
export default function ImageField({
  label,
  name,
  defaultValue,
  onChange,
  variant = "url",
  hint,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  /** Pages + Sections V1B — "media": the image itself leads (wide preview,
   * Upload / Change / Remove), with the stored link behind "Use A Link
   * Instead". Same field name and value either way. Default "url" is the
   * original layout every existing caller keeps. */
  variant?: "url" | "media";
  hint?: string;
  /** Optional — lets a parent that renders a live preview (e.g.
   * BulletinForm) track the current URL too, instead of only the input
   * this already renders. Every existing caller omits this and is
   * unaffected. */
  onChange?: (url: string) => void;
}) {
  const [url, setUrlState] = useState(defaultValue ?? "");
  const setUrl = (value: string) => {
    setUrlState(value);
    onChange?.(value);
  };
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
      // Product image upload crash fix — uploadImage() itself always
      // resolves to {url} or {error}, but the Server Action CALL can
      // still reject outright (a network drop, a platform-level request
      // rejection for an oversized/slow upload, any other transport
      // failure before uploadImage's own code ever runs) — previously
      // unhandled here, so that rejection propagated out of this
      // transition as an uncaught exception and crashed the whole page
      // to Next's generic "Application error" screen instead of leaving
      // the form usable. Caught the same way a validation error already
      // is: set the existing error state, change nothing else.
      try {
        const result = await uploadImage(fd);
        if (result.error) setError(result.error);
        else if (result.url) setUrl(result.url);
      } catch {
        setError("Upload failed. Please check your connection and try again.");
      }
    });
  }

  if (variant === "media") {
    return (
      <div>
        <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
        <input type="hidden" name={name} value={url} />
        {url ? (
          <div className="relative aspect-[16/9] w-full max-w-sm overflow-hidden rounded-xl border border-black/10 bg-black/5">
            {/* eslint-disable-next-line @next/next/no-img-element -- preview only, arbitrary/mid-edit URLs shouldn't need next/image's remote-host allowlist */}
            <img src={imageVariantUrl(url, "card")} alt="" className="h-full w-full object-cover" />
          </div>
        ) : (
          <div className="flex aspect-[16/9] w-full max-w-sm items-center justify-center rounded-xl border border-dashed border-black/15 bg-black/[0.02] text-xs text-ink/40">No image</div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="inline-flex min-h-10 cursor-pointer items-center rounded-full border border-black/10 px-4 text-xs font-semibold text-ink/70 transition hover:border-ink/30">
            {isPending ? "Uploading…" : url ? "Change" : "Upload Image"}
            <input type="file" accept="image/*" className="hidden" onChange={handleFile} disabled={isPending} />
          </label>
          {url && (
            <button type="button" onClick={() => setUrl("")} className="inline-flex min-h-10 items-center rounded-full px-3 text-xs font-semibold text-red-600 hover:underline">
              Remove
            </button>
          )}
        </div>
        <details className="mt-2">
          <summary className="cursor-pointer select-none text-xs font-semibold text-ink/50">Use A Link Instead</summary>
          <input autoCapitalize="none"
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            aria-label={`${label} link`}
            className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
          />
        </details>
        {hint && <p className="mt-1.5 text-xs text-ink/45">{hint}</p>}
        {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      <div className="flex flex-col gap-2">
        {url && (
          <div className="relative h-28 w-28 overflow-hidden rounded-xl border border-black/10 bg-black/5">
            {/* eslint-disable-next-line @next/next/no-img-element -- preview only, arbitrary/mid-edit URLs shouldn't need next/image's remote-host allowlist */}
            <img src={imageVariantUrl(url, "card")} alt="" className="h-full w-full object-cover" />
          </div>
        )}
        <input autoCapitalize="none"
          type="text"
          name={name}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink/35 focus:border-ink/30 focus:outline-none"
        />
        <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-xs font-semibold text-ink/70 transition hover:border-ink/30">
          {isPending ? "Uploading…" : "Upload Image"}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFile}
            disabled={isPending}
          />
        </label>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}
