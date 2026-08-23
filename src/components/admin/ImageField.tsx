"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { uploadImage } from "@/lib/admin/upload";

/** A URL text field plus an optional file-upload shortcut that fills it in.
 * Either path works: paste a URL directly, or upload a file and the field
 * fills itself in with the resulting Storage URL. */
export default function ImageField({
  label,
  name,
  defaultValue,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
}) {
  const [url, setUrl] = useState(defaultValue ?? "");
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
      else if (result.url) setUrl(result.url);
    });
  }

  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      <div className="flex flex-col gap-2">
        {url && (
          <div className="relative h-28 w-28 overflow-hidden rounded-xl border border-black/10 bg-black/5">
            {/* eslint-disable-next-line @next/next/no-img-element -- preview only, arbitrary/mid-edit URLs shouldn't need next/image's remote-host allowlist */}
            <img src={url} alt="" className="h-full w-full object-cover" />
          </div>
        )}
        <input
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
