// Guest Library — signed-out Collections and list saves, kept on THIS
// device only (pure rules + guarded storage; client-safe, testable).
//
// Same idea as the guest Moment draft (lib/guest-moment-draft.ts): a
// versioned, validated record in localStorage; nothing about an account
// is ever stored here — only which public things (type + id, plus the
// name / link to show them) the visitor put in which list or Collection.
// On sign-in / sign-up it is merged into the account (/api/collections/
// import, idempotent) and cleared ONLY after the server confirms.
//
// Lists ("Want To Go", "Been Here", …) are the existing per-type
// relationships (lib/personal-model.ts PERSONAL_LISTS); Collections are
// visitor-named, any type (lib/collections-domain.ts).

import { COLLECTION_NAME_MAX, isCollectionEntityType, normalizeCollectionName, type CollectionEntityType } from "./collections-domain";
import { RELATIONSHIPS, type Relationship } from "./discovery/relationships";

export const GUEST_LIBRARY_VERSION = 1;
export const GUEST_LIBRARY_KEY = "findmi_guest_library_v1";
/** After this many successful saves, one gentle "protect your
 * collections" reminder (dismissible, never repeated). */
export const GUEST_REMINDER_AFTER = 3;
export const GUEST_LIMITS = { collections: 50, itemsPerCollection: 200, relations: 500, name: 140 } as const;

export interface GuestEntity {
  type: CollectionEntityType;
  id: string;
  /** For showing it on this device (public name + page link only). */
  name: string;
  href: string | null;
}

export interface GuestCollection {
  /** Local key (not a database id). */
  key: string;
  name: string;
  createdAt: number;
  items: (GuestEntity & { addedAt: number })[];
}

export interface GuestRelation extends GuestEntity {
  relation: Relationship;
  at: number;
}

export interface GuestLibrary {
  v: typeof GUEST_LIBRARY_VERSION;
  collections: GuestCollection[];
  relations: GuestRelation[];
  /** Successful saving actions so far (drives the one reminder). */
  saves: number;
  reminder: "pending" | "dismissed";
  updatedAt: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_HREF = /^\/[a-z0-9\-/?=&%._~]*$/i;

export function emptyGuestLibrary(now = Date.now()): GuestLibrary {
  return { v: GUEST_LIBRARY_VERSION, collections: [], relations: [], saves: 0, reminder: "pending", updatedAt: now };
}

function cleanEntity(raw: unknown): GuestEntity | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isCollectionEntityType(r.type) || typeof r.id !== "string" || !UUID.test(r.id)) return null;
  const name = typeof r.name === "string" ? r.name.replace(/\s+/g, " ").trim().slice(0, GUEST_LIMITS.name) : "";
  const href = typeof r.href === "string" && SAFE_HREF.test(r.href) ? r.href : null;
  return { type: r.type, id: r.id.toLowerCase(), name, href };
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** A stored value → a valid library (or a fresh one). Anything malformed
 * is dropped item by item, never trusted. */
export function parseGuestLibrary(raw: string | null, now = Date.now()): GuestLibrary {
  if (!raw) return emptyGuestLibrary(now);
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return emptyGuestLibrary(now);
  }
  if (!data || typeof data !== "object" || (data as { v?: unknown }).v !== GUEST_LIBRARY_VERSION) return emptyGuestLibrary(now);
  const d = data as Record<string, unknown>;
  const names = new Set<string>();
  const collections: GuestCollection[] = [];
  for (const c of Array.isArray(d.collections) ? d.collections.slice(0, GUEST_LIMITS.collections) : []) {
    if (!c || typeof c !== "object") continue;
    const cc = c as Record<string, unknown>;
    const name = normalizeCollectionName(cc.name);
    const key = typeof cc.key === "string" && /^g_[a-z0-9]{6,32}$/.test(cc.key) ? cc.key : null;
    if (!name || !key || names.has(name.toLowerCase())) continue;
    names.add(name.toLowerCase());
    const seen = new Set<string>();
    const items: GuestCollection["items"] = [];
    for (const it of Array.isArray(cc.items) ? cc.items.slice(0, GUEST_LIMITS.itemsPerCollection) : []) {
      const e = cleanEntity(it);
      if (!e || seen.has(`${e.type}:${e.id}`)) continue;
      seen.add(`${e.type}:${e.id}`);
      items.push({ ...e, addedAt: num((it as Record<string, unknown>).addedAt, now) });
    }
    collections.push({ key, name, createdAt: num(cc.createdAt, now), items });
  }
  const relSeen = new Set<string>();
  const relations: GuestRelation[] = [];
  for (const r of Array.isArray(d.relations) ? d.relations.slice(0, GUEST_LIMITS.relations) : []) {
    const e = cleanEntity(r);
    const relation = (r as Record<string, unknown> | null)?.relation;
    if (!e || typeof relation !== "string" || !(RELATIONSHIPS as readonly string[]).includes(relation)) continue;
    const k = `${e.type}:${e.id}:${relation}`;
    if (relSeen.has(k)) continue;
    relSeen.add(k);
    relations.push({ ...e, relation: relation as Relationship, at: num((r as Record<string, unknown>).at, now) });
  }
  return {
    v: GUEST_LIBRARY_VERSION,
    collections,
    relations,
    saves: Math.max(0, Math.floor(num(d.saves, 0))),
    reminder: d.reminder === "dismissed" ? "dismissed" : "pending",
    updatedAt: num(d.updatedAt, now),
  };
}

export const isGuestLibraryEmpty = (lib: GuestLibrary) => lib.collections.length === 0 && lib.relations.length === 0;

const same = (a: { type: string; id: string }, b: { type: string; id: string }) => a.type === b.type && a.id.toLowerCase() === b.id.toLowerCase();

export function guestRelationsFor(lib: GuestLibrary, entity: { type: string; id: string }): Set<Relationship> {
  return new Set(lib.relations.filter((r) => same(r, entity)).map((r) => r.relation));
}

export function guestCollectionsContaining(lib: GuestLibrary, entity: { type: string; id: string }): Set<string> {
  return new Set(lib.collections.filter((c) => c.items.some((i) => same(i, entity))).map((c) => c.key));
}

/** Puts / takes the entity in / out of one of its lists. Saving counts
 * toward the reminder; removing never does. */
export function setGuestRelation(lib: GuestLibrary, entity: GuestEntity, relation: Relationship, on: boolean, now = Date.now()): GuestLibrary {
  const rest = lib.relations.filter((r) => !(same(r, entity) && r.relation === relation));
  if (!on) return { ...lib, relations: rest, updatedAt: now };
  if (rest.length >= GUEST_LIMITS.relations) return lib;
  return { ...lib, relations: [...rest, { ...entity, relation, at: now }], saves: lib.saves + 1, updatedAt: now };
}

export type GuestCreateResult = { ok: true; lib: GuestLibrary; key: string } | { ok: false; error: "name" | "duplicate" | "limit" };

/** A new Collection (optionally with the entity already in it). Names are
 * unique per device, ignoring case — the same rule as an account. */
export function createGuestCollection(lib: GuestLibrary, rawName: unknown, entity?: GuestEntity, now = Date.now(), key = newGuestKey()): GuestCreateResult {
  const name = normalizeCollectionName(rawName);
  if (!name) return { ok: false, error: "name" };
  if (lib.collections.some((c) => c.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: "duplicate" };
  if (lib.collections.length >= GUEST_LIMITS.collections) return { ok: false, error: "limit" };
  const col: GuestCollection = { key, name, createdAt: now, items: entity ? [{ ...entity, addedAt: now }] : [] };
  return { ok: true, key, lib: { ...lib, collections: [col, ...lib.collections], saves: lib.saves + (entity ? 1 : 0), updatedAt: now } };
}

export function setGuestCollectionItem(lib: GuestLibrary, key: string, entity: GuestEntity, on: boolean, now = Date.now()): GuestLibrary {
  let saved = false;
  const collections = lib.collections.map((c) => {
    if (c.key !== key) return c;
    const has = c.items.some((i) => same(i, entity));
    if (on && !has && c.items.length < GUEST_LIMITS.itemsPerCollection) {
      saved = true;
      return { ...c, items: [{ ...entity, addedAt: now }, ...c.items] };
    }
    if (!on && has) return { ...c, items: c.items.filter((i) => !same(i, entity)) };
    return c;
  });
  return { ...lib, collections, saves: lib.saves + (saved ? 1 : 0), updatedAt: now };
}

/** Show the one reminder now? (After GUEST_REMINDER_AFTER saves, until
 * dismissed — then never again; saving keeps working either way.) */
export const shouldShowGuestReminder = (lib: GuestLibrary) => lib.reminder === "pending" && lib.saves >= GUEST_REMINDER_AFTER && !isGuestLibraryEmpty(lib);
export const dismissGuestReminder = (lib: GuestLibrary, now = Date.now()): GuestLibrary => ({ ...lib, reminder: "dismissed", updatedAt: now });

export function newGuestKey(): string {
  const bytes = new Uint8Array(9);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return `g_${[...bytes].map((b) => (b % 36).toString(36)).join("")}`;
}

/** What the account import receives — ids and names only (the server
 * re-validates everything; display names aren't trusted or stored). */
export interface GuestLibraryImport {
  v: typeof GUEST_LIBRARY_VERSION;
  collections: { name: string; items: { type: CollectionEntityType; id: string }[] }[];
  relations: { type: CollectionEntityType; id: string; relation: Relationship }[];
}

export function toImportPayload(lib: GuestLibrary): GuestLibraryImport {
  return {
    v: GUEST_LIBRARY_VERSION,
    collections: lib.collections.map((c) => ({ name: c.name.slice(0, COLLECTION_NAME_MAX), items: c.items.map((i) => ({ type: i.type, id: i.id })) })),
    relations: lib.relations.map((r) => ({ type: r.type, id: r.id, relation: r.relation })),
  };
}

// ---------------------------------------------------------------- storage

/** Storage can be missing, full or blocked (private browsing, disabled
 * site data). The library then lives in memory for this visit and the
 * caller says so — it never throws. */
let memory: GuestLibrary | null = null;
const listeners = new Set<() => void>();

export function readGuestLibrary(): { lib: GuestLibrary; persistent: boolean } {
  if (typeof window === "undefined") return { lib: emptyGuestLibrary(), persistent: false };
  try {
    const raw = window.localStorage.getItem(GUEST_LIBRARY_KEY);
    const lib = parseGuestLibrary(raw);
    memory = lib;
    return { lib, persistent: true };
  } catch {
    return { lib: memory ?? emptyGuestLibrary(), persistent: false };
  }
}

/** Saves; `false` when only kept in memory (storage unavailable / full). */
export function writeGuestLibrary(lib: GuestLibrary): boolean {
  memory = lib;
  let ok = false;
  try {
    if (isGuestLibraryEmpty(lib) && lib.reminder === "pending" && lib.saves === 0) window.localStorage.removeItem(GUEST_LIBRARY_KEY);
    else window.localStorage.setItem(GUEST_LIBRARY_KEY, JSON.stringify(lib));
    ok = true;
  } catch {
    ok = false;
  }
  for (const l of listeners) l();
  return ok;
}

/** Cleared only after the account confirmed the merge. */
export function clearGuestLibrary(): void {
  memory = null;
  try {
    window.localStorage.removeItem(GUEST_LIBRARY_KEY);
  } catch {
    /* nothing stored */
  }
  for (const l of listeners) l();
}

export function subscribeGuestLibrary(fn: () => void): () => void {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => e.key === GUEST_LIBRARY_KEY && fn();
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}
