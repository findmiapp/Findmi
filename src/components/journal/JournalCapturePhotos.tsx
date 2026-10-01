"use client";

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
  const { photos, batch, error, handleFiles, handleRemove, handleSetCover } = useJournalPhotoUpload(
    initialPhotos,
    async () => entryId
  );

  return (
    <JournalPhotoStrip
      photos={photos}
      batch={batch}
      error={error}
      onFilesSelected={handleFiles}
      onRemove={handleRemove}
      onSetCover={handleSetCover}
    />
  );
}
