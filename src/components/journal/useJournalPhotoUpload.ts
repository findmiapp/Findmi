"use client";

import { useState } from "react";
import { uploadJournalPhoto, removeJournalPhoto, setJournalCoverPhoto } from "@/app/(public)/my-world/journal/actions";

export interface JournalPhotoState {
  id: string;
  url: string;
  isCover: boolean;
}

export interface JournalUploadBatch {
  total: number;
  completed: number;
}

/** Journal V1 (visual convergence pass) — the shared photo-upload/manage
 * logic behind both Create (JournalCreateWizard) and Edit
 * (JournalEditForm), previously duplicated between them. `ensureEntryId`
 * is how the two callers differ: Create's lazily creates a draft row on
 * first real use, Edit's trivially resolves the already-known entryId —
 * this hook doesn't need to know which.
 *
 * `batch` is real CLIENT-SIDE state (never a database poll): `total` is
 * how many files were selected in this pick, `completed` increments only
 * on a real successful upload (never for a failed one), and `batch`
 * itself clears the instant every file in the pick has been attempted —
 * success or failure — so the aggregate tile never lingers. Failures are
 * surfaced once, after the batch finishes, without ever claiming a failed
 * file as uploaded; every photo that DID succeed stays in `photos`
 * regardless of what the rest of the batch does. */
export function useJournalPhotoUpload(initialPhotos: JournalPhotoState[], ensureEntryId: () => Promise<string | null>) {
  const [photos, setPhotos] = useState<JournalPhotoState[]>(initialPhotos);
  const [batch, setBatch] = useState<JournalUploadBatch | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    // Mobile Picker Repair pass — a batch already in flight is the
    // double-submit guard itself: JournalPhotoStrip disables the trigger
    // button/input whenever `batch` is non-null, so this can only be
    // reached once per batch. `batch` is also set HERE, synchronously,
    // before the first `await` — not after `ensureEntryId` resolves, as
    // before — so the visible "Uploading…" tile appears the instant a
    // real `change` event reaches React, never only once the network
    // round-trip to create/resolve the draft finishes (the same
    // "prove the event actually fired" reasoning MemberImageField's own
    // `preparing` state uses).
    if (batch) return;
    setError(null);
    const fileArray = Array.from(files);
    setBatch({ total: fileArray.length, completed: 0 });

    const id = await ensureEntryId();
    if (!id) {
      setBatch(null);
      return;
    }

    let completed = 0;
    let failed = 0;

    for (const file of fileArray) {
      const formData = new FormData();
      formData.set("file", file);
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await uploadJournalPhoto(id, formData);
        if ("error" in result) {
          failed += 1;
        } else {
          completed += 1;
          setPhotos((prev) => [...prev, { id: result.id, url: result.url, isCover: prev.length === 0 }]);
          setBatch({ total: fileArray.length, completed });
        }
      } catch {
        // A dropped connection mid-upload throws rather than returning
        // {error} — treated as one more failed file, never a crash (same
        // reasoning as MemberImageField's own upload try/catch).
        failed += 1;
      }
    }
    setBatch(null);
    if (failed > 0) {
      setError(`${failed} photo${failed === 1 ? "" : "s"} couldn't be uploaded. ${completed > 0 ? "The rest were saved." : ""}`.trim());
    }
  }

  async function handleRemove(mediaId: string) {
    const id = await ensureEntryId();
    if (!id) return;
    const wasCover = photos.find((p) => p.id === mediaId)?.isCover ?? false;
    setPhotos((prev) => prev.filter((p) => p.id !== mediaId));
    const result = await removeJournalPhoto(id, mediaId);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    if (wasCover) setPhotos((prev) => (prev.length > 0 ? prev.map((p, i) => ({ ...p, isCover: i === 0 })) : prev));
  }

  async function handleSetCover(mediaId: string) {
    const id = await ensureEntryId();
    if (!id) return;
    setPhotos((prev) => prev.map((p) => ({ ...p, isCover: p.id === mediaId })));
    await setJournalCoverPhoto(id, mediaId);
  }

  return { photos, batch, error, setError, handleFiles, handleRemove, handleSetCover };
}
