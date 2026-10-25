// Contextual search — a deterministic parser (no ML, no LLM). Text becomes
// a structured DiscoveryQuery by longest-phrase matching against Findmi's
// own vocabulary, in a fixed precedence:
//
//   time phrases / flags > Discovery Topics > Event Categories & Formats >
//   Findmi Areas > Findmi Markets > U.S. States
//
// so a Findmi product geography ("New York" → the NYC Market) always beats
// a Census name of the same spelling. Whatever is left becomes candidate
// place phrases (resolved against Census by lib/geo/resolve.ts) and,
// failing that, free text. Ambiguous Findmi names surface as choices. Pure.

import { normalizeSearch } from "../geo/census-format";
import { STATE_BY_NAME, STATE_BY_USPS } from "../geo/states";
import type { EntryMode, EventAudience, EventBenefit } from "./attributes";
import type { DiscoveryQuery, DiscoveryWhen, TimeOfDay } from "./query";

export interface ParseVocabulary {
  topics: { slug: string; name: string; aliases?: string[] }[];
  taxonomy: { slug: string; name: string; kind: "event" | "event_format" }[];
  areas: { slug: string; name: string; market: string; marketName?: string }[];
  markets: { slug: string; name: string }[];
  /** Canonical Businesses whose names appear in the text (the server
   * pre-resolves candidates by exact name — never a fuzzy guess). */
  brands?: { slug: string; name: string }[];
}

export interface ParseOptions {
  /** For weekday / month phrases ("Saturday", "November"). */
  now?: Date;
  timezone?: string;
}

export type Recognized =
  | { kind: "when"; value: DiscoveryWhen; text: string }
  | { kind: "flag"; value: "free" | "family" | "rsvp" | "tickets" | "near_me"; text: string }
  | { kind: "topic"; value: string; text: string }
  | { kind: "category" | "format"; value: string; text: string }
  | { kind: "area"; value: string; market: string; text: string }
  | { kind: "market"; value: string; text: string }
  | { kind: "state"; value: string; text: string }
  | { kind: "zip"; value: string; text: string }
  | { kind: "benefit"; value: EventBenefit; text: string }
  | { kind: "freebies"; value: "any"; text: string }
  | { kind: "tod"; value: TimeOfDay; text: string; today?: boolean }
  | { kind: "date"; value: string; text: string }
  | { kind: "month"; value: string; text: string }
  | { kind: "year"; value: string; text: string }
  | { kind: "audience"; value: EventAudience; text: string }
  | { kind: "entry"; value: EntryMode; text: string }
  | { kind: "paid"; value: "paid"; text: string }
  | { kind: "brand"; value: string; name: string; text: string };

export interface ParsedSearch {
  query: DiscoveryQuery;
  recognized: Recognized[];
  /** Unmatched contiguous phrases — Census place candidates, else text. */
  phrases: string[];
  zip: string | null;
  stateUsps: string | null;
  /** "near me" was asked. Never executed from Census points — Near Me
   * needs real venue coordinates, which Findmi Places don't have yet. */
  nearMe: boolean;
  /** Findmi names matching more than one Area (choices, not a guess). */
  ambiguous: { text: string; options: { area: string; market: string; label: string }[] }[];
}

const WHEN_PHRASES: [string, DiscoveryWhen][] = [
  ["happening now", "now"], ["right now", "now"], ["here now", "now"], ["now", "now"], ["live", "now"],
  ["tonight", "tonight"], ["this evening", "tonight"],
  ["today", "today"], ["tomorrow", "tomorrow"],
  ["this weekend", "weekend"], ["weekend", "weekend"],
  ["this week", "week"], ["upcoming", "upcoming"], ["coming up", "upcoming"],
  ["up next", "upnext"], ["starting soon", "upnext"], ["next week", "next_week"],
  ["this month", "month"], ["next month", "next_month"],
];
/** Structured benefits. "Free Food" is never "Free" (admission): each
 * phrase names exactly the benefit(s) it says. */
const BENEFIT_PHRASES: [string, EventBenefit[]][] = [
  ["free food and drink", ["free_food", "free_drinks"]], ["free food and drinks", ["free_food", "free_drinks"]],
  ["free food", ["free_food"]], ["free eats", ["free_food"]], ["free snacks", ["free_food"]],
  ["free drinks", ["free_drinks"]], ["free drink", ["free_drinks"]], ["open bar", ["free_drinks"]],
  ["free samples", ["free_samples"]], ["free sample", ["free_samples"]], ["samples", ["free_samples"]], ["tastings", ["free_samples"]],
  ["free products", ["free_products"]], ["free gifts", ["free_products"]],
  ["giveaways", ["giveaways"]], ["giveaway", ["giveaways"]], ["swag", ["swag"]], ["goodie bags", ["swag"]], ["gift bags", ["swag"]],
  ["free admission", ["free_admission"]], ["free entry", ["free_admission"]], ["free to attend", ["free_admission"]],
  ["discounts", ["discounts"]], ["discount", ["discounts"]], ["deals", ["discounts"]], ["prizes", ["prizes"]],
];
const TOD_PHRASES: [string, TimeOfDay, boolean][] = [
  ["this morning", "morning", true], ["morning", "morning", false], ["mornings", "morning", false],
  ["this afternoon", "afternoon", true], ["afternoon", "afternoon", false], ["afternoons", "afternoon", false],
  ["evening", "evening", false], ["evenings", "evening", false], ["late night", "late_night", false], ["after dark", "late_night", false],
];
const AUDIENCE_PHRASES: [string, EventAudience][] = [
  ["all ages", "all_ages"], ["21 and over", "21_plus"], ["21 plus", "21_plus"], ["21", "21_plus"], ["21 up", "21_plus"],
  ["adults only", "adults"], ["adults", "adults"], ["for professionals", "professional"], ["professionals", "professional"],
];
const ENTRY_PHRASES: [string, EntryMode][] = [["walk in", "walk_in"], ["walk ins", "walk_in"], ["no reservation", "walk_in"], ["reservations", "reservation"], ["invite only", "invite"]];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY_SHORT: Record<string, number> = { mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thurs: 4, fri: 5, sat: 6 };
// "May" / "March" read as verbs too often to be safe as bare month names.
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const BARE_MONTH_UNSAFE = new Set(["may", "march"]);
const FLAG_PHRASES: [string, "free" | "family" | "rsvp" | "tickets" | "near_me"][] = [
  ["near me", "near_me"], ["nearby", "near_me"], ["around me", "near_me"], ["close to me", "near_me"],
  ["free", "free"], ["no cover", "free"],
  ["family friendly", "family"], ["kid friendly", "family"], ["kids", "family"], ["family", "family"], ["for kids", "family"],
  ["rsvp", "rsvp"], ["tickets", "tickets"], ["ticketed", "tickets"],
];
/** Common Findmi geography nicknames. Applied only when the target slug
 * actually exists in the live vocabulary. */
const AREA_NICKNAMES: Record<string, string[]> = {
  "lower-east-side": ["les"], "long-island-city": ["lic"], "financial-district": ["fidi"],
  "upper-east-side": ["ues"], "upper-west-side": ["uws"], "staten-island": ["si"],
};
const MARKET_NICKNAMES: Record<string, string[]> = { nyc: ["nyc", "new york city", "new york", "ny city"] };

const STOP = new Set(
  "a an the in at on of near around by to for and or with from what whats where wheres is are going happening events event things thing stuff do to find show me places place spots spot best fun good new cool any some see go out".split(" ")
);
/** Two-letter words that are also USPS codes — accepted as a state only
 * when typed in capitals after a place ("Nashville IN"). */
const AMBIGUOUS_USPS = new Set(["in", "or", "me", "hi", "ok", "oh", "de", "al", "id", "la", "co", "ma", "pa", "md", "mo", "ne", "wa", "ga"]);

type Entry = Recognized & { rank: number };

function variants(name: string): string[] {
  const n = normalizeSearch(name);
  const out = new Set([n, normalizeSearch(name.replace(/\+/g, " and "))]);
  for (const v of [...out]) {
    out.add(v.endsWith("s") ? v.slice(0, -1) : `${v}s`);
    if (v.includes(" and ")) out.add(v.replace(/ and /g, " "));
  }
  return [...out].filter(Boolean);
}

function dateEntries(now: Date, tz: string): [string, Entry][] {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(now);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const today = `${g("year")}-${g("month")}-${g("day")}`;
  const [y, m, d] = today.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const dayAt = (offset: number) => new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10);
  const out: [string, Entry][] = [];
  WEEKDAYS.forEach((name, wd) => {
    const value = dayAt((wd - dow + 7) % 7);
    for (const p of [name, `${name}s`, `this ${name}`, `on ${name}`]) out.push([p, { kind: "date", value, text: p, rank: 0 }]);
  });
  for (const [short, wd] of Object.entries(WEEKDAY_SHORT)) out.push([short, { kind: "date", value: dayAt((wd - dow + 7) % 7), text: short, rank: 0 }]);
  MONTHS.forEach((name, i) => {
    const year = i + 1 >= m ? y : y + 1;
    const value = `${year}-${String(i + 1).padStart(2, "0")}`;
    const phrases = [`in ${name}`, `this ${name}`, `${name} ${year}`];
    if (!BARE_MONTH_UNSAFE.has(name)) phrases.push(name);
    for (const p of phrases) out.push([p, { kind: "month", value, text: p, rank: 0 }]);
  });
  return out;
}

function buildDictionary(v: ParseVocabulary, opts: ParseOptions = {}): Map<string, Entry[]> {
  const dict = new Map<string, Entry[]>();
  const put = (phrase: string, e: Entry) => {
    if (!phrase) return;
    const list = dict.get(phrase) ?? [];
    if (!list.some((x) => x.kind === e.kind && x.value === e.value && ("market" in x ? x.market : "") === ("market" in e ? e.market : ""))) list.push(e);
    dict.set(phrase, list);
  };
  for (const [p, value] of WHEN_PHRASES) put(p, { kind: "when", value, text: p, rank: 0 });
  for (const [p, value] of FLAG_PHRASES) put(p, { kind: "flag", value, text: p, rank: 0 });
  put("paid", { kind: "paid", value: "paid", text: "paid", rank: 0 });
  // ("Free things to do" means free to attend — that's the Free flag.)
  for (const p of ["freebies", "freebie", "free swag and samples"]) put(p, { kind: "freebies", value: "any", text: p, rank: 0 });
  for (const [p, values] of BENEFIT_PHRASES) for (const value of values) put(p, { kind: "benefit", value, text: p, rank: 0 });
  for (const [p, value, today] of TOD_PHRASES) put(p, { kind: "tod", value, today, text: p, rank: 0 });
  for (const [p, value] of AUDIENCE_PHRASES) put(p, { kind: "audience", value, text: p, rank: 0 });
  for (const [p, value] of ENTRY_PHRASES) put(p, { kind: "entry", value, text: p, rank: 0 });
  if (opts.now) for (const [p, e] of dateEntries(opts.now, opts.timezone ?? "America/New_York")) put(p, e);
  for (const b of v.brands ?? []) for (const p of variants(b.name)) put(p, { kind: "brand", value: b.slug, name: b.name, text: p, rank: 1.5 });
  for (const t of v.topics) for (const n of [t.name, ...(t.aliases ?? [])]) for (const p of variants(n)) put(p, { kind: "topic", value: t.slug, text: p, rank: 1 });
  for (const t of v.taxonomy) for (const p of [...variants(t.name), normalizeSearch(t.slug.replace(/-/g, " "))]) put(p, { kind: t.kind === "event" ? "category" : "format", value: t.slug, text: p, rank: 2 });
  for (const a of v.areas) for (const p of [normalizeSearch(a.name), ...(AREA_NICKNAMES[a.slug] ?? [])]) put(p, { kind: "area", value: a.slug, market: a.market, text: p, rank: 3 });
  for (const m of v.markets) for (const p of [normalizeSearch(m.name), ...(MARKET_NICKNAMES[m.slug] ?? [])]) put(p, { kind: "market", value: m.slug, text: p, rank: 4 });
  for (const [name, s] of STATE_BY_NAME) put(normalizeSearch(name), { kind: "state", value: s.usps, text: name, rank: 5 });
  return dict;
}

const MAX_PHRASE = 5;

export function parseSearch(raw: string, vocab: ParseVocabulary, opts: ParseOptions = {}): ParsedSearch {
  const dict = buildDictionary(vocab, opts);
  const rawTokens = raw.slice(0, 200).split(/[\s,]+/).filter(Boolean);
  const tokens = rawTokens.map((t) => normalizeSearch(t)).map((t, i) => ({ t, raw: rawTokens[i] })).filter((x) => x.t);
  // normalizeSearch can split a token ("SoHo/NoHo") — flatten.
  const flat: { t: string; raw: string }[] = [];
  for (const x of tokens) for (const part of x.t.split(" ")) flat.push({ t: part, raw: x.t.includes(" ") ? part : x.raw });

  const recognized: Recognized[] = [];
  const ambiguous: ParsedSearch["ambiguous"] = [];
  const phrases: string[] = [];
  let zip: string | null = null;
  let stateUsps: string | null = null;
  let span: string[] = [];
  const flush = () => {
    const words = span.filter((w) => !STOP.has(w));
    if (words.length) phrases.push(words.join(" "));
    span = [];
  };

  for (let i = 0; i < flat.length; ) {
    const tok = flat[i];
    if (/^20\d{2}$/.test(tok.t) && !dict.has(flat.slice(Math.max(0, i - 1), i + 1).map((x) => x.t).join(" "))) {
      flush();
      recognized.push({ kind: "year", value: tok.t, text: tok.t });
      i++;
      continue;
    }
    if (/^\d{5}$/.test(tok.t)) {
      flush();
      zip ??= tok.t;
      recognized.push({ kind: "zip", value: tok.t, text: tok.t });
      i++;
      continue;
    }
    // A capitalised / unambiguous USPS code right after a place phrase.
    if (span.some((w) => !STOP.has(w)) && /^[a-z]{2}$/.test(tok.t) && STATE_BY_USPS.has(tok.t.toUpperCase()) && (!AMBIGUOUS_USPS.has(tok.t) || /^[A-Z]{2}$/.test(tok.raw))) {
      flush();
      stateUsps = tok.t.toUpperCase();
      recognized.push({ kind: "state", value: stateUsps, text: tok.raw });
      i++;
      continue;
    }
    let matched: Entry[] | null = null;
    let len = 0;
    for (let n = Math.min(MAX_PHRASE, flat.length - i); n >= 1; n--) {
      const phrase = flat.slice(i, i + n).map((x) => x.t).join(" ");
      const hit = dict.get(phrase);
      if (hit && !(n === 1 && STOP.has(phrase) && hit.every((h) => h.rank > 0))) {
        matched = hit;
        len = n;
        break;
      }
    }
    if (!matched) {
      span.push(tok.t);
      i++;
      continue;
    }
    flush();
    const best = Math.min(...matched.map((m) => m.rank));
    const top = matched.filter((m) => m.rank === best);
    const text = flat.slice(i, i + len).map((x) => x.t).join(" ");
    if (top[0].kind === "area" && top.length > 1) {
      ambiguous.push({ text, options: top.map((m) => ({ area: m.value, market: (m as Extract<Entry, { kind: "area" }>).market, label: vocab.areas.find((a) => a.slug === m.value && a.market === (m as Extract<Entry, { kind: "area" }>).market)?.marketName ?? m.value })) });
    } else {
      // Topic + taxonomy of the same spelling: keep both (the Topic narrows
      // by its own query; the taxonomy slug unions in).
      for (const m of top) {
        const { rank: _rank, ...r } = m;
        recognized.push({ ...r, text } as Recognized);
      }
      if (top[0].kind === "state") stateUsps ??= top[0].value;
    }
    i += len;
  }
  flush();

  const query: DiscoveryQuery = {};
  for (const r of recognized) {
    if (r.kind === "when") query.when ??= r.value;
    else if (r.kind === "flag") {
      if (r.value === "free") query.free = true;
      else if (r.value === "family") query.family = true;
      else if (r.value === "rsvp" || r.value === "tickets") query.access = [...new Set([...(query.access ?? []), r.value])];
    } else if (r.kind === "topic") query.topics = [...new Set([...(query.topics ?? []), r.value])];
    else if (r.kind === "category") query.categories = [...new Set([...(query.categories ?? []), r.value])];
    else if (r.kind === "format") query.formats = [...new Set([...(query.formats ?? []), r.value])];
    else if (r.kind === "area") {
      query.area ??= r.value;
      query.market ??= r.market;
    } else if (r.kind === "market") query.market ??= r.value;
    else if (r.kind === "benefit") query.benefits = [...new Set([...(query.benefits ?? []), r.value])];
    else if (r.kind === "freebies") {
      query.benefits = [...new Set([...(query.benefits ?? []), "free_samples", "free_products", "giveaways", "swag"] as EventBenefit[])];
      query.benefitMode = "any";
    } else if (r.kind === "tod") {
      query.tod ??= r.value;
      if (r.today) query.when ??= "today";
    } else if (r.kind === "date") query.date ??= r.value;
    else if (r.kind === "month") query.month ??= r.value;
    else if (r.kind === "year") query.year ??= r.value;
    else if (r.kind === "audience") query.audience = [...new Set([...(query.audience ?? []), r.value])];
    else if (r.kind === "entry") query.entry = [...new Set([...(query.entry ?? []), r.value])];
    else if (r.kind === "paid") query.paid = true;
    else if (r.kind === "brand") query.brands = [...new Set([...(query.brands ?? []), r.value])];
  }
  // A month named with a year ("November 2026") is that month, not the year.
  if (query.month && query.year && query.month.startsWith(query.year)) delete query.year;
  return { query, recognized, phrases, zip, stateUsps, nearMe: recognized.some((r) => r.kind === "flag" && r.value === "near_me"), ambiguous };
}
