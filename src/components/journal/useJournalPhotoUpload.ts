"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import { uploadJournalPhoto, removeJournalPhoto, reorderJournalMedia } from "@/app/(public)/my-world/journal/actions";
import { preprocessImageForUpload } from "@/lib/imagePreprocessing";
import { createConcurrencyLimiter } from "@/lib/concurrency";

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
  errorMessage?: string;
}

export interface JournalInitialPhoto {
  id: string;
  url: string;
  isCover: boolean;
}

/** Current-batch upload progress, surfaced separately from `items` so the
 * UI never has to derive it from a mix of already-persisted photos and the
 * photos actually in flight right now — see this hook's own Journal Photo
 * Stability pass note on why that mix produced misleading copy before. */
export interface JournalBatchProgress {
  completed: number;
  total: number;
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

/** Journal Photo Stability pass — every photo (including HEIC/HEIF) now
 * uploads through the ONE proven V1 transport: browser -> client
 * preprocessing -> uploadJournalPhoto (Server Action, binary in the
 * request body) -> Storage -> journal_entry_media -> signed read URL. The
 * V2 direct-to-Storage architecture (a server-issued signed upload URL,
 * the browser PUTting bytes straight to Supabase Storage, then a separate
 * finalize call) repeatedly failed real Android QA — most recently an
 * entire new batch failing together — and reliability was judged more
 * important than its theoretical upload-speed edge. That whole pipeline
 * (authorizeJournalPhotoUploads/finalizeJournalPhoto/discardJournalUpload,
 * the browser Supabase Storage client) is gone; every photo is now just
 * one ownership-checked, independently-failing Server Action call, same as
 * V1 always was for HEIC.
 *
 * Still an item-based state machine, not V1's single sequential loop:
 * every selected photo becomes a visible grid item INSTANTLY (a local
 * object-URL preview, before any preprocessing/network work starts), then
 * moves through its own prepare -> upload -> save pipeline in the
 * background, independently reorderable (drag, the fallback menu, or Make
 * Cover) at every stage. The owner's current on-screen order is always
 * authoritative — not original selection order, not completion order —
 * and is what every reorder/end-of-batch reconciliation persists.
 *
 * preprocessImageForUpload already no-ops on a HEIC/HEIF file (returns it
 * unchanged — client-side HEIC decoding isn't reliably available), so it
 * runs unconditionally here; uploadJournalPhoto's own validateImageFile
 * still does the real server-side HEIC-to-JPEG conversion for that file,
 * exactly as it always has. */
export function useJournalPhotoUpload(initialPhotos: JournalInitialPhoto[], ensureEntryId: () => Promise<string | null>) {
  const [items, setItems] = useState<JournalPhotoItem[]>(() => buildInitialItems(initialPhotos));
  const [error, setError] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<JournalBatchProgress | null>(null);
  const itemsRef = useRef(items);
  // Mid-flight removal — a photo being prepared/uploaded can't safely be
  // cancelled with the current SDK, so removal just marks it here; the
  // pipeline's own checkpoint (right after the Server Action resolves)
  // checks this set and cleans up the now-real row rather than
  // resurrecting it.
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

  /** One photo, start to finish, through the proven server-upload
   * transport — entirely independent of every other photo in its batch
   * (its own preprocessing slot, its own uploadJournalPhoto call, its own
   * success/error outcome), so one failure can never take down its
   * batch-mates. `onSettle` (used by handleFiles for current-batch
   * progress) fires exactly once, success or failure. */
  const runOne = useCallback(
    async (entryId: string, localId: string, originalFile: File, onSettle?: () => void) => {
      try {
        if (removedRef.current.has(localId)) return;
        updateItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, status: "preparing", errorMessage: undefined } : it)));

        const prepared = await prepareLimit(() => preprocessImageForUpload(originalFile));
        if (removedRef.current.has(localId)) return;
        updateItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, status: "uploading" } : it)));

        const formData = new FormData();
        formData.set("file", prepared);
        formData.set("displayOrder", String(currentPosition(localId)));
        const result = await uploadLimit(() => uploadJournalPhoto(entryId, formData));
        if ("error" in result) throw new Error(result.error);
        const { id: mediaId, url } = result;

        if (removedRef.current.has(localId)) {
          // Uploaded and saved, but removed from the grid in the
          // meantime — delete the now-real row through the normal,
          // already-correct removal path rather than leaving an orphan.
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
        console.error("[journal] photo upload failed", { localId, message });
        updateItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, status: "error", errorMessage: message } : it)));
      } finally {
        onSettle?.();
      }
    },
    [currentPosition, prepareLimit, updateItems, uploadLimit]
  );

  const handleFiles = useCallback(
    async (files: FileList | null) => {
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

      // Current-Batch Progress — this call's own selection only, never
      // mixed with photos already persisted before it or added after it.
      setBatchProgress({ completed: 0, total: newItems.length });
      const runners = newItems.map((item) =>
        runOne(entryId, item.localId, item.file as File, () => setBatchProgress((prev) => (prev ? { ...prev, completed: prev.completed + 1 } : prev)))
      );
      await Promise.all(runners);
      setBatchProgress(null);

      // Final Order Reconciliation — regardless of completion-order races or
      // any reordering the owner did while this batch was still in flight,
      // persist display_order/is_cover from the grid's CURRENT order for
      // every photo that's actually persisted now.
      await persistOrder(entryId);

      const stillErrored = itemsRef.current.filter((it) => it.status === "error").length;
      if (stillErrored > 0) {
        setError(`${stillErrored} photo${stillErrored === 1 ? "" : "s"} couldn't be uploaded. Tap Retry on ${stillErrored === 1 ? "it" : "any of them"}.`);
      }
    },
    [hasActiveUploads, ensureEntryId, updateItems, runOne, persistOrder]
  );

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
      await runOne(entryId, localId, item.file);
      await persistOrder(entryId);
    },
    [ensureEntryId, runOne, persistOrder]
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
    batchProgress,
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
