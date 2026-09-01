import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";
import { getAdminMemberships } from "@/lib/admin/membership-queries";

// CSV export — the concrete, minimal answer to the "spreadsheet-friendly
// workflow" requirement. Supabase stays the source of truth; this is a
// point-in-time snapshot for operational use, never depended on by the
// admin UI itself. src/middleware.ts's existing "/admin/:path*" cookie
// check remains the first perimeter; requireAdmin() below is Security Pass
// 4's second, independent layer — this route has its own directly-
// fetchable URL (it returns a CSV of contact emails/phones/admin notes),
// so it must not rely solely on "middleware already gated the page that
// links here."
function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const memberships = await getAdminMemberships({});

  const header = [
    "Business",
    "Contact Name",
    "Contact Email",
    "Contact Phone",
    "Plan",
    "Markets",
    "Billing Status",
    "Onboarding Status",
    "Publication Status",
    "Founding Price Locked",
    "Submitted",
    "Admin Notes",
  ];

  const rows = memberships.map((m) => [
    m.business?.name ?? m.intended_business_name ?? "",
    m.contact_name ?? "",
    m.contact_email ?? "",
    m.contact_phone ?? "",
    m.plan?.name ?? "",
    m.markets.map((mk) => mk.name).join("; "),
    m.billing_status,
    m.onboarding_status,
    m.publication_status,
    m.founding_price_locked ? "Yes" : "No",
    new Date(m.created_at).toLocaleDateString("en-US"),
    (m.admin_notes ?? "").replace(/\n/g, " | "),
  ]);

  const csv = [header, ...rows].map((row) => row.map((cell) => csvCell(String(cell))).join(",")).join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="findmi-onboarding-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
