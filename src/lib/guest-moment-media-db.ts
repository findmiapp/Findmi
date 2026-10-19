"use client";

// Guest-First Experience Completion pass — this device's own storage for
// a guest Moment draft's actual photo files. Deliberately separate from
// the small JSON draft (lib/guest-moment-draft.ts): IndexedDB holds
// arbitrarily large Blobs comfortably where localStorage cannot (and
// must not — a photo is never base64'd into localStorage). One object
// store, keyed by the same localId the draft's own `media` array
// carries, so the two stay in sync by construction rather than by a
// second index. Nothing here ever leaves the browser — conversion (see
// MomentComposer's resume/convert effect) is the only thing that reads
// these back out, and only to feed the real, already-authenticated
// upload pipeline.

const DB_NAME = "findmi-guest-moments";
const DB_VERSION = 1;
const STORE = "media";

interface StoredMedia {
  blob: Blob;
  name: string;
  type: string;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Stores one guest-selected photo's actual bytes under `localId`,
 * unmodified (no client-side resizing here — the real upload pipeline's
 * own preprocessing runs once, at conversion, on whatever is retrieved
 * from here, exactly as it would for a freshly-selected file). Resolves
 * false on any storage failure (quota, private browsing) — the caller
 * surfaces that as a normal per-photo error, same as an upload failure
 * would be. */
export async function putGuestMomentMedia(localId: string, file: File): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ blob: file, name: file.name, type: file.type } satisfies StoredMedia, localId);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/** Reconstructs a real File from a stored blob — what conversion feeds
 * into the authenticated upload pipeline exactly as if it had just been
 * picked from the device. Null when the record is missing or storage is
 * unavailable. */
export async function getGuestMomentMedia(localId: string): Promise<File | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(localId);
      req.onsuccess = () => {
        const stored = req.result as StoredMedia | undefined;
        if (!stored) {
          resolve(null);
          return;
        }
        resolve(new File([stored.blob], stored.name || "photo.jpg", { type: stored.type || "image/jpeg" }));
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function deleteGuestMomentMedia(localId: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(localId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Full draft cleanup after a successful conversion, or an explicit
 * discard — never leaves an orphaned blob behind for either outcome. */
export async function deleteAllGuestMomentMedia(localIds: string[]): Promise<void> {
  await Promise.all(localIds.map((id) => deleteGuestMomentMedia(id)));
}
