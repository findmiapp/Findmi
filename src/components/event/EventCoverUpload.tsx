"use client";

import { useRef, useState, useTransition } from "react";
import { preprocessImageForUpload } from "@/lib/imagePreprocessing";

export type EventCoverUploadAction = (form: FormData) => Promise<{ ok: true; url: string } | { ok: false; error: string }>;

/** Event artwork — Upload Image / Replace Image from the device. One control
 * for every place Event artwork is confirmed (Business Event Import, Admin
 * Event Import): the file is reduced on the device when large, then stored
 * through the ONE Event image path on the server (storeUploadedEventImage —
 * real-bytes validation, HEIC conversion, Event-image fit, Findmi storage),
 * and the resulting Findmi URL becomes the Event's image. Never requires a
 * detected image first. The caller passes its own authorized upload action
 * and owns the preview / Remove. */
export default function EventCoverUpload({
  upload,
  onUploaded,
  hasImage,
  className = "",
}: {
  upload: EventCoverUploadAction;
  onUploaded: (url: string) => void;
  /** Label reads "Replace Image" when an image is already chosen. */
  hasImage: boolean;
  className?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  function choose(file: File | undefined) {
    if (!file) return;
    setError(null);
    start(async () => {
      try {
        const form = new FormData();
        form.append("image", await preprocessImageForUpload(file));
        const result = await upload(form);
        if (result.ok) onUploaded(result.url);
        else setError(result.error);
      } catch {
        setError("Couldn't upload that image. Please try again.");
      }
    });
  }

  return (
    <div className={className}>
      <label className={`inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full border border-black/10 bg-white px-4 text-sm font-semibold text-ink transition hover:border-black/25 ${pending ? "pointer-events-none opacity-60" : ""}`}>
        {pending ? "Uploading…" : hasImage ? "Replace Image" : "Upload Image"}
        <input
          ref={input}
          type="file"
          accept="image/*,.heic,.heif"
          className="sr-only"
          disabled={pending}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            choose(file);
          }}
        />
      </label>
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
