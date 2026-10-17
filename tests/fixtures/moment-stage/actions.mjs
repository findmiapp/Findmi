// Test stub for the Moment server actions — every write "succeeds", so the
// editor's REAL client state path (useJournalPhotoUpload + MomentPhotosStage)
// runs exactly as in the browser, with no network.
export const calls = [];
const ok = (name) => async (...args) => (calls.push([name, ...args]), { ok: true });
export const saveJournalMediaLayout = ok("saveJournalMediaLayout");
export const setJournalCover = ok("setJournalCover");
export const saveJournalMediaCaption = ok("saveJournalMediaCaption");
export const removeJournalPhoto = async () => ({ ok: true, coverMediaId: null });
export const uploadJournalPhoto = async () => ({ error: "not in tests" });
export const authorizeJournalPhotoUploadBatch = async () => ({ error: "not in tests" });
export const finalizeJournalPhotoBatch = async () => ({ error: "not in tests" });
export const discardJournalUpload = async () => ({ ok: true });
// A deliberately naive "server": every call inserts a NEW section (after a
// short delay, so rapid taps overlap) — the editor itself must not
// duplicate presets.
export const createdSections = [];
export const createJournalSection = async (entryId, { sectionType }) => {
  await new Promise((r) => setTimeout(r, 20));
  const section = { id: `new-${createdSections.length + 1}`, journal_entry_id: entryId, section_type: sectionType, title: null, notes: null, display_order: 100 + createdSections.length, created_at: "", updated_at: "" };
  createdSections.push(section);
  return { section };
};
export const updateJournalSection = async () => ({ error: "not in tests" });
export const reorderJournalSections = ok("reorderJournalSections");
export const deleteJournalSection = ok("deleteJournalSection");
