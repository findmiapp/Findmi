"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import {
  uploadJournalPhoto,
  removeJournalPhoto,
  reorderJournalMedia,
  authorizeJournalPhotoUploadBatch,
  finalizeJournalPhotoBatch,
  discardJournalUpload,
  type JournalBatchAuthItem,
  type JournalBatchFinalizeItem,
} from "@/app/(public)/my-world/journal/actions";
import { preprocessImageForUpload, isHeicLike, isPng } from "@/lib/imagePreprocessing";
import { createConcurrencyLimiter } from "@/lib/concurrency";
import { getBrowserSupabase } from "@/lib/supabase/client";

// Journal Photo Upload V3 — mirrors the literal bucket id
// JOURNAL_MEDIA_BUCKET exports from lib/journal.ts. That module pulls in
// server-only Supabase helpers and must never be imported from a "use
// client" file, so the bucket id is duplicated here as a plain string
// rather than shared via import.
const JOURNAL_MEDIA_BUCKET = "journal-media";

// V3 — raised from 2. Each decode (createImageBitmap) is released
// (bitmap.close()) immediately after drawing to canvas, so the realistic
// peak is 3 concurrent ~12MP decodes (~45-50MB of raw bitmap memory each,
// well within what a modern Android Chrome tab budgets) rather than 3
// simultaneous full pipelines holding memory for their whole lifetime.
const MAX_PREPARE_CONCURRENCY = 3;
// V3 — raised from 3. A direct-to-Storage PUT is a plain network request
// with no client-side decode/canvas work behind it, so the device-side
// cost of one more concurrent transfer is negligible; 4 is a modest,
// bounded increase, not "launch everything at once."
const MAX_UPLOAD_CONCURRENCY = 4;
// V3 — authorize/finalize in chunks rather than one giant batch-of-32 or
// 32 individual round trips. A chunk's authorization never waits on its
// own preprocessing (extension is known from the original file), so a
// later chunk's CPU work overlaps an earlier chunk's network transfer
// through the shared prepare/upload limiters above — see processChunk's
// own note.
const AUTH_FINALIZE_CHUNK_SIZE = 8;

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
  /** V3 — set the instant a direct-to-Storage upload succeeds, well
   * before finalize runs. Lets Retry redo ONLY the finalize step (never
   * re-uploading an already-successful binary) when that's the stage that
   * actually failed, and lets removal clean up an orphaned Storage object
   * for a photo that uploaded but was removed before (or during) finalize. */
  storagePath?: string;
  errorMessage?: string;
}

export interface JournalInitialPhoto {
  id: string;
  url: string;
  isCover: boolean;
}

/** Current-batch upload progress, surfaced separately from `items` so the
 * UI never has to derive it from a mix of already-persisted photos and the
 * photos actually in flight right now. */
export interface JournalBatchProgress {
  completed: number;
  total: number;
}

/** V3 — a small, temporary, phone-visible QA summary for the batch that
 * just finished. Android QA has no desktop DevTools, so wall-clock
 * durations need to surface somewhere in the editor itself for the next
 * round of real-device testing. Durations are approximate wall-clock
 * milestones (preprocessing/upload/finalize deliberately overlap in this
 * pipeline — see processChunk — so these are not strictly serial
 * durations), never anything sensitive: no signed URLs, no tokens, no raw
 * error text. Intended to be deleted outright once upload performance is
 * confirmed fixed by real-device QA. */
export interface JournalBatchPerf {
  count: number;
  prepMs: number;
  uploadMs: number;
  finalizeMs: number;
  totalMs: number;
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

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Journal Photo Upload V3 — high-volume batches (tested: 32 photos taking
 * ~6 minutes through the V1 server-upload-only transport) need the large
 * binary off Vercel entirely. Normal (non-HEIC) photos now go browser ->
 * Supabase Storage directly, authorized and finalized in small CHUNKS
 * (see AUTH_FINALIZE_CHUNK_SIZE) rather than either one Server Action
 * round trip per photo (V1 — too slow) or one unguarded batch-wide
 * Promise.all (the earlier direct-upload attempt — one failure took down
 * the whole batch). Each chunk's authorization and finalization are their
 * own per-item-isolated batch calls (see authorizeJournalPhotoUploadBatch/
 * finalizeJournalPhotoBatch's own comments); chunks run concurrently with
 * each other through shared, bounded prepare/upload concurrency limiters,
 * so a later chunk's CPU preprocessing overlaps an earlier chunk's network
 * transfer instead of forcing the whole 32-photo batch through one phase
 * before the next can start.
 *
 * HEIC/HEIF still goes through the existing server-side heic-convert
 * Server Action (uploadJournalPhoto) unchanged — reliable client-side HEIC
 * decoding isn't available, so that binary still has to transit the
 * server; it shares the same upload concurrency budget as everything else
 * but never the chunked authorize/finalize pipeline. */
export function useJournalPhotoUpload(initialPhotos: JournalInitialPhoto[], ensureEntryId: () => Promise<string | null>) {
  const [items, setItems] = useState<JournalPhotoItem[]>(() => buildInitialItems(initialPhotos));
  const [error, setError] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<JournalBatchProgress | null>(null);
  const [batchPerf, setBatchPerf] = useState<JournalBatchPerf | null>(null);
  const itemsRef = useRef(items);
  // Mid-flight removal — a photo being prepared/uploaded can't safely be
  // cancelled with the current SDK, so removal just marks it here; the
  // pipeline's own checkpoints (right after upload, right after finalize)
  // check this set and clean up (discard the orphaned Storage object, or
  // delete the now-real row) rather than resurrecting it.
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
  // it's swapped for the real signed URL.
  useEffect(() => {
    return () => {
      itemsRef.current.forEach((it) => {
        if (it.isObjectUrl) URL.revokeObjectURL(it.previewUrl);
      });
    };
  }, []);

  const hasActiveUploads = items.some((it) => isActiveStatus(it.status));

  // Navigation Safety — a native, reliable, cheap warning for an actual
  // tab close/refresh while uploads are active.
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
  // V3 perf instrumentation — see JournalBatchPerf's own doc comment.
  const prepMarkRef = useRef(0);
  const uploadMarkRef = useRef(0);

  const currentPosition = useCallback((localId: string): number => {
    const index = itemsRef.current.findIndex((it) => it.localId === localId);
    return index === -1 ? itemsRef.current.length : index;
  }, []);

  const persistOrder = useCallback(async (entryId: string) => {
    const orderedMediaIds = itemsRef.current.filter((it) => it.status === "complete" && it.mediaId).map((it) => it.mediaId as string);
    if (orderedMediaIds.length === 0) return;
    await reorderJournalMedia(entryId, orderedMediaIds);
  }, []);

  const prepareOne = useCallback(
    async (localId: string, originalFile: File): Promise<File | null> => {
      if (removedRef.current.has(localId)) return null;
      updateItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, status: "preparing", errorMessage: undefined } : it)));
      const prepared = await prepareLimit(() => preprocessImageForUpload(originalFile));
      prepMarkRef.current = Math.max(prepMarkRef.current, performance.now());
      if (removedRef.current.has(localId)) return null;
      return prepared;
    },
    [prepareLimit, updateItems]
  );

  /** Uploads one already-authorized, already-preprocessed file straight to
   * Storage. Sets `storagePath` the moment the PUT resolves — before
   * finalize ever runs — so a later Retry or remove-while-finalizing
   * always knows the binary already made it to Storage. */
  const uploadOneDirect = useCallback(
    async (localId: string, prepared: File, auth: { path: string; token: string }): Promise<void> => {
      updateItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, status: "uploading" } : it)));
      const supabase = getBrowserSupabase();
      if (!supabase) throw new Error("Upload isn't available right now.");
      await uploadLimit(async () => {
        const { error: uploadError } = await supabase.storage.from(JOURNAL_MEDIA_BUCKET).uploadToSignedUrl(auth.path, auth.token, prepared, {
          contentType: prepared.type || "application/octet-stream",
          cacheControl: "31536000",
        });
        if (uploadError) throw new Error(uploadError.message);
      });
      uploadMarkRef.current = Math.max(uploadMarkRef.current, performance.now());
      updateItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, status: "saving", storagePath: auth.path } : it)));
    },
    [updateItems, uploadLimit]
  );

  const applyFinalizeResult = useCallback(
    (entryId: string, result: JournalBatchFinalizeItem) => {
      if (removedRef.current.has(result.localId)) {
        // Finalized (a real row now exists) but removed in the meantime —
        // delete it through the normal, already-correct removal path.
        if (result.ok && result.mediaId) void removeJournalPhoto(entryId, result.mediaId);
        return;
      }
      if (result.ok && result.mediaId) {
        updateItems((prev) =>
          prev.map((it) => {
            if (it.localId !== result.localId) return it;
            if (it.isObjectUrl) URL.revokeObjectURL(it.previewUrl);
            return { ...it, status: "complete", mediaId: result.mediaId, previewUrl: result.url || it.previewUrl, isObjectUrl: false, errorMessage: undefined };
          })
        );
      } else {
        updateItems((prev) =>
          prev.map((it) => (it.localId === result.localId ? { ...it, status: "error", errorMessage: result.errorMessage ?? "Couldn't save that photo." } : it))
        );
      }
    },
    [updateItems]
  );

  /** HEIC/HEIF — unchanged legacy path: the full file goes through the
   * server-side heic-convert Server Action, exactly as it always has. */
  const runHeicItem = useCallback(
    async (entryId: string, localId: string, originalFile: File, onSettle?: () => void) => {
      try {
        if (removedRef.current.has(localId)) return;
        updateItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, status: "preparing", errorMessage: undefined } : it)));
        if (removedRef.current.has(localId)) return;
        updateItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, status: "uploading" } : it)));

        const formData = new FormData();
        formData.set("file", originalFile);
        formData.set("displayOrder", String(currentPosition(localId)));
        const result = await uploadLimit(() => uploadJournalPhoto(entryId, formData));
        if ("error" in result) throw new Error(result.error);
        const { id: mediaId, url } = result;

        if (removedRef.current.has(localId)) {
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
        console.error("[journal] HEIC photo upload failed", { localId, message });
        updateItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, status: "error", errorMessage: message } : it)));
      } finally {
        onSettle?.();
      }
    },
    [currentPosition, updateItems, uploadLimit]
  );

  /** Processes one chunk of the direct-upload pipeline: preprocess (shared,
   * bounded concurrency) in parallel with ONE batch authorization request
   * — authorization never needs the preprocessed bytes, only each file's
   * extension, which is known from the ORIGINAL file — then direct
   * browser -> Storage upload per authorized item (shared, bounded
   * concurrency), then ONE batch finalization request for whatever
   * actually finished uploading. `onSettle` fires exactly once per item in
   * this chunk, success or failure, regardless of which stage it fails at.
   * Also used by retryItem for a single-item "chunk" on a full-pipeline
   * retry (fresh authorization, fresh path — see retryItem's own note). */
  const processChunk = useCallback(
    async (entryId: string, chunkItems: JournalPhotoItem[], onSettle: (localId: string) => void) => {
      const extensions = chunkItems.map((item) => ({ localId: item.localId, extension: isPng(item.file as File) ? ("png" as const) : ("jpg" as const) }));

      const [authResult, preparedByLocalId] = await Promise.all([
        authorizeJournalPhotoUploadBatch(entryId, extensions),
        (async () => {
          const map = new Map<string, File>();
          await Promise.all(
            chunkItems.map(async (item) => {
              const prepared = await prepareOne(item.localId, item.file as File);
              if (prepared) map.set(item.localId, prepared);
            })
          );
          return map;
        })(),
      ]);

      if ("error" in authResult) {
        chunkItems.forEach((item) => {
          if (!removedRef.current.has(item.localId)) {
            updateItems((prev) => prev.map((it) => (it.localId === item.localId ? { ...it, status: "error", errorMessage: authResult.error } : it)));
          }
          onSettle(item.localId);
        });
        return;
      }
      const authByLocalId = new Map<string, JournalBatchAuthItem>(authResult.results.map((r) => [r.localId, r]));

      const toFinalize: { localId: string; storagePath: string; displayOrder: number }[] = [];
      await Promise.all(
        chunkItems.map(async (item) => {
          if (removedRef.current.has(item.localId)) {
            onSettle(item.localId);
            return;
          }
          const auth = authByLocalId.get(item.localId);
          const prepared = preparedByLocalId.get(item.localId);
          if (!auth || !auth.ok || !auth.path || !auth.token || !prepared) {
            updateItems((prev) =>
              prev.map((it) => (it.localId === item.localId ? { ...it, status: "error", errorMessage: auth?.errorMessage ?? "Couldn't prepare that photo." } : it))
            );
            onSettle(item.localId);
            return;
          }
          try {
            await uploadOneDirect(item.localId, prepared, { path: auth.path, token: auth.token });
            if (removedRef.current.has(item.localId)) {
              await discardJournalUpload(entryId, auth.path);
              onSettle(item.localId);
              return;
            }
            toFinalize.push({ localId: item.localId, storagePath: auth.path, displayOrder: currentPosition(item.localId) });
          } catch (err) {
            if (removedRef.current.has(item.localId)) {
              onSettle(item.localId);
              return;
            }
            const message = err instanceof Error ? err.message : "Couldn't upload that photo.";
            console.error("[journal] direct photo upload failed", { localId: item.localId, message });
            updateItems((prev) => prev.map((it) => (it.localId === item.localId ? { ...it, status: "error", errorMessage: message } : it)));
            onSettle(item.localId);
          }
        })
      );

      if (toFinalize.length === 0) return;
      const finalizeResult = await finalizeJournalPhotoBatch(entryId, toFinalize);
      if ("error" in finalizeResult) {
        toFinalize.forEach((t) => {
          updateItems((prev) => prev.map((it) => (it.localId === t.localId ? { ...it, status: "error", errorMessage: finalizeResult.error } : it)));
          onSettle(t.localId);
        });
        return;
      }
      finalizeResult.results.forEach((r) => {
        applyFinalizeResult(entryId, r);
        onSettle(r.localId);
      });
    },
    [prepareOne, uploadOneDirect, currentPosition, applyFinalizeResult, updateItems]
  );

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      // The Add Photos control stays protected from overlapping, uncontrolled
      // batches — JournalPhotoStrip also disables the trigger while any photo
      // is active, so this is the double-submit guard, not the only one.
      if (hasActiveUploads) return;
      setError(null);
      setBatchPerf(null);

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

      const batchStart = performance.now();
      prepMarkRef.current = batchStart;
      uploadMarkRef.current = batchStart;

      // Current-Batch Progress — this call's own selection only, never
      // mixed with photos already persisted before it or added after it.
      // Every item in the batch settles exactly once, whichever pipeline
      // (direct-upload chunk or legacy HEIC) it goes through.
      setBatchProgress({ completed: 0, total: newItems.length });
      const onSettle = () => setBatchProgress((prev) => (prev ? { ...prev, completed: prev.completed + 1 } : prev));

      const heicItems = newItems.filter((item) => isHeicLike(item.file as File));
      const directItems = newItems.filter((item) => !isHeicLike(item.file as File));
      const chunks = chunkArray(directItems, AUTH_FINALIZE_CHUNK_SIZE);

      await Promise.all([
        ...chunks.map((c) => processChunk(entryId, c, onSettle)),
        ...heicItems.map((item) => runHeicItem(entryId, item.localId, item.file as File, onSettle)),
      ]);

      setBatchProgress(null);

      // Final Order Reconciliation — regardless of completion-order races or
      // any reordering the owner did while this batch was still in flight,
      // persist display_order/is_cover from the grid's CURRENT order for
      // every photo that's actually persisted now.
      await persistOrder(entryId);

      const finalizeDoneAt = performance.now();
      setBatchPerf({
        count: newItems.length,
        prepMs: Math.max(0, Math.round(prepMarkRef.current - batchStart)),
        uploadMs: Math.max(0, Math.round(uploadMarkRef.current - prepMarkRef.current)),
        finalizeMs: Math.max(0, Math.round(finalizeDoneAt - uploadMarkRef.current)),
        totalMs: Math.round(finalizeDoneAt - batchStart),
      });

      const stillErrored = itemsRef.current.filter((it) => it.status === "error").length;
      if (stillErrored > 0) {
        setError(`${stillErrored} photo${stillErrored === 1 ? "" : "s"} couldn't be uploaded. Tap Retry on ${stillErrored === 1 ? "it" : "any of them"}.`);
      }
    },
    [hasActiveUploads, ensureEntryId, updateItems, processChunk, runHeicItem, persistOrder]
  );

  // Mobile QA Repair pass — these are invoked once per photo tile
  // (JournalPhotoStrip renders one per item). Stable references across
  // renders let React.memo on the tile component actually skip re-
  // rendering tiles whose own data hasn't changed.
  const retryItem = useCallback(
    async (localId: string) => {
      const item = itemsRef.current.find((it) => it.localId === localId);
      if (!item || item.status !== "error" || !item.file) return;
      const entryId = await ensureEntryId();
      if (!entryId) return;
      setError(null);

      if (item.storagePath) {
        // Upload already succeeded — only finalize failed (or its
        // response was lost). Retry finalize ALONE; the server's own
        // idempotency check means this is always safe even if the
        // earlier attempt actually succeeded server-side.
        updateItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, status: "saving", errorMessage: undefined } : it)));
        const result = await finalizeJournalPhotoBatch(entryId, [{ localId, storagePath: item.storagePath, displayOrder: currentPosition(localId) }]);
        if ("error" in result) {
          updateItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, status: "error", errorMessage: result.error } : it)));
        } else {
          result.results.forEach((r) => applyFinalizeResult(entryId, r));
        }
      } else if (isHeicLike(item.file)) {
        await runHeicItem(entryId, localId, item.file);
      } else {
        // Full pipeline retry — fresh authorization (a brand-new Storage
        // path), since no earlier attempt for this item ever got far
        // enough to leave an object behind.
        await processChunk(entryId, [item], () => {});
      }
      await persistOrder(entryId);
    },
    [ensureEntryId, currentPosition, applyFinalizeResult, runHeicItem, processChunk, persistOrder, updateItems]
  );

  const handleRemove = useCallback(
    async (localId: string) => {
      const item = itemsRef.current.find((it) => it.localId === localId);
      if (!item) return;

      if (item.status === "local" || item.status === "error") {
        if (item.isObjectUrl) URL.revokeObjectURL(item.previewUrl);
        updateItems((prev) => prev.filter((it) => it.localId !== localId));
        // V3 — an "error" item can already have a real Storage object
        // (upload succeeded, only finalize failed) even though it isn't
        // "active" any more — clean that up too, same as the mid-flight
        // checkpoints below do for an active item.
        if (item.storagePath) {
          const entryId = await ensureEntryId();
          if (entryId) void discardJournalUpload(entryId, item.storagePath);
        }
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
    batchPerf,
    dismissBatchPerf: () => setBatchPerf(null),
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
