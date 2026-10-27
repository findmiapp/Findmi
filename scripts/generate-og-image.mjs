// Homepage social share image (public/og/findmi-share.png, 1200x630).
//
// A committed static PNG rather than a Next opengraph-image route: a file
// convention in app/ or (public)/ would cascade into every child segment
// and override the per-entity images Business/Event/Product pages already
// set. The only content is the founder-supplied finalized lockup (icon,
// "findmi" wordmark, "The Find Me Here App" beneath it), stored at
// public/brand/findmi-lockup-tagline.png, centered on an opaque white
// canvas at its own proportions. Nothing else is drawn.
//
// Regenerate (only if the lockup changes):
//   node scripts/generate-og-image.mjs
// Requires Playwright + Chromium installed locally.
import { readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

// require(), not import: resolves a globally installed Playwright too.
const { chromium } = createRequire(import.meta.url)("playwright");

const lockup = readFileSync(new URL("../public/brand/findmi-lockup-tagline.png", import.meta.url)).toString("base64");
const out = new URL("../public/og/findmi-share.png", import.meta.url);
mkdirSync(new URL("../public/og/", import.meta.url), { recursive: true });

// The lockup file is 1426px wide including 24px of white padding per side;
// 1035px renders the visible lockup ~1000px wide, leaving ~100px side and
// ~165px top/bottom safe margins for preview-surface cropping.
const html = `<!doctype html><html><head><style>
  * { margin: 0; padding: 0; }
  html, body { width: 1200px; height: 630px; background: #FFFFFF; }
  body { display: flex; align-items: center; justify-content: center; }
  img { width: 1035px; height: auto; display: block; }
</style></head><body>
  <img src="data:image/png;base64,${lockup}" alt="" />
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.waitForLoadState("load");
await page.screenshot({ path: out.pathname, omitBackground: false });
await browser.close();
console.log(`wrote ${out.pathname}`);
