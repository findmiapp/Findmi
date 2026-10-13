// Event Import V1C fixtures — generalized source pages (no network).
// Shapes follow what these kinds of pages publish: schema.org JSON-LD,
// embedded Next.js page state (__NEXT_DATA__, as Luma ships it), and plain
// HTML event cards.

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const page = (head, body) => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
const nextData = (obj) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(obj)}</script>`;

/** A dozen upcoming Events + 2 past, for an organizer calendar (mid-October 2026). */
export const CORGI_EVENTS = [
  { slug: "nyc-gtm-mixer", name: "Founder GTM Mixer", start: "2026-10-13T21:30:00.000Z", end: "2026-10-14T00:30:00.000Z", place: "Corgi Cafe", full: "Corgi Cafe, 123 Orchard St, New York, NY 10002", city: "New York" },
  { slug: "ai-founders-roundtable", name: "AI Founders Roundtable", start: "2026-10-14T22:00:00.000Z", end: "2026-10-15T00:00:00.000Z", place: "Rose Hill", full: "Rose Hill, 34 E 32nd St, New York, NY", city: "New York" },
  { slug: "qsbs-guide", name: "QSBS: Guide to a Tax-Free Exit", start: "2026-10-15T22:00:00.000Z", end: "2026-10-16T00:00:00.000Z", place: "Corgi Cafe", full: "Corgi Cafe, 123 Orchard St, New York, NY 10002", city: "New York" },
  { slug: "spooktober-movie-night", name: "Spooktober Movie Night", start: "2026-10-15T23:00:00.000Z", end: "2026-10-16T02:00:00.000Z", place: "Corgi Cafe", full: "Corgi Cafe, 123 Orchard St, New York, NY 10002", city: "New York" },
  { slug: "aleph-corgi-run-club", name: "Aleph x Corgi Run Club NYC — Saturday Morning 5K Along the East River", start: "2026-10-17T13:00:00.000Z", end: "2026-10-17T14:30:00.000Z", place: "East River Park", full: "East River Park, New York, NY", city: "New York" },
  { slug: "term-sheet-teardown", name: "Term Sheet Teardown", start: "2026-10-20T22:00:00.000Z", end: "2026-10-21T00:00:00.000Z", place: "Corgi Cafe", full: "Corgi Cafe, 123 Orchard St, New York, NY 10002", city: "New York" },
  { slug: "founders-after-hours", name: "Founders After Hours", start: "2026-10-22T23:30:00.000Z", end: "2026-10-23T02:00:00.000Z", place: "The Ten Bells", full: "The Ten Bells, 247 Broome St, New York, NY", city: "New York" },
  { slug: "pancake-social", name: "A Pancake Social", start: "2026-10-25T14:00:00.000Z", end: "2026-10-25T16:00:00.000Z", place: "Corgi Cafe", full: "Corgi Cafe, 123 Orchard St, New York, NY 10002", city: "New York" },
  { slug: "built-in-person", name: "Built in Person", start: "2026-10-28T22:00:00.000Z", end: "2026-10-29T01:00:00.000Z", place: "Corgi Cafe", full: "Corgi Cafe, 123 Orchard St, New York, NY 10002", city: "New York" },
  { slug: "demo-night", name: "Demo Night", start: "2026-11-04T23:00:00.000Z", end: "2026-11-05T02:00:00.000Z", place: "Corgi Cafe", full: "Corgi Cafe, 123 Orchard St, New York, NY 10002", city: "New York" },
  { slug: "corgi-meetup", name: "Corgi Meetup in the Park", start: "2026-11-08T15:00:00.000Z", end: "2026-11-08T17:00:00.000Z", place: "Washington Square Park", full: "Washington Square Park, New York, NY", city: "New York" },
  { slug: "holiday-founders-dinner", name: "Holiday Founders Dinner", start: "2026-12-10T23:30:00.000Z", end: "2026-12-11T02:30:00.000Z", place: null, full: null, city: "New York" },
  { slug: "summer-rooftop", name: "Summer Rooftop Social", start: "2026-08-20T22:00:00.000Z", end: "2026-08-21T01:00:00.000Z", place: "Corgi Cafe", full: "Corgi Cafe, 123 Orchard St, New York, NY 10002", city: "New York" },
  { slug: "sept-founder-brunch", name: "September Founder Brunch", start: "2026-09-12T15:00:00.000Z", end: "2026-09-12T17:00:00.000Z", place: "Corgi Cafe", full: "Corgi Cafe, 123 Orchard St, New York, NY 10002", city: "New York" },
];

const lumaEvent = (e) => ({
  api_id: `evt-${e.slug}`,
  name: e.name,
  start_at: e.start,
  end_at: e.end,
  timezone: "America/New_York",
  url: e.slug,
  cover_url: `https://images.lumacdn.com/event-covers/${e.slug}.jpg`,
  location_type: "offline",
  geo_address_info: e.place ? { mode: "shown", address: e.place, full_address: e.full, city: e.city, region: "New York", country: "United States" } : { mode: "obfuscated", city: e.city, region: "New York" },
});

/** C — a Luma-style organizer calendar: page state carries every Event; the
 * JSON-LD names only the first (what made V1 import just that one). */
export function lumaCalendar(events = CORGI_EVENTS, { ldFirst = true } = {}) {
  const first = events[0];
  const head = [
    `<title>Corgi NYC · Events Calendar</title>`,
    `<meta property="og:title" content="Corgi NYC">`,
    `<meta property="og:image" content="https://images.lumacdn.com/calendars/corgi-avatar.png">`,
    ldFirst ? ld({ "@context": "https://schema.org", "@type": "Event", name: first.name, startDate: first.start, endDate: first.end, url: `https://luma.com/${first.slug}`, image: `https://images.lumacdn.com/event-covers/${first.slug}.jpg`, location: { "@type": "Place", name: first.place } }) : "",
  ].join("");
  const body = `<div id="__next"><h1>Corgi NYC</h1>${events.map((e) => `<div><h3>${esc(e.name)}</h3></div>`).join("")}</div>${nextData({
    props: { pageProps: { initialData: { kind: "calendar", data: { calendar: { api_id: "cal-corgi", name: "Corgi NYC", slug: "usecorginyc", avatar_url: "https://images.lumacdn.com/calendars/corgi-avatar.png" }, featured_items: events.slice(0, 2).map((e) => ({ event: lumaEvent(e) })), items: events.map((e) => ({ api_id: `ci-${e.slug}`, event: lumaEvent(e), hosts: [{ name: "Corgi NYC", api_id: "usr-1" }] })) } } } },
  })}`;
  return page(head, body);
}

/** C — a Luma-style SINGLE Event page: its own record matches the page URL,
 * plus "more from this calendar" records. */
export function lumaEventPage(e = CORGI_EVENTS[3]) {
  const others = CORGI_EVENTS.filter((x) => x !== e).slice(0, 4);
  return page(
    `<title>${esc(e.name)} · Luma</title>${ld({ "@context": "https://schema.org", "@type": "Event", name: e.name, startDate: e.start, endDate: e.end, url: `https://luma.com/${e.slug}`, location: { "@type": "Place", name: e.place } })}`,
    `<h1>${esc(e.name)}</h1>${nextData({ props: { pageProps: { initialData: { data: { event: lumaEvent(e), more_events: others.map(lumaEvent) } } } } })}`
  );
}

/** Calendar page whose Events can't be read (only one foreign Event in the
 * structured data, no page state, no cards). */
export function lumaCalendarUnreadable() {
  const first = CORGI_EVENTS[0];
  return page(`<title>Corgi NYC</title>${ld({ "@type": "Event", name: first.name, startDate: first.start, url: `https://luma.com/${first.slug}` })}`, `<div id="__next"></div>`);
}

/** C2 — structured data listing several Events (ItemList). */
export function structuredList() {
  return page(
    ld({
      "@context": "https://schema.org",
      "@type": "ItemList",
      itemListElement: CORGI_EVENTS.slice(0, 4).map((e, i) => ({ "@type": "ListItem", position: i + 1, item: { "@type": "SocialEvent", name: e.name, startDate: e.start, endDate: e.end, url: `https://www.corgicafe.nyc/events/${e.slug}`, image: `https://www.corgicafe.nyc/img/${e.slug}.jpg`, location: { "@type": "Place", name: e.place ?? "TBA" } } })),
    }),
    `<h1>Events</h1>`
  );
}

/** D/G — a venue's events page: repeated cards, each linking to its own page. */
export function venueCalendar() {
  const shows = [
    ["jazz-night", "Late Night Jazz Trio", "Fri, Oct 16, 2026 · 8:00 PM – 11:00 PM"],
    ["open-mic", "Open Mic Thursdays", "Thu, Oct 22, 2026 · 7–10pm"],
    ["vinyl-swap", "Vinyl Swap & Listening Party", "Sat, Oct 24, 2026 · 1–5pm – Back Room"],
    ["poetry-slam", "Poetry Slam", "Oct 9, 2026, 7pm – Main Room"],
  ];
  return page(
    `<title>Events | The Listening Room</title><meta property="og:site_name" content="The Listening Room">`,
    `<main><h1>Upcoming at The Listening Room</h1><ul class="events">${shows
      .map(([slug, name, when]) => `<li class="event-card"><a href="/events/${slug}"><img src="/img/${slug}.jpg" alt=""><h3>${esc(name)}</h3></a><p>${esc(when)}</p><a href="/events/${slug}#tickets">Tickets</a></li>`)
      .join("")}</ul><footer><a href="/about">About</a></footer></main>`
  );
}

/** G — an organizer page on a ticketing platform: cards linking to that
 * platform's own Event pages. */
export function organizerCards() {
  const items = [
    ["https://www.eventbrite.com/e/brooklyn-maker-market-111", "Brooklyn Maker Market", "Sat, Nov 7 · 11am–5pm – Industry City"],
    ["https://www.eventbrite.com/e/holiday-craft-fair-222", "Holiday Craft Fair", "Sat, Dec 5 · 10am–4pm – Industry City"],
    ["https://www.eventbrite.com/e/winter-night-market-333", "Winter Night Market", "Fri, Dec 18 · 5–10pm – Brooklyn Navy Yard"],
  ];
  return page(
    `<title>Brooklyn Makers Events | Eventbrite</title><meta property="og:site_name" content="Eventbrite">`,
    `<section>${items.map(([href, name, when]) => `<article><a href="${href}"><h2>${esc(name)}</h2></a><div>${esc(when)}</div></article>`).join("")}</section>`
  );
}

/** H — several sections that are dates of ONE Event (same title), each with
 * its own ticket link: must NOT be split into separate Events. */
export function sameTitleSections() {
  const dates = ["Fri, Oct 16, 2026 · 8pm", "Fri, Oct 23, 2026 · 8pm", "Fri, Oct 30, 2026 · 8pm"];
  return page(
    `<title>Comedy Night | The Cellar</title>`,
    `<h1>Comedy Night</h1>${dates.map((d, i) => `<article class="event"><h3>Comedy Night</h3><p>${d} – The Cellar</p><a href="/tickets/${i + 1}">Tickets</a></article>`).join("")}`
  );
}

/** B — a single tour page whose stops link to maps (stays ONE Event). */
export function tourWithMapLinks() {
  const stops = [
    ["9/24, 1–7pm – ", "Grand Central"],
    ["9/26, 12–6pm – ", "Astoria Park"],
    ["10/16, 1–7pm – ", "Domino Park"],
  ];
  return page(
    `<title>Refreshers Sampling Tour 2026</title>`,
    `<h1>Refreshers Sampling Tour</h1><ul>${stops.map(([when, place]) => `<li>${when}<a href="https://www.google.com/maps/search/${encodeURIComponent(place)}">${place}</a></li>`).join("")}</ul>`
  );
}

/** A — a normal single Event page. */
export function singleEventPage() {
  return page(
    `<title>Fall Pop-Up Market</title>${ld({ "@context": "https://schema.org", "@type": "Event", name: "Fall Pop-Up Market", startDate: "2026-11-07T11:00:00-05:00", endDate: "2026-11-07T17:00:00-05:00", url: "https://market.example.com/fall", location: { "@type": "Place", name: "Industry City" } })}`,
    `<h1>Fall Pop-Up Market</h1><aside><h2>More Events</h2><ul><li><a href="/winter"><h3>Winter Market</h3></a><p>Dec 5, 2026 · 11am–5pm</p></li><li><a href="/spring"><h3>Spring Market</h3></a><p>Apr 3, 2027 · 11am–5pm</p></li></ul></aside>`
  );
}
