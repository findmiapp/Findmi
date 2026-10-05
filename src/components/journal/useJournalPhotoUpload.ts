"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import {
  uploadJournalPhoto,
  removeJournalPhoto,
  saveJournalMediaLayout,
  setJournalCover,
  saveJournalMediaCaption,
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
  /** Moments V2 — explicit cover (journal_entry_media.is_cover), never
   * derived from grid position. */
  isCover: boolean;
  /** Moments V2 — target/current photo section. Undefined/null =
   * unsectioned. Only sent to the server when set. */
  sectionId?: string | null;
  /** Moments V2 — the photo's own optional note (journal_entry_media.caption). */
  caption?: string | null;
}

export interface JournalInitialPhoto {
  id: string;
  url: string;
  isCover: boolean;
  sectionId?: string | null;
  caption?: string | null;
}

/** Current-batch upload progress, surfaced separately from `items` so the
 * UI never has to derive it from a mix of already-persisted photos and the
 * photos actually in flight right now. */
export interface JournalBatchProgress {
  completed: number;
  total: number;
}

/** V3.1 — a small, temporary, phone-visible QA summary for the batch that
 * just finished. Android QA has no desktop DevTools, so wall-clock
 * durations need to surface somewhere in the editor itself. Unlike the
 * first V3 attempt (a single global "last mark wins" timestamp per stage,
 * which collapsed to misleading 0.0s/0.0s/58s readings once a batch's
 * stages genuinely overlapped), these are derived from PER-ITEM
 * start/end timestamps: a span is earliest-start -> latest-end across
 * every item that actually went through that stage — see handleFiles'
 * own computation. Never anything sensitive: no signed URLs, no tokens,
 * no raw error text. Intended to be deleted outright once upload
 * performance is confirmed fixed by real-device QA. */
export interface JournalBatchPerf {
  count: number;
  /** selection -> every local preview inserted into the grid. */
  previewMs: number;
  /** earliest preprocessStart -> latest preprocessEnd, across every item
   * that went through client-side preprocessing. */
  prepSpanMs: number;
  /** earliest uploadStart -> latest uploadEnd — covers both the direct-
   * to-Storage PUT for a normal photo and the whole legacy Server Action
   * call for a HEIC/HEIF one (see runHeicItem's own note). */
  uploadSpanMs: number;
  /** earliest finalizeStart -> latest finalizeEnd, across every chunk's
   * batch finalization call. */
  finalizeSpanMs: number;
  /** selection -> this batch's final settled state (every item complete
   * or errored, order persisted). */
  totalMs: number;
  /** Sum of each direct-upload item's post-preprocessing file size, plus
   * each HEIC item's original (un-preprocessed — that path never resizes
   * client-side) file size. A rough "how much actually went over the
   * wire" figure for QA, not a precise compression ratio. */
  compressedBytes: number;
  /** How many of this batch's photos went through the legacy per-photo
   * Server Action path (HEIC/HEIF) rather than direct-to-Storage — a
   * batch where this unexpectedly equals `count` means every photo took
   * the slow path, the single most useful signal this readout can give
   * for diagnosing an unexplained slow batch. */
  legacyCount: number;
}

/** V3.1 — per-item wall-clock timestamps backing JournalBatchPerf's span
 * math above. Kept in a ref (never React state) since nothing needs to
 * re-render as these fill in — only the final aggregate, computed once
 * the whole batch settles, becomes state. */
interface JournalItemTiming {
  preprocessStart?: number;
  preprocessEnd?: number;
  uploadStart?: number;
  uploadEnd?: number;
  finalizeStart?: number;
  finalizeEnd?: number;
  preparedBytes?: number;
}

/** Moments V2 — the editor's photo order is exactly the authored
 * display_order the caller already sorted by; the cover is carried as its
 * own explicit flag and is never moved to the front. */
function buildInitialItems(initial: JournalInitialPhoto[]): JournalPhotoItem[] {
  return initial.map((p) => ({
    localId: p.id,
    status: "complete",
    previewUrl: p.url,
    isObjectUrl: false,
    mediaId: p.id,
    isCover: p.isCover,
    sectionId: p.sectionId ?? null,
    caption: p.caption ?? null,
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
  // V3.1 perf instrumentation — see JournalItemTiming/JournalBatchPerf's
  // own doc comments. Reset (cleared) at the start of every handleFiles
  // call so a later batch's numbers never include an earlier batch's.
  const timingRef = useRef<Map<string, JournalItemTiming>>(new Map());

  const currentPosition = useCallback((localId: string): number => {
    const index = itemsRef.current.findIndex((it) => it.localId === localId);
    return index === -1 ? itemsRef.current.length : index;
  }, []);

  /** Persists the editor's photo layout — order plus each photo's section
   * (this editor session is the authority for both) — never the cover
   * (explicit is_cover). The server flattens it to one global order:
   * sectioned photos by section order, then unsectioned photos. */
  const persistOrder = useCallback(async (entryId: string) => {
    const complete = itemsRef.current.filter((it) => it.status === "complete" && it.mediaId);
    if (complete.length === 0) return;
    const result = await saveJournalMediaLayout(entryId, { items: complete.map((it) => ({ mediaId: it.mediaId as string, sectionId: it.sectionId ?? null })) });
    if ("error" in result) setError(result.error);
  }, []);

  /** Mirrors the server's resulting cover into local state. */
  const syncCover = useCallback(
    (coverMediaId: string | null) => {
      updateItems((prev) =>
        prev.some((it) => it.isCover !== (coverMediaId !== null && it.mediaId === coverMediaId))
          ? prev.map((it) => {
              const isCover = coverMediaId !== null && it.mediaId === coverMediaId;
              return it.isCover === isCover ? it : { ...it, isCover };
            })
          : prev
      );
    },
    [updateItems]
  );

  /** A Moment with photos always has a cover: if none is set once a batch
   * settles (e.g. the position-0 photo failed), the first saved photo in
   * the grid becomes the cover — the same "first photo" the previous
   * position-based model would have chosen. */
  const ensureCover = useCallback(
    async (entryId: string) => {
      const complete = itemsRef.current.filter((it) => it.status === "complete" && it.mediaId);
      if (complete.length === 0 || complete.some((it) => it.isCover)) return;
      const first = complete[0];
      const result = await setJournalCover(entryId, first.mediaId as string);
      if ("ok" in result) syncCover(first.mediaId as string);
    },
    [syncCover]
  );

  const prepareOne = useCallback(
    async (localId: string, originalFile: File): Promise<File | null> => {
      if (removedRef.current.has(localId)) return null;
      updateItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, status: "preparing", errorMessage: undefined } : it)));
      const timing = timingRef.current.get(localId);
      if (timing) timing.preprocessStart = performance.now();
      const prepared = await prepareLimit(() => preprocessImageForUpload(originalFile));
      if (timing) {
        timing.preprocessEnd = performance.now();
        timing.preparedBytes = prepared.size;
      }
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
      const timing = timingRef.current.get(localId);
      if (timing) timing.uploadStart = performance.now();
      const supabase = getBrowserSupabase();
      if (!supabase) throw new Error("Upload isn't available right now.");
      await uploadLimit(async () => {
        const { error: uploadError } = await supabase.storage.from(JOURNAL_MEDIA_BUCKET).uploadToSignedUrl(auth.path, auth.token, prepared, {
          contentType: prepared.type || "application/octet-stream",
          cacheControl: "31536000",
        });
        if (uploadError) throw new Error(uploadError.message);
      });
      if (timing) timing.uploadEnd = performance.now();
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
            return {
              ...it,
              status: "complete",
              mediaId: result.mediaId,
              previewUrl: result.url || it.previewUrl,
              isObjectUrl: false,
              errorMessage: undefined,
              isCover: Boolean(result.isCover),
            };
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
   * server-side heic-convert Server Action, exactly as it always has.
   * Timed as one "upload" span (no separate client preprocessing step
   * exists for this path, so preprocessStart/End are never set for these
   * items — see JournalBatchPerf's own note on why a batch where
   * legacyCount equals the batch size means every photo went slow here,
   * not through the fast direct-upload pipeline). */
  const runHeicItem = useCallback(
    async (entryId: string, localId: string, originalFile: File, onSettle?: () => void) => {
      try {
        if (removedRef.current.has(localId)) return;
        updateItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, status: "preparing", errorMessage: undefined } : it)));
        if (removedRef.current.has(localId)) return;
        updateItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, status: "uploading" } : it)));

        const timing = timingRef.current.get(localId);
        if (timing) {
          timing.uploadStart = performance.now();
          timing.preparedBytes = originalFile.size;
        }
        const formData = new FormData();
        formData.set("file", originalFile);
        formData.set("displayOrder", String(currentPosition(localId)));
        const sectionId = itemsRef.current.find((it) => it.localId === localId)?.sectionId;
        if (sectionId) formData.set("sectionId", sectionId);
        const result = await uploadLimit(() => uploadJournalPhoto(entryId, formData));
        if (timing) timing.uploadEnd = performance.now();
        if ("error" in result) throw new Error(result.error);
        const { id: mediaId, url, isCover } = result;

        if (removedRef.current.has(localId)) {
          await removeJournalPhoto(entryId, mediaId);
          return;
        }
        updateItems((prev) =>
          prev.map((it) => {
            if (it.localId !== localId) return it;
            if (it.isObjectUrl) URL.revokeObjectURL(it.previewUrl);
            return { ...it, status: "complete", mediaId, previewUrl: url, isObjectUrl: false, errorMessage: undefined, isCover };
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

      const toFinalize: { localId: string; storagePath: string; displayOrder: number; sectionId?: string | null }[] = [];
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
            toFinalize.push({
              localId: item.localId,
              storagePath: auth.path,
              displayOrder: currentPosition(item.localId),
              ...(item.sectionId ? { sectionId: item.sectionId } : {}),
            });
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
      const finalizeCallStart = performance.now();
      toFinalize.forEach((t) => {
        const timing = timingRef.current.get(t.localId);
        if (timing) timing.finalizeStart = finalizeCallStart;
      });
      const finalizeResult = await finalizeJournalPhotoBatch(entryId, toFinalize);
      const finalizeCallEnd = performance.now();
      toFinalize.forEach((t) => {
        const timing = timingRef.current.get(t.localId);
        if (timing) timing.finalizeEnd = finalizeCallEnd;
      });
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

  /** `options.sectionId` (Moments V2) uploads the selection straight into
   * one of this Moment's sections; omitted = unsectioned, exactly as
   * before. */
  const handleFiles = useCallback(
    async (files: FileList | null, options?: { sectionId?: string | null }) => {
      if (!files || files.length === 0) return;
      // The Add Photos control stays protected from overlapping, uncontrolled
      // batches — JournalPhotoStrip also disables the trigger while any photo
      // is active, so this is the double-submit guard, not the only one.
      if (hasActiveUploads) return;
      setError(null);
      setBatchPerf(null);

      const fileArray = Array.from(files);
      const batchStart = performance.now();

      // NON-NEGOTIABLE — every selected photo becomes a real, visible grid
      // item AND gets its local object-URL preview in ONE synchronous state
      // update, before anything async (including resolving the entry id,
      // which for a brand-new entry is a real network round trip) ever
      // runs. A preview must never wait on preprocessing, authorization,
      // upload, finalization, or the entry id itself.
      const newItems: JournalPhotoItem[] = fileArray.map((file) => ({
        localId: crypto.randomUUID(),
        status: "local",
        previewUrl: URL.createObjectURL(file),
        isObjectUrl: true,
        file,
        isCover: false,
        sectionId: options?.sectionId ?? null,
      }));
      updateItems((prev) => [...prev, ...newItems]);
      const previewsReadyAt = performance.now();

      timingRef.current.clear();
      newItems.forEach((item) => timingRef.current.set(item.localId, {}));

      const entryId = await ensureEntryId();
      if (!entryId) {
        // The previews above already rendered — don't leave them stuck in
        // "local" forever with no way to tell the owner why nothing is
        // happening; Retry re-attempts ensureEntryId through its own path.
        const newLocalIds = new Set(newItems.map((item) => item.localId));
        updateItems((prev) =>
          prev.map((it) => (newLocalIds.has(it.localId) ? { ...it, status: "error", errorMessage: "Couldn't start this Journal entry. Tap Retry." } : it))
        );
        return;
      }

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
      // persist display_order from the grid's CURRENT order for every photo
      // that's actually persisted now (the cover is explicit and untouched;
      // ensureCover only fills it in when the Moment has none).
      await persistOrder(entryId);
      await ensureCover(entryId);

      // V3.1 — derive batch-level spans from each item's own timestamps
      // (see JournalBatchPerf's own doc comment on why a single shared
      // "last mark wins" timestamp per stage was misleading once stages
      // genuinely overlapped).
      const finalizeDoneAt = performance.now();
      const timings = [...timingRef.current.values()];
      const spanOf = (startKey: keyof JournalItemTiming, endKey: keyof JournalItemTiming): number => {
        const starts = timings.map((t) => t[startKey]).filter((v): v is number => v !== undefined);
        const ends = timings.map((t) => t[endKey]).filter((v): v is number => v !== undefined);
        if (starts.length === 0 || ends.length === 0) return 0;
        return Math.max(0, Math.round(Math.max(...ends) - Math.min(...starts)));
      };
      const compressedBytes = timings.reduce((sum, t) => sum + (t.preparedBytes ?? 0), 0);

      setBatchPerf({
        count: newItems.length,
        previewMs: Math.max(0, Math.round(previewsReadyAt - batchStart)),
        prepSpanMs: spanOf("preprocessStart", "preprocessEnd"),
        uploadSpanMs: spanOf("uploadStart", "uploadEnd"),
        finalizeSpanMs: spanOf("finalizeStart", "finalizeEnd"),
        totalMs: Math.round(finalizeDoneAt - batchStart),
        compressedBytes,
        legacyCount: heicItems.length,
      });

      const stillErrored = itemsRef.current.filter((it) => it.status === "error").length;
      if (stillErrored > 0) {
        setError(`${stillErrored} photo${stillErrored === 1 ? "" : "s"} couldn't be uploaded. Tap Retry on ${stillErrored === 1 ? "it" : "any of them"}.`);
      }
    },
    [hasActiveUploads, ensureEntryId, updateItems, processChunk, runHeicItem, persistOrder, ensureCover]
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
        const result = await finalizeJournalPhotoBatch(entryId, [
          { localId, storagePath: item.storagePath, displayOrder: currentPosition(localId), ...(item.sectionId ? { sectionId: item.sectionId } : {}) },
        ]);
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
      await ensureCover(entryId);
    },
    [ensureEntryId, currentPosition, applyFinalizeResult, runHeicItem, processChunk, persistOrder, ensureCover, updateItems]
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
      // deletion behavior (Storage removal + cover failover) unchanged; the
      // server reports the resulting cover so the editor stays in sync.
      const entryId = await ensureEntryId();
      if (!entryId || !item.mediaId) return;
      updateItems((prev) => prev.filter((it) => it.localId !== localId));
      const result = await removeJournalPhoto(entryId, item.mediaId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      syncCover(result.coverMediaId);
      await persistOrder(entryId);
    },
    [ensureEntryId, updateItems, persistOrder, syncCover]
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

  // Moments V2 — Move Earlier/Later step within the photo's own group
  // (its section, or the unsectioned photos), so a sectioned Moment's
  // photos never jump into a neighbouring section. For a flat Moment
  // (every photo unsectioned) this is exactly the previous behavior.
  const moveWithinGroup = useCallback(
    (localId: string, direction: -1 | 1) => {
      reorder((prev) => {
        const index = prev.findIndex((it) => it.localId === localId);
        if (index === -1) return prev;
        const group = prev[index].sectionId ?? null;
        let target = index + direction;
        while (target >= 0 && target < prev.length && (prev[target].sectionId ?? null) !== group) target += direction;
        if (target < 0 || target >= prev.length) return prev;
        const next = [...prev];
        [next[index], next[target]] = [next[target], next[index]];
        return next;
      });
    },
    [reorder]
  );
  const moveEarlier = useCallback((localId: string) => moveWithinGroup(localId, -1), [moveWithinGroup]);
  const moveLater = useCallback((localId: string) => moveWithinGroup(localId, 1), [moveWithinGroup]);

  /** Moments V2 — puts photos into a section (or back to unsectioned with
   * null), appended after that group's existing photos. Never deletes,
   * never changes the cover. */
  const assignSection = useCallback(
    (localIds: string[], sectionId: string | null) => {
      const ids = new Set(localIds);
      reorder((prev) => {
        const moving = prev.filter((it) => ids.has(it.localId)).map((it) => ({ ...it, sectionId }));
        return [...prev.filter((it) => !ids.has(it.localId)), ...moving];
      });
    },
    [reorder]
  );

  /** After a section is deleted server-side (its photos' section_id is
   * already cleared there), mirror that locally. No write needed. */
  const releaseSection = useCallback(
    (sectionId: string) => {
      updateItems((prev) => (prev.some((it) => it.sectionId === sectionId) ? prev.map((it) => (it.sectionId === sectionId ? { ...it, sectionId: null } : it)) : prev));
    },
    [updateItems]
  );

  /** Moments V2 — saves one photo's note (empty = no note). Optimistic;
   * restores the previous note if the save fails. */
  const saveCaption = useCallback(
    async (localId: string, caption: string): Promise<{ ok: true } | { error: string }> => {
      const target = itemsRef.current.find((it) => it.localId === localId);
      if (!target?.mediaId) return { error: "That photo is still uploading." };
      const previous = target.caption ?? null;
      const next = caption.trim() || null;
      updateItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, caption: next } : it)));
      const entryId = await ensureEntryId();
      if (!entryId) return { error: "Couldn't save that note." };
      const result = await saveJournalMediaCaption(entryId, target.mediaId, next);
      if ("error" in result) updateItems((prev) => prev.map((it) => (it.localId === localId ? { ...it, caption: previous } : it)));
      return result;
    },
    [ensureEntryId, updateItems]
  );

  /** Moments V2 — Make Cover marks the photo as the cover WITHOUT moving
   * it (position and section are untouched). Only a saved photo can be the
   * cover; on failure the previous cover is restored. */
  const makeCover = useCallback(
    async (localId: string) => {
      const target = itemsRef.current.find((it) => it.localId === localId);
      if (!target || target.status !== "complete" || !target.mediaId || target.isCover) return;
      const previousCoverId = itemsRef.current.find((it) => it.isCover)?.mediaId ?? null;
      syncCover(target.mediaId);
      const entryId = await ensureEntryId();
      if (!entryId) {
        syncCover(previousCoverId);
        return;
      }
      const result = await setJournalCover(entryId, target.mediaId);
      if ("error" in result) {
        syncCover(previousCoverId);
        setError(result.error);
      }
    },
    [ensureEntryId, syncCover]
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
    assignSection,
    releaseSection,
    saveCaption,
  };
}
