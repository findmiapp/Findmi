"use client";

import { Fragment, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { uploadMemberBusinessImage } from "../actions";
import { imageVariantUrl } from "@/lib/image-variants";
import { galleryUploadErrorMessage, uploadGalleryFiles } from "@/lib/gallery-upload";
import SortableImageGrid from "@/components/SortableImageGrid";
import { useUnsavedChangesGuard } from "@/components/UnsavedChangesGuard";

/** Business owner Photos (Gallery) editor — the field half of the Photos
 * destination's form. Every URL renders as a hidden input sharing `name`, so
 * the server reads the final list in one shot via formData.getAll(name) and
 * DOM order is display order (updateBusinessGallery saves it as
 * display_order 0..n-1). Adding, removing and reordering only change this
 * local list; nothing is stored until the owner presses Save Photos.
 *
 * Reorder: SortableImageGrid (drag from each photo's grip handle only, or its
 * Move menu, or the keyboard). Unsaved changes — new uploads, removals, a
 * new order — are anything that differs from what the page loaded (the
 * saved gallery), and leaving with them asks first (the shared
 * UnsavedChangesGuard hook). After a save the page re-renders with the saved
 * list as `initialUrls`, so the form is clean again; after a failed save it
 * still differs, so the edits stay here, marked unsaved, ready to retry. */
export default function MemberGalleryField({
  businessId,
  name,
  initialUrls,
}: {
  businessId: string;
  name: string;
  initialUrls: string[];
}) {
  const nextId = useRef(0);
  const makeItem = (url: string) => ({ id: `photo-${nextId.current++}`, url });
  const [items, setItems] = useState(() => initialUrls.map(makeItem));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const urls = items.map((it) => it.url);
  const dirty = urls.length !== initialUrls.length || urls.some((u, i) => u !== initialUrls[i]);
  useUnsavedChangesGuard(dirty);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setError(null);
    // isPending stays true for this whole transition, so the file input
    // below (disabled={isPending}) can't be used again mid-upload, and Save
    // waits until the batch is done.
    startTransition(async () => {
      // Each file on its own (lib/gallery-upload.ts): photos reduced first,
      // a rejected upload caught, one failure never stopping or discarding
      // the others; successes are kept as soon as each one resolves.
      const failures = await uploadGalleryFiles(files, {
        upload: (fd) => uploadMemberBusinessImage(businessId, fd),
        onUploaded: (url) => setItems((prev) => [...prev, makeItem(url)]),
      });
      setError(galleryUploadErrorMessage(failures));
    });
  }

  function removeAt(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  function moveTo(from: number, to: number) {
    setItems((prev) => {
      if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  const addButton = (
    <label
      className={`flex h-full w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-black/15 text-ink/50 transition hover:border-findmi/50 hover:text-findmi-700 ${
        isPending ? "pointer-events-none opacity-60" : ""
      }`}
    >
      <span className="text-2xl leading-none">+</span>
      <span className="text-metadata font-semibold">{isPending ? "Uploading…" : "Add Photos"}</span>
      <input type="file" accept="image/*" multiple className="sr-only" onChange={handleFile} disabled={isPending} />
    </label>
  );

  return (
    <div className="flex flex-col gap-3">
      {items.map(({ id, url }) => (
        <Fragment key={id}>
          <input type="hidden" name={name} value={url} />
        </Fragment>
      ))}

      <div className="flex min-h-10 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="text-metadata text-muted" aria-live="polite">
          {items.length === 1 ? "1 photo" : `${items.length} photos`}
          {isPending ? " · Uploading…" : dirty ? " · " : ""}
          {!isPending && dirty && <span className="font-semibold text-amber-700">Unsaved changes</span>}
        </p>
        {dirty && <SaveButton compact disabled={isPending} />}
      </div>

      {items.length === 0 ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          <div className="aspect-square">{addButton}</div>
        </div>
      ) : (
        <SortableImageGrid
          items={items.map((it) => ({ id: it.id, src: imageVariantUrl(it.url, "card") }))}
          onMove={moveTo}
          onRemove={removeAt}
          trailing={addButton}
        />
      )}

      {items.length > 1 && (
        <p className="text-metadata text-muted">The first photo shows first on your public page. Drag a photo by its handle, or use its ••• menu, to change the order.</p>
      )}
      {error && <p className="text-metadata text-red-600">{error}</p>}

      <SaveButton disabled={isPending || !dirty} />
    </div>
  );
}

/** Save Photos — the explicit save. Waits for uploads in progress, and shows
 * Saving… while the form submits. */
function SaveButton({ disabled, compact }: { disabled: boolean; compact?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className={
        compact
          ? "flex h-10 shrink-0 items-center justify-center rounded-lg bg-findmi px-4 text-button font-bold text-white transition hover:bg-findmi-600 disabled:opacity-50"
          : "mt-1 flex h-10 w-full items-center justify-center rounded-lg bg-findmi text-button font-bold text-white transition hover:bg-findmi-600 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
      }
    >
      {pending ? "Saving…" : "Save Photos"}
    </button>
  );
}
