"use client";

import { useId, useRef, useState } from "react";

/** Final Brand Build V1 UX cleanup — the Review Your Brand Logo / Cover
 * Image field. Always rendered, whether or not the Build found an image:
 *
 *   - found (verified) image → its preview, the existing "Use This …"
 *     checkbox (only a checkbox is submitted; WHICH image it means still
 *     comes from the signed draft), and a Replace control;
 *   - nothing found → a clear empty state with "Add Logo" / "Add Cover
 *     Image".
 *
 * An owner-chosen file travels with the create form itself (`fileName`)
 * and goes through the same validateImageFile → storePublicImage pipeline
 * as MemberImageField's upload (see createMemberBusiness) — no parallel
 * upload system, and nothing is stored before the Business exists. A
 * chosen file always wins over the found image. The local preview is a
 * data: URL (the CSP allows data:, not blob:). Same picker hardening as
 * MemberImageField: a real <button> opens an sr-only (never display:none)
 * file input. */
export default function BrandImageInput({
  role,
  label,
  foundPreview,
  useName,
  useDefault,
  fileName,
}: {
  role: "logo" | "cover";
  label: string;
  foundPreview: string | null;
  useName: string;
  useDefault: boolean;
  fileName: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<{ name: string; preview: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const noun = role === "logo" ? "Logo" : "Cover Image";

  function openPicker() {
    inputRef.current?.click();
  }

  function clearChosen() {
    if (inputRef.current) inputRef.current.value = "";
    setChosen(null);
    setError(null);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (files.length > 1) {
      e.target.value = "";
      setChosen(null);
      setError("Please choose a single image.");
      return;
    }
    const file = files[0];
    // Same 5MB cap the server enforces (imageUploadValidation.ts) — caught
    // here so the owner isn't sent back to an error after submitting.
    if (file.size > 5 * 1024 * 1024) {
      e.target.value = "";
      setChosen(null);
      setError("That image is over 5MB. Please choose a smaller one.");
      return;
    }
    setError(null);
    setChosen({ name: file.name, preview: null });
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : null;
      setChosen((current) => (current && current.name === file.name ? { name: file.name, preview: result } : current));
    };
    reader.readAsDataURL(file);
  }

  const preview = chosen ? chosen.preview : foundPreview;
  const source = chosen ? "Your upload" : foundPreview ? "From your website" : role === "logo" ? "No logo found" : "No cover image found";
  const frame =
    role === "logo"
      ? "relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-black/5 bg-white"
      : "relative flex aspect-[16/9] w-full items-center justify-center overflow-hidden rounded-xl bg-black/5";
  const buttonClass =
    "inline-flex w-fit items-center rounded-full border border-black/10 px-4 py-2 text-xs font-semibold text-ink/70 transition hover:border-ink/30";

  const image = preview ? (
    // eslint-disable-next-line @next/next/no-img-element -- local/data preview only
    <img src={preview} alt={chosen ? `Your ${noun.toLowerCase()}` : `${noun} found on your website`} className={role === "logo" ? "h-full w-full object-contain" : "h-full w-full object-cover"} />
  ) : (
    <span className="px-2 text-center text-label text-subtle">{chosen ? "Preview…" : `No ${noun.toLowerCase()}`}</span>
  );
  const empty = !preview && !chosen;

  return (
    <div data-brand-image={role} data-state={chosen ? "uploaded" : foundPreview ? "found" : "empty"} className={`rounded-2xl border p-3 ${empty ? "border-dashed border-black/15" : "border-black/10"}`}>
      <div className={role === "logo" ? "flex items-center gap-3" : "flex flex-col gap-2"}>
        <span className={frame}>{image}</span>
        <span className={role === "logo" ? "min-w-0 flex-1" : "flex flex-wrap items-center justify-between gap-3"}>
          <span className="block min-w-0">
            <span className="block text-body font-medium text-primary">{label}</span>
            <span className="block text-metadata text-subtle">{source}</span>
          </span>
          <span className={`flex flex-wrap items-center gap-2 ${role === "logo" ? "mt-2" : ""}`}>
            {foundPreview && !chosen && (
              <label className="flex items-center gap-2 text-metadata font-semibold text-primary">
                <input type="checkbox" name={useName} value="1" defaultChecked={useDefault} className="h-5 w-5 accent-findmi" />
                {role === "logo" ? "Use This Logo" : "Use This Cover"}
              </label>
            )}
            <button type="button" onClick={openPicker} className={buttonClass}>
              {chosen || foundPreview ? `Replace ${noun}` : `Add ${noun}`}
            </button>
            {chosen && (
              <button type="button" onClick={clearChosen} className={buttonClass}>
                Remove
              </button>
            )}
          </span>
        </span>
      </div>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        name={fileName}
        accept="image/*"
        multiple={false}
        aria-label={`${chosen || foundPreview ? "Replace" : "Add"} ${noun}`}
        className="sr-only"
        onChange={handleFile}
      />
      {error && (
        <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
          <p className="text-sm font-semibold text-red-700">Photo couldn&rsquo;t be added</p>
          <p className="mt-0.5 text-xs text-red-600">{error}</p>
        </div>
      )}
    </div>
  );
}
