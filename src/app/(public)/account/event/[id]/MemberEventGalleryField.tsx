"use client";

import { useState, useTransition } from "react";
import { uploadMemberEventImage } from "../actions";

/** Event-Manager counterpart to
 * account/business/[id]/MemberGalleryField.tsx — identical shape, calling
 * uploadMemberEventImage instead of the business version. Used for both
 * the event gallery and the "About the Venue" gallery (two separate
 * instances, different `name`s — see updateMemberEventImages). */
export default function MemberEventGalleryField({
  eventId,
  name,
  initialUrls,
}: {
  eventId: string;
  name: string;
  initialUrls: string[];
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
        const result = await uploadMemberEventImage(eventId, fd);
        if (result.error) lastError = result.error;
        else if (result.url) setUrls((prev) => [...prev, result.url!]);
      }
      if (lastError) setError(lastError);
    });
  }

  function removeAt(i: number) {
    setUrls((prev) => prev.filter((_, idx) => idx !== i));
  }

  return (
    <div>
      {urls.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {urls.map((url, i) => (
            <div key={`${url}-${i}`} className="relative h-20 w-20 overflow-hidden rounded-xl border border-black/10 bg-black/5">
              <input type="hidden" name={name} value={url} />
              {/* eslint-disable-next-line @next/next/no-img-element -- preview only, a live Storage URL */}
              <img src={url} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => removeAt(i)}
                aria-label="Remove"
                className="absolute inset-x-0 bottom-0 bg-black/55 py-0.5 text-xs font-bold text-white"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-xs font-semibold text-ink/70 transition hover:border-ink/30">
        {isPending ? "Uploading…" : "Add Image"}
        <input type="file" accept="image/*" multiple className="hidden" onChange={handleFile} disabled={isPending} />
      </label>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
