import { notFound } from "next/navigation";
import { requireAdminSupabase } from "@/lib/admin/requireAdminSupabase";
import { getPublicProfilesByUserIds } from "@/lib/profiles";
import type { Inquiry, InquiryMessage } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Read-only thread view — operational visibility only (see this pass's
 * own "do not build a giant CRM" instruction), no admin reply here. */
export default async function AdminInquiryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await requireAdminSupabase();

  const { data: inquiry } = await supabase
    .from("inquiries")
    .select("*, business:businesses(name, slug), product:products(name)")
    .eq("id", id)
    .maybeSingle();
  if (!inquiry) notFound();
  const row = inquiry as unknown as Inquiry & { business: { name: string; slug: string } | null; product: { name: string } | null };

  const [{ data: messages }, profiles] = await Promise.all([
    supabase.from("inquiry_messages").select("*").eq("inquiry_id", id).order("created_at", { ascending: true }),
    row.user_id ? getPublicProfilesByUserIds(supabase, [row.user_id]) : Promise.resolve(new Map()),
  ]);
  const profile = row.user_id ? profiles.get(row.user_id) : null;

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
        {row.business?.name ?? "Unknown business"}
      </h1>
      <p className="mt-1 text-sm text-ink/50">
        {profile ? `${profile.display_name || `@${profile.username}`}` : row.user_id ? "FindMi account (no public profile)" : "Anonymous inquiry"}
        {row.product?.name ? ` · About: ${row.product.name}` : ""} · Status: {row.status}
      </p>
      {(row.customer_email || row.customer_phone) && (
        <p className="mt-1 text-xs text-ink/40">
          Customer-provided contact: {[row.customer_email, row.customer_phone].filter(Boolean).join(" · ")}
        </p>
      )}

      <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-black/10 bg-white p-4">
        {((messages ?? []) as InquiryMessage[]).map((m) => (
          <div key={m.id} className={`flex flex-col ${m.sender_type === "customer" ? "items-start" : "items-end"}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                m.sender_type === "customer" ? "bg-black/[0.04] text-ink" : "bg-findmi-50 text-findmi-800"
              }`}
            >
              <p className="whitespace-pre-line">{m.body}</p>
            </div>
            <p className="mt-1 px-1 text-[11px] text-ink/35">
              {m.sender_type === "customer" ? "Customer" : row.business?.name ?? "Business"} ·{" "}
              {new Date(m.created_at).toLocaleString()}
            </p>
          </div>
        ))}
        {(messages ?? []).length === 0 && <p className="text-sm text-ink/40">No messages yet.</p>}
      </div>
    </div>
  );
}
