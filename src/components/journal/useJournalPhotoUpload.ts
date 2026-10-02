"use client";

import { useState } from "react";
import { uploadJournalPhoto, removeJournalPhoto, setJournalCoverPhoto } from "@/app/(public)/my-world/journal/actions";
import { preprocessImageForUpload } from "@/lib/imagePreprocessing";
import { createConcurrencyLimiter } from "@/lib/concurrency";

export interface JournalPhotoState {
  id: string;
  url: string;
  isCover: boolean;
}

export interface JournalUploadBatch {
  total: number;
  completed: number;
}

// Image Performance V1 — two independent concurrency limits, not one.
// PREPARE bounds how many photos are being decoded/resized in memory at
// once (a phone's own camera-original decode is the expensive, memory-
// heavy step); UPLOAD bounds how many network requests are in flight at
// once. A photo moves from prepare -> upload as soon as ITS OWN prep
// finishes, independent of its siblings, so uploads start well before the
// whole batch has been prepared — never "decode all 20, then start
// uploading." Both are plain integers, not a package.
const MAX_PREPARE_CONCURRENCY = 2;
const MAX_UPLOAD_CONCURRENCY = 3;

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
    // before — so the visible progress tile appears the instant a real
    // `change` event reaches React, never only once the network round-trip
    // to create/resolve the draft finishes (the same "prove the event
    // actually fired" reasoning MemberImageField's own `preparing` state
    // uses).
    if (batch) return;
    setError(null);
    const fileArray = Array.from(files);
    setBatch({ total: fileArray.length, completed: 0 });

    const resolvedId = await ensureEntryId();
    if (!resolvedId) {
      setBatch(null);
      return;
    }
    const id: string = resolvedId;

    // Image Performance V1 — Photo Order Is Non-Negotiable. Concurrent
    // uploads mean completion order is no longer selection order, so the
    // selected A/B/C/D must stay A/B/C/D regardless of which one's network
    // request happens to finish first. `existingCount`/`existingIds` are
    // snapshotted once, before any upload in this batch starts:
    // `existingCount` becomes each photo's base display_order (its fixed
    // position in THIS selection is added on top, so two photos in the
    // same batch can never collide, and nothing already in the entry is
    // ever renumbered); `existingIds` lets `commit()` below always rebuild
    // `photos` as "whatever of the pre-batch set still exists" + "this
    // batch's own results, in selection order" — correct even if the owner
    // removes an older photo while this batch is still running.
    const existingCount = photos.length;
    const hadExistingPhotos = existingCount > 0;
    const existingIds = new Set(photos.map((p) => p.id));

    const prepareLimit = createConcurrencyLimiter(MAX_PREPARE_CONCURRENCY);
    const uploadLimit = createConcurrencyLimiter(MAX_UPLOAD_CONCURRENCY);

    const results: (JournalPhotoState | null)[] = new Array(fileArray.length).fill(null);
    let completed = 0;
    let failed = 0;

    function commit() {
      setPhotos((prev) => {
        const stillExisting = prev.filter((p) => existingIds.has(p.id));
        return [...stillExisting, ...results.filter((p): p is JournalPhotoState => p !== null)];
      });
    }

    async function runOne(file: File, index: number) {
      try {
        const prepared = await prepareLimit(() => preprocessImageForUpload(file));
        const formData = new FormData();
        formData.set("file", prepared);
        formData.set("displayOrder", String(existingCount + index));
        const result = await uploadLimit(() => uploadJournalPhoto(id, formData));
        if ("error" in result) {
          failed += 1;
        } else {
          completed += 1;
          results[index] = { id: result.id, url: result.url, isCover: result.isCover };
          commit();
          setBatch({ total: fileArray.length, completed });
        }
      } catch {
        // A dropped connection (or a preprocessing bug) throws rather than
        // returning {error} — treated as one more failed file, never a
        // crash, and never corrupting the rest of the batch's results
        // (same reasoning as MemberImageField's own upload try/catch).
        failed += 1;
      }
    }

    // Every file's own pipeline starts "at once" here, but the two
    // limiters above are what actually bound real concurrent work — this
    // is not an unlimited Promise.all across the network/CPU, just the
    // scheduling of up to 20+ small state machines that each wait their
    // turn for a prepare slot, then an upload slot.
    await Promise.all(fileArray.map((file, index) => runOne(file, index)));

    setBatch(null);

    // Cover failover — if this entry started with zero photos and the
    // intended cover (selection index 0, display_order 0) is the one photo
    // that failed, no row ever got is_cover. Patch it onto whichever
    // succeeded photo has the earliest selection index, reusing the exact
    // same setJournalCoverPhoto action the manual "make cover" star uses —
    // no new server logic for this edge case.
    if (!hadExistingPhotos) {
      const settled = results.filter((p): p is JournalPhotoState => p !== null);
      const hasCover = settled.some((p) => p.isCover);
      if (settled.length > 0 && !hasCover) {
        const fallbackCover = settled[0];
        await setJournalCoverPhoto(id, fallbackCover.id);
        setPhotos((prev) => prev.map((p) => ({ ...p, isCover: p.id === fallbackCover.id })));
      }
    }

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
