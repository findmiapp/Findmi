"use client";

import { useState, useTransition } from "react";
import { uploadMemberBusinessImage } from "../actions";

/** Member-facing counterpart to admin's ImageField.tsx — same preview +
 * upload-button shape, but calls uploadMemberBusinessImage (gated by
 * requireBusinessMember, not requireAdmin) so it actually works for a
 * real business member instead of silently failing with "Unauthorized."
 * No URL-pasting requirement: the resulting Storage URL is carried in a
 * hidden input under `name`, submitted as part of the page's outer
 * updateMemberBusiness form exactly like every other field on it — this
 * component has no submit/save behavior of its own. `accept="image/*"`
 * on the native file input is what gives the mobile-friendly photo
 * picker (camera roll / camera) for free, no extra UI needed. */
export default function MemberImageField({
  businessId,
  label,
  name,
  defaultValue,
}: {
  businessId: string;
  label: string;
  name: string;
  defaultValue: string | null;
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
      const result = await uploadMemberBusinessImage(businessId, fd);
      if (result.error) setError(result.error);
      else if (result.url) setUrl(result.url);
    });
  }

  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      <div className="flex flex-col gap-2">
        {url && (
          <div className="relative h-24 w-24 overflow-hidden rounded-xl border border-black/10 bg-black/5">
            {/* eslint-disable-next-line @next/next/no-img-element -- preview only, a live Storage URL */}
            <img src={url} alt="" className="h-full w-full object-cover" />
          </div>
        )}
        <input type="hidden" name={name} value={url} />
        <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-xs font-semibold text-ink/70 transition hover:border-ink/30">
          {isPending ? "Uploading…" : url ? "Replace Image" : "Choose Image"}
          <input type="file" accept="image/*" className="hidden" onChange={handleFile} disabled={isPending} />
        </label>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}
