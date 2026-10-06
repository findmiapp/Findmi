"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { uploadMemberBusinessImage } from "../actions";
import { imageVariantUrl } from "@/lib/image-variants";

/** Member-facing counterpart to admin's ImageField.tsx — same preview +
 * upload-button shape, but calls uploadMemberBusinessImage (gated by
 * requireBusinessMember, not requireAdmin) so it actually works for a
 * real business member instead of silently failing with "Unauthorized."
 * No URL-pasting requirement: the resulting Storage URL is carried in a
 * hidden input under `name`, submitted as part of the page's outer
 * updateMemberBusiness form exactly like every other field on it — this
 * component has no submit/save behavior of its own. `accept="image/*"`
 * on the native file input is what gives the mobile-friendly photo
 * picker (camera roll / camera) for free, no extra UI needed.
 *
 * Product Image Upload Crash fix — this field is single-image by design
 * everywhere it's used (Logo, Cover, and Product image via
 * ProductFieldsForm — products.image_url is a single column, never a
 * gallery). Two hardening changes: (1) `multiple={false}` is now
 * explicit, and a selection that somehow still yields more than one file
 * (some mobile photo pickers ignore the missing `multiple` attribute) is
 * rejected with a clear message rather than silently uploading only the
 * first one; (2) the upload call is now wrapped in try/catch. Previously
 * an unexpected throw from uploadMemberBusinessImage (a Server Action —
 * a dropped connection mid-upload, not a normal returned {error}) was
 * unhandled inside this startTransition callback; for an async
 * transition, React surfaces that to the nearest Error Boundary, and
 * this app has no error.tsx anywhere, so it took down the whole page
 * with Next.js's generic production crash screen instead of just
 * failing this one upload.
 *
 * Launch Stability pass — Save-During-Upload race fix. The parent
 * Appearance form has no way to know an upload is still in flight (the
 * hidden `name` input only updates once `setUrl` runs, after the upload
 * resolves), so clicking Save mid-upload silently submitted whatever
 * flyer_image_url value existed BEFORE this selection — not an error,
 * just the wrong (stale) value, with nothing to show for it. `onPendingChange`
 * lets the parent form disable Save for exactly as long as `isPending` is
 * true, closing that window without touching the upload/storage path
 * itself.
 *
 * Launch Stability pass — Upload Error Visibility. A real production
 * upload failure (see imageUploadValidation.ts's own header comment) went
 * unnoticed on mobile because the only feedback was a single small
 * text-xs red line easy to miss below the button. The error itself
 * already carries a specific, useful reason (uploadMemberBusinessImage
 * always returns one via validateImageFile, never a generic message when
 * a real one exists) — only its visual weight changes here, to a
 * bordered/backgrounded block with a clear heading, matching the
 * red-banner pattern already used for page-level errors elsewhere in this
 * same Business Manager.
 *
 * Launch Stability pass — Native File-Picker Boundary Hardening. A real
 * production reproduction (Android Chrome, Google Photos as the external
 * picker) showed the OS-level selection completing successfully — Google
 * Photos itself confirmed the pick — but returning to the tab produced
 * zero reaction anywhere in this component: no "Uploading…" state, no
 * error, nothing. Runtime logs confirmed no Server Action request was
 * ever made, meaning the native `change` event itself never reached
 * React. The two most likely contributors, both addressed here:
 *
 * (1) The input was triggered via a wrapping <label>, and hidden with
 *     `className="hidden"` (display:none). Some Android Chrome/WebView
 *     versions are documented to lose the pending-selection association
 *     for a display:none file input when an external Activity (a
 *     separate app, like Google Photos — not an in-page OS dialog) is
 *     what returns control to the tab. The input is now triggered
 *     explicitly via a real <button type="button"> calling
 *     inputRef.current.click(), and hidden via the standard `sr-only`
 *     technique (clipped/off-screen, not display:none) instead — already
 *     an established pattern elsewhere in this codebase.
 * (2) The Business Manager page can have several Appearance rows (each
 *     its own AppearanceFieldsForm/MemberImageField) mounted
 *     simultaneously in the DOM even when visually collapsed (a closed
 *     <details> still mounts its children — it only hides them). This
 *     component never used a static id, so cross-row targeting wasn't
 *     possible, but every instance now gets its own useId()-derived id
 *     for good measure/future-proofing regardless.
 *
 * Also new: a `preparing` state, set the instant handleFile receives a
 * real File — before startTransition/before uploadMemberBusinessImage is
 * ever called — purely so a real `change` event reaching React is always
 * visibly distinguishable from the native picker silently doing nothing.
 * Always cleared in the upload's own finally, so it can never get stuck. */
export default function MemberImageField({
  businessId,
  label,
  name,
  defaultValue,
  onPendingChange,
}: {
  businessId: string;
  label: string;
  name: string;
  defaultValue: string | null;
  onPendingChange?: (pending: boolean) => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(defaultValue ?? "");
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    onPendingChange?.(isPending);
    // onPendingChange is a setState function passed fresh from the parent
    // on every render — depending on it too would re-fire this effect
    // every render for no reason; only a real isPending transition matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPending]);

  function openPicker() {
    // Defensive reset BEFORE opening the picker — if browser/WebView
    // state was ever left holding a stale value from an earlier attempt
    // (e.g. one where the change event failed to fire at all), this
    // guarantees the upcoming selection is treated as new regardless.
    if (inputRef.current) inputRef.current.value = "";
    inputRef.current?.click();
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (files.length > 1) {
      setError("Please choose a single image.");
      e.target.value = "";
      return;
    }
    const file = files[0];
    // Reset AFTER reading — the File reference above is already held
    // independently of the input's own value, so this is safe and never
    // discards it. Guarantees selecting this exact same file again later
    // still fires a fresh change event.
    e.target.value = "";
    setError(null);
    // Proof that the native change event actually reached React, visible
    // before any network call — see this file's own header comment.
    setPreparing(true);
    const fd = new FormData();
    fd.set("file", file);
    startTransition(async () => {
      try {
        const result = await uploadMemberBusinessImage(businessId, fd);
        if (result.error) setError(result.error);
        else if (result.url) setUrl(result.url);
      } catch {
        setError("Upload failed. Please try again.");
      } finally {
        setPreparing(false);
      }
    });
  }

  const buttonLabel = isPending ? "Uploading…" : preparing ? "Preparing photo…" : url ? "Replace Image" : "Choose Image";

  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      <div className="flex flex-col gap-2">
        {url && (
          <div className="relative h-24 w-24 overflow-hidden rounded-xl border border-black/10 bg-black/5">
            {/* eslint-disable-next-line @next/next/no-img-element -- preview only, a live Storage URL */}
            <img src={imageVariantUrl(url, "card")} alt="" className="h-full w-full object-cover" />
          </div>
        )}
        <input type="hidden" name={name} value={url} />
        <button
          type="button"
          onClick={openPicker}
          disabled={isPending}
          className="inline-flex w-fit items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-xs font-semibold text-ink/70 transition hover:border-ink/30 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {buttonLabel}
        </button>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept="image/*"
          multiple={false}
          aria-label={label}
          className="sr-only"
          onChange={handleFile}
          disabled={isPending}
        />
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
            <p className="text-sm font-semibold text-red-700">Photo couldn&rsquo;t be uploaded</p>
            <p className="mt-0.5 text-xs text-red-600">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
