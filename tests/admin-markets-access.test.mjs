// Admin Markets & Areas access — the existing /admin/markets manager is
// reachable from Admin Home (a management shortcut, not a create tile),
// from More → Discovery, and still from Directory → Structure; Requests
// already lists Market Requests. Navigation only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const NAV = await import("../src/components/admin/adminNavItems.ts");
const HOME = readFileSync("src/app/admin/(protected)/page.tsx", "utf8");
const items = (key) => NAV.getAdminSection(key).groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label })));

test("Admin Home: Markets & Areas management shortcut → /admin/markets, outside the + create grid", () => {
  const grid = HOME.slice(HOME.indexOf("{QUICK_CREATE.map("), HOME.indexOf("</div>", HOME.indexOf("{QUICK_CREATE.map(")));
  assert.doesNotMatch(grid, /markets/);
  assert.match(HOME, /<Link\s+href="\/admin\/markets"[\s\S]*?<NavIcon name="pin"[\s\S]*?Markets &amp; Areas<\/span>[\s\S]*?Control where Findmi is available\.<\/span>/);
  assert.ok(HOME.indexOf('href="/admin/markets"') > HOME.indexOf("{QUICK_CREATE.map("), "just below the create actions");
});

test("Markets & Areas is listed once (Directory) — the duplicate More › Discovery entry is gone", () => {
  const all = NAV.ADMIN_SECTIONS.flatMap((s) => s.groups.flatMap((g) => g.items)).filter((i) => i.href === "/admin/markets");
  assert.equal(all.length, 1);
  assert.ok(!NAV.getAdminSection("more").groups.some((g) => g.items.some((i) => i.href === "/admin/markets")));
});

test("Directory still lists it; Requests already has Market Requests; section highlight unchanged", () => {
  assert.ok(items("directory").some((i) => i.href === "/admin/markets"));
  assert.ok(items("requests").some((i) => i.href === "/admin/market-requests"));
  assert.equal(NAV.resolveAdminRoute("/admin/markets").section, "directory", "first (Directory) entry still owns the route");
  assert.equal(NAV.resolveAdminRoute("/admin/market-requests").section, "requests");
});
