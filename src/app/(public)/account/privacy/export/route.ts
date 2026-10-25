import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAdminSupabase } from "@/lib/admin/supabase-admin";
import { buildAccountExport } from "@/lib/privacy/account-data";

export const dynamic = "force-dynamic";

/** Download My Data: a JSON file of the signed-in person's own account
 * data (lib/privacy/account-data). Each download is recorded as a
 * completed export request so it appears in their request history. */
export async function GET() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login?next=/account/privacy", process.env.NEXT_PUBLIC_SITE_URL || "https://findmi.app"));
  const admin = getAdminSupabase();
  if (!admin) return NextResponse.json({ error: "Server isn't configured." }, { status: 500 });

  const data = await buildAccountExport(admin, user.id, user.email ?? null);
  const now = new Date().toISOString();
  await admin
    .from("privacy_requests")
    .insert({ user_id: user.id, request_type: "export", status: "completed", details: "Self-service download", resolved_at: now })
    .then(() => undefined, () => undefined);

  const date = now.slice(0, 10);
  return new NextResponse(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="findmi-data-${date}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
