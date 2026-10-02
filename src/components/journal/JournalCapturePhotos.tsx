"use client";

import { useCallback } from "react";
import { useJournalPhotoUpload } from "./useJournalPhotoUpload";
import JournalPhotoStrip from "./JournalPhotoStrip";

/** Journal Live Capture pass — thin wrapper around the exact same shared
 * photo-upload hook/UI Create and Edit already use (useJournalPhotoUpload
 * + JournalPhotoStrip), not a new upload path. The entry already exists
 * by the time this renders (create-or-resume already happened), so
 * ensureEntryId is trivial — every upload/remove/cover change persists
 * immediately through the existing uploadJournalPhoto/removeJournalPhoto/
 * setJournalCoverPhoto Server Actions (same validation, same private
 * journal-media storage, same admin-aware authorization from Pass 1), so
 * captured photos survive navigating away with no separate final Save. */
export default function JournalCapturePhotos({
  entryId,
  initialPhotos,
}: {
  entryId: string;
  initialPhotos: { id: string; url: string; isCover: boolean }[];
}) {
  // Mobile QA Repair pass — stable across renders so the photo hook's own
  // per-tile handlers stay stable too (see useJournalPhotoUpload's note on
  // why that matters for drag performance).
  const ensureEntryId = useCallback(async () => entryId, [entryId]);

  const {
    items,
    error,
    batchProgress,
    batchPerf,
    dismissBatchPerf,
    hasActiveUploads,
    handleFiles,
    handleRemove,
    retryItem,
    handleDragReorder,
    moveEarlier,
    moveLater,
    makeCover,
  } = useJournalPhotoUpload(initialPhotos, ensureEntryId);

  return (
    <JournalPhotoStrip
      items={items}
      error={error}
      batchProgress={batchProgress}
      batchPerf={batchPerf}
      onDismissBatchPerf={dismissBatchPerf}
      disabled={hasActiveUploads}
      onFilesSelected={handleFiles}
      onRemove={handleRemove}
      onRetry={retryItem}
      onDragReorder={handleDragReorder}
      onMoveEarlier={moveEarlier}
      onMoveLater={moveLater}
      onMakeCover={makeCover}
    />
  );
}
