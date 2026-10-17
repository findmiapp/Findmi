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
export const createJournalSection = async () => ({ error: "not in tests" });
export const updateJournalSection = async () => ({ error: "not in tests" });
export const reorderJournalSections = ok("reorderJournalSections");
export const deleteJournalSection = ok("deleteJournalSection");
