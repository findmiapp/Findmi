// Test stub for the Moment server actions. Every call is RECORDED in
// `calls`, so a guest test can assert that composing, reloading and
// restoring never reached a server action at all (no anonymous
// journal_entries insert, no anonymous Storage authorization), while an
// authenticated conversion test can assert exactly-once creation.
export const calls = [];
export const counters = { entries: 0 };
const rec = (name, make) => async (...args) => {
  calls.push(name);
  return make ? make(...args) : { ok: true };
};
export const startJournalDraft = rec("startJournalDraft", () => ({ id: `entry-${++counters.entries}` }));
export const saveJournalBasics = rec("saveJournalBasics");
export const saveJournalLocation = rec("saveJournalLocation");
export const saveJournalConnections = rec("saveJournalConnections");
export const setJournalAuthor = rec("setJournalAuthor");
export const publishJournalEntry = rec("publishJournalEntry", () => undefined);
export const saveJournalAsDraft = rec("saveJournalAsDraft");
export const getEventOccurrencesForJournal = rec("getEventOccurrencesForJournal", () => []);
export const uploadJournalPhoto = rec("uploadJournalPhoto", () => ({ error: "not in tests" }));
export const removeJournalPhoto = rec("removeJournalPhoto", () => ({ ok: true, coverMediaId: null }));
export const saveJournalMediaLayout = rec("saveJournalMediaLayout");
export const setJournalCover = rec("setJournalCover");
export const saveJournalMediaCaption = rec("saveJournalMediaCaption");
export const discardJournalUpload = rec("discardJournalUpload");
export const authorizeJournalPhotoUploadBatch = rec("authorizeJournalPhotoUploadBatch", (_entryId, items) => ({
  results: items.map((i) => ({ localId: i.localId, ok: true, path: `p/${i.localId}.jpg`, token: "t" })),
}));
export const finalizeJournalPhotoBatch = rec("finalizeJournalPhotoBatch", (_entryId, items) => ({
  results: items.map((i) => ({ localId: i.localId, ok: true, mediaId: `m-${i.localId}`, url: `https://img.test/${i.localId}.jpg`, isCover: false })),
}));
export const createJournalSection = rec("createJournalSection", () => ({ error: "not in tests" }));
export const updateJournalSection = rec("updateJournalSection", () => ({ error: "not in tests" }));
export const reorderJournalSections = rec("reorderJournalSections");
export const deleteJournalSection = rec("deleteJournalSection");
