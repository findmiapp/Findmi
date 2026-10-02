"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import {
  uploadJournalPhoto,
  removeJournalPhoto,
  authorizeJournalPhotoUploads,
  finalizeJournalPhoto,
  discardJournalUpload,
  reorderJournalMedia,
  type JournalUploadAuthorization,
} from "@/app/(public)/my-world/journal/actions";
import { preprocessImageForUpload, isHeicLike, isPng } from "@/lib/imagePreprocessing";
import { createConcurrencyLimiter } from "@/lib/concurrency";
import { getBrowserSupabase } from "@/lib/supabase/client";

// Journal Photo Experience V2 — mirrors the literal bucket id
// JOURNAL_MEDIA_BUCKET exports from lib/journal.ts. That module pulls in
// server-only Supabase helpers and must never be imported from a "use
// client" file, so the bucket id is duplicated here as a plain string
// rather than shared via import.
const JOURNAL_MEDIA_BUCKET = "journal-media";

const MAX_PREPARE_CONCURRENCY = 2;
const MAX_UPLOAD_CONCURRENCY = 3;

export type JournalPhotoStatus = "local" | "preparing" | "uploading" | "saving" | "complete" | "error";

export interface JournalPhotoItem {
  /** Stable identity for the whole lifecycle of this photo — generated
   * once at selection time for a new photo, or set to the real media id
   * for one loaded already-persisted. Never changes as status advances,
   * so React keys and dnd-kit's own sortable identity stay stable through
   * local -> uploading -> complete. */
  localId: string;
  status: JournalPhotoStatus;
  /** An object URL (local/preparing/uploading/saving) or a real signed
   * read URL (complete) — always something <Image> can render right now. */
  previewUrl: string;
  isObjectUrl: boolean;
  file?: File;
  mediaId?: string;
  storagePath?: string;
  errorMessage?: string;
}

export interface JournalInitialPhoto {
  id: string;
  url: string;
  isCover: boolean;
}

/** Legacy-data reconciliation — a photo's cover status before this pass
 * lived entirely in is_cover (set via the old setJournalCoverPhoto star
 * button), independent of display_order. V2's model treats "whichever
 * photo is first in the grid" as the cover, so an existing entry whose
 * real cover isn't already first has it moved to the front on load — a
 * one-time visual correction; the first reorder/add/remove afterward
 * persists it back to the database via persistOrder. Array.prototype.sort
 * is spec-stable, so every non-cover photo keeps its existing relative
 * (display_order) order. */
function buildInitialItems(initial: JournalInitialPhoto[]): JournalPhotoItem[] {
  const sorted = [...initial].sort((a, b) => Number(b.isCover) - Number(a.isCover));
  return sorted.map((p) => ({
    localId: p.id,
    status: "complete",
    previewUrl: p.url,
    isObjectUrl: false,
    mediaId: p.id,
  }));
}

function isActiveStatus(status: JournalPhotoStatus): boolean {
  return status === "local" || status === "preparing" || status === "uploading" || status === "saving";
}

/** Journal Photo Experience V2 — replaces V1's single sequential/bounded
 * upload loop with an item-based state machine: every selected photo
 * becomes a visible grid item INSTANTLY (a local object-URL preview, before
 * any preprocessing/network work starts), then moves through its own
 * prepare -> upload -> save pipeline in the background, independently
 * reorderable (drag, the fallback menu, or Make Cover) at every stage. The
 * owner's current on-screen order is always authoritative — not original
 * selection order, not completion order — and is what every finalize/
 * reorder call persists.
 *
 * Normal JPEG/WEBP/PNG photos upload DIRECTLY browser -> Supabase Storage
 * (via a server-authorized signed upload URL — see
 * authorizeJournalPhotoUploads), never through a Server Action carrying the
 * binary. HEIC/HEIF still goes through the existing server-side
 * heic-convert path (uploadJournalPhoto) unchanged, since reliable client-
 * side HEIC decoding isn't available across Android + iPhone without a new
 * heavy dependency — see this pass's own note on that tradeoff. */
export function useJournalPhotoUpload(initialPhotos: JournalInitialPhoto[], ensureEntryId: () => Promise<string | null>) {
  const [items, setItems] = useState<JournalPhotoItem[]>(() => buildInitialItems(initialPhotos));
  const [error, setError] = useState<string | null>(null);
  const itemsRef = useRef(items);
  // Mid-flight removal — a photo being decoded/uploaded/saved can't safely
  // be cancelled with the current SDK, so removal just marks it here; the
  // pipeline's own checkpoints (after prepare, after upload, after
  // finalize) check this set and clean up (discard the orphaned Storage
  // object, or delete the now-real row) rather than resurrecting it.
  const removedRef = useRef<Set<string>>(new Set());

  const updateItems = useCallback((updater: (prev: JournalPhotoItem[]) => JournalPhotoItem[]) => {
    setItems((prev) => {
      const next = updater(prev);
      itemsRef.current = next;
      return next;
    });
  }, []);

  // Object URL Lifecycle — revoke every remaining local preview on
  // unmount; a completed item's object URL is already revoked the moment
  // it's swapped for the real signed URL (see runOne below).
  useEffect(() => {
    return () => {
      itemsRef.current.forEach((it) => {
        if (it.isObjectUrl) URL.revokeObjectURL(it.previewUrl);
      });
    };
  }, []);

  const hasActiveUploads = items.some((it) => isActiveStatus(it.status));

  // Navigation Safety — a native, reliable, cheap warning for an actual
  // tab close/refresh while uploads are active. In-app navigation isn't
  // intercepted (no router-level framework added for this) — the visible
  // per-photo progress in the grid is the primary signal for that case.
  useEffect(() => {
    function handler(e: BeforeUnloadEvent) {
      if (!hasActiveUploads) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasActiveUploads]);

  const prepareLimit = useRef(createConcurrencyLimiter(MAX_PREPARE_CONCURRENCY)).current;
  const uploadLimit = useRef(createConcurrencyLimiter(MAX_UPLOAD_CONCURRENCY)).current;

  const currentPosition = useCallback((localId: string): number => {
    const index = itemsRef.current.findIndex((it) => it.localId === localId);
    return index === -1 ? itemsRef.current.length : index;
  }, []);

  const persistOrder = useCallback(async (entryId: string) => {
    const orderedMediaIds = itemsRef.current.filter((it) => it.status === "complete" && it.mediaId).map((it) => it.mediaId as string);
    if (orderedMediaIds.length === 0) return;
    await reorderJournalMedia(entryId, orderedMediaIds);
  }, []);

  const runOne = useCallback(async (entryId: string, localId: string, originalFile: File, direct: boolean, authorization: JournalUploadAuthorization | null) => {
    if (removedRef.current.has(localId)) return;
    updateItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, status: "preparing", errorMessage: undefined } : it)));

    const prepared = await prepareLimit(() => preprocessImageForUpload(originalFile));
    if (removedRef.current.has(localId)) return;
    updateItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, status: "uploading" } : it)));

    try {
      let mediaId: string;
      let url: string;

      if (!direct) {
        // HEIC/HEIF — unchanged legacy path: the full (already validated-
        // small-enough, per the 5MB cap) file goes through the Server
        // Action, which still does its own server-side conversion.
        const formData = new FormData();
        formData.set("file", prepared);
        formData.set("displayOrder", String(currentPosition(localId)));
        const result = await uploadLimit(() => uploadJournalPhoto(entryId, formData));
        if ("error" in result) throw new Error(result.error);
        mediaId = result.id;
        url = result.url;
      } else {
        if (!authorization) throw new Error("Couldn't authorize this upload.");
        const supabase = getBrowserSupabase();
        if (!supabase) throw new Error("Upload isn't available right now.");

        await uploadLimit(async () => {
          const { error: uploadError } = await supabase.storage.from(JOURNAL_MEDIA_BUCKET).uploadToSignedUrl(authorization.path, authorization.token, prepared, {
            contentType: prepared.type || "application/octet-stream",
            cacheControl: "31536000",
          });
          if (uploadError) throw new Error(uploadError.message);
        });

        if (removedRef.current.has(localId)) {
          // Uploaded straight to Storage but removed from the grid before
          // it could be finalized — no DB row exists yet, so just clean up
          // the now-orphaned object rather than ever writing one.
          await discardJournalUpload(entryId, authorization.path);
          return;
        }

        updateItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, status: "saving", storagePath: authorization.path } : it)));
        const result = await finalizeJournalPhoto(entryId, { storagePath: authorization.path, displayOrder: currentPosition(localId) });
        if ("error" in result) throw new Error(result.error);
        mediaId = result.id;
        url = result.url;
      }

      if (removedRef.current.has(localId)) {
        // Finalized (a real row now exists) but removed in the meantime —
        // delete it through the normal, already-correct removal path
        // rather than leaving an orphaned record.
        await removeJournalPhoto(entryId, mediaId);
        return;
      }

      updateItems((prev) =>
        prev.map((it) => {
          if (it.localId !== localId) return it;
          if (it.isObjectUrl) URL.revokeObjectURL(it.previewUrl);
          return { ...it, status: "complete", mediaId, previewUrl: url, isObjectUrl: false, errorMessage: undefined };
        })
      );
    } catch (err) {
      if (removedRef.current.has(localId)) return;
      const message = err instanceof Error ? err.message : "Couldn't upload that photo.";
      console.error("[journal] photo upload failed", { localId, direct, message });
      updateItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, status: "error", errorMessage: message } : it)));
    }
  }, [currentPosition, prepareLimit, updateItems, uploadLimit]);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    // The Add Photos control stays protected from overlapping, uncontrolled
    // batches — JournalPhotoStrip also disables the trigger while any photo
    // is active, so this is the double-submit guard, not the only one.
    if (hasActiveUploads) return;
    setError(null);

    const fileArray = Array.from(files);
    const entryId = await ensureEntryId();
    if (!entryId) return;

    // Core UX Requirement — every selected photo becomes a real, visible
    // grid item immediately, before any preprocessing/network work starts.
    const newItems: JournalPhotoItem[] = fileArray.map((file) => ({
      localId: crypto.randomUUID(),
      status: "local",
      previewUrl: URL.createObjectURL(file),
      isObjectUrl: true,
      file,
    }));
    updateItems((prev) => [...prev, ...newItems]);

    // Batch Authorization — classify up front (synchronously, no waiting
    // on preprocessing) so the whole non-HEIC subset can be authorized in
    // ONE server round trip (one ownership check, N signed upload URLs),
    // never one authorization call per photo.
    const directEntries = newItems.filter((item) => item.file && !isHeicLike(item.file));
    const authByLocalId = new Map<string, JournalUploadAuthorization>();
    const erroredLocalIds = new Set<string>();

    if (directEntries.length > 0) {
      const extensions = directEntries.map((item) => ({ extension: isPng(item.file as File) ? ("png" as const) : ("jpg" as const) }));
      const authResult = await authorizeJournalPhotoUploads(entryId, extensions);
      if ("error" in authResult) {
        directEntries.forEach((item) => erroredLocalIds.add(item.localId));
        updateItems((prev) => prev.map((it) => (erroredLocalIds.has(it.localId) ? { ...it, status: "error", errorMessage: authResult.error } : it)));
      } else {
        // Mobile QA Repair, second pass — each file's authorization now
        // succeeds or fails independently (see authorizeJournalPhotoUploads's
        // own comment), so only the actually-failed items in this batch are
        // marked errored; the rest proceed to upload normally.
        const authErrorByLocalId = new Map<string, string>();
        directEntries.forEach((item, i) => {
          const result = authResult.uploads[i];
          if (result.ok) {
            authByLocalId.set(item.localId, { path: result.path, token: result.token });
          } else {
            erroredLocalIds.add(item.localId);
            authErrorByLocalId.set(item.localId, result.error);
          }
        });
        if (erroredLocalIds.size > 0) {
          updateItems((prev) => prev.map((it) => (authErrorByLocalId.has(it.localId) ? { ...it, status: "error", errorMessage: authErrorByLocalId.get(it.localId) } : it)));
        }
      }
    }

    const runners = newItems
      .filter((item) => !erroredLocalIds.has(item.localId))
      .map((item) => runOne(entryId, item.localId, item.file as File, authByLocalId.has(item.localId), authByLocalId.get(item.localId) ?? null));

    await Promise.all(runners);

    // Final Order Reconciliation — regardless of completion-order races or
    // any reordering the owner did while this batch was still in flight,
    // persist display_order/is_cover from the grid's CURRENT order for
    // every photo that's actually persisted now.
    await persistOrder(entryId);

    const stillErrored = itemsRef.current.filter((it) => it.status === "error").length;
    if (stillErrored > 0) {
      setError(`${stillErrored} photo${stillErrored === 1 ? "" : "s"} couldn't be uploaded. Tap Retry on ${stillErrored === 1 ? "it" : "any of them"}.`);
    }
  }, [hasActiveUploads, ensureEntryId, updateItems, runOne, persistOrder]);

  // Mobile QA Repair pass — these five are invoked once per photo tile
  // (JournalPhotoStrip renders one per item). Stable references across
  // renders let React.memo on the tile component actually skip re-
  // rendering tiles whose own data hasn't changed, which matters a lot
  // more than usual here since dnd-kit re-renders every sortable item in
  // the grid on every pointer-move frame while a drag is active (see this
  // pass's own note on investigating drag lag).
  const retryItem = useCallback(
    async (localId: string) => {
      const item = itemsRef.current.find((it) => it.localId === localId);
      if (!item || item.status !== "error" || !item.file) return;
      const entryId = await ensureEntryId();
      if (!entryId) return;
      setError(null);

      const file = item.file;
      if (isHeicLike(file)) {
        await runOne(entryId, localId, file, false, null);
      } else {
        const authResult = await authorizeJournalPhotoUploads(entryId, [{ extension: isPng(file) ? "png" : "jpg" }]);
        if ("error" in authResult) {
          updateItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, status: "error", errorMessage: authResult.error } : it)));
          return;
        }
        const single = authResult.uploads[0];
        if (!single.ok) {
          updateItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, status: "error", errorMessage: single.error } : it)));
          return;
        }
        await runOne(entryId, localId, file, true, { path: single.path, token: single.token });
      }
      await persistOrder(entryId);
    },
    [ensureEntryId, runOne, updateItems, persistOrder]
  );

  const handleRemove = useCallback(
    async (localId: string) => {
      const item = itemsRef.current.find((it) => it.localId === localId);
      if (!item) return;

      if (item.status === "local" || item.status === "error") {
        if (item.isObjectUrl) URL.revokeObjectURL(item.previewUrl);
        updateItems((prev) => prev.filter((it) => it.localId !== localId));
        return;
      }

      if (isActiveStatus(item.status)) {
        removedRef.current.add(localId);
        if (item.isObjectUrl) URL.revokeObjectURL(item.previewUrl);
        updateItems((prev) => prev.filter((it) => it.localId !== localId));
        return;
      }

      // status === "complete" — reuse the existing, already-correct
      // deletion behavior (Storage removal + cover failover) unchanged.
      const entryId = await ensureEntryId();
      if (!entryId || !item.mediaId) return;
      updateItems((prev) => prev.filter((it) => it.localId !== localId));
      const result = await removeJournalPhoto(entryId, item.mediaId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      await persistOrder(entryId);
    },
    [ensureEntryId, updateItems, persistOrder]
  );

  const reorder = useCallback(
    (updater: (prev: JournalPhotoItem[]) => JournalPhotoItem[]) => {
      updateItems(updater);
      ensureEntryId().then((entryId) => {
        if (entryId) void persistOrder(entryId);
      });
    },
    [ensureEntryId, updateItems, persistOrder]
  );

  // Reorder While Some Photos Are Local — every one of these operates on
  // the live array regardless of each item's status; persistOrder above
  // only ever writes the subset that's actually persisted, in its current
  // position, so a still-uploading photo's eventual finalize (or the end-
  // of-batch reconciliation) is what places it correctly once it's real.
  const handleDragReorder = useCallback(
    (activeLocalId: string, overLocalId: string) => {
      reorder((prev) => {
        const oldIndex = prev.findIndex((it) => it.localId === activeLocalId);
        const newIndex = prev.findIndex((it) => it.localId === overLocalId);
        if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return prev;
        return arrayMove(prev, oldIndex, newIndex);
      });
    },
    [reorder]
  );

  const moveEarlier = useCallback(
    (localId: string) => {
      reorder((prev) => {
        const index = prev.findIndex((it) => it.localId === localId);
        if (index <= 0) return prev;
        return arrayMove(prev, index, index - 1);
      });
    },
    [reorder]
  );

  const moveLater = useCallback(
    (localId: string) => {
      reorder((prev) => {
        const index = prev.findIndex((it) => it.localId === localId);
        if (index === -1 || index >= prev.length - 1) return prev;
        return arrayMove(prev, index, index + 1);
      });
    },
    [reorder]
  );

  const makeCover = useCallback(
    (localId: string) => {
      reorder((prev) => {
        const index = prev.findIndex((it) => it.localId === localId);
        if (index <= 0) return prev;
        return arrayMove(prev, index, 0);
      });
    },
    [reorder]
  );

  return {
    items,
    error,
    setError,
    hasActiveUploads,
    handleFiles,
    handleRemove,
    retryItem,
    handleDragReorder,
    moveEarlier,
    moveLater,
    makeCover,
  };
}
