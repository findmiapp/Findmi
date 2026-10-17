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
import type { DiscoveryQuery, DiscoveryWhen } from "./query";

export interface ParseVocabulary {
  topics: { slug: string; name: string; aliases?: string[] }[];
  taxonomy: { slug: string; name: string; kind: "event" | "event_format" }[];
  areas: { slug: string; name: string; market: string; marketName?: string }[];
  markets: { slug: string; name: string }[];
}

export type Recognized =
  | { kind: "when"; value: DiscoveryWhen; text: string }
  | { kind: "flag"; value: "free" | "family" | "rsvp" | "tickets" | "near_me"; text: string }
  | { kind: "topic"; value: string; text: string }
  | { kind: "category" | "format"; value: string; text: string }
  | { kind: "area"; value: string; market: string; text: string }
  | { kind: "market"; value: string; text: string }
  | { kind: "state"; value: string; text: string }
  | { kind: "zip"; value: string; text: string };

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
];
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

function buildDictionary(v: ParseVocabulary): Map<string, Entry[]> {
  const dict = new Map<string, Entry[]>();
  const put = (phrase: string, e: Entry) => {
    if (!phrase) return;
    const list = dict.get(phrase) ?? [];
    if (!list.some((x) => x.kind === e.kind && x.value === e.value && ("market" in x ? x.market : "") === ("market" in e ? e.market : ""))) list.push(e);
    dict.set(phrase, list);
  };
  for (const [p, value] of WHEN_PHRASES) put(p, { kind: "when", value, text: p, rank: 0 });
  for (const [p, value] of FLAG_PHRASES) put(p, { kind: "flag", value, text: p, rank: 0 });
  for (const t of v.topics) for (const n of [t.name, ...(t.aliases ?? [])]) for (const p of variants(n)) put(p, { kind: "topic", value: t.slug, text: p, rank: 1 });
  for (const t of v.taxonomy) for (const p of [...variants(t.name), normalizeSearch(t.slug.replace(/-/g, " "))]) put(p, { kind: t.kind === "event" ? "category" : "format", value: t.slug, text: p, rank: 2 });
  for (const a of v.areas) for (const p of [normalizeSearch(a.name), ...(AREA_NICKNAMES[a.slug] ?? [])]) put(p, { kind: "area", value: a.slug, market: a.market, text: p, rank: 3 });
  for (const m of v.markets) for (const p of [normalizeSearch(m.name), ...(MARKET_NICKNAMES[m.slug] ?? [])]) put(p, { kind: "market", value: m.slug, text: p, rank: 4 });
  for (const [name, s] of STATE_BY_NAME) put(normalizeSearch(name), { kind: "state", value: s.usps, text: name, rank: 5 });
  return dict;
}

const MAX_PHRASE = 5;

export function parseSearch(raw: string, vocab: ParseVocabulary): ParsedSearch {
  const dict = buildDictionary(vocab);
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
  }
  return { query, recognized, phrases, zip, stateUsps, nearMe: recognized.some((r) => r.kind === "flag" && r.value === "near_me"), ambiguous };
}
